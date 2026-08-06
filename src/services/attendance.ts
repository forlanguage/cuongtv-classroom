import {
  Timestamp,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type DocumentSnapshot,
  type Firestore,
  type Unsubscribe,
} from 'firebase/firestore';
import { auth, db } from './firebase';
import { ACTIVE_COURSE_ID, type AccessProfile } from './roster';

export const QR_ROTATION_MS = 60_000;
export const SESSION_DURATION_MINUTES = 5;
export const CLAIM_TTL_SECONDS = 180;

const appsScriptUrl = import.meta.env.VITE_APPS_SCRIPT_URL as string | undefined;

export interface AttendanceSession {
  id: string;
  title: string;
  status: 'open' | 'closed';
  slot: number;
  currentChallengeId: string;
  challengeExpiresAt: Timestamp;
  expiresAt: Timestamp;
  openedAt?: Timestamp;
}

export interface AttendanceAdminState extends AttendanceSession { pin: string; }
export interface AttendanceClaim { claimId: string; sessionId: string; sessionTitle: string; expiresAt: string; }
export interface PinAttendanceReceipt {
  sessionId: string;
  sessionTitle: string;
  status: 'recorded';
  statusLabel: 'Đã ghi nhận';
  checkedInAt: Timestamp | null;
  alreadyRecorded: boolean;
}

interface GatewayResponse {
  ok: boolean;
  error?: string;
  claimId?: string;
  sessionId?: string;
  sessionTitle?: string;
  expiresAt?: string;
}

function randomId(bytesLength = 18): string {
  const bytes = crypto.getRandomValues(new Uint8Array(bytesLength));
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

function randomPin(): string {
  return String(crypto.getRandomValues(new Uint32Array(1))[0] % 10_000).padStart(4, '0');
}

async function pinProof(sessionId: string, pin: string): Promise<string> {
  const input = new TextEncoder().encode(`${sessionId}:${pin}`);
  const digest = await crypto.subtle.digest('SHA-256', input);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

async function callGateway(payload: Record<string, unknown>, retries = 0): Promise<GatewayResponse> {
  if (!appsScriptUrl) throw new Error('Chưa cấu hình VITE_APPS_SCRIPT_URL.');
  if (!auth?.currentUser) throw new Error('Phiên đăng nhập đã hết hạn.');
  const request = { ...payload, idToken: await auth.currentUser.getIdToken() };
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(appsScriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(request),
      });
      if (!response.ok) throw new Error(`Cổng điểm danh trả về HTTP ${response.status}.`);
      const result = await response.json() as GatewayResponse;
      if (!result.ok) throw new Error(result.error || 'Cổng điểm danh từ chối yêu cầu.');
      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Lỗi mạng không xác định.');
      if (attempt < retries) {
        await new Promise((resolve) => window.setTimeout(resolve, (2 ** attempt) * 1000 + Math.random() * 1200));
      }
    }
  }
  throw lastError || new Error('Không thể kết nối cổng điểm danh.');
}

function requireDb(): Firestore {
  if (!db) throw new Error('Firestore chưa được cấu hình.');
  return db;
}

async function listOpenSessions(): Promise<AttendanceSession[]> {
  const firestore = requireDb();
  const snapshot = await getDocs(query(
    collection(firestore, 'courses', ACTIVE_COURSE_ID, 'attendanceSessions'),
    where('status', '==', 'open'),
  ));
  return snapshot.docs
    .map((item) => ({ id: item.id, ...item.data() } as AttendanceSession))
    .filter((session) => session.expiresAt instanceof Timestamp)
    .sort((a, b) => b.expiresAt.toMillis() - a.expiresAt.toMillis());
}

async function closeExpiredOrDuplicateSessions(sessions: AttendanceSession[]): Promise<AttendanceSession | null> {
  const firestore = requireDb();
  const now = Date.now();
  const active = sessions.filter((session) => session.expiresAt.toMillis() > now);
  const keep = active[0] || null;
  const toClose = sessions.filter((session) => session.expiresAt.toMillis() <= now || (keep && session.id !== keep.id));
  if (toClose.length) {
    const batch = writeBatch(firestore);
    toClose.forEach((session) => batch.update(
      doc(firestore, 'courses', ACTIVE_COURSE_ID, 'attendanceSessions', session.id),
      {
        status: 'closed',
        closedAt: serverTimestamp(),
        closeReason: session.expiresAt.toMillis() <= now ? 'expired' : 'duplicate_open_session',
      },
    ));
    await batch.commit();
  }
  return keep;
}

