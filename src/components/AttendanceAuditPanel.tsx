import { useEffect, useRef, useState } from 'react';
import { Timestamp, addDoc, collection, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../services/firebase';
import { ACTIVE_COURSE_ID } from '../services/roster';
import { observeOpenAttendanceSessions, type AttendanceSession } from '../services/attendance';
import { observeAttendanceAudit, requireAuditDb, type AttendanceAuditEntry } from '../services/attendanceAudit';

interface RecordState {
  email: string;
  studentId: string;
  fullName: string;
  status: string;
  reviewStatus: string;
  reviewNote: string;
  verificationMode: string;
  updatedAt: Timestamp | null;
  reviewedAt: Timestamp | null;
}

function normalizeRecord(id: string, data: Record<string, unknown>): RecordState {
  return {
    email: typeof data.email === 'string' ? data.email : id,
    studentId: typeof data.studentId === 'string' ? data.studentId : '—',
    fullName: typeof data.fullName === 'string' ? data.fullName : '',
    status: typeof data.status === 'string' ? data.status : '',
    reviewStatus: typeof data.reviewStatus === 'string' ? data.reviewStatus : '',
    reviewNote: typeof data.reviewNote === 'string' ? data.reviewNote : '',
    verificationMode: typeof data.verificationMode === 'string' ? data.verificationMode : '',
    updatedAt: data.updatedAt instanceof Timestamp ? data.updatedAt : null,
    reviewedAt: data.reviewedAt instanceof Timestamp ? data.reviewedAt : null,
  };
}

function eventLabel(entry: AttendanceAuditEntry): string {
  return entry.eventType === 'manual_teacher' ? 'Giảng viên ghi nhận thủ công' : 'Giảng viên hậu kiểm';
}

export function AttendanceAuditPanel() {
  const [sessions, setSessions] = useState<AttendanceSession[]>([]);
  const [sessionId, setSessionId] = useState('');
  const [entries, setEntries] = useState<AttendanceAuditEntry[]>([]);
  const [error, setError] = useState('');
  const previousRef = useRef<Map<string, RecordState>>(new Map());
  const initializedRef = useRef(false);
  const signaturesRef = useRef<Set<string>>(new Set());

  useEffect(() => observeOpenAttendanceSessions((items) => {
    setSessions(items);
    setSessionId((current) => current || items[0]?.id || '');
  }), []);

  useEffect(() => {
    if (!sessionId) {
      setEntries([]);
      return undefined;
    }
    return observeAttendanceAudit(sessionId, setEntries, setError);
  }, [sessionId]);

  useEffect(() => {
    if (!db || !sessionId || !auth?.currentUser) return undefined;
    const firestore = requireAuditDb();
    previousRef.current = new Map();
    initializedRef.current = false;
    signaturesRef.current = new Set();

    return onSnapshot(
      collection(firestore, 'courses', ACTIVE_COURSE_ID, 'attendanceSessions', sessionId, 'records'),
      (snapshot) => {
        const next = new Map<string, RecordState>();
        snapshot.docs.forEach((item) => next.set(item.id, normalizeRecord(item.id, item.data())));

        if (!initializedRef.current) {
          previousRef.current = next;
          initializedRef.current = true;
          return;
        }

        snapshot.docChanges().forEach((change) => {
          if (change.type === 'removed') return;
          const current = normalizeRecord(change.doc.id, change.doc.data());
          const previous = previousRef.current.get(change.doc.id);
          const isManualCreate = change.type === 'added' && current.verificationMode === 'manual_teacher';
          const isTeacherChange = change.type === 'modified' && previous
            && (previous.status !== current.status || previous.reviewStatus !== current.reviewStatus);
          if (!isManualCreate && !isTeacherChange) return;

          const eventType = isManualCreate ? 'manual_teacher' : 'teacher_review';
          const signature = [
            sessionId, current.email, eventType,
            previous?.status || '', current.status,
            previous?.reviewStatus || '', current.reviewStatus,
            current.reviewedAt?.toMillis() || current.updatedAt?.toMillis() || '',
          ].join('|');
          if (signaturesRef.current.has(signature)) return;
          signaturesRef.current.add(signature);

          void addDoc(collection(
            firestore,
            'courses', ACTIVE_COURSE_ID,
            'attendanceSessions', sessionId,
            'audit',
          ), {
            eventType,
            sessionId,
            recordEmail: current.email,
            studentId: current.studentId,
            fullName: current.fullName,
            actorEmail: auth.currentUser?.email || '',
            actorUid: auth.currentUser?.uid || '',
            previousStatus: previous?.status || 'missing',
            newStatus: current.status,
            previousReviewStatus: previous?.reviewStatus || 'not_reviewed',
            newReviewStatus: current.reviewStatus,
            reason: current.reviewNote || (isManualCreate ? 'Giảng viên xác nhận trực tiếp.' : 'Không có ghi chú.'),
            verificationMode: current.verificationMode,
            createdAt: serverTimestamp(),
            schemaVersion: 1,
          }).catch(() => setError('Không thể ghi audit entry.'));
        });

        previousRef.current = next;
      },
      () => setError('Không thể theo dõi thay đổi attendance record.'),
    );
  }, [sessionId]);

  if (!sessions.length) return null;

  return <section className="workflow dashboard-panel audit-panel">
    <div className="audit-heading">
      <div><span className="panel-label">APPEND-ONLY AUDIT</span><h2>Nhật ký thay đổi điểm danh</h2><p>Chỉ quản trị viên đọc được. Mỗi entry ghi actor, thời gian server, trạng thái trước/sau và lý do.</p></div>
      <select value={sessionId} onChange={(event) => setSessionId(event.target.value)}>
        {sessions.map((session) => <option key={session.id} value={session.id}>{session.title}</option>)}
      </select>
    </div>
    {error && <p className="notice">{error}</p>}
    {!entries.length ? <p>Chưa có thay đổi do giảng viên thực hiện trong phiên này.</p> : <div className="audit-list">
      {entries.map((entry) => <article key={entry.id} className="audit-item">
        <div><strong>{entry.studentId} · {entry.fullName || entry.recordEmail}</strong><span>{eventLabel(entry)}</span></div>
        <div className="audit-transition"><code>{entry.previousStatus || '—'}</code><b>→</b><code>{entry.newStatus || '—'}</code></div>
        <p>{entry.reason}</p>
        <small>{entry.createdAt ? entry.createdAt.toDate().toLocaleString('vi-VN') : 'Đang đồng bộ thời gian'} · {entry.actorEmail}</small>
      </article>)}
    </div>}
  </section>;
}
