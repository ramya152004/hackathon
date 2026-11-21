// In-Memory Data Store with Mutex Concurrency Locks, Database Uniqueness Constraints, and Audit Trail

class DataStore {
  constructor() {
    this.locks = new Map(); // batchId -> Promise chain (mutex)
    this.reset();
  }

  reset() {
    this.locks.clear();

    this.batches = [
      {
        id: 'batch-north-large-01',
        batchNumber: 'BATCH-2026-N01',
        courseName: 'Solar PV Installer',
        centreId: 'centre-apex-01',
        centreName: 'Apex Skills Academy',
        districtId: 'district-north',
        districtName: 'North District',
        candidateCount: 60,
        status: 'PENDING_DISTRICT',
        districtApprovals: [], // Array of { officerId, officerName, timestamp, cycleCount }
        cycleCount: 1,
        validationErrors: [],
        auditHistory: [],
        createdAt: new Date().toISOString()
      },
      {
        id: 'batch-north-small-02',
        batchNumber: 'BATCH-2026-N02',
        courseName: 'CNC Machine Operator',
        centreId: 'centre-apex-01',
        centreName: 'Apex Skills Academy',
        districtId: 'district-north',
        districtName: 'North District',
        candidateCount: 25,
        status: 'PENDING_DISTRICT',
        districtApprovals: [],
        cycleCount: 1,
        validationErrors: [],
        auditHistory: [],
        createdAt: new Date().toISOString()
      },
      {
        id: 'batch-south-03',
        batchNumber: 'BATCH-2026-S01',
        courseName: 'Retail Associate',
        centreId: 'centre-horizon-02',
        centreName: 'Horizon Skills Institute',
        districtId: 'district-south',
        districtName: 'South District',
        candidateCount: 40,
        status: 'PENDING_DISTRICT',
        districtApprovals: [],
        cycleCount: 1,
        validationErrors: [],
        auditHistory: [],
        createdAt: new Date().toISOString()
      }
    ];

    this.candidates = [];

    this.certificates = [
      {
        id: 'cert-uuid-001',
        certificateNumber: 'PRAGATI-2026-N01-0001',
        candidateId: 'cand-seed-001',
        batchId: 'batch-north-large-01',
        verificationCode: 'VERIF-7721-ABCD',
        verificationUrl: 'http://localhost:3000/api/public/verify/VERIF-7721-ABCD',
        candidateName: 'Rahul S. Verma',
        courseName: 'Solar PV Installer',
        centreName: 'Apex Skills Academy',
        districtName: 'North District',
        grade: 'A',
        status: 'ACTIVE',
        issuedAt: '2026-11-20T12:00:00Z',
        revokedAt: null,
        revocationReason: null,
        phone: '+91 98765 43210',
        nationalId: 'XXXX-XXXX-9912'
      },
      {
        id: 'cert-uuid-002',
        certificateNumber: 'PRAGATI-2026-N01-0002',
        candidateId: 'cand-seed-002',
        batchId: 'batch-north-large-01',
        verificationCode: 'VERIF-8832-EFGH',
        verificationUrl: 'http://localhost:3000/api/public/verify/VERIF-8832-EFGH',
        candidateName: 'Pooja K. Sharma',
        courseName: 'Solar PV Installer',
        centreName: 'Apex Skills Academy',
        districtName: 'North District',
        grade: 'A+',
        status: 'REVOKED',
        issuedAt: '2026-11-19T10:00:00Z',
        revokedAt: '2026-11-20T14:30:00Z',
        revocationReason: 'Training centre audit revealed irregular attendance records',
        phone: '+91 98123 45678',
        nationalId: 'XXXX-XXXX-4421'
      }
    ];

    this.auditLogs = [];
  }

  /**
   * Concurrency protection: Serializes operations per batch ID (simulating DB row lock)
   */
  async withBatchLock(batchId, callback) {
    const previousPromise = this.locks.get(batchId) || Promise.resolve();

    let releaseLock;
    const currentPromise = new Promise((resolve) => {
      releaseLock = resolve;
    });

    this.locks.set(batchId, previousPromise.then(() => currentPromise));

    try {
      await previousPromise;
      return await callback();
    } finally {
      releaseLock();
    }
  }

  logAudit(actor, action, entityType, entityId, metadata = {}) {
    const entry = {
      id: `audit-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      timestamp: new Date().toISOString(),
      actorId: actor.id || actor.sub || 'anonymous',
      actorUsername: actor.username || 'anonymous',
      actorRole: actor.role || 'PUBLIC',
      action,
      entityType,
      entityId,
      metadata
    };
    this.auditLogs.push(entry);
    return entry;
  }

  recordBatchAudit(batch, actor, decision, reason = null) {
    const historyEntry = {
      id: `hist-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      timestamp: new Date().toISOString(),
      actorId: actor.sub || actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      decision,
      reason: reason || null,
      batchRevision: batch.cycleCount,
      status: batch.status
    };

    if (!batch.auditHistory) {
      batch.auditHistory = [];
    }
    batch.auditHistory.push(historyEntry);

    this.logAudit(actor, decision, 'BATCH', batch.id, {
      decision,
      reason,
      revision: batch.cycleCount,
      newStatus: batch.status
    });

    return historyEntry;
  }

  findBatchById(id) {
    return this.batches.find((b) => b.id === id);
  }

  getCandidatesForBatch(batchId) {
    return this.candidates.filter((c) => c.batchId === batchId);
  }

  setCandidatesForBatch(batchId, newCandidates) {
    this.candidates = this.candidates.filter((c) => c.batchId !== batchId);
    const created = newCandidates.map((c, idx) => ({
      id: `cand-${batchId}-${idx + 1}`,
      batchId,
      ...c,
      createdAt: new Date().toISOString()
    }));
    this.candidates.push(...created);
    return created;
  }

  findCertificateByCandidateId(candidateId) {
    return this.certificates.find((c) => c.candidateId === candidateId);
  }

  findCertificatesByBatchId(batchId) {
    return this.certificates.filter((c) => c.batchId === batchId);
  }

  findCertificateByCode(code) {
    return this.certificates.find(
      (c) => c.certificateNumber === code || c.verificationCode === code || c.id === code
    );
  }

  /**
   * Enforces PostgreSQL-level uniqueness constraints:
   * 1. UNIQUE(candidate_id)
   * 2. UNIQUE(certificate_number)
   * 3. UNIQUE(verification_code)
   */
  insertCertificate(cert) {
    if (this.certificates.some((c) => c.candidateId === cert.candidateId)) {
      throw new Error(
        'UNIQUE_CONSTRAINT_VIOLATION: duplicate key value violates unique constraint "uq_certificates_candidate_id"'
      );
    }
    if (this.certificates.some((c) => c.certificateNumber === cert.certificateNumber)) {
      throw new Error(
        'UNIQUE_CONSTRAINT_VIOLATION: duplicate key value violates unique constraint "uq_certificates_number"'
      );
    }
    if (this.certificates.some((c) => c.verificationCode === cert.verificationCode)) {
      throw new Error(
        'UNIQUE_CONSTRAINT_VIOLATION: duplicate key value violates unique constraint "uq_certificates_verification_code"'
      );
    }

    this.certificates.push(cert);
    return cert;
  }
}

const dataStore = new DataStore();

module.exports = {
  dataStore
};
