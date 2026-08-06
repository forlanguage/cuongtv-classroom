import { useEffect, useState } from 'react';
import { observeOpenAttendanceSessions, recordAttendanceByPin, type AttendanceSession, type PinAttendanceReceipt } from '../services/attendance';
import type { AccessProfile } from '../services/roster';

export function AttendanceFallbackPanel({ profile }: { profile: AccessProfile }) {
  const [sessions, setSessions] = useState<AttendanceSession[]>([]);
  const [selected, setSelected] = useState<AttendanceSession | null>(null);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [receipt, setReceipt] = useState<PinAttendanceReceipt | null>(null);

  useEffect(() => observeOpenAttendanceSessions(setSessions), []);

  async function submit() {
    if (!selected || pin.length !== 4 || busy) return;
    setBusy(true);
    setMessage('Đang ghi nhận phương thức dự phòng…');
    try {
      const result = await recordAttendanceByPin(selected, pin, profile);
      setReceipt(result);
      setMessage(result.alreadyRecorded
        ? 'Bản ghi đã tồn tại; hệ thống hiển thị biên nhận gốc.'
        : 'Đã ghi nhận bằng PIN-only. Giảng viên sẽ hậu kiểm bản ghi này.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể ghi nhận bằng phương thức dự phòng.');
    } finally {
      setBusy(false);
    }
  }

  function choose(session: AttendanceSession) {
    setSelected(session);
    setPin('');
    setReceipt(null);
    setMessage('Dùng khi QR hoặc camera không hoạt động. Bản ghi sẽ được đánh dấu cần hậu kiểm.');
  }

  if (!sessions.length) return null;

  return <section className="workflow dashboard-panel fallback-panel">
    <span className="panel-label">NON-BLOCKING FALLBACK</span>
    <h2>Điểm danh dự phòng</h2>
    <p>QR hoặc camera lỗi không chặn sinh viên. Phương thức này chỉ tạo bản ghi <b>PIN-only</b>, evidence hạn chế và cần giảng viên hậu kiểm.</p>

    {!selected && <div className="fallback-session-list">{sessions.map((session) => <button key={session.id} type="button" onClick={() => choose(session)}>
      <strong>{session.title}</strong>
      <span>PIN-only fallback · hết hạn {session.expiresAt.toDate().toLocaleTimeString('vi-VN')}</span>
    </button>)}</div>}

    {selected && !receipt && <div className="fallback-form">
      <div><strong>{selected.title}</strong><span>Verification mode: pin_only · reviewStatus: needs_review</span></div>
      <input inputMode="numeric" maxLength={4} value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="0000" aria-label="PIN điểm danh" />
      <div className="attendance-controls">
        <button disabled={busy || pin.length !== 4} onClick={() => void submit()}>{busy ? 'Đang ghi nhận…' : 'Ghi nhận dự phòng'}</button>
        <button disabled={busy} onClick={() => { setSelected(null); setMessage(''); }}>Hủy</button>
      </div>
    </div>}

    {receipt && <div className="fallback-receipt">
      <h3>{receipt.statusLabel}</h3>
      <p><b>Phiên:</b> {receipt.sessionTitle}</p>
      <p><b>Thời gian:</b> {receipt.checkedInAt ? receipt.checkedInAt.toDate().toLocaleString('vi-VN') : 'Đang đồng bộ thời gian máy chủ'}</p>
      <p><b>Evidence:</b> PIN-only · hạn chế · cần hậu kiểm</p>
      <button onClick={() => { setSelected(null); setReceipt(null); setPin(''); setMessage(''); }}>Đóng biên nhận</button>
    </div>}

    {message && <p className="notice">{message}</p>}
  </section>;
}
