import fs from 'node:fs';
import process from 'node:process';
import admin from 'firebase-admin';

const COURSE_ID = process.env.COURSE_ID || 'IT006.Q24';
const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;

if (!serviceAccountJson) {
  throw new Error('Missing FIREBASE_SERVICE_ACCOUNT secret.');
}

const serviceAccount = JSON.parse(serviceAccountJson);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

function parseCsv(path) {
  const text = fs.readFileSync(path, 'utf8').trim();
  const [headerLine, ...lines] = text.split(/\r?\n/);
  const headers = headerLine.split(',').map((value) => value.trim());

  return lines.filter(Boolean).map((line) => {
    const values = line.split(',').map((value) => value.trim());
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
  });
}

const students = parseCsv('course/students.csv').map((student) => ({
  email: student.email.toLowerCase(),
  role: 'student',
  studentId: student.student_id,
  fullName: student.full_name,
  classCode: student.class_code,
  source: 'class-roster',
}));

const systemUsers = parseCsv('course/system-users.csv').map((user) => ({
  email: user.email.toLowerCase(),
  role: user.role,
  studentId: user.role === 'student' ? 'TEST-STUDENT' : '',
  fullName: user.display_name,
  classCode: COURSE_ID,
  source: user.source,
}));

const records = [...students, ...systemUsers];
const uniqueEmails = new Set(records.map((record) => record.email));
if (uniqueEmails.size !== records.length) {
  throw new Error('Duplicate email detected in merged roster.');
}

const courseRef = db.collection('courses').doc(COURSE_ID);
await courseRef.set({
  courseId: COURSE_ID,
  courseName: 'Kiến trúc máy tính',
  classCode: COURSE_ID,
  semester: '2',
  academicYear: '2025-2026',
  rosterCount: records.length,
  updatedAt: admin.firestore.FieldValue.serverTimestamp(),
}, { merge: true });

let batch = db.batch();
let batchSize = 0;
let written = 0;

for (const record of records) {
  const ref = courseRef.collection('roster').doc(record.email);
  batch.set(ref, {
    ...record,
    active: true,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  batchSize += 1;
  written += 1;

  if (batchSize === 400) {
    await batch.commit();
    batch = db.batch();
    batchSize = 0;
  }
}

if (batchSize > 0) await batch.commit();
console.log(`Imported ${written} access records into courses/${COURSE_ID}/roster.`);
