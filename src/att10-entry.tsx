import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { observeAuth } from './services/auth';
import { loadAccessProfile, type AccessProfile } from './services/roster';
import { QrPinNoPhotoPanel } from './components/QrPinNoPhotoPanel';
import { ManualTeacherAttendancePanel } from './components/ManualTeacherAttendancePanel';
import './att10.css';

function Att10Mount() {
  const [profile, setProfile] = useState<AccessProfile | null>(null);
  useEffect(() => observeAuth((user) => {
    void (async () => setProfile(user ? await loadAccessProfile(user.email) : null))();
  }), []);
  if (!profile) return null;
  return <main className="att10-main">
    {profile.role === 'student' && <QrPinNoPhotoPanel profile={profile} />}
    {profile.role === 'admin' && <ManualTeacherAttendancePanel />}
  </main>;
}

const mount = document.createElement('div');
mount.id = 'att10-root';
document.body.appendChild(mount);
ReactDOM.createRoot(mount).render(<React.StrictMode><Att10Mount /></React.StrictMode>);
