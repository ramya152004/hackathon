const express = require('express');
const { dataStore } = require('../store/dataStore');
const { eventBus } = require('../events/eventBus');

const router = express.Router();

// Strict regex pattern for safe certificate references (e.g. PRAGATI-2026-N01-0001 or cf_vtok_3f9a...)
const SAFE_CODE_REGEX = /^[A-Za-z0-9\-_]{6,80}$/;

/**
 * Validates and sanitizes a certificate lookup reference.
 * Rejects control characters, path traversal, script injection, and SQL injection probes.
 */
function validateReference(ref) {
  if (!ref || typeof ref !== 'string') {
    return { isValid: false, reason: 'Reference must be a non-empty string' };
  }

  const trimmed = ref.trim();
  if (trimmed.length < 6 || trimmed.length > 80) {
    return { isValid: false, reason: 'Reference length must be between 6 and 80 characters' };
  }

  if (!SAFE_CODE_REGEX.test(trimmed)) {
    return { isValid: false, reason: 'Reference contains illegal characters or malformed tokens' };
  }

  return { isValid: true, sanitized: trimmed };
}

/**
 * Core verification lookup logic
 */
function performVerification(code, req, res) {
  const check = validateReference(code);
  if (!check.isValid) {
    return res.status(400).json({
      isValid: false,
      status: 'INVALID',
      error: 'MALFORMED_CERTIFICATE_REFERENCE',
      message: check.reason
    });
  }

  const sanitizedCode = check.sanitized;
  const cert = dataStore.findCertificateByCode(sanitizedCode);

  if (!cert) {
    return res.status(404).json({
      isValid: false,
      status: 'NOT_FOUND',
      message: `No certificate found matching reference '${sanitizedCode}'.`
    });
  }

  const isCancelled = cert.status === 'REVOKED';

  // Strict projection: NEVER reveal private contact or identity data (no phone, no nationalId)
  const responseData = {
    isValid: !isCancelled,
    status: isCancelled ? 'CANCELLED' : 'VALID',
    certificateNumber: cert.certificateNumber,
    candidateName: cert.candidateName,
    courseName: cert.courseName,
    centreName: cert.centreName,
    districtName: cert.districtName,
    grade: cert.grade || 'PASS',
    issuedAt: cert.issuedAt
  };

  if (isCancelled) {
    responseData.cancelledAt = cert.revokedAt;
    responseData.cancellationReason = cert.revocationReason;
    responseData.revokedAt = cert.revokedAt;
    responseData.revocationReason = cert.revocationReason;
  }

  // Audit public verification query
  dataStore.logAudit(
    { id: 'anonymous', role: 'PUBLIC', username: 'anonymous' },
    'PUBLIC_VERIFY',
    'CERTIFICATE',
    cert.id,
    { result: responseData.status }
  );

  return res.status(200).json(responseData);
}

/**
 * GET /api/public/verify and GET /api/public/verify/:code
 * Unified public verification endpoint accepting deep links and path parameters
 */
router.get('/verify', (req, res) => {
  const code = req.query.code || req.query.id;
  return performVerification(code, req, res);
});

router.get(/^\/verify\/(.+)$/, (req, res) => {
  const code = req.params[0] || req.query.code;
  return performVerification(code, req, res);
});

/**
 * GET /api/events/live
 * Server-Sent Events (SSE) stream for real-time dashboard and verification updates
 */
router.get('/events/live', (req, res) => {
  eventBus.registerSseClient(req, res);
});

/**
 * GET /verify
 * Public responsive verification web page (QR scan target & manual lookup)
 */
