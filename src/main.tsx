import React, { useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom/client';
import type { User } from 'firebase/auth';
import QRCode from 'qrcode';
import './styles.css';
import { firebaseConfigured } from './services/firebase';
import { loginWithGoogle, logout, observeAuth } from './services/auth';
import { loadAccessProfile, type AccessProfile } from './services/roster';
import {
  checkInAttendance,
  closeAttendanceSession,
  openAttendanceSession,
  type AttendanceSession,
} from './services/attendance';

const modules = [
  { title: 'Đăng ký lớp', detail: 'Xác thực Google và đối chiếu roster Firestore.', status: 'Hoàn thành' },
  { title: 'Điểm danh QR', detail: 'Mở phiên, quét QR và ghi nhận thời gian máy chủ.', status: 'Đang triển khai' },
  { title: 'Bài tập trên lớp', detail: 'Trắc nghiệm, tự luận, lưu nháp và nộp bài.', status: 'Kế hoạch' },
  { title: 'Chấm điểm', detail: 'Chấm tự động, AI gợi ý và giảng viên duyệt.', status: 'Kế hoạch' },
];

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<AccessProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [message, setMessage] = useState('');
  const [attendanceTitle, setAttendanceTitle] = useState('Điểm danh trên lớp');
  const [attendanceSession, setAttendanceSession] = useState<AttendanceSession | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [attendanceBusy, setAttendanceBusy] = useState(false);
  const [checkInDone, setCheckInDone] = useState(false);

  const attendanceParams = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return {
      sessionId: params.get('attendanceSession') ?? '',
      token: params.get('token') ?? '',
    };
  }, []);

  useEffect(() => observeAuth(setUser), []);

  useEffect(() => {
    let active = true;

    async function resolveProfile() {
      setMessage('');
      setProfile(null);
      if (!user) return;

      setLoadingProfile(true);
      try {
        const accessProfile = await loadAccessProfile(user.email);
        if (!active) return;

        if (!accessProfile) {
          await logout();
          setMessage('Email Google này không có trong danh sách lớp IT006.Q24.');
          return;
        }
        setProfile(accessProfile);
      } catch (error) {
        if (active) {
          setMessage(error instanceof Error ? error.message : 'Không thể kiểm tra danh sách lớp.');
        }
      } finally {
        if (active) setLoadingProfile(false);
      }
    }

    void resolveProfile();
    return () => {
      active = false;
    };
  }, [user]);

  async function handleLogin() {
    setMessage('');
    try {
      await loginWithGoogle();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể đăng nhập.');
    }
  }

  async function handleOpenAttendance() {
    setAttendanceBusy(true);
    setMessage('');
    try {
      const session = await openAttendanceSession(attendanceTitle, 10);
      const url = new URL(window.location.href);
      url.searchParams.set('attendanceSession', session.id);
      url.searchParams.set('token', session.token);
      const dataUrl = await QRCode.toDataURL(url.toString(), { width: 320, margin: 2 });
      setAttendanceSession(session);
      setQrDataUrl(dataUrl);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể mở phiên điểm danh.');
    } finally {
      setAttendanceBusy(false);
    }
  }

  async function handleCloseAttendance() {
    if (!attendanceSession) return;
    setAttendanceBusy(true);
    try {
      await closeAttendanceSession(attendanceSession.id);
      setAttendanceSession(null);
      setQrDataUrl('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể đóng phiên điểm danh.');
    } finally {
      setAttendanceBusy(false);
    }
  }

  async function handleCheckIn() {
    if (!profile || !attendanceParams.sessionId || !attendanceParams.token) return;
    setAttendanceBusy(true);
    setMessage('');
    try {
      await checkInAttendance(attendanceParams.sessionId, attendanceParams.token, profile);
      setCheckInDone(true);
      setMessage('Điểm danh thành công. Thời gian đã được ghi nhận trên Firestore.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể điểm danh.');
    } finally {
      setAttendanceBusy(false);
    }
  }

  return (
    <main>
      <header className="hero">
        <div>
          <span className="eyebrow">IT006.Q24 · CUONGTV CLASSROOM</span>
          <h1>Kiến trúc máy tính — học kỳ 2, năm học 2025–2026</h1>
          <p>
            Đăng nhập Google, kiểm tra roster Firestore, điểm danh QR, làm bài trực tuyến
            và xuất bảng điểm.
          </p>
          <div className="actions">
            {user ? (
              <>
                <button type="button" onClick={() => void logout()}>Đăng xuất</button>
                <span>
                  {loadingProfile ? 'Đang kiểm tra danh sách lớp…' : profile
                    ? `${profile.fullName || profile.email} · ${profile.role === 'admin' ? 'Quản trị viên' : 'Sinh viên'}`
                    : user.email}
                </span>
              </>
            ) : (
              <button type="button" onClick={() => void handleLogin()}>Đăng nhập bằng Google</button>
            )}
            <a href="#modules">Xem chức năng</a>
          </div>
          {message && <p className="notice">{message}</p>}
        </div>

        <aside className="status-card">
          <strong>Trạng thái hệ thống</strong>
          <dl>
            <div><dt>Lớp</dt><dd>IT006.Q24</dd></div>
            <div><dt>Roster</dt><dd>58 tài khoản</dd></div>
            <div><dt>Xác thực</dt><dd>Google</dd></div>
            <div><dt>Firebase</dt><dd>{firebaseConfigured ? 'Đã cấu hình' : 'Chờ cấu hình'}</dd></div>
          </dl>
        </aside>
      </header>

      {profile?.role === 'admin' && (
        <section className="workflow dashboard-panel">
          <span className="panel-label">ADMIN DASHBOARD</span>
          <h2>Xin chào, {profile.fullName || 'Giảng viên'}</h2>
          <div className="profile-grid">
            <div><strong>Email</strong><span>{profile.email}</span></div>
            <div><strong>Lớp</strong><span>{profile.classCode}</span></div>
            <div><strong>Vai trò</strong><span>Quản trị viên</span></div>
          </div>

          <div className="attendance-box">
            <h3>Mở phiên điểm danh</h3>
            {!attendanceSession ? (
              <div className="attendance-controls">
                <input
                  value={attendanceTitle}
                  onChange={(event) => setAttendanceTitle(event.target.value)}
                  aria-label="Tên phiên điểm danh"
                />
                <button type="button" disabled={attendanceBusy} onClick={() => void handleOpenAttendance()}>
                  {attendanceBusy ? 'Đang mở…' : 'Mở phiên 10 phút'}
                </button>
              </div>
            ) : (
              <div className="qr-panel">
                <div>
                  <strong>{attendanceSession.title}</strong>
                  <p>Hết hạn lúc {attendanceSession.expiresAt.toDate().toLocaleTimeString('vi-VN')}</p>
                  <button type="button" disabled={attendanceBusy} onClick={() => void handleCloseAttendance()}>
                    Đóng phiên
                  </button>
                </div>
                {qrDataUrl && <img src={qrDataUrl} alt="QR điểm danh" />}
              </div>
            )}
          </div>
        </section>
      )}

      {profile?.role === 'student' && (
        <section className="workflow dashboard-panel">
          <span className="panel-label">STUDENT DASHBOARD</span>
          <h2>Xin chào, {profile.fullName || 'Sinh viên'}</h2>
          <div className="profile-grid">
            <div><strong>MSSV</strong><span>{profile.studentId || 'Tài khoản thử nghiệm'}</span></div>
            <div><strong>Lớp</strong><span>{profile.classCode}</span></div>
            <div><strong>Email</strong><span>{profile.email}</span></div>
          </div>

          {attendanceParams.sessionId && attendanceParams.token && (
            <div className="attendance-box">
              <h3>Điểm danh buổi học</h3>
              <p>Mã QR đã được nhận. Nhấn nút bên dưới để xác nhận bằng tài khoản Google hiện tại.</p>
              <button
                type="button"
                disabled={attendanceBusy || checkInDone}
                onClick={() => void handleCheckIn()}
              >
                {checkInDone ? 'Đã điểm danh' : attendanceBusy ? 'Đang ghi nhận…' : 'Xác nhận điểm danh'}
              </button>
            </div>
          )}
        </section>
      )}

      <section id="modules" className="modules">
        {modules.map((module) => (
          <article key={module.title}>
            <span>{module.status}</span>
            <h2>{module.title}</h2>
            <p>{module.detail}</p>
          </article>
        ))}
      </section>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
