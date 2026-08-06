import { useEffect, useMemo, useState } from 'react';
import { Timestamp, collection, doc, onSnapshot } from 'firebase/firestore';
import { db } from '../services/firebase';
import { ACTIVE_COURSE_ID } from '../services/roster';

interface SessionSummary {
  id: string;
  title: string;
  openedAt: Timestamp | null;
  scheduledEndsAt: Timestamp | null;
  policyPreset: string;
}

interface HistoryRecord {
  sessionId: string;
  sessionTitle: string;
  sessionOpenedAt: Timestamp | null;
  checkedInAt: Timestamp | null;
  status: string;
  statusLabel: string;
  verificationMode: string;
  reviewStatus: string;
  reviewNote: string;
  reviewedAt: Timestamp | null;
}

function normalizedSession(id: string, data: Record<string, unknown>): SessionSummary {
  return {
    id,
    title: typeof data.title === 'string' && data.title.trim() ? data.title : 'Phiên điểm danh',
    openedAt: data.openedAt instanceof Timestamp ? data.openedAt : null,
    scheduledEndsAt: data.scheduledEndsAt instanceof Timestamp ? data.scheduledEndsAt : null,
    policyPreset: typeof data.policyPreset === 'string' ? data.policyPreset : 'legacy',
  };
}

function verificationLabel(mode: string): string {
  if (mode === 'pin_only') return 'PIN-only';
  if (mode === 'qr_pin_photo') return 'QR + PIN + ảnh';
  if (mode === 'qr_pin_no_photo') return 'QR + PIN';
  if (mode === 'manual_teacher') return 'Giảng viên ghi nhận';
  return mode || 'Chưa xác định';
}

function reviewLabel(status: string): string {
  if (status === 'needs_review') return 'Chờ hậu kiểm';
  if (status === 'approved') return 'Đã duyệt';
  if (status === 'rejected') return 'Bị từ chối';
  if (status === 'not_reviewed') return 'Chưa hậu kiểm';
  return 'Không yêu cầu';
}

export function StudentAttendanceHistory({ email }: { email: string }) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [records, setRecords] = useState<Map<string, HistoryRecord>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!db || !email) {
      setLoading(false);
      return undefined;
    }

    setError('');
    return onSnapshot(
      collection(db, 'courses', ACTIVE_COURSE_ID, 'attendanceSessions'),
      (snapshot) => {
        const latest = snapshot.docs
          .map((item) => normalizedSession(item.id, item.data()))
          .sort((a, b) => (b.openedAt?.toMillis() ?? 0) - (a.openedAt?.toMillis() ?? 0))
          .slice(0, 30);
        setSessions(latest);
      },
      () => {
        setError('Không thể tải danh sách phiên điểm danh.');
        setLoading(false);
      },
    );
  }, [email]);

  useEffect(() => {
    if (!db || !email || sessions.length === 0) {
      setRecords(new Map());
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    const next = new Map<string, HistoryRecord>();
    let resolved = 0;
    const stops = sessions.map((session) => onSnapshot(
      doc(db, 'courses', ACTIVE_COURSE_ID, 'attendanceSessions', session.id, 'records', email),
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          next.set(session.id, {
            sessionId: session.id,
            sessionTitle: session.title,
            sessionOpenedAt: session.openedAt,
            checkedInAt: data.checkedInAt instanceof Timestamp ? data.checkedInAt : null,
            status: typeof data.status === 'string' ? data.status : 'recorded',
            statusLabel: typeof data.statusLabel === 'string' ? data.statusLabel : (typeof data.status === 'string' ? data.status : 'Đã ghi nhận'),
            verificationMode: typeof data.verificationMode === 'string' ? data.verificationMode : '',
            reviewStatus: typeof data.reviewStatus === 'string' ? data.reviewStatus : 'not_required',
            reviewNote: typeof data.reviewNote === 'string' ? data.reviewNote : '',
            reviewedAt: data.reviewedAt instanceof Timestamp ? data.reviewedAt : null,
          });
        } else {
          next.delete(session.id);
        }
        resolved += 1;
        setRecords(new Map(next));
        if (resolved >= sessions.length) setLoading(false);
      },
      () => {
        resolved += 1;
        if (resolved >= sessions.length) setLoading(false);
      },
    ));

    return () => stops.forEach((stop) => stop());
  }, [email, sessions]);

  const rows = useMemo(() => Array.from(records.values()).sort((a, b) => {
    const aTime = a.checkedInAt?.toMillis() ?? a.sessionOpenedAt?.toMillis() ?? 0;
    const bTime = b.checkedInAt?.toMillis() ?? b.sessionOpenedAt?.toMillis() ?? 0;
    return bTime - aTime;
  }), [records]);

  const summary = useMemo(() => ({
    total: rows.length,
    present: rows.filter((row) => row.status === 'present').length,
    pending: rows.filter((row) => row.status === 'recorded' || row.reviewStatus === 'needs_review').length,
    rejected: rows.filter((row) => row.status === 'rejected' || row.reviewStatus === 'rejected').length,
    excused: rows.filter((row) => row.status === 'excused').length,
  }), [rows]);

  return <section className="workflow dashboard-panel student-history-panel">
    <div className="history-heading">
      <div><span className="panel-label">ATTENDANCE HISTORY</span><h2>Lịch sử điểm danh của tôi</h2><p>Hiển thị tối đa 30 phiên gần nhất và cập nhật realtime sau khi giảng viên hậu kiểm.</p></div>
      <div className="history-summary">
        <span>Tổng <b>{summary.total}</b></span>
        <span>Có mặt <b>{summary.present}</b></span>
        <span>Chờ duyệt <b>{summary.pending}</b></span>
        <span>Có phép <b>{summary.excused}</b></span>
        <span>Từ chối <b>{summary.rejected}</b></span>
      </div>
    </div>

    {loading && <p>Đang tải lịch sử điểm danh…</p>}
    {error && <p className="notice">{error}</p>}
    {!loading && !error && rows.length === 0 && <p>Chưa có bản ghi điểm danh nào.</p>}
    {rows.length > 0 && <div className="history-list">{rows.map((row) => <article key={row.sessionId} className="history-item">
      <div className="history-main"><strong>{row.sessionTitle}</strong><span>{row.checkedInAt ? row.checkedInAt.toDate().toLocaleString('vi-VN') : 'Đang đồng bộ thời gian'}</span></div>
      <div className="history-meta"><span className={`record-badge status-${row.status}`}>{row.statusLabel}</span><span>{verificationLabel(row.verificationMode)}</span><span>{reviewLabel(row.reviewStatus)}</span></div>
      {row.reviewNote && <p className="history-note">Ghi chú: {row.reviewNote}</p>}
      {row.reviewedAt && <small>Hậu kiểm lúc {row.reviewedAt.toDate().toLocaleString('vi-VN')}</small>}
    </article>)}</div>}
  </section>;
}
