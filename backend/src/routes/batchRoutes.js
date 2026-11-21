const express = require('express');
const { ROLES } = require('../auth/identities');
const { authenticateToken, requireRole, enforceBatchScope } = require('../middleware/auth');
const { dataStore } = require('../store/dataStore');
const { validateCandidateCsv } = require('../services/csvValidator');

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
  const candidates = dataStore.getCandidatesForBatch(req.batch.id);
  return res.status(200).json({
    batch: req.batch,
    candidates
  });
});

/**
 * GET /api/batches/:id/candidates
 * Fetch candidate roster for a batch
 */
router.get('/:id/candidates', authenticateToken, enforceBatchScope, (req, res) => {
  const candidates = dataStore.getCandidatesForBatch(req.batch.id);
  return res.status(200).json({
    batchId: req.batch.id,
    count: candidates.length,
    candidates
  });
});

/**
 * POST /api/batches
 * Create new batch metadata (Training Centre only)
 */
router.post('/', authenticateToken, requireRole(ROLES.TRAINING_CENTRE), (req, res) => {
  const { courseName, candidateCount } = req.body;

  if (!courseName || courseName.trim().length === 0) {
    return res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: 'courseName is required.'
    });
  }

  const newBatch = {
    id: `batch-${Date.now()}`,
    batchNumber: `BATCH-2026-${Math.floor(100 + Math.random() * 900)}`,
    courseName: courseName.trim(),
    candidateCount: Number(candidateCount) || 0,
    centreId: req.user.centreId,
    centreName: req.user.centreName,
    districtId: req.user.districtId,
    districtName: req.user.districtName,
    status: 'DRAFT',
    districtApprovals: [],
    cycleCount: 1,
    validationErrors: [],
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
 * POST /api/batches/upload-csv
 * Atomic CSV import to create a new batch with candidates (Training Centre only)
 */
router.post('/upload-csv', authenticateToken, requireRole(ROLES.TRAINING_CENTRE), (req, res) => {
  const { courseName, csvContent } = req.body;

  if (!courseName || courseName.trim().length === 0) {
    return res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: 'courseName is required.'
    });
  }

  const batchId = `batch-${Date.now()}`;
  const batchNumber = `BATCH-2026-${Math.floor(100 + Math.random() * 900)}`;

  // Run all-or-nothing validation
  const validation = validateCandidateCsv(csvContent);

  const newBatch = {
    id: batchId,
    batchNumber,
    courseName: courseName.trim(),
    centreId: req.user.centreId,
    centreName: req.user.centreName,
    districtId: req.user.districtId,
    districtName: req.user.districtName,
    candidateCount: validation.isValid ? validation.candidates.length : 0,
    status: validation.isValid ? 'DRAFT' : 'NEEDS_CORRECTION',
    districtApprovals: [],
    cycleCount: 1,
    validationErrors: validation.errors,
    createdAt: new Date().toISOString()
  };

  dataStore.batches.push(newBatch);

  if (!validation.isValid) {
    dataStore.logAudit(req.user, 'CSV_UPLOAD_FAILED', 'BATCH', newBatch.id, {
      errorsCount: validation.errors.length
    });

    return res.status(422).json({
      success: false,
      error: 'SPREADSHEET_VALIDATION_FAILED',
      message: `CSV validation failed with ${validation.errors.length} error(s). No candidate records were committed.`,
      batchId: newBatch.id,
      status: newBatch.status,
      totalRows: validation.totalRows,
      errorCount: validation.errors.length,
      errors: validation.errors
    });
  }

  // Atomically commit all candidates
  const committedCandidates = dataStore.setCandidatesForBatch(newBatch.id, validation.candidates);

  dataStore.logAudit(req.user, 'CSV_UPLOAD_SUCCESS', 'BATCH', newBatch.id, {
    candidateCount: committedCandidates.length
  });

  return res.status(201).json({
    success: true,
    message: `Successfully validated and imported ${committedCandidates.length} candidate(s). Batch is in DRAFT state.`,
    batch: newBatch,
    candidatesCount: committedCandidates.length
  });
});

