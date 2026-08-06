import { auth } from './firebase';
import { ACTIVE_COURSE_ID, type AccessProfile } from './roster';
import type { AttendanceSession } from './attendance';

const gatewayUrl = import.meta.env.VITE_APPS_SCRIPT_URL as string | undefined;

export interface HybridEvidenceToken {
  tokenId: string;
  sessionId: string;
  sessionTitle: string;
  qrVerified: boolean;
  expiresAt: string;
}

export interface HybridSubmitResult {
  checkedInAt?: string;
  alreadyRecorded?: boolean;
  verificationMode: string;
}

async function callGateway<T>(payload: Record<string, unknown>): Promise<T> {
  if (!gatewayUrl) throw new Error('Chưa cấu hình VITE_APPS_SCRIPT_URL.');
  const actor = auth?.currentUser;
  if (!actor) throw new Error('Phiên đăng nhập đã hết hạn.');
  const response = await fetch(gatewayUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ ...payload, idToken: await actor.getIdToken() }),
  });
  if (!response.ok) throw new Error(`Cổng điểm danh trả về HTTP ${response.status}.`);
  const result = await response.json() as T & { ok?: boolean; error?: string };
  if (result.ok === false) throw new Error(result.error || 'Cổng điểm danh từ chối yêu cầu.');
  return result;
}

export async function startHybridAttendance(
  session: AttendanceSession,
  pin: string,
  profile: AccessProfile,
  challengeId?: string,
): Promise<HybridEvidenceToken> {
  return callGateway<HybridEvidenceToken>({
    action: 'startHybridAttendance',
    courseId: ACTIVE_COURSE_ID,
    sessionId: session.id,
    challengeId: challengeId || '',
    pin: pin.trim(),
    email: profile.email,
  });
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

export async function compressEvidence(file: File, maxBytes = 420 * 1024): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new Error('Tệp đã chọn không phải là ảnh.');
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const maxDimension = 1280;
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Không thể xử lý ảnh.');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.78, 0.65, 0.52, 0.4]) {
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
        (value) => value ? resolve(value) : reject(new Error('Không thể nén ảnh.')),
        'image/jpeg', quality,
      ));
      if (blob.size <= maxBytes || quality === 0.4) return blob;
    }
    throw new Error('Không thể nén ảnh.');
  } finally {
    bitmap.close();
  }
}

export async function submitHybridAttendance(
  token: HybridEvidenceToken,
  profile: AccessProfile,
  options: {
    qrImage?: Blob | null;
    faceImage?: Blob | null;
    noCameraReason?: string;
    requestId: string;
  },
): Promise<HybridSubmitResult> {
  return callGateway<HybridSubmitResult>({
    action: 'submitHybridAttendance',
    courseId: ACTIVE_COURSE_ID,
    tokenId: token.tokenId,
    requestId: options.requestId,
    email: profile.email,
    studentId: profile.studentId || 'TEST-STUDENT',
    fullName: profile.fullName,
    classCode: profile.classCode,
    noCameraReason: options.noCameraReason || '',
    qrMimeType: options.qrImage ? 'image/jpeg' : '',
    qrFileBase64: options.qrImage ? await blobToBase64(options.qrImage) : '',
    faceMimeType: options.faceImage ? 'image/jpeg' : '',
    faceFileBase64: options.faceImage ? await blobToBase64(options.faceImage) : '',
  });
}
