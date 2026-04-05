// Moderation layer: report handling + auto-ban rule + ban checks.

import {
  logReport,
  getRecentReportCountAgainst,
  isBanned,
  addBan,
} from "./db.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const BAN_DURATION_MS = 7 * DAY_MS;
const REPORT_THRESHOLD = 3;

export function handleReport({ reporter_ip, target_ip, target_fingerprint, reason }) {
  // Log the report first
  logReport({ reporter_ip, target_ip, target_fingerprint, reason });

  if (!target_ip) return { banned: false };

  // If already banned, do nothing (don't extend).
  const existing = isBanned(target_ip);
  if (existing) {
    return { banned: false };
  }

  // Count reports against this target in the last 24h
  const since = Date.now() - DAY_MS;
  const count = getRecentReportCountAgainst(target_ip, since);

  if (count >= REPORT_THRESHOLD) {
    const expires_at = Date.now() + BAN_DURATION_MS;
    addBan({
      ip: target_ip,
      reason: `auto-ban: ${count} reports in 24h`,
      expires_at,
    });
    return { banned: true, expires_at };
  }

  return { banned: false };
}

export function checkBan(ip) {
  const row = isBanned(ip);
  if (!row) return { banned: false };
  return {
    banned: true,
    reason: row.reason,
    expires_at: row.expires_at,
  };
}
