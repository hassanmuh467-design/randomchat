// End-to-end test: spins up real socket.io clients against a running server.
// Assumes server is at SERVER_URL (default http://localhost:3100) with ADMIN_PASSWORD=testpass123.
//
// Run:  node tests/e2e.mjs

import { io } from "socket.io-client";

const SERVER_URL = process.env.SERVER_URL || "http://localhost:3100";
const ADMIN_AUTH = "Basic " + Buffer.from("admin:testpass123").toString("base64");

let passed = 0;
let failed = 0;
const failures = [];

function pass(name) {
  passed++;
  console.log(`  PASS  ${name}`);
}
function fail(name, msg) {
  failed++;
  failures.push(`${name}: ${msg}`);
  console.log(`  FAIL  ${name} — ${msg}`);
}
function assert(cond, name, msg = "assertion failed") {
  if (cond) pass(name);
  else fail(name, msg);
}
function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(socket, event, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeoutMs);
    socket.once(event, (data) => {
      clearTimeout(t);
      resolve(data);
    });
  });
}

function newClient(opts = {}) {
  return io(SERVER_URL, {
    transports: ["websocket"],
    forceNew: true,
    reconnection: false,
    ...opts,
  });
}

async function adminFetch(path, options = {}) {
  const res = await fetch(SERVER_URL + path, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: ADMIN_AUTH },
  });
  return { status: res.status, body: res.status === 200 ? await res.json() : await res.text() };
}

// =========================================================================
console.log("\n=== TEST SUITE: RandomChat E2E ===\n");

// --- Test 1: Basic pairing -----------------------------------------------
console.log("Test 1: Basic pairing");
{
  const a = newClient();
  const b = newClient();
  try {
    await Promise.all([waitFor(a, "connect"), waitFor(b, "connect")]);
    pass("both clients connect");

    const aPaired = waitFor(a, "paired", 3000);
    const bPaired = waitFor(b, "paired", 3000);
    a.emit("find", { interests: ["music"] });
    await wait(50);
    b.emit("find", { interests: ["music"] });

    const [aRes, bRes] = await Promise.all([aPaired, bPaired]);
    assert(aRes.partnerId && bRes.partnerId, "both got partnerId");
    // Whichever socket processes 'find' second becomes initiator — just
    // verify exactly one side is the initiator (required for WebRTC offer).
    assert(
      (aRes.initiator === true) !== (bRes.initiator === true),
      "exactly one initiator (XOR)"
    );
    assert(aRes.partnerId === b.id && bRes.partnerId === a.id, "partnerIds cross-reference");
  } catch (e) {
    fail("Test 1 pairing", e.message);
  } finally {
    a.close();
    b.close();
  }
  await wait(100);
}

// --- Test 2: Text messaging relay ----------------------------------------
console.log("\nTest 2: Text messaging");
{
  const a = newClient();
  const b = newClient();
  try {
    await Promise.all([waitFor(a, "connect"), waitFor(b, "connect")]);
    a.emit("find", {});
    await wait(50);
    b.emit("find", {});
    await Promise.all([waitFor(a, "paired"), waitFor(b, "paired")]);

    const bRx = waitFor(b, "message", 1000);
    a.emit("message", "hello from a");
    const received = await bRx;
    assert(received === "hello from a", "b receives a's message");

    const aRx = waitFor(a, "message", 1000);
    b.emit("message", "hi back");
    const received2 = await aRx;
    assert(received2 === "hi back", "a receives b's reply");

    // Message length clamp
    const bRx2 = waitFor(b, "message", 1000);
    const longMsg = "x".repeat(2000);
    a.emit("message", longMsg);
    const clamped = await bRx2;
    assert(clamped.length === 1000, "long message clamped to 1000 chars");
  } catch (e) {
    fail("Test 2 messaging", e.message);
  } finally {
    a.close();
    b.close();
  }
  await wait(100);
}

// --- Test 3: Typing indicator --------------------------------------------
console.log("\nTest 3: Typing indicator");
{
  const a = newClient();
  const b = newClient();
  try {
    await Promise.all([waitFor(a, "connect"), waitFor(b, "connect")]);
    a.emit("find", {});
    await wait(50);
    b.emit("find", {});
    await Promise.all([waitFor(a, "paired"), waitFor(b, "paired")]);

    const bRx = waitFor(b, "typing", 1000);
    a.emit("typing", true);
    const typing = await bRx;
    assert(typing === true, "b receives typing=true");
  } catch (e) {
    fail("Test 3 typing", e.message);
  } finally {
    a.close();
    b.close();
  }
  await wait(100);
}

