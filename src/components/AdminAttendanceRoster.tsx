import { useEffect, useMemo, useState } from 'react';
import { Timestamp, collection, onSnapshot } from 'firebase/firestore';
import { db } from '../services/firebase';
import { ACTIVE_COURSE_ID } from '../services/roster';

type AttendanceFilter = 'all' | 'present' | 'recorded' | 'missing' | 'needs_review';

interface RosterStudent {
  email: string;
  studentId: string;
  fullName: string;
}

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
  missing: boolean;
}

const filterLabels: Record<AttendanceFilter, string> = {
  all: 'Toàn bộ lớp',
  present: 'Có mặt đầy đủ',
  recorded: 'PIN-only',
  missing: 'Chưa điểm danh',
  needs_review: 'Cần hậu kiểm',
};

function normalizeEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function normalizeAttendance(id: string, data: Record<string, unknown>): AttendanceRecord {
  return {
    id,
    email: normalizeEmail(data.email) || normalizeEmail(id),
    studentId: typeof data.studentId === 'string' ? data.studentId : '—',
    fullName: typeof data.fullName === 'string' && data.fullName.trim() ? data.fullName : 'Chưa có họ tên',
    checkedInAt: data.checkedInAt instanceof Timestamp ? data.checkedInAt : null,
    status: typeof data.status === 'string' ? data.status : 'recorded',
    statusLabel: typeof data.statusLabel === 'string' ? data.statusLabel : 'Đã ghi nhận',
    verificationMode: typeof data.verificationMode === 'string' ? data.verificationMode : 'unknown',
    reviewStatus: typeof data.reviewStatus === 'string' ? data.reviewStatus : 'not_required',
    missing: false,
  };
}

function normalizeRoster(id: string, data: Record<string, unknown>): RosterStudent | null {
  if (data.active !== true || data.role !== 'student') return null;
  const email = normalizeEmail(data.email) || normalizeEmail(id);
  if (!email) return null;
  return {
    email,
    studentId: typeof data.studentId === 'string' && data.studentId.trim() ? data.studentId : '—',
    fullName: typeof data.fullName === 'string' && data.fullName.trim() ? data.fullName : 'Chưa có họ tên',
  };
}

function missingRecord(student: RosterStudent): AttendanceRecord {
  return {
    id: `missing:${student.email}`,
    email: student.email,
    studentId: student.studentId,
    fullName: student.fullName,
    checkedInAt: null,
    status: 'missing',
    statusLabel: 'Chưa điểm danh',
    verificationMode: 'none',
    reviewStatus: 'not_required',
    missing: true,
  };
}

function verificationLabel(mode: string): string {
  if (mode === 'pin_only') return 'PIN-only';
  if (mode === 'qr_pin_photo') return 'QR + PIN + ảnh';
  if (mode === 'qr_pin_no_photo') return 'QR + PIN';
  if (mode === 'manual_teacher') return 'Giảng viên';
  if (mode === 'none') return 'Chưa xác minh';
  return mode || 'Chưa xác định';
}

function reviewLabel(status: string): string {
  if (status === 'needs_review') return 'Cần hậu kiểm';
  if (status === 'approved') return 'Đã duyệt';
  if (status === 'rejected') return 'Từ chối';
  return 'Không yêu cầu';
}