/**
 * PUT /api/batches/:id/upload-csv
 * Re-upload CSV for an existing batch (fix errors or update draft)
 */
router.put(
  '/:id/upload-csv',
  authenticateToken,
  requireRole(ROLES.TRAINING_CENTRE),
  enforceBatchScope,
  (req, res) => {
    const batch = req.batch;
    const { csvContent } = req.body;

    const allowedStates = ['DRAFT', 'NEEDS_CORRECTION', 'SENT_BACK'];
    if (!allowedStates.includes(batch.status)) {
      return res.status(400).json({
        error: 'INVALID_BATCH_STATE',
        message: `Cannot replace candidate roster when batch status is '${batch.status}'. Allowed states: [${allowedStates.join(', ')}]`
      });
    }

    const validation = validateCandidateCsv(csvContent);

    if (!validation.isValid) {
      batch.status = 'NEEDS_CORRECTION';
      batch.validationErrors = validation.errors;
      // All-or-nothing: do NOT change existing candidate roster on failure

      dataStore.logAudit(req.user, 'CSV_REUPLOAD_FAILED', 'BATCH', batch.id, {
        errorsCount: validation.errors.length
      });

      return res.status(422).json({
        success: false,
        error: 'SPREADSHEET_VALIDATION_FAILED',
        message: `CSV validation failed with ${validation.errors.length} error(s). No candidate records were updated.`,
        batchId: batch.id,
        status: batch.status,
        totalRows: validation.totalRows,
        errorCount: validation.errors.length,
        errors: validation.errors
      });
    }

    // Atomically overwrite candidates
    const committedCandidates = dataStore.setCandidatesForBatch(batch.id, validation.candidates);
    batch.candidateCount = committedCandidates.length;
    batch.status = 'DRAFT';
    batch.validationErrors = [];

    dataStore.logAudit(req.user, 'CSV_REUPLOAD_SUCCESS', 'BATCH', batch.id, {
      candidateCount: committedCandidates.length
    });

    return res.status(200).json({
      success: true,
      message: `Successfully updated roster with ${committedCandidates.length} candidate(s). Batch is now DRAFT.`,
      batch,
      candidatesCount: committedCandidates.length
    });
  }
);

/**
 * POST /api/batches/:id/submit
 * Submit batch for District Review
 */
router.post(
  '/:id/submit',
  authenticateToken,
  requireRole(ROLES.TRAINING_CENTRE),
  enforceBatchScope,
  (req, res) => {
    const batch = req.batch;

    if (batch.status === 'NEEDS_CORRECTION') {
      return res.status(400).json({
        error: 'CANNOT_SUBMIT',
        message: 'Cannot submit a batch in NEEDS_CORRECTION state. Fix all validation errors first.'
      });
    }

    if (batch.candidateCount === 0) {
      return res.status(400).json({
        error: 'CANNOT_SUBMIT',
        message: 'Cannot submit an empty batch. Upload a valid candidate roster first.'
      });
    }

    const allowableStates = ['DRAFT', 'SENT_BACK'];
    if (!allowableStates.includes(batch.status)) {
      return res.status(400).json({
        error: 'INVALID_BATCH_STATE',
        message: `Cannot submit batch in '${batch.status}' state.`
      });
    }

    if (batch.status === 'SENT_BACK') {
      batch.cycleCount += 1;
      batch.districtApprovals = []; // Reset approvals on resubmission
    }

    batch.status = 'PENDING_DISTRICT';
    batch.submittedAt = new Date().toISOString();

    dataStore.logAudit(req.user, 'SUBMIT_BATCH', 'BATCH', batch.id, {
      cycleCount: batch.cycleCount,
      candidateCount: batch.candidateCount
    });

    return res.status(200).json({
      message: 'Batch submitted for District Officer review.',
      batch
    });
  }
);

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
