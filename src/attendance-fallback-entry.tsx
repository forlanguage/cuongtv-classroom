import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import './attendance-fallback.css';
import { observeAuth } from './services/auth';
import { loadAccessProfile, type AccessProfile } from './services/roster';
import { AttendanceFallbackPanel } from './components/AttendanceFallbackPanel';

function AttendanceFallbackMount() {
  const [profile, setProfile] = useState<AccessProfile | null>(null);

  useEffect(() => observeAuth((user) => {
    void (async () => {
      if (!user) { setProfile(null); return; }
      const access = await loadAccessProfile(user.email);
      setProfile(access?.role === 'student' && access.active ? access : null);
    })();
  }), []);

  if (!profile) return null;
  return <main className="attendance-fallback-main"><AttendanceFallbackPanel profile={profile} /></main>;
}

const mount = document.createElement('div');
mount.id = 'attendance-fallback-root';
document.body.appendChild(mount);
ReactDOM.createRoot(mount).render(<React.StrictMode><AttendanceFallbackMount /></React.StrictMode>);
