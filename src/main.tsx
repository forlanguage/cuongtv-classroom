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
  recordAttendanceByPin,
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
  { title: 'Điểm danh', detail: 'QR + PIN + ảnh; có PIN-only fallback khi camera gặp sự cố.', status: 'MVP 3' },
  { title: 'Bài tập trên lớp', detail: 'Trắc nghiệm, tự luận, lưu nháp và nộp bài.', status: 'Kế hoạch' },
  { title: 'Chấm điểm', detail: 'Chấm tự động, AI gợi ý và giảng viên duyệt.', status: 'Kế hoạch' },
];

type StudentStep = 'list' | 'scan' | 'pin' | 'photo' | 'pinOnly' | 'done';
type BarcodeDetectorInstance = { detect: (source: CanvasImageSource) => Promise<Array<{ rawValue?: string }>> };
declare global { interface Window { BarcodeDetector?: new (options: { formats: string[] }) => BarcodeDetectorInstance; } }

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
    void (async () => {
      setProfile(null);
      if (!user) return;
      setLoadingProfile(true);
      try {
        const accessProfile = await loadAccessProfile(user.email);
        if (!active) return;
        if (!accessProfile) { await logout(); setMessage('Email Google này không có trong danh sách lớp IT006.Q24.'); return; }
        setProfile(accessProfile);
      } catch (error) { if (active) setMessage(error instanceof Error ? error.message : 'Không thể kiểm tra danh sách lớp.'); }
      finally { if (active) setLoadingProfile(false); }
    })();
    return () => { active = false; };
  }, [user]);
  useEffect(() => profile?.role === 'student' ? observeOpenAttendanceSessions(setOpenSessions) : undefined, [profile?.role]);
  useEffect(() => () => { stopCamera(cameraStream); if (scanTimerRef.current) clearTimeout(scanTimerRef.current); }, [cameraStream]);
  useEffect(() => adminSession ? observeAttendanceCount(adminSession.id, setAttendanceCount) : undefined, [adminSession]);
  useEffect(() => {
    if (!adminSession) return;
    let slot = adminSession.slot;
    const timer = window.setInterval(() => void (async () => {
      try {
        slot += 1;
        const next = await rotateAttendanceChallenge(adminSession.id, slot);
        const updated = { ...adminSession, ...next, slot };
        const url = new URL(window.location.origin + window.location.pathname);
        url.searchParams.set('challenge', updated.currentChallengeId);
        setQrDataUrl(await QRCode.toDataURL(url.toString(), { width: 320, margin: 2 }));
        setAdminSession(updated);
      } catch (error) { setMessage(error instanceof Error ? error.message : 'Không thể đổi challenge.'); }
    })(), QR_ROTATION_MS);
    return () => clearInterval(timer);
  }, [adminSession?.id]);

  async function waitForVideo() {
    for (let i = 0; i < 20; i += 1) { if (videoRef.current) return videoRef.current; await new Promise((r) => setTimeout(r, 25)); }
    throw new Error('Không thể khởi tạo vùng camera.');
  }
  async function handleLogin() { try { await loginWithGoogle(); } catch (e) { setMessage(e instanceof Error ? e.message : 'Không thể đăng nhập.'); } }
  async function handleOpenAttendance() {
    setAttendanceBusy(true); setMessage('');
    try {
      const session = await openAttendanceSession(attendanceTitle);
      const url = new URL(window.location.origin + window.location.pathname);
      url.searchParams.set('challenge', session.currentChallengeId);
      setQrDataUrl(await QRCode.toDataURL(url.toString(), { width: 320, margin: 2 }));
      setAdminSession(session); setAttendanceCount(0);
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Không thể mở phiên.'); }
    finally { setAttendanceBusy(false); }
  }
  async function handleCloseAttendance() {
    if (!adminSession) return;
    setAttendanceBusy(true);
    try { await closeAttendanceSession(adminSession.id); setAdminSession(null); setQrDataUrl(''); }
    catch (e) { setMessage(e instanceof Error ? e.message : 'Không thể đóng phiên.'); }
    finally { setAttendanceBusy(false); }
  }
  function resetStudentFlow() {
    stopCamera(cameraStream); if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
    if (photo) URL.revokeObjectURL(photo.previewUrl);
    setCameraStream(null); setSelectedSession(null); setClaim(null); setPin(''); setPhoto(null); setRequestId(''); setQrImageBusy(false); setStudentStep('list'); setMessage('');
  }
  async function acceptQrValue(session: AttendanceSession, value: string) {
    if (!profile) return;
    const challengeId = new URL(value).searchParams.get('challenge');
    if (!challengeId) throw new Error('QR không chứa challenge hợp lệ.');
    const issuedClaim = await claimAttendanceChallenge(session.id, challengeId, profile);
    stopCamera(cameraStream); setCameraStream(null); if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
    setClaim(issuedClaim); setStudentStep('pin'); setMessage('QR hợp lệ. Claim cá nhân có hiệu lực 3 phút.');
  }
  async function startQrScanner(session: AttendanceSession) {
    setSelectedSession(session); setStudentStep('scan'); setMessage('Quét QR, chụp ảnh QR hoặc dùng PIN-only khi camera gặp sự cố.');
    try {
      const video = await waitForVideo(); const stream = await openRearCamera(video); setCameraStream(stream);
      const Detector = window.BarcodeDetector; if (!Detector) throw new Error('Không có bộ giải mã QR.');
      const detector = new Detector({ formats: ['qr_code'] });
      const scan = async () => {
        if (!videoRef.current || !stream.active) return;
        try { const value = (await detector.detect(videoRef.current))[0]?.rawValue; if (value) { await acceptQrValue(session, value); stopCamera(stream); return; } }
        catch (e) { setMessage(e instanceof Error ? e.message : 'Không thể xác minh QR.'); }
        scanTimerRef.current = window.setTimeout(() => void scan(), 500);
      };
      void scan();
    } catch { setCameraStream(null); setMessage('Không thể mở camera. Bạn có thể dùng PIN-only.'); }
  }
  async function handleQrImageSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file || !selectedSession) return;
    setQrImageBusy(true);
    try { await acceptQrValue(selectedSession, await decodeQrFromImageFile(file)); }
    catch (e) { setMessage(e instanceof Error ? e.message : 'Không thể đọc QR từ ảnh.'); }
    finally { setQrImageBusy(false); event.target.value = ''; }
  }
  async function openPinOnly(session?: AttendanceSession | null) {
    const target = session || selectedSession; if (!target) return;
    stopCamera(cameraStream); if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
    setCameraStream(null); setSelectedSession(target); setPin(''); setStudentStep('pinOnly');
    setMessage('Chế độ dự phòng: hệ thống chỉ ghi nhận bằng PIN và đánh dấu cần hậu kiểm.');
  }
  async function submitPinOnly() {
    if (!profile || !selectedSession || pin.length !== 4) return;
    setAttendanceBusy(true);
    try {
      await recordAttendanceByPin(selectedSession.id, pin, profile);
      setStudentStep('done'); setMessage('Đã ghi nhận bằng PIN. Trạng thái này cần giảng viên hậu kiểm.');
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Không thể ghi nhận bằng PIN.'); }
    finally { setAttendanceBusy(false); }
  }
  async function handleOpenPhotoCamera() {
    if (!claim || pin.length !== 4) return;
    setStudentStep('photo');
    try { const video = await waitForVideo(); stopCamera(cameraStream); setCameraStream(await openRearCamera(video)); }
    catch { setMessage('Không thể mở camera. Bạn có thể ghi nhận bằng PIN-only.'); }
  }
  async function handleCapturePhoto() {
    if (!videoRef.current || !profile) return;
    try {
      const captured = await captureCompressedPhoto(videoRef.current, `${profile.studentId || profile.email} · IT006.Q24`);
      setPhoto(captured); setRequestId(crypto.randomUUID()); stopCamera(cameraStream); setCameraStream(null);
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Không thể chụp ảnh.'); }
  }
  async function handleCheckIn() {
    if (!profile || !claim || !photo || !requestId) return;
    setAttendanceBusy(true);
    try { await completeAttendanceClaim(claim, pin, profile, photo.blob, requestId); setStudentStep('done'); setMessage('Điểm danh đầy đủ thành công.'); }
    catch (e) { setMessage(e instanceof Error ? e.message : 'Không thể hoàn tất điểm danh.'); }
    finally { setAttendanceBusy(false); }
  }

  return <main>
    <header className="hero"><div><span className="eyebrow">IT006.Q24 · CUONGTV CLASSROOM</span><h1>Kiến trúc máy tính — học kỳ 2, năm học 2025–2026</h1><p>Điểm danh ưu tiên QR + PIN + ảnh, nhưng không chặn sinh viên khi camera gặp sự cố.</p><div className="actions">{user ? <><button onClick={() => void logout()}>Đăng xuất</button><span>{loadingProfile ? 'Đang kiểm tra…' : profile ? `${profile.fullName || profile.email} · ${profile.role === 'admin' ? 'Quản trị viên' : 'Sinh viên'}` : user.email}</span></> : <button onClick={() => void handleLogin()}>Đăng nhập bằng Google</button>}</div>{message && <p className="notice">{message}</p>}</div><aside className="status-card"><strong>Trạng thái hệ thống</strong><dl><div><dt>Lớp</dt><dd>IT006.Q24</dd></div><div><dt>QR challenge</dt><dd>60 giây</dd></div><div><dt>PIN-only</dt><dd>Đã ghi nhận</dd></div><div><dt>Firebase</dt><dd>{firebaseConfigured ? 'Đã cấu hình' : 'Chờ cấu hình'}</dd></div></dl></aside></header>

    {profile?.role === 'admin' && <section className="workflow dashboard-panel"><span className="panel-label">ADMIN DASHBOARD</span><h2>Xin chào, {profile.fullName || 'Giảng viên'}</h2><div className="attendance-box"><h3>Điểm danh QR + PIN + ảnh; PIN-only dự phòng</h3>{!adminSession ? <div className="attendance-controls"><input value={attendanceTitle} onChange={(e) => setAttendanceTitle(e.target.value)} /><button disabled={attendanceBusy} onClick={() => void handleOpenAttendance()}>Mở phiên 5 phút</button></div> : <div className="qr-panel"><div><strong>{adminSession.title}</strong><p>PIN hiện tại: <b className="pin-code">{adminSession.pin}</b></p><p>Đã ghi nhận: <b>{attendanceCount}</b></p><button onClick={() => void handleCloseAttendance()}>Đóng phiên</button></div>{qrDataUrl && <img src={qrDataUrl} alt="QR điểm danh" />}</div>}</div></section>}

    {profile?.role === 'student' && <section className="workflow dashboard-panel"><span className="panel-label">STUDENT DASHBOARD</span><h2>Xin chào, {profile.fullName || 'Sinh viên'}</h2><div className="profile-grid"><div><strong>MSSV</strong><span>{profile.studentId || 'Tài khoản thử nghiệm'}</span></div><div><strong>Lớp</strong><span>{profile.classCode}</span></div><div><strong>Email</strong><span>{profile.email}</span></div></div><div className="attendance-box camera-box">
      {studentStep === 'list' && <><h3>Phiên điểm danh đang mở</h3>{!openSessions.length ? <p>Hiện chưa có phiên điểm danh nào.</p> : <div className="session-list">{openSessions.map((session) => <div key={session.id} className="session-item"><strong>{session.title}</strong><span>Hết hạn {session.expiresAt.toDate().toLocaleTimeString('vi-VN')}</span><div className="attendance-controls"><button onClick={() => void startQrScanner(session)}>Điểm danh đầy đủ</button><button onClick={() => void openPinOnly(session)}>Chỉ nhập PIN</button></div></div>)}</div>}</>}
      {studentStep === 'scan' && <><h3>Quét QR của phiên “{selectedSession?.title}”</h3><video ref={videoRef} muted playsInline className={cameraStream ? 'camera-preview active' : 'camera-preview'} /><input ref={qrImageInputRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void handleQrImageSelected(e)} /><div className="attendance-controls"><button disabled={qrImageBusy} onClick={() => qrImageInputRef.current?.click()}>Chụp / chọn ảnh QR</button><button onClick={() => void openPinOnly()}>Không dùng được camera — nhập PIN</button><button onClick={resetStudentFlow}>Quay lại</button></div></>}
      {studentStep === 'pin' && claim && <><h3>Nhập PIN</h3><input inputMode="numeric" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="0000" /><div className="attendance-controls"><button disabled={pin.length !== 4} onClick={() => void handleOpenPhotoCamera()}>Tiếp tục chụp ảnh</button><button onClick={() => void openPinOnly()}>Bỏ qua ảnh — chỉ ghi nhận</button></div></>}
      {studentStep === 'pinOnly' && <><h3>Ghi nhận bằng PIN</h3><p>Không cần QR hoặc ảnh. Bản ghi sẽ có trạng thái “Đã ghi nhận” và cần hậu kiểm.</p><input inputMode="numeric" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="0000" /><div className="attendance-controls"><button disabled={attendanceBusy || pin.length !== 4} onClick={() => void submitPinOnly()}>{attendanceBusy ? 'Đang ghi nhận…' : 'Ghi nhận bằng PIN'}</button><button onClick={resetStudentFlow}>Hủy</button></div></>}
      {studentStep === 'photo' && <><h3>Chụp ảnh khuôn mặt</h3><video ref={videoRef} muted playsInline className={cameraStream ? 'camera-preview active' : 'camera-preview'} />{photo && <img className="photo-preview" src={photo.previewUrl} alt="Ảnh điểm danh" />}<div className="attendance-controls">{cameraStream && <button onClick={() => void handleCapturePhoto()}>Chụp ảnh</button>}<button disabled={!photo || attendanceBusy} onClick={() => void handleCheckIn()}>Gửi điểm danh</button><button onClick={() => void openPinOnly()}>Camera lỗi — chỉ ghi nhận PIN</button></div></>}
      {studentStep === 'done' && <><h3>Đã ghi nhận</h3><p>Hệ thống đã lưu kết quả. Giảng viên có thể phân biệt bản ghi đầy đủ và bản ghi PIN-only.</p><button onClick={resetStudentFlow}>Về danh sách</button></>}
      <p className="privacy-note">PIN-only không được coi là xác minh đầy đủ; bản ghi được đánh dấu cần hậu kiểm.</p>
    </div></section>}

    <section id="modules" className="modules">{modules.map((module) => <article key={module.title}><span>{module.status}</span><h2>{module.title}</h2><p>{module.detail}</p></article>)}</section>
  </main>;
}

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
