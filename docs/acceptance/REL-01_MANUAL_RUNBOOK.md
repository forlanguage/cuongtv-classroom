# REL-01 — Manual Production Runbook

Environment: `https://forlanguage.github.io/cuongtv-classroom/`

Accounts:
- Admin: `cuongtv@uit.edu.vn`
- Student: `cuongtv.ee@gmail.com`

Use two browser profiles or one normal window plus one private window. Keep DevTools Console open in both windows. Do not include PINs, QR payloads, ID tokens, student photos, or private Firestore data in screenshots committed to GitHub.

## Evidence naming

Use this pattern for local evidence files:

`REL01-ACxx-step-description-YYYYMMDD-HHMM.png`

Record only the evidence description and result in `REL-01_EXECUTION_RECORD.md`; store sensitive screenshots outside the public repository.

## AC-01 — Authentication and role isolation

1. Open production in the admin browser profile.
2. Sign in as `cuongtv@uit.edu.vn`.
3. Confirm admin panels are visible: session controls, realtime roster, manual teacher, audit log, semester summary.
4. Open production in the student browser profile.
5. Sign in as `cuongtv.ee@gmail.com`.
6. Confirm student attendance and history panels are visible.
7. Confirm admin-only panels are absent in the student profile.
8. Attempt no direct Firestore manipulation; runtime Rules isolation is validated later through UI behavior and emulator tests in TEST-02.

PASS when roles receive only their intended interface and no uncaught console error blocks use.

## AC-02 — Stable PIN-only check-in

1. Admin opens a session using the `Nhanh — PIN-only` preset.
2. Record session title and displayed PIN privately.
3. Wait for at least one QR/challenge timer interval.
4. Confirm the PIN has not changed.
5. Reload the admin page and confirm the same open session and PIN are recovered.
6. Student selects the session and submits the correct PIN.
7. Confirm receipt shows `pin_only`, limited evidence, and pending review.
8. Submit the same PIN again.
9. Confirm the original receipt is returned and only one attendance record exists.
10. Admin confirms the student appears once in the realtime roster.

PASS when PIN remains stable, recovery works, and repeated submission is idempotent.

## AC-03 — QR + PIN without photo

1. Admin closes the prior test session or creates a uniquely named new session with `Tiêu chuẩn — QR + PIN`.
2. Student scans/loads the QR claim.
3. Student enters the session PIN.
4. Complete attendance without providing a photo.
5. Confirm receipt reports `qr_pin_no_photo`, `qr_verified`, `qrVerified=true`, and `photoProvided=false`.
6. Confirm Apps Script returns success rather than unknown-action or policy errors.
7. Confirm admin roster shows the record as present and verification label `QR + PIN`.

PASS when the deployed Apps Script endpoint completes the no-photo flow and creates one correct record.

## AC-04 — QR + PIN + photo

1. Admin creates a session with `Xác minh cao — QR + PIN + ảnh`.
2. Student grants camera/photo permission.
3. Student completes QR, PIN and photo evidence.
4. Confirm receipt reports `qr_pin_photo` and photo evidence is accepted.
5. Confirm admin roster shows full verification.
6. Confirm no public URL exposes the photo without authorization.

PASS when full evidence flow succeeds without fallback.

## AC-05 — Fallback and teacher review

1. Use an open session that allows fallback or intentionally fail the camera/QR step.
2. Submit through the fallback PIN panel.
3. Confirm the record is `recorded`, `limited`, `needs_review`.
4. Admin chooses one decision: approve, excused, or reject, and enters a note.
5. Confirm roster updates in realtime.
6. Confirm student history updates in realtime.
7. Confirm one matching audit entry appears with actor, old/new state and reason.

PASS when fallback never masquerades as full verification and teacher review propagates everywhere.

## AC-06 — Manual teacher attendance

1. Admin selects an open session and a roster student.
2. Enter a non-sensitive test note.
3. Submit manual attendance.
4. Confirm `manual_teacher`, `teacher_confirmed`, `approved`, `present`.
5. Confirm student history, session CSV, audit and semester summary include the record.

PASS when one teacher-confirmed record and one audit entry are created.

## AC-07 — Realtime roster and missing students

1. Keep admin and student windows open simultaneously.
2. Before student check-in, confirm the student is listed as missing.
3. Complete a student check-in.
4. Confirm admin roster changes without reload.
5. Confirm roster total, recorded/present and missing counts reconcile.
6. Check that unmatched or legacy records do not incorrectly reduce roster missing count.

PASS when realtime state and counters are internally consistent.

## AC-08 — Session CSV export

1. Export CSV for a session containing at least one present record and one missing roster student.
2. Open the file in Excel or another UTF-8-aware spreadsheet.
3. Confirm Vietnamese text is correct.
4. Confirm exactly one row per roster student plus any intentionally unmatched record.
5. Compare status, verification, review note, reviewer and timestamps with the dashboard.
6. Record row counts in the execution record.

PASS when exported data matches the dashboard and Firestore-derived counts.

## AC-09 — Student history privacy and accuracy

1. Student confirms only their own records appear.
2. Compare one reviewed record and one full-verification record with admin data.
3. Confirm status, verification, note and reviewed time match.
4. Confirm no UI path exposes another student's email or history.
5. Sign out and verify history disappears.

PASS when history is accurate and isolated to the authenticated student.

## AC-10 — Append-only audit

1. Perform one teacher review and one manual teacher attendance action.
2. Confirm separate audit entries appear.
3. Confirm actor email, timestamp, previous/new status and reason are correct.
4. Confirm the student account cannot see the audit panel.
5. Confirm no UI offers edit/delete for audit entries.
6. Record that Firestore Rules Run #13 deployed successfully; destructive API-level denial will be automated in TEST-02.

PASS for REL-01 when runtime visibility is correct and entries persist after reload. Full update/delete denial remains a TEST-02 quality gate.

## AC-11 — Semester summary

1. Ensure the test data includes present, recorded, excused, rejected and missing outcomes where practical.
2. Record expected totals manually.
3. Compare student table, session table and KPI cards.
4. Export CSV by student and CSV by session.
5. Confirm `attendance rate = (present + excused) / total opportunities`.
6. Enter all reconciliation values in the execution record.

PASS when UI and both CSV exports match the same expected totals.

## AC-12 — Session recovery and expiry

1. Admin opens a short-lived test session.
2. Reload admin and student pages; confirm session recovery.
3. Let the session expire.
4. Confirm new attendance submission is rejected.
5. Confirm historical attendance remains visible where designed.
6. Confirm no duplicate active session is created by repeated reloads.

PASS when recovery is stable and server-backed expiry prevents late writes.

## Completion

After all scenarios:

1. Update every scenario row in `REL-01_EXECUTION_RECORD.md`.
2. File each production defect as a separate GitHub issue with severity P0–P3.
3. Link defects from the execution record.
4. Mark PR #57 ready for review only when all P0/P1 cases pass.
5. Merge PR #57 and close #42.
6. Start REL-02 only after the release recommendation is READY or READY WITH P2/P3 LIMITATIONS.
