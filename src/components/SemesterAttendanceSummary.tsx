import { useEffect, useMemo, useState } from 'react';
import { Timestamp, collection, onSnapshot, type Firestore, type Unsubscribe } from 'firebase/firestore';
import { db } from '../services/firebase';
import { ACTIVE_COURSE_ID } from '../services/roster';

interface StudentRow {
  email: string;
  studentId: string;
  fullName: string;
  present: number;
  recorded: number;
  absent: number;
  excused: number;
  rejected: number;
  total: number;
  rate: number;
}

interface SessionRow {
  id: string;
  title: string;
  openedAt: Timestamp | null;
  present: number;
  recorded: number;
  absent: number;
  excused: number;
  rejected: number;
  totalStudents: number;
  rate: number;
}

interface RosterStudent {
  email: string;
  studentId: string;
  fullName: string;
}

interface SessionState {
  id: string;
  title: string;
  openedAt: Timestamp | null;
  records: Map<string, string>;
}

function requireDb(): Firestore {
  if (!db) throw new Error('Firestore chưa được cấu hình.');
  return db;
}

function csvCell(value: unknown): string {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function downloadCsv(fileName: string, headers: string[], rows: unknown[][]): void {
  const content = '\uFEFF' + [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function SemesterAttendanceSummary() {
  const [roster, setRoster] = useState<RosterStudent[]>([]);
  const [sessions, setSessions] = useState<SessionState[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!db) {
      setLoading(false);
      setError('Firestore chưa được cấu hình.');
      return undefined;
    }
    const firestore = requireDb();
    const recordStops = new Map<string, Unsubscribe>();

    const stopRoster = onSnapshot(collection(firestore, 'courses', ACTIVE_COURSE_ID, 'roster'), (snapshot) => {
      setRoster(snapshot.docs.flatMap((item) => {
        const data = item.data();
        if (data.active !== true || data.role !== 'student') return [];
        return [{
          email: item.id.toLowerCase(),
          studentId: String(data.studentId || '—'),
          fullName: String(data.fullName || ''),
        }];
      }).sort((a, b) => a.studentId.localeCompare(b.studentId, 'vi')));
      setLoading(false);
    }, () => {
      setError('Không thể tải roster học kỳ.');
      setLoading(false);
    });

    const stopSessions = onSnapshot(collection(firestore, 'courses', ACTIVE_COURSE_ID, 'attendanceSessions'), (snapshot) => {
      const sessionMeta = snapshot.docs.map((item) => {
        const data = item.data();
        return {
          id: item.id,
          title: String(data.title || 'Phiên điểm danh'),
          openedAt: data.openedAt instanceof Timestamp ? data.openedAt : null,
        };
      }).sort((a, b) => (a.openedAt?.toMillis() ?? 0) - (b.openedAt?.toMillis() ?? 0));

      const activeIds = new Set(sessionMeta.map((item) => item.id));
      recordStops.forEach((stop, id) => {
        if (!activeIds.has(id)) {
          stop();
          recordStops.delete(id);
        }
      });

      setSessions((current) => sessionMeta.map((meta) => ({
        ...meta,
        records: current.find((item) => item.id === meta.id)?.records ?? new Map(),
      })));

      sessionMeta.forEach((meta) => {
        if (recordStops.has(meta.id)) return;
        const stop = onSnapshot(collection(firestore, 'courses', ACTIVE_COURSE_ID, 'attendanceSessions', meta.id, 'records'), (recordsSnapshot) => {
          const records = new Map<string, string>();
          recordsSnapshot.docs.forEach((recordDoc) => {
            const data = recordDoc.data();
            records.set(recordDoc.id.toLowerCase(), String(data.status || 'recorded'));
          });
          setSessions((current) => current.map((item) => item.id === meta.id ? { ...item, records } : item));
        });
        recordStops.set(meta.id, stop);
      });
    }, () => setError('Không thể tải các phiên điểm danh trong học kỳ.'));

    return () => {
      stopRoster();
      stopSessions();
      recordStops.forEach((stop) => stop());
    };
  }, []);

  const studentRows = useMemo<StudentRow[]>(() => roster.map((student) => {
    let present = 0;
    let recorded = 0;
    let excused = 0;
    let rejected = 0;
    sessions.forEach((session) => {
      const status = session.records.get(student.email);
      if (status === 'present') present += 1;
      else if (status === 'recorded') recorded += 1;
      else if (status === 'excused') excused += 1;
      else if (status === 'rejected') rejected += 1;
    });
    const total = sessions.length;
    const absent = Math.max(0, total - present - recorded - excused - rejected);
    const rate = total ? ((present + excused) / total) * 100 : 0;
    return { ...student, present, recorded, absent, excused, rejected, total, rate };
  }), [roster, sessions]);

  const sessionRows = useMemo<SessionRow[]>(() => sessions.map((session) => {
    let present = 0;
    let recorded = 0;
    let excused = 0;
    let rejected = 0;
    roster.forEach((student) => {
      const status = session.records.get(student.email);
      if (status === 'present') present += 1;
      else if (status === 'recorded') recorded += 1;
      else if (status === 'excused') excused += 1;
      else if (status === 'rejected') rejected += 1;
    });
    const totalStudents = roster.length;
    const absent = Math.max(0, totalStudents - present - recorded - excused - rejected);
    const rate = totalStudents ? ((present + excused) / totalStudents) * 100 : 0;
    return { ...session, present, recorded, absent, excused, rejected, totalStudents, rate };
  }), [roster, sessions]);

  const overall = useMemo(() => {
    const opportunities = roster.length * sessions.length;
    const present = studentRows.reduce((sum, row) => sum + row.present, 0);
    const excused = studentRows.reduce((sum, row) => sum + row.excused, 0);
    return { opportunities, rate: opportunities ? ((present + excused) / opportunities) * 100 : 0 };
  }, [roster.length, sessions.length, studentRows]);

  function exportStudents(): void {
    downloadCsv(`${ACTIVE_COURSE_ID}-semester-by-student.csv`,
      ['MSSV', 'Họ tên', 'Email', 'Tổng phiên', 'Có mặt', 'Đã ghi nhận', 'Vắng', 'Có phép', 'Từ chối', 'Tỷ lệ (%)'],
      studentRows.map((row) => [row.studentId, row.fullName, row.email, row.total, row.present, row.recorded, row.absent, row.excused, row.rejected, row.rate.toFixed(2)]));
  }

  function exportSessions(): void {
    downloadCsv(`${ACTIVE_COURSE_ID}-semester-by-session.csv`,
      ['Phiên', 'Thời gian mở', 'Sĩ số', 'Có mặt', 'Đã ghi nhận', 'Vắng', 'Có phép', 'Từ chối', 'Tỷ lệ (%)'],
      sessionRows.map((row) => [row.title, row.openedAt?.toDate().toLocaleString('vi-VN') || '', row.totalStudents, row.present, row.recorded, row.absent, row.excused, row.rejected, row.rate.toFixed(2)]));
  }

  return <section className="workflow dashboard-panel semester-summary-panel">
    <div className="semester-summary-heading">
      <div><span className="panel-label">SEMESTER SUMMARY</span><h2>Tổng hợp điểm danh học kỳ</h2><p>Thống kê realtime theo sinh viên và theo từng phiên điểm danh.</p></div>
      <div className="semester-actions"><button onClick={exportStudents}>CSV theo sinh viên</button><button className="secondary-button" onClick={exportSessions}>CSV theo phiên</button></div>
    </div>

    <div className="semester-kpis"><span>Sinh viên <b>{roster.length}</b></span><span>Số phiên <b>{sessions.length}</b></span><span>Lượt điểm danh <b>{overall.opportunities}</b></span><span>Tỷ lệ chung <b>{overall.rate.toFixed(1)}%</b></span></div>
    {loading && <p>Đang tổng hợp dữ liệu học kỳ…</p>}
    {error && <p className="notice">{error}</p>}

    {!loading && <>
      <h3>Theo sinh viên</h3>
      <div className="semester-table-wrap"><table className="semester-table"><thead><tr><th>MSSV</th><th>Họ tên</th><th>Tổng</th><th>Có mặt</th><th>Ghi nhận</th><th>Vắng</th><th>Có phép</th><th>Từ chối</th><th>Tỷ lệ</th></tr></thead><tbody>
        {studentRows.map((row) => <tr key={row.email}><td><strong>{row.studentId}</strong><small>{row.email}</small></td><td>{row.fullName}</td><td>{row.total}</td><td>{row.present}</td><td>{row.recorded}</td><td>{row.absent}</td><td>{row.excused}</td><td>{row.rejected}</td><td><b>{row.rate.toFixed(1)}%</b></td></tr>)}
      </tbody></table></div>

      <h3>Theo phiên</h3>
      <div className="semester-table-wrap"><table className="semester-table"><thead><tr><th>Phiên</th><th>Sĩ số</th><th>Có mặt</th><th>Ghi nhận</th><th>Vắng</th><th>Có phép</th><th>Từ chối</th><th>Tỷ lệ</th></tr></thead><tbody>
        {sessionRows.map((row) => <tr key={row.id}><td><strong>{row.title}</strong><small>{row.openedAt?.toDate().toLocaleString('vi-VN') || '—'}</small></td><td>{row.totalStudents}</td><td>{row.present}</td><td>{row.recorded}</td><td>{row.absent}</td><td>{row.excused}</td><td>{row.rejected}</td><td><b>{row.rate.toFixed(1)}%</b></td></tr>)}
      </tbody></table></div>
    </>}
  </section>;
}
