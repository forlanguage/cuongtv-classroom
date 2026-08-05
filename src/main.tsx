import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import type { User } from 'firebase/auth';
import QRCode from 'qrcode';
import './styles.css';
import { firebaseConfigured } from './services/firebase';
import { loginWithGoogle, logout, observeAuth } from './services/auth';
import { loadAccessProfile, type AccessProfile } from './services/roster';
import {
  QR_ROTATION_MS,
  checkInAttendance,
  closeAttendanceSession,
  observeAttendanceCount,
  observeOpenAttendanceSessions,
  openAttendanceSession,
  rotateAttendanceCode,
  type AttendanceSession,
} from './services/attendance';
import {
  captureCompressedPhoto,
  openRearCamera,
  stopCamera,
  type CapturedPhoto,
} from './services/camera';

const modules = [
  { title: 'Đăng ký lớp', detail: 'Xác thực Google và đối chiếu roster Firestore.', status: 'Hoàn thành' },
  { title: 'Điểm danh QR', detail: 'Chọn phiên, quét QR, nhập PIN và chụp ảnh hậu kiểm.', status: 'MVP 2' },
  { title: 'Bài tập trên lớp', detail: 'Trắc nghiệm, tự luận, lưu nháp và nộp bài.', status: 'Kế hoạch' },
  { title: 'Chấm điểm', detail: 'Chấm tự động, AI gợi ý và giảng viên duyệt.', status: 'Kế hoạch' },
];

type StudentAttendanceStep = 'list' | 'scan' | 'pin' | 'photo' | 'done';

type BarcodeDetectorInstance = {
  detect: (source: CanvasImageSource) => Promise<Array<{ rawValue?: string }>>;
};

