# REL-01 — Production E2E Execution Record

Issue: #42  
Branch: `rel/42-rel-01-production-e2e`  
Target: `v0.6.0`

## Run metadata

| Field | Value |
|---|---|
| Environment | `https://forlanguage.github.io/cuongtv-classroom/` |
| Started | 2026-08-06 |
| Administrator | `cuongtv@uit.edu.vn` |
| Student | `cuongtv.ee@gmail.com` |
| Tester | Cuong Truong Van |
| Build under test | `41937d7e8c836d9cf7123d15880d3546c9fa262e` |
| Pages workflow | Run #50 — success |
| Apps Script | User confirmed updated `apps-script/Code.gs`; deployed web-app version is being verified in AC-03 and AC-04 |

## Preflight

| Check | Status | Evidence / note |
|---|---|---|
| Production Pages build | PASS | GitHub Pages Run #50 completed successfully |
| ATT-12 merge on `main` | PASS | Commit `41937d7e8c836d9cf7123d15880d3546c9fa262e` |
| Apps Script source updated | PASS | Confirmed by project owner |
| Apps Script deployed endpoint reachable | IN PROGRESS | Verify during AC-03 and AC-04 |
| Firestore Rules ATT-11 deployed | PASS | Deploy Firestore Rules Run #13 completed successfully |
| Admin login | PARTIAL PASS | Admin workflow was used successfully during AC-02; full role-isolation checks remain in AC-01 |
| Student login and active roster | PASS | Student successfully completed AC-02 PIN-only flow |

## Static acceptance checks

| Check | Status | Note |
|---|---|---|
| Production source compiles | PASS | Pages Run #50 completed successfully |
| Audit update/delete denied by Rules | PASS (static) | Explicit `allow update, delete: if false` under attendance audit path |
| Student attendance updates denied | PASS (static) | Attendance record update/delete restricted to admin |
| Student record read isolated by email | PASS (static) | Read requires authenticated email to equal record document ID |
| Admin-only audit dashboard mount | PASS (static) | Role-aware mount loads panel only for admin profile |
| Semester summary admin-only mount | PASS (static) | Role-aware mount loads panel only for admin profile |

Static checks do not replace runtime authorization tests. AC-01, AC-09 and AC-10 remain open until executed with real accounts.

## Completed scenario — AC-02 Stable PIN-only check-in

Status: **PASS**  
Completed: 2026-08-06 13:09 UTC+7  
Evidence source: project owner reported `AC-PASS` after executing the production checklist.

Validated behavior:

- Admin opened a PIN-only session.
- Student submitted the valid PIN successfully.
- Repeated submission remained idempotent and did not create a duplicate record.
- Invalid PIN was rejected without replacing the valid record.
- Admin observed one attendance record.
- Reload restored the session and existing receipt.
- No blocking defect was reported.

## Active scenario — AC-03 QR + PIN without photo

Status: **IN PROGRESS**  
Started: 2026-08-06 13:09 UTC+7

### Required execution

1. Admin opens a new session using preset `Tiêu chuẩn — QR + PIN`.
2. Confirm the session policy requires QR and PIN but does not require photo.
3. Student signs in and selects the new session.
4. Student scans or imports the active QR code.
5. Confirm the QR claim is accepted and the UI advances to PIN verification without requesting camera/photo evidence.
6. Enter the valid PIN and submit.
7. Verify a successful receipt is displayed.
8. Verify the admin roster shows exactly one record for the student.
9. Verify the record is consistent with:
   - `status = present`
   - `verificationMode = qr_pin_no_photo`
   - `evidenceLevel = qr_verified`
   - `qrVerified = true`
   - `photoProvided = false`
10. Attempt to reuse the same QR claim or submit the flow again and verify no duplicate record is created.
11. Try an expired or stale QR after rotation, when practical, and verify it is rejected.
12. Reload admin and student pages and verify the record/receipt remains visible.

### PASS criteria

- The deployed Apps Script action `completeAttendanceWithoutPhoto` is reachable.
- QR identity/session binding and PIN verification both succeed.
- The no-photo preset never requests or requires photo evidence.
- Exactly one `qr_pin_no_photo` record is created.
- Reused, expired or stale QR claims are rejected.
- No severe browser console error occurs.

### Evidence to record

- Sanitized session title or ID.
- Whether the QR was scanned or imported.
- Confirmation that no photo prompt appeared.
- Receipt result and admin row count.
- Retry/stale-QR result.
- Any console or Apps Script error text with tokens, QR claims, PINs and personal data removed.

## Scenario results

| ID | Scenario | Priority | Status | Defect | Notes |
|---|---|---:|---|---|---|
| AC-01 | Authentication and role isolation | P0 | DEFERRED | — | Owner requested proceeding to AC-02; AC-01 remains required before release |
| AC-02 | Stable PIN-only check-in | P1 | PASS | — | Production checklist completed; owner reported AC-PASS |
| AC-03 | QR + PIN without photo | P1 | IN PROGRESS | — | Verifies deployed Apps Script no-photo endpoint |
| AC-04 | QR + PIN + photo | P1 | READY TO RUN | — | Requires camera/photo permission |
| AC-05 | Fallback and teacher review | P1 | READY TO RUN | — | |
| AC-06 | Manual teacher attendance | P1 | READY TO RUN | — | |
| AC-07 | Realtime roster and missing students | P1 | READY TO RUN | — | |
| AC-08 | Session CSV export | P1 | READY TO RUN | — | |
| AC-09 | Student history privacy and accuracy | P0/P1 | READY TO RUN | — | |
| AC-10 | Append-only audit | P0/P1 | READY TO RUN | — | Rules deployment already confirmed |
| AC-11 | Semester summary | P1 | READY TO RUN | — | |
| AC-12 | Session recovery and expiry | P1 | READY TO RUN | — | |

## Defect register

| Defect | Severity | Scenario | Status | Summary |
|---|---:|---|---|---|
| — | — | — | — | No defect recorded yet |

## Data reconciliation

### Session CSV

| Session | Dashboard rows | CSV rows | Firestore records | Result |
|---|---:|---:|---:|---|
| — | — | — | — | NOT RUN |

### Semester summary

| Metric | Expected | UI | CSV by student | CSV by session | Result |
|---|---:|---:|---:|---:|---|
| Students | — | — | — | — | NOT RUN |
| Sessions | — | — | — | — | NOT RUN |
| Present | — | — | — | — | NOT RUN |
| Recorded | — | — | — | — | NOT RUN |
| Absent | — | — | — | — | NOT RUN |
| Excused | — | — | — | — | NOT RUN |
| Rejected | — | — | — | — | NOT RUN |
| Attendance rate | — | — | — | — | NOT RUN |

## Release recommendation

**Current decision: NOT READY — AC-02 passed, AC-03 is in progress, and AC-01 remains deferred.**

Final decision options:

- READY FOR `v0.6.0`
- READY WITH DOCUMENTED P2/P3 LIMITATIONS
- NOT READY — P0/P1 DEFECTS REMAIN
