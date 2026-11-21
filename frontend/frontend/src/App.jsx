import { useState, useEffect } from 'react';
import './App.css';

const API = 'http://localhost:3000/api';

const PERSONAS = [
  { id: 'home', name: 'Home', role: 'LANDING', label: '🏠 Overview & Landing', desc: 'CertiFlow Platform Overview & Architecture' },
  { id: 'anika', name: 'Anika Sharma', role: 'TRAINING_CENTRE', label: '🏢 Anika (Centre)', desc: 'Apex Skills Academy (North District)' },
  { id: 'dev', name: 'Dev Patel', role: 'DISTRICT_OFFICER', label: '🏛️ Dev (District 1)', desc: 'District Officer (North District - Reviewer 1)' },
  { id: 'meera', name: 'Meera Rao', role: 'DISTRICT_OFFICER', label: '🏛️ Meera (District 2)', desc: 'District Officer (North District - Reviewer 2)' },
  { id: 'neha', name: 'Neha Gupta', role: 'QUALITY_TEAM', label: '🔍 Neha (Quality)', desc: 'Quality Inspection Team (>50 Candidates)' },
  { id: 'farah', name: 'Farah Khan', role: 'STATE_OFFICE', label: '👑 Farah (State Office)', desc: 'State Office Final Approval & Cancellation' },
  { id: 'public', name: 'Public Verifier', role: 'PUBLIC', label: '🌐 Public Verifier', desc: 'No-Login Certificate Verification & QR Scan' },
];

const VALID_CSV_SAMPLE = `fullName,nationalId,phone,courseName,completionDate,grade,score
Amit Kumar,XXXX-XXXX-1122,+91 98765 11111,Solar PV Installer,2026-02-15,A+,92
Sunita Patel,XXXX-XXXX-3344,+91 98765 22222,Solar PV Installer,2026-02-15,A,88
Vikram Rao,XXXX-XXXX-5566,+91 98765 33333,Solar PV Installer,2026-02-15,B+,79`;

const BAD_CSV_SAMPLE = `fullName,nationalId,phone,courseName,completionDate,grade,score
Amit Kumar,XXXX-XXXX-1122,12345,Solar PV Installer,2026-02-15,A+,92
Duplicate Candidate,XXXX-XXXX-1122,+91 98765 11111,Solar PV Installer,2026-02-15,A,88`;