declare global {
  interface Window {
    BarcodeDetector?: new (options: { formats: string[] }) => BarcodeDetectorInstance;
  }
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<AccessProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [message, setMessage] = useState('');
  const [attendanceTitle, setAttendanceTitle] = useState('Điểm danh trên lớp');
  const [attendanceSession, setAttendanceSession] = useState<AttendanceSession | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [attendanceBusy, setAttendanceBusy] = useState(false);
  const [attendanceCount, setAttendanceCount] = useState(0);

  const [openSessions, setOpenSessions] = useState<AttendanceSession[]>([]);
  const [selectedSession, setSelectedSession] = useState<AttendanceSession | null>(null);
  const [studentStep, setStudentStep] = useState<StudentAttendanceStep>('list');
  const [scannedToken, setScannedToken] = useState('');
  const [pin, setPin] = useState('');
  const [photo, setPhoto] = useState<CapturedPhoto | null>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [scannerActive, setScannerActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scanTimerRef = useRef<number | null>(null);

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
        if (active) setMessage(error instanceof Error ? error.message : 'Không thể kiểm tra danh sách lớp.');
      } finally {
        if (active) setLoadingProfile(false);
      }
    }
    void resolveProfile();
    return () => { active = false; };
  }, [user]);

  useEffect(() => {
    if (profile?.role !== 'student') return;
    return observeOpenAttendanceSessions(setOpenSessions);
  }, [profile?.role]);

  useEffect(() => () => {
    stopCamera(cameraStream);
    if (scanTimerRef.current) window.clearTimeout(scanTimerRef.current);
  }, [cameraStream]);

  useEffect(() => {
    if (!attendanceSession) return;
    return observeAttendanceCount(attendanceSession.id, setAttendanceCount);
  }, [attendanceSession]);

  useEffect(() => {
    if (!attendanceSession) return;
    let slot = attendanceSession.slot;
    const timer = window.setInterval(() => {
      slot += 1;
      void (async () => {
        try {
          const next = await rotateAttendanceCode(attendanceSession.id, slot);
          const updated = { ...attendanceSession, ...next, slot };
          const url = new URL(window.location.href);
          url.searchParams.set('attendanceSession', updated.id);
          url.searchParams.set('token', updated.token);
          setQrDataUrl(await QRCode.toDataURL(url.toString(), { width: 320, margin: 2 }));
          setAttendanceSession(updated);
        } catch (error) {
          setMessage(error instanceof Error ? error.message : 'Không thể đổi mã điểm danh.');
        }
      })();
    }, QR_ROTATION_MS);
    return () => window.clearInterval(timer);
  }, [attendanceSession?.id]);

  async function waitForVideoElement(): Promise<HTMLVideoElement> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (videoRef.current) return videoRef.current;
      await new Promise((resolve) => window.setTimeout(resolve, 25));
    }
    throw new Error('Không thể khởi tạo vùng xem camera.');
  }

  async function handleLogin() {
    setMessage('');
    try { await loginWithGoogle(); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Không thể đăng nhập.'); }
  }

  async function handleOpenAttendance() {
    setAttendanceBusy(true);
    setMessage('');
    try {
      const session = await openAttendanceSession(attendanceTitle);
      const url = new URL(window.location.href);
      url.searchParams.set('attendanceSession', session.id);
      url.searchParams.set('token', session.token);
      setQrDataUrl(await QRCode.toDataURL(url.toString(), { width: 320, margin: 2 }));
      setAttendanceSession(session);
      setAttendanceCount(0);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể mở phiên điểm danh.');
    } finally { setAttendanceBusy(false); }
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
    } finally { setAttendanceBusy(false); }
  }

  function resetStudentFlow() {
    stopCamera(cameraStream);
    if (scanTimerRef.current) window.clearTimeout(scanTimerRef.current);
    if (photo) URL.revokeObjectURL(photo.previewUrl);
    setCameraStream(null);
    setScannerActive(false);
    setSelectedSession(null);
    setScannedToken('');
    setPin('');
    setPhoto(null);
    setStudentStep('list');
    setMessage('');
  }

  async function startQrScanner(session: AttendanceSession) {
    if (!window.BarcodeDetector) {
      setMessage('Trình duyệt chưa hỗ trợ quét QR trực tiếp. Hãy dùng Chrome mới nhất trên điện thoại.');
      return;
    }

    setSelectedSession(session);
    setStudentStep('scan');
    setMessage('');
    try {
      const video = await waitForVideoElement();
      stopCamera(cameraStream);
      const stream = await openRearCamera(video);
      setCameraStream(stream);
      setScannerActive(true);
      const detector = new window.BarcodeDetector({ formats: ['qr_code'] });

      const scanFrame = async () => {
        if (!videoRef.current || !stream.active) return;
        try {
          const codes = await detector.detect(videoRef.current);
          const value = codes[0]?.rawValue;
          if (value) {
            const scannedUrl = new URL(value);
            const sessionId = scannedUrl.searchParams.get('attendanceSession');
            const token = scannedUrl.searchParams.get('token');
            if (sessionId !== session.id || !token) {
              throw new Error('QR không thuộc phiên điểm danh đã chọn.');
            }
            stopCamera(stream);
            setCameraStream(null);
            setScannerActive(false);
            setScannedToken(token);
            setStudentStep('pin');
            return;
          }
        } catch (error) {
          if (error instanceof Error && error.message.includes('không thuộc phiên')) {
            setMessage(error.message);
          }
        }
        scanTimerRef.current = window.setTimeout(() => void scanFrame(), 350);
      };
      void scanFrame();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể mở camera quét QR.');
    }
  }

  async function handleOpenPhotoCamera() {
    setStudentStep('photo');
    setMessage('');
    try {
      const video = await waitForVideoElement();
      stopCamera(cameraStream);
      setCameraStream(await openRearCamera(video));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể mở camera sau.');
    }
  }

  async function handleCapturePhoto() {
    if (!videoRef.current || !profile) return;
    try {
      if (photo) URL.revokeObjectURL(photo.previewUrl);
      const captured = await captureCompressedPhoto(
        videoRef.current,
        `${profile.studentId || profile.email} · IT006.Q24`,
      );
      setPhoto(captured);
      stopCamera(cameraStream);
      setCameraStream(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể chụp ảnh.');
    }
  }

  async function handleCheckIn() {
    if (!profile || !selectedSession || !scannedToken || !photo) return;
    setAttendanceBusy(true);
    setMessage('');
    try {
      await checkInAttendance(selectedSession.id, scannedToken, pin, profile, photo.blob);
      setStudentStep('done');
      setMessage('Điểm danh thành công. Ảnh đã được lưu để hậu kiểm.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể điểm danh.');
    } finally { setAttendanceBusy(false); }
  }

  return (
    <main>
      <header className="hero">
        <div>
          <span className="eyebrow">IT006.Q24 · CUONGTV CLASSROOM</span>
          <h1>Kiến trúc máy tính — học kỳ 2, năm học 2025–2026</h1>
          <p>Đăng nhập Google, kiểm tra roster, điểm danh QR động và lưu ảnh để hậu kiểm.</p>
          <div className="actions">
            {user ? (
              <>
                <button type="button" onClick={() => void logout()}>Đăng xuất</button>
                <span>{loadingProfile ? 'Đang kiểm tra danh sách lớp…' : profile ? `${profile.fullName || profile.email} · ${profile.role === 'admin' ? 'Quản trị viên' : 'Sinh viên'}` : user.email}</span>
              </>
            ) : <button type="button" onClick={() => void handleLogin()}>Đăng nhập bằng Google</button>}
            <a href="#modules">Xem chức năng</a>
          </div>
          {message && <p className="notice">{message}</p>}
        </div>
        <aside className="status-card">
          <strong>Trạng thái hệ thống</strong>
          <dl>
            <div><dt>Lớp</dt><dd>IT006.Q24</dd></div>
            <div><dt>QR rotation</dt><dd>60 giây</dd></div>
            <div><dt>Session</dt><dd>5 phút</dd></div>
            <div><dt>Firebase</dt><dd>{firebaseConfigured ? 'Đã cấu hình' : 'Chờ cấu hình'}</dd></div>
          </dl>
        </aside>
      </header>

      {profile?.role === 'admin' && (
        <section className="workflow dashboard-panel">
          <span className="panel-label">ADMIN DASHBOARD</span>
          <h2>Xin chào, {profile.fullName || 'Giảng viên'}</h2>
          <div className="attendance-box">
            <h3>Điểm danh QR + PIN + ảnh hậu kiểm</h3>
            {!attendanceSession ? (
              <div className="attendance-controls">
                <input value={attendanceTitle} onChange={(event) => setAttendanceTitle(event.target.value)} aria-label="Tên phiên điểm danh" />
                <button type="button" disabled={attendanceBusy} onClick={() => void handleOpenAttendance()}>
                  {attendanceBusy ? 'Đang mở…' : 'Mở phiên 5 phút'}
                </button>
              </div>
            ) : (
              <div className="qr-panel">
                <div>
                  <strong>{attendanceSession.title}</strong>
                  <p>PIN hiện tại: <b className="pin-code">{attendanceSession.pin}</b></p>
                  <p>QR và PIN tự đổi mỗi 60 giây.</p>
                  <p>Đã điểm danh: <b>{attendanceCount}</b></p>
                  <p>Hết hạn lúc {attendanceSession.expiresAt.toDate().toLocaleTimeString('vi-VN')}</p>
                  <button type="button" disabled={attendanceBusy} onClick={() => void handleCloseAttendance()}>Đóng phiên</button>
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

          <div className="attendance-box camera-box">
            <div className="step-indicator">
              <span className={studentStep === 'list' ? 'active' : ''}>1. Chọn phiên</span>
              <span className={studentStep === 'scan' || studentStep === 'pin' ? 'active' : ''}>2. QR + PIN</span>
              <span className={studentStep === 'photo' || studentStep === 'done' ? 'active' : ''}>3. Chụp ảnh</span>
            </div>

            {studentStep === 'list' && (
              <>
                <h3>Phiên điểm danh đang mở</h3>
                {!openSessions.length ? (
                  <p>Hiện chưa có phiên điểm danh nào.</p>
                ) : (
                  <div className="session-list">
                    {openSessions.map((session) => (
                      <button key={session.id} type="button" className="session-item" onClick={() => void startQrScanner(session)}>
                        <strong>{session.title}</strong>
                        <span>Hết hạn lúc {session.expiresAt.toDate().toLocaleTimeString('vi-VN')}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}

            {studentStep === 'scan' && selectedSession && (
              <>
                <h3>Quét QR — {selectedSession.title}</h3>
                <p>Hướng camera sau vào QR đang hiển thị trên màn hình giảng viên.</p>
                <video ref={videoRef} muted playsInline className={scannerActive ? 'camera-preview active' : 'camera-preview'} />
                <button type="button" className="secondary-button" onClick={resetStudentFlow}>Quay lại danh sách</button>
              </>
            )}

            {studentStep === 'pin' && selectedSession && (
              <>
                <h3>Nhập PIN xác nhận</h3>
                <p>QR hợp lệ. Nhập PIN 4 số đang hiển thị trong lớp.</p>
                <input inputMode="numeric" maxLength={4} value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="0000" />
                <div className="attendance-controls">
                  <button type="button" disabled={pin.length !== 4} onClick={() => void handleOpenPhotoCamera()}>Tiếp tục mở camera sau</button>
                  <button type="button" className="secondary-button" onClick={resetStudentFlow}>Hủy</button>
                </div>
              </>
            )}

            {studentStep === 'photo' && selectedSession && (
              <>
                <h3>Chụp ảnh khuôn mặt</h3>
                <p>Dùng camera sau để chụp ảnh rõ mặt trước khi gửi điểm danh.</p>
                <video ref={videoRef} muted playsInline className={cameraStream ? 'camera-preview active' : 'camera-preview'} />
                {photo && <img className="photo-preview" src={photo.previewUrl} alt="Ảnh điểm danh đã chụp" />}
                <div className="attendance-controls">
                  {cameraStream && <button type="button" onClick={() => void handleCapturePhoto()}>Chụp ảnh</button>}
                  {photo && <button type="button" onClick={() => { URL.revokeObjectURL(photo.previewUrl); setPhoto(null); void handleOpenPhotoCamera(); }}>Chụp lại</button>}
                  <button type="button" disabled={attendanceBusy || !photo} onClick={() => void handleCheckIn()}>
                    {attendanceBusy ? 'Đang tải ảnh…' : 'Gửi điểm danh'}
                  </button>
                </div>
                <p className="privacy-note">Ảnh chỉ dùng để hậu kiểm điểm danh và không được nhận diện tự động trong MVP này.</p>
              </>
            )}

            {studentStep === 'done' && (
              <>
                <h3>Đã điểm danh thành công</h3>
                <p>Hệ thống đã ghi nhận thời gian và lưu ảnh hậu kiểm.</p>
                <button type="button" onClick={resetStudentFlow}>Về danh sách phiên</button>
              </>
            )}
          </div>
        </section>
      )}

      <section id="modules" className="modules">
        {modules.map((module) => <article key={module.title}><span>{module.status}</span><h2>{module.title}</h2><p>{module.detail}</p></article>)}
      </section>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
