const express = require('express');
const { ROLES } = require('../auth/identities');
const { authenticateToken, requireRole, enforceBatchScope } = require('../middleware/auth');
const { dataStore } = require('../store/dataStore');

const router = express.Router();

/**
 * GET /api/batches
 * Returns batches scoped to the user's role and tenant/district
 */
router.get('/', authenticateToken, (req, res) => {
  const { role, centreId, districtId } = req.user;

  let visibleBatches = [];

  if (role === ROLES.TRAINING_CENTRE) {
    visibleBatches = dataStore.batches.filter((b) => b.centreId === centreId);
  } else if (role === ROLES.DISTRICT_OFFICER) {
    visibleBatches = dataStore.batches.filter((b) => b.districtId === districtId);
  } else if (role === ROLES.QUALITY_TEAM) {
    visibleBatches = dataStore.batches.filter((b) => b.candidateCount > 50);
  } else if (role === ROLES.STATE_OFFICE) {
    visibleBatches = [...dataStore.batches];
  }

  return res.status(200).json({
    count: visibleBatches.length,
    batches: visibleBatches
  });
});

/**
 * GET /api/batches/:id
 * Fetch single batch details (enforces centre/district scope)
 */
router.get('/:id', authenticateToken, enforceBatchScope, (req, res) => {
  return res.status(200).json({ batch: req.batch });
});

/**
 * POST /api/batches
 * Create new batch (Training Centre only, automatically bound to own centre & district)
 */
router.post('/', authenticateToken, requireRole(ROLES.TRAINING_CENTRE), (req, res) => {
  const { courseName, candidateCount } = req.body;

  if (!courseName || !candidateCount) {
    return res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: 'courseName and candidateCount are required.'
    });
  }

  const newBatch = {
    id: `batch-${Date.now()}`,
    batchNumber: `BATCH-2026-${Math.floor(100 + Math.random() * 900)}`,
    courseName,
    candidateCount: Number(candidateCount),
    centreId: req.user.centreId,
    centreName: req.user.centreName,
    districtId: req.user.districtId,
    districtName: req.user.districtName,
    status: 'DRAFT',
    districtApprovals: [],
    cycleCount: 1,
    createdAt: new Date().toISOString()
  };

  dataStore.batches.push(newBatch);
  dataStore.logAudit(req.user, 'CREATE_BATCH', 'BATCH', newBatch.id);

  return res.status(201).json({
    message: 'Batch created successfully',
    batch: newBatch
  });
});

/**
 * POST /api/batches/:id/district-approve
 * District Officer Approval (Requires 2 distinct officers in the district)
 */
router.post(
  '/:id/district-approve',
  authenticateToken,
  requireRole(ROLES.DISTRICT_OFFICER),
  enforceBatchScope,
  (req, res) => {
    const batch = req.batch;
    const officerId = req.user.sub;

    if (batch.districtApprovals.includes(officerId)) {
      return res.status(409).json({
        error: 'DUPLICATE_APPROVAL',
        message: 'You have already approved this batch in the current cycle.'
      });
    }

    batch.districtApprovals.push(officerId);
    dataStore.logAudit(req.user, 'DISTRICT_APPROVE', 'BATCH', batch.id);

    // Multi-officer consensus logic:
    if (batch.districtApprovals.length === 1) {
      batch.status = 'DISTRICT_PARTIAL_APPROVED';
      return res.status(200).json({
        message: 'First district approval recorded. Awaiting second officer.',
        approvalsCount: 1,
        approvalsRequired: 2,
        batch
      });
    }

    // 2 distinct approvals reached:
    if (batch.candidateCount > 50) {
      batch.status = 'PENDING_QUALITY';
    } else {
      batch.status = 'PENDING_STATE';
    }

    return res.status(200).json({
      message: 'District consensus reached (2/2 approvals). Batch advanced.',
      approvalsCount: 2,
      approvalsRequired: 2,
      batch
    });
  }
);

/**
 * POST /api/batches/:id/quality-approve
 * Quality Team Approval (Batches > 50 candidates)
 */
router.post(
  '/:id/quality-approve',
  authenticateToken,
  requireRole(ROLES.QUALITY_TEAM),
  enforceBatchScope,
  (req, res) => {
    const batch = req.batch;
    batch.status = 'PENDING_STATE';
    dataStore.logAudit(req.user, 'QUALITY_APPROVE', 'BATCH', batch.id);

    return res.status(200).json({
      message: 'Quality team approved. Advanced to State Office.',
      batch
    });
  }
);

/**
 * POST /api/batches/:id/final-approve
 * State Office Final Approval
 */
router.post(
  '/:id/final-approve',
  authenticateToken,
  requireRole(ROLES.STATE_OFFICE),
  enforceBatchScope,
  (req, res) => {
    const batch = req.batch;
    batch.status = 'APPROVED';
    dataStore.logAudit(req.user, 'STATE_FINAL_APPROVE', 'BATCH', batch.id);

    return res.status(200).json({
      message: 'State final approval granted. Certificate issuance triggered.',
      batch
    });
  }
);

module.exports = router;
