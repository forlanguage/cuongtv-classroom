import {
  Timestamp,
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  type Firestore,
  type Unsubscribe,
  type WriteBatch,
} from 'firebase/firestore';
import { auth, db } from './firebase';
import { ACTIVE_COURSE_ID } from './roster';

export type AttendanceAuditEventType = 'teacher_review' | 'manual_teacher';

export interface AttendanceAuditEntry {
  id: string;
  eventType: AttendanceAuditEventType;
  sessionId: string;
  recordEmail: string;
  studentId: string;
  fullName: string;
  actorEmail: string;
  actorUid: string;
  previousStatus: string;
  newStatus: string;
  previousReviewStatus: string;
  newReviewStatus: string;
  reason: string;
  verificationMode: string;
  createdAt: Timestamp | null;
}

export function requireAuditDb(): Firestore {
  if (!db) throw new Error('Firestore chưa được cấu hình.');
  return db;
}

export function appendAttendanceAudit(
  batch: WriteBatch,
  firestore: Firestore,
  sessionId: string,
  values: Omit<AttendanceAuditEntry, 'id' | 'sessionId' | 'actorEmail' | 'actorUid' | 'createdAt'>,
): void {
  const actor = auth?.currentUser;
  if (!actor) throw new Error('Phiên đăng nhập quản trị đã hết hạn.');
  const auditRef = doc(collection(
    firestore,
    'courses', ACTIVE_COURSE_ID,
    'attendanceSessions', sessionId,
    'audit',
  ));
  batch.set(auditRef, {
    ...values,
    sessionId,
    actorEmail: actor.email || '',
    actorUid: actor.uid,
    createdAt: serverTimestamp(),
    schemaVersion: 1,
  });
}

function normalizeEntry(id: string, data: Record<string, unknown>): AttendanceAuditEntry {
  return {
    id,
    eventType: data.eventType === 'manual_teacher' ? 'manual_teacher' : 'teacher_review',
    sessionId: typeof data.sessionId === 'string' ? data.sessionId : '',
    recordEmail: typeof data.recordEmail === 'string' ? data.recordEmail : '',
    studentId: typeof data.studentId === 'string' ? data.studentId : '—',
    fullName: typeof data.fullName === 'string' ? data.fullName : '',
    actorEmail: typeof data.actorEmail === 'string' ? data.actorEmail : '',
    actorUid: typeof data.actorUid === 'string' ? data.actorUid : '',
    previousStatus: typeof data.previousStatus === 'string' ? data.previousStatus : '',
    newStatus: typeof data.newStatus === 'string' ? data.newStatus : '',
    previousReviewStatus: typeof data.previousReviewStatus === 'string' ? data.previousReviewStatus : '',
    newReviewStatus: typeof data.newReviewStatus === 'string' ? data.newReviewStatus : '',
    reason: typeof data.reason === 'string' ? data.reason : '',
    verificationMode: typeof data.verificationMode === 'string' ? data.verificationMode : '',
    createdAt: data.createdAt instanceof Timestamp ? data.createdAt : null,
  };
}

export function observeAttendanceAudit(
  sessionId: string,
  callback: (entries: AttendanceAuditEntry[]) => void,
  onError?: (message: string) => void,
): Unsubscribe {
  const firestore = requireAuditDb();
  return onSnapshot(
    collection(firestore, 'courses', ACTIVE_COURSE_ID, 'attendanceSessions', sessionId, 'audit'),
    (snapshot) => callback(snapshot.docs
      .map((item) => normalizeEntry(item.id, item.data()))
      .sort((a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0))
      .slice(0, 200)),
    () => onError?.('Không thể tải audit log của phiên.'),
  );
}
