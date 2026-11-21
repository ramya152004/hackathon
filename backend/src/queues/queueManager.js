const { EventEmitter } = require('node:events');
const { dataStore } = require('../store/dataStore');
const { mockWhatsApp } = require('../services/whatsappMock');
const { issueCertificatesForBatch } = require('../services/certificateService');

class Queue extends EventEmitter {
  constructor(name) {
    super();
    this.name = name;
    this.jobs = new Map(); // jobId -> Job
    this.waitingQueue = []; // array of jobIds
    this.activeWorkers = 0;
    this.maxConcurrency = 5;
    this.isPaused = false;
    this.processor = null;
  }

  process(concurrency, handler) {
    if (typeof concurrency === 'function') {
      this.processor = concurrency;
    } else {
      this.maxConcurrency = concurrency || 5;
      this.processor = handler;
    }
    this._drain();
  }

  /**
   * Adds a job with idempotency key (jobId), bounded retries, and backoff
   */
  async add(jobName, data, options = {}) {
    const jobId = options.jobId || `${this.name}-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;

    // 1. IDEMPOTENCY DEDUPLICATION:
    // If a job with this exact jobId is already completed, active, or waiting, do not duplicate
    if (this.jobs.has(jobId)) {
      const existing = this.jobs.get(jobId);
      if (['COMPLETED', 'ACTIVE', 'WAITING'].includes(existing.status)) {
        return existing;
      }
    }

    const job = {
      id: jobId,
      name: jobName,
      data,
      attempts: 0,
      maxAttempts: options.attempts || 3,
      backoff: options.backoff || { type: 'exponential', delay: 50 },
      status: 'WAITING',
      error: null,
      result: null,
      history: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    this.jobs.set(jobId, job);
    this.waitingQueue.push(jobId);

    this.emit('added', job);
    setImmediate(() => this._drain());

    return job;
  }

  getJob(jobId) {
    return this.jobs.get(jobId) || null;
  }

  getJobs() {
    return Array.from(this.jobs.values());
  }

  getStats() {
    let waiting = 0;
    let active = 0;
    let completed = 0;
    let failed = 0;

    for (const job of this.jobs.values()) {
      if (job.status === 'WAITING') waiting++;
      else if (job.status === 'ACTIVE') active++;
      else if (job.status === 'COMPLETED') completed++;
      else if (job.status === 'FAILED') failed++;
    }

    return { queue: this.name, total: this.jobs.size, waiting, active, completed, failed };
  }

  async _drain() {
    if (this.isPaused || !this.processor) return;

    while (this.activeWorkers < this.maxConcurrency && this.waitingQueue.length > 0) {
      const jobId = this.waitingQueue.shift();
      const job = this.jobs.get(jobId);
      if (!job || job.status !== 'WAITING') continue;

      this.activeWorkers++;
      this._processJob(job).finally(() => {
        this.activeWorkers--;
        this._drain();
      });
    }
  }

  async _processJob(job) {
    job.status = 'ACTIVE';
    job.attempts++;
    job.updatedAt = new Date().toISOString();

    const attemptNumber = job.attempts;
    const startTime = Date.now();

    try {
      this.emit('active', job);
      const result = await this.processor(job);

      job.status = 'COMPLETED';
      job.result = result;
      job.error = null;
      job.updatedAt = new Date().toISOString();
      job.history.push({
        attempt: attemptNumber,
        status: 'SUCCESS',
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString()
      });

      this.emit('completed', job, result);
    } catch (err) {
      const durationMs = Date.now() - startTime;
      job.history.push({
        attempt: attemptNumber,
        status: 'FAILED',
        error: err.message,
        durationMs,
        timestamp: new Date().toISOString()
      });

      // Bounded retry with exponential backoff
      if (job.attempts < job.maxAttempts) {
        job.status = 'WAITING';
        job.error = err.message;
        job.updatedAt = new Date().toISOString();

        const delay = job.backoff.delay * Math.pow(2, job.attempts - 1);
        this.emit('retry', job, err, delay);

        setTimeout(() => {
          this.waitingQueue.push(job.id);
          this._drain();
        }, delay);
      } else {
        job.status = 'FAILED';
        job.error = err.message;
        job.updatedAt = new Date().toISOString();
        this.emit('failed', job, err);
      }
    }
  }
}

class QueueManager {
  constructor() {
    this.reset();
  }

  reset() {
    this.queues = {
      issuance: new Queue('certificate-issuance'),
      whatsapp: new Queue('whatsapp-delivery'),
      sla: new Queue('delayed-batch-alerts')
    };

    mockWhatsApp.reset();
    this._setupWorkers();
  }

  _setupWorkers() {
    // 1. Worker: Certificate Issuance & Dispatch Queue
    this.queues.issuance.process(2, async (job) => {
      const { batchId, actor, baseUrl } = job.data;
      const certificates = await issueCertificatesForBatch(batchId, actor, baseUrl);

      // Fan-out: Enqueue background WhatsApp delivery for each issued certificate
      for (const cert of certificates) {
        const downloadUrl = `${baseUrl}/api/certificates/${cert.certificateNumber}/download?code=${cert.verificationCode}`;

        await this.queues.whatsapp.add(
          'send-whatsapp-certificate',
          {
            certificateNumber: cert.certificateNumber,
            recipientPhone: cert.phone,
            candidateName: cert.candidateName,
            pdfDownloadUrl: downloadUrl,
            idempotencyKey: `wa-deliv-${cert.certificateNumber}`
          },
          {
            jobId: `wa-deliv-${cert.certificateNumber}`, // Idempotent key
            attempts: 4,
            backoff: { type: 'exponential', delay: 40 }
          }
        );
      }

      return { batchId, issuedCount: certificates.length };
    });

    // 2. Worker: Mock WhatsApp Delivery with Bounded Retries
    this.queues.whatsapp.process(3, async (job) => {
      const { recipientPhone, certificateNumber, candidateName, pdfDownloadUrl, idempotencyKey } = job.data;

      const receipt = await mockWhatsApp.sendMessage({
        recipientPhone,
        certificateNumber,
        candidateName,
        pdfDownloadUrl,
        idempotencyKey
      });

      return receipt;
    });

    // 3. Worker: Delayed-Batch Alerts (SLA Escalation)
    this.queues.sla.process(1, async (job) => {
      const thresholdHours = (job.data && job.data.thresholdHours) || 48;
      const now = Date.now();
      const thresholdMs = thresholdHours * 60 * 60 * 1000;

      const inReviewStatuses = [
        'PENDING_DISTRICT',
        'DISTRICT_PARTIAL_APPROVED',
        'PENDING_QUALITY',
        'PENDING_STATE'
      ];

      const stuckBatches = [];

      for (const batch of dataStore.batches) {
        if (inReviewStatuses.includes(batch.status)) {
          const submittedTime = new Date(batch.submittedAt || batch.createdAt).getTime();
          const elapsedMs = now - submittedTime;

          if (elapsedMs > thresholdMs) {
            batch.isStuck = true;
            batch.stuckHours = Math.round(elapsedMs / (1000 * 60 * 60));
            stuckBatches.push({
              batchId: batch.id,
              batchNumber: batch.batchNumber,
              status: batch.status,
              stuckHours: batch.stuckHours
            });
          }
        }
      }

      return { checkedAt: new Date().toISOString(), stuckCount: stuckBatches.length, stuckBatches };
    });
  }

  getQueue(name) {
    return this.queues[name];
  }

  getAllStats() {
    return {
      issuance: this.queues.issuance.getStats(),
      whatsapp: this.queues.whatsapp.getStats(),
      sla: this.queues.sla.getStats()
    };
  }
}

const queueManager = new QueueManager();

module.exports = {
  queueManager,
  Queue
};
