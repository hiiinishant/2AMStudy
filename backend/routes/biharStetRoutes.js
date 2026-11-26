const express = require('express');
const multer = require('multer');
const { hasAdminSession, requireBiharStetAdmin } = require('../middleware/biharStetAdminAuth');
const biharStetStore = require('../models/biharStetStore');
const { parseResponseSheetText, readPdfString, scoreResponses, validateMarkingScheme } = require('../services/biharStetMarks');
const { extractOfficialAnswerKeyPdf } = require('../services/biharStetAnswerKeyPdf');
const { deleteFromCloudinary, isCloudinaryConfigured, uploadToCloudinary } = require('../config/cloudinary');
const crypto = require('crypto');
const path = require('path');

const router = express.Router();
const scoreAttempts = new Map();
const readAttempts = new Map();
const SCORE_WINDOW_MS = 5 * 60 * 1000;
const MAX_SCORES_PER_WINDOW = 30;
const MAX_READS_PER_WINDOW = 120;
const responseUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 8, parts: 10, fieldSize: 128 * 1024 },
  fileFilter(req, file, callback) {
    if (/\.pdf$/i.test(file.originalname) && ['application/pdf', 'application/octet-stream'].includes(file.mimetype)) {
      return callback(null, true);
    }
    return callback(new Error('Upload a PDF response sheet.'));
  }
});
const keyUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 1, parts: 2, fieldSize: 4 * 1024 },
  fileFilter(req, file, callback) {
    if (/\.json$/i.test(file.originalname) && ['application/json', 'text/json', 'application/octet-stream'].includes(file.mimetype)) {
      return callback(null, true);
    }
    return callback(new Error('Upload an answer-key JSON file.'));
  }
});
const keyPdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 2, parts: 4, fieldSize: 128 * 1024 },
  fileFilter(req, file, callback) {
    if (/\.pdf$/i.test(file.originalname) && ['application/pdf', 'application/octet-stream'].includes(file.mimetype)) {
      return callback(null, true);
    }
    return callback(new Error('Upload an official answer-key PDF.'));
  }
});

router.use('/api/bihar-stet', (req, res, next) => {
  res.setHeader('Cache-Control', 'private, no-store');
  next();
});

function isRateLimited(req, attempts, maximum) {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  const record = attempts.get(ip);
  if (!record || now - record.startedAt >= SCORE_WINDOW_MS) {
    if (attempts.size >= 5000) {
      attempts.delete(attempts.keys().next().value);
    }
    attempts.set(ip, { startedAt: now, count: 1 });
    return false;
  }
  record.count += 1;
  return record.count > maximum;
}

function sendUploadError(req, res, error) {
  if (req.file?.buffer) req.file.buffer.fill(0);
  if (req.file) req.file.buffer = null;
  const status = error?.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
  return res.status(status).json({ success: false, error: error?.message || 'Upload could not be processed.' });
}

function sendError(res, error, fallback) {
  const message = error?.message || fallback;
  if (error?.code || error?.name === 'FirebaseError') {
    console.error('[Bihar STET] Firestore operation failed:', message);
    return res.status(503).json({ success: false, error: fallback });
  }
  const status = /Firestore is not configured/.test(message) ? 503 :
    /not found/i.test(message) ? 404 : 400;
  return res.status(status).json({ success: false, error: message });
}

function readRequestPayload(req) {
  if (req.file) {
    return JSON.parse(req.file.buffer.toString('utf8'));
  }
  return req.body || {};
}

function getExamSelection(input) {
  return {
    year: input.year,
    paperId: input.paperId,
    subjectId: input.subjectId,
    shiftId: input.shiftId
  };
}

function clearUpload(req) {
  if (req.file?.buffer) req.file.buffer.fill(0);
  if (req.file) req.file.buffer = null;
}

function safeOriginalFileName(filename) {
  const basename = path.posix.basename(String(filename || '').replace(/\\/g, '/'));
  return basename.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 120) || 'official-answer-key.pdf';
}

