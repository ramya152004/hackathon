const express = require('express');
const { ROLES } = require('../auth/identities');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { dataStore } = require('../store/dataStore');

const router = express.Router();

/**
 * POST /api/certificates/:id/revoke
 * Revoke an issued certificate (State Office only)
 */
router.post('/:id/revoke', authenticateToken, requireRole(ROLES.STATE_OFFICE), (req, res) => {
  const certId = req.params.id;
  const { reason } = req.body;

  if (!reason || reason.trim().length === 0) {
    return res.status(400).json({
      error: 'MISSING_REASON',
      message: 'Revocation reason is required.'
    });
  }

  const cert = dataStore.findCertificateByCode(certId);
  if (!cert) {
    return res.status(404).json({
      error: 'CERTIFICATE_NOT_FOUND',
      message: `Certificate '${certId}' not found.`
    });
  }

  cert.status = 'REVOKED';
  cert.revokedAt = new Date().toISOString();
  cert.revocationReason = reason.trim();

  dataStore.logAudit(req.user, 'REVOKE_CERTIFICATE', 'CERTIFICATE', cert.id, { reason });

  return res.status(200).json({
    message: 'Certificate revoked successfully',
    certificate: {
      id: cert.id,
      certificateNumber: cert.certificateNumber,
      status: cert.status,
      revokedAt: cert.revokedAt,
      revocationReason: cert.revocationReason
    }
  });
});

module.exports = router;
