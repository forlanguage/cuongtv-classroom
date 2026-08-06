# Deferred evidence attendance flow

## Student flow

1. Enter the active session PIN.
2. Backend validates the PIN and returns a short-lived evidence token.
3. Capture or select a QR evidence image. The browser does not decode the QR.
4. Capture a face evidence image and show a preview.
5. Submit both images once.
6. Store the attendance record as `recorded` with `reviewStatus: needs_review`.
7. A teacher later approves the record as `present` or rejects it.

## Security invariants

- PIN validation must be server-side.
- The evidence token is bound to Firebase UID, email, course, session, and expiry.
- The session must still be open at PIN confirmation time.
- Evidence submission is idempotent by request ID.
- QR and face images are evidence only; neither is considered verified automatically.
- The initial result must never be `present`.

## Record fields

- `verificationMode: pin_qr_face_deferred`
- `evidenceLevel: deferred_review`
- `qrVerified: false`
- `qrPhotoProvided: true`
- `photoProvided: true`
- `status: recorded`
- `statusLabel: Đã ghi nhận`
- `reviewStatus: needs_review`
