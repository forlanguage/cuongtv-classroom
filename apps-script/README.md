# CuongTV Classroom Apps Script gateway

This Apps Script web app stores attendance photos and immutable submission PDFs in the lecturer's Google Drive. It also emails submission receipts to students.

## Setup

1. Create a standalone Apps Script project under the lecturer's Google Workspace account.
2. Copy `Code.gs` and `appsscript.json` into the project.
3. In **Project Settings → Script properties**, add:
   - `FIREBASE_WEB_API_KEY`: the same public Firebase Web API key used by the frontend.
   - `ROOT_FOLDER_ID` (optional): a private Google Drive folder owned by the lecturer. If omitted, the script creates or reuses `CuongTV Classroom` in My Drive.
4. Deploy as **Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone**
5. Copy the `/exec` URL into the GitHub Actions secret `VITE_APPS_SCRIPT_URL`.

The endpoint is publicly reachable, but every write request must include a valid Firebase ID token. The script verifies that token through Google Identity Toolkit and requires the authenticated email to match the request payload.

## Supported actions

### `uploadAttendancePhoto`

Stores a JPEG under:

```text
<root>/<courseId>/attendance/<sessionId>/<studentId>_<firebaseUid>.jpg
```

Maximum accepted decoded image size: 500 KB.

### `createSubmissionEvidence`

Creates an immutable PDF from the locked submission payload, stores it under:

```text
<root>/<courseId>/assignments/<assignmentId>/submissions/<studentId>/
```

The script grants Viewer access to the authenticated student email and sends a receipt email containing view/download links, submission ID, timestamp, MCQ score, and SHA-256.

## Security notes

- Keep Drive files restricted; do not enable `Anyone with the link`.
- The frontend must store the structured submission in Firestore before asking Apps Script to create the PDF.
- Email delivery failure must not invalidate a Firestore submission.
- Rotate/redeploy the web app if its URL is abused.
- For production hardening, add server-side roster verification and idempotency records before creating files.
