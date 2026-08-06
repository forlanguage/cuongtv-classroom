import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import type { User } from 'firebase/auth';
import QRCode from 'qrcode';
import './styles.css';
import { firebaseConfigured } from './services/firebase';
import { loginWithGoogle, logout, observeAuth } from './services/auth';
import { loadAccessProfile, type AccessProfile } from './services/roster';
import {
  ATTENDANCE_POLICY_PRESETS,
  QR_ROTATION_MS,
  claimAttendanceChallenge,
  closeAttendanceSession,
  completeAttendanceClaim,
  observeAttendanceCount,
  observeOpenAttendanceSessions,
  openAttendanceSession,
  recordAttendanceByPin,
  recoverActiveAttendanceSession,
  rotateAttendanceChallenge,
  type AttendanceAdminState,
  type AttendanceClaim,
  type AttendancePolicyPresetId,
  type AttendanceSession,
  type PinAttendanceReceipt,
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
  { title: 'Điểm danh', detail: 'Chính sách theo phiên: PIN-only, QR + PIN hoặc QR + PIN + ảnh.', status: 'MVP 4' },
  { title: 'Bài tập trên lớp', detail: 'Trắc nghiệm, tự luận, lưu nháp và nộp bài.', status: 'Kế hoạch' },
  { title: 'Chấm điểm', detail: 'Chấm tự động, AI gợi ý và giảng viên duyệt.', status: 'Kế hoạch' },
];

const policyIds = Object.keys(ATTENDANCE_POLICY_PRESETS) as AttendancePolicyPresetId[];

type StudentStep = 'list' | 'scan' | 'pin' | 'photo' | 'pinOnly' | 'done';
type BarcodeDetectorInstance = { detect: (source: CanvasImageSource) => Promise<Array<{ rawValue?: string }>> };
declare global { interface Window { BarcodeDetector?: new (options: { formats: string[] }) => BarcodeDetectorInstance; } }

async function qrForChallenge(challengeId: string): Promise<string> {
  const url = new URL(window.location.origin + window.location.pathname);
  url.searchParams.set('challenge', challengeId);
  return QRCode.toDataURL(url.toString(), { width: 320, margin: 2 });
}

