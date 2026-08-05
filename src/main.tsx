import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import type { User } from 'firebase/auth';
import './styles.css';
import { firebaseConfigured } from './services/firebase';
import { loginWithGoogle, logout, observeAuth } from './services/auth';
import { loadAccessProfile, type AccessProfile } from './services/roster';

const modules = [
  { title: 'Đăng ký lớp', detail: 'Xác thực Google và đối chiếu roster Firestore.', status: 'Hoàn thành' },
  { title: 'Điểm danh QR', detail: 'Quét QR ngắn hạn và ghi nhận thời gian máy chủ.', status: 'Tiếp theo' },
  { title: 'Bài tập trên lớp', detail: 'Trắc nghiệm, tự luận, lưu nháp và nộp bài.', status: 'Kế hoạch' },
  { title: 'Chấm điểm', detail: 'Chấm tự động, AI gợi ý và giảng viên duyệt.', status: 'Kế hoạch' },
];

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<AccessProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [message, setMessage] = useState('');

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
          <p>Roster đã được xác thực từ Firestore. Bạn có thể tiếp tục mở phiên điểm danh, tạo bài tập và quản lý bảng điểm.</p>
          <div className="profile-grid">
            <div><strong>Email</strong><span>{profile.email}</span></div>
            <div><strong>Lớp</strong><span>{profile.classCode}</span></div>
            <div><strong>Vai trò</strong><span>Quản trị viên</span></div>
          </div>
        </section>
      )}

      {profile?.role === 'student' && (
        <section className="workflow dashboard-panel">
          <span className="panel-label">STUDENT DASHBOARD</span>
          <h2>Xin chào, {profile.fullName || 'Sinh viên'}</h2>
          <p>Tài khoản Google của bạn đã được đối chiếu thành công với danh sách lớp.</p>
          <div className="profile-grid">
            <div><strong>MSSV</strong><span>{profile.studentId || 'Tài khoản thử nghiệm'}</span></div>
            <div><strong>Lớp</strong><span>{profile.classCode}</span></div>
            <div><strong>Email</strong><span>{profile.email}</span></div>
          </div>
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
