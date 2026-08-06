const CONFIG = {
  rootFolderName: 'CuongTV Classroom',
  maxAttendanceBytes: 500 * 1024,
  maxSubmissionJsonBytes: 2 * 1024 * 1024,
  challengeGraceMs: 30 * 1000,
  claimTtlSeconds: 180,
};

function doGet() {
  return jsonResponse_({ ok: true, service: 'cuongtv-classroom-drive-gateway' });
}

function doPost(event) {
  try {
    const payload = JSON.parse((event && event.postData && event.postData.contents) || '{}');
    const identity = verifyFirebaseIdToken_(payload.idToken);
    requireMatchingEmail_(identity, payload.email);
    switch (payload.action) {
      case 'claimAttendanceChallenge': return jsonResponse_(claimAttendanceChallenge_(payload, identity));
      case 'completeAttendance': return jsonResponse_(completeAttendance_(payload, identity));
      case 'completeAttendanceWithoutPhoto': return jsonResponse_(completeAttendanceWithoutPhoto_(payload, identity));
      case 'recordAttendanceByPin': return jsonResponse_(recordAttendanceByPin_(payload, identity));
      case 'createSubmissionEvidence': return jsonResponse_(createSubmissionEvidence_(payload, identity));
      default: throw new Error('Unsupported action.');
    }
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    return jsonResponse_({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}

function verifyFirebaseIdToken_(idToken) {
  if (!idToken) throw new Error('Missing Firebase ID token.');
  const apiKey = PropertiesService.getScriptProperties().getProperty('FIREBASE_WEB_API_KEY');
  if (!apiKey) throw new Error('Missing FIREBASE_WEB_API_KEY script property.');
  const response = UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + encodeURIComponent(apiKey), {
    method: 'post', contentType: 'application/json', payload: JSON.stringify({ idToken: idToken }), muteHttpExceptions: true,
  });
  if (response.getResponseCode() !== 200) throw new Error('Firebase authentication failed.');
  const body = JSON.parse(response.getContentText());
  const user = body.users && body.users[0];
  if (!user || !user.email || user.emailVerified !== true) throw new Error('A verified Google account is required.');
  return { uid: user.localId, email: String(user.email).toLowerCase() };
}

function requireMatchingEmail_(identity, requestedEmail) {
  if (!requestedEmail || identity.email !== String(requestedEmail).toLowerCase()) throw new Error('Authenticated email does not match the request.');
}

function requireActiveStudent_(courseId, identity) {
  const roster = firestoreGet_('courses/' + courseId + '/roster/' + encodeURIComponent(identity.email));
  if (!roster || roster.active !== true || roster.role !== 'student') throw new Error('Tài khoản không thuộc roster đang hoạt động.');
}

function claimAttendanceChallenge_(payload, identity) {
  requireFields_(payload, ['courseId', 'sessionId', 'challengeId']);
  requireActiveStudent_(payload.courseId, identity);
  const session = firestoreGet_('courses/' + payload.courseId + '/attendanceSessions/' + payload.sessionId);
  const now = Date.now();
  if (!session || session.status !== 'open') throw new Error('Phiên điểm danh đã đóng hoặc không tồn tại.');
  if (session.currentChallengeId !== payload.challengeId) throw new Error('Challenge QR không còn hiệu lực.');
  if (!session.challengeExpiresAt || Date.parse(session.challengeExpiresAt) + CONFIG.challengeGraceMs < now) throw new Error('Challenge QR đã hết hạn. Hãy quét QR mới.');
  if (!session.expiresAt || Date.parse(session.expiresAt) <= now) throw new Error('Phiên điểm danh đã hết hạn.');
  const claimId = Utilities.getUuid();
  const expiresAt = new Date(now + CONFIG.claimTtlSeconds * 1000).toISOString();
  CacheService.getScriptCache().put('claim:' + claimId, JSON.stringify({
    claimId: claimId, courseId: payload.courseId, sessionId: payload.sessionId,
    challengeId: payload.challengeId, uid: identity.uid, email: identity.email,
    status: 'claimed', expiresAt: expiresAt,
  }), CONFIG.claimTtlSeconds);
  return { ok: true, claimId: claimId, sessionId: payload.sessionId, sessionTitle: session.title || 'Điểm danh', expiresAt: expiresAt };
}

function readClaimForCompletion_(payload, identity) {
  const cache = CacheService.getScriptCache();
  const rawClaim = cache.get('claim:' + payload.claimId);
  if (!rawClaim) throw new Error('Claim đã hết hạn. Hãy quét QR mới.');
  const claim = JSON.parse(rawClaim);
  if (claim.status === 'consumed') {
    if (claim.requestId === payload.requestId) return { cache: cache, claim: claim, repeated: true };
    throw new Error('Claim đã được sử dụng.');
  }
  if (claim.uid !== identity.uid || claim.email !== identity.email) throw new Error('Claim không thuộc tài khoản hiện tại.');
  if (claim.courseId !== payload.courseId) throw new Error('Claim không thuộc lớp này.');
  if (Date.parse(claim.expiresAt) <= Date.now()) throw new Error('Claim đã hết hạn.');
  return { cache: cache, claim: claim, repeated: false };
}

function consumeClaim_(cache, claim, requestId, result) {
  claim.status = 'consumed';
  claim.requestId = requestId;
  claim.result = result;
  cache.put('claim:' + claim.claimId, JSON.stringify(claim), 600);
}

function completeAttendance_(payload, identity) {
  requireFields_(payload, ['courseId', 'claimId', 'requestId', 'pin', 'studentId', 'fileBase64']);
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const claimState = readClaimForCompletion_(payload, identity);
    if (claimState.repeated) return claimState.claim.result;
    const claim = claimState.claim;
    requireActiveStudent_(claim.courseId, identity);
    const sessionPath = 'courses/' + claim.courseId + '/attendanceSessions/' + claim.sessionId;
    const session = firestoreGet_(sessionPath);
    const secret = firestoreGet_(sessionPath + '/private/config');
    validateSessionAndPin_(session, secret, payload.pin);
    const recordPath = sessionPath + '/records/' + encodeURIComponent(identity.email);
    const existing = firestoreGet_(recordPath, true);
    if (existing && existing.requestId === payload.requestId) return { ok: true, checkedInAt: existing.checkedInAt, alreadyRecorded: true };
    if (existing) throw new Error('Sinh viên đã được ghi nhận trong phiên này.');
    const bytes = Utilities.base64Decode(payload.fileBase64);
    if (bytes.length === 0 || bytes.length > CONFIG.maxAttendanceBytes) throw new Error('Ảnh điểm danh phải nhỏ hơn 500 KB.');
    const folder = ensureFolderPath_([sanitizeName_(claim.courseId), 'attendance', sanitizeName_(claim.sessionId)]);
    const fileName = sanitizeName_(payload.studentId) + '_' + sanitizeName_(payload.requestId) + '.jpg';
    const prior = folder.getFilesByName(fileName);
    const file = prior.hasNext() ? prior.next() : folder.createFile(Utilities.newBlob(bytes, 'image/jpeg', fileName));
    const downloadUrl = 'https://drive.google.com/uc?export=download&id=' + file.getId();
    const checkedInAt = new Date().toISOString();
    firestorePatch_(recordPath, {
      email: identity.email, uid: identity.uid, studentId: payload.studentId,
      fullName: payload.fullName || '', classCode: payload.classCode || '',
      challengeId: claim.challengeId, claimId: payload.claimId, requestId: payload.requestId,
      verificationMode: 'qr_pin_photo', evidenceLevel: 'full',
      qrVerified: true, photoProvided: true,
      photoFileId: file.getId(), photoFileName: file.getName(), photoDownloadUrl: downloadUrl,
      photoSize: bytes.length, photoProvider: 'google-drive', checkedInAt: checkedInAt,
      status: 'present', statusLabel: 'Có mặt', reviewStatus: 'not_reviewed',
    });
    const result = { ok: true, checkedInAt: checkedInAt, alreadyRecorded: false };
    consumeClaim_(claimState.cache, claim, payload.requestId, result);
    return result;
  } finally { lock.releaseLock(); }
}

function completeAttendanceWithoutPhoto_(payload, identity) {
  requireFields_(payload, ['courseId', 'claimId', 'requestId', 'pin', 'studentId']);
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const claimState = readClaimForCompletion_(payload, identity);
    if (claimState.repeated) return claimState.claim.result;
    const claim = claimState.claim;
    requireActiveStudent_(claim.courseId, identity);
    const sessionPath = 'courses/' + claim.courseId + '/attendanceSessions/' + claim.sessionId;
    const session = firestoreGet_(sessionPath);
    const secret = firestoreGet_(sessionPath + '/private/config');
    validateSessionAndPin_(session, secret, payload.pin);
    if (session.requireQr !== true || session.requirePhoto === true) throw new Error('Phiên này không áp dụng QR + PIN không ảnh.');
    const recordPath = sessionPath + '/records/' + encodeURIComponent(identity.email);
    const existing = firestoreGet_(recordPath, true);
    if (existing) return { ok: true, checkedInAt: existing.checkedInAt, alreadyRecorded: true };
    const checkedInAt = new Date().toISOString();
    firestorePatch_(recordPath, {
      email: identity.email, uid: identity.uid, studentId: payload.studentId,
      fullName: payload.fullName || '', classCode: payload.classCode || '',
      challengeId: claim.challengeId, claimId: payload.claimId, requestId: payload.requestId,
      verificationMode: 'qr_pin_no_photo', evidenceLevel: 'qr_verified',
      qrVerified: true, photoProvided: false, checkedInAt: checkedInAt,
      status: 'present', statusLabel: 'Có mặt', reviewStatus: 'not_reviewed',
      note: 'QR và PIN đã được xác minh; policy không yêu cầu ảnh.',
    });
    const result = { ok: true, checkedInAt: checkedInAt, alreadyRecorded: false };
    consumeClaim_(claimState.cache, claim, payload.requestId, result);
    return result;
  } finally { lock.releaseLock(); }
}

