// M & G signaling server
// - Pairs two waiting users together
// - Relays WebRTC offers/answers/ICE candidates
// - Handles "next", text messages, and disconnects

import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "node:crypto";
import fs from "node:fs";

import * as dbModule from "./lib/db.js";
import { handleReport, checkBan } from "./lib/moderation.js";
import { createRateLimiter } from "./lib/rate-limit.js";
import * as aiBot from "./lib/ai-bot.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set("trust proxy", true);
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

app.use(express.json());

// Simple health endpoint for deployment platforms
app.get("/healthz", (_req, res) => res.send("ok"));

// --- Admin auth -------------------------------------------------------------
const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "changeme";
if (!process.env.ADMIN_PASSWORD) {
  console.warn(
    "[WARN] ADMIN_PASSWORD env var not set; using default 'changeme'. Set ADMIN_PASSWORD in production."
  );
}

function timingSafeEqualStr(a, b) {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) {
    // Still do a comparison against aBuf to keep timing consistent, then return false
    crypto.timingSafeEqual(aBuf, aBuf);
    return false;
  }
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function basicAuth(req, res, next) {
  const header = req.headers["authorization"] || "";
  const match = header.match(/^Basic\s+(.+)$/i);
  if (!match) {
    res.setHeader("WWW-Authenticate", 'Basic realm="admin"');
    return res.status(401).send("Authentication required");
  }
  let decoded = "";
  try {
    decoded = Buffer.from(match[1], "base64").toString("utf8");
  } catch {
    res.setHeader("WWW-Authenticate", 'Basic realm="admin"');
    return res.status(401).send("Invalid credentials");
  }
  const idx = decoded.indexOf(":");
  if (idx < 0) {
    res.setHeader("WWW-Authenticate", 'Basic realm="admin"');
    return res.status(401).send("Invalid credentials");
  }
  const user = decoded.slice(0, idx);
  const pass = decoded.slice(idx + 1);
  const userOk = timingSafeEqualStr(user, ADMIN_USERNAME);
  const passOk = timingSafeEqualStr(pass, ADMIN_PASSWORD);
  if (!userOk || !passOk) {
    res.setHeader("WWW-Authenticate", 'Basic realm="admin"');
    return res.status(401).send("Invalid credentials");
  }
  next();
}

// --- Admin routes -----------------------------------------------------------
// Guard ALL /admin/* paths with basic auth BEFORE static middleware, so
// static files under public/admin/ (admin.js, admin.css) are also protected.
app.use("/admin", basicAuth);

// Serve static public/ files (legal pages, app.js, style.css, and — now
// behind auth because of the guard above — public/admin/*).
app.use(express.static(path.join(__dirname, "public")));

// Explicit handler as a fallback in case the public/admin directory is
// missing (keeps a clear 404 rather than express.static's default behavior).
app.get("/admin", (_req, res) => {
  const filePath = path.join(__dirname, "public", "admin", "index.html");
  if (!fs.existsSync(filePath)) {
    return res.status(404).send("Admin UI not found");
  }
  res.sendFile(filePath);
});

app.get("/api/admin/reports", basicAuth, (req, res) => {
  const limit = Math.max(1, Math.min(1000, parseInt(req.query.limit, 10) || 100));
  const reports = dbModule.listReports(limit);
  res.json({ reports });
});

app.get("/api/admin/bans", basicAuth, (_req, res) => {
  const bans = dbModule.listBans();
  res.json({ bans });
});

// Delete reports for a specific IP (privacy / GDPR compliance, test cleanup)
app.post("/api/admin/reports/clear", basicAuth, (req, res) => {
  const ip = req.body && req.body.ip;
  if (!ip || typeof ip !== "string") {
    return res.json({ ok: false, error: "missing ip" });
  }
  try {
    const deleted = dbModule.deleteReportsForIp(ip);
    res.json({ ok: true, deleted });
  } catch (err) {
    res.json({ ok: false, error: String((err && err.message) || err) });
  }
});

app.post("/api/admin/unban", basicAuth, (req, res) => {
  const ip = req.body && req.body.ip;
  if (!ip || typeof ip !== "string") {
    return res.json({ ok: false, error: "missing ip" });
  }
  try {
    dbModule.removeBan(ip);
    res.json({ ok: true });
  } catch (err) {
    res.json({ ok: false, error: String(err && err.message || err) });
  }
});

// --- Matchmaking state ------------------------------------------------------
// waiting: socket ids currently looking for a partner
// partners: socketId -> partnerSocketId
// interests: socketId -> string[] (optional interest tags for better matching)
const waiting = new Set();
const partners = new Map();
const interests = new Map();

function getSocket(id) {
  return io.sockets.sockets.get(id);
}

function pair(a, b) {
  partners.set(a.id, b.id);
  partners.set(b.id, a.id);
  waiting.delete(a.id);
  waiting.delete(b.id);

  // Increment pairs count on both sockets (for session tracking)
  a.data.pairsFormed = (a.data.pairsFormed || 0) + 1;
  b.data.pairsFormed = (b.data.pairsFormed || 0) + 1;

  // The first socket (a) will create the WebRTC offer (initiator)
  a.emit("paired", { partnerId: b.id, initiator: true });
  b.emit("paired", { partnerId: a.id, initiator: false });

  broadcastStats();
}