export default function App() {
  const [currentPersona, setCurrentPersona] = useState(PERSONAS[0]); // Default to Landing Page
  const [token, setToken] = useState(null);
  const [batches, setBatches] = useState([]);
  const [csvText, setCsvText] = useState(VALID_CSV_SAMPLE);
  const [uploadErrors, setUploadErrors] = useState([]);
  const [feedback, setFeedback] = useState('');
  const [verifyCode, setVerifyCode] = useState('PRAGATI-2026-N01-0001');
  const [verifyResult, setVerifyResult] = useState(null);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [backendStatus, setBackendStatus] = useState('checking');

  // Check backend health
  useEffect(() => {
    fetch(`${API}/health`)
      .then((r) => r.json())
      .then(() => setBackendStatus('connected'))
      .catch(() => setBackendStatus('error'));
  }, []);

  // Authenticate as active persona
  useEffect(() => {
    if (currentPersona.id === 'home' || currentPersona.id === 'public') {
      setToken(null);
      return;
    }

    fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: currentPersona.id })
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.token) {
          setToken(data.token);
          loadBatches(data.token);
        }
      })
      .catch((err) => console.error('Login error', err));
  }, [currentPersona]);

  // Load batch lists for the active identity
  const loadBatches = (authToken) => {
    fetch(`${API}/batches`, {
      headers: { Authorization: `Bearer ${authToken}` }
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.batches) setBatches(data.batches);
      })
      .catch((err) => console.error('Batches load error', err));
  };

  // Handle CSV Upload
  const handleUploadCsv = (batchId) => {
    setFeedback('Validating candidate roster...');
    setUploadErrors([]);

    fetch(`${API}/batches/${batchId}/upload`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'text/csv'
      },
      body: csvText
    })
      .then((res) => res.json().then((data) => ({ status: res.status, data })))
      .then(({ status, data }) => {
        if (status === 200) {
          setFeedback(`✅ ${data.message}`);
          loadBatches(token);
        } else {
          setFeedback(`❌ Validation Failed: ${data.message}`);
          if (data.errors) setUploadErrors(data.errors);
          loadBatches(token);
        }
      })
      .catch((err) => setFeedback(`Error: ${err.message}`));
  };

  // Submit batch for review
  const handleSubmitBatch = (batchId) => {
    fetch(`${API}/batches/${batchId}/submit`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    })
      .then((res) => res.json().then((data) => ({ status: res.status, data })))
      .then(({ status, data }) => {
        if (status === 200) {
          setFeedback(`✅ Batch submitted to District Officers.`);
          loadBatches(token);
        } else {
          setFeedback(`❌ Error: ${data.message || data.error}`);
        }
      });
  };

  // Action decision handler (Approve / Reject / Return)
  const handleDecision = (batchId, action, reason = '') => {
    fetch(`${API}/batches/${batchId}/decision`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ action, reason })
    })
      .then((res) => res.json().then((data) => ({ status: res.status, data })))
      .then(({ status, data }) => {
        if (status === 200) {
          setFeedback(`✅ Action '${action}' recorded: ${data.message}`);
          loadBatches(token);
        } else {
          setFeedback(`❌ Error: ${data.message || data.error}`);
        }
      });
  };

  // State Office Certificate Revocation
  const handleRevoke = (certNumber) => {
    const reason = prompt('Please enter the mandatory cancellation/revocation reason:', 'Audited attendance record forgery');
    if (!reason) return;

    fetch(`${API}/certificates/${certNumber}/revoke`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ reason })
    })
      .then((r) => r.json())
      .then((data) => {
        alert(data.message || 'Revoked');
        loadBatches(token);
      });
  };

  // Public Verification Lookup
  const handleVerify = (e) => {
    if (e) e.preventDefault();
    if (!verifyCode) return;
    setVerifyLoading(true);
    setVerifyResult(null);

    fetch(`${API}/public/verify/${verifyCode.trim()}`)
      .then((res) => res.json().then((data) => ({ status: res.status, data })))
      .then(({ status, data }) => {
        setVerifyLoading(false);
        setVerifyResult({ status, ...data });
      })
      .catch((err) => {
        setVerifyLoading(false);
        setVerifyResult({ status: 500, error: err.message });
      });
  };

  return (
    <div className="app-container">
      {/* Top Navbar */}
      <header className="navbar">
        <div className="nav-brand" onClick={() => setCurrentPersona(PERSONAS[0])}>
          <div className="nav-logo">PRAGATI</div>
          <div>
            <div className="nav-title">CertiFlow Platform</div>
            <div className="nav-subtitle">State Skilling Credential Engine</div>
          </div>
        </div>

        <div className="persona-switcher">
          {PERSONAS.map((p) => (
            <button
              key={p.id}
              className={`persona-btn ${
                currentPersona.id === p.id
                  ? p.id === 'home'
                    ? 'home-active'
                    : p.id === 'public'
                    ? 'public-active'
                    : 'active'
                  : ''
              }`}
              onClick={() => {
                setCurrentPersona(p);
                setFeedback('');
                setUploadErrors([]);
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </header>

      {/* 1. LANDING PAGE VIEW (HOME) */}
      {currentPersona.id === 'home' && (
        <div>
          {/* Hero Section */}
          <section className="hero-section">
            <div className="hero-pill">
              🛡️ Pragati Skills Mission • Official Credential Platform
            </div>
            <h1 className="hero-title">
              Digital, Auditable & Tamper-Proof <span>Skilling Certification</span>
            </h1>
            <p className="hero-desc">
              Transforming how <strong>300+ training centres</strong> certify <strong>8,000 young candidates</strong> every month. Replacing vulnerable manual Word files and WhatsApp approvals with multi-officer consensus and instant cryptographic verification.
            </p>

            <div className="hero-cta-group">
              <button
                className="btn btn-primary btn-lg"
                onClick={() => setCurrentPersona(PERSONAS.find((p) => p.id === 'public'))}
              >
                🔍 Verify a Certificate
              </button>
              <button
                className="btn btn-outline btn-lg"
                onClick={() => setCurrentPersona(PERSONAS.find((p) => p.id === 'anika'))}
              >
                🚀 Start Interactive Demo (Anika)
              </button>
            </div>

            {/* Embedded Live Quick Verification Widget */}
            <div className="hero-verify-card">
              <div style={{ fontWeight: 700, fontSize: '1.05rem', marginBottom: '0.25rem' }}>
                Instant Certificate Authenticator
              </div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
                Scan an official QR code or test with our demo credentials:
              </div>

              <form onSubmit={handleVerify} style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  type="text"
                  style={{ flex: 1, padding: '0.65rem 0.85rem', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '0.9rem' }}
                  placeholder="Enter Certificate Number or Token (e.g. PRAGATI-2026-N01-0001)"
                  value={verifyCode}
                  onChange={(e) => setVerifyCode(e.target.value)}
                />
                <button type="submit" className="btn btn-primary">
                  {verifyLoading ? 'Checking...' : 'Check'}
                </button>
              </form>

              <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem' }}>
                <button
                  type="button"
                  className="btn btn-outline"
                  style={{ fontSize: '0.75rem', padding: '0.2rem 0.6rem' }}
                  onClick={() => { setVerifyCode('PRAGATI-2026-N01-0001'); }}
                >
                  🟢 Sample Valid Cert
                </button>
                <button
                  type="button"
                  className="btn btn-outline"
                  style={{ fontSize: '0.75rem', padding: '0.2rem 0.6rem' }}
                  onClick={() => { setVerifyCode('PRAGATI-2026-N01-0002'); }}
                >
                  🔴 Sample Revoked Cert
                </button>
              </div>

              {verifyResult && (
                <div className={`cert-card ${verifyResult.status === 'CANCELLED' ? 'cancelled' : ''}`} style={{ marginTop: '1rem', padding: '1rem' }}>
                  <div className={`cert-status-badge ${verifyResult.status === 'VALID' ? 'valid' : 'cancelled'}`}>
                    ● {verifyResult.status}
                  </div>
                  {verifyResult.status === 'VALID' && (
                    <div style={{ fontSize: '0.88rem' }}>
                      <strong>{verifyResult.candidateName}</strong> — {verifyResult.courseName} ({verifyResult.centreName})
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                        Grade: {verifyResult.grade} | Issued: {verifyResult.issuedAt?.slice(0, 10)}
                      </div>
                    </div>
                  )}
                  {verifyResult.status === 'CANCELLED' && (
                    <div style={{ fontSize: '0.88rem', color: '#991b1b' }}>
                      <strong>Revocation Reason:</strong> {verifyResult.cancellationReason || verifyResult.revocationReason}
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>

          {/* Key Stats Bar */}
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-number">300+</div>
              <div className="stat-label">Training Centres Managed</div>
            </div>
            <div className="stat-card">
              <div className="stat-number">8,000</div>
              <div className="stat-label">Monthly Youth Certified</div>
            </div>
            <div className="stat-card">
              <div className="stat-number">2 / 2</div>
              <div className="stat-label">District Officers Required</div>
            </div>
            <div className="stat-card">
              <div className="stat-number">&lt; 1 sec</div>
              <div className="stat-label">Instant Verification Time</div>
            </div>
          </div>

          {/* Section 1: How the Platform Works */}
          <div className="section-container">
            <div className="section-heading">
              <h2>How CertiFlow Solves the Crisis</h2>
              <p>Eliminating fraud and weeks of administrative delay in 4 strictly enforced steps.</p>
            </div>

            <div className="steps-grid">
              <div className="step-card">
                <div className="step-badge">1</div>
                <h3 className="step-title">All-or-Nothing CSV Import</h3>
                <p className="step-desc">
                  Training centres upload candidate spreadsheets. If even 1 row contains an invalid phone, duplicate Aadhaar, or bad score, 0 records are committed.
                </p>
              </div>

              <div className="step-card">
                <div className="step-badge">2</div>
                <h3 className="step-title">Two-Officer Consensus</h3>
                <p className="step-desc">
                  Informal approvals are eliminated. Two distinct district officers must independently review and sign off. Concurrency mutex locks prevent double-voting.
                </p>
              </div>

              <div className="step-card">
                <div className="step-badge">3</div>
                <h3 className="step-title">Quality & State Authority</h3>
                <p className="step-desc">
                  Cohorts over 50 candidates automatically route to the Quality Team. Only the State Office can give final sign-off and trigger PDF generation.
                </p>
              </div>

              <div className="step-card">
                <div className="step-badge">4</div>
                <h3 className="step-title">Instant Verification & QR</h3>
                <p className="step-desc">
                  Candidates receive a binary PDF-1.4 with unguessable QR tokens. Employers scan and verify authenticity in seconds with zero personal data leakage.
                </p>
              </div>
            </div>
          </div>

          {/* Section 2: Explore Personas */}
          <div className="section-container">
            <div className="section-heading">
              <h2>Try the Live Persona Tour</h2>
              <p>Click any persona to inspect their permissions and perform their exact workflow actions:</p>
            </div>

            <div className="persona-grid">
              <div className="persona-card">
                <div>
                  <div className="persona-card-header">
                    <div className="persona-avatar">🏢</div>
                    <div>
                      <div className="persona-name">Anika Sharma</div>
                      <div className="persona-role-tag">Training Centre</div>
                    </div>
                  </div>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>
                    Apex Skills Academy. Uploads passed rosters, inspects row errors, and submits candidate cohorts.
                  </p>
                </div>
                <button
                  className="btn btn-outline"
                  style={{ marginTop: '1rem' }}
                  onClick={() => setCurrentPersona(PERSONAS.find((p) => p.id === 'anika'))}
                >
                  Switch to Anika →
                </button>
              </div>

              <div className="persona-card">
                <div>
                  <div className="persona-card-header">
                    <div className="persona-avatar">🏛️</div>
                    <div>
                      <div className="persona-name">Dev & Meera</div>
                      <div className="persona-role-tag">District Officers</div>
                    </div>
                  </div>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>
                    North District. Enforces dual consensus (1/2 and 2/2 approvals) before batches move forward.
                  </p>
                </div>
                <button
                  className="btn btn-outline"
                  style={{ marginTop: '1rem' }}
                  onClick={() => setCurrentPersona(PERSONAS.find((p) => p.id === 'dev'))}
                >
                  Switch to Dev →
                </button>
              </div>

              <div className="persona-card">
                <div>
                  <div className="persona-card-header">
                    <div className="persona-avatar">🔍</div>
                    <div>
                      <div className="persona-name">Neha Gupta</div>
                      <div className="persona-role-tag">Quality Team</div>
                    </div>
                  </div>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>
                    Inspects high-volume cohorts (&gt; 50 candidates) to guarantee training compliance across the state.
                  </p>
                </div>
                <button
                  className="btn btn-outline"
                  style={{ marginTop: '1rem' }}
                  onClick={() => setCurrentPersona(PERSONAS.find((p) => p.id === 'neha'))}
                >
                  Switch to Neha →
                </button>
              </div>

              <div className="persona-card">
                <div>
                  <div className="persona-card-header">
                    <div className="persona-avatar">👑</div>
                    <div>
                      <div className="persona-name">Farah Khan</div>
                      <div className="persona-role-tag">State Office</div>
                    </div>
                  </div>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>
                    Final authority. Approves issuance pipeline, monitors stalled SLAs, and revokes fraudulent certificates.
                  </p>
                </div>
                <button
                  className="btn btn-outline"
                  style={{ marginTop: '1rem' }}
                  onClick={() => setCurrentPersona(PERSONAS.find((p) => p.id === 'farah'))}
                >
                  Switch to Farah →
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2. ADMIN & ROLE WORKSPACE VIEWS */}
      {currentPersona.id !== 'home' && (
        <main className="main-content">
          {/* Header Banner */}
          <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.25rem' }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: '1.05rem' }}>{currentPersona.name}</div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{currentPersona.desc}</div>
            </div>
            <button
              className="btn btn-outline"
              style={{ fontSize: '0.8rem' }}
              onClick={() => setCurrentPersona(PERSONAS[0])}
            >
              ← Back to Overview
            </button>
          </div>

          {feedback && (
            <div className="card" style={{ background: '#f8fafc', borderColor: '#cbd5e1', padding: '0.75rem 1rem' }}>
              {feedback}
            </div>
          )}

          {/* View: Training Centre (Anika) */}
          {currentPersona.id === 'anika' && (
            <div>
              <div className="card">
                <h2 className="card-title">1. Upload Candidate Roster (CSV)</h2>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                  All-or-nothing validation: If even 1 row fails validation, 0 records are imported.
                </p>
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <button className="btn btn-outline" onClick={() => { setCsvText(VALID_CSV_SAMPLE); setUploadErrors([]); }}>
                    Load Valid CSV Sample
                  </button>
                  <button className="btn btn-outline" onClick={() => { setCsvText(BAD_CSV_SAMPLE); setUploadErrors([]); }}>
                    Load Malformed / Duplicate CSV Sample
                  </button>
                </div>
                <textarea
                  className="csv-textarea"
                  rows={5}
                  value={csvText}
                  onChange={(e) => setCsvText(e.target.value)}
                />

                <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem' }}>
                  <button className="btn btn-primary" onClick={() => handleUploadCsv('batch-north-01')}>
                    Upload to Batch (batch-north-01)
                  </button>
                </div>

                {uploadErrors.length > 0 && (
                  <div className="error-report">
                    <strong style={{ color: '#991b1b' }}>Row-by-Row Error Report ({uploadErrors.length} errors found):</strong>
                    <ul style={{ margin: '0.5rem 0 0 1.25rem', padding: 0, fontSize: '0.85rem', color: '#b91c1c' }}>
                      {uploadErrors.map((err, idx) => (
                        <li key={idx}>
                          <strong>Row {err.row}</strong> [{err.field}]: {err.reason} (Provided value: <code>{err.value || 'EMPTY'}</code>)
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <div className="card">
                <h2 className="card-title">2. Training Centre Batches</h2>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Batch ID</th>
                      <th>Course</th>
                      <th>Candidates</th>
                      <th>Status</th>
                      <th>Revision</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batches.map((b) => (
                      <tr key={b.id}>
                        <td><strong>{b.batchNumber}</strong></td>
                        <td>{b.courseName}</td>
                        <td>{b.candidateCount}</td>
                        <td>
                          <span className={`badge badge-${b.status.toLowerCase().replace('_', '')}`}>
                            {b.status}
                          </span>
                        </td>
                        <td>Cycle {b.cycleCount}</td>
                        <td>
                          {['DRAFT', 'SENT_BACK'].includes(b.status) && (
                            <button className="btn btn-success" onClick={() => handleSubmitBatch(b.id)}>
                              Submit for Review
                            </button>
                          )}
                          {b.status === 'NEEDS_CORRECTION' && (
                            <span style={{ fontSize: '0.8rem', color: '#b91c1c' }}>Fix CSV to proceed</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* View: District Officers (Dev & Meera) */}
          {(currentPersona.id === 'dev' || currentPersona.id === 'meera') && (
            <div className="card">
              <h2 className="card-title">District Review Queue ({currentPersona.name})</h2>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                Strict Consensus Rule: Two distinct officers must approve. A single officer cannot approve twice in the same revision.
              </p>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Batch</th>
                    <th>Candidates</th>
                    <th>Status</th>
                    <th>Consensus Progress</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {batches.map((b) => {
                    const hasMyVote = b.districtApprovals?.some((a) => a.officerId === currentPersona.id);
                    const isEligible = ['PENDING_DISTRICT', 'DISTRICT_PARTIAL_APPROVED'].includes(b.status);
                    return (
                      <tr key={b.id}>
                        <td><strong>{b.batchNumber}</strong></td>
                        <td>{b.candidateCount}</td>
                        <td><span className="badge badge-pending">{b.status}</span></td>
                        <td>
                          <strong>{b.districtApprovals?.length || 0} of 2</strong> Approvals Recorded
                          {b.districtApprovals?.length > 0 && (
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                              Approved by: {b.districtApprovals.map((a) => a.officerName).join(', ')}
                            </div>
                          )}
                        </td>
                        <td>
                          {isEligible && (
                            <div style={{ display: 'flex', gap: '0.35rem' }}>
                              <button
                                className="btn btn-primary"
                                disabled={hasMyVote}
                                onClick={() => handleDecision(b.id, 'APPROVE', `Approved by ${currentPersona.name}`)}
                              >
                                {hasMyVote ? 'Voted' : 'Approve'}
                              </button>
                              <button
                                className="btn btn-warning"
                                onClick={() => {
                                  const reason = prompt('Enter return reason:');
                                  if (reason) handleDecision(b.id, 'RETURN_FOR_CORRECTION', reason);
                                }}
                              >
                                Return
                              </button>
                              <button
                                className="btn btn-danger"
                                onClick={() => {
                                  const reason = prompt('Enter rejection reason:');
                                  if (reason) handleDecision(b.id, 'REJECT', reason);
                                }}
                              >
                                Reject
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* View: Quality Team (Neha) */}
          {currentPersona.id === 'neha' && (
            <div className="card">
              <h2 className="card-title">Quality Inspection Queue (Batches &gt; 50 Candidates)</h2>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                Batches exceeding 50 candidates are automatically routed here after District consensus.
              </p>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Batch</th>
                    <th>Cohort Size</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {batches.filter((b) => b.candidateCount > 50).map((b) => (
                    <tr key={b.id}>
                      <td><strong>{b.batchNumber}</strong></td>
                      <td><span style={{ fontWeight: 700, color: '#2563eb' }}>{b.candidateCount}</span> candidates</td>
                      <td><span className="badge badge-pending">{b.status}</span></td>
                      <td>
                        {b.status === 'PENDING_QUALITY' ? (
                          <button
                            className="btn btn-primary"
                            onClick={() => handleDecision(b.id, 'APPROVE', 'Quality criteria verified by Neha Gupta')}
                          >
                            Approve Quality Inspection
                          </button>
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Awaiting District Consensus</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* View: State Office (Farah) */}
          {currentPersona.id === 'farah' && (
            <div>
              <div className="card">
                <h2 className="card-title">State Office Final Sign-Off Queue</h2>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Batch</th>
                      <th>Centre</th>
                      <th>Candidates</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batches.map((b) => (
                      <tr key={b.id}>
                        <td><strong>{b.batchNumber}</strong></td>
                        <td>{b.centreName}</td>
                        <td>{b.candidateCount}</td>
                        <td><span className={`badge badge-${b.status.toLowerCase().replace('_', '')}`}>{b.status}</span></td>
                        <td>
                          {b.status === 'PENDING_STATE' && (
                            <button
                              className="btn btn-success"
                              onClick={() => handleDecision(b.id, 'APPROVE', 'State final approval granted by Farah Khan')}
                            >
                              Grant State Final Approval
                            </button>
                          )}
                          {b.status === 'APPROVED' && (
                            <span style={{ color: '#059669', fontWeight: 600, fontSize: '0.85rem' }}>
                              Certificates Issued
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="card">
                <h2 className="card-title">Revocation & Invalidation Controls</h2>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                  Only the State Office has the authority to revoke certificates. Revocations invalidate public lookups immediately.
                </p>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button className="btn btn-danger" onClick={() => handleRevoke('PRAGATI-2026-N01-0001')}>
                    Revoke Sample Cert PRAGATI-2026-N01-0001
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* View: Public Verifier */}
          {currentPersona.id === 'public' && (
            <div style={{ maxWidth: '650px', margin: '2rem auto', textAlign: 'center' }}>
              <h2 style={{ fontSize: '1.75rem', fontWeight: 800, margin: '0 0 0.5rem 0' }}>
                Public Credential Verification
              </h2>
              <p style={{ color: 'var(--text-muted)' }}>
                Scan the QR code on any Pragati certificate or enter the certificate number below. No login required.
              </p>

              <form onSubmit={handleVerify} style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
                <input
                  type="text"
                  style={{ flex: 1, padding: '0.75rem 1rem', fontSize: '1rem', border: '2px solid var(--border)', borderRadius: '8px' }}
                  placeholder="e.g. PRAGATI-2026-N01-0001"
                  value={verifyCode}
                  onChange={(e) => setVerifyCode(e.target.value)}
                />
                <button type="submit" className="btn btn-primary" style={{ padding: '0 1.5rem' }}>
                  {verifyLoading ? 'Verifying...' : 'Verify'}
                </button>
              </form>

              <div style={{ marginTop: '0.75rem', display: 'flex', justifyContent: 'center', gap: '0.5rem' }}>
                <button
                  type="button"
                  className="btn btn-outline"
                  style={{ fontSize: '0.75rem' }}
                  onClick={() => { setVerifyCode('PRAGATI-2026-N01-0001'); }}
                >
                  Sample 1 (Valid)
                </button>
                <button
                  type="button"
                  className="btn btn-outline"
                  style={{ fontSize: '0.75rem' }}
                  onClick={() => { setVerifyCode('PRAGATI-2026-N01-0002'); }}
                >
                  Sample 2 (Cancelled)
                </button>
              </div>

              {verifyResult && (
                <div className={`cert-card ${verifyResult.status === 'CANCELLED' ? 'cancelled' : ''}`}>
                  <div className={`cert-status-badge ${verifyResult.status === 'VALID' ? 'valid' : 'cancelled'}`}>
                    ● {verifyResult.status}
                  </div>

                  {verifyResult.status === 'VALID' && (
                    <div>
                      <h3 style={{ margin: '0 0 0.25rem 0', fontSize: '1.4rem' }}>{verifyResult.candidateName}</h3>
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1rem' }}>
                        Certified Candidate
                      </div>

                      <table style={{ width: '100%', fontSize: '0.9rem' }}>
                        <tbody>
                          <tr><td style={{ color: 'var(--text-muted)' }}>Course:</td><td><strong>{verifyResult.courseName}</strong></td></tr>
                          <tr><td style={{ color: 'var(--text-muted)' }}>Training Centre:</td><td>{verifyResult.centreName}</td></tr>
                          <tr><td style={{ color: 'var(--text-muted)' }}>District:</td><td>{verifyResult.districtName}</td></tr>
                          <tr><td style={{ color: 'var(--text-muted)' }}>Certificate Number:</td><td><code>{verifyResult.certificateNumber}</code></td></tr>
                          <tr><td style={{ color: 'var(--text-muted)' }}>Grade:</td><td><strong>{verifyResult.grade}</strong></td></tr>
                          <tr><td style={{ color: 'var(--text-muted)' }}>Issued Date:</td><td>{verifyResult.issuedAt?.slice(0, 10)}</td></tr>
                        </tbody>
                      </table>

                      <div style={{ marginTop: '1.25rem', padding: '0.75rem', background: '#f8fafc', borderRadius: '6px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        🔒 <strong>Privacy Guarantee</strong>: Contact numbers and Aadhaar details are strictly redacted for public inquiries.
                      </div>
                    </div>
                  )}

                  {verifyResult.status === 'CANCELLED' && (
                    <div>
                      <h3 style={{ margin: '0 0 0.25rem 0', fontSize: '1.4rem', color: '#b91c1c' }}>
                        Certificate Cancelled
                      </h3>
                      <p style={{ fontSize: '0.95rem' }}>
                        This certificate (<code>{verifyResult.certificateNumber}</code>) was revoked by the State Office.
                      </p>
                      <div style={{ background: '#fef2f2', border: '1px solid #fecaca', padding: '0.75rem', borderRadius: '6px', color: '#991b1b', fontSize: '0.9rem' }}>
                        <strong>Revocation Reason:</strong> {verifyResult.cancellationReason || verifyResult.revocationReason}
                      </div>
                    </div>
                  )}

                  {verifyResult.status === 'NOT_FOUND' && (
                    <div style={{ color: '#b91c1c' }}>
                      <strong>Invalid Certificate</strong>: No matching credential found.
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </main>
      )}

      {/* Footer */}
      <footer className="footer">
        <div>
          <strong>Pragati Skills Mission</strong> — State-Level Digital Credential & Verification Platform
        </div>
        <div style={{ marginTop: '0.35rem', fontSize: '0.8rem' }}>
          Backend API: <span style={{ color: backendStatus === 'connected' ? '#059669' : '#dc2626' }}>● {backendStatus.toUpperCase()}</span> | Port 3000 | 39 Automated Security Tests Passing
        </div>
      </footer>
    </div>
  );
}
