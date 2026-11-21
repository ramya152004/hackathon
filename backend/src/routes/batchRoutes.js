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
 * Fetch single batch details including candidate roster and audit history
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
    auditHistory: [],
    createdAt: new Date().toISOString()
  };

  dataStore.batches.push(newBatch);
  dataStore.recordBatchAudit(newBatch, req.user, 'CREATE_BATCH');

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
    auditHistory: [],
    createdAt: new Date().toISOString()
  };

  dataStore.batches.push(newBatch);

  if (!validation.isValid) {
    dataStore.recordBatchAudit(newBatch, req.user, 'CSV_UPLOAD_FAILED', `${validation.errors.length} validation errors`);

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

  const committedCandidates = dataStore.setCandidatesForBatch(newBatch.id, validation.candidates);
  dataStore.recordBatchAudit(newBatch, req.user, 'CSV_UPLOAD_SUCCESS', `Imported ${committedCandidates.length} candidates`);

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
      dataStore.recordBatchAudit(batch, req.user, 'CSV_REUPLOAD_FAILED', `${validation.errors.length} validation errors`);

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

    const committedCandidates = dataStore.setCandidatesForBatch(batch.id, validation.candidates);
    batch.candidateCount = committedCandidates.length;
    batch.status = 'DRAFT';
    batch.validationErrors = [];
    dataStore.recordBatchAudit(batch, req.user, 'CSV_REUPLOAD_SUCCESS', `Updated with ${committedCandidates.length} candidates`);

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
 * Submit or resubmit batch for District Review
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

    // Policy for resubmitted batch: increment cycle revision and reset approvals
    if (batch.status === 'SENT_BACK') {
      batch.cycleCount += 1;
      batch.districtApprovals = [];
    }

    batch.status = 'PENDING_DISTRICT';
    batch.submittedAt = new Date().toISOString();

    dataStore.recordBatchAudit(
      batch,
      req.user,
      'SUBMIT_BATCH',
      batch.status === 'SENT_BACK' ? `Resubmitted for review (Revision ${batch.cycleCount})` : 'Initial submission'
    );

    return res.status(200).json({
      message: 'Batch submitted for District Officer review.',
      batch
    });
  }
);

/**
 * Internal Decision Handler (Core State Machine & Concurrency Control)
 */
async function handleDecision(req, res) {
  const batchId = req.params.id;
  const { action, reason } = req.body;
  const actor = req.user;

  if (!action || !['APPROVE', 'REJECT', 'RETURN_FOR_CORRECTION'].includes(action)) {
    return res.status(400).json({
      error: 'INVALID_ACTION',
      message: "Action must be one of: 'APPROVE', 'REJECT', 'RETURN_FOR_CORRECTION'"
    });
  }

  // Mandatory reason for REJECT and RETURN_FOR_CORRECTION
  if (['REJECT', 'RETURN_FOR_CORRECTION'].includes(action)) {
    if (!reason || reason.trim().length === 0) {
      return res.status(400).json({
        error: 'MISSING_REASON',
        message: `A clear reason is strictly required when executing '${action}'.`
      });
    }
  }

  // Execute within per-batch mutex lock to protect against race conditions
  return await dataStore.withBatchLock(batchId, async () => {
    const batch = dataStore.findBatchById(batchId);

    // 1. REJECT Action (Permanent)
    if (action === 'REJECT') {
      const allowableRoles = [ROLES.DISTRICT_OFFICER, ROLES.QUALITY_TEAM, ROLES.STATE_OFFICE];
      if (!allowableRoles.includes(actor.role)) {
        return res.status(403).json({
          error: 'FORBIDDEN_ROLE',
          message: 'You are not authorized to reject this batch.'
        });
      }

      batch.status = 'REJECTED';
      batch.rejectionReason = reason.trim();
      dataStore.recordBatchAudit(batch, actor, 'REJECT', reason.trim());

      return res.status(200).json({
        message: 'Batch rejected permanently.',
        batch
      });
    }

    // 2. RETURN_FOR_CORRECTION Action
    if (action === 'RETURN_FOR_CORRECTION') {
      const allowableRoles = [ROLES.DISTRICT_OFFICER, ROLES.QUALITY_TEAM, ROLES.STATE_OFFICE];
      if (!allowableRoles.includes(actor.role)) {
        return res.status(403).json({
          error: 'FORBIDDEN_ROLE',
          message: 'You are not authorized to return this batch for correction.'
        });
      }

      batch.status = 'SENT_BACK';
      batch.returnReason = reason.trim();
      // Policy: Invalidate previous approvals on return
      batch.districtApprovals = [];

      dataStore.recordBatchAudit(batch, actor, 'RETURN_FOR_CORRECTION', reason.trim());

      return res.status(200).json({
        message: 'Batch returned to training centre for correction. Prior approvals reset.',
        batch
      });
    }

    // 3. APPROVE Action
    if (action === 'APPROVE') {
      // Stage A: District Level Approval
      if (['PENDING_DISTRICT', 'DISTRICT_PARTIAL_APPROVED'].includes(batch.status)) {
        if (actor.role !== ROLES.DISTRICT_OFFICER) {
          return res.status(403).json({
            error: 'FORBIDDEN_ROLE',
            message: 'Only District Officers can approve at this stage.'
          });
        }

        // Check if this officer already voted in this cycle
        const existingVote = batch.districtApprovals.find(
          (a) => a.officerId === actor.sub && a.cycleCount === batch.cycleCount
        );
        if (existingVote) {
          return res.status(409).json({
            error: 'DUPLICATE_APPROVAL',
            message: 'You have already approved this batch in the current revision cycle.'
          });
        }

        // Record vote
        batch.districtApprovals.push({
          officerId: actor.sub,
          officerName: actor.name,
          timestamp: new Date().toISOString(),
          cycleCount: batch.cycleCount
        });

        // First of two required approvals
        if (batch.districtApprovals.length === 1) {
          batch.status = 'DISTRICT_PARTIAL_APPROVED';
          dataStore.recordBatchAudit(batch, actor, 'DISTRICT_APPROVE_1', reason);

          return res.status(200).json({
            message: 'First district approval recorded. Awaiting second officer.',
            approvalsCount: 1,
            approvalsRequired: 2,
            batch
          });
        }

        // Second of two required approvals -> Consensus Reached!
        // Evaluate dynamic Quality Team routing rule:
        if (batch.candidateCount > 50) {
          batch.status = 'PENDING_QUALITY';
        } else {
          batch.status = 'PENDING_STATE';
        }

        dataStore.recordBatchAudit(batch, actor, 'DISTRICT_APPROVE_2', reason);

        return res.status(200).json({
          message: 'District consensus reached (2/2 approvals). Advanced to next stage.',
          approvalsCount: 2,
          approvalsRequired: 2,
          batch
        });
      }

      // Stage B: Quality Team Approval
      if (batch.status === 'PENDING_QUALITY') {
        if (actor.role !== ROLES.QUALITY_TEAM) {
          return res.status(403).json({
            error: 'FORBIDDEN_ROLE',
            message: 'This batch requires Quality Team approval before moving to State Office.'
          });
        }

        batch.status = 'PENDING_STATE';
        dataStore.recordBatchAudit(batch, actor, 'QUALITY_APPROVE', reason);

        return res.status(200).json({
          message: 'Quality team approved. Advanced to State Office.',
          batch
        });
      }

      // Stage C: State Office Final Approval
      if (batch.status === 'PENDING_STATE') {
        if (actor.role !== ROLES.STATE_OFFICE) {
          return res.status(403).json({
            error: 'FORBIDDEN_ROLE',
            message: 'Only the State Office can grant final approval.'
          });
        }

        batch.status = 'APPROVED';
        dataStore.recordBatchAudit(batch, actor, 'STATE_FINAL_APPROVE', reason);

        return res.status(200).json({
          message: 'State final approval granted. Certificate issuance pipeline initiated.',
          batch
        });
      }

      return res.status(400).json({
        error: 'INVALID_TRANSITION',
        message: `Batch in state '${batch.status}' cannot receive approval.`
      });
    }
  });
}

/**
 * POST /api/batches/:id/decision
 * Unified Server-Side State Transition Decision Endpoint
 */
router.post('/:id/decision', authenticateToken, enforceBatchScope, handleDecision);

/**
 * Route aliases for backwards compatibility
 */
router.post(
  '/:id/district-approve',
  authenticateToken,
  requireRole(ROLES.DISTRICT_OFFICER),
  enforceBatchScope,
  (req, res) => {
    req.body.action = 'APPROVE';
    return handleDecision(req, res);
  }
);

router.post(
  '/:id/quality-approve',
  authenticateToken,
  requireRole(ROLES.QUALITY_TEAM),
  enforceBatchScope,
  (req, res) => {
    req.body.action = 'APPROVE';
    return handleDecision(req, res);
  }
);

router.post(
  '/:id/final-approve',
  authenticateToken,
  requireRole(ROLES.STATE_OFFICE),
  enforceBatchScope,
  (req, res) => {
    req.body.action = 'APPROVE';
    return handleDecision(req, res);
  }
);

module.exports = router;
