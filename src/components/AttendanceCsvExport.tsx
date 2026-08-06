import { useEffect, useState } from 'react';
import { Timestamp, collection, onSnapshot } from 'firebase/firestore';
import { db } from '../services/firebase';
import { ACTIVE_COURSE_ID } from '../services/roster';

interface CsvRow {
  email: string;
  studentId: string;
  fullName: string;
  checkedInAt: Timestamp | null;
  statusLabel: string;
  verificationMode: string;
  reviewStatus: string;
  reviewNote: string;
  reviewedBy: string;
  reviewedAt: Timestamp | null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function safeName(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'attendance';
}

export function AttendanceCsvExport({ sessionId, sessionTitle }: { sessionId: string; sessionTitle: string }) {
  const [rows, setRows] = useState<CsvRow[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!db) return undefined;
    let roster: CsvRow[] = [];
    let records = new Map<string, CsvRow>();
    const refresh = () => {
      const joined = roster.map((student) => records.get(student.email) || student);
      const rosterEmails = new Set(roster.map((student) => student.email));
      records.forEach((record, email) => { if (!rosterEmails.has(email)) joined.push(record); });
      setRows(joined.sort((a, b) => a.studentId.localeCompare(b.studentId, 'vi')));
      setReady(true);
    };
    const stopRoster = onSnapshot(collection(db, 'courses', ACTIVE_COURSE_ID, 'roster'), (snapshot) => {
      roster = snapshot.docs.filter((item) => item.data().active === true && item.data().role === 'student').map((item) => {
        const data = item.data();
        return {
          email: text(data.email).trim().toLowerCase() || item.id.toLowerCase(),
          studentId: text(data.studentId), fullName: text(data.fullName), checkedInAt: null,
          statusLabel: 'Chưa điểm danh', verificationMode: 'none', reviewStatus: 'not_required',
          reviewNote: '', reviewedBy: '', reviewedAt: null,
        };
      });
      refresh();
    });
    const stopRecords = onSnapshot(collection(db, 'courses', ACTIVE_COURSE_ID, 'attendanceSessions', sessionId, 'records'), (snapshot) => {
      records = new Map(snapshot.docs.map((item) => {
        const data = item.data();
        const email = text(data.email).trim().toLowerCase() || item.id.toLowerCase();
        return [email, {
          email, studentId: text(data.studentId), fullName: text(data.fullName),
          checkedInAt: data.checkedInAt instanceof Timestamp ? data.checkedInAt : null,
          statusLabel: text(data.statusLabel) || text(data.status), verificationMode: text(data.verificationMode),
          reviewStatus: text(data.reviewStatus), reviewNote: text(data.reviewNote), reviewedBy: text(data.reviewedBy),
          reviewedAt: data.reviewedAt instanceof Timestamp ? data.reviewedAt : null,
        }];
      }));
      refresh();
    });
    return () => { stopRoster(); stopRecords(); };
  }, [sessionId]);

  function exportCsv() {
    const header = ['MSSV', 'Họ tên', 'Email', 'Thời gian điểm danh', 'Trạng thái', 'Cơ chế xác minh', 'Hậu kiểm', 'Ghi chú giảng viên', 'Người duyệt', 'Thời gian duyệt'];
    const lines = rows.map((row) => [
      row.studentId, row.fullName, row.email,
      row.checkedInAt ? row.checkedInAt.toDate().toLocaleString('vi-VN') : '',
      row.statusLabel, row.verificationMode, row.reviewStatus, row.reviewNote, row.reviewedBy,
      row.reviewedAt ? row.reviewedAt.toDate().toLocaleString('vi-VN') : '',
    ].map(csvCell).join(','));
    const csv = `\uFEFF${header.map(csvCell).join(',')}\r\n${lines.join('\r\n')}`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    link.href = url;
    link.download = `${ACTIVE_COURSE_ID}-${safeName(sessionTitle)}-${timestamp}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return <button className="secondary-button" type="button" disabled={!ready || !rows.length} onClick={exportCsv}>
    Xuất CSV ({rows.length} sinh viên)
  </button>;
}
