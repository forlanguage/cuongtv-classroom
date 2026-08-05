import { doc, getDoc } from 'firebase/firestore';
import { db } from './firebase';
import { normalizeEmail, type AppRole } from './auth';

export const ACTIVE_COURSE_ID = 'IT006.Q24';

export interface AccessProfile {
  email: string;
  role: AppRole;
  fullName: string;
  studentId: string;
  classCode: string;
  active: boolean;
  source: string;
}

export async function loadAccessProfile(email?: string | null): Promise<AccessProfile | null> {
  const normalized = normalizeEmail(email);
  if (!normalized || !db) return null;

  const snapshot = await getDoc(doc(db, 'courses', ACTIVE_COURSE_ID, 'roster', normalized));
  if (!snapshot.exists()) return null;

  const data = snapshot.data();
  if (data.active !== true || !['admin', 'student'].includes(data.role)) return null;

  return {
    email: normalized,
    role: data.role as AppRole,
    fullName: String(data.fullName ?? ''),
    studentId: String(data.studentId ?? ''),
    classCode: String(data.classCode ?? ACTIVE_COURSE_ID),
    active: true,
    source: String(data.source ?? 'firestore-roster'),
  };
}
