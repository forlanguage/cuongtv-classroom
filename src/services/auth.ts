import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { auth, firebaseConfigured, googleProvider } from './firebase';

export const ADMIN_EMAILS = new Set(['cuongtv@uit.edu.vn']);

export type AppRole = 'admin' | 'student' | 'guest';

export function normalizeEmail(email?: string | null): string {
  return (email ?? '').trim().toLowerCase();
}

export function resolveRole(user: User | null): AppRole {
  const email = normalizeEmail(user?.email);
  if (!email) return 'guest';
  if (ADMIN_EMAILS.has(email)) return 'admin';
  if (email.endsWith('@gm.uit.edu.vn')) return 'student';
  return 'guest';
}

export async function loginWithGoogle(): Promise<User> {
  if (!firebaseConfigured || !auth) {
    throw new Error('Firebase chưa được cấu hình trong GitHub Actions secrets.');
  }
  const result = await signInWithPopup(auth, googleProvider);
  return result.user;
}

export async function logout(): Promise<void> {
  if (auth) await signOut(auth);
}

export function observeAuth(callback: (user: User | null) => void): () => void {
  if (!auth) {
    callback(null);
    return () => undefined;
  }
  return onAuthStateChanged(auth, callback);
}
