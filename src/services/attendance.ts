import {
  Timestamp,
  collection,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Unsubscribe,
} from 'firebase/firestore';
import { auth, db } from './firebase';
import { ACTIVE_COURSE_ID, type AccessProfile } from './roster';

export const QR_ROTATION_MS = 60_000;
export const SESSION_DURATION_MINUTES = 5;

const appsScriptUrl = import.meta.env.VITE_APPS_SCRIPT_URL as string | undefined;

export interface AttendanceSession {
  id: string;
  title: string;
  token: string;
  pin: string;
  slot: number;
  status: 'open' | 'closed';
  openedAt?: Timestamp;
  expiresAt: Timestamp;
}

interface DriveUploadResponse {
  ok: boolean;
  fileId?: string;
  fileName?: string;
  downloadUrl?: string;
  error?: string;
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

function randomPin(): string {
  return String(crypto.getRandomValues(new Uint32Array(1))[0] % 10_000).padStart(4, '0');
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

async function uploadAttendancePhoto(
  sessionId: string,
  profile: AccessProfile,
  photo: Blob,
): Promise<Required<Pick<DriveUploadResponse, 'fileId' | 'fileName' | 'downloadUrl'>>> {
  if (!appsScriptUrl) {
    throw new Error('Chưa cấu hình VITE_APPS_SCRIPT_URL cho cổng upload Google Drive.');
  }
  if (!auth?.currentUser) throw new Error('Phiên đăng nhập đã hết hạn.');

  const idToken = await auth.currentUser.getIdToken();
  const response = await fetch(appsScriptUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({
      action: 'uploadAttendancePhoto',
      idToken,
      courseId: ACTIVE_COURSE_ID,
      sessionId,
      email: profile.email,
      studentId: profile.studentId || 'TEST-STUDENT',
      fullName: profile.fullName,
      mimeType: 'image/jpeg',
      fileBase64: await blobToBase64(photo),
    }),
  });

  if (!response.ok) throw new Error(`Cổng upload trả về HTTP ${response.status}.`);
  const result = await response.json() as DriveUploadResponse;
  if (!result.ok || !result.fileId || !result.fileName || !result.downloadUrl) {
    throw new Error(result.error || 'Không thể lưu ảnh điểm danh lên Google Drive.');
  }
  return {
    fileId: result.fileId,
    fileName: result.fileName,
    downloadUrl: result.downloadUrl,
  };
}

export async function openAttendanceSession(title: string): Promise<AttendanceSession> {
  if (!db) throw new Error('Firestore chưa được cấu hình.');
  const id = crypto.randomUUID();
  const token = randomToken();
  const pin = randomPin();
  const slot = 0;
  const expiresAt = Timestamp.fromMillis(Date.now() + SESSION_DURATION_MINUTES * 60_000);
  const sessionRef = doc(db, 'courses', ACTIVE_COURSE_ID, 'attendanceSessions', id);
  await setDoc(sessionRef, {
    title: title.trim() || 'Điểm danh trên lớp',
    token,
    pin,
    slot,
    rotationMs: QR_ROTATION_MS,
    status: 'open',
    openedAt: serverTimestamp(),
    expiresAt,
  });
  return { id, title: title.trim() || 'Điểm danh trên lớp', token, pin, slot, status: 'open', expiresAt };
}

export async function rotateAttendanceCode(sessionId: string, slot: number): Promise<{ token: string; pin: string }> {
  if (!db) throw new Error('Firestore chưa được cấu hình.');
  const token = randomToken();
  const pin = randomPin();
  await updateDoc(doc(db, 'courses', ACTIVE_COURSE_ID, 'attendanceSessions', sessionId), {
    token,
    pin,
    slot,
    rotatedAt: serverTimestamp(),
  });
  return { token, pin };
}

export async function closeAttendanceSession(sessionId: string): Promise<void> {
  if (!db) throw new Error('Firestore chưa được cấu hình.');
  await setDoc(doc(db, 'courses', ACTIVE_COURSE_ID, 'attendanceSessions', sessionId), {
    status: 'closed',
    closedAt: serverTimestamp(),
  }, { merge: true });
}

export async function checkInAttendance(
  sessionId: string,
  token: string,
  pin: string,
  profile: AccessProfile,
  photo: Blob,
): Promise<void> {
  if (!db || !auth?.currentUser) throw new Error('Firebase chưa được cấu hình đầy đủ.');

  const sessionRef = doc(db, 'courses', ACTIVE_COURSE_ID, 'attendanceSessions', sessionId);
  const sessionSnapshot = await getDoc(sessionRef);
  if (!sessionSnapshot.exists()) throw new Error('Phiên điểm danh không tồn tại.');

  const session = sessionSnapshot.data();
  const normalizedPin = pin.trim();
  if (session.status !== 'open') throw new Error('Phiên điểm danh đã đóng.');
  if (session.token !== token || session.pin !== normalizedPin) throw new Error('QR hoặc mã xác nhận không hợp lệ.');
  if (!(session.expiresAt instanceof Timestamp) || session.expiresAt.toMillis() <= Date.now()) {
    throw new Error('Phiên điểm danh đã hết hạn.');
  }

  const uploadedPhoto = await uploadAttendancePhoto(sessionId, profile, photo);

  await setDoc(doc(sessionRef, 'records', profile.email), {
    email: profile.email,
    uid: auth.currentUser.uid,
    studentId: profile.studentId,
    fullName: profile.fullName,
    classCode: profile.classCode,
    token,
    pin: normalizedPin,
    slot: session.slot ?? 0,
    photoFileId: uploadedPhoto.fileId,
    photoFileName: uploadedPhoto.fileName,
    photoDownloadUrl: uploadedPhoto.downloadUrl,
    photoSize: photo.size,
    photoProvider: 'google-drive',
    checkedInAt: serverTimestamp(),
    status: 'present',
    reviewStatus: 'not_reviewed',
  }, { merge: false });
}

export function observeOpenAttendanceSessions(
  callback: (sessions: AttendanceSession[]) => void,
): Unsubscribe {
  if (!db) {
    callback([]);
    return () => undefined;
  }

  return onSnapshot(
    collection(db, 'courses', ACTIVE_COURSE_ID, 'attendanceSessions'),
    (snapshot) => {
      const now = Date.now();
      const sessions = snapshot.docs
        .map((item) => ({ id: item.id, ...item.data() } as AttendanceSession))
        .filter((session) => (
          session.status === 'open'
          && session.expiresAt instanceof Timestamp
          && session.expiresAt.toMillis() > now
        ))
        .sort((left, right) => right.expiresAt.toMillis() - left.expiresAt.toMillis());
      callback(sessions);
    },
  );
}

export function observeAttendanceCount(sessionId: string, callback: (count: number) => void): Unsubscribe {
  if (!db) {
    callback(0);
    return () => undefined;
  }
  return onSnapshot(
    collection(db, 'courses', ACTIVE_COURSE_ID, 'attendanceSessions', sessionId, 'records'),
    (snapshot) => callback(snapshot.size),
  );
}
