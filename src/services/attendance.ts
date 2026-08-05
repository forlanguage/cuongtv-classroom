import {
  Timestamp,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from './firebase';
import { ACTIVE_COURSE_ID, type AccessProfile } from './roster';

export interface AttendanceSession {
  id: string;
  title: string;
  token: string;
  status: 'open' | 'closed';
  openedAt?: Timestamp;
  expiresAt: Timestamp;
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

export async function openAttendanceSession(title: string, durationMinutes = 10): Promise<AttendanceSession> {
  if (!db) throw new Error('Firestore chưa được cấu hình.');

  const id = crypto.randomUUID();
  const token = randomToken();
  const expiresAt = Timestamp.fromMillis(Date.now() + durationMinutes * 60_000);
  const ref = doc(db, 'courses', ACTIVE_COURSE_ID, 'attendanceSessions', id);

  await setDoc(ref, {
    title: title.trim() || 'Điểm danh trên lớp',
    token,
    status: 'open',
    openedAt: serverTimestamp(),
    expiresAt,
  });

  return { id, title: title.trim() || 'Điểm danh trên lớp', token, status: 'open', expiresAt };
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
  profile: AccessProfile,
): Promise<void> {
  if (!db) throw new Error('Firestore chưa được cấu hình.');

  const sessionRef = doc(db, 'courses', ACTIVE_COURSE_ID, 'attendanceSessions', sessionId);
  const sessionSnapshot = await getDoc(sessionRef);
  if (!sessionSnapshot.exists()) throw new Error('Phiên điểm danh không tồn tại.');

  const session = sessionSnapshot.data();
  if (session.status !== 'open') throw new Error('Phiên điểm danh đã đóng.');
  if (session.token !== token) throw new Error('Mã điểm danh không hợp lệ.');
  if (!(session.expiresAt instanceof Timestamp) || session.expiresAt.toMillis() <= Date.now()) {
    throw new Error('Mã điểm danh đã hết hạn.');
  }

  await setDoc(
    doc(sessionRef, 'records', profile.email),
    {
      email: profile.email,
      studentId: profile.studentId,
      fullName: profile.fullName,
      classCode: profile.classCode,
      token,
      checkedInAt: serverTimestamp(),
      status: 'present',
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
    doc(db, 'courses', ACTIVE_COURSE_ID, 'attendanceSessions', sessionId),
    () => callback(0),
  );
}