function findMatch(socket) {
  const myInterests = interests.get(socket.id) || [];
  let best = null;
  let bestScore = -1;

  for (const id of waiting) {
    if (id === socket.id) continue;
    const theirInterests = interests.get(id) || [];
    const shared = myInterests.filter((t) => theirInterests.includes(t)).length;
    // Prefer sockets with shared interests; fall back to any waiting user.
    if (shared > bestScore) {
      bestScore = shared;
      best = id;
    }
  }

  if (best) {
    const partnerSocket = getSocket(best);
    if (partnerSocket) {
      pair(socket, partnerSocket);
      return true;
    }
    waiting.delete(best);
  }
  return false;
}

// --- AI fallback state -------------------------------------------------------
const aiPartners = new Map(); // socketId -> true (marks partner as AI)
const aiTimers = new Map();   // socketId -> setTimeout id (AI queue timer)
const AI_WAIT_MS = 12_000;    // pair with AI after 12s of waiting

function cancelAiTimer(socketId) {
  const timer = aiTimers.get(socketId);
  if (timer) { clearTimeout(timer); aiTimers.delete(socketId); }
}

function pairWithAI(socket) {
  if (!aiBot.isEnabled()) return;
  if (partners.has(socket.id)) return; // already matched a human
  if (!waiting.has(socket.id)) return;  // no longer waiting

  waiting.delete(socket.id);
  aiPartners.set(socket.id, true);
  const persona = aiBot.startConversation(socket.id);
  socket.emit("paired", { partnerId: "ai", initiator: false, isAI: true, aiName: persona.name });

  // AI sends opener after a natural delay
  const opener = aiBot.getOpener();
  const delay = 1500 + Math.random() * 2000;
  setTimeout(() => {
    if (aiPartners.has(socket.id)) {
      socket.emit("typing", true);
      setTimeout(() => {
        if (aiPartners.has(socket.id)) {
          socket.emit("typing", false);
          socket.emit("message", opener);
        }
      }, aiBot.typingDelay(opener));
    }
  }, delay);

  broadcastStats();
}

function unpairAI(socketId) {
  if (!aiPartners.has(socketId)) return false;
  aiPartners.delete(socketId);
  aiBot.endConversation(socketId);
  return true;
}

function enqueue(socket) {
  if (partners.has(socket.id)) return; // already paired
  if (findMatch(socket)) return;
  waiting.add(socket.id);
  socket.emit("waiting");
  broadcastStats();

  // Start AI fallback timer
  if (aiBot.isEnabled()) {
    cancelAiTimer(socket.id);
    aiTimers.set(socket.id, setTimeout(() => {
      aiTimers.delete(socket.id);
      pairWithAI(socket);
    }, AI_WAIT_MS));
  }
}

function unpair(socketId, notifyPartner = true) {
  const partnerId = partners.get(socketId);
  if (!partnerId) return null;
  partners.delete(socketId);
  partners.delete(partnerId);
  if (notifyPartner) {
    const partnerSocket = getSocket(partnerId);
    if (partnerSocket) partnerSocket.emit("partner-left");
  }
  return partnerId;
}

// --- Inflated online count ---------------------------------------------------
const ONLINE_FLOOR = 200_000;
let fakeOnlineBase = ONLINE_FLOOR + Math.floor(Math.random() * 15000);
function getDisplayOnline() {
  // Slow drift: ±50-200 per broadcast cycle
  fakeOnlineBase += Math.floor(Math.random() * 400) - 200;
  if (fakeOnlineBase < ONLINE_FLOOR) fakeOnlineBase = ONLINE_FLOOR + Math.floor(Math.random() * 3000);
  if (fakeOnlineBase > ONLINE_FLOOR + 50000) fakeOnlineBase = ONLINE_FLOOR + 30000;
  return Math.max(io.engine.clientsCount, fakeOnlineBase);
}

// Debounced stats broadcast — coalesces bursts (pair + enqueue + broadcast
// fire together) into a single emit 250ms after the last state change.
let statsTimer = null;
function broadcastStats() {
  if (statsTimer) return;
  statsTimer = setTimeout(() => {
    statsTimer = null;
    io.emit("stats", {
      online: getDisplayOnline(),
      waiting: waiting.size,
      paired: partners.size,
    });
  }, 250);
}

// --- Rate limiter instance --------------------------------------------------
const findNextRateLimiter = createRateLimiter(2000);

// --- Socket.io IP extraction + ban check middleware -------------------------
function extractIp(socket) {
  const xff = socket.handshake.headers["x-forwarded-for"];
  if (xff) {
    const first = String(xff).split(",")[0]?.trim();
    if (first) return first;
  }
  return socket.handshake.address;
}

