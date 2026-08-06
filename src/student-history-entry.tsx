import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import './student-history.css';
import { observeAuth } from './services/auth';
import { loadAccessProfile } from './services/roster';
import { StudentAttendanceHistory } from './components/StudentAttendanceHistory';

function StudentHistoryMount() {
  const [studentEmail, setStudentEmail] = useState('');

  useEffect(() => observeAuth((user) => {
    void (async () => {
      if (!user) {
        setStudentEmail('');
        return;
      }
      const profile = await loadAccessProfile(user.email);
      setStudentEmail(profile?.role === 'student' ? profile.email : '');
    })();
  }), []);

  if (!studentEmail) return null;
  return <main className="student-history-main"><StudentAttendanceHistory email={studentEmail} /></main>;
}

const mount = document.createElement('div');
mount.id = 'student-attendance-history-root';
document.body.appendChild(mount);
ReactDOM.createRoot(mount).render(<React.StrictMode><StudentHistoryMount /></React.StrictMode>);
