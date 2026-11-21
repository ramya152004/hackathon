# CertiFlow — Skilling Certificate Issuance & Verification Platform

> **Pragati Skills Mission — State-Level Digital Credential Platform**  
> Tamper-proof, role-governed, auditable certificate lifecycle with instant public verification.

---

## 1. Requirements & Technical Decisions Note

As guided by the problem statement, where the brief leaves decisions open, we have made explicit, documented architectural decisions:

| Open Decision | Chosen Rule / Assumption | Justification & Reason |
| :--- | :--- | :--- |
| **What counts as a large batch?** | Cohorts $> 50$ candidates trigger Quality Team review. | 50 candidates matches typical classroom batch size; larger cohorts represent multi-section batches requiring extra scrutiny. |
| **What happens to prior approvals on resubmission?** | Invalidate prior approvals and increment `cycleCount`. | If a training centre edits candidate scores or roster, previous officer approvals must not silently apply to new data. Old votes remain preserved in audit history. |
| **Can a district officer approve their own centre's batch?** | Disallowed by conflict-of-interest policy. | District officers are strictly bound to their assigned district; officers cannot act as training centre uploaders. |
| **Mandatory Candidate Fields** | 7 columns: `fullName`, `nationalId`, `phone`, `courseName`, `completionDate`, `grade`, `score`. | Captures minimum verification facts without collecting unnecessary personal data. |
| **When is a certificate created?** | Strictly post-State Final Approval (`APPROVED`). | No certificate or PDF exists prior to State sign-off; prevents draft credentials from entering circulation. |
| **What does public verification reveal?** | Candidate Name, Course, Training Centre, District, Grade, Issued/Cancelled Date. | **Zero-PII Guarantee**: Never exposes phone numbers, Aadhaar/national ID, or private candidate download tokens. |
| **SLA Threshold for Stalled Batches** | Batches pending review $> 48\text{ hours}$ trigger senior escalation alerts. | Prevents files sitting with officers for days (the programme office's #1 complaint). |
| **Mock WhatsApp Simulation Model** | 80% immediate success, 15% transient failure, 5% timeout. Bounded retries (max 3) with backoff. | Simulates real-world cellular delivery unreliability without calling paid APIs. |

---

## 2. Quickstart & One-Command Setup

### Prerequisites
- Node.js v18+ (tested on Node.js v20 / v26)
- npm v9+

### Clean Clone & Verification
```bash
# 1. Clone repository
git clone https://github.com/ramya152004/hackathon.git
cd hackathon

# 2. Run one-command setup (installs dependencies)
npm run setup

# 3. Run all automated verification suites (39 tests across 6 suites)
npm test

# 4. Start the CertiFlow API & Verification server
npm start
```

- **Backend API & Public Verification Portal**: `http://localhost:3000`
- **Interactive Multi-Persona Dashboard**: `http://localhost:5173` (run `npm --prefix frontend/frontend run dev`)

---

## 3. Demo Persona Credentials

| Persona | Role | District / Scope | Key Capabilities |
| :--- | :--- | :--- | :--- |
| **Anika Sharma** (`anika`) | `TRAINING_CENTRE` | `north-01` (Apex Skills) | Upload CSV rosters, correct errors, submit batches |
| **Dev Patel** (`dev`) | `DISTRICT_OFFICER` | `north` | District review 1/2, reject, send back |
| **Meera Rao** (`meera`) | `DISTRICT_OFFICER` | `north` | District review 2/2 (distinct officer consensus) |
| **Kabir Singh** (`kabir`) | `DISTRICT_OFFICER` | `south` | Isolated to South District batches only |
| **Neha Gupta** (`neha`) | `QUALITY_TEAM` | Statewide ($> 50$ candidates) | High-volume batch quality inspection & audit |
| **Farah Khan** (`farah`) | `STATE_OFFICE` | Statewide (All) | Exclusive final approval, issuance trigger, revocation |
| **Public / Employer** | `PUBLIC` | Global / No Login | Deep link & QR code verification, zero PII |

---

## 4. Six Core Workflows & Forbidden Outcomes Matrix

| Scenario | Rule & Workflow | Forbidden Outcome Prevented | Test Status |
| :--- | :--- | :--- | :--- |
| **1. CSV Roster Ingestion** | All-or-nothing validation, 7 mandatory headers, duplicate detection, row-by-row error report | **FO 9**: Partial batch commit on invalid CSV | **PASS** (`csvWorkflow.test.js`) |
| **2. District Consensus** | 2 distinct officers must approve; duplicate approval blocked; resubmission clears prior votes | **FO 1**: Single officer approving alone | **PASS** (`approvalWorkflow.test.js`) |
| **3. Quality Review Routing** | Batches $>50$ candidates automatically routed to Quality Team before State | **FO 2**: Bypassing quality review for large batches | **PASS** (`approvalWorkflow.test.js`) |
| **4. State Final Sign-Off** | Only State Office role can grant final approval | **FO 3 & 4**: Centre or District approving final issuance | **PASS** (`security.test.js`) |
| **5. Certificate Issuance** | Post-approval PDF-1.4 generation, unique serial, unguessable QR token, idempotency | **FO 5**: Duplicate certificate numbers or multiple certs per candidate | **PASS** (`certificateIssuance.test.js`) |
| **6. Revocation & Verification** | State-only cancellation; instant reflection; zero-PII projection (no phone/Aadhaar) | **FO 6, 7 & 8**: PII leak, unauthorized cancellation, stale valid status | **PASS** (`publicVerification.test.js`) |

---

## 5. Background Jobs & Resilience Design

1. **Job Pipeline**:
   - `issuance`: Non-blocking candidate PDF creation triggered on state approval.
   - `whatsapp`: Candidate notification delivery via mock provider simulating real network conditions (80% success, 15% transient failure, 5% timeout).
   - `sla`: Monitors stalled batches exceeding the 48-hour SLA threshold.
2. **Reliability Guarantees**:
   - **Bounded Retries**: Maximum 3 retry attempts with exponential backoff ($2^a \times 500\text{ms}$).
   - **Idempotency Keys**: Deduplicates mock delivery by `candidateId:batchId`.
   - **Worker Crash Safety**: Job states are tracked with isolated failure recording.

---

## 6. Public Verification & SSE Live Updates

- **Verification URL**: `GET /api/public/verify/:code` or `GET /api/public/verify?code=...`
- **Responsive Portal**: `GET /verify?code=...` (interactive web UI for QR scans and browser searches)
- **Live Event Stream**: `GET /api/events/live` (Server-Sent Events broadcasting real-time revocation and status changes)
