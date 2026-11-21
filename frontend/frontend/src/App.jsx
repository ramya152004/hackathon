import { useState, useEffect } from 'react';
import './App.css';

const API = 'http://localhost:3000/api';

const PERSONAS = [
  { id: 'anika', name: 'Anika Sharma', role: 'TRAINING_CENTRE', label: '🏢 Anika (Centre)', desc: 'Apex Skills Academy (North District)' },
  { id: 'dev', name: 'Dev Patel', role: 'DISTRICT_OFFICER', label: '🏛️ Dev (District 1)', desc: 'District Officer (North District)' },
  { id: 'meera', name: 'Meera Rao', role: 'DISTRICT_OFFICER', label: '🏛️ Meera (District 2)', desc: 'District Officer (North District - 2nd Reviewer)' },
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
  const [currentPersona, setCurrentPersona] = useState(PERSONAS[0]);
  const [token, setToken] = useState(null);
  const [batches, setBatches] = useState([]);
  const [csvText, setCsvText] = useState(VALID_CSV_SAMPLE);
  const [uploadErrors, setUploadErrors] = useState([]);
  const [feedback, setFeedback] = useState('');
  const [verifyCode, setVerifyCode] = useState('PRAGATI-2026-N01-0001');
  const [verifyResult, setVerifyResult] = useState(null);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [jobStats, setJobStats] = useState(null);

  // Authenticate as active persona
  useEffect(() => {
    if (currentPersona.id === 'public') {
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

  // Poll job stats
  useEffect(() => {
    const fetchStats = () => {
      fetch(`${API}/jobs/stats`)
        .then((r) => r.json())
        .then((d) => setJobStats(d.stats))
        .catch(() => {});
    };
    fetchStats();
    const interval = setInterval(fetchStats, 5000);
    return () => clearInterval(interval);
  }, []);

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
      {/* Top Navbar with Persona Switcher */}
      <header className="navbar">
        <div className="nav-brand">
          <div className="nav-logo">PRAGATI</div>
          <div>
            <div className="nav-title">CertiFlow Platform</div>
            <div className="nav-subtitle">Digital Credential & Verification Engine</div>
          </div>
        </div>

        <div className="persona-switcher">
          {PERSONAS.map((p) => (
            <button
              key={p.id}
              className={`persona-btn ${currentPersona.id === p.id ? (p.id === 'public' ? 'public-active' : 'active') : ''}`}
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

      {/* Main Content Area */}
      <main className="main-content">
        {/* Banner with Persona Context */}
        <div className="banner-card">
          <div>
            <div style={{ fontWeight: 700, fontSize: '1.05rem' }}>{currentPersona.name}</div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{currentPersona.desc}</div>
          </div>
          {jobStats && (
            <div style={{ fontSize: '0.8rem', textAlign: 'right' }}>
              <span style={{ color: '#059669', fontWeight: 600 }}>● Background Queue Active</span> | Jobs Completed: {jobStats.completed}
            </div>
          )}
        </div>

        {feedback && (
          <div className="card" style={{ background: '#f8fafc', borderColor: '#cbd5e1', padding: '0.75rem 1rem' }}>
            {feedback}
          </div>
        )}

        {/* View 1: Training Centre (Anika) */}
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

        {/* View 2: District Officers (Dev Patel & Meera Rao) */}
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

        {/* View 3: Quality Team (Neha Gupta) */}
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

        {/* View 4: State Office (Farah Khan) */}
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

        {/* View 5: Public Verifier (No Login) */}
        {currentPersona.id === 'public' && (
          <div className="verification-box">
            <h2 style={{ fontSize: '1.75rem', fontWeight: 800, margin: '0 0 0.5rem 0' }}>
              Public Credential Verification
            </h2>
            <p style={{ color: 'var(--text-muted)' }}>
              Scan the QR code on any Pragati certificate or enter the certificate number below. No login required.
            </p>

            <form onSubmit={handleVerify} className="verify-input-group">
              <input
                type="text"
                className="verify-input"
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
    </div>
  );
}
