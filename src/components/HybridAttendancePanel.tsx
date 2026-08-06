import { useEffect, useMemo, useState } from 'react';
import { observeOpenAttendanceSessions, type AttendanceSession } from '../services/attendance';
import type { AccessProfile } from '../services/roster';
import {
  compressEvidence,
  startHybridAttendance,
  submitHybridAttendance,
  type HybridEvidenceToken,
} from '../services/hybridAttendance';
import '../hybrid-attendance.css';

type EvidenceFile = { blob: Blob; previewUrl: string };
type Step = 'select' | 'pin' | 'evidence' | 'done';

function challengeFromLocation(): string {
  return new URL(window.location.href).searchParams.get('challenge') || '';
}

function evidenceFromFile(file: File): Promise<EvidenceFile> {
  return compressEvidence(file).then((blob) => ({ blob, previewUrl: URL.createObjectURL(blob) }));
}

export function HybridAttendancePanel({ profile }: { profile: AccessProfile }) {
  const [sessions, setSessions] = useState<AttendanceSession[]>([]);
  const [selected, setSelected] = useState<AttendanceSession | null>(null);
  const [redirectChallenge, setRedirectChallenge] = useState(challengeFromLocation());
  const [pin, setPin] = useState('');
  const [token, setToken] = useState<HybridEvidenceToken | null>(null);
  const [qrEvidence, setQrEvidence] = useState<EvidenceFile | null>(null);
  const [faceEvidence, setFaceEvidence] = useState<EvidenceFile | null>(null);
  const [noCameraReason, setNoCameraReason] = useState('');
  const [step, setStep] = useState<Step>('select');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [requestId, setRequestId] = useState(crypto.randomUUID());

  useEffect(() => observeOpenAttendanceSessions(setSessions), []);

  const redirectSession = useMemo(() => redirectChallenge
    ? sessions.find((session) => session.currentChallengeId === redirectChallenge) || null
    : null, [redirectChallenge, sessions]);

  useEffect(() => {
    if (!redirectChallenge || !sessions.length) return;
    if (redirectSession) {
      setSelected(redirectSession);
      setStep('pin');
      setMessage('QR redirect đã khớp phiên đang mở. Nhập PIN để tiếp tục.');
    } else {
      setMessage('QR đã hết hạn hoặc không khớp phiên đang mở. Hãy chọn phiên và dùng luồng fallback.');
      setRedirectChallenge('');
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [redirectChallenge, redirectSession, sessions.length]);

  function chooseSession(session: AttendanceSession) {
    setSelected(session);
    setRedirectChallenge('');
    setPin('');
    setToken(null);
    setStep('pin');
    setMessage('Nhập PIN của phiên. Sau đó hệ thống sẽ yêu cầu evidence phù hợp.');
  }

  async function confirmPin() {
    if (!selected || pin.length !== 4) return;
    setBusy(true);
    setMessage('Đang xác nhận PIN…');
    try {
      const nextToken = await startHybridAttendance(selected, pin, profile, redirectChallenge || undefined);
      setToken(nextToken);
      setStep('evidence');
      setMessage(nextToken.qrVerified
        ? 'PIN và QR redirect hợp lệ. Chỉ cần chụp/chọn FACE.'
        : 'PIN hợp lệ. Chụp/chọn ảnh QR và FACE để gửi hậu kiểm.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể xác nhận PIN.');
    } finally {
      setBusy(false);
    }
  }

  async function handleEvidence(kind: 'qr' | 'face', file?: File) {
    if (!file) return;
    setBusy(true);
    try {
      const next = await evidenceFromFile(file);
      if (kind === 'qr') {
        if (qrEvidence) URL.revokeObjectURL(qrEvidence.previewUrl);
        setQrEvidence(next);
      } else {
        if (faceEvidence) URL.revokeObjectURL(faceEvidence.previewUrl);
        setFaceEvidence(next);
      }
      setMessage('Ảnh đã sẵn sàng. Có thể chụp/chọn lại trước khi gửi.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể xử lý ảnh.');
    } finally {
      setBusy(false);
    }
  }

  async function submit(noCamera = false) {
    if (!token || !selected) return;
    if (!noCamera && !faceEvidence) {
      setMessage('Cần ảnh FACE trước khi gửi.');
      return;
    }
    if (!token.qrVerified && !noCamera && !qrEvidence) {
      setMessage('Cần ảnh QR evidence trước khi gửi.');
      return;
    }
    if (noCamera && !noCameraReason.trim()) {
      setMessage('Hãy chọn lý do không thể sử dụng camera.');
      return;
    }
    setBusy(true);
    setMessage('Đang tải evidence và tạo bản ghi chờ hậu kiểm…');
    try {
      const result = await submitHybridAttendance(token, profile, {
        qrImage: noCamera ? null : qrEvidence?.blob,
        faceImage: noCamera ? null : faceEvidence?.blob,
        noCameraReason: noCamera ? noCameraReason : '',
        requestId,
      });
      setStep('done');
      setMessage(`Đã ghi nhận (${result.verificationMode}). Kết quả đang chờ giảng viên duyệt.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể gửi evidence.');
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    if (qrEvidence) URL.revokeObjectURL(qrEvidence.previewUrl);
    if (faceEvidence) URL.revokeObjectURL(faceEvidence.previewUrl);
    setSelected(null);
    setToken(null);
    setQrEvidence(null);
    setFaceEvidence(null);
    setNoCameraReason('');
    setPin('');
    setRedirectChallenge('');
    setRequestId(crypto.randomUUID());
    setStep('select');
    setMessage('');
    window.history.replaceState({}, '', window.location.pathname);
  }

  return <section className="workflow dashboard-panel hybrid-attendance-panel">
    <span className="panel-label">ATTENDANCE · HYBRID FLOW</span>
    <h2>Điểm danh</h2>

    {step === 'select' && <>
      <p>Quét QR bằng Camera/app QR để vào đúng phiên, hoặc chọn phiên bên dưới.</p>
      {!sessions.length ? <p>Hiện chưa có phiên điểm danh đang mở.</p> : <div className="hybrid-session-list">
        {sessions.map((session) => <button key={session.id} onClick={() => chooseSession(session)}>
          <strong>{session.title}</strong><span>{session.requirePhoto ? 'Phiên đầy đủ' : session.requireQr ? 'QR + PIN' : 'PIN-only'}</span>
        </button>)}
      </div>}
    </>}

    {step === 'pin' && selected && <>
      <h3>{selected.title}</h3>
      <p>{redirectChallenge ? 'QR redirect đã được nhận; backend sẽ xác minh cùng PIN.' : 'Luồng fallback: nhập PIN trước, evidence được gửi sau.'}</p>
      <input inputMode="numeric" maxLength={4} value={pin}
        onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 4))}
        placeholder="0000" aria-label="PIN điểm danh" />
      <div className="attendance-controls">
        <button disabled={busy || pin.length !== 4} onClick={() => void confirmPin()}>{busy ? 'Đang xác nhận…' : 'Xác nhận PIN'}</button>
        <button onClick={reset}>Quay lại</button>
      </div>
    </>}

    {step === 'evidence' && token && <>
      <h3>{token.sessionTitle}</h3>
      <p className="hybrid-verification-badge">QR: {token.qrVerified ? 'đã xác minh qua redirect' : 'cần ảnh evidence'}</p>
      {!token.qrVerified && <EvidencePicker label="Ảnh QR" value={qrEvidence} busy={busy} onFile={(file) => void handleEvidence('qr', file)} />}
      <EvidencePicker label="Ảnh FACE" value={faceEvidence} busy={busy} face onFile={(file) => void handleEvidence('face', file)} />
      <div className="attendance-controls">
        <button disabled={busy || !faceEvidence || (!token.qrVerified && !qrEvidence)} onClick={() => void submit(false)}>
          {busy ? 'Đang gửi…' : 'Gửi và chờ hậu kiểm'}
        </button>
      </div>
      <details className="no-camera-fallback">
        <summary>Thiết bị không có camera hoặc camera không hoạt động</summary>
        <select value={noCameraReason} onChange={(event) => setNoCameraReason(event.target.value)}>
          <option value="">Chọn lý do</option>
          <option value="device_without_camera">Thiết bị không có camera</option>
          <option value="camera_permission_denied">Không cấp được quyền camera</option>
          <option value="camera_failure">Camera bị lỗi</option>
          <option value="other">Lý do khác</option>
        </select>
        <p>Yêu cầu này chỉ tạo bản ghi chờ hậu kiểm, không tự động tính có mặt.</p>
        <button disabled={busy || !noCameraReason} onClick={() => void submit(true)}>Gửi yêu cầu không camera</button>
      </details>
    </>}

    {step === 'done' && <>
      <h3>Đã ghi nhận</h3>
      <p>Bản ghi đang ở trạng thái <b>Đã ghi nhận · Cần hậu kiểm</b>.</p>
      <button onClick={reset}>Về danh sách phiên</button>
    </>}
    {message && <p className="notice">{message}</p>}
  </section>;
}

function EvidencePicker({ label, value, busy, face = false, onFile }: {
  label: string;
  value: EvidenceFile | null;
  busy: boolean;
  face?: boolean;
  onFile: (file?: File) => void;
}) {
  return <div className="hybrid-evidence-picker">
    <strong>{label}</strong>
    <p>{face ? 'Chụp rõ khuôn mặt hoặc chọn ảnh vừa chụp.' : 'Chụp toàn bộ mã QR, tránh lóa và mất góc.'}</p>
    <div className="attendance-controls">
      <label className="file-action">Chọn ảnh<input type="file" accept="image/*" hidden disabled={busy}
        onChange={(event) => { onFile(event.target.files?.[0]); event.target.value = ''; }} /></label>
      <label className="file-action">Chụp ảnh<input type="file" accept="image/*" capture={face ? 'user' : 'environment'} hidden disabled={busy}
        onChange={(event) => { onFile(event.target.files?.[0]); event.target.value = ''; }} /></label>
    </div>
    {value && <img className="hybrid-evidence-preview" src={value.previewUrl} alt={`Preview ${label}`} />}
  </div>;
}
