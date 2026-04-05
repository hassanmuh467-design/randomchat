// SQLite persistence layer using Node 22+ built-in node:sqlite module.
// No external dependencies.

import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

// Ensure data/ directory exists before opening the DB
fs.mkdirSync("data", { recursive: true });

const DB_PATH = path.join("data", "randomchat.db");
export const db = new DatabaseSync(DB_PATH);

// Schema creation on boot
db.exec(`
  CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reporter_ip TEXT,
    target_ip TEXT,
    target_fingerprint TEXT,
    reason TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_reports_target ON reports(target_ip, created_at);

  CREATE TABLE IF NOT EXISTS bans (
    ip TEXT PRIMARY KEY,
    reason TEXT,
    expires_at INTEGER,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip TEXT,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    pairs_formed INTEGER DEFAULT 0
  );
`);

// --- Prepared statements ---------------------------------------------------
const stmtInsertReport = db.prepare(
  `INSERT INTO reports (reporter_ip, target_ip, target_fingerprint, reason, created_at)
   VALUES (?, ?, ?, ?, ?)`
);

const stmtCountRecentReports = db.prepare(
  `SELECT COUNT(*) AS cnt FROM reports WHERE target_ip = ? AND created_at >= ?`
);

const stmtGetBan = db.prepare(`SELECT * FROM bans WHERE ip = ?`);

const stmtInsertBan = db.prepare(
  `INSERT OR IGNORE INTO bans (ip, reason, expires_at, created_at) VALUES (?, ?, ?, ?)`
);

const stmtDeleteBan = db.prepare(`DELETE FROM bans WHERE ip = ?`);

const stmtListReports = db.prepare(
  `SELECT id, reporter_ip, target_ip, reason, created_at
   FROM reports ORDER BY created_at DESC, id DESC LIMIT ?`
);

const stmtListBans = db.prepare(
  `SELECT ip, reason, expires_at, created_at FROM bans
   WHERE expires_at IS NULL OR expires_at > ?
   ORDER BY created_at DESC`
);

const stmtStartSession = db.prepare(
  `INSERT INTO sessions (ip, started_at) VALUES (?, ?)`
);

const stmtEndSession = db.prepare(
  `UPDATE sessions SET ended_at = ?, pairs_formed = ? WHERE id = ?`
);

const stmtDeleteReportsByIp = db.prepare(
  `DELETE FROM reports WHERE target_ip = ? OR reporter_ip = ?`
);

const stmtDeleteReportsOlderThan = db.prepare(
  `DELETE FROM reports WHERE created_at < ?`
);

// --- Exported API ----------------------------------------------------------
export function logReport({ reporter_ip, target_ip, target_fingerprint, reason }) {
  stmtInsertReport.run(
    reporter_ip || null,
    target_ip || null,
    target_fingerprint || null,
    reason ? String(reason).slice(0, 500) : null,
    Date.now()
  );
}

export function getRecentReportCountAgainst(target_ip, sinceMs) {
  const row = stmtCountRecentReports.get(target_ip, sinceMs);
  return row ? row.cnt : 0;
}

export function isBanned(ip) {
  if (!ip) return null;
  const row = stmtGetBan.get(ip);
  if (!row) return null;
  // Respect expires_at: null = permanent, otherwise must be > now
  if (row.expires_at !== null && row.expires_at !== undefined && row.expires_at <= Date.now()) {
    return null;
  }
  return row;
}

export function addBan({ ip, reason, expires_at }) {
  stmtInsertBan.run(
    ip,
    reason || null,
    expires_at ?? null,
    Date.now()
  );
}

export function removeBan(ip) {
  const result = stmtDeleteBan.run(ip);
  return result.changes > 0;
}

export function listReports(limit = 100) {
  return stmtListReports.all(limit);
}

export function listBans() {
  return stmtListBans.all(Date.now());
}

export function startSession(ip) {
  const result = stmtStartSession.run(ip || null, Date.now());
  return Number(result.lastInsertRowid);
}

export function endSession(id, pairsFormed) {
  if (!id) return;
  stmtEndSession.run(Date.now(), pairsFormed | 0, id);
}

export function deleteReportsForIp(ip) {
  if (!ip) return 0;
  const result = stmtDeleteReportsByIp.run(ip, ip);
  return result.changes;
}

export function purgeReportsOlderThanMs(cutoffMs) {
  const result = stmtDeleteReportsOlderThan.run(cutoffMs);
  return result.changes;
}
