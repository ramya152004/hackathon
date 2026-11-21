// In-Memory Data Store for Batches and Certificates

class DataStore {
  constructor() {
    this.reset();
  }

  reset() {
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
        districtApprovals: [], // Stores officer user IDs who approved
        cycleCount: 1,
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
        createdAt: new Date().toISOString()
      }
    ];

    this.certificates = [
      {
        id: 'cert-uuid-001',
        certificateNumber: 'PRAGATI-2026-N01-0001',
        verificationCode: 'VERIF-7721-ABCD',
        candidateName: 'Rahul S. Verma',
        courseName: 'Solar PV Installer',
        centreName: 'Apex Skills Academy',
        districtName: 'North District',
        status: 'ACTIVE',
        issuedAt: '2026-11-20T12:00:00Z',
        revokedAt: null,
        revocationReason: null,
        // Sensitive PII that must NEVER be leaked to public verification:
        phone: '+91 98765 43210',
        nationalId: 'XXXX-XXXX-9912'
      },
      {
        id: 'cert-uuid-002',
        certificateNumber: 'PRAGATI-2026-N01-0002',
        verificationCode: 'VERIF-8832-EFGH',
        candidateName: 'Pooja K. Sharma',
        courseName: 'Solar PV Installer',
        centreName: 'Apex Skills Academy',
        districtName: 'North District',
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

  logAudit(actor, action, entityType, entityId, metadata = {}) {
    this.auditLogs.push({
      id: `audit-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      timestamp: new Date().toISOString(),
      actorId: actor.id || 'anonymous',
      actorUsername: actor.username || 'anonymous',
      actorRole: actor.role || 'PUBLIC',
      action,
      entityType,
      entityId,
      metadata
    });
  }

  findBatchById(id) {
    return this.batches.find((b) => b.id === id);
  }

  findCertificateByCode(code) {
    return this.certificates.find(
      (c) => c.certificateNumber === code || c.verificationCode === code || c.id === code
    );
  }
}

const dataStore = new DataStore();

module.exports = {
  dataStore
};
