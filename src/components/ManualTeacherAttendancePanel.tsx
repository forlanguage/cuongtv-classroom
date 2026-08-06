import { useEffect, useMemo, useState } from 'react';
import { Timestamp, collection, doc, onSnapshot, serverTimestamp, setDoc, type Firestore } from 'firebase/firestore';
import { auth, db } from '../services/firebase';
import { ACTIVE_COURSE_ID, type AccessProfile } from '../services/roster';
import { observeOpenAttendanceSessions, type AttendanceSession } from '../services/attendance';

function requireDb(): Firestore {
  if (!db) throw new Error('Firestore chưa được cấu hình.');
  return db;
}

export function ManualTeacherAttendancePanel() {
  const [sessions, setSessions] = useState<AttendanceSession[]>([]);
  const [roster, setRoster] = useState<AccessProfile[]>([]);
  const [sessionId, setSessionId] = useState('');
  const [studentEmail, setStudentEmail] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => observeOpenAttendanceSessions(setSessions), []);
  useEffect(() => {
    if (!db) return undefined;
    const firestore = requireDb();
    return onSnapshot(collection(firestore, 'courses', ACTIVE_COURSE_ID, 'roster'), (snapshot) => {
      setRoster(snapshot.docs.map((item) => {
        const data = item.data();
        return {
          email: item.id,
          role: data.role,
          fullName: String(data.fullName || ''),
          studentId: String(data.studentId || ''),
          classCode: String(data.classCode || ACTIVE_COURSE_ID),
          active: data.active === true,
          source: String(data.source || 'firestore-roster'),
        } as AccessProfile;
      }).filter((item) => item.active && item.role === 'student'));
    });
  }, []);

  const students = useMemo(() => [...roster].sort((a, b) => a.studentId.localeCompare(b.studentId)), [roster]);

  async function submit() {
    const session = sessions.find((item) => item.id === sessionId);
    const student = students.find((item) => item.email === studentEmail);
    if (!session || !student || !auth?.currentUser || busy) return;
    setBusy(true);
    try {
      const firestore = requireDb();
      await setDoc(doc(firestore, 'courses', ACTIVE_COURSE_ID, 'attendanceSessions', session.id, 'records', student.email), {
        email: student.email,
        uid: 'manual_teacher',
        studentId: student.studentId,
        fullName: student.fullName,
        classCode: student.classCode,
        requestId: crypto.randomUUID(),
        checkedInAt: serverTimestamp(),
        status: 'present',
        statusLabel: 'Có mặt',
        verificationMode: 'manual_teacher',
        evidenceLevel: 'teacher_confirmed',
        qrVerified: false,
        photoProvided: false,
        reviewStatus: 'approved',
        reviewDecision: 'approved',
        reviewNote: note.trim(),
        reviewedAt: serverTimestamp(),
        reviewedBy: auth.currentUser.email || 'teacher',
        updatedAt: serverTimestamp(),
        source: 'manual_teacher',
      }, { merge: false });
      setMessage(`Đã ghi nhận thủ công ${student.studentId} · ${student.fullName}.`);
      setStudentEmail('');
      setNote('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể ghi nhận thủ công.');
    } finally { setBusy(false); }
  }

  if (!sessions.length) return null;

  return <section className="workflow dashboard-panel manual-teacher-panel">
    <span className="panel-label">MANUAL TEACHER</span>
    <h2>Giảng viên ghi nhận thủ công</h2>
    <p>Dùng khi giảng viên trực tiếp xác nhận sinh viên có mặt. Record được lưu với <code>manual_teacher</code> và xuất hiện trong lịch sử/audit.</p>
    <div className="manual-teacher-form">
      <select value={sessionId} onChange={(event) => setSessionId(event.target.value)}>
        <option value="">Chọn phiên điểm danh</option>
        {sessions.map((session) => <option key={session.id} value={session.id}>{session.title} · {session.expiresAt instanceof Timestamp ? session.expiresAt.toDate().toLocaleTimeString('vi-VN') : ''}</option>)}
      </select>
      <select value={studentEmail} onChange={(event) => setStudentEmail(event.target.value)}>
        <option value="">Chọn sinh viên</option>
        {students.map((student) => <option key={student.email} value={student.email}>{student.studentId} · {student.fullName}</option>)}
      </select>
      <input value={note} maxLength={300} onChange={(event) => setNote(event.target.value)} placeholder="Ghi chú của giảng viên" />
      <button disabled={busy || !sessionId || !studentEmail} onClick={() => void submit()}>{busy ? 'Đang lưu…' : 'Ghi nhận có mặt'}</button>
    </div>
    {message && <p className="notice">{message}</p>}
  </section>;
}