function recordAttendanceByPin_(payload, identity) {
  requireFields_(payload, ['courseId', 'sessionId', 'requestId', 'pin', 'studentId']);
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    requireActiveStudent_(payload.courseId, identity);
    const sessionPath = 'courses/' + payload.courseId + '/attendanceSessions/' + payload.sessionId;
    const session = firestoreGet_(sessionPath);
    const secret = firestoreGet_(sessionPath + '/private/config');
    validateSessionAndPin_(session, secret, payload.pin);
    const recordPath = sessionPath + '/records/' + encodeURIComponent(identity.email);
    const existing = firestoreGet_(recordPath, true);
    if (existing) return { ok: true, checkedInAt: existing.checkedInAt, status: existing.status };
    const checkedInAt = new Date().toISOString();
    firestorePatch_(recordPath, {
      email: identity.email, uid: identity.uid, studentId: payload.studentId,
      fullName: payload.fullName || '', classCode: payload.classCode || '',
      requestId: payload.requestId, verificationMode: 'pin_only', evidenceLevel: 'limited',
      qrVerified: false, photoProvided: false, checkedInAt: checkedInAt,
      status: 'recorded', statusLabel: 'Đã ghi nhận', reviewStatus: 'needs_review',
      note: 'Đã ghi nhận bằng PIN do không thể sử dụng QR hoặc camera.',
    });
    return { ok: true, checkedInAt: checkedInAt, status: 'recorded' };
  } finally { lock.releaseLock(); }
}