// --- Test 4: Signal relay (WebRTC) ---------------------------------------
console.log("\nTest 4: WebRTC signal relay");
{
  const a = newClient();
  const b = newClient();
  try {
    await Promise.all([waitFor(a, "connect"), waitFor(b, "connect")]);
    a.emit("find", {});
    await wait(50);
    b.emit("find", {});
    await Promise.all([waitFor(a, "paired"), waitFor(b, "paired")]);

    const bRx = waitFor(b, "signal", 1000);
    const fakeOffer = { type: "offer", sdp: { type: "offer", sdp: "v=0..." } };
    a.emit("signal", fakeOffer);
    const relayed = await bRx;
    assert(relayed.type === "offer", "offer relayed to partner");

    const aRx = waitFor(a, "signal", 1000);
    b.emit("signal", { type: "answer", sdp: { type: "answer", sdp: "v=0..." } });
    const answer = await aRx;
    assert(answer.type === "answer", "answer relayed back");
  } catch (e) {
    fail("Test 4 signaling", e.message);
  } finally {
    a.close();
    b.close();
  }
  await wait(100);
}

// --- Test 5: partner-left on disconnect ----------------------------------
console.log("\nTest 5: partner-left on disconnect");
{
  const a = newClient();
  const b = newClient();
  try {
    await Promise.all([waitFor(a, "connect"), waitFor(b, "connect")]);
    a.emit("find", {});
    await wait(50);
    b.emit("find", {});
    await Promise.all([waitFor(a, "paired"), waitFor(b, "paired")]);

    const aPartnerLeft = waitFor(a, "partner-left", 2000);
    b.close();
    await aPartnerLeft;
    pass("a receives partner-left when b disconnects");
  } catch (e) {
    fail("Test 5 partner-left", e.message);
  } finally {
    a.close();
  }
  await wait(100);
}

// --- Test 6: next() unpairs + rematches ----------------------------------
console.log("\nTest 6: next unpairs and rematches");
{
  const a = newClient();
  const b = newClient();
  const c = newClient();
  try {
    await Promise.all([waitFor(a, "connect"), waitFor(b, "connect"), waitFor(c, "connect")]);
    a.emit("find", {});
    await wait(50);
    b.emit("find", {});
    await Promise.all([waitFor(a, "paired"), waitFor(b, "paired")]);
    pass("a + b paired");

    // Rate limiter is 2000ms — wait before next
    await wait(2100);

    // c joins, a hits next → a should unpair from b and get paired with c
    c.emit("find", {});
    await wait(50);
    const aNewPair = waitFor(a, "paired", 3000);
    const bLeft = waitFor(b, "partner-left", 3000);
    a.emit("next");

    await bLeft;
    pass("b gets partner-left when a hits next");
    const newPair = await aNewPair;
    assert(newPair.partnerId === c.id, "a re-pairs with c");
  } catch (e) {
    fail("Test 6 next", e.message);
  } finally {
    a.close();
    b.close();
    c.close();
  }
  await wait(100);
}

// --- Test 7: Rate limiter silently drops rapid find/next -----------------
console.log("\nTest 7: Rate limiter drops rapid events");
{
  const a = newClient();
  const b = newClient();
  try {
    await Promise.all([waitFor(a, "connect"), waitFor(b, "connect")]);

    // First find should succeed (waiting event)
    const aWaiting = waitFor(a, "waiting", 1000);
    a.emit("find", {});
    await aWaiting;
    pass("first find produces waiting event");

    // Rapid-fire finds within 2s window — should be dropped
    let waitingCount = 0;
    a.on("waiting", () => { waitingCount++; });
    for (let i = 0; i < 5; i++) {
      a.emit("find", {});
      await wait(20);
    }
    await wait(200);
    assert(waitingCount === 0, `no extra waiting events from rapid finds (got ${waitingCount})`);

    // Trigger pairing so we can cleanly tear down
    b.emit("find", {});
    await Promise.all([waitFor(a, "paired"), waitFor(b, "paired")]);
  } catch (e) {
    fail("Test 7 rate limit", e.message);
  } finally {
    a.close();
    b.close();
  }
  await wait(100);
}

// --- Test 8: stats broadcast ---------------------------------------------
console.log("\nTest 8: stats broadcast");
{
  const a = newClient();
  try {
    await waitFor(a, "connect");
    const stats = await waitFor(a, "stats", 2000);
    assert(typeof stats.online === "number" && stats.online >= 1, "stats has online count");
    assert(typeof stats.waiting === "number", "stats has waiting count");
  } catch (e) {
    fail("Test 8 stats", e.message);
  } finally {
    a.close();
  }
  await wait(100);
}

// --- Test 9: Admin API: reports list -------------------------------------
console.log("\nTest 9: Admin API");
{
  // No auth
  const noAuth = await fetch(SERVER_URL + "/api/admin/reports");
  assert(noAuth.status === 401, "no auth → 401");

  // Wrong password
  const wrongAuth = await fetch(SERVER_URL + "/api/admin/reports", {
    headers: { Authorization: "Basic " + Buffer.from("admin:wrong").toString("base64") },
  });
  assert(wrongAuth.status === 401, "wrong password → 401");

  // Correct
  const ok = await adminFetch("/api/admin/reports");
  assert(ok.status === 200, "correct auth → 200");
  assert(Array.isArray(ok.body.reports), "reports is array");

  const bans = await adminFetch("/api/admin/bans");
  assert(bans.status === 200 && Array.isArray(bans.body.bans), "bans endpoint works");

  // Malformed unban body
  const badUnban = await adminFetch("/api/admin/unban", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assert(badUnban.status === 200 && badUnban.body.ok === false, "unban without ip rejected");
}
await wait(100);

// --- Test 10: Report flow + auto-ban -------------------------------------
// In local tests both sockets share 127.0.0.1/::1, so reporter_ip === target_ip.
// The moderation counts reports against target_ip regardless of reporter,
// so 3 reports from any source → 7-day auto-ban + banned event emitted.
console.log("\nTest 10: Report → auto-ban after 3 reports");
{
  // Clear any existing bans + reports on loopback IPs so we start fresh
  const loopbackIps = ["::1", "127.0.0.1", "::ffff:127.0.0.1"];
  for (const ip of loopbackIps) {
    await adminFetch("/api/admin/unban", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ip }),
    });
    await adminFetch("/api/admin/reports/clear", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ip }),
    });
  }

  const before = await adminFetch("/api/admin/reports");
  const beforeCount = before.body.reports.length;

  // Submit 3 reports through paired sockets
  for (let i = 0; i < 3; i++) {
    const a = newClient();
    const b = newClient();
    try {
      await Promise.all([waitFor(a, "connect"), waitFor(b, "connect")]);
      await wait(2100); // respect rate limit between pairs
      a.emit("find", {});
      await wait(50);
      b.emit("find", {});
      await Promise.all([waitFor(a, "paired"), waitFor(b, "paired")]);

      // On the 3rd report, we expect the target (b) to receive a banned event
      if (i === 2) {
        const bBanned = waitFor(b, "banned", 3000);
        a.emit("report", `test reason ${i + 1}`);
        const banEvent = await bBanned;
        assert(banEvent.expires_at > Date.now(), "banned event includes future expires_at");
        pass("3rd report triggers banned event to target");
      } else {
        a.emit("report", `test reason ${i + 1}`);
        await wait(150);
      }
    } catch (e) {
      fail(`report attempt ${i + 1}`, e.message);
    } finally {
      a.close();
      b.close();
      await wait(200);
    }
  }

  const after = await adminFetch("/api/admin/reports");
  assert(
    after.body.reports.length >= beforeCount + 3,
    `at least 3 reports stored (was ${beforeCount}, now ${after.body.reports.length})`
  );

  const bansAfter = await adminFetch("/api/admin/bans");
  const hasBan = bansAfter.body.bans.some(
    (b) => b.ip === "::1" || b.ip === "127.0.0.1" || b.ip === "::ffff:127.0.0.1"
  );
  assert(hasBan, "loopback IP is now in bans table");

  // Test 11: new connection from banned IP gets kicked
  console.log("\nTest 11: Banned IP blocked on connect");
  const banned = newClient();
  try {
    const bannedEvent = waitFor(banned, "banned", 2000);
    const disconnected = waitFor(banned, "disconnect", 2000);
    const info = await bannedEvent;
    assert(typeof info.expires_at === "number", "banned event has expires_at");
    await disconnected;
    pass("banned socket is disconnected");
  } catch (e) {
    fail("Test 11 ban-on-connect", e.message);
  } finally {
    banned.close();
  }

  // Cleanup: unban so we can keep testing / re-run
  await adminFetch("/api/admin/unban", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ip: "::1" }),
  });
  await adminFetch("/api/admin/unban", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ip: "127.0.0.1" }),
  });
  await adminFetch("/api/admin/unban", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ip: "::ffff:127.0.0.1" }),
  });
  pass("cleanup: unbanned loopback IPs");
}

// --- Test 12: Static assets ---------------------------------------------
console.log("\nTest 12: Static assets");
{
  const pages = [
    ["/", "text/html"],
    ["/style.css", "text/css"],
    ["/app.js", "javascript"],
    ["/age-gate.js", "javascript"],
    ["/age-gate.css", "text/css"],
    ["/legal/terms.html", "text/html"],
    ["/legal/privacy.html", "text/html"],
    ["/legal/banned.html", "text/html"],
    ["/healthz", "text/"],
  ];
  for (const [path, ctPrefix] of pages) {
    const r = await fetch(SERVER_URL + path);
    const ct = r.headers.get("content-type") || "";
    assert(
      r.status === 200 && ct.includes(ctPrefix.split("/").pop() === "" ? ctPrefix.split("/")[0] : ctPrefix.split("/").pop()),
      `${path} → 200 (${ct.split(";")[0]})`
    );
  }
}

// --- Summary -------------------------------------------------------------
console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  console.log("\nFailures:");
  failures.forEach((f) => console.log(" - " + f));
  process.exit(1);
}
process.exit(0);
