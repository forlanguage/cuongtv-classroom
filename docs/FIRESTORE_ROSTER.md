# Firestore roster workflow

## Required repository secrets

- `VITE_FIREBASE_PROJECT_ID`: Firebase project ID used by the web build and rules deployment.
- `FIREBASE_SERVICE_ACCOUNT`: complete Firebase service-account JSON, stored as a single GitHub Actions secret.

## Deploy security rules

Run the **Deploy Firestore Rules** workflow from the Actions tab.

## Import the course roster

Run the **Import Firestore Roster** workflow and keep the default course ID `IT006.Q24`.

The workflow validates and imports:

- all entries in `course/students.csv` as students;
- `cuongtv@uit.edu.vn` as admin;
- `cuongtv.ee@gmail.com` as a test student.

All users still authenticate through Google. The roster only controls authorization after Firebase Authentication succeeds.

## Firestore paths

```text
courses/IT006.Q24
courses/IT006.Q24/roster/{normalized-email}
```

Each roster document includes role, name, student ID, class code, active status, source, and server update timestamp.
