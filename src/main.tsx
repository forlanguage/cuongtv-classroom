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
  claimAttendanceChallenge,
  closeAttendanceSession,
  completeAttendanceClaim,
  observeAttendanceCount,
  observeOpenAttendanceSessions,
  openAttendanceSession,
  rotateAttendanceChallenge,
  type AttendanceAdminState,
  type AttendanceClaim,
  type AttendanceSession,
} from './services/attendance';
import {
  captureCompressedPhoto,
  decodeQrFromImageFile,
  openRearCamera,
  stopCamera,
  type CapturedPhoto,
} from './services/camera';

const modules = [
  { title: 'Đăng ký lớp', detail: 'Xác thực Google và đối chiếu roster Firestore.', status: 'Hoàn thành' },
  { title: 'Điểm danh QR', detail: 'Challenge ngắn hạn, claim một lần, PIN và ảnh hậu kiểm.', status: 'MVP 3' },
  { title: 'Bài tập trên lớp', detail: 'Trắc nghiệm, tự luận, lưu nháp và nộp bài.', status: 'Kế hoạch' },
  { title: 'Chấm điểm', detail: 'Chấm tự động, AI gợi ý và giảng viên duyệt.', status: 'Kế hoạch' },
];

type StudentStep = 'list' | 'scan' | 'pin' | 'photo' | 'done';
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
  const [adminSession, setAdminSession] = useState<AttendanceAdminState | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [attendanceCount, setAttendanceCount] = useState(0);
  const [attendanceBusy, setAttendanceBusy] = useState(false);

  const [openSessions, setOpenSessions] = useState<AttendanceSession[]>([]);
  const [selectedSession, setSelectedSession] = useState<AttendanceSession | null>(null);
  const [claim, setClaim] = useState<AttendanceClaim | null>(null);
  const [studentStep, setStudentStep] = useState<StudentStep>('list');
  const [pin, setPin] = useState('');
  const [photo, setPhoto] = useState<CapturedPhoto | null>(null);
  const [requestId, setRequestId] = useState('');
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [qrImageBusy, setQrImageBusy] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scanTimerRef = useRef<number | null>(null);
  const qrImageInputRef = useRef<HTMLInputElement | null>(null);

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
    if (!adminSession) return;
    return observeAttendanceCount(adminSession.id, setAttendanceCount);
  }, [adminSession]);

  useEffect(() => {
    if (!adminSession) return;
    let slot = adminSession.slot;
    const timer = window.setInterval(() => {
      slot += 1;
      void (async () => {
        try {
          const next = await rotateAttendanceChallenge(adminSession.id, slot);
          const updated = { ...adminSession, ...next, slot };
          const url = new URL(window.location.origin + window.location.pathname);
          url.searchParams.set('challenge', updated.currentChallengeId);
          setQrDataUrl(await QRCode.toDataURL(url.toString(), { width: 320, margin: 2 }));
          setAdminSession(updated);
        } catch (error) {
          setMessage(error instanceof Error ? error.message : 'Không thể đổi challenge điểm danh.');
        }
      })();
    }, QR_ROTATION_MS);
    return () => window.clearInterval(timer);
  }, [adminSession?.id]);

  async function waitForVideo(): Promise<HTMLVideoElement> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (videoRef.current) return videoRef.current;
      await new Promise((resolve) => window.setTimeout(resolve, 25));
    }
    throw new Error('Không thể khởi tạo vùng camera.');
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
      const url = new URL(window.location.origin + window.location.pathname);
      url.searchParams.set('challenge', session.currentChallengeId);
      setQrDataUrl(await QRCode.toDataURL(url.toString(), { width: 320, margin: 2 }));
      setAdminSession(session);
      setAttendanceCount(0);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể mở phiên điểm danh.');
    } finally {
      setAttendanceBusy(false);
    }
  }

  async function handleCloseAttendance() {
    if (!adminSession) return;
    setAttendanceBusy(true);
    try {
      await closeAttendanceSession(adminSession.id);
      setAdminSession(null);
      setQrDataUrl('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể đóng phiên điểm danh.');
    } finally {
      setAttendanceBusy(false);
    }
  }

  function resetStudentFlow() {
    stopCamera(cameraStream);
    if (scanTimerRef.current) window.clearTimeout(scanTimerRef.current);
    if (photo) URL.revokeObjectURL(photo.previewUrl);
    setCameraStream(null);
    setSelectedSession(null);
    setClaim(null);
    setPin('');
    setPhoto(null);
    setRequestId('');
    setQrImageBusy(false);
    if (qrImageInputRef.current) qrImageInputRef.current.value = '';
    setStudentStep('list');
    setMessage('');
  }

  async function acceptQrValue(session: AttendanceSession, value: string) {
    if (!profile) return;
    const scannedUrl = new URL(value);
    const challengeId = scannedUrl.searchParams.get('challenge');
    if (!challengeId) throw new Error('QR không chứa challenge hợp lệ.');
    const issuedClaim = await claimAttendanceChallenge(session.id, challengeId, profile);
    stopCamera(cameraStream);
    setCameraStream(null);
    if (scanTimerRef.current) window.clearTimeout(scanTimerRef.current);
    setClaim(issuedClaim);
    setStudentStep('pin');
    setMessage('QR hợp lệ. Claim cá nhân đã được cấp trong 3 phút.');
  }

  async function startQrScanner(session: AttendanceSession) {
    if (!profile) return;
    setSelectedSession(session);
    setStudentStep('scan');
    setMessage('Có thể quét trực tiếp hoặc dùng nút “Chụp / chọn ảnh QR” trên iPhone.');
    try {
      const video = await waitForVideo();
      const stream = await openRearCamera(video);
      setCameraStream(stream);
      const Detector = window.BarcodeDetector;
      if (!Detector) throw new Error('Không có bộ giải mã QR.');
      const detector = new Detector({ formats: ['qr_code'] });
      const scanFrame = async () => {
        if (!videoRef.current || !stream.active) return;
        try {
          const codes = await detector.detect(videoRef.current);
          const value = codes[0]?.rawValue;
          if (value) {
            await acceptQrValue(session, value);
            stopCamera(stream);
            return;
          }
        } catch (error) {
          setMessage(error instanceof Error ? error.message : 'Không thể xác minh QR.');
        }
        scanTimerRef.current = window.setTimeout(() => void scanFrame(), 500);
      };
      void scanFrame();
    } catch (error) {
      setCameraStream(null);
      setMessage('Không thể quét camera trực tiếp. Hãy nhấn “Chụp / chọn ảnh QR”.');
    }
  }

  async function handleQrImageSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !selectedSession) return;
    setQrImageBusy(true);
    setMessage('Đang đọc mã QR từ ảnh…');
    try {
      const value = await decodeQrFromImageFile(file);
      await acceptQrValue(selectedSession, value);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể đọc mã QR từ ảnh.');
    } finally {
      setQrImageBusy(false);
      event.target.value = '';
    }
  }

  async function handleOpenPhotoCamera() {
    if (!claim || pin.length !== 4) return;
    setStudentStep('photo');
    setMessage('');
    try {
      const video = await waitForVideo();
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
      const captured = await captureCompressedPhoto(videoRef.current, `${profile.studentId || profile.email} · IT006.Q24`);
      setPhoto(captured);
      setRequestId(crypto.randomUUID());
      stopCamera(cameraStream);
      setCameraStream(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể chụp ảnh.');
    }
  }

  async function handleCheckIn() {
    if (!profile || !claim || !photo || !requestId) return;
    setAttendanceBusy(true);
    setMessage('Đang gửi ảnh; hệ thống sẽ tự thử lại nếu mạng chập chờn…');
    try {
      await completeAttendanceClaim(claim, pin, profile, photo.blob, requestId);
      setStudentStep('done');
      setMessage('Điểm danh thành công. Claim đã được dùng và không thể phát lại.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể hoàn tất điểm danh. Bạn có thể bấm gửi lại khi claim còn hạn.');
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
          <p>Đăng nhập Google, kiểm tra roster và điểm danh bằng challenge ngắn hạn, claim một lần.</p>
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
            <div><dt>QR challenge</dt><dd>60 giây</dd></div>
            <div><dt>Claim cá nhân</dt><dd>3 phút</dd></div>
            <div><dt>Firebase</dt><dd>{firebaseConfigured ? 'Đã cấu hình' : 'Chờ cấu hình'}</dd></div>
          </dl>
        </aside>
      </header>

      {profile?.role === 'admin' && (
        <section className="workflow dashboard-panel">
          <span className="panel-label">ADMIN DASHBOARD</span>
          <h2>Xin chào, {profile.fullName || 'Giảng viên'}</h2>
          <div className="attendance-box">
            <h3>Điểm danh challenge + PIN + ảnh hậu kiểm</h3>
            {!adminSession ? (
              <div className="attendance-controls">
                <input value={attendanceTitle} onChange={(event) => setAttendanceTitle(event.target.value)} aria-label="Tên phiên điểm danh" />
                <button type="button" disabled={attendanceBusy} onClick={() => void handleOpenAttendance()}>{attendanceBusy ? 'Đang mở…' : 'Mở phiên 5 phút'}</button>
              </div>
            ) : (
              <div className="qr-panel">
                <div>
                  <strong>{adminSession.title}</strong>
                  <p>PIN hiện tại: <b className="pin-code">{adminSession.pin}</b></p>
                  <p>QR và PIN đổi mỗi 60 giây. QR chỉ chứa challenge ID.</p>
                  <p>Đã điểm danh: <b>{attendanceCount}</b></p>
                  <p>Hết hạn lúc {adminSession.expiresAt.toDate().toLocaleTimeString('vi-VN')}</p>
                  <button type="button" disabled={attendanceBusy} onClick={() => void handleCloseAttendance()}>Đóng phiên</button>
                </div>
                {qrDataUrl && <img src={qrDataUrl} alt="QR challenge điểm danh" />}
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
                {!openSessions.length ? <p>Hiện chưa có phiên điểm danh nào.</p> : (
                  <div className="session-list">
                    {openSessions.map((session) => (
                      <button className="session-item" type="button" key={session.id} onClick={() => void startQrScanner(session)}>
                        <strong>{session.title}</strong>
                        <span>Hết hạn {session.expiresAt.toDate().toLocaleTimeString('vi-VN')}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
            {studentStep === 'scan' && (
              <>
                <h3>Quét QR của phiên “{selectedSession?.title}”</h3>
                <video ref={videoRef} muted playsInline className={cameraStream ? 'camera-preview active' : 'camera-preview'} />
                <input
                  ref={qrImageInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  hidden
                  onChange={(event) => void handleQrImageSelected(event)}
                />
                <div className="attendance-controls">
                  <button type="button" disabled={qrImageBusy} onClick={() => qrImageInputRef.current?.click()}>
                    {qrImageBusy ? 'Đang đọc QR…' : 'Chụp / chọn ảnh QR'}
                  </button>
                  <button type="button" onClick={resetStudentFlow}>Quay lại</button>
                </div>
                <p>Trên iPhone, nút trên sẽ mở Camera hoặc Thư viện ảnh. Ảnh chỉ được xử lý trong trình duyệt để lấy challenge.</p>
              </>
            )}
            {studentStep === 'pin' && claim && (
              <>
                <h3>Nhập PIN đang hiển thị trong lớp</h3>
                <p>Claim hết hạn lúc {new Date(claim.expiresAt).toLocaleTimeString('vi-VN')}.</p>
                <input inputMode="numeric" maxLength={4} value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="0000" />
                <div className="attendance-controls">
                  <button type="button" disabled={pin.length !== 4} onClick={() => void handleOpenPhotoCamera()}>Tiếp tục chụp ảnh</button>
                  <button type="button" onClick={resetStudentFlow}>Hủy</button>
                </div>
              </>
            )}
            {studentStep === 'photo' && (
              <>
                <h3>Chụp ảnh khuôn mặt bằng camera sau</h3>
                <video ref={videoRef} muted playsInline className={cameraStream ? 'camera-preview active' : 'camera-preview'} />
                {photo && <img className="photo-preview" src={photo.previewUrl} alt="Ảnh điểm danh đã chụp" />}
                <div className="attendance-controls">
                  {cameraStream && <button type="button" onClick={() => void handleCapturePhoto()}>Chụp ảnh</button>}
                  {photo && !attendanceBusy && <button type="button" onClick={() => { URL.revokeObjectURL(photo.previewUrl); setPhoto(null); setRequestId(''); void handleOpenPhotoCamera(); }}>Chụp lại</button>}
                  <button type="button" disabled={!photo || attendanceBusy} onClick={() => void handleCheckIn()}>{attendanceBusy ? 'Đang gửi và thử lại…' : 'Gửi điểm danh'}</button>
                </div>
              </>
            )}
            {studentStep === 'done' && (
              <>
                <h3>Đã điểm danh</h3>
                <p>Ảnh đã lưu trên Google Drive và receipt được backend ghi vào Firestore.</p>
                <button type="button" onClick={resetStudentFlow}>Về danh sách</button>
              </>
            )}
            <p className="privacy-note">Ảnh chỉ dùng để hậu kiểm; MVP không thực hiện nhận diện khuôn mặt tự động.</p>
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