function validateSessionAndPin_(session, secret, pin) {
  if (!session || session.status !== 'open' || !session.expiresAt || Date.parse(session.expiresAt) <= Date.now()) throw new Error('Phiên điểm danh đã đóng hoặc hết hạn.');
  if (!secret || String(secret.pin) !== String(pin)) throw new Error('PIN không hợp lệ.');
}

function firestoreProjectId_() {
  const value = PropertiesService.getScriptProperties().getProperty('FIREBASE_PROJECT_ID');
  if (!value) throw new Error('Missing FIREBASE_PROJECT_ID script property.');
  return value;
}
function firestoreUrl_(path) { return 'https://firestore.googleapis.com/v1/projects/' + firestoreProjectId_() + '/databases/(default)/documents/' + path; }
function firestoreGet_(path, allowMissing) {
  const response = UrlFetchApp.fetch(firestoreUrl_(path), { method: 'get', headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
  if (response.getResponseCode() === 404 && allowMissing) return null;
  if (response.getResponseCode() !== 200) throw new Error('Firestore read failed: HTTP ' + response.getResponseCode());
  return decodeFirestoreFields_(JSON.parse(response.getContentText()).fields || {});
}
function firestorePatch_(path, value) {
  const response = UrlFetchApp.fetch(firestoreUrl_(path), {
    method: 'patch', contentType: 'application/json', headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: JSON.stringify({ fields: encodeFirestoreFields_(value) }), muteHttpExceptions: true,
  });
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) throw new Error('Firestore write failed: HTTP ' + response.getResponseCode() + ' ' + response.getContentText());
}
function decodeFirestoreFields_(fields) {
  const result = {};
  Object.keys(fields).forEach(function (key) {
    const field = fields[key];
    if ('stringValue' in field) result[key] = field.stringValue;
    else if ('booleanValue' in field) result[key] = field.booleanValue;
    else if ('integerValue' in field) result[key] = Number(field.integerValue);
    else if ('doubleValue' in field) result[key] = Number(field.doubleValue);
    else if ('timestampValue' in field) result[key] = field.timestampValue;
    else if ('nullValue' in field) result[key] = null;
  });
  return result;
}
function encodeFirestoreFields_(value) {
  const fields = {};
  Object.keys(value).forEach(function (key) {
    const item = value[key];
    if (item === null || item === undefined) fields[key] = { nullValue: null };
    else if (typeof item === 'boolean') fields[key] = { booleanValue: item };
    else if (typeof item === 'number' && Number.isInteger(item)) fields[key] = { integerValue: String(item) };
    else if (typeof item === 'number') fields[key] = { doubleValue: item };
    else fields[key] = { stringValue: String(item) };
  });
  return fields;
}

function createSubmissionEvidence_(payload, identity) {
  requireFields_(payload, ['courseId', 'assignmentId', 'assignmentTitle', 'submissionId', 'studentId', 'fullName', 'submittedAt', 'contentSha256', 'submission']);
  const canonicalJson = JSON.stringify(payload.submission);
  if (canonicalJson.length > CONFIG.maxSubmissionJsonBytes) throw new Error('Submission payload is too large.');
  const folder = ensureFolderPath_([sanitizeName_(payload.courseId), 'assignments', sanitizeName_(payload.assignmentId), 'submissions', sanitizeName_(payload.studentId)]);
  const baseName = sanitizeName_(payload.studentId + '_' + payload.assignmentId + '_' + payload.submissionId);
  const document = DocumentApp.create(baseName + '_source');
  const body = document.getBody();
  body.appendParagraph('CUONGTV CLASSROOM — SUBMISSION EVIDENCE').setHeading(DocumentApp.ParagraphHeading.HEADING1);
  appendField_(body, 'Course', payload.courseId); appendField_(body, 'Assignment', payload.assignmentTitle);
  appendField_(body, 'Student', payload.fullName + ' (' + payload.studentId + ')'); appendField_(body, 'Email', identity.email);
  appendField_(body, 'Submission ID', payload.submissionId); appendField_(body, 'Submitted at', payload.submittedAt);
  appendField_(body, 'Content SHA-256', payload.contentSha256);
  body.appendParagraph('Multiple-choice answers').setHeading(DocumentApp.ParagraphHeading.HEADING2); appendObject_(body, payload.submission.mcqAnswers || {});
  body.appendParagraph('Essay answers').setHeading(DocumentApp.ParagraphHeading.HEADING2); appendObject_(body, payload.submission.essayAnswers || {});
  body.appendParagraph('Audit data').setHeading(DocumentApp.ParagraphHeading.HEADING2); body.appendParagraph(canonicalJson).setFontFamily('Courier New').setFontSize(8);
  document.saveAndClose();
  const sourceFile = DriveApp.getFileById(document.getId());
  const pdfName = baseName + '.pdf'; replaceExistingFile_(folder, pdfName);
  const pdfFile = folder.createFile(sourceFile.getAs(MimeType.PDF).setName(pdfName)); sourceFile.setTrashed(true);
  try { pdfFile.addViewer(identity.email); } catch (shareError) { console.warn('Could not add viewer: ' + shareError); }
  const viewUrl = 'https://drive.google.com/file/d/' + pdfFile.getId() + '/view';
  const downloadUrl = 'https://drive.google.com/uc?export=download&id=' + pdfFile.getId();
  const emailResult = sendSubmissionReceipt_(payload, identity.email, viewUrl, downloadUrl);
  return { ok: true, fileId: pdfFile.getId(), fileName: pdfFile.getName(), viewUrl: viewUrl, downloadUrl: downloadUrl, emailStatus: emailResult.status, emailSentAt: emailResult.sentAt };
}
function sendSubmissionReceipt_(payload, recipient, viewUrl, downloadUrl) {
  if (MailApp.getRemainingDailyQuota() < 1) return { status: 'quota_exhausted', sentAt: null };
  MailApp.sendEmail({ to: recipient, subject: '[CuongTV Classroom] Xác nhận nộp bài — ' + payload.assignmentTitle,
    body: ['Bài làm của bạn đã được ghi nhận.', '', 'Môn/lớp: ' + payload.courseId, 'Bài tập: ' + payload.assignmentTitle, 'Xem PDF: ' + viewUrl, 'Tải PDF: ' + downloadUrl].join('\n') });
  return { status: 'sent', sentAt: new Date().toISOString() };
}
function ensureFolderPath_(parts) { let folder = getRootFolder_(); parts.forEach(function (part) { const iterator = folder.getFoldersByName(part); folder = iterator.hasNext() ? iterator.next() : folder.createFolder(part); }); return folder; }
function getRootFolder_() { const id = PropertiesService.getScriptProperties().getProperty('ROOT_FOLDER_ID'); if (id) return DriveApp.getFolderById(id); const folders = DriveApp.getFoldersByName(CONFIG.rootFolderName); return folders.hasNext() ? folders.next() : DriveApp.createFolder(CONFIG.rootFolderName); }
function replaceExistingFile_(folder, fileName) { const files = folder.getFilesByName(fileName); while (files.hasNext()) files.next().setTrashed(true); }
function appendField_(body, label, value) { body.appendParagraph(label + ': ' + (value === undefined || value === null ? '' : value)); }
function appendObject_(body, object) { const keys = Object.keys(object || {}).sort(); if (!keys.length) { body.appendParagraph('(none)'); return; } keys.forEach(function (key) { body.appendParagraph(key + ': ' + String(object[key])); }); }
function requireFields_(payload, fields) { fields.forEach(function (field) { if (payload[field] === undefined || payload[field] === null || payload[field] === '') throw new Error('Missing required field: ' + field); }); }
function sanitizeName_(value) { return String(value || 'unknown').replace(/[\\/:*?"<>|#%{}]/g, '_').slice(0, 120); }
function jsonResponse_(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }
