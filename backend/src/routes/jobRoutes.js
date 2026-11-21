const express = require('express');
const { queueManager } = require('../queues/queueManager');
const { mockWhatsApp } = require('../services/whatsappMock');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { ROLES } = require('../auth/identities');

const router = express.Router();

/**
 * GET /api/jobs/stats
 * Real-time queue health & metrics (active, waiting, completed, failed)
 */
router.get('/stats', (req, res) => {
  return res.status(200).json(queueManager.getAllStats());
});

/**
 * GET /api/jobs/deliveries
 * WhatsApp delivery attempt logs and audit trail
 */
router.get('/deliveries', (req, res) => {
  const logs = mockWhatsApp.getDeliveryLogs();
  return res.status(200).json({
    totalAttempts: logs.length,
    deliveries: logs
  });
});

/**
 * GET /api/jobs/:queueName/:jobId
 * Inspect specific background job status and retry history
 */
router.get('/:queueName/:jobId', (req, res) => {
  const { queueName, jobId } = req.params;
  const queue = queueManager.getQueue(queueName);

  if (!queue) {
    return res.status(404).json({
      error: 'QUEUE_NOT_FOUND',
      message: `Queue '${queueName}' not found. Available: [issuance, whatsapp, sla]`
    });
  }

  const job = queue.getJob(jobId);
  if (!job) {
    return res.status(404).json({
      error: 'JOB_NOT_FOUND',
      message: `Job '${jobId}' not found in queue '${queueName}'.`
    });
  }

  return res.status(200).json({ job });
});

/**
 * POST /api/jobs/trigger-sla-check
 * Trigger delayed-batch SLA escalation check
 */
router.post('/trigger-sla-check', async (req, res) => {
  const thresholdHours = req.body.thresholdHours || 48;
  const job = await queueManager.getQueue('sla').add('check-stuck-batches', { thresholdHours });

  return res.status(202).json({
    message: 'Delayed-batch SLA alert check queued.',
    jobId: job.id,
    status: job.status
  });
});

module.exports = router;
