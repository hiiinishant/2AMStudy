const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');

const safetyStore = require('../models/safetyStore');
const { firebaseAdmin, firestoreDb } = require('../config/firebase');
const { createFirebaseAuthMiddleware } = require('../middleware/firebaseAuth');
const { isMasterAdminAuthenticated } = require('../middleware/adminAuth');
const { uploadEvidence } = require('../middleware/upload');
const { uploadToCloudinary } = require('../config/cloudinary');

const { verifyFirebaseToken } = createFirebaseAuthMiddleware(firebaseAdmin, firestoreDb);

// ===== Helpers =====
function normalizeProfileUrl(urlStr) {
  if (!urlStr) return '';
  return urlStr.trim().toLowerCase().replace(/\/+$/, '');
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return String(forwarded).split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

function sanitizeCaseForOwner(caseObj) {
  const copy = { ...caseObj };
  if (copy.anonymous) {
    delete copy.reporterEmail;
  }
  return copy;
}

function sanitizeCaseForPublic(caseObj) {
  let count = caseObj.supportCount || 0;
  try {
    const supports = safetyStore.getSupports ? safetyStore.getSupports() : [];
    const actualCount = supports.filter(s => s && s.caseId === caseObj.caseId).length;
    count = Math.max(count, actualCount);
  } catch (e) {
    // fallback to caseObj.supportCount
  }

  return {
    caseId: caseObj.caseId,
    platform: caseObj.platform,
    fakeUsername: caseObj.fakeUsername,
    fakeProfileUrl: caseObj.fakeProfileUrl,
    realProfileUrl: caseObj.realProfileUrl || '',
    reason: caseObj.reason,
    description: caseObj.description,
    college: caseObj.college || '',
    evidence: caseObj.evidence || [],
    anonymous: caseObj.anonymous,
    status: caseObj.status,
    supportCount: count,
    createdAt: caseObj.createdAt,
    updatedAt: caseObj.updatedAt,
    verifiedAt: caseObj.verifiedAt || null,
    moderatorNote: caseObj.moderatorNote || '',
    rejectionReason: caseObj.rejectionReason || ''
  };
}

async function sendSafetyEmail(to, subject, html) {
  if (!to || !process.env.SMTP_USER) return;
  try {
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });
    await transporter.sendMail({
      from: `"2AM Study Safety" <${process.env.SMTP_USER}>`,
      to: to,
      subject: subject,
      html: html
    });
  } catch (e) {
    console.warn('Safety email send error (non-blocking):', e.message);
  }
}

async function uploadSafetyEvidence(fileBuffer, mimetype, filename) {
  if (!fileBuffer || fileBuffer.length === 0) return null;

  const isPdf = (mimetype && mimetype.includes('pdf')) || (filename && filename.toLowerCase().endsWith('.pdf'));
  const ext = isPdf ? 'pdf' : (path.extname(filename || '').replace('.', '') || 'png');
  const safeBaseName = `case_${Date.now()}_${uuidv4().substring(0, 8)}.${ext}`;
  const effectiveMime = mimetype || (isPdf ? 'application/pdf' : 'image/png');

  // ── Tier 1: Cloudinary Upload (Images & PDFs) ──
  try {
    const cloudRes = await uploadToCloudinary(fileBuffer, {
      folder: 'student-safety',
      prefix: 'case',
      mimetype: effectiveMime,
      filename: filename || safeBaseName
    });

    if (cloudRes && cloudRes.url) {
      return {
        url: cloudRes.url,
        publicId: cloudRes.publicId,
        type: isPdf ? 'pdf' : 'image',
        originalName: filename || safeBaseName,
        uploadedAt: new Date().toISOString()
      };
    }
  } catch (err) {
    console.warn('[Cloudinary Safety Upload Error]:', err.message);
  }

  // ── Tier 2: Local Disk Storage Fallback ──
  try {
    const uploadDir = path.join(__dirname, '..', '..', 'frontend', 'public', 'assets', 'uploads', 'safety');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    const filePath = path.join(uploadDir, safeBaseName);
    fs.writeFileSync(filePath, fileBuffer);

    return {
      url: `/assets/uploads/safety/${safeBaseName}`,
      publicId: `local_${safeBaseName}`,
      type: isPdf ? 'pdf' : 'image',
      originalName: filename || safeBaseName,
      uploadedAt: new Date().toISOString()
    };
  } catch (fsErr) {
    console.warn('[Local Evidence Upload] Local write failed:', fsErr.message);
  }

  // ── Tier 3: Zero-Failure In-Memory Data URI Fallback ──
  const dataUri = `data:${effectiveMime};base64,${fileBuffer.toString('base64')}`;
  return {
    url: dataUri,
    publicId: `inline_${safeBaseName}`,
    type: isPdf ? 'pdf' : 'image',
    originalName: filename || safeBaseName,
    uploadedAt: new Date().toISOString()
  };
}