router.get('/tools/bihar-stet-marks-predictor', (req, res) => {
  res.render('tools/bihar-stet-marks-predictor', {
    pageTitle: 'Bihar STET 2026 Marks Predictor | 2AM Study',
    metaDescription: 'Estimate Bihar STET raw marks using a published answer key. Upload a response sheet or enter answers manually.',
    pageCss: '/assets/css/bihar-stet.css?v=4'
  });
});

router.get('/admin/bihar-stet', (req, res) => {
  if (!hasAdminSession(req)) {
    return res.redirect('/admin?redirect=' + encodeURIComponent('/admin/bihar-stet'));
  }
  res.removeHeader('Access-Control-Allow-Origin');
  res.removeHeader('Access-Control-Allow-Credentials');
  res.setHeader('Cache-Control', 'private, no-store');
  return res.render('admin-bihar-stet', {
    pageTitle: 'Bihar STET Answer Key Admin | 2AM Study',
    metaDescription: 'Manage Bihar STET answer-key versions and marking schemes.',
    pageCss: '/assets/css/bihar-stet.css?v=6'
  });
});

router.get('/api/bihar-stet/catalog', async (req, res) => {
  if (isRateLimited(req, readAttempts, MAX_READS_PER_WINDOW)) {
    return res.status(429).json({ success: false, error: 'Too many requests. Please wait a few minutes and try again.' });
  }
  try {
    const catalog = await biharStetStore.getCatalog();
    return res.json({ success: true, catalog });
  } catch (error) {
    return sendError(res, error, 'Could not load published Bihar STET answer keys.');
  }
});

router.get('/api/bihar-stet/key-questions', async (req, res) => {
  if (isRateLimited(req, readAttempts, MAX_READS_PER_WINDOW)) {
    return res.status(429).json({ success: false, error: 'Too many requests. Please wait a few minutes and try again.' });
  }
  try {
    const key = await biharStetStore.getPublishedKey(getExamSelection(req.query));
    if (!key) return res.status(404).json({ success: false, error: 'No published answer key is available for this paper, subject, and shift.' });
    return res.json({
      success: true,
      questionIds: key.questions.map(question => question.id),
      questionCount: key.questions.length,
      keyStatus: key.keyStatus,
      keyVersion: key.version,
      keyVersionId: key.versionId,
      subjectName: key.metadata.subjectName,
      shiftName: key.metadata.shiftName
    });
  } catch (error) {
    return sendError(res, error, 'Could not load question IDs.');
  }
});

router.post('/api/bihar-stet/score', (req, res) => {
  if (isRateLimited(req, scoreAttempts, MAX_SCORES_PER_WINDOW)) {
    return res.status(429).json({ success: false, error: 'Too many score requests. Please wait a few minutes and try again.' });
  }
  responseUpload.single('responseSheet')(req, res, async uploadError => {
    if (uploadError) return sendUploadError(req, res, uploadError);
    try {
      const input = req.body || {};
      const key = await biharStetStore.getPublishedKey(getExamSelection(input));
      if (!key) {
        return res.status(409).json({ success: false, error: 'No published answer key is available for this paper, subject, and shift.' });
      }

      let responses;
      let sourceType;
      if (req.file) {
        const pdfText = readPdfString(req.file.buffer);
        responses = parseResponseSheetText(pdfText);
        sourceType = 'pdf';
      } else {
        let submitted = input.responses;
        if (typeof submitted === 'string') {
          try {
            submitted = JSON.parse(submitted);
          } catch (_) {
            return res.status(400).json({ success: false, error: 'Manual answers must be valid JSON.' });
          }
        }
        if (!Array.isArray(submitted)) {
          return res.status(400).json({ success: false, error: 'Upload a PDF or submit manual answers.' });
        }
        responses = submitted.map(response => ({
          questionId: String(response?.questionId || ''),
          answer: response?.answer === null || response?.answer === undefined || response?.answer === ''
            ? null
            : String(response.answer),
          readable: response?.readable !== false
        }));
        sourceType = 'manual';
      }

      const result = scoreResponses({
        questions: key.questions,
        responses,
        markingScheme: key.markingScheme,
        keyStatus: key.keyStatus,
        answerKeyVerified: key.answerKeyVerified,
        markingRulesVerified: key.markingRulesVerified,
        sourceType
      });
      return res.json({
        success: true,
        exam: {
          year: key.metadata.year,
          paperId: key.metadata.paperId,
          subjectName: key.metadata.subjectName,
          shiftName: key.metadata.shiftName,
          keyVersion: key.version,
          keyStatus: key.keyStatus
        },
        result
      });
    } catch (error) {
      const isParserError = /PDF|response sheet|question IDs|readable/i.test(error?.message || '');
      if (/Firestore is not configured/.test(error?.message || '')) {
        return res.status(503).json({ success: false, error: error.message });
      }
      if (error?.code || error?.name === 'FirebaseError') {
        console.error('[Bihar STET] Firestore scoring lookup failed:', error.message);
        return res.status(503).json({ success: false, error: 'Could not load the published Bihar STET answer key.' });
      }
      return res.status(isParserError ? 422 : 400).json({ success: false, error: error.message || 'Could not calculate marks.' });
    } finally {
      if (req.file?.buffer) req.file.buffer.fill(0);
      if (req.file) req.file.buffer = null;
    }
  });
});

