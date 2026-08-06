import { useEffect, useMemo, useState } from 'react';
import { Timestamp, collection, onSnapshot, type Unsubscribe } from 'firebase/firestore';
import { db } from '../services/firebase';
import { ACTIVE_COURSE_ID } from '../services/roster';

type AttendanceFilter = 'all' | 'present' | 'recorded' | 'needs_review';

interface AttendanceRecord {
  id: string;
  email: string;
  studentId: string;
  fullName: string;
  checkedInAt: Timestamp | null;
  status: string;
  statusLabel: string;
  verificationMode: string;
  reviewStatus: string;
}

const filterLabels: Record<AttendanceFilter, string> = {
  all: 'Tất cả',
  present: 'Có mặt đầy đủ',
  recorded: 'PIN-only',
  needs_review: 'Cần hậu kiểm',
};

function normalizeRecord(id: string, data: Record<string, unknown>): AttendanceRecord {
  return {
    id,
    email: typeof data.email === 'string' ? data.email : id,
    studentId: typeof data.studentId === 'string' ? data.studentId : '—',
    fullName: typeof data.fullName === 'string' && data.fullName.trim() ? data.fullName : 'Chưa có họ tên',
    checkedInAt: data.checkedInAt instanceof Timestamp ? data.checkedInAt : null,
    status: typeof data.status === 'string' ? data.status : 'recorded',
    statusLabel: typeof data.statusLabel === 'string' ? data.statusLabel : 'Đã ghi nhận',
    verificationMode: typeof data.verificationMode === 'string' ? data.verificationMode : 'unknown',
    reviewStatus: typeof data.reviewStatus === 'string' ? data.reviewStatus : 'not_required',
  };
}

function verificationLabel(mode: string): string {
  if (mode === 'pin_only') return 'PIN-only';
  if (mode === 'qr_pin_photo') return 'QR + PIN + ảnh';
  if (mode === 'qr_pin_no_photo') return 'QR + PIN';
  if (mode === 'manual_teacher') return 'Giảng viên';
  return mode || 'Chưa xác định';
}

function reviewLabel(status: string): string {
  if (status === 'needs_review') return 'Cần hậu kiểm';
  if (status === 'approved') return 'Đã duyệt';
  if (status === 'rejected') return 'Từ chối';
  return 'Không yêu cầu';
}

export function AdminAttendanceRoster({ sessionId }: { sessionId: string }) {
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [filter, setFilter] = useState<AttendanceFilter>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!db) {
      setLoading(false);
      setError('Firestore chưa được cấu hình.');
      return undefined;
    }

    setLoading(true);
    setError('');
    const unsubscribe: Unsubscribe = onSnapshot(
      collection(db, 'courses', ACTIVE_COURSE_ID, 'attendanceSessions', sessionId, 'records'),
      (snapshot) => {
        const next = snapshot.docs
          .map((item) => normalizeRecord(item.id, item.data()))
          .sort((a, b) => {
            const aTime = a.checkedInAt?.toMillis() ?? 0;
            const bTime = b.checkedInAt?.toMillis() ?? 0;
            return bTime - aTime;
          });
        setRecords(next);
        setLoading(false);
      },
      () => {
        setError('Không thể tải danh sách điểm danh realtime.');
        setLoading(false);
      },
    );
    return unsubscribe;
  }, [sessionId]);

  const filtered = useMemo(() => records.filter((record) => {
    if (filter === 'present') return record.status === 'present';
    if (filter === 'recorded') return record.status === 'recorded' || record.verificationMode === 'pin_only';
    if (filter === 'needs_review') return record.reviewStatus === 'needs_review';
    return true;
  }), [filter, records]);

  const summary = useMemo(() => ({
    all: records.length,
    present: records.filter((record) => record.status === 'present').length,
    recorded: records.filter((record) => record.status === 'recorded' || record.verificationMode === 'pin_only').length,
    needs_review: records.filter((record) => record.reviewStatus === 'needs_review').length,
  }), [records]);

  return <div className="attendance-roster">
    <div className="roster-heading">
      <div><h3>Danh sách điểm danh realtime</h3><p>Cập nhật tự động khi sinh viên hoàn tất ghi nhận.</p></div>
      <div className="roster-summary">
        <span>Tổng <b>{summary.all}</b></span>
        <span>Đầy đủ <b>{summary.present}</b></span>
        <span>PIN-only <b>{summary.recorded}</b></span>
        <span>Hậu kiểm <b>{summary.needs_review}</b></span>
      </div>
    </div>

    <div className="roster-filters" role="group" aria-label="Lọc danh sách điểm danh">
      {(Object.keys(filterLabels) as AttendanceFilter[]).map((item) => <button
        key={item}
        type="button"
        className={filter === item ? 'filter-button active' : 'filter-button'}
        onClick={() => setFilter(item)}
      >{filterLabels[item]} ({summary[item]})</button>)}
    </div>

    {loading && <p>Đang tải danh sách…</p>}
    {error && <p className="notice">{error}</p>}
    {!loading && !error && !filtered.length && <p>Chưa có sinh viên phù hợp với bộ lọc này.</p>}
    {!!filtered.length && <div className="roster-table-wrap"><table className="roster-table">
      <thead><tr><th>MSSV</th><th>Họ tên</th><th>Thời gian</th><th>Trạng thái</th><th>Xác minh</th><th>Hậu kiểm</th></tr></thead>
      <tbody>{filtered.map((record) => <tr key={record.id}>
        <td><strong>{record.studentId}</strong><small>{record.email}</small></td>
        <td>{record.fullName}</td>
        <td>{record.checkedInAt ? record.checkedInAt.toDate().toLocaleTimeString('vi-VN') : 'Đang đồng bộ'}</td>
        <td><span className={`record-badge status-${record.status}`}>{record.statusLabel}</span></td>
        <td>{verificationLabel(record.verificationMode)}</td>
        <td><span className={`record-badge review-${record.reviewStatus}`}>{reviewLabel(record.reviewStatus)}</span></td>
      </tr>)}</tbody>
    </table></div>}
  </div>;
}