export function AdminAttendanceRoster({ sessionId }: { sessionId: string }) {
  const [roster, setRoster] = useState<RosterStudent[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [filter, setFilter] = useState<AttendanceFilter>('all');
  const [rosterLoading, setRosterLoading] = useState(true);
  const [attendanceLoading, setAttendanceLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!db) {
      setRosterLoading(false);
      setAttendanceLoading(false);
      setError('Firestore chưa được cấu hình.');
      return undefined;
    }

    setError('');
    const stopRoster = onSnapshot(
      collection(db, 'courses', ACTIVE_COURSE_ID, 'roster'),
      (snapshot) => {
        const students = snapshot.docs
          .map((item) => normalizeRoster(item.id, item.data()))
          .filter((item): item is RosterStudent => item !== null)
          .sort((a, b) => a.studentId.localeCompare(b.studentId, 'vi'));
        setRoster(students);
        setRosterLoading(false);
      },
      () => {
        setError('Không thể tải roster của lớp.');
        setRosterLoading(false);
      },
    );

    const stopAttendance = onSnapshot(
      collection(db, 'courses', ACTIVE_COURSE_ID, 'attendanceSessions', sessionId, 'records'),
      (snapshot) => {
        setAttendance(snapshot.docs.map((item) => normalizeAttendance(item.id, item.data())));
        setAttendanceLoading(false);
      },
      () => {
        setError('Không thể tải danh sách điểm danh realtime.');
        setAttendanceLoading(false);
      },
    );

    return () => {
      stopRoster();
      stopAttendance();
    };
  }, [sessionId]);

  const rows = useMemo(() => {
    const byEmail = new Map(attendance.map((record) => [record.email, record]));
    const joined = roster.map((student) => {
      const record = byEmail.get(student.email);
      if (!record) return missingRecord(student);
      byEmail.delete(student.email);
      return {
        ...record,
        studentId: student.studentId || record.studentId,
        fullName: student.fullName || record.fullName,
      };
    });

    const unmatched = Array.from(byEmail.values());
    return [...joined, ...unmatched].sort((a, b) => {
      if (a.missing !== b.missing) return a.missing ? 1 : -1;
      if (!a.missing && !b.missing) {
        const timeDifference = (b.checkedInAt?.toMillis() ?? 0) - (a.checkedInAt?.toMillis() ?? 0);
        if (timeDifference !== 0) return timeDifference;
      }
      return a.studentId.localeCompare(b.studentId, 'vi');
    });
  }, [attendance, roster]);

  const summary = useMemo(() => ({
    all: roster.length,
    checkedIn: rows.filter((record) => !record.missing).length,
    present: rows.filter((record) => record.status === 'present').length,
    recorded: rows.filter((record) => record.status === 'recorded' || record.verificationMode === 'pin_only').length,
    missing: rows.filter((record) => record.missing).length,
    needs_review: rows.filter((record) => record.reviewStatus === 'needs_review').length,
  }), [roster.length, rows]);

  const filterCounts: Record<AttendanceFilter, number> = {
    all: summary.all,
    present: summary.present,
    recorded: summary.recorded,
    missing: summary.missing,
    needs_review: summary.needs_review,
  };

  const filtered = useMemo(() => rows.filter((record) => {
    if (filter === 'present') return record.status === 'present';
    if (filter === 'recorded') return record.status === 'recorded' || record.verificationMode === 'pin_only';
    if (filter === 'missing') return record.missing;
    if (filter === 'needs_review') return record.reviewStatus === 'needs_review';
    return true;
  }), [filter, rows]);

  const loading = rosterLoading || attendanceLoading;

  return <div className="attendance-roster">
    <div className="roster-heading">
      <div><h3>Danh sách lớp và điểm danh realtime</h3><p>Roster được ghép trực tiếp với kết quả của phiên đang mở.</p></div>
      <div className="roster-summary roster-summary-five">
        <span>Sĩ số <b>{summary.all}</b></span>
        <span>Đã ghi nhận <b>{summary.checkedIn}</b></span>
        <span>Đầy đủ <b>{summary.present}</b></span>
        <span>PIN-only <b>{summary.recorded}</b></span>
        <span>Chưa điểm danh <b>{summary.missing}</b></span>
      </div>
    </div>

    <div className="roster-filters" role="group" aria-label="Lọc danh sách điểm danh">
      {(Object.keys(filterLabels) as AttendanceFilter[]).map((item) => <button
        key={item}
        type="button"
        className={filter === item ? 'filter-button active' : 'filter-button'}
        onClick={() => setFilter(item)}
      >{filterLabels[item]} ({filterCounts[item]})</button>)}
    </div>

    {loading && <p>Đang tải roster và danh sách điểm danh…</p>}
    {error && <p className="notice">{error}</p>}
    {!loading && !error && !filtered.length && <p>Không có sinh viên phù hợp với bộ lọc này.</p>}
    {!!filtered.length && <div className="roster-table-wrap"><table className="roster-table">
      <thead><tr><th>MSSV</th><th>Họ tên</th><th>Thời gian</th><th>Trạng thái</th><th>Xác minh</th><th>Hậu kiểm</th></tr></thead>
      <tbody>{filtered.map((record) => <tr key={record.id} className={record.missing ? 'missing-row' : undefined}>
        <td><strong>{record.studentId}</strong><small>{record.email}</small></td>
        <td>{record.fullName}</td>
        <td>{record.checkedInAt ? record.checkedInAt.toDate().toLocaleTimeString('vi-VN') : '—'}</td>
        <td><span className={`record-badge status-${record.status}`}>{record.statusLabel}</span></td>
        <td>{verificationLabel(record.verificationMode)}</td>
        <td><span className={`record-badge review-${record.reviewStatus}`}>{reviewLabel(record.reviewStatus)}</span></td>
      </tr>)}</tbody>
    </table></div>}
  </div>;
}
