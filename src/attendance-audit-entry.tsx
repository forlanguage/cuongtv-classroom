import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import './attendance-audit.css';
import { observeAuth } from './services/auth';
import { loadAccessProfile } from './services/roster';
import { AttendanceAuditPanel } from './components/AttendanceAuditPanel';

function AttendanceAuditMount() {
  const [admin, setAdmin] = useState(false);
  useEffect(() => observeAuth((user) => {
    void (async () => {
      const profile = user ? await loadAccessProfile(user.email) : null;
      setAdmin(profile?.role === 'admin');
    })();
  }), []);
  if (!admin) return null;
  return <main className="attendance-audit-main"><AttendanceAuditPanel /></main>;
}

const mount = document.createElement('div');
mount.id = 'attendance-audit-root';
document.body.appendChild(mount);
ReactDOM.createRoot(mount).render(<React.StrictMode><AttendanceAuditMount /></React.StrictMode>);
