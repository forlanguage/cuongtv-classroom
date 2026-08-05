const CONFIG = {
  rootFolderName: 'CuongTV Classroom',
  maxAttendanceBytes: 500 * 1024,
  maxSubmissionJsonBytes: 2 * 1024 * 1024,
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
      case 'uploadAttendancePhoto':
        return jsonResponse_(uploadAttendancePhoto_(payload, identity));
      case 'createSubmissionEvidence':
        return jsonResponse_(createSubmissionEvidence_(payload, identity));
      default:
        throw new Error('Unsupported action.');
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

  const response = UrlFetchApp.fetch(
    'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + encodeURIComponent(apiKey),
    {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ idToken: idToken }),
      muteHttpExceptions: true,
    },
  );

  if (response.getResponseCode() !== 200) throw new Error('Firebase authentication failed.');
  const body = JSON.parse(response.getContentText());
  const user = body.users && body.users[0];
  if (!user || !user.email || user.emailVerified !== true) {
    throw new Error('A verified Google account is required.');
  }
  return { uid: user.localId, email: String(user.email).toLowerCase() };
}

function requireMatchingEmail_(identity, requestedEmail) {
  if (!requestedEmail || identity.email !== String(requestedEmail).toLowerCase()) {
    throw new Error('Authenticated email does not match the request.');
  }
}

function uploadAttendancePhoto_(payload, identity) {
  requireFields_(payload, ['courseId', 'sessionId', 'studentId', 'fileBase64']);
  const bytes = Utilities.base64Decode(payload.fileBase64);
  if (bytes.length > CONFIG.maxAttendanceBytes) throw new Error('Attendance photo exceeds 500 KB.');

  const folder = ensureFolderPath_([
    sanitizeName_(payload.courseId),
    'attendance',
    sanitizeName_(payload.sessionId),
  ]);
  const fileName = sanitizeName_(payload.studentId) + '_' + identity.uid + '.jpg';
  replaceExistingFile_(folder, fileName);
  const blob = Utilities.newBlob(bytes, 'image/jpeg', fileName);
  const file = folder.createFile(blob);
  file.setDescription(JSON.stringify({
    type: 'attendance-photo',
    courseId: payload.courseId,
    sessionId: payload.sessionId,
    email: identity.email,
    studentId: payload.studentId,
    uploadedAt: new Date().toISOString(),
  }));

  return {
    ok: true,
    fileId: file.getId(),
    fileName: file.getName(),
    downloadUrl: 'https://drive.google.com/uc?export=download&id=' + file.getId(),
  };
}

function createSubmissionEvidence_(payload, identity) {
  requireFields_(payload, [
    'courseId', 'assignmentId', 'assignmentTitle', 'submissionId',
    'studentId', 'fullName', 'submittedAt', 'contentSha256', 'submission',
  ]);

  const canonicalJson = JSON.stringify(payload.submission);
  if (canonicalJson.length > CONFIG.maxSubmissionJsonBytes) {
    throw new Error('Submission payload is too large.');
  }

  const folder = ensureFolderPath_([
    sanitizeName_(payload.courseId),
    'assignments',
    sanitizeName_(payload.assignmentId),
    'submissions',
    sanitizeName_(payload.studentId),
  ]);

  const baseName = sanitizeName_(payload.studentId + '_' + payload.assignmentId + '_' + payload.submissionId);
  const document = DocumentApp.create(baseName + '_source');
  const body = document.getBody();
  body.appendParagraph('CUONGTV CLASSROOM — SUBMISSION EVIDENCE')
    .setHeading(DocumentApp.ParagraphHeading.HEADING1);
  appendField_(body, 'Course', payload.courseId);
  appendField_(body, 'Assignment', payload.assignmentTitle);
  appendField_(body, 'Student', payload.fullName + ' (' + payload.studentId + ')');
  appendField_(body, 'Email', identity.email);
  appendField_(body, 'Submission ID', payload.submissionId);
  appendField_(body, 'Submitted at', payload.submittedAt);
  appendField_(body, 'Content SHA-256', payload.contentSha256);
  appendField_(body, 'Electronic acknowledgement', payload.acknowledgement || 'Confirmed with authenticated Google account');

  body.appendParagraph('Multiple-choice answers')
    .setHeading(DocumentApp.ParagraphHeading.HEADING2);
  appendObject_(body, payload.submission.mcqAnswers || {});
  if (payload.mcqScore !== undefined && payload.mcqScore !== null) {
    appendField_(body, 'Automatically graded MCQ score', String(payload.mcqScore));
  }

  body.appendParagraph('Essay answers')
    .setHeading(DocumentApp.ParagraphHeading.HEADING2);
  appendObject_(body, payload.submission.essayAnswers || {});

  body.appendParagraph('Audit data')
    .setHeading(DocumentApp.ParagraphHeading.HEADING2);
  body.appendParagraph(canonicalJson).setFontFamily('Courier New').setFontSize(8);
  document.saveAndClose();

  const sourceFile = DriveApp.getFileById(document.getId());
  const pdfName = baseName + '.pdf';
  replaceExistingFile_(folder, pdfName);
  const pdfFile = folder.createFile(sourceFile.getAs(MimeType.PDF).setName(pdfName));
  sourceFile.setTrashed(true);

  try {
    pdfFile.addViewer(identity.email);
  } catch (shareError) {
    console.warn('Could not add viewer: ' + shareError);
  }

  const viewUrl = 'https://drive.google.com/file/d/' + pdfFile.getId() + '/view';
  const downloadUrl = 'https://drive.google.com/uc?export=download&id=' + pdfFile.getId();
  const emailResult = sendSubmissionReceipt_(payload, identity.email, viewUrl, downloadUrl);

  return {
    ok: true,
    fileId: pdfFile.getId(),
    fileName: pdfFile.getName(),
    viewUrl: viewUrl,
    downloadUrl: downloadUrl,
    emailStatus: emailResult.status,
    emailSentAt: emailResult.sentAt,
  };
}

