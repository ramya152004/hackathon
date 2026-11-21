# CertiFlow: Batch Approval & Lifecycle Policy

This document defines the formal state transitions, multi-party consensus rules, concurrency protections, and the resubmission policy for candidate certification batches.

---

## 1. Batch Lifecycle & State Machine

```
               [ DRAFT / NEEDS_CORRECTION ]
                            │
               Submit Batch │ (Training Centre)
                            ▼
                  [ PENDING_DISTRICT ]
                            │
              Officer 1     │ Approve (1/2)
                            ▼
              [ DISTRICT_PARTIAL_APPROVED ]
                            │
              Officer 2     │ Approve (2/2 - Distinct Officer)
                            ▼
                 Consensus Reached
                    /        \
         Candidates > 50      Candidates <= 50
                  /            \
                 ▼              ▼
        [ PENDING_QUALITY ]     │
                 │              │
  Quality Team   │ Approve      │
                 ▼              │
            [ PENDING_STATE ] ◄─┘
                 │
  State Office   │ Final Approval
                 ▼
            [ APPROVED ] ──> (Triggers Async Certificate Issuance & WhatsApp)
```

### Side Transitions (Rejections & Returns)
At any point during review (`PENDING_DISTRICT`, `DISTRICT_PARTIAL_APPROVED`, `PENDING_QUALITY`, `PENDING_STATE`):
- **`REJECT`**: Transitions batch to `REJECTED`. Permanent termination. Requires mandatory `reason`.
- **`RETURN_FOR_CORRECTION`**: Transitions batch to `SENT_BACK`. Returns batch to Training Centre. Requires mandatory `reason`.

---

## 2. Multi-Party District Consensus Rules

1. **Two Distinct Officers**: Every district approval requires two separate, verified officers assigned to the same district where the training centre is registered.
2. **Double-Voting Prevention**: An officer who records the first approval cannot submit the second approval (`officer1_id !== officer2_id`). Duplicate attempts return HTTP `409 Conflict` (`DUPLICATE_APPROVAL`).
3. **District Isolation**: Officers cannot view, review, or vote on batches from outside their assigned district (`user.districtId === batch.districtId`).

---

## 3. Dynamic Quality Routing Rule

- **Threshold**: Configured at **50 candidates**.
- **Batches with $> 50$ candidates**: Upon reaching district consensus (2/2 approvals), the batch automatically transitions to `PENDING_QUALITY`. Quality Team review is strictly mandatory before the State Office can act.
- **Batches with $\le 50$ candidates**: Upon reaching district consensus, the batch bypasses the Quality Team and transitions directly to `PENDING_STATE`.

---

## 4. Policy for Resubmitting a Returned Batch

When an officer or state official executes `RETURN_FOR_CORRECTION`:
1. **Approval Invalidation**: **All prior approvals for the current cycle are immediately cleared.**
2. **Revision Increment**: The batch `cycleCount` (revision) increments by 1.
3. **Centre Remediation**: The training centre rectifies the roster (e.g. fixing data errors via CSV re-upload).
4. **Resubmission**: When the centre resubmits the batch (`POST /api/batches/:id/submit`):
   - Status transitions back to `PENDING_DISTRICT`.
   - The approval roster starts at **0/2 approvals**.
   - **Rationale**: Any alteration to candidate data (names, IDs, marks, roster size) invalidates previous verifications. Regulatory integrity requires fresh scrutiny by two district officers.
5. **Audit Preservation**: Full historical records of prior approval cycles, return remarks, timestamps, and officer IDs are immutably preserved in the batch `auditHistory`.

---

## 5. Concurrency & Idempotency Protection

To protect against race conditions when two district officers approve the same batch at the exact same millisecond:
1. **Critical Section Serialization**: Operations on a batch are wrapped in a per-batch mutex lock (simulating PostgreSQL `SELECT ... FOR UPDATE` row-level locks).
2. **Idempotent Transitions**:
   - The first request atomically acquires the lock, advances status to `DISTRICT_PARTIAL_APPROVED`, records `officer1`, and commits.
   - The concurrent second request acquires the lock, observes `DISTRICT_PARTIAL_APPROVED`, verifies `officer2 !== officer1`, records `officer2`, and advances to `PENDING_QUALITY` or `PENDING_STATE`.
   - The batch moves forward **exactly once**, preventing duplicate transitions or skipped states.