async function dispatchSmartNotification({ userId, userEmail, caseId, title, message, targetUrl }) {
  if (!userId && !userEmail) return null;

  const notifLogs = safetyStore.getNotificationLogs();
  const existingLog = notifLogs.find(l => {
    if (l.caseId !== caseId || l.status === 'failed') return false;
    const uidMatch = userId && l.userId && l.userId === userId;
    const emailMatch = userEmail && l.userEmail && l.userEmail === userEmail;
    return uidMatch || emailMatch;
  });
  if (existingLog) {
    return existingLog;
  }

  const logId = 'NLOG-' + uuidv4().substring(0, 8).toUpperCase();
  const userPushSubscriptions = safetyStore.getPushSubscriptions();
  const subData = userPushSubscriptions[userId] || userPushSubscriptions[userEmail] || {};
  const pushSub = subData.pushSubscription;
  const isPushEnabled = subData.pushEnabled !== false;
  const isEmailEnabled = subData.emailNotifications !== false;
  const isSafetyEnabled = subData.safetyAlerts !== false;
  const webpush = safetyStore.getWebpush();

  if (!isSafetyEnabled) return null;

  // Priority 1: Push Notification
  if (isPushEnabled && pushSub && webpush) {
    try {
      const payload = JSON.stringify({
        title: title || '🛡️ 2AM Student Safety Alert',
        body: message,
        icon: '/favicon.ico',
        url: targetUrl || `/student-safety#${caseId}`,
        notificationId: logId,
        caseId: caseId
      });
      await webpush.sendNotification(pushSub, payload);
      
      const log = {
        logId,
        userId: userId || 'anonymous',
        userEmail: userEmail || null,
        caseId,
        deliveryMethod: 'push',
        status: 'sent',
        sentAt: new Date().toISOString(),
        openedAt: null
      };
      notifLogs.unshift(log);
      safetyStore.saveNotificationLogs();
      return log;
    } catch (pushErr) {
      console.warn(`[SmartNotif] Push failed, falling back to email:`, pushErr.message);
    }
  }

  // Priority 2: Email Fallback
  if (isEmailEnabled && userEmail) {
    try {
      const emailHtml = `
        <div style="font-family:Inter,sans-serif;max-width:600px;margin:auto;padding:32px;background:#ffffff;border-radius:16px;border:1px solid #e2e8f0;">
          <div style="text-align:center;margin-bottom:24px;">
            <span style="background:#d1fae5;color:#065f46;padding:6px 16px;border-radius:99px;font-size:12px;font-weight:700;">🛡️ STUDENT IDENTITY SHIELD</span>
          </div>
          <h2 style="color:#0f172a;margin-bottom:12px;text-align:center;">${title || 'Case Status Update'}</h2>
          <p style="color:#334155;font-size:15px;line-height:1.6;">${message}</p>
          <div style="text-align:center;margin-top:28px;">
            <a href="https://2amstudy.com${targetUrl || `/student-safety#${caseId}`}" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 28px;border-radius:99px;font-weight:700;text-decoration:none;font-size:14px;">View Verified Case</a>
          </div>
          <p style="color:#94a3b8;font-size:12px;text-align:center;margin-top:32px;">You received this fallback email because Push Notifications were unreached or disabled.</p>
        </div>
      `;
      await sendSafetyEmail(userEmail, title || `[2AM Study] Case ${caseId} Verified ✅`, emailHtml);
      
      const log = {
        logId,
        userId: userId || 'anonymous',
        userEmail,
        caseId,
        deliveryMethod: 'email',
        status: 'sent',
        sentAt: new Date().toISOString(),
        openedAt: null
      };
      notifLogs.unshift(log);
      safetyStore.saveNotificationLogs();
      return log;
    } catch (emailErr) {
      console.error(`[SmartNotif] Email fallback failed:`, emailErr.message);
    }
  }

  const failedLog = {
    logId,
    userId: userId || 'anonymous',
    userEmail: userEmail || null,
    caseId,
    deliveryMethod: pushSub ? 'push' : 'email',
    status: 'failed',
    sentAt: new Date().toISOString(),
    openedAt: null
  };
  notifLogs.unshift(failedLog);
  safetyStore.saveNotificationLogs();
  return failedLog;
}

// ─── Student Safety Routes ───────────────────────────────────────────────────

router.get('/student-safety', (req, res) => {
  res.render('student-safety', {
    pageTitle: '🛡️ Student Identity Shield - 2AM Study',
    metaDescription: 'Protect students from fake social media profiles. Report impersonation, help verify genuine cases, and support affected students.',
    activeTab: req.query.tab || 'overview'
  });
});

router.get('/student-safety/report', (req, res) => {
  res.render('report-fake-profile', {
    pageTitle: 'Report Fake Profile | Student Identity Shield',
    metaDescription: 'Report fake student social media profiles and impersonation accounts securely.',
    successMessage: null,
    errorMessage: null,
    caseId: null
  });
});

router.get('/student-safety/how-it-works', (req, res) => {
  res.render('how-it-works', {
    pageTitle: 'How Student Identity Shield Works | 2AM Study',
    metaDescription: 'Learn how Student Identity Shield protects students from fake social media profiles through community reports and admin verification.'
  });
});

router.get('/student-safety/admin', (req, res) => res.redirect('/admin#tab-safety'));
router.get('/admin-moderation', (req, res) => res.redirect('/admin#tab-safety'));

router.post('/student-safety/report', (req, res, next) => {
  uploadEvidence(req, res, function (err) {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ success: false, message: 'File size exceeds maximum limit of 10 MB per file.' });
      }
      if (err.code === 'LIMIT_UNEXPECTED_FILE' || err.code === 'LIMIT_FILE_COUNT') {
        return res.status(400).json({ success: false, message: 'You can upload a maximum of 5 evidence files.' });
      }
      return res.status(400).json({ success: false, message: err.message });
    } else if (err) {
      return res.status(400).json({ success: false, message: err.message });
    }
    next();
  });
}, verifyFirebaseToken, async (req, res) => {
  try {
    const {
      platform,
      fakeUsername,
      fakeProfileUrl,
      realProfileUrl,
      reason,
      description,
      college,
      reporterName,
      reporterEmail: inputReporterEmail,
      anonymous,
      truthConfirmed
    } = req.body;

    if (!platform || !fakeUsername || !fakeProfileUrl || !reason || !description) {
      return res.status(400).json({
        success: false,
        message: 'Please fill in all required fields (Platform, Username, Fake Profile Link, Reason, and Description).'
      });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one evidence file (JPG, PNG, or PDF) is required.'
      });
    }

    if (truthConfirmed !== 'true' && truthConfirmed !== 'on' && truthConfirmed !== true) {
      return res.status(400).json({
        success: false,
        message: 'You must confirm that this report is truthful.'
      });
    }

    const reporterEmail = req.firebaseEmail || inputReporterEmail || null;
    const finalUserId = req.firebaseUid || (reporterEmail ? ('USER-' + Buffer.from(reporterEmail).toString('hex').substring(0, 10)) : ('USER-' + Date.now().toString(36)));

    const studentSafetyCases = safetyStore.getCases();
    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;
    const userRecentReports = studentSafetyCases.filter(c => {
      if (c.userId !== finalUserId && (!reporterEmail || c.reporterEmail !== reporterEmail)) return false;
      const createdTime = new Date(c.createdAt).getTime();
      if (isNaN(createdTime)) return false; // skip malformed entries
      return (now - createdTime) < oneDayMs;
    });

    if (userRecentReports.length >= 3) {
      return res.status(429).json({
        success: false,
        isRateLimited: true,
        message: "You have reached today's report limit. Please try again tomorrow."
      });
    }

    const targetUrl = normalizeProfileUrl(fakeProfileUrl);
    const existingCase = studentSafetyCases.find(c => {
      if (normalizeProfileUrl(c.fakeProfileUrl) !== targetUrl) return false;
      return c.status !== 'Rejected';
    });

    if (existingCase) {
      const isPublic = existingCase.status === 'Verified' || existingCase.status === 'Resolved';
      return res.status(409).json({
        success: false,
        isDuplicate: true,
        existingCaseId: existingCase.caseId,
        existingCaseStatus: existingCase.status,
        existingCasePublic: isPublic,
        message: isPublic
          ? 'This profile has already been reported. Would you like to support the existing case instead?'
          : 'This profile has already been reported and is under review. Track it in My Reports.'
      });
    }

    let structuredEvidence = [];
    if (Array.isArray(req.files) && req.files.length > 0) {
      try {
        const uploaded = await Promise.all(
          req.files.map(f => uploadSafetyEvidence(f.buffer, f.mimetype, f.originalname))
        );
        structuredEvidence = uploaded.filter(Boolean);
      } catch (uploadErr) {
        console.warn("[Evidence Upload Notice]:", uploadErr.message);
        structuredEvidence = [];
      }
    }

    const generatedCaseId = 'CASE-' + uuidv4().substring(0, 8).toUpperCase();

    const newCase = {
      caseId: generatedCaseId,
      userId: finalUserId,
      reporterName: reporterName || '',
      reporterEmail: reporterEmail,
      platform: platform,
      fakeUsername: fakeUsername,
      fakeProfileUrl: fakeProfileUrl,
      realProfileUrl: realProfileUrl || '',
      reason: reason,
      description: description,
      college: college || '',
      evidence: structuredEvidence,
      anonymous: anonymous === 'true' || anonymous === 'on' || anonymous === true,
      status: 'Pending Review',
      supportCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    studentSafetyCases.unshift(newCase);
    safetyStore.saveStudentSafetyCases();

    const notifs = safetyStore.getNotifications();
    const submitNotif = {
      notificationId: 'NOTIF-' + uuidv4().substring(0, 8).toUpperCase(),
      userId: finalUserId,
      caseId: generatedCaseId,
      title: 'Report Submitted',
      type: 'info',
      message: `Your fake profile report (Case ${generatedCaseId}) has been received. Our moderation team will review it within 24–48 hours.`,
      isRead: false,
      read: false,
      createdAt: new Date().toISOString()
    };
    notifs.unshift(submitNotif);
    safetyStore.saveNotifications();

    sendSafetyEmail(
      reporterEmail,
      `[2AM Study] Report Submitted — Case ${generatedCaseId}`,
      `<div style="font-family:Inter,sans-serif;max-width:600px;margin:auto;padding:32px;">
        <h2 style="color:#1e40af;">🛡️ Report Received</h2>
        <p>Hello,</p>
        <p>Your fake profile report has been successfully submitted to 2AM Study's Student Safety team.</p>
        <table style="width:100%;background:#f8fafc;border-radius:8px;padding:16px;margin:16px 0;">
          <tr><td><strong>Case ID:</strong></td><td>${generatedCaseId}</td></tr>
          <tr><td><strong>Platform:</strong></td><td>${platform}</td></tr>
          <tr><td><strong>Status:</strong></td><td>Pending Review</td></tr>
        </table>
        <p>Our moderation team will review your report within 24–48 hours. You'll be notified when the status changes.</p>
        <p style="color:#64748b;font-size:13px;">This is an automated message from 2AM Study Student Safety. Please do not reply.</p>
      </div>`
    );

    sendSafetyEmail(
      'hiiinishant@gmail.com',
      `🚨 [Action Required] New Fake Profile Report — Case ${generatedCaseId}`,
      `<div style="font-family:Inter,sans-serif;max-width:640px;margin:auto;padding:0;">
        <div style="background:linear-gradient(135deg,#dc2626,#b91c1c);padding:28px 32px;border-radius:12px 12px 0 0;">
          <div style="color:#fecaca;font-size:13px;font-weight:600;letter-spacing:0.05em;margin-bottom:6px;">🛡️ STUDENT IDENTITY SHIELD — ADMIN ALERT</div>
          <h1 style="color:#ffffff;margin:0;font-size:22px;font-weight:800;">🚨 New Fake Profile Report</h1>
          <div style="color:#fca5a5;font-size:13px;margin-top:6px;">Submitted on ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST</div>
        </div>
        <div style="background:#ffffff;padding:28px 32px;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0;">
          <table style="width:100%;border-collapse:collapse;">
            <tr style="border-bottom:1px solid #f1f5f9;"><td style="padding:10px 0;color:#64748b;font-size:13px;font-weight:600;width:38%;">Case ID</td><td style="padding:10px 0;color:#0f172a;font-size:13px;font-weight:700;font-family:monospace;">${generatedCaseId}</td></tr>
            <tr style="border-bottom:1px solid #f1f5f9;"><td style="padding:10px 0;color:#64748b;font-size:13px;font-weight:600;">Platform</td><td style="padding:10px 0;color:#0f172a;font-size:13px;font-weight:700;">${platform}</td></tr>
            <tr style="border-bottom:1px solid #f1f5f9;"><td style="padding:10px 0;color:#64748b;font-size:13px;font-weight:600;">Fake Username</td><td style="padding:10px 0;color:#dc2626;font-size:13px;font-weight:700;">@${fakeUsername}</td></tr>
            <tr style="border-bottom:1px solid #f1f5f9;"><td style="padding:10px 0;color:#64748b;font-size:13px;font-weight:600;">Fake Profile URL</td><td style="padding:10px 0;font-size:13px;"><a href="${fakeProfileUrl}" style="color:#2563eb;word-break:break-all;">${fakeProfileUrl}</a></td></tr>
            <tr style="border-bottom:1px solid #f1f5f9;"><td style="padding:10px 0;color:#64748b;font-size:13px;font-weight:600;">Reason</td><td style="padding:10px 0;color:#0f172a;font-size:13px;">${reason}</td></tr>
          </table>
        </div>
        <div style="background:#f8fafc;padding:24px 32px;text-align:center;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0;">
          <a href="https://2amstudy.online/admin#tab-safety" style="display:inline-block;background:linear-gradient(135deg,#dc2626,#b91c1c);color:#ffffff;padding:14px 32px;border-radius:50px;text-decoration:none;font-weight:700;font-size:15px;">🔍 Review &amp; Moderate Now</a>
        </div>
      </div>`
    );

    if (req.xhr || req.headers.accept?.includes('json')) {
      return res.json({
        success: true,
        caseId: generatedCaseId,
        userId: finalUserId,
        case: sanitizeCaseForOwner(newCase),
        message: '✅ Report Submitted Successfully\n\nOur moderation team will review your report within 24–48 hours.\n\nStatus: Pending Review'
      });
    }

    res.render('report-fake-profile', {
      pageTitle: 'Report Fake Profile | Student Identity Shield',
      metaDescription: 'Report fake student social media profiles and impersonation accounts securely.',
      successMessage: '✅ Report Submitted Successfully\nOur moderation team will review your report within 24–48 hours.',
      caseId: generatedCaseId,
      errorMessage: null
    });
  } catch (routeErr) {
    console.error("Error processing report:", routeErr);
    return res.status(500).json({ success: false, message: 'Server error processing your report. Please try again.' });
  }
});

// Admin Moderation Action Endpoint
router.post('/api/student-safety/admin/moderate', (req, res) => {
  const { caseId, action, note, moderatorUid, moderatorName } = req.body;
  if (!isMasterAdminAuthenticated(req)) {
    return res.status(401).json({ success: false, message: 'Unauthorized. Admin authentication required.' });
  }
  if (!caseId || !action) {
    return res.status(400).json({ success: false, message: 'caseId and action are required.' });
  }

  const studentSafetyCases = safetyStore.getCases();
  const caseIndex = studentSafetyCases.findIndex(c => c.caseId === caseId);
  if (caseIndex === -1) {
    return res.status(404).json({ success: false, message: `Case ${caseId} not found.` });
  }

  const targetCase = studentSafetyCases[caseIndex];
  const previousStatus = targetCase.status;
  const modUser = moderatorUid;
  const modName = moderatorName || 'Admin';
  let newStatus = targetCase.status;
  let notificationMsg = '';

  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  const userAgent = req.headers['user-agent'] || 'unknown';

  if (action === 'approve') {
    newStatus = 'Verified';
    targetCase.status = newStatus;
    targetCase.verifiedBy = modUser;
    targetCase.verifiedByName = modName;
    targetCase.verifiedAt = new Date().toISOString();
    targetCase.updatedAt = new Date().toISOString();
    notificationMsg = `Your impersonation report (Case ${caseId}) has been approved & verified by our moderation team.`;
  } else if (action === 'reject') {
    if (!note || note.trim() === '') {
      return res.status(400).json({ success: false, message: 'Rejection reason is required.' });
    }
    newStatus = 'Rejected';
    targetCase.status = newStatus;
    targetCase.rejectionReason = note.trim();
    targetCase.rejectedBy = modUser;
    targetCase.rejectedAt = new Date().toISOString();
    targetCase.updatedAt = new Date().toISOString();
    notificationMsg = `Your impersonation report (Case ${caseId}) was reviewed and rejected. Reason: ${targetCase.rejectionReason}`;
  } else if (action === 'request_evidence') {
    if (!note || note.trim() === '') {
      return res.status(400).json({ success: false, message: 'A moderator note describing required evidence is required.' });
    }
    newStatus = 'Needs Evidence';
    targetCase.status = newStatus;
    targetCase.moderatorNote = note.trim();
    targetCase.updatedAt = new Date().toISOString();
    notificationMsg = `Action required on Case ${caseId}: Our moderation team requested additional evidence. Note: ${targetCase.moderatorNote}`;
  } else if (action === 'resolve') {
    newStatus = 'Resolved';
    targetCase.status = newStatus;
    targetCase.resolvedBy = modUser;
    targetCase.resolvedAt = new Date().toISOString();
    targetCase.updatedAt = new Date().toISOString();
    notificationMsg = `Great news! Case ${caseId} has been officially marked as resolved. Thank you for keeping 2AM Study safe.`;
  } else if (action === 'reopen') {
    newStatus = 'Pending Review';
    targetCase.status = newStatus;
    targetCase.updatedAt = new Date().toISOString();
    notificationMsg = `Case ${caseId} has been reopened for moderation review.`;
  } else if (action === 'delete') {
    studentSafetyCases.splice(caseIndex, 1);
    safetyStore.saveStudentSafetyCases();

    const modLogs = safetyStore.getModerationLogs();
    modLogs.unshift({
      logId: 'LOG-' + uuidv4().substring(0, 8).toUpperCase(),
      caseId,
      moderatorUid: modUser,
      moderatorName: modName,
      action: 'delete',
      previousStatus,
      newStatus: 'Deleted',
      reason: note || 'Case deleted by admin',
      ip,
      userAgent,
      createdAt: new Date().toISOString()
    });
    safetyStore.saveModerationLogs();
    return res.json({ success: true, caseId, status: 'Deleted', message: `Case ${caseId} has been permanently deleted.` });
  } else {
    return res.status(400).json({ success: false, message: 'Invalid moderation action.' });
  }

  safetyStore.saveStudentSafetyCases();

  const modLogs = safetyStore.getModerationLogs();
  modLogs.unshift({
    logId: 'LOG-' + uuidv4().substring(0, 8).toUpperCase(),
    caseId,
    moderatorUid: modUser,
    moderatorName: modName,
    action,
    previousStatus,
    newStatus,
    reason: note || (action + ' action executed'),
    ip,
    userAgent,
    createdAt: new Date().toISOString()
  });
  safetyStore.saveModerationLogs();

  // Trigger notifications
  if (action === 'approve') {
    dispatchSmartNotification({
      userId: targetCase.userId,
      userEmail: targetCase.reporterEmail,
      caseId,
      title: `[2AM Study] Case ${caseId} Verified ✅`,
      message: `Your report for ${targetCase.fakeUsername || 'fake profile'} has been verified by our moderation team.`,
      targetUrl: `/student-safety/cases/${caseId}`
    });
  }

  return res.json({
    success: true,
    caseId: targetCase.caseId,
    status: targetCase.status,
    case: targetCase,
    message: `Case ${caseId} successfully updated to status "${targetCase.status}".`
  });
});

// Additional Public & User APIs
router.get('/api/student-safety/vapid-public-key', (req, res) => {
  const keys = safetyStore.getVapidKeys();
  res.json({ success: true, publicKey: keys ? keys.publicKey : null });
});

router.post('/api/student-safety/save-push-token', (req, res) => {
  const { userId, userEmail, pushSubscription, pushEnabled, emailNotifications, safetyAlerts } = req.body;
  const key = userId || userEmail;
  if (!key) return res.status(400).json({ success: false, message: 'userId or userEmail required.' });

  const userPushSubscriptions = safetyStore.getPushSubscriptions();
  userPushSubscriptions[key] = {
    userId: userId || null,
    userEmail: userEmail || null,
    pushSubscription: pushSubscription || (userPushSubscriptions[key] ? userPushSubscriptions[key].pushSubscription : null),
    pushEnabled: pushEnabled !== undefined ? pushEnabled : true,
    emailNotifications: emailNotifications !== undefined ? emailNotifications : true,
    safetyAlerts: safetyAlerts !== undefined ? safetyAlerts : true,
    updatedAt: new Date().toISOString()
  };
  safetyStore.savePushSubscriptions();
  res.json({ success: true, message: 'Notification preferences & push token saved cleanly.' });
});

router.get('/api/student-safety/my-reports', verifyFirebaseToken, (req, res) => {
  const authUid = req.firebaseUid;
  const authEmail = (req.firebaseEmail || '').toLowerCase().trim();

  if (!authUid && !authEmail) {
    return res.status(401).json({ success: false, message: 'Authentication required. Please log in to view your reports.' });
  }

  const userCases = safetyStore.getCases()
    .filter(c => {
      const uidMatch = c.userId && authUid && c.userId === authUid;
      const emailMatch = authEmail && c.reporterEmail && c.reporterEmail.toLowerCase().trim() === authEmail;
      return uidMatch || emailMatch;
    })
    .map(c => sanitizeCaseForOwner(c))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  res.json({ success: true, count: userCases.length, cases: userCases });
});

router.get('/api/student-safety/cases', (req, res) => {
  // Only master admin gets raw data; all other callers get sanitized owner-view
  if (isMasterAdminAuthenticated(req)) {
    return res.json({ success: true, cases: safetyStore.getCases() });
  }
  // Non-admin: return sanitized cases (hides reporterEmail on anonymous reports)
  const sanitized = safetyStore.getCases().map(c => sanitizeCaseForOwner(c));
  res.json({ success: true, cases: sanitized });
});

router.get('/api/student-safety/public-cases', (req, res) => {
  const { platform, college, sortBy, query } = req.query;

  let publicCases = safetyStore.getCases()
    .filter(c => c.status === 'Verified' || c.status === 'Resolved')
    .map(c => sanitizeCaseForPublic(c));

  if (platform && platform !== 'ALL') publicCases = publicCases.filter(c => c.platform === platform);
  if (college && college !== 'ALL') publicCases = publicCases.filter(c => c.college === college);

  if (query) {
    const q = query.toLowerCase();
    publicCases = publicCases.filter(c =>
      (c.fakeUsername || '').toLowerCase().includes(q) ||
      (c.college || '').toLowerCase().includes(q) ||
      (c.caseId || '').toLowerCase().includes(q)
    );
  }

  if (sortBy === 'newest') {
    publicCases.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  } else {
    publicCases.sort((a, b) => (b.supportCount || 0) - (a.supportCount || 0));
  }

  res.json({ success: true, cases: publicCases, total: publicCases.length });
});

// Trust Score for a specific user
router.get('/api/student-safety/trust-score/:userId', (req, res) => {
  const { userId } = req.params;
  if (!userId) return res.status(400).json({ success: false, message: 'userId is required.' });

  const allCases = safetyStore.getCases();
  const allSupports = safetyStore.getSupports();

  const userCases = allCases.filter(c => c.userId === userId || c.reporterEmail === userId);
  const verifiedReports = userCases.filter(c => c.status === 'Verified' || c.status === 'Resolved').length;
  const pendingReports = userCases.filter(c => c.status === 'Pending Review').length;
  const rejectedReports = userCases.filter(c => c.status === 'Rejected').length;
  const supportsGiven = allSupports.filter(s => s.userId === userId).length;

  // Trust score formula: verified*15 + pending*2 + supportsGiven*3 - rejected*5, capped at 100
  let trustScore = Math.min(100, Math.max(0, (verifiedReports * 15) + (pendingReports * 2) + (supportsGiven * 3) - (rejectedReports * 5)));
  if (userCases.length === 0 && supportsGiven === 0) trustScore = 0;

  const badgeDefinitions = [
    { key: 'student_protector', label: 'Student Protector', icon: '🛡️', desc: 'Submitted at least one report', earned: userCases.length >= 1 },
    { key: 'verified_reporter', label: 'Verified Reporter', icon: '✅', desc: 'Had a report verified by admins', earned: verifiedReports >= 1 },
    { key: 'community_guardian', label: 'Community Guardian', icon: '🏅', desc: 'Supported 3+ verified cases', earned: supportsGiven >= 3 },
    { key: 'trusted_reporter', label: 'Trusted Reporter', icon: '🏆', desc: 'Achieved trust score of 75+', earned: trustScore >= 75 },
    { key: 'multi_reporter', label: 'Multi Reporter', icon: '📋', desc: 'Submitted 3+ reports', earned: userCases.length >= 3 }
  ];

  const badges = badgeDefinitions.filter(b => b.earned).map(({ key, label, icon, desc }) => ({ key, label, icon, desc }));

  res.json({
    success: true,
    userId,
    trustScore,
    badges,
    stats: { totalReports: userCases.length, verifiedReports, pendingReports, rejectedReports, supportsGiven }
  });
});

// Leaderboard — top contributors by trust score
router.get('/api/student-safety/leaderboard', (req, res) => {
  const allCases = safetyStore.getCases();
  const allSupports = safetyStore.getSupports();

  // Aggregate per userId
  const userMap = {};

  allCases.forEach(c => {
    const uid = c.userId || c.reporterEmail;
    if (!uid) return;
    if (!userMap[uid]) userMap[uid] = { userId: uid, totalReports: 0, verifiedReports: 0, rejectedReports: 0, supportsGiven: 0 };
    userMap[uid].totalReports++;
    if (c.status === 'Verified' || c.status === 'Resolved') userMap[uid].verifiedReports++;
    if (c.status === 'Rejected') userMap[uid].rejectedReports++;
  });

  allSupports.forEach(s => {
    const uid = s.userId;
    if (!uid) return;
    if (!userMap[uid]) userMap[uid] = { userId: uid, totalReports: 0, verifiedReports: 0, rejectedReports: 0, supportsGiven: 0 };
    userMap[uid].supportsGiven++;
  });

  const leaderboard = Object.values(userMap)
    .map(u => {
      const score = Math.min(100, Math.max(0, (u.verifiedReports * 15) + (u.supportsGiven * 3) - (u.rejectedReports * 5)));
      // Anonymize: show only first 3 chars + *** of userId
      const uid = String(u.userId);
      const displayId = uid.length > 6 ? uid.substring(0, 3) + '***' + uid.slice(-3) : uid.substring(0, 3) + '***';
      return { userId: u.userId, displayId, verifiedReports: u.verifiedReports, supportsGiven: u.supportsGiven, score };
    })
    .filter(u => u.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  res.json({ success: true, leaderboard });
});

// View active cases & detail
router.get('/student-safety/cases', (req, res) => {
  const publicCases = safetyStore.getCases()
    .filter(c => c.status === 'Verified' || c.status === 'Resolved')
    .map(c => sanitizeCaseForPublic(c))
    .sort((a, b) => (b.supportCount || 0) - (a.supportCount || 0));

  const colleges = Array.from(new Set(publicCases.map(c => c.college).filter(Boolean)));

  res.render('active-cases', {
    pageTitle: '🛡️ Active Community Cases | Student Identity Shield',
    metaDescription: 'Browse admin-verified student impersonation cases.',
    initialCases: publicCases,
    colleges
  });
});

router.get('/student-safety/cases/:caseId', (req, res) => {
  const foundCase = safetyStore.getCases().find(c => c.caseId === req.params.caseId && (c.status === 'Verified' || c.status === 'Resolved'));
  if (!foundCase) {
    return res.status(404).render('student-safety', {
      pageTitle: 'Case Not Found | Student Identity Shield',
      metaDescription: 'This case was not found or is not publicly available.',
      activeTab: 'overview'
    });
  }
  res.render('case-detail', {
    pageTitle: `Case ${foundCase.caseId} | Student Identity Shield`,
    metaDescription: `Admin-verified impersonation case on ${foundCase.platform}.`,
    caseData: sanitizeCaseForPublic(foundCase)
  });
});

// Support a case (accepts both /student-safety/cases/:caseId/support and /api/student-safety/cases/:caseId/support)
router.post(['/student-safety/cases/:caseId/support', '/api/student-safety/cases/:caseId/support'], async (req, res) => {
  const { caseId } = req.params;
  let { userId, userEmail } = req.body || {};
  if (!userId || typeof userId !== 'string' || !userId.trim()) {
    userId = req.ip || ('ANON-' + uuidv4().substring(0, 8));
  }
  userId = userId.trim();

  const cases = safetyStore.getCases();
  const caseIndex = cases.findIndex(c => c.caseId === caseId && (c.status === 'Verified' || c.status === 'Resolved'));
  if (caseIndex === -1) return res.status(404).json({ success: false, message: 'Case not found or not publicly available.' });

  const supports = safetyStore.getSupports();
  const alreadySupported = supports.find(s => s.caseId === caseId && s.userId === userId);
  if (alreadySupported) {
    return res.status(409).json({ success: false, isDuplicate: true, message: 'You have already supported this case.', supportCount: cases[caseIndex].supportCount || 0 });
  }

  supports.push({
    supportId: 'SUPPORT-' + uuidv4().substring(0, 8).toUpperCase(),
    caseId,
    userId,
    userEmail: userEmail || null,
    createdAt: new Date().toISOString()
  });
  safetyStore.saveStudentSafetySupports();

  cases[caseIndex].supportCount = (cases[caseIndex].supportCount || 0) + 1;
  cases[caseIndex].updatedAt = new Date().toISOString();
  safetyStore.saveStudentSafetyCases();

  res.json({ success: true, supportCount: cases[caseIndex].supportCount, message: '✅ Thank you! You supported this case.' });
});

router.get('/student-safety/my-reports', (req, res) => {
  res.render('my-reports', {
    pageTitle: '📄 My Reports | Student Identity Shield',
    metaDescription: 'Track your submitted fake profile reports.'
  });
});

module.exports = router;
