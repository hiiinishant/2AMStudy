const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const sessionStore = require('../models/sessionStore');
const { extractYoutubeVideoId } = require('../models/collegeLifeStore');
const {
  isMasterAdminAuthenticated,
  checkMasterPassword,
  getClientIp,
  checkAdminRateLimit,
  recordAdminLoginFailure,
  recordAdminLoginSuccess
} = require('../middleware/adminAuth');

// Helper to format elapsed session duration nicely
function formatElapsedDuration(startIso, endIso) {
  if (!startIso || !endIso) return '1 Hour';
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  const diffMs = Math.max(0, end - start);
  const diffMin = Math.round(diffMs / (1000 * 60));
  if (diffMin < 1) return '1 Min';
  const hours = Math.floor(diffMin / 60);
  const mins = diffMin % 60;
  if (hours > 0 && mins > 0) return `${hours} Hr ${mins} Min`;
  if (hours > 0) return `${hours} ${hours === 1 ? 'Hour' : 'Hours'}`;
  return `${mins} Min`;
}

// GET — Public live study page
router.get('/live-study', (req, res) => {
  const studySessions = sessionStore.getSessions();
  const liveSession = studySessions.find(s => s.status === 'LIVE') || null;
  const pastSessions = studySessions
    .filter(s => s.status === 'COMPLETED')
    .sort((a, b) => new Date(b.endedAt || b.createdAt) - new Date(a.endedAt || a.createdAt));
  res.render('live-study', {
    pageTitle: 'Live Study Sessions | 2AM Study',
    metaDescription: 'Join our live study sessions on 2AM Study. Watch the admin YouTube Live stream and browse past recorded study challenges.',
    liveSession,
    pastSessions
  });
});

// GET — Individual session detail page
router.get('/live-study/:id', (req, res) => {
  const studySessions = sessionStore.getSessions();
  const session = studySessions.find(s => s.id === req.params.id);
  if (!session) {
    return res.status(404).render('live-study-session', {
      pageTitle: 'Session Not Found | 2AM Study',
      metaDescription: 'This study session could not be found.',
      session: null
    });
  }
  res.render('live-study-session', {
    pageTitle: `${session.title} | 2AM Study`,
    metaDescription: session.description || `Watch the ${session.title} recording on 2AM Study.`,
    session
  });
});

// GET — Admin panel page (redirects to unified Master Admin)
router.get('/live-admin', (req, res) => {
  res.redirect('/admin#tab-live');
});

// GET — Public status API (used by header and pages)
router.get('/api/live-study/status', (req, res) => {
  const studySessions = sessionStore.getSessions();
  const liveSession = studySessions.find(s => s.status === 'LIVE') || null;
  res.json({ isLive: !!liveSession, session: liveSession });
});

// GET — All sessions list (admin only — requires auth session)
router.get('/api/live-study/all', (req, res) => {
  if (!isMasterAdminAuthenticated(req)) return res.status(403).json({ success: false, message: 'Not authorised.' });
  const studySessions = sessionStore.getSessions();
  const sorted = [...studySessions].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ success: true, sessions: sorted });
});

// POST — Verify admin password
router.post('/api/live-study/auth', (req, res) => {
  const clientIp = getClientIp(req);
  const rateLimitErr = checkAdminRateLimit(clientIp);
  if (rateLimitErr) {
    return res.status(429).json({ success: false, message: rateLimitErr });
  }

  const { password } = req.body;
  if (checkMasterPassword(password)) {
    recordAdminLoginSuccess(clientIp);
    req.session.isAdmin = true;
    req.session.isStoreAdmin = true;
    req.session.liveAdminAuthed = true;
    req.session.adminLoggedInAt = new Date().toISOString();
    return res.json({ success: true });
  }

  const lockMessage = recordAdminLoginFailure(clientIp);
  return res.status(lockMessage ? 429 : 401).json({
    success: false,
    message: lockMessage || 'Incorrect password.'
  });
});