export async function recoverActiveAttendanceSession(): Promise<AttendanceAdminState | null> {
  const firestore = requireDb();
  const active = await closeExpiredOrDuplicateSessions(await listOpenSessions());
  if (!active) return null;

  const secretSnapshot = await getDoc(doc(
    firestore,
    'courses', ACTIVE_COURSE_ID,
    'attendanceSessions', active.id,
    'private', 'config',
  ));
  const pin = secretSnapshot.data()?.pin;
  if (typeof pin !== 'string' || !/^\d{4}$/.test(pin)) {
    throw new Error('Phiên đang mở không có PIN hợp lệ. Hãy đóng phiên và tạo lại.');
  }

  if (!(active.challengeExpiresAt instanceof Timestamp) || active.challengeExpiresAt.toMillis() <= Date.now()) {
    const next = await rotateAttendanceChallenge(active.id, Number(active.slot || 0) + 1);
    return { ...active, ...next, slot: Number(active.slot || 0) + 1 };
  }
  return { ...active, pin };
}

export async function openAttendanceSession(title: string): Promise<AttendanceAdminState> {
  const firestore = requireDb();
  const existing = await closeExpiredOrDuplicateSessions(await listOpenSessions());
  if (existing) throw new Error(`Đang có phiên “${existing.title}”. Hãy đóng phiên hiện tại trước khi mở phiên mới.`);

  const id = crypto.randomUUID();
  const pin = randomPin();
  const currentChallengeId = randomId();
  const now = Date.now();
  const expiresAt = Timestamp.fromMillis(now + SESSION_DURATION_MINUTES * 60_000);
  const challengeExpiresAt = Timestamp.fromMillis(now + QR_ROTATION_MS);
  const sessionRef = doc(firestore, 'courses', ACTIVE_COURSE_ID, 'attendanceSessions', id);
  const batch = writeBatch(firestore);
  batch.set(sessionRef, {
    title: title.trim() || 'Điểm danh trên lớp', status: 'open', slot: 0,
    currentChallengeId, challengeExpiresAt, rotationMs: QR_ROTATION_MS,
    openedAt: serverTimestamp(), expiresAt,
  });
  batch.set(doc(sessionRef, 'private', 'config'), {
    pin,
    pinProof: await pinProof(id, pin),
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
  return {
    id,
    title: title.trim() || 'Điểm danh trên lớp',
    status: 'open',
    slot: 0,
    currentChallengeId,
    challengeExpiresAt,
    expiresAt,
    pin,
  };
}

export async function rotateAttendanceChallenge(sessionId: string, slot: number): Promise<{ currentChallengeId: string; challengeExpiresAt: Timestamp; pin: string }> {
  const firestore = requireDb();
  const currentChallengeId = randomId();
  const pin = randomPin();
  const challengeExpiresAt = Timestamp.fromMillis(Date.now() + QR_ROTATION_MS);
  const sessionRef = doc(firestore, 'courses', ACTIVE_COURSE_ID, 'attendanceSessions', sessionId);
  const batch = writeBatch(firestore);
  batch.update(sessionRef, { currentChallengeId, challengeExpiresAt, slot, rotatedAt: serverTimestamp() });
  batch.set(doc(sessionRef, 'private', 'config'), {
    pin,
    pinProof: await pinProof(sessionId, pin),
    updatedAt: serverTimestamp(),
  }, { merge: true });
  await batch.commit();
  return { currentChallengeId, challengeExpiresAt, pin };
}

export async function closeAttendanceSession(sessionId: string): Promise<void> {
  const firestore = requireDb();
  await updateDoc(
    doc(firestore, 'courses', ACTIVE_COURSE_ID, 'attendanceSessions', sessionId),
    { status: 'closed', closedAt: serverTimestamp() },
  );
}

export async function claimAttendanceChallenge(sessionId: string, challengeId: string, profile: AccessProfile): Promise<AttendanceClaim> {
  const result = await callGateway({
    action: 'claimAttendanceChallenge',
    courseId: ACTIVE_COURSE_ID,
    sessionId,
    challengeId,
    email: profile.email,
  }, 1);
  if (!result.claimId || !result.sessionId || !result.sessionTitle || !result.expiresAt) {
    throw new Error('Backend không trả về claim hợp lệ.');
  }
  return {
    claimId: result.claimId,
    sessionId: result.sessionId,
    sessionTitle: result.sessionTitle,
    expiresAt: result.expiresAt,
  };
}

export async function completeAttendanceClaim(claim: AttendanceClaim, pin: string, profile: AccessProfile, photo: Blob, requestId: string): Promise<void> {
  await callGateway({
    action: 'completeAttendance', courseId: ACTIVE_COURSE_ID, claimId: claim.claimId,
    requestId, pin: pin.trim(), email: profile.email,
    studentId: profile.studentId || 'TEST-STUDENT', fullName: profile.fullName,
    classCode: profile.classCode, mimeType: 'image/jpeg', photoSize: photo.size,
    fileBase64: await blobToBase64(photo),
  }, 3);
}

function receiptFromSnapshot(
  sessionId: string,
  sessionTitle: string,
  snapshot: DocumentSnapshot<DocumentData>,
  alreadyRecorded: boolean,
): PinAttendanceReceipt {
  const data = snapshot.data();
  const checkedInAt = data?.checkedInAt;
  return {
    sessionId,
    sessionTitle,
    status: 'recorded',
    statusLabel: 'Đã ghi nhận',
    checkedInAt: checkedInAt instanceof Timestamp ? checkedInAt : null,
    alreadyRecorded,
  };
}

export async function recordAttendanceByPin(sessionOrId: AttendanceSession | string, pin: string, profile: AccessProfile): Promise<PinAttendanceReceipt> {
  const firestore = requireDb();
  if (!auth?.currentUser) throw new Error('Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.');
  const sessionId = typeof sessionOrId === 'string' ? sessionOrId : sessionOrId.id;
  const sessionTitle = typeof sessionOrId === 'string' ? 'Phiên điểm danh' : sessionOrId.title;
  const normalizedPin = pin.trim();
  if (!/^\d{4}$/.test(normalizedPin)) throw new Error('PIN phải gồm đúng 4 chữ số.');

  const recordRef = doc(firestore, 'courses', ACTIVE_COURSE_ID, 'attendanceSessions', sessionId, 'records', profile.email);
  const existing = await getDoc(recordRef);
  if (existing.exists()) return receiptFromSnapshot(sessionId, sessionTitle, existing, true);

  try {
    await setDoc(recordRef, {
      email: profile.email,
      uid: auth.currentUser.uid,
      studentId: profile.studentId || 'TEST-STUDENT',
      fullName: profile.fullName || '',
      classCode: profile.classCode || '',
      pinProof: await pinProof(sessionId, normalizedPin),
      requestId: crypto.randomUUID(),
      checkedInAt: serverTimestamp(),
      status: 'recorded',
      statusLabel: 'Đã ghi nhận',
      verificationMode: 'pin_only',
      evidenceLevel: 'limited',
      qrVerified: false,
      photoProvided: false,
      reviewStatus: 'needs_review',
    });
  } catch (error) {
    const repeated = await getDoc(recordRef);
    if (repeated.exists()) return receiptFromSnapshot(sessionId, sessionTitle, repeated, true);
    const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
    if (code.includes('permission-denied')) throw new Error('PIN không đúng, PIN vừa thay đổi, hoặc phiên điểm danh đã đóng.');
    if (code.includes('unavailable') || !navigator.onLine) throw new Error('Mạng đang không ổn định. Hãy kiểm tra kết nối và gửi lại.');
    throw error;
  }

  const saved = await getDoc(recordRef);
  return receiptFromSnapshot(sessionId, sessionTitle, saved, false);
}

export function observeOpenAttendanceSessions(callback: (sessions: AttendanceSession[]) => void): Unsubscribe {
  if (!db) { callback([]); return () => undefined; }
  return onSnapshot(collection(db, 'courses', ACTIVE_COURSE_ID, 'attendanceSessions'), (snapshot) => {
    const now = Date.now();
    callback(snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as AttendanceSession))
      .filter((session) => session.status === 'open' && session.expiresAt instanceof Timestamp && session.expiresAt.toMillis() > now)
      .sort((a, b) => b.expiresAt.toMillis() - a.expiresAt.toMillis()));
  });
}

export function observeAttendanceCount(sessionId: string, callback: (count: number) => void): Unsubscribe {
  if (!db) { callback(0); return () => undefined; }
  return onSnapshot(
    collection(db, 'courses', ACTIVE_COURSE_ID, 'attendanceSessions', sessionId, 'records'),
    (snapshot) => callback(snapshot.size),
  );
}
