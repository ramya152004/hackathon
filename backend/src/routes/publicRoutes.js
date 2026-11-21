const express = require('express');
const { dataStore } = require('../store/dataStore');

const router = express.Router();

/**
 * GET /api/public/verify/:code
 * Completely unauthenticated public certificate lookup
 * Intentionally sanitizes all candidate PII (no phone, no national ID)
 */
router.get('/verify/:code', (req, res) => {
  const code = req.params.code;
  const cert = dataStore.findCertificateByCode(code);

  if (!cert) {
    return res.status(404).json({
      isValid: false,
      status: 'NOT_FOUND',
      message: `No certificate found matching identifier '${code}'.`
    });
  }

  const isRevoked = cert.status === 'REVOKED';

  // Strict projection: Only public, non-PII attributes
  const publicData = {
    isValid: !isRevoked,
    status: cert.status,
    certificateNumber: cert.certificateNumber,
    candidateName: cert.candidateName,
    courseName: cert.courseName,
    centreName: cert.centreName,
    districtName: cert.districtName,
    issuedAt: cert.issuedAt
  };

  if (isRevoked) {
    publicData.revokedAt = cert.revokedAt;
    publicData.revocationReason = cert.revocationReason;
  }

  // Audit public verification query
  dataStore.logAudit(
    { id: 'anonymous', role: 'PUBLIC', username: 'anonymous' },
    'PUBLIC_VERIFY',
    'CERTIFICATE',
    cert.id,
    { result: cert.status }
  );

  return res.status(200).json(publicData);
});

module.exports = router;
