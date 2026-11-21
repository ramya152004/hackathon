const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { EventEmitter } = require('node:events');
const app = require('../src/app');
const { dataStore } = require('../src/store/dataStore');

// In-Memory HTTP Dispatcher
function api(method, url, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : '';
    const req = Readable.from(bodyStr ? [bodyStr] : []);
    req.method = method.toUpperCase();
    req.url = url;
    req.headers = {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(bodyStr),
      ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
    };

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
      const resBody = Buffer.concat(chunks).toString('utf8');
      let parsed;
      try {
        parsed = JSON.parse(resBody);
      } catch {
        parsed = resBody;
      }
      resolve({ status: res.statusCode, data: parsed });
    };
    res.json = (json) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(json));
    };
    res.send = (data) => {
      if (typeof data === 'object') return res.json(data);
      res.end(data);
    };

    app(req, res, (err) => {
      if (err) reject(err);
      else resolve({ status: 404, data: { error: 'NOT_FOUND' } });
    });
  });
}

// Token helpers
async function getToken(username) {
  const res = await api('POST', '/api/auth/login', { body: { username } });
  assert.equal(res.status, 200);
  return res.data.token;
}

describe('CertiFlow Batch Approval Workflow & Concurrency Suite', () => {
  beforeEach(() => {
    dataStore.reset();
  });

  test('1. Concurrency: Two district officers approving simultaneously moves batch forward once, safely', async () => {
    const devToken = await getToken('dev');
    const meeraToken = await getToken('meera');
    const batchId = 'batch-north-large-01'; // 60 candidates

    // Fire both approval requests at the exact same moment
    const [res1, res2] = await Promise.all([
      api('POST', `/api/batches/${batchId}/decision`, {
        headers: { Authorization: `Bearer ${devToken}` },
        body: { action: 'APPROVE', reason: 'Dev review passed' }
      }),
      api('POST', `/api/batches/${batchId}/decision`, {
        headers: { Authorization: `Bearer ${meeraToken}` },
        body: { action: 'APPROVE', reason: 'Meera review passed' }
      })
    ]);

    // Both requests must succeed (HTTP 200)
    assert.equal(res1.status, 200);
    assert.equal(res2.status, 200);

    const statuses = [res1.data.batch.status, res2.data.batch.status];
    // One will be DISTRICT_PARTIAL_APPROVED (first), and the final will be PENDING_QUALITY (second, >50 candidates)
    assert.ok(statuses.includes('DISTRICT_PARTIAL_APPROVED'), 'One request must register as partial approval');
    assert.ok(statuses.includes('PENDING_QUALITY'), 'The second request must advance batch to PENDING_QUALITY');

    // Verify database state
    const finalBatch = dataStore.findBatchById(batchId);
    assert.equal(finalBatch.status, 'PENDING_QUALITY');
    assert.equal(finalBatch.districtApprovals.length, 2);
    assert.equal(finalBatch.districtApprovals[0].cycleCount, 1);
    assert.equal(finalBatch.districtApprovals[1].cycleCount, 1);

    // Verify both officer IDs are distinct
    assert.notEqual(finalBatch.districtApprovals[0].officerId, finalBatch.districtApprovals[1].officerId);
  });

  test('2. Dynamic Routing: Small batch (<= 50) bypasses Quality Team and moves directly to PENDING_STATE', async () => {
    const devToken = await getToken('dev');
    const meeraToken = await getToken('meera');
    const batchId = 'batch-north-small-02'; // 25 candidates

    // First approval by Dev
    const res1 = await api('POST', `/api/batches/${batchId}/decision`, {
      headers: { Authorization: `Bearer ${devToken}` },
      body: { action: 'APPROVE' }
    });
    assert.equal(res1.status, 200);
    assert.equal(res1.data.batch.status, 'DISTRICT_PARTIAL_APPROVED');

    // Second approval by Meera -> Consensus reached on <= 50 candidates -> PENDING_STATE directly!
    const res2 = await api('POST', `/api/batches/${batchId}/decision`, {
      headers: { Authorization: `Bearer ${meeraToken}` },
      body: { action: 'APPROVE' }
    });
    assert.equal(res2.status, 200);
    assert.equal(res2.data.batch.status, 'PENDING_STATE');
  });

  test('3. Mandatory Reason Enforcement: Rejection and Return-for-Correction require non-empty reason', async () => {
    const devToken = await getToken('dev');
    const batchId = 'batch-north-large-01';

    // Attempt REJECT without reason -> 400 Bad Request
    const resRejectNoReason = await api('POST', `/api/batches/${batchId}/decision`, {
      headers: { Authorization: `Bearer ${devToken}` },
      body: { action: 'REJECT', reason: '' }
    });
    assert.equal(resRejectNoReason.status, 400);
    assert.equal(resRejectNoReason.data.error, 'MISSING_REASON');

    // Attempt RETURN_FOR_CORRECTION without reason -> 400 Bad Request
    const resReturnNoReason = await api('POST', `/api/batches/${batchId}/decision`, {
      headers: { Authorization: `Bearer ${devToken}` },
      body: { action: 'RETURN_FOR_CORRECTION', reason: '   ' }
    });
    assert.equal(resReturnNoReason.status, 400);
    assert.equal(resReturnNoReason.data.error, 'MISSING_REASON');
  });

  test('4. Resubmission Policy: Returned batch clears prior approvals and increments revision cycle', async () => {
    const anikaToken = await getToken('anika');
    const devToken = await getToken('dev');
    const meeraToken = await getToken('meera');
    const batchId = 'batch-north-large-01';

    // 1. Dev approves (1/2)
    const resDev = await api('POST', `/api/batches/${batchId}/decision`, {
      headers: { Authorization: `Bearer ${devToken}` },
      body: { action: 'APPROVE' }
    });
    assert.equal(resDev.status, 200);
    assert.equal(resDev.data.batch.status, 'DISTRICT_PARTIAL_APPROVED');

    // 2. Meera returns batch for correction with mandatory reason
    const resReturn = await api('POST', `/api/batches/${batchId}/decision`, {
      headers: { Authorization: `Bearer ${meeraToken}` },
      body: {
        action: 'RETURN_FOR_CORRECTION',
        reason: 'Candidate Aadhaar numbers must be 12-digit standard format'
      }
    });
    assert.equal(resReturn.status, 200);
    assert.equal(resReturn.data.batch.status, 'SENT_BACK');
    assert.equal(resReturn.data.batch.districtApprovals.length, 0, 'Prior approvals must be cleared');

    // 3. Centre (Anika) resubmits batch
    const resResubmit = await api('POST', `/api/batches/${batchId}/submit`, {
      headers: { Authorization: `Bearer ${anikaToken}` }
    });
    assert.equal(resResubmit.status, 200);
    assert.equal(resResubmit.data.batch.status, 'PENDING_DISTRICT');
    assert.equal(resResubmit.data.batch.cycleCount, 2, 'Batch revision cycle must increment to 2');
    assert.equal(resResubmit.data.batch.districtApprovals.length, 0, 'Approval roster starts fresh at 0/2');

    // 4. Dev can now approve in the new cycle revision (cycleCount = 2)
    const resDevCycle2 = await api('POST', `/api/batches/${batchId}/decision`, {
      headers: { Authorization: `Bearer ${devToken}` },
      body: { action: 'APPROVE' }
    });
    assert.equal(resDevCycle2.status, 200);
    assert.equal(resDevCycle2.data.batch.districtApprovals.length, 1);
  });

  test('5. Audit History Integrity: Captures actor, role, decision, reason, timestamp and revision', async () => {
    const devToken = await getToken('dev');
    const batchId = 'batch-north-large-01';

    await api('POST', `/api/batches/${batchId}/decision`, {
      headers: { Authorization: `Bearer ${devToken}` },
      body: { action: 'APPROVE', reason: 'Documentation verified against attendance register' }
    });

    const batch = dataStore.findBatchById(batchId);
    assert.ok(batch.auditHistory.length > 0, 'Audit history must contain entries');

    const lastAudit = batch.auditHistory[batch.auditHistory.length - 1];
    assert.equal(lastAudit.actorName, 'Dev Patel');
    assert.equal(lastAudit.actorRole, 'DISTRICT_OFFICER');
    assert.equal(lastAudit.decision, 'DISTRICT_APPROVE_1');
    assert.equal(lastAudit.reason, 'Documentation verified against attendance register');
    assert.equal(lastAudit.batchRevision, 1);
    assert.equal(lastAudit.status, 'DISTRICT_PARTIAL_APPROVED');
    assert.ok(lastAudit.timestamp, 'Timestamp must be recorded');
  });

  test('6. State Office has exclusive authority to grant final approval', async () => {
    const devToken = await getToken('dev');
    const meeraToken = await getToken('meera');
    const nehaToken = await getToken('neha');
    const farahToken = await getToken('farah');
    const batchId = 'batch-north-large-01';

    // Dev & Meera approve
    await api('POST', `/api/batches/${batchId}/decision`, {
      headers: { Authorization: `Bearer ${devToken}` },
      body: { action: 'APPROVE' }
    });
    await api('POST', `/api/batches/${batchId}/decision`, {
      headers: { Authorization: `Bearer ${meeraToken}` },
      body: { action: 'APPROVE' }
    });

    // Neha (Quality) approves
    await api('POST', `/api/batches/${batchId}/decision`, {
      headers: { Authorization: `Bearer ${nehaToken}` },
      body: { action: 'APPROVE' }
    });

    // Dev attempts final approval -> FORBIDDEN 403
    const resDevFinal = await api('POST', `/api/batches/${batchId}/decision`, {
      headers: { Authorization: `Bearer ${devToken}` },
      body: { action: 'APPROVE' }
    });
    assert.equal(resDevFinal.status, 403);
    assert.equal(resDevFinal.data.error, 'FORBIDDEN_ROLE');

    // Farah (State Office) grants final approval -> APPROVED 200
    const resFarahFinal = await api('POST', `/api/batches/${batchId}/decision`, {
      headers: { Authorization: `Bearer ${farahToken}` },
      body: { action: 'APPROVE', reason: 'Final authorization granted for issuance' }
    });
    assert.equal(resFarahFinal.status, 200);
    assert.equal(resFarahFinal.data.batch.status, 'APPROVED');
  });
});
