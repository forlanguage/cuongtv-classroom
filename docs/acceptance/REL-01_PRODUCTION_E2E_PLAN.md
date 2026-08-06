# REL-01 — Production Attendance E2E Acceptance Test

Issue: #42  
Target release: `v0.6.0`  
Environment: `https://forlanguage.github.io/cuongtv-classroom/`

## 1. Objective

Validate the deployed ATT-01 through ATT-12 attendance workflow with real authenticated roles before releasing `v0.6.0`.

The test must confirm functional correctness, authorization boundaries, idempotency, auditability, export consistency, and semester aggregation.

## 2. Test accounts

| Role | Account | Expected access |
|---|---|---|
| Administrator | `cuongtv@uit.edu.vn` | Session management, roster, review, manual attendance, audit, exports, semester summary |
| Student | `cuongtv.ee@gmail.com` | Own check-in flows and own attendance history only |

Do not store passwords, cookies, ID tokens, PINs, QR payloads, or photo evidence in this repository.

## 3. Preconditions

- [x] GitHub Pages ATT-12 deployment Run #50 completed successfully.
- [ ] Updated Apps Script deployment contains `completeAttendanceWithoutPhoto`.
- [ ] Firestore Rules deployment for ATT-11 is successful.
- [ ] Admin and student accounts can sign in with verified Google accounts.
- [ ] Student account is active in the course roster.
- [ ] Browser console and Network panel are available for defect evidence.
- [ ] Test sessions are clearly named with prefix `REL-01`.

## 4. Severity and decision rules

| Severity | Definition | Release impact |
|---|---|---|
| P0 | Data exposure, authorization bypass, destructive corruption, or attendance impossible for all users | Blocks release |
| P1 | Core flow fails, duplicate/inconsistent record, missing audit, wrong summary/export | Blocks release |
| P2 | Recoverable UX defect or limited edge case | Fix or document before release decision |
| P3 | Cosmetic issue | May be deferred |

REL-01 passes only when every P0/P1 scenario passes and no unresolved P0/P1 defect remains.

## 5. Test data strategy

Create separate production sessions for each verification mode. Do not reuse a session across incompatible policies.

Recommended names:

- `REL-01 PIN ONLY`
- `REL-01 QR PIN`
- `REL-01 QR PIN PHOTO`
- `REL-01 FALLBACK REVIEW`
- `REL-01 MANUAL TEACHER`

Keep test sessions available until CSV, audit, history, and semester totals have been verified. Archive or clearly mark them after REL-01.

## 6. Acceptance scenarios

### AC-01 Authentication and role isolation — P0

1. Sign in as administrator.
2. Confirm all admin attendance panels are visible.
3. Sign out and sign in as student.
4. Confirm admin panels are absent.
5. Attempt to access another student's attendance document through the UI or browser tooling.

Expected:

- Admin sees administrative functions.
- Student sees only student functions.
- Student cannot read another student's record, audit collection, private session configuration, or admin-only summaries.

### AC-02 Stable PIN-only check-in — P1

1. Admin opens a `Nhanh — PIN-only` session.
2. Reload the admin page and confirm the session and PIN recover.
3. Student enters the correct PIN.
4. Student submits the same request again or reloads and retries.

Expected:

- One attendance document only.
- `verificationMode = pin_only`.
- `evidenceLevel = limited`.
- `status = recorded`.
- `reviewStatus = needs_review`.
- Duplicate submission returns the original receipt and does not create another record.

### AC-03 QR + PIN without photo — P1

1. Admin opens a `Tiêu chuẩn — QR + PIN` session.
2. Student claims the active QR challenge.
3. Student submits the current session PIN without a photo.

Expected:

- Apps Script accepts `completeAttendanceWithoutPhoto`.
- Record uses `verificationMode = qr_pin_no_photo`.
- `qrVerified = true`, `photoProvided = false`.
- Status is `present`.
- Claim and request are idempotent.

### AC-04 QR + PIN + photo — P1

1. Admin opens a high-verification session requiring photo.
2. Student claims QR, enters PIN, and submits valid photo evidence.
3. Verify the record and evidence metadata.

Expected:

