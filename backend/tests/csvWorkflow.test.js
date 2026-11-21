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

// Helper to authenticate as Anika (Training Centre)
async function getAnikaToken() {
  const res = await api('POST', '/api/auth/login', { body: { username: 'anika' } });
  assert.equal(res.status, 200);
  return res.data.token;
}

describe('CertiFlow Training Centre CSV Import & Workflow Suite', () => {
  beforeEach(() => {
    dataStore.reset();
  });

  test('1. Missing columns: Rejects CSV missing required headers with descriptive error', async () => {
    const token = await getAnikaToken();

    // CSV missing 'national_id' and 'dob'
    const csvContent = [
      'full_name,phone,email,marks_percentage,grade',
      'Karan Singh,9876543210,karan@example.com,85,A'
    ].join('\n');

    const res = await api('POST', '/api/batches/upload-csv', {
      headers: { Authorization: `Bearer ${token}` },
      body: {
        courseName: 'Solar PV Installer',
        csvContent
      }
    });

    assert.equal(res.status, 422);
    assert.equal(res.data.error, 'SPREADSHEET_VALIDATION_FAILED');
    assert.equal(res.data.status, 'NEEDS_CORRECTION');

    const headerError = res.data.errors.find((e) => e.field === 'headers');
    assert.ok(headerError, 'Must report header validation error');
    assert.equal(headerError.row, 1);
    assert.ok(headerError.reason.includes('national_id'));
    assert.ok(headerError.reason.includes('dob'));
  });

  test('2. Malformed file: Detects column count mismatch on malformed rows', async () => {
    const token = await getAnikaToken();

    // Row 3 has only 3 columns instead of 7
    const csvContent = [
      'full_name,phone,email,national_id,dob,marks_percentage,grade',
      'Rahul Verma,9876543210,rahul@example.com,AADHAAR-1001,2003-01-15,88,A',
      'Broken Line,OnlyThreeCols,broken@example.com',
      'Pooja Sen,9812345678,pooja@example.com,AADHAAR-1002,2002-05-20,91,A+'
    ].join('\n');

    const res = await api('POST', '/api/batches/upload-csv', {
      headers: { Authorization: `Bearer ${token}` },
      body: {
        courseName: 'Solar PV Installer',
        csvContent
      }
    });

    assert.equal(res.status, 422);
    const row3Error = res.data.errors.find((e) => e.row === 3);
    assert.ok(row3Error, 'Row 3 must have a reported column mismatch error');
    assert.equal(row3Error.field, 'row');
    assert.ok(row3Error.reason.includes('Column count mismatch'));
  });

  test('3. Row-by-row error report: Reports exact row number, field name and reason for format errors', async () => {
    const token = await getAnikaToken();

    const csvContent = [
      'full_name,phone,email,national_id,dob,marks_percentage,grade',
      'Valid Name,12345,bad-email,ID,2025-01-01,-15,A'
    ].join('\n');

    const res = await api('POST', '/api/batches/upload-csv', {
      headers: { Authorization: `Bearer ${token}` },
      body: {
        courseName: 'Solar PV Installer',
        csvContent
      }
    });

    assert.equal(res.status, 422);
    assert.equal(res.data.error, 'SPREADSHEET_VALIDATION_FAILED');

    const errors = res.data.errors;
    // Row 2 should have multiple specific field errors:
    const phoneErr = errors.find((e) => e.row === 2 && e.field === 'phone');
    const emailErr = errors.find((e) => e.row === 2 && e.field === 'email');
    const natIdErr = errors.find((e) => e.row === 2 && e.field === 'national_id');
    const dobErr = errors.find((e) => e.row === 2 && e.field === 'dob');
    const marksErr = errors.find((e) => e.row === 2 && e.field === 'marks_percentage');

    assert.ok(phoneErr, 'Must report phone format error on row 2');
    assert.ok(emailErr, 'Must report email format error on row 2');
    assert.ok(natIdErr, 'Must report national_id length error on row 2');
    assert.ok(dobErr, 'Must report candidate age error on row 2');
    assert.ok(marksErr, 'Must report marks range error on row 2');
  });

  test('4. Duplicate rows: Identifies duplicate phone and national ID within the file referencing previous row', async () => {
    const token = await getAnikaToken();

    const csvContent = [
      'full_name,phone,email,national_id,dob,marks_percentage,grade',
      'Candidate One,9876543210,one@example.com,AADHAAR-1001,2002-01-01,80,B',
      'Candidate Two,9811122233,two@example.com,AADHAAR-2002,2003-02-02,85,A',
      'Duplicate Phone,9876543210,three@example.com,AADHAAR-3003,2001-03-03,75,C',
      'Duplicate NatId,9844455566,four@example.com,AADHAAR-1001,2000-04-04,90,A+'
    ].join('\n');

    const res = await api('POST', '/api/batches/upload-csv', {
      headers: { Authorization: `Bearer ${token}` },
      body: {
        courseName: 'Solar PV Installer',
        csvContent
      }
    });

    assert.equal(res.status, 422);

    // Row 4 has duplicate phone from Row 2
    const dupPhoneErr = res.data.errors.find((e) => e.row === 4 && e.field === 'phone');
    assert.ok(dupPhoneErr, 'Row 4 must have duplicate phone error');
    assert.ok(dupPhoneErr.reason.includes('already appears in row 2'));

    // Row 5 has duplicate national ID from Row 2
    const dupNatIdErr = res.data.errors.find((e) => e.row === 5 && e.field === 'national_id');
    assert.ok(dupNatIdErr, 'Row 5 must have duplicate national ID error');
    assert.ok(dupNatIdErr.reason.includes('already appears in row 2'));
  });

  test('5. Partial-save prevention: If 1 out of 5 rows is invalid, 0 candidate rows are committed', async () => {
    const token = await getAnikaToken();

    // 4 perfectly valid rows + 1 row with invalid phone
    const csvContent = [
      'full_name,phone,email,national_id,dob,marks_percentage,grade',
      'Alice Roy,9811111111,alice@example.com,AADHAAR-0001,2001-01-01,85,A',
      'Bob Roy,9822222222,bob@example.com,AADHAAR-0002,2001-02-02,88,A',
      'Charlie Roy,9833333333,charlie@example.com,AADHAAR-0003,2001-03-03,90,A+',
      'David Roy,9844444444,david@example.com,AADHAAR-0004,2001-04-04,78,B',
      'Eva Roy,99999,eva@example.com,AADHAAR-0005,2001-05-05,92,A+' // Bad phone on row 6
    ].join('\n');

    const res = await api('POST', '/api/batches/upload-csv', {
      headers: { Authorization: `Bearer ${token}` },
      body: {
        courseName: 'Solar PV Installer',
        csvContent
      }
    });

    assert.equal(res.status, 422);
    const batchId = res.data.batchId;
    assert.ok(batchId, 'A batch in NEEDS_CORRECTION state is created for tracking');

    // VERIFY PARTIAL SAVE PREVENTION:
    // Assert exactly 0 candidates exist in the datastore for this batch
    const savedCandidates = dataStore.getCandidatesForBatch(batchId);
    assert.equal(savedCandidates.length, 0, 'Zero candidates must be committed on validation failure');

    const batch = dataStore.findBatchById(batchId);
    assert.equal(batch.candidateCount, 0);
    assert.equal(batch.status, 'NEEDS_CORRECTION');
    assert.ok(batch.validationErrors.length > 0);
  });

  test('6. Valid upload success: Fully valid CSV creates batch in DRAFT and commits all candidates', async () => {
    const token = await getAnikaToken();

    const csvContent = [
      'full_name,phone,email,national_id,dob,marks_percentage,grade',
      'Rahul S. Verma,9876543210,rahul.verma@example.com,AADHAAR-8812-4411,2004-05-14,87.5,A',
      'Sunita P. Sharma,9812345678,sunita.sharma@example.com,AADHAAR-9923-5522,2003-11-20,92.0,A+',
      'Amit Kumar,9765432109,amit.kumar@example.com,AADHAAR-7711-3344,2002-08-09,74.5,B'
    ].join('\n');

    const res = await api('POST', '/api/batches/upload-csv', {
      headers: { Authorization: `Bearer ${token}` },
      body: {
        courseName: 'Solar PV Installer',
        csvContent
      }
    });

    assert.equal(res.status, 201);
    assert.equal(res.data.success, true);
    assert.equal(res.data.batch.status, 'DRAFT');
    assert.equal(res.data.candidatesCount, 3);

    // Verify candidates are committed in the store
    const candidates = dataStore.getCandidatesForBatch(res.data.batch.id);
    assert.equal(candidates.length, 3);
    assert.equal(candidates[0].fullName, 'Rahul S. Verma');
    assert.equal(candidates[0].phone, '9876543210');
    assert.equal(candidates[1].fullName, 'Sunita P. Sharma');
    assert.equal(candidates[2].fullName, 'Amit Kumar');
  });

  test('7. Correction workflow: Re-uploading valid CSV cures NEEDS_CORRECTION batch and allows submission', async () => {
    const token = await getAnikaToken();

    // 1. Initial upload with error
    const badCsv = [
      'full_name,phone,email,national_id,dob,marks_percentage,grade',
      'Karan Singh,00000,karan@example.com,AADHAAR-9999,2001-01-01,80,B'
    ].join('\n');

    const resBad = await api('POST', '/api/batches/upload-csv', {
      headers: { Authorization: `Bearer ${token}` },
      body: { courseName: 'CNC Operator', csvContent: badCsv }
    });
    assert.equal(resBad.status, 422);
    const batchId = resBad.data.batchId;

    // 2. Cannot submit batch while in NEEDS_CORRECTION
    const resSubmitBad = await api(`POST`, `/api/batches/${batchId}/submit`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(resSubmitBad.status, 400);
    assert.equal(resSubmitBad.data.error, 'CANNOT_SUBMIT');

    // 3. Re-upload corrected CSV
    const goodCsv = [
      'full_name,phone,email,national_id,dob,marks_percentage,grade',
      'Karan Singh,9899988877,karan@example.com,AADHAAR-9999,2001-01-01,80,B'
    ].join('\n');

    const resFix = await api(`PUT`, `/api/batches/${batchId}/upload-csv`, {
      headers: { Authorization: `Bearer ${token}` },
      body: { csvContent: goodCsv }
    });
    assert.equal(resFix.status, 200);
    assert.equal(resFix.data.batch.status, 'DRAFT');
    assert.equal(resFix.data.candidatesCount, 1);

    // 4. Submit corrected batch for review -> Success PENDING_DISTRICT
    const resSubmitGood = await api(`POST`, `/api/batches/${batchId}/submit`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(resSubmitGood.status, 200);
    assert.equal(resSubmitGood.data.batch.status, 'PENDING_DISTRICT');
  });
});
