const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { Readable } = require('node:stream');
const { EventEmitter } = require('node:events');
const app = require('../src/app');
const { DEMO_PASSWORD } = require('../src/auth/identities');
const { dataStore } = require('../src/store/dataStore');

// In-Memory HTTP Dispatcher
function api(method, url, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : '';
    const req = Readable.from(bodyStr ? [bodyStr] : []);
    req.method = method.toUpperCase();
    req.url = url;
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
  const res = await api('POST', '/api/auth/login', { body: { username, password: DEMO_PASSWORD } });
  assert.equal(res.status, 200);
  return res.data.token;
}

describe('CertiFlow Certificate Issuance, PDF Security & Revocation Suite', () => {
  beforeEach(() => {
    dataStore.reset();
  });

  test('1. Issuance condition: Only allowed after state final approval (APPROVED)', async () => {
    const farahToken = await getToken('farah');
    const batchId = 'batch-north-large-01'; // Initially PENDING_DISTRICT

    // Attempting issuance while batch is in PENDING_DISTRICT -> 400 Bad Request
    const resPremature = await api('POST', `/api/certificates/issue/${batchId}`, {
      headers: { Authorization: `Bearer ${farahToken}` }
    });
    assert.equal(resPremature.status, 400);
    assert.equal(resPremature.data.error, 'INVALID_BATCH_STATE');

    // Advance batch to APPROVED
    const batch = dataStore.findBatchById(batchId);
    batch.status = 'APPROVED';

    // Seed 2 candidates into batch
    dataStore.setCandidatesForBatch(batchId, [
      {
        fullName: 'Aarav Patel',
        phone: '9877711122',
        email: 'aarav@example.com',
        nationalId: 'AADHAAR-5511',
        dob: '2001-01-01',
        marksPercentage: 88,
        grade: 'A'
      },
      {
        fullName: 'Bhavna Sharma',
        phone: '9877733344',
        email: 'bhavna@example.com',
        nationalId: 'AADHAAR-5522',
        dob: '2002-02-02',
        marksPercentage: 92,
        grade: 'A+'
      }
    ]);

    // Issue certificates -> 200 OK
    const resIssue = await api('POST', `/api/certificates/issue/${batchId}`, {
      headers: { Authorization: `Bearer ${farahToken}` }
    });
    assert.equal(resIssue.status, 200);
    assert.equal(resIssue.data.count, 2);
  });

  test('2. Unique certificate numbers & unguessable verification tokens', async () => {
    const farahToken = await getToken('farah');
    const batchId = 'batch-north-large-01';
    const batch = dataStore.findBatchById(batchId);
    batch.status = 'APPROVED';

    dataStore.setCandidatesForBatch(batchId, [
      {
        fullName: 'Candidate One',
        phone: '9811100001',
        email: 'c1@example.com',
        nationalId: 'AADHAAR-0001',
        dob: '2000-01-01',
        marksPercentage: 80,
        grade: 'B'
      },
      {
        fullName: 'Candidate Two',
        phone: '9811100002',
        email: 'c2@example.com',
        nationalId: 'AADHAAR-0002',
        dob: '2000-02-02',
        marksPercentage: 85,
        grade: 'A'
      },
      {
        fullName: 'Candidate Three',
        phone: '9811100003',
        email: 'c3@example.com',
        nationalId: 'AADHAAR-0003',
        dob: '2000-03-03',
        marksPercentage: 90,
        grade: 'A+'
      }
    ]);

    const res = await api('POST', `/api/certificates/issue/${batchId}`, {
      headers: { Authorization: `Bearer ${farahToken}` }
    });
    assert.equal(res.status, 200);
    const certs = res.data.certificates;
    assert.equal(certs.length, 3);

    // Verify all certificate numbers are distinct
    const certNumbers = new Set(certs.map((c) => c.certificateNumber));
    assert.equal(certNumbers.size, 3, 'All certificate numbers must be unique');

    // Verify all verification tokens are distinct and unguessable (high entropy)
    const tokens = new Set(certs.map((c) => c.verificationCode));
    assert.equal(tokens.size, 3, 'All verification tokens must be unique');
    for (const code of tokens) {
      assert.ok(code.startsWith('cf_vtok_'), 'Code must carry safe prefix');
      assert.ok(code.length > 25, 'Code must carry sufficient entropy (128-bit hex)');
    }

    // Verify PDF file was created on disk and begins with standard PDF header
    for (const cert of certs) {
      assert.ok(fs.existsSync(cert.pdfStoragePath), `PDF file must exist at ${cert.pdfStoragePath}`);
      const fileBytes = fs.readFileSync(cert.pdfStoragePath);
      assert.ok(fileBytes.toString('utf8', 0, 8).startsWith('%PDF-1.4'), 'File must be standard PDF-1.4');
    }
  });

  test('3. Idempotency: Retries do not create duplicate certificates', async () => {
    const farahToken = await getToken('farah');
    const batchId = 'batch-north-large-01';
    const batch = dataStore.findBatchById(batchId);
    batch.status = 'APPROVED';

    dataStore.setCandidatesForBatch(batchId, [
      {
        fullName: 'Single Candidate',
        phone: '9899999999',
        email: 'single@example.com',
        nationalId: 'AADHAAR-SINGLE',
        dob: '2001-01-01',
        marksPercentage: 95,
        grade: 'A+'
      }
    ]);

    // First issuance
    const res1 = await api('POST', `/api/certificates/issue/${batchId}`, {
      headers: { Authorization: `Bearer ${farahToken}` }
    });
    assert.equal(res1.status, 200);
    const cert1 = res1.data.certificates[0];

    const initialTotalCerts = dataStore.certificates.length;

    // Retry issuance for the exact same batch
    const res2 = await api('POST', `/api/certificates/issue/${batchId}`, {
      headers: { Authorization: `Bearer ${farahToken}` }
    });
    assert.equal(res2.status, 200);
    const cert2 = res2.data.certificates[0];

    // Must return the exact same certificate without creating duplicates
    assert.equal(cert2.id, cert1.id);
    assert.equal(cert2.certificateNumber, cert1.certificateNumber);
    assert.equal(dataStore.certificates.length, initialTotalCerts, 'Total certificates count must not increase');

    // Direct database-level unique constraint check:
    // Attempting to insert another certificate for the same candidate throws an error
    assert.throws(
      () => {
        dataStore.insertCertificate({
          certificateNumber: 'PRAGATI-FORCED-DUP',
          candidateId: cert1.candidateId,
          verificationCode: 'cf_vtok_different'
        });
      },
      /UNIQUE_CONSTRAINT_VIOLATION.*uq_certificates_candidate_id/,
      'Must enforce candidate uniqueness at DB constraint level'
    );
  });

  test('4. Authorized candidate download & stranger access prevention', async () => {
    const farahToken = await getToken('farah');
    const anikaToken = await getToken('anika');
    const batchId = 'batch-north-large-01';
    const batch = dataStore.findBatchById(batchId);
    batch.status = 'APPROVED';

    dataStore.setCandidatesForBatch(batchId, [
      {
        fullName: 'Deepak Roy',
        phone: '9888877777',
        email: 'deepak@example.com',
        nationalId: 'AADHAAR-DEEPAK',
        dob: '2001-01-01',
        marksPercentage: 88,
        grade: 'A'
      }
    ]);

    const resIssue = await api('POST', `/api/certificates/issue/${batchId}`, {
      headers: { Authorization: `Bearer ${farahToken}` }
    });
    const cert = resIssue.data.certificates[0];

    // A. Stranger attempting download without credentials -> 403 Forbidden
    const resStranger = await api('GET', `/api/certificates/${cert.certificateNumber}/download`);
    assert.equal(resStranger.status, 403);
    assert.equal(resStranger.data.error, 'DOWNLOAD_FORBIDDEN');

    // B. Candidate download using verification code -> 200 OK PDF Stream
    const resWithCode = await api(
      'GET',
      `/api/certificates/${cert.certificateNumber}/download?code=${cert.verificationCode}`
    );
    assert.equal(resWithCode.status, 200);
    assert.equal(resWithCode.headers['content-type'], 'application/pdf');
    assert.ok(resWithCode.buffer.toString('utf8', 0, 8).startsWith('%PDF-1.4'));

    // C. Candidate download using signed token -> 200 OK PDF Stream
    const resWithToken = await api(
      'GET',
      `/api/certificates/${cert.certificateNumber}/download?token=${cert.downloadToken}`
    );
    assert.equal(resWithToken.status, 200);
    assert.equal(resWithToken.headers['content-type'], 'application/pdf');

    // D. Owning Training Centre (Anika) logged-in download -> 200 OK
    const resCentre = await api('GET', `/api/certificates/${cert.certificateNumber}/download`, {
      headers: { Authorization: `Bearer ${anikaToken}` }
    });
    assert.equal(resCentre.status, 200);
  });

  test('5. Unauthorized cancellation is strictly blocked (Only State Office allowed)', async () => {
    const anikaToken = await getToken('anika');
    const devToken = await getToken('dev');
    const nehaToken = await getToken('neha');
    const certNumber = 'PRAGATI-2026-N01-0001';

    // Training Centre attempting revocation -> 403
    const res1 = await api('POST', `/api/certificates/${certNumber}/revoke`, {
      headers: { Authorization: `Bearer ${anikaToken}` },
      body: { reason: 'Unauthorized revoke' }
    });
    assert.equal(res1.status, 403);
    assert.equal(res1.data.error, 'FORBIDDEN_ROLE');

    // District Officer attempting revocation -> 403
    const res2 = await api('POST', `/api/certificates/${certNumber}/revoke`, {
      headers: { Authorization: `Bearer ${devToken}` },
      body: { reason: 'Unauthorized revoke' }
    });
    assert.equal(res2.status, 403);
    assert.equal(res2.data.error, 'FORBIDDEN_ROLE');

    // Quality Team attempting revocation -> 403
    const res3 = await api('POST', `/api/certificates/${certNumber}/revoke`, {
      headers: { Authorization: `Bearer ${nehaToken}` },
      body: { reason: 'Unauthorized revoke' }
    });
    assert.equal(res3.status, 403);
    assert.equal(res3.data.error, 'FORBIDDEN_ROLE');

    // Public / Anonymous attempting revocation -> 401
    const res4 = await api('POST', `/api/certificates/${certNumber}/revoke`, {
      body: { reason: 'Unauthorized revoke' }
    });
    assert.equal(res4.status, 401);
  });

  test('6. State Office revocation immediately invalidates public verification', async () => {
    const farahToken = await getToken('farah');
    const certNumber = 'PRAGATI-2026-N01-0001';

    // Verify initially active
    const check1 = await api('GET', `/api/public/verify/${certNumber}`);
    assert.equal(check1.status, 200);
    assert.equal(check1.data.isValid, true);
    assert.ok(check1.data.status === 'VALID' || check1.data.status === 'ACTIVE');

    // Farah revokes certificate
    const revocationReason = 'Special investigative audit confirmed fraudulent attendance log';
    const resRevoke = await api('POST', `/api/certificates/${certNumber}/revoke`, {
      headers: { Authorization: `Bearer ${farahToken}` },
      body: { reason: revocationReason }
    });
    assert.equal(resRevoke.status, 200);
    assert.equal(resRevoke.data.certificate.status, 'REVOKED');
    assert.equal(resRevoke.data.certificate.revokedBy, 'Farah Khan');

    // Public lookup immediately reports invalid and displays revocation reason
    const check2 = await api('GET', `/api/public/verify/${certNumber}`);
    assert.equal(check2.status, 200);
    assert.equal(check2.data.isValid, false);
    assert.ok(check2.data.status === 'CANCELLED' || check2.data.status === 'REVOKED');
    assert.equal(check2.data.revocationReason, revocationReason);
    assert.ok(check2.data.revokedAt, 'Revocation timestamp must be present');
  });
});
