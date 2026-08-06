import { useEffect, useMemo, useRef, useState } from 'react';
import { claimAttendanceChallenge, observeOpenAttendanceSessions, type AttendanceClaim, type AttendanceSession } from '../services/attendance';
import { completeQrPinWithoutPhoto } from '../services/attendanceCompletion';
import { decodeQrFromImageFile } from '../services/camera';
import type { AccessProfile } from '../services/roster';

function challengeFromValue(value: string): string {
  try { return new URL(value).searchParams.get('challenge') || ''; }
  catch { return ''; }
}

export function QrPinNoPhotoPanel({ profile }: { profile: AccessProfile }) {
  const [sessions, setSessions] = useState<AttendanceSession[]>([]);
  const [selected, setSelected] = useState<AttendanceSession | null>(null);
  const [claim, setClaim] = useState<AttendanceClaim | null>(null);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [done, setDone] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('');
  const chooseRef = useRef<HTMLInputElement | null>(null);
  const cameraRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => observeOpenAttendanceSessions(setSessions), []);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);
  const eligible = useMemo(() => sessions.filter((session) => session.requireQr && !session.requirePhoto), [sessions]);

  async function acceptQr(value: string) {
    const challengeId = challengeFromValue(value);
    if (!challengeId) throw new Error('QR không chứa challenge hợp lệ.');
    const session = eligible.find((item) => item.currentChallengeId === challengeId);
    if (!session) throw new Error('QR không khớp phiên QR + PIN đang mở hoặc đã hết hiệu lực.');
    const nextClaim = await claimAttendanceChallenge(session.id, challengeId, profile);
    setSelected(session);
    setClaim(nextClaim);
    setMessage('QR hợp lệ. Nhập PIN để hoàn tất mà không cần ảnh.');
  }

  async function handleFile(file: File | undefined) {
    if (!file) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(file));
    setBusy(true);
    setMessage('Đang đọc mã QR từ ảnh vừa chọn…');
    try { await acceptQr(await decodeQrFromImageFile(file)); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Không thể đọc QR.'); }
    finally { setBusy(false); }
  }

  async function submit() {
    if (!claim || !selected || pin.length !== 4 || busy) return;
    setBusy(true);
    try {
      const result = await completeQrPinWithoutPhoto(claim, pin, profile, crypto.randomUUID());
      setDone(true);
      setMessage(result.alreadyRecorded ? 'Bản ghi đã tồn tại; không tạo bản ghi trùng.' : 'Đã điểm danh bằng QR + PIN, không yêu cầu ảnh.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể hoàn tất QR + PIN.');
    } finally { setBusy(false); }
  }

  if (!eligible.length) return null;

  return <section className="workflow dashboard-panel qr-no-photo-panel">
    <span className="panel-label">QR + PIN</span>
    <h2>Điểm danh QR + PIN không ảnh</h2>
    {!claim && <>
      <p>Chọn ảnh QR có sẵn hoặc chụp ảnh mới. Ảnh sẽ được xem trước trước khi chuyển sang nhập PIN.</p>
      <input ref={chooseRef} type="file" accept="image/*" hidden onChange={(event) => { void handleFile(event.target.files?.[0]); event.target.value = ''; }} />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(event) => { void handleFile(event.target.files?.[0]); event.target.value = ''; }} />
      <div className="attendance-controls">
        <button disabled={busy} onClick={() => chooseRef.current?.click()}>Chọn ảnh QR</button>
        <button disabled={busy} className="secondary-button" onClick={() => cameraRef.current?.click()}>Chụp ảnh QR</button>
      </div>
      {previewUrl && <figure className="qr-image-preview-card"><img className="photo-preview qr-image-preview" src={previewUrl} alt="Ảnh QR vừa chọn" /><figcaption>{busy ? 'Đang nhận dạng QR…' : 'Ảnh QR vừa chọn. Có thể chọn hoặc chụp lại nếu mã chưa rõ.'}</figcaption></figure>}
    </>}
    {claim && !done && <div className="qr-no-photo-form">
      <strong>{selected?.title}</strong>
      <input inputMode="numeric" maxLength={4} value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="0000" aria-label="PIN điểm danh" />
      <button disabled={busy || pin.length !== 4} onClick={() => void submit()}>{busy ? 'Đang xác minh…' : 'Hoàn tất QR + PIN'}</button>
    </div>}
    {done && <p><b>Verification mode:</b> qr_pin_no_photo · <b>Evidence:</b> QR đã xác minh, không ảnh.</p>}
    {message && <p className="notice">{message}</p>}
  </section>;
}
