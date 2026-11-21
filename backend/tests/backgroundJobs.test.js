const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { EventEmitter } = require('node:events');
const app = require('../src/app');
const { dataStore } = require('../src/store/dataStore');
const { queueManager } = require('../src/queues/queueManager');
const { mockWhatsApp } = require('../src/services/whatsappMock');

// In-Memory HTTP Dispatcher
function api(method, url, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : '';
    const req = Readable.from(bodyStr ? [bodyStr] : []);
    req.method = method.toUpperCase();
    req.url = url;
    req.connection = { encrypted: false };
    req.protocol = 'http';
    req.headers = {
      host: 'localhost:3000',
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(bodyStr),
      ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
    };
    req.get = (name) => req.headers[name.toLowerCase()];

    const res = new EventEmitter();
    res.statusCode = 200;
    res._headers = {};
    res.setHeader = (k, v) => {
      res._headers[k.toLowerCase()] = v;
    };
    res.getHeader = (k) => res._headers[k.toLowerCase()];
    res.status = (code) => {
      res.statusCode = code;
      return res;
    };

    let chunks = [];
    res.write = (c) => {
      if (c) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
      return true;
    };
    res.end = (c) => {
      if (c) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
      const resBody = Buffer.concat(chunks);
      let parsed;
      try {
        parsed = JSON.parse(resBody.toString('utf8'));
      } catch {
        parsed = resBody.toString('utf8');
      }
      resolve({ status: res.statusCode, data: parsed, buffer: resBody, headers: res._headers });
    };
    res.json = (json) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(json));
    };
    res.send = (data) => {
      if (typeof data === 'object' && !Buffer.isBuffer(data)) return res.json(data);
      res.end(data);
    };

    app(req, res, (err) => {
      if (err) reject(err);
      else resolve({ status: 404, data: { error: 'NOT_FOUND' } });
    });
  });
}

// Token helper
async function getToken(username) {
  const res = await api('POST', '/api/auth/login', { body: { username } });
  assert.equal(res.status, 200);
  return res.data.token;
}

