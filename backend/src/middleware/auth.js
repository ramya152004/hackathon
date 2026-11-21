const { verifyToken } = require('../auth/jwt');
const { ROLES } = require('../auth/identities');
const { dataStore } = require('../store/dataStore');

/**
 * Middleware: Verify Bearer JWT and attach user to req.user
 */
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    return res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'Authentication required. Authorization header missing.'
    });
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return res.status(401).json({
      error: 'MALFORMED_AUTHORIZATION_HEADER',
      message: 'Expected format: Bearer <token>'
    });
  }

  const token = parts[1];
  try {
    const decoded = verifyToken(token);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({
      error: 'INVALID_TOKEN',
      message: err.message
    });
  }
}

/**
 * Middleware: Enforce Role-Based Access Control
 */
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      return res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'User authentication missing.'
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: 'FORBIDDEN_ROLE',
        message: `Role '${req.user.role}' is not authorized. Required: [${allowedRoles.join(', ')}]`
      });
    }

    next();
  };
}

/**
 * Middleware: Enforce Centre, District, and Quality Scopes on Batches
 */
function enforceBatchScope(req, res, next) {
  const batchId = req.params.id;
  const batch = dataStore.findBatchById(batchId);

  if (!batch) {
    return res.status(404).json({
      error: 'BATCH_NOT_FOUND',
      message: `Batch '${batchId}' not found.`
    });
  }

  const { role, centreId, districtId } = req.user;

  // 1. Training Centre Scope: strict isolation by centreId
  if (role === ROLES.TRAINING_CENTRE) {
    if (batch.centreId !== centreId) {
      return res.status(403).json({
        error: 'TENANT_ACCESS_DENIED',
        message: 'Access denied: You cannot view or modify another training centre\'s batch.'
      });
    }
  }

  // 2. District Officer Scope: strict isolation by districtId
  if (role === ROLES.DISTRICT_OFFICER) {
    if (batch.districtId !== districtId) {
      return res.status(403).json({
        error: 'DISTRICT_ACCESS_DENIED',
        message: 'Access denied: You cannot view or act on batches outside your assigned district.'
      });
    }
  }

  // 3. Quality Team Scope: only inspects high-volume batches (> 50 candidates)
  if (role === ROLES.QUALITY_TEAM) {
    if (batch.candidateCount <= 50) {
      return res.status(403).json({
        error: 'QUALITY_SCOPE_DENIED',
        message: 'Access denied: Quality team scrutiny is only applicable to batches exceeding 50 candidates.'
      });
    }
  }

  // 4. State Office: Global scope, passes through

  req.batch = batch;
  next();
}

module.exports = {
  authenticateToken,
  requireRole,
  enforceBatchScope
};
