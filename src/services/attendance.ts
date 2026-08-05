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
import { ref, uploadBytes } from 'firebase/storage';
import { auth, db, storage } from './firebase';
import { ACTIVE_COURSE_ID, type AccessProfile } from './roster';

export const QR_ROTATION_MS = 60_000;
export const SESSION_DURATION_MINUTES = 5;

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

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

function randomPin(): string {
  return String(crypto.getRandomValues(new Uint32Array(1))[0] % 10_000).padStart(4, '0');
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
  await setDoc(
    doc(db, 'courses', ACTIVE_COURSE_ID, 'attendanceSessions', sessionId),
    { status: 'closed', closedAt: serverTimestamp() },
    { merge: true },
  );
}

export async function checkInAttendance(
  sessionId: string,
  token: string,
  pin: string,
  profile: AccessProfile,
  photo: Blob,
): Promise<void> {
  if (!db || !storage || !auth?.currentUser) throw new Error('Firebase chưa được cấu hình đầy đủ.');

  const sessionRef = doc(db, 'courses', ACTIVE_COURSE_ID, 'attendanceSessions', sessionId);
  const sessionSnapshot = await getDoc(sessionRef);
  if (!sessionSnapshot.exists()) throw new Error('Phiên điểm danh không tồn tại.');

  const session = sessionSnapshot.data();
  if (session.status !== 'open') throw new Error('Phiên điểm danh đã đóng.');
  if (session.token !== token || session.pin !== pin.trim()) throw new Error('QR hoặc mã xác nhận không hợp lệ.');
  if (!(session.expiresAt instanceof Timestamp) || session.expiresAt.toMillis() <= Date.now()) {
    throw new Error('Phiên điểm danh đã hết hạn.');
  }

  const photoPath = `attendance/${ACTIVE_COURSE_ID}/${sessionId}/${auth.currentUser.uid}.jpg`;
  await uploadBytes(ref(storage, photoPath), photo, {
    contentType: 'image/jpeg',
    customMetadata: {
      email: profile.email,
      studentId: profile.studentId,
      sessionId,
    },
  });

  await setDoc(
    doc(sessionRef, 'records', profile.email),
    {
      email: profile.email,
      uid: auth.currentUser.uid,
      studentId: profile.studentId,
      fullName: profile.fullName,
      classCode: profile.classCode,
      slot: session.slot ?? 0,
      photoPath,
      photoSize: photo.size,
      checkedInAt: serverTimestamp(),
      status: 'present',
      reviewStatus: 'not_reviewed',
    },
    { merge: false },
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