// Helper to wait for job completion
function waitForJob(queue, jobId, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const job = queue.getJob(jobId);
    if (job && (job.status === 'COMPLETED' || job.status === 'FAILED')) {
      return resolve(job);
    }

    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for job ${jobId} (current status: ${job ? job.status : 'null'})`));
    }, timeoutMs);

    const onComplete = (j) => {
      if (j.id === jobId) {
        clearTimeout(timer);
        cleanup();
        resolve(j);
      }
    };
    const onFailed = (j) => {
      if (j.id === jobId) {
        clearTimeout(timer);
        cleanup();
        resolve(j);
      }
    };

    function cleanup() {
      queue.removeListener('completed', onComplete);
      queue.removeListener('failed', onFailed);
    }

    queue.on('completed', onComplete);
    queue.on('failed', onFailed);
  });
}

describe('CertiFlow Redis + BullMQ Background Job & Mock WhatsApp Suite', () => {
  beforeEach(() => {
    dataStore.reset();
    queueManager.reset();
  });

  test('1. Bounded retries & backoff: Transient WhatsApp failure triggers retry and eventual success', async () => {
    mockWhatsApp.setFailureMode('FAIL_ONCE');
    const waQueue = queueManager.getQueue('whatsapp');

    const job = await waQueue.add(
      'send-whatsapp-test',
      {
        certificateNumber: 'PRAGATI-2026-TEST-0001',
        recipientPhone: '9876543210',
        candidateName: 'Test Candidate',
        pdfDownloadUrl: 'http://localhost:3000/download/1',
        idempotencyKey: 'wa-idemp-retry-test'
      },
      {
        jobId: 'wa-job-retry-test',
        attempts: 3,
        backoff: { type: 'exponential', delay: 30 }
      }
    );

    const completedJob = await waitForJob(waQueue, job.id);
    assert.equal(completedJob.status, 'COMPLETED');
    assert.equal(completedJob.attempts, 2, 'Should succeed on attempt 2 after 1 retry');
    assert.equal(completedJob.history.length, 2);
    assert.equal(completedJob.history[0].status, 'FAILED');
    assert.equal(completedJob.history[1].status, 'SUCCESS');
  });

  test('2. Idempotency Keys: Duplicate delivery jobs cannot cause duplicate messages', async () => {
    mockWhatsApp.setFailureMode('ALWAYS_SUCCESS');
    const waQueue = queueManager.getQueue('whatsapp');
    const idempotencyKey = 'wa-idemp-dedup-001';

    // First delivery dispatch
    const job1 = await waQueue.add(
      'send-whatsapp',
      {
        certificateNumber: 'PRAGATI-2026-N01-0001',
        recipientPhone: '9876543210',
        candidateName: 'Rahul S. Verma',
        pdfDownloadUrl: 'http://localhost:3000/download/cert-01',
        idempotencyKey
      },
      { jobId: 'job-dedup-1' }
    );
    await waitForJob(waQueue, job1.id);

    // Second delivery dispatch with identical idempotencyKey
    const job2 = await waQueue.add(
      'send-whatsapp',
      {
        certificateNumber: 'PRAGATI-2026-N01-0001',
        recipientPhone: '9876543210',
        candidateName: 'Rahul S. Verma',
        pdfDownloadUrl: 'http://localhost:3000/download/cert-01',
        idempotencyKey
      },
      { jobId: 'job-dedup-2' }
    );
    await waitForJob(waQueue, job2.id);

    // Ensure mockWhatsApp recorded only 1 distinct delivered message
    assert.equal(mockWhatsApp.deliveredKeys.size, 1);
    const logs = mockWhatsApp.getDeliveryLogs().filter((l) => l.idempotencyKey === idempotencyKey);
    // The second call was recognized as IDEMPOTENT_CACHE_HIT
    const cacheHit = logs.find((l) => l.status === 'IDEMPOTENT_CACHE_HIT');
    assert.ok(cacheHit, 'Second delivery must be recognized as idempotent cache hit');
  });

  test('3. Non-blocking API: State final approval returns immediately while background issuance processes', async () => {
    mockWhatsApp.setFailureMode('ALWAYS_SUCCESS');
    const farahToken = await getToken('farah');
    const batchId = 'batch-async-test-01';

    // Create a fresh batch in PENDING_STATE with 2 candidates
    const newBatch = {
      id: batchId,
      batchNumber: 'BATCH-2026-ASYNC',
      courseName: 'Solar PV Installer',
      centreId: 'centre-apex-01',
      centreName: 'Apex Skills Academy',
      districtId: 'district-north',
      districtName: 'North District',
      candidateCount: 2,
      status: 'PENDING_STATE',
      districtApprovals: [],
      cycleCount: 1,
      createdAt: new Date().toISOString()
    };
    dataStore.batches.push(newBatch);

    dataStore.setCandidatesForBatch(batchId, [
      {
        fullName: 'Async Candidate 1',
        phone: '9811199991',
        email: 'c1@example.com',
        nationalId: 'AADHAAR-ASYNC-1',
        dob: '2001-01-01',
        marksPercentage: 85,
        grade: 'A'
      },
      {
        fullName: 'Async Candidate 2',
        phone: '9811199992',
        email: 'c2@example.com',
        nationalId: 'AADHAAR-ASYNC-2',
        dob: '2001-02-02',
        marksPercentage: 90,
        grade: 'A+'
      }
    ]);

    const startMs = Date.now();
    // Call Final Approval API
    const res = await api('POST', `/api/batches/${batchId}/decision`, {
      headers: { Authorization: `Bearer ${farahToken}` },
      body: { action: 'APPROVE', reason: 'Final authorization' }
    });
    const elapsedMs = Date.now() - startMs;

    // Must return immediately (< 100ms) without waiting for PDF generation or WhatsApp dispatches
    assert.equal(res.status, 200);
    assert.equal(res.data.jobEnqueued, true);
    assert.ok(elapsedMs < 100, `API must respond quickly without blocking (took ${elapsedMs}ms)`);

    // Wait for the background issuance queue to finish
    const issuanceQueue = queueManager.getQueue('issuance');
    await waitForJob(issuanceQueue, `issue-${batchId}`);

    // Verify background worker generated certificates
    const issuedCerts = dataStore.findCertificatesByBatchId(batchId);
    assert.equal(issuedCerts.length, 2);

    // Wait for the WhatsApp delivery queue to process both deliveries
    const waQueue = queueManager.getQueue('whatsapp');
    await waitForJob(waQueue, `wa-deliv-${issuedCerts[0].certificateNumber}`);
    await waitForJob(waQueue, `wa-deliv-${issuedCerts[1].certificateNumber}`);

    assert.equal(mockWhatsApp.deliveredKeys.size, 2);
  });

  test('4. Queue status & delivery observability endpoint', async () => {
    const resStats = await api('GET', '/api/jobs/stats');
    assert.equal(resStats.status, 200);
    assert.ok(resStats.data.issuance);
    assert.ok(resStats.data.whatsapp);
    assert.ok(resStats.data.sla);

    const resDeliveries = await api('GET', '/api/jobs/deliveries');
    assert.equal(resDeliveries.status, 200);
    assert.ok(Array.isArray(resDeliveries.data.deliveries));
  });

  test('5. Delayed-batch alert job: Detects batches exceeding SLA threshold (> 48 hours)', async () => {
    const slaQueue = queueManager.getQueue('sla');

    // Create a batch that was submitted 52 hours ago
    const stuckBatch = {
      id: 'batch-stuck-999',
      batchNumber: 'BATCH-2026-STUCK',
      courseName: 'Welding Technology',
      centreId: 'centre-apex-01',
      centreName: 'Apex Skills Academy',
      districtId: 'district-north',
      districtName: 'North District',
      candidateCount: 15,
      status: 'PENDING_DISTRICT',
      districtApprovals: [],
      cycleCount: 1,
      createdAt: new Date(Date.now() - 52 * 60 * 60 * 1000).toISOString(),
      submittedAt: new Date(Date.now() - 52 * 60 * 60 * 1000).toISOString()
    };
    dataStore.batches.push(stuckBatch);

    // Trigger SLA check job with 48h threshold
    const job = await slaQueue.add('check-sla', { thresholdHours: 48 }, { jobId: 'sla-test-job-01' });
    const completedJob = await waitForJob(slaQueue, job.id);

    assert.equal(completedJob.status, 'COMPLETED');
    assert.ok(completedJob.result.stuckCount >= 1);

    const foundStuck = dataStore.findBatchById('batch-stuck-999');
    assert.equal(foundStuck.isStuck, true);
    assert.ok(foundStuck.stuckHours >= 50);
  });
});
