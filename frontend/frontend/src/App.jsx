import { useState, useEffect } from 'react';
import './App.css';
import './gov-theme.css';

const API = (import.meta.env.VITE_API_URL || 'http://localhost:3000') + '/api';

// Demo mode (default): clicking a person logs in with the shared demo password, so reviewers
// can try every flow instantly. Set VITE_DEMO_MODE=false to show a real sign-in form instead.
const DEMO_MODE = import.meta.env.VITE_DEMO_MODE !== 'false';
const DEMO_PASSWORD = import.meta.env.VITE_DEMO_PASSWORD || 'Certiflow@2026';

const PERSONAS = [
  {
    id: 'home', name: 'Home', role: 'LANDING',
    label: '🏠 Home', shortLabel: 'Home',
    desc: 'CertiFlow Platform Overview & Architecture',
    icon: '🏠'
  },
  {
    id: 'anika', name: 'Anika Sharma', role: 'TRAINING_CENTRE',
    label: '🏢 Training Centre', shortLabel: 'Anika',
    desc: 'Apex Skills Academy (North District)',
    icon: '🏢'
  },
  {
    id: 'dev', name: 'Dev Patel', role: 'DISTRICT_OFFICER',
    label: '🏛️ District Officer 1', shortLabel: 'Dev',
    desc: 'District Officer (North District – Reviewer 1)',
    icon: '🏛️'
  },
  {
    id: 'meera', name: 'Meera Rao', role: 'DISTRICT_OFFICER',
    label: '🏛️ District Officer 2', shortLabel: 'Meera',
    desc: 'District Officer (North District – Reviewer 2)',
    icon: '🏛️'
  },
  {
    id: 'neha', name: 'Neha Gupta', role: 'QUALITY_TEAM',
    label: '🔍 Quality Team', shortLabel: 'Neha',
    desc: 'Quality Inspection Team (>50 Candidates)',
    icon: '🔍'
  },
  {
    id: 'farah', name: 'Farah Khan', role: 'STATE_OFFICE',
    label: '👑 State Office', shortLabel: 'Farah',
    desc: 'State Office Final Approval & Certificate Revocation',
    icon: '👑'
  },
  {
    id: 'public', name: 'Public Verifier', role: 'PUBLIC',
    label: '🌐 Public Verify', shortLabel: 'Public',
    desc: 'No-Login Certificate Verification & QR Scan',
    icon: '🌐'
  },
];

const VALID_CSV_SAMPLE = `full_name,phone,email,national_id,dob,marks_percentage,grade
Amit Kumar,9876500001,amit@example.com,TESTID-1001,2004-05-14,92,A+
Sunita Patel,9876500002,sunita@example.com,TESTID-1002,2003-11-20,88,A
Vikram Rao,9876500003,vikram@example.com,TESTID-1003,2002-08-09,79,B+`;

const BAD_CSV_SAMPLE = `full_name,phone,email,national_id,dob,marks_percentage,grade
Amit Kumar,9876500001,amit@example.com,TESTID-1001,2004-05-14,92,A+
Duplicate Candidate,9876500001,duplicate@example.com,TESTID-1001,2003-10-25,88,A
Malformed Candidate,12345,malformed@example.com,TESTID-1003,2020-12-01,105,B`;

function getBadgeClass(status) {
  if (!status) return 'badge-draft';
  return 'badge-' + status.toLowerCase().replace(/_/g, '');
}

function FeedbackBanner({ msg }) {
  if (!msg) return null;
  const isSuccess = msg.startsWith('✅');
  const isError   = msg.startsWith('❌');
  const type = isSuccess ? 'success' : isError ? 'error' : 'info';
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  return (
    <div className={`feedback-banner ${type}`} role="alert">
      <span>{icons[type]}</span>
      <span>{msg.replace(/^[✅❌]\s*/, '')}</span>
    </div>
  );
}

export default function App() {
  const [currentPersona, setCurrentPersona] = useState(PERSONAS[0]);
  const [token, setToken]                   = useState(null);
  const [loginLoading, setLoginLoading]     = useState(false);
  const [loginError, setLoginError]         = useState(null);
  const [loginPassword, setLoginPassword]   = useState('');
  const [batches, setBatches]               = useState([]);
  const [csvText, setCsvText]               = useState(VALID_CSV_SAMPLE);
  const [uploadErrors, setUploadErrors]     = useState([]);
  const [feedback, setFeedback]             = useState('');
  const [verifyCode, setVerifyCode]         = useState('PRAGATI-2026-N01-0001');
  const [verifyResult, setVerifyResult]     = useState(null);
  const [verifyLoading, setVerifyLoading]   = useState(false);
  const [backendStatus, setBackendStatus]   = useState('checking');
  const [dlCert, setDlCert]                 = useState('PRAGATI-2026-N01-0001');

  // Backend health check
  useEffect(() => {
    fetch(`${API}/health`)
      .then(r => r.json())
      .then(() => setBackendStatus('connected'))
      .catch(() => setBackendStatus('error'));
  }, []);

  const loadBatches = (authToken) => {
    fetch(`${API}/batches`, { headers: { Authorization: `Bearer ${authToken}` } })
      .then(res => res.json())
      .then(data => { if (data.batches) setBatches(data.batches); })
      .catch(err => console.error('Batches load error', err));
  };

  // Sign in with username + password (the server checks the password and signs the token)
  const doLogin = (username, password) => {
    setLoginLoading(true); setLoginError(null);
    fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    })
      .then(res => res.json())
      .then(data => {
        if (data.token) { setToken(data.token); setLoginPassword(''); loadBatches(data.token); }
        else setLoginError(data.message || data.error || 'Authentication failed');
      })
      .catch(err => setLoginError(err.message || 'Network error'))
      .finally(() => setLoginLoading(false));
  };

  // On persona switch: drop the old session first, so one person's token is never used as another
  useEffect(() => {
    setToken(null); setBatches([]); setLoginPassword('');
    if (currentPersona.id === 'home' || currentPersona.id === 'public') {
      setLoginError(null); setLoginLoading(false);
      return;
    }
    if (DEMO_MODE) doLogin(currentPersona.id, DEMO_PASSWORD);
    else { setLoginError(null); setLoginLoading(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPersona]);

  const submitLogin = (e) => {
    e.preventDefault();
    doLogin(currentPersona.id, loginPassword);
  };

  const logout = () => {
    setToken(null); setBatches([]); setLoginPassword('');
    switchTo('home');
  };


  const handleUploadCsv = () => {
    setFeedback('⏳ Validating candidate roster…'); setUploadErrors([]);
    fetch(`${API}/batches/upload-csv`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ courseName: 'Solar PV Installer', csvContent: csvText })
    })
      .then(res => res.json().then(data => ({ status: res.status, data })))
      .then(({ status, data }) => {
        if (status === 201) { setFeedback(`✅ ${data.message}`); loadBatches(token); }
        else {
          setFeedback(`❌ Validation Failed: ${data.message}`);
          if (data.errors) setUploadErrors(data.errors);
          loadBatches(token);
        }
      })
      .catch(err => setFeedback(`❌ Error: ${err.message}`));
  };

  const handleSubmitBatch = (batchId) => {
    fetch(`${API}/batches/${batchId}/submit`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }
    })
      .then(res => res.json().then(data => ({ status: res.status, data })))
      .then(({ status, data }) => {
        if (status === 200) { setFeedback('✅ Batch submitted to District Officers for review.'); loadBatches(token); }
        else setFeedback(`❌ Error: ${data.message || data.error}`);
      });
  };

  const handleDecision = (batchId, action, reason = '') => {
    fetch(`${API}/batches/${batchId}/decision`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, reason })
    })
      .then(res => res.json().then(data => ({ status: res.status, data })))
      .then(({ status, data }) => {
        if (status === 200) { setFeedback(`✅ ${action}: ${data.message}`); loadBatches(token); }
        else setFeedback(`❌ Error: ${data.message || data.error}`);
      });
  };

  const handleRevoke = (certNumber) => {
    const reason = prompt('Enter mandatory revocation reason:', 'Audited attendance record forgery');
    if (!reason) return;
    fetch(`${API}/certificates/${certNumber}/revoke`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason })
    })
      .then(r => r.json())
      .then(data => { setFeedback(`✅ ${data.message || 'Certificate revoked.'}`); loadBatches(token); });
  };

  const handleDownload = (certNumber) => {
    const id = certNumber.trim();
    if (!id) return;
    setFeedback('');
    fetch(`${API}/certificates/${encodeURIComponent(id)}/download`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          throw new Error(d.message || `Download failed (${res.status})`);
        }
        return res.blob();
      })
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `${id}.pdf`; a.click();
        URL.revokeObjectURL(url);
        setFeedback(`✅ Downloaded ${id}.pdf`);
      })
      .catch((err) => setFeedback(`❌ ${err.message}`));
  };

  const downloadCard = (
    <div className="card">
      <div className="card-header">
        <div>
          <h2 className="card-title">Download Certificate (PDF)</h2>
          <p className="card-subtitle">
            Enter a certificate number to download the issued PDF. Access is limited to authorised officers of the relevant centre, district or state office.
          </p>
        </div>
      </div>
      <div className="download-row">
        <div>
          <label htmlFor="cert-download" className="gov-label">Certificate number</label>
          <input id="cert-download" className="gov-input" value={dlCert} onChange={(e) => setDlCert(e.target.value)} />
        </div>
        <button className="btn btn-primary" onClick={() => handleDownload(dlCert)}>Download PDF</button>
      </div>
    </div>
  );

  const handleVerify = (e) => {
    if (e) e.preventDefault();
    if (!verifyCode.trim()) return;
    setVerifyLoading(true); setVerifyResult(null);
    fetch(`${API}/public/verify/${verifyCode.trim()}`)
      .then(res => res.json().then(data => ({ status: res.status, data })))
      .then(({ status, data }) => { setVerifyLoading(false); setVerifyResult({ status, ...data }); })
      .catch(err => { setVerifyLoading(false); setVerifyResult({ status: 500, error: err.message }); });
  };

  const switchTo = (id) => {
    setCurrentPersona(PERSONAS.find(p => p.id === id));
    setFeedback(''); setUploadErrors([]);
  };

  /* ── RENDER ── */
  return (
    <div className="app-container">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      {/* Tricolor */}
      <div className="tricolor-stripe" />

      {/* Top Utility Bar */}
      <div className="top-bar">
        <div className="top-bar-left">
          <span>🇮🇳 Pragati Skills Mission · Hackathon demonstration (fictional programme)</span>
          <div className="top-bar-pill">
            <span className="top-bar-dot" />
            <span>Live Demo Environment</span>
          </div>
        </div>
        <span>
          API Status:&nbsp;
          <span style={{ color: backendStatus === 'connected' ? '#4ade80' : '#f87171', fontWeight: 700 }}>
            {backendStatus === 'connected' ? '● CONNECTED' : '● ERROR'}
          </span>
        </span>
      </div>

      {/* Primary Nav */}
      <header className="navbar">
        <div className="nav-brand" onClick={() => switchTo('home')}>
          <div className="nav-logo">CF</div>
          <div className="nav-brand-text">
            <div className="nav-brand-label"><span lang="hi">प्रगति कौशल मिशन</span> · Pragati Skills Mission</div>
            <div className="nav-brand-name">CertiFlow Platform</div>
          </div>
        </div>

        <div className="persona-switcher" role="tablist" aria-label="Switch persona">
          {PERSONAS.map(p => {
            const isActive = currentPersona.id === p.id;
            const cls = isActive
              ? p.id === 'home' ? 'home-active' : p.id === 'public' ? 'public-active' : 'active'
              : '';
            return (
              <button
                key={p.id}
                role="tab"
                aria-selected={isActive}
                className={`persona-btn ${cls}`}
                onClick={() => switchTo(p.id)}
                aria-label={`Switch to ${p.name}`}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      </header>

      {/* Auth / RBAC Strip (shown only for protected personas) */}
      {currentPersona.id !== 'home' && (
        <div className="auth-bar" role="status" aria-live="polite">
          <div className="auth-bar-left">
            <span>🔐 Session</span>
            {loginLoading && (
              <span className="auth-chip loading">
                <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} />
                AUTHENTICATING…
              </span>
            )}
            {!loginLoading && token && (
              <span className="auth-chip ok">✓ AUTHENTICATED · {currentPersona.role}</span>
            )}
            {!loginLoading && loginError && (
              <span className="auth-chip err">✗ AUTH FAILED · {loginError}</span>
            )}
            {!DEMO_MODE && !loginLoading && !token && currentPersona.id !== 'public' && (
              <form className="login-form" onSubmit={submitLogin}>
                <input className="login-input" value={currentPersona.id} readOnly aria-label="Username" />
                <input
                  className="login-input" type="password" placeholder="Password"
                  value={loginPassword} onChange={e => setLoginPassword(e.target.value)}
                  autoComplete="current-password" aria-label="Password" required
                />
                <button className="login-btn" type="submit">Sign in</button>
              </form>
            )}
            {token && (
              <button className="login-btn" type="button" onClick={logout}>Sign out</button>
            )}
            {!loginLoading && currentPersona.id === 'public' && (
              <span className="auth-chip ok">🌐 PUBLIC · NO LOGIN REQUIRED</span>
            )}
          </div>
          <span style={{ fontFamily: 'monospace', fontSize: '0.68rem' }}>
            USER: {currentPersona.name} · ROLE: {currentPersona.role}
          </span>
        </div>
      )}

      {/* ═══════════════════════════════════════════
          VIEW: LANDING / HOME
      ═══════════════════════════════════════════ */}
      {currentPersona.id === 'home' && (
        <div>
          {/* Hero */}
          <section className="hero" aria-label="Hero section">
            <div className="hero-grid-bg" aria-hidden="true" />
            <div className="hero-eyebrow">
              <span className="hero-eyebrow-dot" />
              Official Government Credential Platform · Hackathon Demo
            </div>
            <h1 className="hero-title">
              Digital, Auditable &amp; Tamper-Proof<br />
              <span className="accent">Skilling Certification</span>
            </h1>
            <p className="hero-subtitle">
              Transforming how <strong>300+ training centres</strong> certify <strong>8,000 young candidates</strong> every month.
              Replacing vulnerable manual Word-file workflows and WhatsApp approvals with
              cryptographic multi-officer consensus and instant public verification.
            </p>

            <div className="hero-cta-row">
              <button
                className="btn btn-hero-primary btn-lg"
                onClick={() => switchTo('public')}
                aria-label="Verify a certificate"
              >
                🔍 Verify a Certificate
              </button>
              <button
                className="btn btn-hero-secondary btn-lg"
                onClick={() => switchTo('anika')}
                aria-label="Start interactive demo as Anika"
              >
                🚀 Start Interactive Demo
              </button>
            </div>

            {/* Quick Authenticator */}
            <div className="hero-verify-card">
              <div className="hero-verify-label">Live Certificate Authenticator</div>
              <div className="hero-verify-title">Instant Credential Verification</div>
              <div className="hero-verify-desc">
                Scan an official QR code or test with our demo credential numbers below.
              </div>
              <form onSubmit={handleVerify}>
                <div className="verify-input-row">
                  <input
                    type="text"
                    className="verify-input"
                    placeholder="PRAGATI-2026-N01-0001"
                    value={verifyCode}
                    onChange={e => setVerifyCode(e.target.value)}
                    aria-label="Certificate number or token"
                  />
                  <button type="submit" className="btn btn-hero-primary" disabled={verifyLoading} aria-label="Verify certificate">
                    {verifyLoading ? <><span className="spinner" /> Checking…</> : '→ Verify'}
                  </button>
                </div>
                <div className="verify-samples">
                  <button type="button" className="verify-sample-btn" onClick={() => setVerifyCode('PRAGATI-2026-N01-0001')}>
                    🟢 Sample Valid Cert
                  </button>
                  <button type="button" className="verify-sample-btn" onClick={() => setVerifyCode('PRAGATI-2026-N01-0002')}>
                    🔴 Sample Revoked Cert
                  </button>
                </div>
              </form>

              {/* Inline result in hero */}
              {verifyResult && (
                <div className={`cert-result ${verifyResult.status === 'VALID' ? 'valid' : 'invalid'}`} style={{ marginTop: '1.25rem' }}>
                  <div className="cert-result-header">
                    <div className="cert-status-icon">
                      {verifyResult.status === 'VALID' ? '✅' : '❌'}
                    </div>
                    <div>
                      <div className="cert-status-name">
                        {verifyResult.status === 'VALID' ? 'Certificate Valid' : 'Certificate Invalid / Revoked'}
                      </div>
                      <div className="cert-status-sub">
                        {verifyResult.status === 'VALID'
                          ? `Issued to ${verifyResult.candidateName}`
                          : verifyResult.cancellationReason || verifyResult.error || 'Not found'}
                      </div>
                    </div>
                  </div>
                  {verifyResult.status === 'VALID' && (
                    <div className="cert-result-body">
                      <div className="cert-fields">
                        <div><div className="cert-field-label">Course</div><div className="cert-field-value">{verifyResult.courseName}</div></div>
                        <div><div className="cert-field-label">Training Centre</div><div className="cert-field-value">{verifyResult.centreName}</div></div>
                        <div><div className="cert-field-label">Grade</div><div className="cert-field-value">{verifyResult.grade}</div></div>
                        <div><div className="cert-field-label">Issued On</div><div className="cert-field-value">{verifyResult.issuedAt?.slice(0, 10)}</div></div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>

          {/* Stats Bar */}
          <div className="stats-bar" aria-label="Platform statistics">
            <div className="stats-inner">
              {[
                { n: '300+', l: 'Training Centres Managed' },
                { n: '8,000', l: 'Monthly Youth Certified' },
                { n: '2 / 2', l: 'Officers Required for Consensus' },
                { n: '< 1 s', l: 'Instant Public Verification' },
              ].map((s, i) => (
                <div key={i} className="stat-item">
                  <div className="stat-number">{s.n}</div>
                  <div className="stat-label">{s.l}</div>
                </div>
              ))}
            </div>
          </div>

          {/* How It Works */}
          <section className="section" aria-label="How the platform works">
            <div className="section-header-center">
              <div className="section-eyebrow">Platform Architecture</div>
              <h2 className="section-title">How CertiFlow Solves the Crisis</h2>
              <p className="section-desc">
                Four strictly-enforced steps that eliminate fraud and compress weeks of administrative delay.
              </p>
            </div>
            <div className="steps-grid">
              {[
                {
                  n: '1',
                  title: 'All-or-Nothing CSV Import',
                  desc: 'Training centres upload candidate spreadsheets. If even 1 row contains an invalid phone, duplicate Aadhaar, or missing field — 0 records are committed. Zero partial saves.'
                },
                {
                  n: '2',
                  title: 'Two-Officer Consensus',
                  desc: 'Informal approvals are eliminated. Two distinct district officers must independently review and sign off. Concurrency mutex locks prevent double-voting on the same revision.'
                },
                {
                  n: '3',
                  title: 'Quality & State Authority',
                  desc: 'Cohorts over 50 candidates automatically route to the Quality Team. Only the State Office can grant final sign-off and trigger the PDF generation pipeline.'
                },
                {
                  n: '4',
                  title: 'Instant Verification & QR',
                  desc: 'Candidates receive a secure PDF with an unguessable QR token. Employers scan and verify authenticity in seconds — with zero personal data exposed to the public.'
                },
              ].map(s => (
                <div key={s.n} className="step-card">
                  <div className="step-number">{s.n}</div>
                  <h3 className="step-title">{s.title}</h3>
                  <p className="step-desc">{s.desc}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Persona Tour */}
          <section className="section" style={{ paddingTop: 0 }} aria-label="Interactive persona tour">
            <div className="section-header-center">
              <div className="section-eyebrow">Live Persona Tour</div>
              <h2 className="section-title">Try Every Role Interactively</h2>
              <p className="section-desc">
                Click any persona to authenticate as that officer and perform their exact workflow actions in real-time.
              </p>
            </div>
            <div className="persona-grid">
              {[
                { id: 'anika', icon: '🏢', name: 'Anika Sharma', role: 'Training Centre', desc: 'Apex Skills Academy. Uploads candidate rosters, inspects row-by-row validation errors, and submits certified cohorts for district review.' },
                { id: 'dev',   icon: '🏛️', name: 'Dev Patel',    role: 'District Officer 1', desc: 'North District. First of two required officers. Provides consensus vote (1/2) or returns batches for correction with a mandatory reason.' },
                { id: 'meera', icon: '🏛️', name: 'Meera Rao',    role: 'District Officer 2', desc: 'North District. Second of two required officers. Completes the dual-consensus (2/2) requirement that moves batches toward state approval.' },
                { id: 'neha',  icon: '🔍', name: 'Neha Gupta',   role: 'Quality Inspector', desc: 'Inspects high-volume cohorts (>50 candidates) to guarantee training compliance and data integrity before state sign-off.' },
                { id: 'farah', icon: '👑', name: 'Farah Khan',   role: 'State Office', desc: 'Final authority. Grants the state-level approval that triggers certificate issuance, monitors SLA breaches, and revokes fraudulent credentials.' },
                { id: 'public',icon: '🌐', name: 'Public Portal', role: 'No Login Required', desc: 'Zero-login public verification portal. Scan a QR code or enter a certificate number. Aadhaar and phone data are strictly redacted.' },
              ].map(p => (
                <div key={p.id} className="persona-card">
                  <div className="persona-card-top">
                    <div className="persona-card-header">
                      <div className="persona-avatar">{p.icon}</div>
                      <div>
                        <div className="persona-name">{p.name}</div>
                        <div className="persona-role-tag">{p.role}</div>
                      </div>
                    </div>
                    <p className="persona-desc">{p.desc}</p>
                  </div>
                  <button
                    className="btn btn-outline"
                    style={{ marginTop: '1.25rem', width: '100%' }}
                    onClick={() => switchTo(p.id)}
                    aria-label={`Switch to ${p.name}`}
                  >
                    Enter as {p.name.split(' ')[0]} →
                  </button>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {/* ═══════════════════════════════════════════
          VIEW: ALL AUTHENTICATED PERSONAS
      ═══════════════════════════════════════════ */}
      {currentPersona.id !== 'home' && (
        <main className="workspace" id="main-content">
          {/* Feedback Banner */}
          <FeedbackBanner msg={feedback} />

          {/* Role Banner (shown for non-public personas) */}
          {currentPersona.id !== 'public' && (
            <div className="role-banner" role="banner" aria-label="Current user context">
              <div className="role-banner-left">
                <div className="role-icon">{currentPersona.icon}</div>
                <div>
                  <div className="role-name">{currentPersona.name}</div>
                  <div className="role-desc">{currentPersona.desc}</div>
                  <span className="role-badge">Role: {currentPersona.role}</span>
                </div>
              </div>
              <button
                className="btn btn-ghost"
                onClick={() => switchTo('home')}
                aria-label="Back to overview"
              >
                ← Back to Overview
              </button>
            </div>
          )}

          {/* ── Training Centre: Anika ── */}
          {currentPersona.id === 'anika' && (
            <div>
              <div className="card">
                <div className="card-header">
                  <div>
                    <h2 className="card-title">
                      <span className="card-title-icon">📋</span>
                      Upload Candidate Roster (CSV)
                    </h2>
                    <p className="card-subtitle">
                      All-or-nothing validation: if even 1 row fails, 0 records are committed.
                    </p>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.6rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                  <button className="btn btn-outline" onClick={() => { setCsvText(VALID_CSV_SAMPLE); setUploadErrors([]); }}>
                    ✅ Load Valid Sample CSV
                  </button>
                  <button className="btn btn-outline" onClick={() => { setCsvText(BAD_CSV_SAMPLE); setUploadErrors([]); }}>
                    ❌ Load Malformed / Duplicate CSV
                  </button>
                </div>
                <textarea
                  className="csv-editor"
                  rows={6}
                  value={csvText}
                  onChange={e => setCsvText(e.target.value)}
                  aria-label="CSV candidate roster editor"
                />
                <div style={{ display: 'flex', gap: '0.6rem', marginTop: '0.9rem' }}>
                  <button
                    className="btn btn-primary"
                    onClick={handleUploadCsv}
                    aria-label="Upload CSV to create batch"
                  >
                    📤 Upload CSV & Create Batch
                  </button>
                </div>

                {uploadErrors.length > 0 && (
                  <div className="error-report" role="alert" aria-label="Validation errors">
                    <strong>Row-by-Row Validation Errors ({uploadErrors.length} found):</strong>
                    <ul>
                      {uploadErrors.map((err, i) => (
                        <li key={i}>
                          <strong>Row {err.row}</strong> [{err.field}]: {err.reason}
                          {err.value && <> — Provided: <code>{err.value}</code></>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <div className="card">
                <div className="card-header">
                  <h2 className="card-title">
                    <span className="card-title-icon">📦</span>
                    Training Centre Batches
                  </h2>
                </div>
                <div className="table-wrapper">
                  <table className="data-table" aria-label="Batch list">
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
                      {batches.length === 0 && (
                        <tr><td colSpan={6}>
                          <div className="empty-state">
                            <div className="empty-state-icon">📂</div>
                            <div className="empty-state-title">No batches yet</div>
                            <div className="empty-state-desc">Upload a CSV above to create your first batch.</div>
                          </div>
                        </td></tr>
                      )}
                      {batches.map(b => (
                        <tr key={b.id}>
                          <td><span className="cell-id">{b.batchNumber}</span></td>
                          <td>{b.courseName}</td>
                          <td><strong>{b.candidateCount}</strong></td>
                          <td><span className={`badge ${getBadgeClass(b.status)}`}>{b.status}</span></td>
                          <td>Cycle {b.cycleCount}</td>
                          <td className="cell-actions">
                            {['DRAFT', 'SENT_BACK'].includes(b.status) && (
                              <button className="btn btn-success" onClick={() => handleSubmitBatch(b.id)} aria-label={`Submit batch ${b.batchNumber}`}>
                                Submit for Review
                              </button>
                            )}
                            {b.status === 'NEEDS_CORRECTION' && (
                              <span style={{ fontSize: '0.8rem', color: 'var(--danger)' }}>⚠ Fix CSV to proceed</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ── District Officers: Dev & Meera ── */}
          {(currentPersona.id === 'dev' || currentPersona.id === 'meera') && (
            <div className="card">
              <div className="card-header">
                <div>
                  <h2 className="card-title">
                    <span className="card-title-icon">⚖️</span>
                    District Review Queue — {currentPersona.name}
                  </h2>
                  <p className="card-subtitle">
                    Strict consensus rule: two distinct officers must independently approve each batch. A single officer cannot vote twice in the same revision cycle.
                  </p>
                </div>
              </div>
              <div className="table-wrapper">
                <table className="data-table" aria-label="District review queue">
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
                    {batches.length === 0 && (
                      <tr><td colSpan={5}>
                        <div className="empty-state">
                          <div className="empty-state-icon">📋</div>
                          <div className="empty-state-title">No batches in queue</div>
                          <div className="empty-state-desc">Batches submitted by training centres will appear here.</div>
                        </div>
                      </td></tr>
                    )}
                    {batches.map(b => {
                      const hasMyVote = b.districtApprovals?.some(a => a.officerId === currentPersona.id);
                      const isEligible = ['PENDING_DISTRICT', 'DISTRICT_PARTIAL_APPROVED'].includes(b.status);
                      const approvalCount = b.districtApprovals?.length || 0;
                      return (
                        <tr key={b.id}>
                          <td><span className="cell-id">{b.batchNumber}</span></td>
                          <td><strong>{b.candidateCount}</strong></td>
                          <td><span className={`badge ${getBadgeClass(b.status)}`}>{b.status}</span></td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <div className="consensus-bar" aria-label={`${approvalCount} of 2 approvals`}>
                                <div className={`consensus-dot ${approvalCount >= 1 ? 'filled' : ''}`} />
                                <div className={`consensus-dot ${approvalCount >= 2 ? 'filled' : ''}`} />
                              </div>
                              <span className="consensus-label">{approvalCount}/2 Approvals</span>
                            </div>
                            {b.districtApprovals?.length > 0 && (
                              <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
                                By: {b.districtApprovals.map(a => a.officerName).join(', ')}
                              </div>
                            )}
                          </td>
                          <td className="cell-actions">
                            {isEligible && (
                              <>
                                <button
                                  className="btn btn-primary"
                                  disabled={hasMyVote}
                                  onClick={() => handleDecision(b.id, 'APPROVE', `Approved by ${currentPersona.name}`)}
                                  aria-label={hasMyVote ? 'Already voted' : 'Approve batch'}
                                >
                                  {hasMyVote ? '✓ Voted' : 'Approve'}
                                </button>
                                <button
                                  className="btn btn-warning"
                                  onClick={() => { const r = prompt('Return reason (required):'); if (r) handleDecision(b.id, 'RETURN_FOR_CORRECTION', r); }}
                                  aria-label="Return for correction"
                                >
                                  Return
                                </button>
                                <button
                                  className="btn btn-danger"
                                  onClick={() => { const r = prompt('Rejection reason (required):'); if (r) handleDecision(b.id, 'REJECT', r); }}
                                  aria-label="Reject batch"
                                >
                                  Reject
                                </button>
                              </>
                            )}
                            {!isEligible && <span style={{ color: 'var(--text-faint)', fontSize: '0.8rem' }}>Not actionable</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Quality Team: Neha ── */}
          {currentPersona.id === 'neha' && (
            <div className="card">
              <div className="card-header">
                <div>
                  <h2 className="card-title">
                    <span className="card-title-icon">🔍</span>
                    Quality Inspection Queue (Batches &gt; 50 Candidates)
                  </h2>
                  <p className="card-subtitle">
                    Batches exceeding 50 candidates are automatically routed here after district officer consensus. Only these appear in this queue.
                  </p>
                </div>
              </div>
              <div className="table-wrapper">
                <table className="data-table" aria-label="Quality inspection queue">
                  <thead>
                    <tr>
                      <th>Batch</th>
                      <th>Cohort Size</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batches.filter(b => b.candidateCount > 50).length === 0 && (
                      <tr><td colSpan={4}>
                        <div className="empty-state">
                          <div className="empty-state-icon">🔍</div>
                          <div className="empty-state-title">No large-cohort batches</div>
                          <div className="empty-state-desc">Only batches with more than 50 candidates appear here.</div>
                        </div>
                      </td></tr>
                    )}
                    {batches.filter(b => b.candidateCount > 50).map(b => (
                      <tr key={b.id}>
                        <td><span className="cell-id">{b.batchNumber}</span></td>
                        <td>
                          <strong style={{ color: 'var(--blue)', fontSize: '1.05rem' }}>{b.candidateCount}</strong>
                          <span style={{ color: 'var(--text-muted)', marginLeft: '0.3rem', fontSize: '0.82rem' }}>candidates</span>
                        </td>
                        <td><span className={`badge ${getBadgeClass(b.status)}`}>{b.status}</span></td>
                        <td>
                          {b.status === 'PENDING_QUALITY' ? (
                            <button
                              className="btn btn-primary"
                              onClick={() => handleDecision(b.id, 'APPROVE', 'Quality criteria verified by Neha Gupta')}
                              aria-label="Approve quality inspection"
                            >
                              ✅ Approve Quality Inspection
                            </button>
                          ) : (
                            <span style={{ color: 'var(--text-faint)', fontSize: '0.82rem' }}>Awaiting district consensus</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── State Office: Farah ── */}
          {currentPersona.id === 'farah' && (
            <div>
              <div className="card">
                <div className="card-header">
                  <div>
                    <h2 className="card-title">
                      <span className="card-title-icon">📜</span>
                      State Office Final Sign-Off Queue
                    </h2>
                    <p className="card-subtitle">
                      Granting approval here triggers the PDF generation and certificate issuance pipeline.
                    </p>
                  </div>
                </div>
                <div className="table-wrapper">
                  <table className="data-table" aria-label="State final approval queue">
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
                      {batches.length === 0 && (
                        <tr><td colSpan={5}>
                          <div className="empty-state">
                            <div className="empty-state-icon">📜</div>
                            <div className="empty-state-title">No batches pending state approval</div>
                            <div className="empty-state-desc">Batches that have passed all prior reviews will appear here.</div>
                          </div>
                        </td></tr>
                      )}
                      {batches.map(b => (
                        <tr key={b.id}>
                          <td><span className="cell-id">{b.batchNumber}</span></td>
                          <td>{b.centreName}</td>
                          <td><strong>{b.candidateCount}</strong></td>
                          <td><span className={`badge ${getBadgeClass(b.status)}`}>{b.status}</span></td>
                          <td className="cell-actions">
                            {b.status === 'PENDING_STATE' && (
                              <button
                                className="btn btn-success"
                                onClick={() => handleDecision(b.id, 'APPROVE', 'State final approval granted by Farah Khan')}
                                aria-label="Grant state final approval"
                              >
                                ✅ Grant Final Approval
                              </button>
                            )}
                            {b.status === 'APPROVED' && (
                              <span style={{ color: 'var(--success)', fontWeight: 700, fontSize: '0.85rem' }}>
                                🏅 Certificates Issued
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="card">
                <div className="card-header">
                  <div>
                    <h2 className="card-title">
                      <span className="card-title-icon">🚫</span>
                      Certificate Revocation Controls
                    </h2>
                    <p className="card-subtitle">
                      Exclusive State Office authority. Revocations are immediate — public verification reflects the change instantly with no cache delay.
                    </p>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <button
                    className="btn btn-danger"
                    onClick={() => handleRevoke('PRAGATI-2026-N01-0001')}
                    aria-label="Revoke certificate PRAGATI-2026-N01-0001"
                  >
                    🚫 Revoke PRAGATI-2026-N01-0001
                  </button>
                  <button
                    className="btn btn-outline"
                    onClick={() => { switchTo('public'); setVerifyCode('PRAGATI-2026-N01-0001'); }}
                    aria-label="Verify revocation in public portal"
                  >
                    🔍 Verify in Public Portal
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── Public Verifier ── */}
          {currentPersona.id === 'public' && (
            <div className="public-verify-page">
              <div className="public-verify-header">
                <div className="section-eyebrow">🌐 No Login Required</div>
                <h2 className="public-verify-title">Public Credential Verification</h2>
                <p className="public-verify-desc">
                  Scan the QR code on any Pragati certificate, or enter the certificate number below.
                  Aadhaar IDs and phone numbers are strictly redacted.
                </p>
              </div>

              <div className="verify-card">
                <form onSubmit={handleVerify}>
                  <div style={{ marginBottom: '0.6rem', fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Certificate Number or Verification Token
                  </div>
                  <div className="verify-form-row">
                    <input
                      type="text"
                      className="verify-form-input"
                      placeholder="e.g. PRAGATI-2026-N01-0001"
                      value={verifyCode}
                      onChange={e => setVerifyCode(e.target.value)}
                      aria-label="Enter certificate number"
                    />
                    <button
                      type="submit"
                      className="btn btn-primary btn-lg"
                      disabled={verifyLoading}
                      aria-label="Verify certificate"
                    >
                      {verifyLoading ? <><span className="spinner dark" /> Verifying…</> : '→ Verify'}
                    </button>
                  </div>
                  <div style={{ display: 'flex', gap: '0.6rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
                    <button type="button" className="btn btn-outline" style={{ fontSize: '0.78rem' }} onClick={() => setVerifyCode('PRAGATI-2026-N01-0001')}>
                      🟢 Sample Valid
                    </button>
                    <button type="button" className="btn btn-outline" style={{ fontSize: '0.78rem' }} onClick={() => setVerifyCode('PRAGATI-2026-N01-0002')}>
                      🔴 Sample Revoked
                    </button>
                  </div>
                </form>

                {verifyResult && (
                  <div className={`cert-result ${verifyResult.status === 'VALID' ? 'valid' : 'invalid'}`} style={{ marginTop: '1.5rem' }}>
                    <div className="cert-result-header">
                      <div className="cert-status-icon">
                        {verifyResult.status === 'VALID' ? '✅' : '❌'}
                      </div>
                      <div>
                        <div className="cert-status-name">
                          {verifyResult.status === 'VALID' ? 'Certificate Authentic & Valid' : 'Certificate Invalid or Revoked'}
                        </div>
                        <div className="cert-status-sub">
                          {verifyResult.status === 'VALID'
                            ? `Issued to ${verifyResult.candidateName} · ${verifyResult.courseName}`
                            : verifyResult.cancellationReason || verifyResult.error || 'Not found in registry'}
                        </div>
                      </div>
                    </div>

                    {verifyResult.status === 'VALID' && (
                      <div className="cert-result-body">
                        <div className="cert-fields">
                          <div>
                            <div className="cert-field-label">Candidate Name</div>
                            <div className="cert-field-value">{verifyResult.candidateName}</div>
                          </div>
                          <div>
                            <div className="cert-field-label">Course</div>
                            <div className="cert-field-value">{verifyResult.courseName}</div>
                          </div>
                          <div>
                            <div className="cert-field-label">Training Centre</div>
                            <div className="cert-field-value">{verifyResult.centreName}</div>
                          </div>
                          <div>
                            <div className="cert-field-label">District</div>
                            <div className="cert-field-value">{verifyResult.districtName}</div>
                          </div>
                          <div>
                            <div className="cert-field-label">Certificate Number</div>
                            <div className="cert-field-value" style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{verifyResult.certificateNumber}</div>
                          </div>
                          <div>
                            <div className="cert-field-label">Grade</div>
                            <div className="cert-field-value">{verifyResult.grade}</div>
                          </div>
                          <div>
                            <div className="cert-field-label">Issued Date</div>
                            <div className="cert-field-value">{verifyResult.issuedAt?.slice(0, 10)}</div>
                          </div>
                        </div>
                        <div className="cert-privacy-note">
                          🔒 <strong>Privacy Guarantee:</strong> Contact numbers and Aadhaar/national ID are strictly redacted from public responses per data privacy rules.
                        </div>
                      </div>
                    )}

                    {verifyResult.status === 'CANCELLED' && (
                      <div className="cert-result-body">
                        <div style={{ marginBottom: '0.75rem' }}>
                          <div className="cert-field-label">Certificate Reference</div>
                          <div className="cert-field-value" style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{verifyResult.certificateNumber}</div>
                        </div>
                        <div style={{ background: 'var(--danger-bg)', border: '1px solid #fecaca', borderRadius: 'var(--r-sm)', padding: '0.75rem 1rem', fontSize: '0.88rem', color: '#7f1d1d' }}>
                          <strong>Revocation Reason:</strong> {verifyResult.cancellationReason || verifyResult.revocationReason}
                        </div>
                      </div>
                    )}

                    {(verifyResult.status === 'NOT_FOUND' || verifyResult.error) && (
                      <div className="cert-result-body">
                        <div style={{ color: 'var(--danger)', fontWeight: 600 }}>
                          No matching credential found in the Pragati registry. Please verify the certificate number and try again.
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
          {['anika', 'dev', 'meera', 'farah'].includes(currentPersona.id) && (
            <div className="gov-section">{downloadCard}</div>
          )}
        </main>
      )}

      {/* Footer */}
      <footer className="footer" role="contentinfo">
        <div className="footer-inner">
          <div>
            <div className="footer-brand">🛡️ Pragati Skills Mission — CertiFlow Platform</div>
            <div className="footer-meta">
              State-Level Digital Credential & Instant Verification Engine · Demonstration project, not an official Government website
            </div>
          </div>
          <div className="footer-status">
            <span className={`footer-status-dot ${backendStatus !== 'connected' ? '' : ''}`}
              style={{ background: backendStatus === 'connected' ? '#22c55e' : '#ef4444', boxShadow: `0 0 6px ${backendStatus === 'connected' ? '#22c55e' : '#ef4444'}` }}
            />
            <span>API {backendStatus.toUpperCase()}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
