const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { EventEmitter } = require('node:events');
const app = require('../src/app');
const { dataStore } = require('../src/store/dataStore');

// In-Memory HTTP Dispatcher (Runs completely in-process without socket dependencies)
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

// Helper to authenticate as demo persona
async function loginAs(username) {
  const res = await api('POST', '/api/auth/login', { body: { username } });
  assert.equal(res.status, 200, `Login for ${username} failed`);
  return res.data.token;
}

describe('CertiFlow Authentication & Server-Side RBAC Security Suite', () => {
  beforeEach(() => {
    // Reset data store to initial clean state before each test
    dataStore.reset();
  });

  test('1. Unauthenticated requests to protected endpoints must be rejected with 401', async () => {
    // Batch listing
    const res1 = await api('GET', '/api/batches');
    assert.equal(res1.status, 401);
    assert.equal(res1.data.error, 'UNAUTHORIZED');

    // Create batch
    const res2 = await api('POST', '/api/batches', {
      body: { courseName: 'Solar PV Installer', candidateCount: 10 }
    });
    assert.equal(res2.status, 401);

    // Revoke certificate
    const res3 = await api('POST', '/api/certificates/cert-uuid-001/revoke', {
      body: { reason: 'Unauthorized revocation attempt' }
    });
    assert.equal(res3.status, 401);
  });

  test('2. Demo personas authenticate and receive correctly scoped tokens', async () => {
    // Anika (Training Centre)
    const resAnika = await api('POST', '/api/auth/login', { body: { username: 'anika' } });
    assert.equal(resAnika.status, 200);
    assert.equal(resAnika.data.user.role, 'TRAINING_CENTRE');
    assert.equal(resAnika.data.user.centreId, 'centre-apex-01');
    assert.equal(resAnika.data.user.districtId, 'district-north');

    // Kabir (South District Officer)
    const resKabir = await api('POST', '/api/auth/login', { body: { username: 'kabir' } });
    assert.equal(resKabir.status, 200);
    assert.equal(resKabir.data.user.role, 'DISTRICT_OFFICER');
    assert.equal(resKabir.data.user.districtId, 'district-south');

    // Farah (State Office)
    const resFarah = await api('POST', '/api/auth/login', { body: { username: 'farah' } });
    assert.equal(resFarah.status, 200);
    assert.equal(resFarah.data.user.role, 'STATE_OFFICE');
  });

  test('3. Role Escalation Prevention: Users cannot execute actions outside their assigned role', async () => {
    const anikaToken = await loginAs('anika');
    const devToken = await loginAs('dev');
    const nehaToken = await loginAs('neha');

    // Training Centre (Anika) attempting District Approval -> FORBIDDEN 403
    const res1 = await api('POST', '/api/batches/batch-north-large-01/district-approve', {
      headers: { Authorization: `Bearer ${anikaToken}` }
    });
    assert.equal(res1.status, 403);
    assert.equal(res1.data.error, 'FORBIDDEN_ROLE');

    // District Officer (Dev) attempting Certificate Revocation -> FORBIDDEN 403 (State Office only)
    const res2 = await api('POST', '/api/certificates/cert-uuid-001/revoke', {
      headers: { Authorization: `Bearer ${devToken}` },
      body: { reason: 'Unauthorized revocation attempt' }
    });
    assert.equal(res2.status, 403);
    assert.equal(res2.data.error, 'FORBIDDEN_ROLE');

    // Quality Team (Neha) attempting Final State Approval -> FORBIDDEN 403
    const res3 = await api('POST', '/api/batches/batch-north-large-01/final-approve', {
      headers: { Authorization: `Bearer ${nehaToken}` }
    });
    assert.equal(res3.status, 403);
    assert.equal(res3.data.error, 'FORBIDDEN_ROLE');
  });

  test("4. Centre Scope Isolation: Training Centre cannot access another centre's batches", async () => {
    const anikaToken = await loginAs('anika');

    // Anika accessing her own batch (Apex Skills Academy) -> OK 200
    const resOwn = await api('GET', '/api/batches/batch-north-large-01', {
      headers: { Authorization: `Bearer ${anikaToken}` }
    });
    assert.equal(resOwn.status, 200);
    assert.equal(resOwn.data.batch.centreId, 'centre-apex-01');

    // Anika attempting to access Horizon Skills Institute batch -> FORBIDDEN 403
    const resOther = await api('GET', '/api/batches/batch-south-03', {
      headers: { Authorization: `Bearer ${anikaToken}` }
    });
    assert.equal(resOther.status, 403);
    assert.equal(resOther.data.error, 'TENANT_ACCESS_DENIED');
  });

  test("5. District Scope Isolation: District Officer cannot access or approve another district's batches", async () => {
    const devToken = await loginAs('dev');     // North District Officer
    const meeraToken = await loginAs('meera'); // North District Officer
    const kabirToken = await loginAs('kabir'); // South District Officer

    // Kabir (South) attempting to access North batch -> FORBIDDEN 403
    const resKabirView = await api('GET', '/api/batches/batch-north-large-01', {
      headers: { Authorization: `Bearer ${kabirToken}` }
    });
    assert.equal(resKabirView.status, 403);
    assert.equal(resKabirView.data.error, 'DISTRICT_ACCESS_DENIED');

    // Kabir (South) attempting to approve North batch -> FORBIDDEN 403
    const resKabirApprove = await api('POST', '/api/batches/batch-north-large-01/district-approve', {
      headers: { Authorization: `Bearer ${kabirToken}` }
    });
    assert.equal(resKabirApprove.status, 403);
    assert.equal(resKabirApprove.data.error, 'DISTRICT_ACCESS_DENIED');

    // Dev (North) approves North batch -> First Approval Recorded (1/2) -> OK 200
    const resDevApprove = await api('POST', '/api/batches/batch-north-large-01/district-approve', {
      headers: { Authorization: `Bearer ${devToken}` }
    });
    assert.equal(resDevApprove.status, 200);
    assert.equal(resDevApprove.data.approvalsCount, 1);
    assert.equal(resDevApprove.data.batch.status, 'DISTRICT_PARTIAL_APPROVED');

    // Dev cannot approve twice in the same cycle -> 409 Conflict
    const resDevDuplicate = await api('POST', '/api/batches/batch-north-large-01/district-approve', {
      headers: { Authorization: `Bearer ${devToken}` }
    });
    assert.equal(resDevDuplicate.status, 409);
    assert.equal(resDevDuplicate.data.error, 'DUPLICATE_APPROVAL');

    // Meera (Second North Officer) approves -> Consensus Reached (2/2) -> PENDING_QUALITY (size 60 > 50)
    const resMeeraApprove = await api('POST', '/api/batches/batch-north-large-01/district-approve', {
      headers: { Authorization: `Bearer ${meeraToken}` }
    });
    assert.equal(resMeeraApprove.status, 200);
    assert.equal(resMeeraApprove.data.approvalsCount, 2);
    assert.equal(resMeeraApprove.data.batch.status, 'PENDING_QUALITY');
  });

  test('6. Quality Team Scope: Restricted to batches exceeding 50 candidates', async () => {
    const nehaToken = await loginAs('neha');

    // Small batch (25 candidates) -> Quality team scrutiny rejected (403)
    const resSmall = await api('POST', '/api/batches/batch-north-small-02/quality-approve', {
      headers: { Authorization: `Bearer ${nehaToken}` }
    });
    assert.equal(resSmall.status, 403);
    assert.equal(resSmall.data.error, 'QUALITY_SCOPE_DENIED');

    // Large batch (60 candidates) -> Quality team can approve (200)
    const resLarge = await api('POST', '/api/batches/batch-north-large-01/quality-approve', {
      headers: { Authorization: `Bearer ${nehaToken}` }
    });
    assert.equal(resLarge.status, 200);
    assert.equal(resLarge.data.batch.status, 'PENDING_STATE');
  });

  test('7. Public Certificate Verification is completely unauthenticated and sanitizes PII', async () => {
    // 1. Verify Active Certificate (No Authorization header)
    const res = await api('GET', '/api/public/verify/PRAGATI-2026-N01-0001');
    assert.equal(res.status, 200);
    assert.equal(res.data.isValid, true);
    assert.equal(res.data.status, 'ACTIVE');
    assert.equal(res.data.certificateNumber, 'PRAGATI-2026-N01-0001');
    assert.equal(res.data.candidateName, 'Rahul S. Verma');
    assert.equal(res.data.courseName, 'Solar PV Installer');

    // STRICT PRIVACY CHECK: Candidate sensitive details MUST NOT be exposed
    assert.equal(res.data.phone, undefined, 'Candidate phone number must not be exposed to the public');
    assert.equal(res.data.nationalId, undefined, 'Candidate national ID must not be exposed to the public');

    // 2. Verify Revoked Certificate
    const resRevoked = await api('GET', '/api/public/verify/PRAGATI-2026-N01-0002');
    assert.equal(resRevoked.status, 200);
    assert.equal(resRevoked.data.isValid, false);
    assert.equal(resRevoked.data.status, 'REVOKED');
    assert.ok(resRevoked.data.revocationReason, 'Revocation reason must be visible');

    // 3. Unknown certificate
    const resNotFound = await api('GET', '/api/public/verify/FAKE-CERT-999');
    assert.equal(resNotFound.status, 404);
    assert.equal(resNotFound.data.isValid, false);
  });

  test('8. State Office Revocation triggers instant invalidation on public verification', async () => {
    const farahToken = await loginAs('farah');

    // Pre-check: PRAGATI-2026-N01-0001 is ACTIVE
    const check1 = await api('GET', '/api/public/verify/PRAGATI-2026-N01-0001');
    assert.equal(check1.data.isValid, true);

    // Farah revokes certificate
    const revokeRes = await api('POST', '/api/certificates/PRAGATI-2026-N01-0001/revoke', {
      headers: { Authorization: `Bearer ${farahToken}` },
      body: { reason: 'Investigative audit found forged exam score' }
    });
    assert.equal(revokeRes.status, 200);
    assert.equal(revokeRes.data.certificate.status, 'REVOKED');

    // Immediate public lookup reflects revocation
    const check2 = await api('GET', '/api/public/verify/PRAGATI-2026-N01-0001');
    assert.equal(check2.status, 200);
    assert.equal(check2.data.isValid, false);
    assert.equal(check2.data.status, 'REVOKED');
    assert.equal(check2.data.revocationReason, 'Investigative audit found forged exam score');
  });
});
