import fs from 'node:fs';

const requiredSystemUsers = new Map([
  ['cuongtv@uit.edu.vn', 'admin'],
  ['cuongtv.ee@gmail.com', 'student'],
]);

function parseCsv(path) {
  const text = fs.readFileSync(path, 'utf8').trim();
  const [headerLine, ...lines] = text.split(/\r?\n/);
  const headers = headerLine.split(',').map((value) => value.trim());
  return lines.filter(Boolean).map((line) => {
    const values = line.split(',').map((value) => value.trim());
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
  });
}

const systemUsers = parseCsv('course/system-users.csv');
const students = parseCsv('course/students.csv');
const systemByEmail = new Map(systemUsers.map((user) => [user.email.toLowerCase(), user.role]));

for (const [email, role] of requiredSystemUsers) {
  if (systemByEmail.get(email) !== role) {
    throw new Error(`Missing required identity: ${email} with role ${role}`);
  }
}

const duplicateStudentEmails = students
  .map((student) => student.email.toLowerCase())
  .filter((email, index, all) => all.indexOf(email) !== index);

if (duplicateStudentEmails.length > 0) {
  throw new Error(`Duplicate student emails: ${[...new Set(duplicateStudentEmails)].join(', ')}`);
}

const accessRoster = [
  ...systemUsers.map((user) => ({
    email: user.email.toLowerCase(),
    role: user.role,
    displayName: user.display_name,
    source: user.source || 'system',
  })),
  ...students.map((student) => ({
    email: student.email.toLowerCase(),
    role: 'student',
    studentId: student.student_id,
    displayName: student.full_name,
    classCode: student.class_code,
    source: 'class-roster',
  })),
];

fs.mkdirSync('.generated', { recursive: true });
fs.writeFileSync('.generated/access-roster.json', `${JSON.stringify(accessRoster, null, 2)}\n`);

console.log(`Roster valid: ${students.length} class students + ${systemUsers.length} fixed identities.`);
console.log(`Generated ${accessRoster.length} access records in .generated/access-roster.json.`);
console.log('All users must authenticate through Google before role resolution.');