router.get('/api/bihar-stet/admin/keys', requireBiharStetAdmin, async (req, res) => {
  try {
    return res.json({ success: true, keys: await biharStetStore.listAdminKeys() });
  } catch (error) {
    return sendError(res, error, 'Could not load answer-key versions.');
  }
});

router.post('/api/bihar-stet/admin/keys/preview-pdf', requireBiharStetAdmin, (req, res) => {
  keyPdfUpload.single('answerKeyPdf')(req, res, uploadError => {
    if (uploadError) return sendUploadError(req, res, uploadError);
    try {
      if (!req.file) return res.status(400).json({ success: false, error: 'Select an official answer-key PDF.' });
      const extraction = extractOfficialAnswerKeyPdf(req.file.buffer);
      return res.json({ success: true, ...extraction });
    } catch (error) {
      return res.status(422).json({ success: false, error: error.message || 'Could not read the answer-key PDF.' });
    } finally {
      clearUpload(req);
    }
  });
});

router.post('/api/bihar-stet/admin/keys/from-pdf', requireBiharStetAdmin, (req, res) => {
  keyPdfUpload.single('answerKeyPdf')(req, res, async uploadError => {
    if (uploadError) return sendUploadError(req, res, uploadError);
    let uploadedDocument;
    try {
      if (!req.file) return res.status(400).json({ success: false, error: 'Select an official answer-key PDF.' });
      if (!isCloudinaryConfigured()) {
        return res.status(503).json({
          success: false,
          error: 'Secure PDF archival is not configured. Configure Cloudinary before saving PDF-based answer keys.'
        });
      }

      let payload;
      try {
        payload = JSON.parse(req.body?.payload || '');
      } catch (_) {
        return res.status(400).json({ success: false, error: 'Reviewed answer-key details must be valid JSON.' });
      }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return res.status(400).json({ success: false, error: 'Reviewed answer-key details are required.' });
      }
      try {
        biharStetStore.validateMetadata(payload.metadata || {});
        if (!payload.metadata?.examDate) {
          throw new Error('Select the official examination date before saving this PDF answer key.');
        }
        biharStetStore.validateQuestions(payload.questions);
        validateMarkingScheme(payload.markingScheme);
        if (!String(payload.source || '').trim() || !String(payload.markingRulesSource || '').trim()) {
          throw new Error('Provide separate official answer-key and marking-rules source citations.');
        }
      } catch (error) {
        return res.status(400).json({ success: false, error: error.message });
      }
      try {
        extractOfficialAnswerKeyPdf(req.file.buffer);
      } catch (error) {
        return res.status(422).json({ success: false, error: error.message || 'The uploaded file is not a supported PDF.' });
      }

      try {
        uploadedDocument = await uploadToCloudinary(req.file.buffer, {
          folder: 'bihar-stet-answer-keys',
          prefix: 'official_key',
          mimetype: 'application/pdf',
          filename: 'official-answer-key.pdf',
          fileExtension: 'pdf',
          resourceType: 'raw',
          deliveryType: 'authenticated'
        });
      } catch (error) {
        console.error('[Bihar STET] Secure source PDF upload failed:', error.message);
        return res.status(503).json({ success: false, error: 'Could not securely archive the official answer-key PDF.' });
      }

      const sourceDocument = {
        provider: 'cloudinary',
        publicId: uploadedDocument.publicId,
        resourceType: 'raw',
        deliveryType: 'authenticated',
        fileName: safeOriginalFileName(req.file.originalname),
        bytes: uploadedDocument.bytes,
        sha256: crypto.createHash('sha256').update(req.file.buffer).digest('hex'),
        uploadedAt: new Date().toISOString()
      };
      try {
        const version = await biharStetStore.createKeyVersion({ ...payload, sourceDocument });
        return res.status(201).json({ success: true, ...version });
      } catch (error) {
        try {
          await deleteFromCloudinary({
            publicId: uploadedDocument.publicId,
            resourceType: 'raw',
            deliveryType: 'authenticated'
          });
        } catch (cleanupError) {
          console.error('[Bihar STET] Private source PDF cleanup failed:', cleanupError.message);
          return res.status(503).json({
            success: false,
            error: 'Could not save the draft and the private PDF archive requires administrator cleanup.'
          });
        }
        return sendError(res, error, 'Could not save answer-key draft.');
      }
    } finally {
      clearUpload(req);
    }
  });
});