function sendSubmissionReceipt_(payload, recipient, viewUrl, downloadUrl) {
  if (MailApp.getRemainingDailyQuota() < 1) {
    return { status: 'quota_exhausted', sentAt: null };
  }

  const mcqLine = payload.mcqScore === undefined || payload.mcqScore === null
    ? 'Điểm trắc nghiệm: chưa có'
    : 'Điểm trắc nghiệm: ' + payload.mcqScore;
  const subject = '[CuongTV Classroom] Xác nhận nộp bài — ' + payload.assignmentTitle;
  const text = [
    'Bài làm của bạn đã được ghi nhận.',
    '',
    'Môn/lớp: ' + payload.courseId,
    'Bài tập: ' + payload.assignmentTitle,
    'Mã bài nộp: ' + payload.submissionId,
    'Thời gian nộp: ' + payload.submittedAt,
    mcqLine,
    'Tự luận: chờ AI hỗ trợ chấm và giảng viên duyệt.',
    'SHA-256: ' + payload.contentSha256,
    '',
    'Xem PDF: ' + viewUrl,
    'Tải PDF: ' + downloadUrl,
  ].join('\n');

  MailApp.sendEmail({
    to: recipient,
    subject: subject,
    body: text,
    htmlBody: '<p>Bài làm của bạn đã được ghi nhận.</p>'
      + '<p><strong>Môn/lớp:</strong> ' + escapeHtml_(payload.courseId) + '<br>'
      + '<strong>Bài tập:</strong> ' + escapeHtml_(payload.assignmentTitle) + '<br>'
      + '<strong>Mã bài nộp:</strong> ' + escapeHtml_(payload.submissionId) + '<br>'
      + '<strong>Thời gian nộp:</strong> ' + escapeHtml_(payload.submittedAt) + '<br>'
      + '<strong>' + escapeHtml_(mcqLine) + '</strong><br>'
      + '<strong>Tự luận:</strong> chờ AI hỗ trợ chấm và giảng viên duyệt.<br>'
      + '<strong>SHA-256:</strong> ' + escapeHtml_(payload.contentSha256) + '</p>'
      + '<p><a href="' + viewUrl + '">Xem PDF minh chứng</a> · '
      + '<a href="' + downloadUrl + '">Tải PDF</a></p>',
  });

  return { status: 'sent', sentAt: new Date().toISOString() };
}

function ensureFolderPath_(parts) {
  let folder = getRootFolder_();
  parts.forEach(function (part) {
    const iterator = folder.getFoldersByName(part);
    folder = iterator.hasNext() ? iterator.next() : folder.createFolder(part);
  });
  return folder;
}

function getRootFolder_() {
  const rootFolderId = PropertiesService.getScriptProperties().getProperty('ROOT_FOLDER_ID');
  if (rootFolderId) return DriveApp.getFolderById(rootFolderId);
  const folders = DriveApp.getFoldersByName(CONFIG.rootFolderName);
  return folders.hasNext() ? folders.next() : DriveApp.createFolder(CONFIG.rootFolderName);
}

function replaceExistingFile_(folder, fileName) {
  const files = folder.getFilesByName(fileName);
  while (files.hasNext()) files.next().setTrashed(true);
}

function appendField_(body, label, value) {
  body.appendParagraph(label + ': ' + (value === undefined || value === null ? '' : value));
}

function appendObject_(body, object) {
  const keys = Object.keys(object || {}).sort();
  if (!keys.length) {
    body.appendParagraph('(none)');
    return;
  }
  keys.forEach(function (key) {
    body.appendParagraph(key + ': ' + String(object[key]));
  });
}

function requireFields_(payload, fields) {
  fields.forEach(function (field) {
    if (payload[field] === undefined || payload[field] === null || payload[field] === '') {
      throw new Error('Missing required field: ' + field);
    }
  });
}

function sanitizeName_(value) {
  return String(value || 'unknown').replace(/[\\/:*?"<>|#%{}]/g, '_').slice(0, 120);
}

function escapeHtml_(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function jsonResponse_(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
