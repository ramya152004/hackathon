const express = require('express');
const { DEMO_USERS } = require('../auth/identities');
const { signToken } = require('../auth/jwt');
const { authenticateToken } = require('../middleware/auth');
const loginLimiter = require('../middleware/loginLimiter');
const { hashPassword, verifyPassword } = require('../auth/password');

// Compared against when the username doesn't exist (keeps timing the same).
const DUMMY_HASH = hashPassword('not-a-real-password');

const router = express.Router();

/**
 * POST /api/auth/login
 * Body: { username, password }. Demo users: anika, dev, meera, kabir, neha, farah
 */
router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || !password) {
    return res.status(400).json({
      error: 'MISSING_CREDENTIALS',
      message: 'Please provide both username and password.'
    });
  }

  const normalized = username.toLowerCase().trim();
  const limiterKey = loginLimiter.keyFor(req, normalized);

  const lock = loginLimiter.check(limiterKey);
  if (lock.locked) {
    res.set('Retry-After', String(lock.retryAfterSeconds));
    return res.status(429).json({
      error: 'TOO_MANY_ATTEMPTS',
      message: `Too many failed attempts. Try again in ${Math.ceil(lock.retryAfterSeconds / 60)} minute(s).`
    });
  }

  // hasOwnProperty: so names like "constructor" or "__proto__" are not treated as users.
  const identity = Object.prototype.hasOwnProperty.call(DEMO_USERS, normalized)
    ? DEMO_USERS[normalized]
    : null;

  // Always run one hash check, even for unknown users, so response time doesn't reveal who exists.
  const passwordOk = await verifyPassword(password, identity ? identity.passwordHash : DUMMY_HASH);

  if (!identity || !passwordOk) {
    loginLimiter.recordFailure(limiterKey);
    // Same message for "no such user" and "wrong password".
    return res.status(401).json({
      error: 'INVALID_CREDENTIALS',
      message: 'Wrong username or password.'
    });
  }

  loginLimiter.clear(limiterKey);

  const tokenPayload = {
    sub: identity.id,
    username: identity.username,
    name: identity.name,
    role: identity.role,
    centreId: identity.centreId || null,
    centreName: identity.centreName || null,
    districtId: identity.districtId || null,
    districtName: identity.districtName || null,
    scope: identity.scope || null
  };

  const token = signToken(tokenPayload);

  return res.status(200).json({
    token,
    user: tokenPayload
  });
});

/**
 * GET /api/auth/me
 * Returns current authenticated profile
 */
router.get('/me', authenticateToken, (req, res) => {
  return res.status(200).json({
    user: req.user
  });
});

/**
 * GET /api/auth/identities
 * Returns available demo personas for UI switching
 */
router.get('/identities', (req, res) => {
  const list = Object.values(DEMO_USERS).map((u) => ({
    username: u.username,
    name: u.name,
    role: u.role,
    district: u.districtName || 'State-wide',
    centre: u.centreName || 'N/A'
  }));

  return res.status(200).json({ identities: list });
});

module.exports = router;
