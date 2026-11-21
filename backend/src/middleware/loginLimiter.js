// Brute-force protection: lock a (ip + username) pair after too many FAILED logins.
// In-memory on purpose (simple to explain). With several API instances this
// should move to Redis so all instances share the counters (see README).
const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000;

const failures = new Map(); // key -> { count, firstAt }

function keyFor(req, username) {
  // Not req.ip: it needs a real socket. This works in tests and in production.
  const ip = (req.socket && req.socket.remoteAddress) || 'unknown';
  return `${ip}|${username}`;
}

function check(key, now = Date.now()) {
  const entry = failures.get(key);
  if (!entry) return { locked: false };
  if (now - entry.firstAt > WINDOW_MS) {
    failures.delete(key);
    return { locked: false };
  }
  if (entry.count >= MAX_FAILURES) {
    return { locked: true, retryAfterSeconds: Math.ceil((WINDOW_MS - (now - entry.firstAt)) / 1000) };
  }
  return { locked: false };
}

function recordFailure(key, now = Date.now()) {
  const entry = failures.get(key);
  if (!entry || now - entry.firstAt > WINDOW_MS) {
    failures.set(key, { count: 1, firstAt: now });
  } else {
    entry.count += 1;
  }
}

function clear(key) {
  failures.delete(key);
}

function reset() {
  failures.clear();
}

module.exports = { keyFor, check, recordFailure, clear, reset, MAX_FAILURES, WINDOW_MS };
