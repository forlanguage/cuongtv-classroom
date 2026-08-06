import { auth } from './firebase';
import { ACTIVE_COURSE_ID, type AccessProfile } from './roster';
import type { AttendanceClaim } from './attendance';

const appsScriptUrl = import.meta.env.VITE_APPS_SCRIPT_URL as string | undefined;

interface CompletionResponse {
  ok: boolean;
  error?: string;
  checkedInAt?: string;
  alreadyRecorded?: boolean;
}

export async function completeQrPinWithoutPhoto(
  claim: AttendanceClaim,
  pin: string,
  profile: AccessProfile,
  requestId: string,
): Promise<CompletionResponse> {
  if (!appsScriptUrl) throw new Error('Chưa cấu hình VITE_APPS_SCRIPT_URL.');
  if (!auth?.currentUser) throw new Error('Phiên đăng nhập đã hết hạn.');
  if (!/^\d{4}$/.test(pin.trim())) throw new Error('PIN phải gồm đúng 4 chữ số.');

  const response = await fetch(appsScriptUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({
      action: 'completeAttendanceWithoutPhoto',
      idToken: await auth.currentUser.getIdToken(),
      courseId: ACTIVE_COURSE_ID,
      claimId: claim.claimId,
      requestId,
      pin: pin.trim(),
      email: profile.email,
      studentId: profile.studentId || 'TEST-STUDENT',
      fullName: profile.fullName || '',
      classCode: profile.classCode || '',
    }),
  });
  if (!response.ok) throw new Error(`Cổng điểm danh trả về HTTP ${response.status}.`);
  const result = await response.json() as CompletionResponse;
  if (!result.ok) throw new Error(result.error || 'Không thể hoàn tất QR + PIN.');
  return result;
}
