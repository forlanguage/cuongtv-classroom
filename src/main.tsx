import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import type { User } from 'firebase/auth';
import './styles.css';
import { firebaseConfigured } from './services/firebase';
import { loginWithGoogle, logout, observeAuth, resolveRole } from './services/auth';

const modules = [
  { title: 'Đăng ký lớp', detail: 'Xác thực email Google và đối chiếu danh sách sinh viên.', status: 'MVP 1' },
  { title: 'Điểm danh QR', detail: 'Quét QR ngắn hạn bằng điện thoại và ghi nhận thời gian máy chủ.', status: 'MVP 2' },
  { title: 'Bài tập trên lớp', detail: 'Hỗ trợ trắc nghiệm, tự luận, lưu nháp và nộp bài.', status: 'MVP 3' },
  { title: 'Chấm điểm', detail: 'Tự động chấm trắc nghiệm, AI gợi ý chấm tự luận và giảng viên duyệt.', status: 'MVP 4' },
];

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [message, setMessage] = useState('');
  const role = resolveRole(user);

  useEffect(() => observeAuth(setUser), []);

  async function handleLogin() {
    setMessage('');
    try {
      const loggedInUser = await loginWithGoogle();
      const loggedInRole = resolveRole(loggedInUser);
      if (loggedInRole === 'guest') {
        await logout();
        setMessage('Tài khoản này không thuộc UIT hoặc không nằm trong danh sách được phép.');
      }
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
            Đăng nhập Google, điểm danh QR, làm bài trực tuyến, lưu bài trên Google Drive
            và xuất bảng điểm qua Google Sheets.
          </p>
          <div className="actions">
            {user ? (
              <>
                <button type="button" onClick={() => void logout()}>Đăng xuất</button>
                <span>{user.email} · {role === 'admin' ? 'Quản trị viên' : 'Sinh viên'}</span>
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
            <div><dt>Danh sách</dt><dd>56 sinh viên</dd></div>
            <div><dt>Admin</dt><dd>cuongtv@uit.edu.vn</dd></div>
            <div><dt>Firebase</dt><dd>{firebaseConfigured ? 'Đã cấu hình' : 'Chờ cấu hình'}</dd></div>
          </dl>
        </aside>
      </header>

      {role === 'admin' && (
        <section className="workflow admin-panel">
          <h2>Trang quản trị</h2>
          <p>Bạn đã đăng nhập bằng tài khoản quản trị. Các chức năng quản lý lớp, điểm danh, bài tập và bảng điểm sẽ được triển khai tại đây.</p>
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

      <section className="workflow">
        <h2>Luồng sinh viên</h2>
        <ol>
          <li>Đăng nhập bằng tài khoản Google sinh viên UIT.</li>
          <li>Hệ thống đối chiếu email với roster IT006.Q24.</li>
          <li>Điểm danh hoặc mở bài tập đang hoạt động.</li>
          <li>Nộp bài và nhận email xác nhận.</li>
        </ol>
      </section>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
