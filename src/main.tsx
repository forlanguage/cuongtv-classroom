import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';

const modules = [
  { title: 'Đăng ký lớp', detail: 'Xác thực email Google và đối chiếu danh sách sinh viên.', status: 'MVP 1' },
  { title: 'Điểm danh QR', detail: 'Quét QR ngắn hạn bằng điện thoại và ghi nhận thời gian máy chủ.', status: 'MVP 2' },
  { title: 'Bài tập trên lớp', detail: 'Hỗ trợ trắc nghiệm, tự luận, lưu nháp và nộp bài.', status: 'MVP 3' },
  { title: 'Chấm điểm', detail: 'Tự động chấm trắc nghiệm, AI gợi ý chấm tự luận và giảng viên duyệt.', status: 'MVP 4' },
];

function App() {
  return (
    <main>
      <header className="hero">
        <div>
          <span className="eyebrow">CUONGTV CLASSROOM</span>
          <h1>Nền tảng lớp học nhẹ, triển khai bằng GitHub Pages</h1>
          <p>
            Đăng nhập Google, điểm danh QR, làm bài trực tuyến, lưu bài trên Google Drive
            và xuất bảng điểm qua Google Sheets.
          </p>
          <div className="actions">
            <button type="button">Đăng nhập bằng Google</button>
            <a href="#modules">Xem chức năng</a>
          </div>
        </div>
        <aside className="status-card">
          <strong>Trạng thái hệ thống</strong>
          <dl>
            <div><dt>Frontend</dt><dd>Sẵn sàng</dd></div>
            <div><dt>Firebase</dt><dd>Chờ cấu hình</dd></div>
            <div><dt>Drive backend</dt><dd>Chờ Apps Script</dd></div>
          </dl>
        </aside>
      </header>

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
          <li>Đăng nhập bằng tài khoản Google.</li>
          <li>Hệ thống đối chiếu email với roster của lớp.</li>
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