- Record uses `verificationMode = qr_pin_photo`.
- `qrVerified = true`, `photoProvided = true`.
- Photo metadata is present and the file is stored through the configured Apps Script/Drive flow.
- Oversized or empty photo is rejected without creating a partial record.

### AC-05 Non-blocking fallback and teacher review — P1

1. Open a session that permits PIN-only fallback.
2. Simulate QR/camera failure and submit through the fallback panel.
3. Admin reviews the record as approved, excused, and rejected in separate test records or sessions.

Expected:

- Fallback remains limited evidence and requires review.
- Review changes status, status label, decision, note, reviewer, and server timestamp.
- Student history updates in realtime.
- Audit entry shows actor, previous/new state, reason, and server timestamp.

### AC-06 Manual teacher attendance — P1

1. Admin selects an active session and student.
2. Add a required test note and record attendance manually.

Expected:

- One record with `verificationMode = manual_teacher`.
- `evidenceLevel = teacher_confirmed`.
- Status is present and review is approved.
- Student history, session roster, semester summary, and audit reflect the action.

### AC-07 Realtime roster and missing students — P1

1. Open an attendance session with the full active roster.
2. Check in only the test student.
3. Compare roster total, recorded, present, pending, and missing counts.

Expected:

- Every active student appears exactly once.
- Missing students are visible and correctly counted.
- Orphan records, if any, remain diagnosable without corrupting roster totals.

### AC-08 Session CSV export — P1

1. Export the active session CSV after mixed statuses exist.
2. Open it in Excel or another spreadsheet application.
3. Compare rows against Firestore and the dashboard.

Expected:

- UTF-8 Vietnamese text renders correctly.
- Full roster is included, including missing students.
- Review status, notes, reviewer, and timestamps match source records.
- No formula injection or malformed cells from commas, quotes, or line breaks.

### AC-09 Student history privacy and accuracy — P0/P1

1. Sign in as the test student.
2. Verify the newest attendance events.
3. Review approved, excused, rejected, fallback, and manual records.
4. Attempt to read another student's history.

Expected:

- Student sees only own records.
- Displayed session, time, status, verification mode, review note, and review time match Firestore.
- Cross-student read is denied.

### AC-10 Append-only audit — P0/P1

1. Perform teacher review and manual attendance.
2. Confirm corresponding audit entries.
3. Attempt audit update and delete through an authenticated admin client.

Expected:

- Required audit fields are present.
- Audit creation succeeds only for authenticated admin actor values matching the request.
- Update and delete are denied.
- No duplicate audit entry is created for one teacher action.

### AC-11 Semester summary — P1

1. Create a controlled set of sessions and statuses.
2. Calculate expected per-student and per-session totals manually.
3. Compare dashboard and both semester CSV files.

Expected:

- Present, recorded, absent, excused, and rejected counts match source records.
- Rate uses `(present + excused) / total opportunities`.
- Pending `recorded` entries are not counted as attended.
- CSV and UI totals are identical.

### AC-12 Session recovery and expiry — P1

1. Open a short session.
2. Reload the admin page and student page.
3. Confirm active session recovery.
4. Wait until expiry and retry check-in.

Expected:

- One active session is recovered after reload.
- Stable session PIN remains unchanged.
- QR challenge may rotate independently.
- Expired sessions reject new attendance writes.

## 7. Evidence requirements

For every scenario record:

- test date/time and tester;
- session ID/title;
- browser/device;
- result: PASS, FAIL, BLOCKED, or NOT RUN;
- expected versus actual result;
- relevant Firestore document paths without secrets;
- screenshot or console/network excerpt for failures;
- defect issue number and severity.

Never commit authentication tokens, PIN values, QR payloads, or student photo files.

## 8. Exit checklist

- [ ] All P0 scenarios passed.
- [ ] All P1 scenarios passed.
- [ ] No unresolved P0/P1 defect.
- [ ] CSV data reconciled with Firestore.
- [ ] Semester summary reconciled with controlled test data.
- [ ] Audit immutability confirmed.
- [ ] Test sessions cleaned up or marked for exclusion.
- [ ] Release recommendation recorded in the execution report.
