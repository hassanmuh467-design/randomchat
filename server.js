// Random chat signaling server
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

function enqueue(socket) {
  if (partners.has(socket.id)) return; // already paired
  if (findMatch(socket)) return;
  waiting.add(socket.id);
  socket.emit("waiting");
  broadcastStats();
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

// Debounced stats broadcast — coalesces bursts (pair + enqueue + broadcast
// fire together) into a single emit 250ms after the last state change.
let statsTimer = null;
function broadcastStats() {
  if (statsTimer) return;
  statsTimer = setTimeout(() => {
    statsTimer = null;
    io.emit("stats", {
      online: io.engine.clientsCount,
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

    // If already paired, leave current partner first
    if (partners.has(socket.id)) unpair(socket.id, true);
    enqueue(socket);
  });

  socket.on("next", () => {
    if (!findNextRateLimiter(socket.id)) return; // silently drop

    unpair(socket.id, true);
    enqueue(socket);
  });

  socket.on("stop", () => {
    unpair(socket.id, true);
    waiting.delete(socket.id);
    broadcastStats();
  });

  // Relay WebRTC signaling to the current partner only
  socket.on("signal", (data) => {
    const partnerId = partners.get(socket.id);
    if (!partnerId) return;
    io.to(partnerId).emit("signal", data);
  });

  // Relay text chat
  socket.on("message", (text) => {
    const partnerId = partners.get(socket.id);
    if (!partnerId) return;
    const clean = String(text || "").slice(0, 1000);
    if (!clean) return;
    io.to(partnerId).emit("message", clean);
  });

  // Typing indicator
  socket.on("typing", (isTyping) => {
    const partnerId = partners.get(socket.id);
    if (!partnerId) return;
    io.to(partnerId).emit("typing", Boolean(isTyping));
  });

  socket.on("report", (reason) => {
    const partnerId = partners.get(socket.id);
    const partnerSocket = partnerId ? getSocket(partnerId) : null;
    if (!partnerSocket || !partnerSocket.data.ip) return; // nothing to report
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
  console.log(`randomchat running at http://localhost:${PORT}`);
});
