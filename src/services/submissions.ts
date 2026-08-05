import {
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { auth, db } from './firebase';
import { ACTIVE_COURSE_ID, type AccessProfile } from './roster';

const appsScriptUrl = import.meta.env.VITE_APPS_SCRIPT_URL as string | undefined;

export interface LockedSubmission {
  assignmentId: string;
  assignmentTitle: string;
  mcqAnswers: Record<string, string>;
  essayAnswers: Record<string, string>;
  mcqScore: number;
  mcqMaximumScore: number;
  acknowledgement: string;
}

export interface SubmissionReceipt {
  submissionId: string;
  contentSha256: string;
  mcqScore: number;
  essayGradingStatus: 'pending';
  evidenceStatus: 'ready' | 'retry_required';
  downloadUrl?: string;
  viewUrl?: string;
  emailStatus?: string;
}

interface EvidenceResponse {
  ok: boolean;
  fileId?: string;
  fileName?: string;
  viewUrl?: string;
  downloadUrl?: string;
  emailStatus?: string;
  emailSentAt?: string | null;
  error?: string;
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(object[key])}`).join(',')}}`;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function submitAssignment(
  profile: AccessProfile,
  submission: LockedSubmission,
): Promise<SubmissionReceipt> {
  if (!db || !auth?.currentUser) throw new Error('Firebase chưa được cấu hình đầy đủ.');

  const submittedAt = new Date().toISOString();
  const submissionId = crypto.randomUUID();
  const lockedContent = {
    assignmentId: submission.assignmentId,
    assignmentTitle: submission.assignmentTitle,
    mcqAnswers: submission.mcqAnswers,
    essayAnswers: submission.essayAnswers,
    mcqScore: submission.mcqScore,
    mcqMaximumScore: submission.mcqMaximumScore,
    acknowledgement: submission.acknowledgement,
    studentId: profile.studentId,
    fullName: profile.fullName,
    email: profile.email,
    submittedAt,
    submissionId,
  };
  const contentSha256 = await sha256Hex(canonicalize(lockedContent));
  const submissionRef = doc(
    db,
    'courses', ACTIVE_COURSE_ID,
    'assignments', submission.assignmentId,
    'submissions', profile.email,
  );

  await setDoc(submissionRef, {
    uid: auth.currentUser.uid,
    email: profile.email,
    studentId: profile.studentId,
    fullName: profile.fullName,
    classCode: profile.classCode,
    assignmentId: submission.assignmentId,
    assignmentTitle: submission.assignmentTitle,
    submissionId,
    status: 'submitted',
    mcqAnswers: submission.mcqAnswers,
    essayAnswers: submission.essayAnswers,
    mcqScore: submission.mcqScore,
    mcqMaximumScore: submission.mcqMaximumScore,
    essayAiScore: null,
    essayTeacherScore: null,
    essayFinalScore: null,
    essayGradingStatus: 'pending',
    finalScore: null,
    acknowledgement: submission.acknowledgement,
    contentSha256,
    submittedAt: serverTimestamp(),
    submittedAtClient: submittedAt,
    evidenceStatus: 'pending',
    receiptEmail: { status: 'pending', attempts: 0 },
  }, { merge: false });

  try {
    const evidence = await createEvidence(profile, lockedContent, contentSha256);
    await updateDoc(submissionRef, {
      evidenceStatus: 'ready',
      evidence: {
        provider: 'google-drive',
        fileId: evidence.fileId,
        fileName: evidence.fileName,
        viewUrl: evidence.viewUrl,
        downloadUrl: evidence.downloadUrl,
        generatedAt: serverTimestamp(),
        contentSha256,
      },
      receiptEmail: {
        status: evidence.emailStatus || 'unknown',
        sentAt: evidence.emailSentAt || null,
        recipient: profile.email,
        attempts: 1,
      },
      updatedAt: serverTimestamp(),
    });

    return {
      submissionId,
      contentSha256,
      mcqScore: submission.mcqScore,
      essayGradingStatus: 'pending',
      evidenceStatus: 'ready',
      downloadUrl: evidence.downloadUrl,
      viewUrl: evidence.viewUrl,
      emailStatus: evidence.emailStatus,
    };
  } catch (error) {
    await updateDoc(submissionRef, {
      evidenceStatus: 'retry_required',
      receiptEmail: { status: 'not_sent', attempts: 1 },
      updatedAt: serverTimestamp(),
    });
    return {
      submissionId,
      contentSha256,
      mcqScore: submission.mcqScore,
      essayGradingStatus: 'pending',
      evidenceStatus: 'retry_required',
    };
  }
}

async function createEvidence(
  profile: AccessProfile,
  lockedContent: Record<string, unknown>,
  contentSha256: string,
): Promise<Required<Pick<EvidenceResponse, 'fileId' | 'fileName' | 'viewUrl' | 'downloadUrl'>> & EvidenceResponse> {
  if (!appsScriptUrl) throw new Error('Chưa cấu hình VITE_APPS_SCRIPT_URL.');
  if (!auth?.currentUser) throw new Error('Phiên đăng nhập đã hết hạn.');

  const idToken = await auth.currentUser.getIdToken();
  const response = await fetch(appsScriptUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({
      action: 'createSubmissionEvidence',
      idToken,
      courseId: ACTIVE_COURSE_ID,
      assignmentId: lockedContent.assignmentId,
      assignmentTitle: lockedContent.assignmentTitle,
      submissionId: lockedContent.submissionId,
      studentId: profile.studentId || 'TEST-STUDENT',
      fullName: profile.fullName,
      email: profile.email,
      submittedAt: lockedContent.submittedAt,
      contentSha256,
      acknowledgement: lockedContent.acknowledgement,
      mcqScore: lockedContent.mcqScore,
      submission: {
        mcqAnswers: lockedContent.mcqAnswers,
        essayAnswers: lockedContent.essayAnswers,
      },
    }),
  });

  if (!response.ok) throw new Error(`Cổng PDF trả về HTTP ${response.status}.`);
  const result = await response.json() as EvidenceResponse;
  if (!result.ok || !result.fileId || !result.fileName || !result.viewUrl || !result.downloadUrl) {
    throw new Error(result.error || 'Không thể tạo PDF minh chứng.');
  }
  return result as Required<Pick<EvidenceResponse, 'fileId' | 'fileName' | 'viewUrl' | 'downloadUrl'>> & EvidenceResponse;
}
