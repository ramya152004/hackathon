const express = require('express');
const { DEMO_USERS } = require('../auth/identities');
const { signToken } = require('../auth/jwt');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

/**
 * POST /api/auth/login
 * Log in as one of the demo identities: anika, dev, meera, kabir, neha, farah
 */
router.post('/login', (req, res) => {
  const { username } = req.body;
  if (!username) {
    return res.status(400).json({
      error: 'MISSING_USERNAME',
      message: 'Please provide username (e.g., anika, dev, meera, kabir, neha, farah)'
    });
  }

  const normalized = username.toLowerCase().trim();
  const identity = DEMO_USERS[normalized];

  if (!identity) {
    return res.status(401).json({
      error: 'INVALID_CREDENTIALS',
      message: `Unknown demo identity '${username}'. Available: ${Object.keys(DEMO_USERS).join(', ')}`
    });
  }

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
