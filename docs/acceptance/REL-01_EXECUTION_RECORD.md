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
| Apps Script | User confirmed updated `apps-script/Code.gs`; deployed web-app version still requires runtime verification |

## Preflight

| Check | Status | Evidence / note |
|---|---|---|
| Production Pages build | PASS | GitHub Pages Run #50 completed successfully |
| ATT-12 merge on `main` | PASS | Commit `41937d7e8c836d9cf7123d15880d3546c9fa262e` |
| Apps Script source updated | PASS | Confirmed by project owner |
| Apps Script deployed endpoint reachable | NOT RUN | Verify during AC-03 and AC-04 |
| Firestore Rules ATT-11 deployed | PASS | Deploy Firestore Rules Run #13 completed successfully |
| Admin login | NOT RUN | Manual browser step required |
| Student login and active roster | NOT RUN | Manual browser step required |

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

## Active scenario — AC-02 Stable PIN-only check-in

Status: **IN PROGRESS**  
Started: 2026-08-06 12:49 UTC+7

### Required execution

1. Admin signs in and opens a new attendance session with preset `Nhanh — PIN-only`.
2. Record the session title and expiry time. Do not store the PIN in GitHub evidence.
3. Student signs in with the active roster account.
4. Student enters the valid PIN and submits once.
5. Verify the UI shows a successful receipt and the admin realtime roster shows exactly one attendance record.
6. Submit the same PIN again from the same student account.
7. Verify no duplicate record is created and the original receipt/record remains authoritative.
8. Verify the record fields shown by the UI are consistent with:
   - `status = recorded`
   - `verificationMode = pin_only`
   - `evidenceLevel = limited`
   - `reviewStatus = needs_review`
9. Enter an invalid PIN and verify the attempt is rejected without creating or replacing a record.
10. Reload both admin and student pages and verify the session and existing receipt recover correctly.

### PASS criteria

- One student produces exactly one attendance document for the session.
- Repeated valid submission is idempotent.
- Invalid PIN does not create or modify attendance data.
- The record is marked for teacher review and appears realtime in the admin roster.
- No severe browser console error occurs.

### Evidence to record

- Session title or sanitized session ID.
- First submission result.
- Repeated submission result.
- Invalid PIN result.
- Admin roster row count before and after.
- Any console error text with tokens, PINs and personal data removed.

## Scenario results

| ID | Scenario | Priority | Status | Defect | Notes |
|---|---|---:|---|---|---|
| AC-01 | Authentication and role isolation | P0 | DEFERRED | — | Owner requested proceeding to AC-02; AC-01 remains required before release |
| AC-02 | Stable PIN-only check-in | P1 | IN PROGRESS | — | Production manual execution started |
| AC-03 | QR + PIN without photo | P1 | READY TO RUN | — | Also verifies deployed Apps Script endpoint |
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

**Current decision: NOT READY — AC-02 is in progress and AC-01 remains deferred.**

Final decision options:

- READY FOR `v0.6.0`
- READY WITH DOCUMENTED P2/P3 LIMITATIONS
- NOT READY — P0/P1 DEFECTS REMAIN