router.get('/portal', (req, res) => {
  const initialCode = req.query.code || '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CertiFlow - Public Certificate Verification</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body { background: #f1f5f9; color: #0f172a; padding: 2rem 1rem; display: flex; flex-direction: column; align-items: center; }
    .card { background: white; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.1); width: 100%; max-width: 600px; padding: 2rem; }
    .header { text-align: center; border-bottom: 2px solid #e2e8f0; padding-bottom: 1.5rem; margin-bottom: 1.5rem; }
    .header h1 { font-size: 1.5rem; color: #1e3a8a; }
    .header p { font-size: 0.9rem; color: #64748b; margin-top: 0.25rem; }
    .search-box { display: flex; gap: 0.5rem; margin-bottom: 1.5rem; }
    .search-box input { flex: 1; padding: 0.75rem 1rem; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 1rem; }
    .search-box button { background: #2563eb; color: white; border: none; border-radius: 8px; padding: 0.75rem 1.5rem; font-weight: 600; cursor: pointer; }
    .search-box button:hover { background: #1d4ed8; }
    .result { display: none; margin-top: 1.5rem; border-radius: 8px; padding: 1.5rem; }
    .result.valid { display: block; background: #f0fdf4; border: 1px solid #86efac; }
    .result.cancelled { display: block; background: #fef2f2; border: 1px solid #fca5a5; }
    .result.invalid { display: block; background: #fffbeb; border: 1px solid #fde68a; }
    .badge { display: inline-block; padding: 0.25rem 0.75rem; border-radius: 9999px; font-size: 0.85rem; font-weight: bold; margin-bottom: 1rem; }
    .badge.valid { background: #16a34a; color: white; }
    .badge.cancelled { background: #dc2626; color: white; }
    .badge.invalid { background: #d97706; color: white; }
    .row { display: flex; justify-content: space-between; padding: 0.5rem 0; border-bottom: 1px solid rgba(0,0,0,0.05); }
    .label { color: #64748b; font-size: 0.9rem; }
    .val { font-weight: 600; text-align: right; }
    .live-indicator { display: flex; align-items: center; justify-content: center; gap: 0.5rem; font-size: 0.8rem; color: #10b981; margin-top: 1.5rem; }
    .dot { width: 8px; height: 8px; background: #10b981; border-radius: 50%; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h1>Pragati Skills Mission</h1>
      <p>Official Public Verification Portal</p>
    </div>

    <div class="search-box">
      <input type="text" id="certInput" placeholder="Enter Certificate Number or Token" value="${initialCode}">
      <button onclick="verify()">Verify</button>
    </div>

    <div id="resultContainer" class="result">
      <div id="badgeEl" class="badge"></div>
      <div id="details"></div>
    </div>

    <div class="live-indicator">
      <div class="dot"></div>
      <span>Real-time Tamper Protection Active (SSE Enabled)</span>
    </div>
  </div>

  <script>
    async function verify() {
      const code = document.getElementById('certInput').value.trim();
      const container = document.getElementById('resultContainer');
      const badge = document.getElementById('badgeEl');
      const details = document.getElementById('details');

      if (!code) return;

      try {
        const res = await fetch('/api/public/verify/' + encodeURIComponent(code));
        const data = await res.json();

        container.className = 'result ' + (data.status ? data.status.toLowerCase() : 'invalid');

        if (data.status === 'VALID') {
          badge.className = 'badge valid';
          badge.textContent = '✓ GENUINE & VALID';
          details.innerHTML = \`
            <div class="row"><span class="label">Certificate Number</span><span class="val">\${data.certificateNumber}</span></div>
            <div class="row"><span class="label">Candidate Name</span><span class="val">\${data.candidateName}</span></div>
            <div class="row"><span class="label">Programme</span><span class="val">\${data.courseName}</span></div>
            <div class="row"><span class="label">Training Centre</span><span class="val">\${data.centreName}</span></div>
            <div class="row"><span class="label">District</span><span class="val">\${data.districtName}</span></div>
            <div class="row"><span class="label">Date of Issue</span><span class="val">\${data.issuedAt ? data.issuedAt.slice(0, 10) : 'N/A'}</span></div>
          \`;
        } else if (data.status === 'CANCELLED') {
          badge.className = 'badge cancelled';
          badge.textContent = '✕ CERTIFICATE CANCELLED / REVOKED';
          details.innerHTML = \`
            <div class="row"><span class="label">Certificate Number</span><span class="val">\${data.certificateNumber}</span></div>
            <div class="row"><span class="label">Candidate Name</span><span class="val">\${data.candidateName}</span></div>
            <div class="row"><span class="label">Cancellation Date</span><span class="val">\${data.cancelledAt ? data.cancelledAt.slice(0, 10) : 'N/A'}</span></div>
            <div class="row"><span class="label">Reason</span><span class="val" style="color:#dc2626">\${data.cancellationReason || 'Revoked by State Office'}</span></div>
          \`;
        } else {
          badge.className = 'badge invalid';
          badge.textContent = '✕ INVALID / NOT FOUND';
          details.innerHTML = '<p>' + (data.message || 'No matching record exists in the official registry.') + '</p>';
        }
      } catch (err) {
        container.className = 'result invalid';
        badge.className = 'badge invalid';
        badge.textContent = 'ERROR';
        details.innerHTML = '<p>Verification request failed. Please check your network.</p>';
      }
    }

    if (document.getElementById('certInput').value) {
      verify();
    }
  </script>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).send(html);
});

module.exports = router;