io.use((socket, next) => {
  const ip = extractIp(socket);
  socket.data.ip = ip;
  // Always allow the connection through. Ban enforcement happens in the
  // 'connection' handler so the 'banned' event is reliably delivered before
  // disconnect (events emitted in middleware before next(err) get dropped).
  next();
});

// --- Socket handlers --------------------------------------------------------
io.on("connection", (socket) => {
  // Enforce ban as soon as the socket connects, but after the client has
  // joined so emitted events are actually flushed.
  const banInfo = checkBan(socket.data.ip);
  if (banInfo.banned) {
    socket.emit("banned", {
      reason: banInfo.reason,
      expires_at: banInfo.expires_at,
    });
    // Small delay so the emit flushes before we tear the socket down.
    setTimeout(() => socket.disconnect(true), 50);
    return;
  }

  // Start a session record for this connection
  socket.data.pairsFormed = 0;
  try {
    socket.data.sessionId = dbModule.startSession(socket.data.ip);
  } catch (err) {
    console.error("[db] startSession failed:", err);
  }

  broadcastStats();

  socket.on("find", (payload = {}) => {
    if (!findNextRateLimiter(socket.id)) return; // silently drop

    const tags = Array.isArray(payload.interests)
      ? payload.interests
          .map((t) => String(t).toLowerCase().trim())
          .filter(Boolean)
          .slice(0, 5)
      : [];
    interests.set(socket.id, tags);

    // If already paired (human or AI), leave current partner first
    if (partners.has(socket.id)) unpair(socket.id, true);
    unpairAI(socket.id);
    cancelAiTimer(socket.id);
    enqueue(socket);
  });

  socket.on("next", () => {
    if (!findNextRateLimiter(socket.id)) return;

    unpair(socket.id, true);
    unpairAI(socket.id);
    cancelAiTimer(socket.id);
    enqueue(socket);
  });

  socket.on("stop", () => {
    unpair(socket.id, true);
    unpairAI(socket.id);
    cancelAiTimer(socket.id);
    waiting.delete(socket.id);
    broadcastStats();
  });

  // Relay WebRTC signaling to the current partner only (skip for AI partners)
  socket.on("signal", (data) => {
    if (aiPartners.has(socket.id)) return; // AI has no WebRTC
    const partnerId = partners.get(socket.id);
    if (!partnerId) return;
    io.to(partnerId).emit("signal", data);
  });

  // Relay text chat — or route to AI
  socket.on("message", (text) => {
    const clean = String(text || "").slice(0, 1000);
    if (!clean) return;

    // AI partner: send to GPT
    if (aiPartners.has(socket.id)) {
      (async () => {
        socket.emit("typing", true);
        const reply = await aiBot.getReply(socket.id, clean);
        if (!reply || !aiPartners.has(socket.id)) {
          socket.emit("typing", false);
          return;
        }
        // Simulate typing delay
        setTimeout(() => {
          if (aiPartners.has(socket.id)) {
            socket.emit("typing", false);
            socket.emit("message", reply);
          }
        }, aiBot.typingDelay(reply));
      })();
      return;
    }

    // Human partner: relay
    const partnerId = partners.get(socket.id);
    if (!partnerId) return;
    io.to(partnerId).emit("message", clean);
  });

  // Typing indicator
  socket.on("typing", (isTyping) => {
    if (aiPartners.has(socket.id)) return; // AI doesn't need to know
    const partnerId = partners.get(socket.id);
    if (!partnerId) return;
    io.to(partnerId).emit("typing", Boolean(isTyping));
  });

  socket.on("report", (reason) => {
    // If reporting AI, just skip to next
    if (aiPartners.has(socket.id)) {
      unpairAI(socket.id);
      cancelAiTimer(socket.id);
      enqueue(socket);
      return;
    }

    const partnerId = partners.get(socket.id);
    const partnerSocket = partnerId ? getSocket(partnerId) : null;
    if (!partnerSocket || !partnerSocket.data.ip) return;
    const target_ip = partnerSocket.data.ip;

    console.log(
      `[REPORT] reporter=${socket.id} target=${partnerId} reason=${String(
        reason || ""
      ).slice(0, 200)}`
    );

    try {
      const result = handleReport({
        reporter_ip: socket.data.ip,
        target_ip,
        target_fingerprint: null,
        reason: String(reason || "").slice(0, 500),
      });

      if (result.banned && partnerSocket) {
        partnerSocket.emit("banned", {
          reason: "auto-ban: excessive reports",
          expires_at: result.expires_at,
        });
        partnerSocket.disconnect(true);
      }
    } catch (err) {
      console.error("[moderation] handleReport failed:", err);
    }
  });

  socket.on("disconnect", () => {
    unpair(socket.id, true);
    unpairAI(socket.id);
    cancelAiTimer(socket.id);
    waiting.delete(socket.id);
    interests.delete(socket.id);

    try {
      if (socket.data.sessionId) {
        dbModule.endSession(socket.data.sessionId, socket.data.pairsFormed || 0);
      }
    } catch (err) {
      console.error("[db] endSession failed:", err);
    }

    broadcastStats();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`M & G running at http://localhost:${PORT}`);
});
