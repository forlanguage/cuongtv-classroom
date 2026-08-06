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
| Firestore Rules ATT-11 deployed | NOT RUN | Confirm workflow result and runtime behavior during AC-10 |
| Admin login | NOT RUN | Manual browser step required |
| Student login and active roster | NOT RUN | Manual browser step required |

## Scenario results

| ID | Scenario | Priority | Status | Defect | Notes |
|---|---|---:|---|---|---|
| AC-01 | Authentication and role isolation | P0 | NOT RUN | — | |
| AC-02 | Stable PIN-only check-in | P1 | NOT RUN | — | |
| AC-03 | QR + PIN without photo | P1 | NOT RUN | — | |
| AC-04 | QR + PIN + photo | P1 | NOT RUN | — | |
| AC-05 | Fallback and teacher review | P1 | NOT RUN | — | |
| AC-06 | Manual teacher attendance | P1 | NOT RUN | — | |
| AC-07 | Realtime roster and missing students | P1 | NOT RUN | — | |
| AC-08 | Session CSV export | P1 | NOT RUN | — | |
| AC-09 | Student history privacy and accuracy | P0/P1 | NOT RUN | — | |
| AC-10 | Append-only audit | P0/P1 | NOT RUN | — | |
| AC-11 | Semester summary | P1 | NOT RUN | — | |
| AC-12 | Session recovery and expiry | P1 | NOT RUN | — | |

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

**Current decision: NOT READY — acceptance execution has started but production scenarios have not yet been run.**

Final decision options:

- READY FOR `v0.6.0`
- READY WITH DOCUMENTED P2/P3 LIMITATIONS
- NOT READY — P0/P1 DEFECTS REMAIN