// POST — Activate a live session
router.post('/api/live-study/activate', (req, res) => {
  if (!isMasterAdminAuthenticated(req)) return res.status(403).json({ success: false, message: 'Not authorised.' });
  const { youtubeUrl, title, description, duration } = req.body;
  if (!youtubeUrl || !title) return res.status(400).json({ success: false, message: 'URL and title are required.' });

  const videoId = extractYoutubeVideoId(youtubeUrl);
  if (!videoId) return res.status(400).json({ success: false, message: 'Could not extract YouTube video ID from that URL.' });

  const studySessions = sessionStore.getSessions();
  const existingLive = studySessions.find(s => s.status === 'LIVE');
  if (existingLive) {
    return res.status(409).json({ success: false, message: 'A live session is already active. End it first before starting a new one.', existingSession: existingLive });
  }

  const now = new Date().toISOString();
  const session = {
    id: uuidv4(),
    title: title.trim(),
    description: (description || '').trim(),
    youtubeUrl: youtubeUrl.trim(),
    youtubeVideoId: videoId,
    thumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
    duration: (duration || '').trim(),
    status: 'LIVE',
    scheduledAt: null,
    startedAt: now,
    endedAt: null,
    createdAt: now
  };
  studySessions.unshift(session);
  sessionStore.saveStudySessions();
  res.json({ success: true, session });
});

// POST — End the current live session
router.post('/api/live-study/end', (req, res) => {
  if (!isMasterAdminAuthenticated(req)) return res.status(403).json({ success: false, message: 'Not authorised.' });
  let ended = false;
  const now = new Date().toISOString();
  const studySessions = sessionStore.getSessions();
  studySessions.forEach(s => {
    if (s.status === 'LIVE') {
      s.status = 'COMPLETED';
      s.endedAt = now;
      if (!s.duration || s.duration.trim() === '') {
        s.duration = formatElapsedDuration(s.startedAt, s.endedAt);
      }
      ended = true;
    }
  });
  sessionStore.saveStudySessions();
  if (ended) return res.json({ success: true });
  res.json({ success: false, message: 'No active live session found.' });
});

// POST — Manually add a past session
router.post('/api/live-study/add-past', (req, res) => {
  if (!isMasterAdminAuthenticated(req)) return res.status(403).json({ success: false, message: 'Not authorised.' });
  const { youtubeUrl, title, description, duration, sessionDate, thumbnail } = req.body;
  if (!youtubeUrl || !title) return res.status(400).json({ success: false, message: 'URL and title are required.' });

  const videoId = extractYoutubeVideoId(youtubeUrl);
  if (!videoId) return res.status(400).json({ success: false, message: 'Could not extract YouTube video ID.' });

  const studySessions = sessionStore.getSessions();
  const duplicate = studySessions.find(s => s.youtubeVideoId === videoId);
  if (duplicate) {
    return res.status(409).json({ success: false, message: 'This YouTube recording has already been added.' });
  }

  const session = {
    id: uuidv4(),
    title: title.trim(),
    description: (description || '').trim(),
    youtubeUrl: youtubeUrl.trim(),
    youtubeVideoId: videoId,
    thumbnail: thumbnail && thumbnail.trim() ? thumbnail.trim() : `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
    duration: (duration || '').trim(),
    status: 'COMPLETED',
    scheduledAt: null,
    startedAt: sessionDate ? new Date(sessionDate).toISOString() : new Date().toISOString(),
    endedAt: sessionDate ? new Date(sessionDate).toISOString() : new Date().toISOString(),
    createdAt: new Date().toISOString()
  };
  studySessions.unshift(session);
  sessionStore.saveStudySessions();
  res.json({ success: true, session });
});

// DELETE — Remove a session (cannot delete active LIVE session)
router.delete('/api/live-study/delete/:id', (req, res) => {
  if (!isMasterAdminAuthenticated(req)) return res.status(403).json({ success: false, message: 'Not authorised.' });
  const { id } = req.params;
  const studySessions = sessionStore.getSessions();
  const target = studySessions.find(s => s.id === id);
  if (!target) return res.status(404).json({ success: false, message: 'Session not found.' });
  if (target.status === 'LIVE') return res.status(400).json({ success: false, message: 'Cannot delete an active LIVE session. End it first.' });
  
  sessionStore.setSessions(studySessions.filter(s => s.id !== id));
  sessionStore.saveStudySessions();
  res.json({ success: true });
});

module.exports = router;
