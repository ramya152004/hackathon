const crypto = require('node:crypto');
const { dataStore } = require('../store/dataStore');
const { generateAndStoreCertificatePdf } = require('./pdfGenerator');
const { signToken } = require('../auth/jwt');

/**
 * Issues tamper-proof, verifiable digital certificates for an APPROVED batch.
 * Guarantees idempotency: retries return existing certificates without creating duplicates.
 */
async function issueCertificatesForBatch(batchId, actor, baseUrl = 'http://localhost:3000') {
  return await dataStore.withBatchLock(batchId, async () => {
    const batch = dataStore.findBatchById(batchId);
    if (!batch) {
      throw new Error(`Batch '${batchId}' not found.`);
    }

    if (batch.status !== 'APPROVED') {
      const err = new Error(
        `Invalid batch state '${batch.status}'. Certificates can only be issued after State final approval ('APPROVED').`
      );
      err.code = 'INVALID_BATCH_STATE';
      throw err;
    }

    const candidates = dataStore.getCandidatesForBatch(batchId);
    if (candidates.length === 0) {
      const err = new Error(`Cannot issue certificates: batch has 0 candidates.`);
      err.code = 'EMPTY_BATCH';
      throw err;
    }

    const year = new Date().getFullYear();
    const batchSlug = batch.batchNumber.replace(/[^A-Za-z0-9]/g, '');
    const issuedCertificates = [];

    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];

      // IDEMPOTENCY CHECK:
      // If a certificate already exists for this candidate, reuse it
      const existing = dataStore.findCertificateByCandidateId(candidate.id);
      if (existing) {
        issuedCertificates.push(existing);
        continue;
      }

      // Generate globally unique certificate number
      const certNumber = `PRAGATI-${year}-${batchSlug}-${String(i + 1).padStart(4, '0')}`;

      // Cryptographically unguessable verification token (128-bit entropy)
      const verificationCode = `cf_vtok_${crypto.randomBytes(16).toString('hex')}`;
      const verificationUrl = `${baseUrl}/api/public/verify/${verificationCode}`;
      const issueDate = new Date().toISOString().slice(0, 10);

      // Render and store PDF
      const { filename, storagePath } = generateAndStoreCertificatePdf({
        certNumber,
        candidateName: candidate.fullName,
        courseName: batch.courseName,
        centreName: batch.centreName,
        districtName: batch.districtName,
        grade: candidate.grade,
        issueDate,
        verificationCode,
        verificationUrl
      });

      // Generate signed candidate download token
      const downloadToken = signToken(
        {
          sub: candidate.id,
          candidateName: candidate.fullName,
          phone: candidate.phone,
          certNumber,
          verificationCode,
          role: 'CANDIDATE'
        },
        86400 * 30 // 30 days validity
      );

      const certRecord = {
        id: `cert-${crypto.randomUUID()}`,
        certificateNumber: certNumber,
        candidateId: candidate.id,
        batchId: batch.id,
        verificationCode,
        verificationUrl,
        candidateName: candidate.fullName,
        courseName: batch.courseName,
        centreName: batch.centreName,
        districtName: batch.districtName,
        grade: candidate.grade,
        status: 'ACTIVE',
        issuedAt: new Date().toISOString(),
        revokedAt: null,
        revocationReason: null,
        pdfFilename: filename,
        pdfStoragePath: storagePath,
        downloadToken,
        // Sensitive PII kept private from public view
        phone: candidate.phone,
        nationalId: candidate.nationalId
      };

      // Enforces DB unique constraints
      dataStore.insertCertificate(certRecord);
      issuedCertificates.push(certRecord);
    }

    dataStore.recordBatchAudit(
      batch,
      actor,
      'ISSUE_CERTIFICATES',
      `Issued ${issuedCertificates.length} certificate(s) for batch ${batch.batchNumber}`
    );

    return issuedCertificates;
  });
}

module.exports = {
  issueCertificatesForBatch
};
