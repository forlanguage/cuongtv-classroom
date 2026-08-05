# CuongTV Classroom Apps Script gateway

This Apps Script web app stores attendance photos and immutable submission PDFs in the lecturer's Google Drive. It also verifies short-lived attendance challenges, issues one-time student claims, writes attendance receipts to Firestore, and emails submission receipts.

## Setup

1. Create a standalone Apps Script project under the lecturer's Google Workspace account.
2. Copy `Code.gs` and `appsscript.json` into the project.
3. In **Project Settings → Script properties**, add:
   - `FIREBASE_WEB_API_KEY`: the same public Firebase Web API key used by the frontend.
   - `FIREBASE_PROJECT_ID`: `cuongtv-faa00` for the current deployment.
   - `ROOT_FOLDER_ID` (optional): the real Google Drive folder ID, not its display name. If omitted, the script creates or reuses `CuongTV Classroom` in My Drive.
4. Save the manifest and authorize the new `cloud-platform` scope when prompted.
5. Deploy as **Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone**
6. Copy the `/exec` URL into the GitHub Actions secret `VITE_APPS_SCRIPT_URL`.

After changing `Code.gs`, `appsscript.json`, scopes, or script properties, edit the deployment and select **New version**. Reusing an old deployment version will continue running old code.

The endpoint is publicly reachable, but every request must include a valid Firebase ID token. The script verifies the authenticated email and checks the Firestore roster before issuing an attendance claim.

## Attendance protocol

### `claimAttendanceChallenge`

- QR contains only a random `challenge` ID.
- The frontend separately sends the session selected by the student.
- Backend checks the current session challenge, server expiry, 30-second grace period, session status, and roster.
- A claim bound to Firebase UID and email is cached for 180 seconds.

### `completeAttendance`

- Validates the one-time claim and private PIN.
- Accepts a compressed JPEG up to 500 KB.
- Uses `requestId` for idempotent retries on unstable Wi-Fi.
- Stores the image under:

```text
<root>/<courseId>/attendance/<sessionId>/<studentId>_<requestId>.jpg
```

- Writes the attendance receipt through the Firestore REST API.
- Marks the claim consumed only after Drive upload and Firestore write succeed.

## Submission evidence

### `createSubmissionEvidence`

Creates an immutable PDF from the locked submission payload, stores it under:

```text
<root>/<courseId>/assignments/<assignmentId>/submissions/<studentId>/
```

The script grants Viewer access to the authenticated student email and sends a receipt email containing view/download links, submission ID, timestamp, MCQ score, and SHA-256.

## Security notes

- Keep Drive files restricted; do not enable `Anyone with the link`.
- The attendance PIN is stored in `attendanceSessions/{sessionId}/private/config`, readable only by the admin account.
- Student clients cannot create attendance records directly; the Apps Script backend owns that write.
- Email delivery failure must not invalidate a Firestore submission.
