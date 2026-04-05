// Simple in-memory per-key rate limiter.

export function createRateLimiter(minIntervalMs = 2000) {
  const lastSeen = new Map();
  const CLEANUP_MAX_AGE_MS = 60_000;
  // Only sweep once the map exceeds this size — avoids O(n) work on every
  // event when the server is idle or lightly loaded.
  const CLEANUP_THRESHOLD = 256;

  return function allow(key) {
    const now = Date.now();

    if (lastSeen.size > CLEANUP_THRESHOLD) {
      for (const [k, ts] of lastSeen) {
        if (now - ts > CLEANUP_MAX_AGE_MS) lastSeen.delete(k);
      }
    }

    const last = lastSeen.get(key);
    if (last !== undefined && now - last < minIntervalMs) {
      return false;
    }
    lastSeen.set(key, now);
    return true;
  };
}
