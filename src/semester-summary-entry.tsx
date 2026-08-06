import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import './semester-summary.css';
import { observeAuth } from './services/auth';
import { loadAccessProfile } from './services/roster';
import { SemesterAttendanceSummary } from './components/SemesterAttendanceSummary';

function SemesterSummaryMount() {
  const [admin, setAdmin] = useState(false);

  useEffect(() => observeAuth((user) => {
    void (async () => {
      const profile = user ? await loadAccessProfile(user.email) : null;
      setAdmin(profile?.role === 'admin');
    })();
  }), []);

  if (!admin) return null;
  return <main className="semester-summary-main"><SemesterAttendanceSummary /></main>;
}

const mount = document.createElement('div');
mount.id = 'semester-summary-root';
document.body.appendChild(mount);
ReactDOM.createRoot(mount).render(<React.StrictMode><SemesterSummaryMount /></React.StrictMode>);
