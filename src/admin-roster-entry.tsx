import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { Timestamp, collection, onSnapshot } from 'firebase/firestore';
import './teacher-review.css';
import { observeAuth } from './services/auth';
import { db } from './services/firebase';
import { ACTIVE_COURSE_ID, loadAccessProfile } from './services/roster';
import { AdminAttendanceRoster } from './components/AdminAttendanceRoster';
import { AttendanceCsvExport } from './components/AttendanceCsvExport';

interface AttendanceSessionSummary {
  id: string;
  status: string;
  expiresAt: Timestamp | null;
  title: string;
}

function normalizeSession(id: string, data: Record<string, unknown>): AttendanceSessionSummary {
  return {
    id,
    status: typeof data.status === 'string' ? data.status : '',
    expiresAt: data.expiresAt instanceof Timestamp ? data.expiresAt : null,
    title: typeof data.title === 'string' && data.title.trim() ? data.title : 'Phiên điểm danh',
  };
}

function AdminRosterMount() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [sessionId, setSessionId] = useState('');
  const [sessionTitle, setSessionTitle] = useState('Phiên điểm danh');

  useEffect(() => observeAuth((user) => {
    void (async () => {
      if (!user) { setIsAdmin(false); return; }
      const profile = await loadAccessProfile(user.email);
      setIsAdmin(profile?.role === 'admin');
    })();
  }), []);

  useEffect(() => {
    if (!isAdmin || !db) {
      setSessionId('');
      setSessionTitle('Phiên điểm danh');
      return undefined;
    }

    return onSnapshot(collection(db, 'courses', ACTIVE_COURSE_ID, 'attendanceSessions'), (snapshot) => {
      const now = Date.now();
      const active = snapshot.docs
        .map((item) => normalizeSession(item.id, item.data()))
        .filter((item) => item.status === 'open' && item.expiresAt !== null && item.expiresAt.toMillis() > now)
        .sort((a, b) => (b.expiresAt?.toMillis() ?? 0) - (a.expiresAt?.toMillis() ?? 0))[0];

      setSessionId(active?.id ?? '');
      setSessionTitle(active?.title ?? 'Phiên điểm danh');
    });
  }, [isAdmin]);

  if (!isAdmin || !sessionId) return null;
  return <main className="admin-roster-main"><section className="workflow dashboard-panel roster-dashboard-panel">
    <div className="attendance-controls"><span className="panel-label">REALTIME ATTENDANCE</span><AttendanceCsvExport sessionId={sessionId} sessionTitle={sessionTitle} /></div>
    <AdminAttendanceRoster sessionId={sessionId} />
  </section></main>;
}

const mount = document.createElement('div');
mount.id = 'admin-attendance-roster-root';
document.body.appendChild(mount);
ReactDOM.createRoot(mount).render(<React.StrictMode><AdminRosterMount /></React.StrictMode>);
