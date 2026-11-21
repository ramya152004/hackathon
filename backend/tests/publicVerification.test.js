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

describe('CertiFlow Public No-Login Verification & SSE Suite', () => {
  beforeEach(() => {
    dataStore.reset();
  });

  test('1. Valid certificate lookup returns minimal public info and status VALID', async () => {
    // Unauthenticated GET (no Authorization header)
    const res = await api('GET', '/api/public/verify/PRAGATI-2026-N01-0001');

    assert.equal(res.status, 200);
    assert.equal(res.data.status, 'VALID');
    assert.equal(res.data.isValid, true);
    assert.equal(res.data.certificateNumber, 'PRAGATI-2026-N01-0001');
    assert.equal(res.data.candidateName, 'Rahul S. Verma');
    assert.equal(res.data.courseName, 'Solar PV Installer');
    assert.equal(res.data.centreName, 'Apex Skills Academy');
    assert.equal(res.data.districtName, 'North District');
    assert.ok(res.data.issuedAt);

    // CRITICAL PRIVACY INVARIANT: Never reveal private contact or identity data
    assert.equal(res.data.phone, undefined, 'Phone number must never be exposed');
    assert.equal(res.data.nationalId, undefined, 'National ID must never be exposed');
    assert.equal(res.data.downloadToken, undefined, 'Private candidate download token must never be exposed');
  });

  test('2. Cancelled certificate lookup returns status CANCELLED with revocation reason', async () => {
    const res = await api('GET', '/api/public/verify/PRAGATI-2026-N01-0002');

    assert.equal(res.status, 200);
    assert.equal(res.data.status, 'CANCELLED');
    assert.equal(res.data.isValid, false);
    assert.equal(res.data.certificateNumber, 'PRAGATI-2026-N01-0002');
    assert.equal(res.data.candidateName, 'Pooja K. Sharma');
    assert.ok(res.data.cancelledAt);
    assert.ok(res.data.cancellationReason.includes('irregular attendance'));

    // Privacy check
    assert.equal(res.data.phone, undefined);
    assert.equal(res.data.nationalId, undefined);
  });

  test('3. Immediate reflection without stale cache: Cancellation is reflected on next lookup', async () => {
    const farahToken = await getToken('farah');
    const certNumber = 'PRAGATI-2026-N01-0001';

    // 1. Initial query: VALID
    const initialCheck = await api('GET', `/api/public/verify/${certNumber}`);
    assert.equal(initialCheck.data.status, 'VALID');
    assert.equal(initialCheck.data.isValid, true);

    // 2. Farah revokes the certificate
    const revokeRes = await api('POST', `/api/certificates/${certNumber}/revoke`, {
      headers: { Authorization: `Bearer ${farahToken}` },
      body: { reason: 'Forged practical assessment scorecard' }
    });
    assert.equal(revokeRes.status, 200);

    // 3. Immediate subsequent lookup: Must return CANCELLED immediately (Zero stale cache window)
    const subsequentCheck = await api('GET', `/api/public/verify/${certNumber}`);
    assert.equal(subsequentCheck.status, 200);
    assert.equal(subsequentCheck.data.status, 'CANCELLED');
    assert.equal(subsequentCheck.data.isValid, false);
    assert.equal(subsequentCheck.data.cancellationReason, 'Forged practical assessment scorecard');
  });

  test('4. Unknown certificate lookup returns 404 NOT_FOUND', async () => {
    const res = await api('GET', '/api/public/verify/PRAGATI-9999-UNKNOWN-99');

    assert.equal(res.status, 404);
    assert.equal(res.data.status, 'NOT_FOUND');
    assert.equal(res.data.isValid, false);
  });

  test('5. Malformed certificate references are rejected with 400 INVALID', async () => {
    // A. Reference containing XSS / Script tags
    const res1 = await api('GET', '/api/public/verify/<script>alert(1)</script>');
    assert.equal(res1.status, 400);
    assert.equal(res1.data.status, 'INVALID');
    assert.equal(res1.data.error, 'MALFORMED_CERTIFICATE_REFERENCE');

    // B. Reference too short (< 6 chars)
    const res2 = await api('GET', '/api/public/verify/abc');
    assert.equal(res2.status, 400);
    assert.equal(res2.data.status, 'INVALID');

    // C. Reference containing SQL injection probes
    const res3 = await api('GET', '/api/public/verify/PRAGATI;DROP_TABLE');
    assert.equal(res3.status, 400);
    assert.equal(res3.data.status, 'INVALID');
  });

  test('6. Deep link query parameter lookup (?code=...) works seamlessly', async () => {
    const res = await api('GET', '/api/public/verify?code=PRAGATI-2026-N01-0001');

    assert.equal(res.status, 200);
    assert.equal(res.data.status, 'VALID');
    assert.equal(res.data.certificateNumber, 'PRAGATI-2026-N01-0001');
    assert.equal(res.data.candidateName, 'Rahul S. Verma');
  });

  test('7. Verification portal HTML page renders cleanly for QR scans and browser visitors', async () => {
    const res = await api('GET', '/verify?code=PRAGATI-2026-N01-0001');

    // Redirects /verify to /api/public/portal
    assert.equal(res.status, 302);
    assert.ok(res.headers.location.includes('/api/public/portal?code=PRAGATI-2026-N01-0001'));

    const resPortal = await api('GET', '/api/public/portal?code=PRAGATI-2026-N01-0001');
    assert.equal(resPortal.status, 200);
    assert.ok(resPortal.headers['content-type'].includes('text/html'));
    assert.ok(resPortal.buffer.toString('utf8').includes('Pragati Skills Mission'));
    assert.ok(resPortal.buffer.toString('utf8').includes('Public Certificate Verification'));
  });
});