router.post('/api/bihar-stet/admin/keys', requireBiharStetAdmin, (req, res) => {
  keyUpload.single('answerKey')(req, res, async uploadError => {
    if (uploadError) return sendUploadError(req, res, uploadError);
    try {
      const payload = readRequestPayload(req);
      if (!payload || typeof payload !== 'object') throw new Error('Answer key must be a JSON object.');
      const version = await biharStetStore.createKeyVersion(payload);
      return res.status(201).json({ success: true, ...version });
    } catch (error) {
      return sendError(res, error, 'Could not save answer-key version.');
    } finally {
      if (req.file?.buffer) req.file.buffer.fill(0);
      if (req.file) req.file.buffer = null;
    }
  });
});

router.put('/api/bihar-stet/admin/keys/:keyId', requireBiharStetAdmin, async (req, res) => {
  try {
    await biharStetStore.updateKeyMetadata({
      keyId: req.params.keyId,
      subjectName: req.body?.subjectName,
      shiftName: req.body?.shiftName
    });
    return res.json({ success: true });
  } catch (error) {
    return sendError(res, error, 'Could not update subject and shift names.');
  }
});

router.post('/api/bihar-stet/admin/keys/:keyId/versions/:versionId/edit', requireBiharStetAdmin, async (req, res) => {
  try {
    const version = await biharStetStore.updateKeyVersion({
      keyId: req.params.keyId,
      versionId: req.params.versionId,
      questions: req.body?.questions,
      markingScheme: req.body?.markingScheme,
      source: req.body?.source,
      markingRulesSource: req.body?.markingRulesSource,
      notes: req.body?.notes
    });
    return res.status(201).json({ success: true, ...version });
  } catch (error) {
    return sendError(res, error, 'Could not create revised answer-key version.');
  }
});

router.post('/api/bihar-stet/admin/keys/:keyId/versions/:versionId/publish', requireBiharStetAdmin, async (req, res) => {
  try {
    await biharStetStore.publishKeyVersion({
      keyId: req.params.keyId,
      versionId: req.params.versionId,
      status: req.body?.status,
      answersVerified: req.body?.answersVerified,
      markingRulesVerified: req.body?.markingRulesVerified
    });
    return res.json({ success: true });
  } catch (error) {
    return sendError(res, error, 'Could not publish answer-key version.');
  }
});

module.exports = router;
