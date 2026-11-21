const express = require('express');
const fs = require('node:fs');
const { ROLES } = require('../auth/identities');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { dataStore } = require('../store/dataStore');
const { issueCertificatesForBatch } = require('../services/certificateService');
const { verifyToken } = require('../auth/jwt');

const router = express.Router();

/**
 * POST /api/certificates/issue/:batchId
 * Trigger certificate issuance for an APPROVED batch (State Office only)
 */
router.post('/issue/:batchId', authenticateToken, requireRole(ROLES.STATE_OFFICE), async (req, res) => {
  const { batchId } = req.params;

  try {
    const host = (typeof req.get === 'function' ? req.get('host') : req.headers['host']) || 'localhost:3000';
    const protocol = req.protocol || 'http';
    const baseUrl = `${protocol}://${host}`;

    const certificates = await issueCertificatesForBatch(batchId, req.user, baseUrl);

    return res.status(200).json({
      success: true,
      message: `Successfully issued ${certificates.length} certificate(s).`,
      count: certificates.length,
      certificates
    });
  } catch (err) {
    if (err.code === 'INVALID_BATCH_STATE') {
      return res.status(400).json({
        error: 'INVALID_BATCH_STATE',
        message: err.message
      });
    }
    if (err.code === 'EMPTY_BATCH') {
      return res.status(400).json({
        error: 'EMPTY_BATCH',
        message: err.message
      });
    }

    return res.status(500).json({
      error: 'ISSUANCE_FAILED',
      message: err.message
    });
  }
});

/**
 * GET /api/certificates/:id/download
 * Secure authorized candidate certificate download
 * Authorized parties:
 * - Candidate holding matching verification code (?code=...) or token (?token=...)
 * - Owning Training Centre
 * - District Officer of matching district
 * - State Office
 */
router.get('/:id/download', (req, res) => {
  const certId = req.params.id;
  const cert = dataStore.findCertificateByCode(certId);

  if (!cert) {
    return res.status(404).json({
      error: 'CERTIFICATE_NOT_FOUND',
      message: `Certificate '${certId}' not found.`
    });
  }

  // Check authorization
  let isAuthorized = false;

  // 1. Check query parameter: code (verification code)
  const codeParam = req.query.code;
  if (codeParam && codeParam === cert.verificationCode) {
    isAuthorized = true;
  }

  // 2. Check query parameter: token (candidate download token)
  const tokenParam = req.query.token;
  if (tokenParam) {
    try {
      const decoded = verifyToken(tokenParam);
      if (decoded.certNumber === cert.certificateNumber || decoded.sub === cert.candidateId) {
        isAuthorized = true;
      }
    } catch {
      // Invalid token
    }
  }

  // 3. Check Authorization header (logged-in user)
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const token = authHeader.split(' ')[1];
      const decoded = verifyToken(token);

      if (decoded.role === ROLES.STATE_OFFICE) {
        isAuthorized = true;
      } else if (decoded.role === ROLES.TRAINING_CENTRE) {
        const batch = dataStore.findBatchById(cert.batchId);
        if (batch && batch.centreId === decoded.centreId) {
          isAuthorized = true;
        }
      } else if (decoded.role === ROLES.DISTRICT_OFFICER) {
        const batch = dataStore.findBatchById(cert.batchId);
        if (batch && batch.districtId === decoded.districtId) {
          isAuthorized = true;
        }
      } else if (decoded.role === 'CANDIDATE' && decoded.sub === cert.candidateId) {
        isAuthorized = true;
      }
    } catch {
      // Invalid auth header
    }
  }

  if (!isAuthorized) {
    return res.status(403).json({
      error: 'DOWNLOAD_FORBIDDEN',
      message: 'You are not authorized to download this candidate certificate.'
    });
  }

  // Serve the PDF file
  if (cert.pdfStoragePath && fs.existsSync(cert.pdfStoragePath)) {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${cert.certificateNumber}.pdf"`);
    return fs.createReadStream(cert.pdfStoragePath).pipe(res);
  }

  // If path is missing, generate on the fly
  const { buildPdfBuffer } = require('../services/pdfGenerator');
  const buffer = buildPdfBuffer({
    certNumber: cert.certificateNumber,
    candidateName: cert.candidateName,
    courseName: cert.courseName,
    centreName: cert.centreName,
    districtName: cert.districtName,
    grade: cert.grade || 'PASS',
    issueDate: cert.issuedAt ? cert.issuedAt.slice(0, 10) : '2026-11-21',
    verificationCode: cert.verificationCode,
    verificationUrl: cert.verificationUrl || `http://localhost:3000/api/public/verify/${cert.verificationCode}`
  });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${cert.certificateNumber}.pdf"`);
  return res.status(200).send(buffer);
});

/**
 * POST /api/certificates/:id/revoke
 * Revoke an issued certificate (State Office only)
 * Mandatory reason, actor, and timestamp recorded
 */
router.post('/:id/revoke', authenticateToken, requireRole(ROLES.STATE_OFFICE), (req, res) => {
  const certId = req.params.id;
  const { reason } = req.body;

  if (!reason || reason.trim().length === 0) {
    return res.status(400).json({
      error: 'MISSING_REASON',
      message: 'A clear revocation reason is strictly required.'
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
  cert.revokedBy = req.user.name;
  cert.revokedById = req.user.sub;
  cert.revocationReason = reason.trim();

  dataStore.logAudit(req.user, 'REVOKE_CERTIFICATE', 'CERTIFICATE', cert.id, {
    reason: reason.trim(),
    certificateNumber: cert.certificateNumber
  });

  return res.status(200).json({
    message: 'Certificate revoked successfully. Public verification updated.',
    certificate: {
      id: cert.id,
      certificateNumber: cert.certificateNumber,
      status: cert.status,
      revokedAt: cert.revokedAt,
      revokedBy: cert.revokedBy,
      revocationReason: cert.revocationReason
    }
  });
});

module.exports = router;
