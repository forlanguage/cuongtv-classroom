import { useEffect, useMemo, useState } from 'react';
import { Timestamp, collection, doc, onSnapshot, serverTimestamp, updateDoc } from 'firebase/firestore';
import { auth, db } from '../services/firebase';
import { ACTIVE_COURSE_ID } from '../services/roster';
import type { AttendanceSession } from '../services/attendance';
import '../hybrid-attendance.css';

type EvidenceRecord = {
  id: string;
  email: string;
  studentId: string;
  fullName: string;
  status: string;
  reviewStatus: string;
  verificationMode: string;
  checkedInAt: Timestamp | null;
  qrPhotoDownloadUrl: string;
  photoDownloadUrl: string;
  noCameraReason: string;
};

export function HybridEvidenceReviewPanel() {
  const [sessions, setSessions] = useState<AttendanceSession[]>([]);
  const [sessionId, setSessionId] = useState('');
  const [records, setRecords] = useState<EvidenceRecord[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [busyId, setBusyId] = useState('');

  useEffect(() => {
    if (!db) return undefined;
    return onSnapshot(collection(db, 'courses', ACTIVE_COURSE_ID, 'attendanceSessions'), (snapshot) => {
      const next = snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as AttendanceSession))
        .sort((a, b) => (b.openedAt?.toMillis?.() || 0) - (a.openedAt?.toMillis?.() || 0));
      setSessions(next);
      setSessionId((current) => current || next[0]?.id || '');
    });
  }, []);

  useEffect(() => {
    if (!db || !sessionId) { setRecords([]); return undefined; }
    return onSnapshot(collection(db, 'courses', ACTIVE_COURSE_ID, 'attendanceSessions', sessionId, 'records'), (snapshot) => {
      setRecords(snapshot.docs.map((item) => {
        const data = item.data();
        return {
          id: item.id,
          email: String(data.email || item.id),
          studentId: String(data.studentId || '—'),
          fullName: String(data.fullName || 'Chưa có họ tên'),
          status: String(data.status || 'recorded'),
          reviewStatus: String(data.reviewStatus || 'not_required'),
          verificationMode: String(data.verificationMode || 'unknown'),
          checkedInAt: data.checkedInAt instanceof Timestamp ? data.checkedInAt : null,
          qrPhotoDownloadUrl: String(data.qrPhotoDownloadUrl || ''),
          photoDownloadUrl: String(data.photoDownloadUrl || ''),
          noCameraReason: String(data.noCameraReason || ''),
        };
      }));
    });
  }, [sessionId]);

  const pending = useMemo(() => records.filter((item) => item.reviewStatus === 'needs_review'), [records]);

  async function review(record: EvidenceRecord, decision: 'approved' | 'rejected') {
    if (!db || !auth?.currentUser) return;
    setBusyId(record.id);
    setMessage('');
    try {
      const note = (notes[record.id] || '').trim();
      if (record.noCameraReason && !note) throw new Error('Bản ghi không camera cần ghi chú trước khi duyệt.');
      await updateDoc(doc(db, 'courses', ACTIVE_COURSE_ID, 'attendanceSessions', sessionId, 'records', record.id), {
        status: decision === 'approved' ? 'present' : 'rejected',
        statusLabel: decision === 'approved' ? 'Có mặt' : 'Từ chối',
        reviewStatus: decision,
        reviewDecision: decision,
        reviewNote: note,
        reviewedAt: serverTimestamp(),
        reviewedBy: auth.currentUser.email || auth.currentUser.uid,
        updatedAt: serverTimestamp(),
      });
      setMessage(decision === 'approved' ? 'Đã duyệt có mặt.' : 'Đã từ chối bản ghi.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể lưu hậu kiểm.');
    } finally {
      setBusyId('');
    }
  }

  return <section className="workflow dashboard-panel hybrid-evidence-admin">
    <span className="panel-label">TEACHER REVIEW · HYBRID EVIDENCE</span>
    <h2>Hậu kiểm QR/FACE và fallback không camera</h2>
    <label>Phiên điểm danh
      <select value={sessionId} onChange={(event) => setSessionId(event.target.value)}>
        {sessions.map((session) => <option key={session.id} value={session.id}>{session.title}</option>)}
      </select>
    </label>
    {!pending.length && <p>Không có bản ghi hybrid đang chờ hậu kiểm.</p>}
    <div className="hybrid-evidence-grid">{pending.map((record) => <article className="hybrid-evidence-card" key={record.id}>
      <h3>{record.studentId} · {record.fullName}</h3>
      <small>{record.email}</small>
      <small>{record.verificationMode} · {record.checkedInAt?.toDate().toLocaleString('vi-VN') || 'Đang đồng bộ'}</small>
      {record.noCameraReason && <p><b>Không camera:</b> {record.noCameraReason}</p>}
      <div className="hybrid-evidence-images">
        {record.qrPhotoDownloadUrl && <a href={record.qrPhotoDownloadUrl} target="_blank" rel="noreferrer"><img src={record.qrPhotoDownloadUrl} alt="QR evidence" /></a>}
        {record.photoDownloadUrl && <a href={record.photoDownloadUrl} target="_blank" rel="noreferrer"><img src={record.photoDownloadUrl} alt="FACE evidence" /></a>}
      </div>
      {!record.qrPhotoDownloadUrl && !record.photoDownloadUrl && <p>Không có ảnh evidence; cần xác nhận trực tiếp.</p>}
      <textarea placeholder="Ghi chú hậu kiểm" value={notes[record.id] || ''}
        onChange={(event) => setNotes((current) => ({ ...current, [record.id]: event.target.value }))} />
      <div className="attendance-controls">
        <button disabled={busyId === record.id} onClick={() => void review(record, 'approved')}>Duyệt có mặt</button>
        <button disabled={busyId === record.id} onClick={() => void review(record, 'rejected')}>Từ chối</button>
      </div>
    </article>)}</div>
    {message && <p className="notice">{message}</p>}
  </section>;
}