function policySummary(session: AttendanceSession): string {
  if (!session.requireQr) return 'PIN-only';
  return session.requirePhoto ? 'QR + PIN + ảnh' : 'QR + PIN';
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<AccessProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [message, setMessage] = useState('');
  const [attendanceTitle, setAttendanceTitle] = useState('Điểm danh trên lớp');
  const [policyPreset, setPolicyPreset] = useState<AttendancePolicyPresetId>('pin_only');
  const [durationMinutes, setDurationMinutes] = useState(5);
  const [lateGraceMinutes, setLateGraceMinutes] = useState(2);
  const [adminSession, setAdminSession] = useState<AttendanceAdminState | null>(null);
  const [adminRecovering, setAdminRecovering] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [attendanceCount, setAttendanceCount] = useState(0);
  const [attendanceBusy, setAttendanceBusy] = useState(false);
  const [openSessions, setOpenSessions] = useState<AttendanceSession[]>([]);
  const [selectedSession, setSelectedSession] = useState<AttendanceSession | null>(null);
  const [claim, setClaim] = useState<AttendanceClaim | null>(null);
  const [pinReceipt, setPinReceipt] = useState<PinAttendanceReceipt | null>(null);
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
      setAdminSession(null);
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
    })();
    return () => { active = false; };
  }, [user]);

  useEffect(() => profile?.role === 'student' ? observeOpenAttendanceSessions(setOpenSessions) : undefined, [profile?.role]);
  useEffect(() => {
    if (profile?.role !== 'admin') return;
    let active = true;
    setAdminRecovering(true);
    void (async () => {
      try {
        const recovered = await recoverActiveAttendanceSession();
        if (!active || !recovered) return;
        setAdminSession(recovered);
        setAttendanceTitle(recovered.title);
        setPolicyPreset(recovered.policyPreset);
        setDurationMinutes(recovered.durationMinutes);
        setLateGraceMinutes(recovered.lateGraceMinutes);
        setQrDataUrl(recovered.requireQr ? await qrForChallenge(recovered.currentChallengeId) : '');
        setMessage(`Đã khôi phục phiên “${recovered.title}” sau khi tải lại trang.`);
      } catch (error) {
        if (active) setMessage(error instanceof Error ? error.message : 'Không thể khôi phục phiên điểm danh.');
      } finally {
        if (active) setAdminRecovering(false);
      }
    })();
    return () => { active = false; };
  }, [profile?.role]);

  useEffect(() => () => {
    stopCamera(cameraStream);
    if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
  }, [cameraStream]);
  useEffect(() => adminSession ? observeAttendanceCount(adminSession.id, setAttendanceCount) : undefined, [adminSession?.id]);
  useEffect(() => {
    if (!adminSession) { setRemainingSeconds(0); return; }
    const update = () => {
      const remaining = Math.max(0, Math.ceil((adminSession.expiresAt.toMillis() - Date.now()) / 1000));
      setRemainingSeconds(remaining);
      if (remaining === 0) {
        setAdminSession(null);
        setQrDataUrl('');
        setMessage('Phiên điểm danh đã hết hạn.');
      }
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [adminSession?.id, adminSession?.expiresAt]);
  useEffect(() => {
    if (!adminSession?.requireQr) return;
    let slot = adminSession.slot;
    const timer = window.setInterval(() => void (async () => {
      try {
        if (adminSession.expiresAt.toMillis() <= Date.now()) return;
        slot += 1;
        const next = await rotateAttendanceChallenge(adminSession.id, slot);
        const updated = { ...adminSession, ...next, slot };
        setQrDataUrl(await qrForChallenge(updated.currentChallengeId));
        setAdminSession(updated);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Không thể đổi challenge.');
      }
    })(), QR_ROTATION_MS);
    return () => clearInterval(timer);
  }, [adminSession?.id, adminSession?.requireQr]);

  function handlePresetChange(nextId: AttendancePolicyPresetId) {
    const preset = ATTENDANCE_POLICY_PRESETS[nextId];
    setPolicyPreset(nextId);
    setDurationMinutes(preset.durationMinutes);
    setLateGraceMinutes(preset.lateGraceMinutes);
  }

  async function waitForVideo() {
    for (let i = 0; i < 20; i += 1) {
      if (videoRef.current) return videoRef.current;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('Không thể khởi tạo vùng camera.');
  }

  async function handleLogin() {
    try { await loginWithGoogle(); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Không thể đăng nhập.'); }
  }

  async function handleOpenAttendance() {
    setAttendanceBusy(true);
    setMessage('');
    try {
      const session = await openAttendanceSession(attendanceTitle, policyPreset, { durationMinutes, lateGraceMinutes });
      setQrDataUrl(session.requireQr ? await qrForChallenge(session.currentChallengeId) : '');
      setAdminSession(session);
      setAttendanceCount(0);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể mở phiên.');
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
      setRemainingSeconds(0);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể đóng phiên.');
    } finally {
      setAttendanceBusy(false);
    }
  }

  function resetStudentFlow() {
    stopCamera(cameraStream);
    if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
    if (photo) URL.revokeObjectURL(photo.previewUrl);
    setCameraStream(null);
    setSelectedSession(null);
    setClaim(null);
    setPinReceipt(null);
    setPin('');
    setPhoto(null);
    setRequestId('');
    setQrImageBusy(false);
    setStudentStep('list');
    setMessage('');
  }

  async function acceptQrValue(session: AttendanceSession, value: string) {
    if (!profile) return;
    const challengeId = new URL(value).searchParams.get('challenge');
    if (!challengeId) throw new Error('QR không chứa challenge hợp lệ.');
    const issuedClaim = await claimAttendanceChallenge(session.id, challengeId, profile);
    stopCamera(cameraStream);
    setCameraStream(null);
    if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
    setClaim(issuedClaim);
    setStudentStep('pin');
    setMessage('QR hợp lệ. Claim cá nhân có hiệu lực 3 phút.');
  }

  async function startQrScanner(session: AttendanceSession) {
    setSelectedSession(session);
    setStudentStep('scan');
    setMessage('Quét QR hoặc chụp ảnh QR của phiên điểm danh.');
    try {
      const video = await waitForVideo();
      const stream = await openRearCamera(video);
      setCameraStream(stream);
      const Detector = window.BarcodeDetector;
      if (!Detector) throw new Error('Không có bộ giải mã QR.');
      const detector = new Detector({ formats: ['qr_code'] });
      const scan = async () => {
        if (!videoRef.current || !stream.active) return;
        try {
          const value = (await detector.detect(videoRef.current))[0]?.rawValue;
          if (value) { await acceptQrValue(session, value); stopCamera(stream); return; }
        } catch (error) {
          setMessage(error instanceof Error ? error.message : 'Không thể xác minh QR.');
        }
        scanTimerRef.current = window.setTimeout(() => void scan(), 500);
      };
      void scan();
    } catch {
      setCameraStream(null);
      setMessage(session.allowPinOnly
        ? 'Không thể mở camera. Phiên này cho phép chuyển sang PIN-only.'
        : 'Không thể mở camera. Phiên này bắt buộc QR; hãy dùng chức năng chọn ảnh QR.');
    }
  }

  async function handleQrImageSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !selectedSession) return;
    setQrImageBusy(true);
    try { await acceptQrValue(selectedSession, await decodeQrFromImageFile(file)); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Không thể đọc QR từ ảnh.'); }
    finally { setQrImageBusy(false); event.target.value = ''; }
  }

  async function openPinOnly(session?: AttendanceSession | null) {
    const target = session || selectedSession;
    if (!target) return;
    if (!target.allowPinOnly) {
      setMessage('Chính sách của phiên này không cho phép PIN-only.');
      return;
    }
    stopCamera(cameraStream);
    if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
    setCameraStream(null);
    setSelectedSession(target);
    setPinReceipt(null);
    setPin('');
    setStudentStep('pinOnly');
    setMessage('Phiên cho phép PIN-only; bản ghi sẽ cần giảng viên hậu kiểm.');
  }

  async function submitPinOnly() {
    if (!profile || !selectedSession || pin.length !== 4) return;
    setAttendanceBusy(true);
    setMessage('Đang xác minh PIN và ghi nhận…');
    try {
      const receipt = await recordAttendanceByPin(selectedSession, pin, profile);
      setPinReceipt(receipt);
      setStudentStep('done');
      setMessage(receipt.alreadyRecorded
        ? 'Bạn đã được ghi nhận trước đó. Hệ thống đang hiển thị biên nhận gốc.'
        : 'Đã ghi nhận bằng PIN. Trạng thái này cần giảng viên hậu kiểm.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể ghi nhận bằng PIN.');
    } finally {
      setAttendanceBusy(false);
    }
  }

  async function handleOpenPhotoCamera() {
    if (!claim || pin.length !== 4) return;
    setStudentStep('photo');
    try {
      const video = await waitForVideo();
      stopCamera(cameraStream);
      setCameraStream(await openRearCamera(video));
    } catch {
      setMessage(selectedSession?.allowPinOnly
        ? 'Không thể mở camera. Phiên này cho phép chuyển sang PIN-only.'
        : 'Không thể mở camera. Chính sách phiên yêu cầu ảnh điểm danh.');
    }
  }

  async function handleCapturePhoto() {
    if (!videoRef.current || !profile) return;
    try {
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
    try {
      await completeAttendanceClaim(claim, pin, profile, photo.blob, requestId);
      setPinReceipt(null);
      setStudentStep('done');
      setMessage('Điểm danh đầy đủ thành công.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể hoàn tất điểm danh.');
    } finally {
      setAttendanceBusy(false);
    }
  }

  const selectedPolicy = ATTENDANCE_POLICY_PRESETS[policyPreset];

  return <main>
    <header className="hero"><div><span className="eyebrow">IT006.Q24 · CUONGTV CLASSROOM</span><h1>Kiến trúc máy tính — học kỳ 2, năm học 2025–2026</h1><p>Mỗi phiên điểm danh có chính sách xác minh riêng, thời lượng và khoảng gia hạn rõ ràng.</p><div className="actions">{user ? <><button onClick={() => void logout()}>Đăng xuất</button><span>{loadingProfile ? 'Đang kiểm tra…' : profile ? `${profile.fullName || profile.email} · ${profile.role === 'admin' ? 'Quản trị viên' : 'Sinh viên'}` : user.email}</span></> : <button onClick={() => void handleLogin()}>Đăng nhập bằng Google</button>}</div>{message && <p className="notice">{message}</p>}</div><aside className="status-card"><strong>Trạng thái hệ thống</strong><dl><div><dt>Lớp</dt><dd>IT006.Q24</dd></div><div><dt>QR challenge</dt><dd>60 giây</dd></div><div><dt>Policy preset</dt><dd>Đã cấu hình</dd></div><div><dt>Firebase</dt><dd>{firebaseConfigured ? 'Đã cấu hình' : 'Chờ cấu hình'}</dd></div></dl></aside></header>

    {profile?.role === 'admin' && <section className="workflow dashboard-panel"><span className="panel-label">ADMIN DASHBOARD</span><h2>Xin chào, {profile.fullName || 'Giảng viên'}</h2><div className="attendance-box"><h3>Thiết lập chính sách điểm danh</h3>{adminRecovering ? <p>Đang kiểm tra phiên điểm danh đang mở…</p> : !adminSession ? <div className="policy-builder">
      <label>Tên phiên<input value={attendanceTitle} onChange={(event) => setAttendanceTitle(event.target.value)} /></label>
      <div className="policy-presets">{policyIds.map((id) => {
        const preset = ATTENDANCE_POLICY_PRESETS[id];
        return <button type="button" key={id} className={policyPreset === id ? 'policy-card active' : 'policy-card'} onClick={() => handlePresetChange(id)}><strong>{preset.label}</strong><span>{preset.description}</span></button>;
      })}</div>
      <div className="policy-fields"><label>Thời lượng (phút)<input type="number" min={1} max={180} value={durationMinutes} onChange={(event) => setDurationMinutes(Number(event.target.value))} /></label><label>Gia hạn muộn (phút)<input type="number" min={0} max={30} value={lateGraceMinutes} onChange={(event) => setLateGraceMinutes(Number(event.target.value))} /></label></div>
      <div className="policy-summary"><b>{selectedPolicy.label}</b><span>QR: {selectedPolicy.requireQr ? 'bắt buộc' : 'không yêu cầu'}</span><span>Ảnh: {selectedPolicy.requirePhoto ? 'bắt buộc' : 'không yêu cầu'}</span><span>PIN-only: {selectedPolicy.allowPinOnly ? 'cho phép' : 'không cho phép'}</span></div>
      <button disabled={attendanceBusy} onClick={() => void handleOpenAttendance()}>Mở phiên {durationMinutes + lateGraceMinutes} phút</button>
    </div> : <div className={adminSession.requireQr ? 'qr-panel' : 'qr-panel pin-session'}><div><strong>{adminSession.title}</strong><p>Chính sách: <b>{policySummary(adminSession)}</b></p><p>PIN hiện tại: <b className="pin-code">{adminSession.pin}</b></p><p>Thời lượng: <b>{adminSession.durationMinutes} phút</b> · gia hạn <b>{adminSession.lateGraceMinutes} phút</b></p><p>Còn lại: <b>{Math.floor(remainingSeconds / 60)}:{String(remainingSeconds % 60).padStart(2, '0')}</b></p><p>Đã ghi nhận: <b>{attendanceCount}</b></p><button disabled={attendanceBusy} onClick={() => void handleCloseAttendance()}>Đóng phiên</button></div>{adminSession.requireQr && qrDataUrl && <img src={qrDataUrl} alt="QR điểm danh" />}</div>}</div></section>}

    {profile?.role === 'student' && <section className="workflow dashboard-panel"><span className="panel-label">STUDENT DASHBOARD</span><h2>Xin chào, {profile.fullName || 'Sinh viên'}</h2><div className="profile-grid"><div><strong>MSSV</strong><span>{profile.studentId || 'Tài khoản thử nghiệm'}</span></div><div><strong>Lớp</strong><span>{profile.classCode}</span></div><div><strong>Email</strong><span>{profile.email}</span></div></div><div className="attendance-box camera-box">
      {studentStep === 'list' && <><h3>Phiên điểm danh đang mở</h3>{!openSessions.length ? <p>Hiện chưa có phiên điểm danh nào.</p> : <div className="session-list">{openSessions.map((session) => <div key={session.id} className="session-item"><div><strong>{session.title}</strong><small>{policySummary(session)} · {session.durationMinutes} phút + {session.lateGraceMinutes} phút gia hạn</small></div><span>Hết hạn {session.expiresAt.toDate().toLocaleTimeString('vi-VN')}</span><div className="attendance-controls">{session.requireQr && <button onClick={() => void startQrScanner(session)}>Bắt đầu {policySummary(session)}</button>}{session.allowPinOnly && <button onClick={() => void openPinOnly(session)}>Nhập PIN</button>}</div></div>)}</div>}</>}
      {studentStep === 'scan' && <><h3>Quét QR của phiên “{selectedSession?.title}”</h3><video ref={videoRef} muted playsInline className={cameraStream ? 'camera-preview active' : 'camera-preview'} /><input ref={qrImageInputRef} type="file" accept="image/*" capture="environment" hidden onChange={(event) => void handleQrImageSelected(event)} /><div className="attendance-controls"><button disabled={qrImageBusy} onClick={() => qrImageInputRef.current?.click()}>Chụp / chọn ảnh QR</button>{selectedSession?.allowPinOnly && <button onClick={() => void openPinOnly()}>Chuyển sang PIN-only</button>}<button onClick={resetStudentFlow}>Quay lại</button></div></>}
      {studentStep === 'pin' && claim && <><h3>Nhập PIN</h3><input inputMode="numeric" maxLength={4} value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="0000" /><div className="attendance-controls"><button disabled={pin.length !== 4} onClick={() => void handleOpenPhotoCamera()}>{selectedSession?.requirePhoto ? 'Tiếp tục chụp ảnh' : 'Tiếp tục xác minh'}</button>{selectedSession?.allowPinOnly && <button onClick={() => void openPinOnly()}>Chuyển sang PIN-only</button>}</div>{selectedSession && !selectedSession.requirePhoto && <p className="privacy-note">Preset QR + PIN đã được lưu theo phiên; cổng evidence hiện tiếp tục dùng bước camera cho đến khi flow không ảnh được hoàn tất.</p>}</>}
      {studentStep === 'pinOnly' && <><h3>Ghi nhận bằng PIN</h3><p>Không cần QR hoặc ảnh. Bản ghi sẽ có trạng thái “Đã ghi nhận” và cần hậu kiểm.</p><input inputMode="numeric" maxLength={4} value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="0000" /><div className="attendance-controls"><button disabled={attendanceBusy || pin.length !== 4} onClick={() => void submitPinOnly()}>{attendanceBusy ? 'Đang ghi nhận…' : 'Ghi nhận bằng PIN'}</button><button onClick={resetStudentFlow}>Hủy</button></div></>}
      {studentStep === 'photo' && <><h3>Chụp ảnh khuôn mặt</h3><video ref={videoRef} muted playsInline className={cameraStream ? 'camera-preview active' : 'camera-preview'} />{photo && <img className="photo-preview" src={photo.previewUrl} alt="Ảnh điểm danh" />}<div className="attendance-controls">{cameraStream && <button onClick={() => void handleCapturePhoto()}>Chụp ảnh</button>}<button disabled={!photo || attendanceBusy} onClick={() => void handleCheckIn()}>Gửi điểm danh</button>{selectedSession?.allowPinOnly && <button onClick={() => void openPinOnly()}>Chuyển sang PIN-only</button>}</div></>}
      {studentStep === 'done' && <>{pinReceipt ? <><h3>{pinReceipt.statusLabel}</h3><div className="profile-grid"><div><strong>Phiên</strong><span>{pinReceipt.sessionTitle}</span></div><div><strong>Thời gian</strong><span>{pinReceipt.checkedInAt ? pinReceipt.checkedInAt.toDate().toLocaleString('vi-VN') : 'Đang đồng bộ thời gian máy chủ'}</span></div><div><strong>Xác minh</strong><span>PIN-only · cần hậu kiểm</span></div></div>{pinReceipt.alreadyRecorded && <p>Bạn đã gửi trước đó; đây là biên nhận ban đầu, không tạo thêm bản ghi.</p>}</> : <><h3>Đã điểm danh</h3><p>Hệ thống đã lưu kết quả điểm danh đầy đủ.</p></>}<button onClick={resetStudentFlow}>Về danh sách</button></>}
      <p className="privacy-note">Phương thức điểm danh khả dụng được quyết định bởi policy của từng phiên.</p>
    </div></section>}

    <section id="modules" className="modules">{modules.map((module) => <article key={module.title}><span>{module.status}</span><h2>{module.title}</h2><p>{module.detail}</p></article>)}</section>
  </main>;
}

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
