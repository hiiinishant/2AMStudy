const express = require('express');
const router = express.Router();
const {
  checkMasterPassword,
  getClientIp,
  checkAdminRateLimit,
  recordAdminLoginFailure,
  recordAdminLoginSuccess
} = require('../middleware/adminAuth');

// --- User Auth & Session Sync ---
router.post('/api/auth/session', (req, res) => {
  const { user } = req.body;
  if (user) {
    req.session.user = {
      uid: user.uid,
      email: user.email,
      name: user.displayName || user.name || user.email?.split('@')[0] || 'Student',
      photoURL: user.photoURL || null
    };
  } else {
    delete req.session.user;
  }
  res.json({ success: true, user: req.session.user || null, isAdmin: !!req.session.isAdmin });
});

router.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

router.get('/api/auth/me', (req, res) => {
  const user = req.session.user || null;
  res.json({ success: true, loggedIn: !!user, user, isAdmin: !!req.session?.isAdmin });
});

// --- Master Admin Login Action ---
function handleAdminLogin(req, res) {
  const clientIp = getClientIp(req);
  const rateLimitErr = checkAdminRateLimit(clientIp);
  if (rateLimitErr) {
    return res.status(429).json({ success: false, error: rateLimitErr });
  }

  const password = (req.body?.password || req.body?.passcode || req.body?.pass || '').toString().trim();
  if (!password) {
    return res.status(400).json({ success: false, error: 'Password is required.' });
  }

  if (checkMasterPassword(password)) {
    recordAdminLoginSuccess(clientIp);
    if (req.session) {
      req.session.isAdmin = true;
      req.session.isStoreAdmin = true;
      req.session.liveAdminAuthed = true;
      req.session.adminLoggedInAt = new Date().toISOString();
    }

    const isSecure = process.env.NODE_ENV === 'production' && (req.secure || req.headers['x-forwarded-proto'] === 'https');
    res.cookie('admin_session', 'authenticated', {
      maxAge: 7 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      sameSite: 'lax',
      secure: isSecure,
      path: '/'
    });
    res.cookie('is_admin', 'true', {
      maxAge: 7 * 24 * 60 * 60 * 1000,
      sameSite: 'lax',
      secure: isSecure,
      path: '/'
    });

    if (req.session && typeof req.session.save === 'function') {
      return req.session.save(() => {
        return res.json({ success: true, message: 'Logged in successfully.', redirect: '/admin' });
      });
    }
    return res.json({ success: true, message: 'Logged in successfully.', redirect: '/admin' });
  }

  const lockMessage = recordAdminLoginFailure(clientIp);
  return res.status(lockMessage ? 429 : 401).json({
    success: false,
    error: lockMessage || 'Incorrect passcode. Please try again.'
  });
}

router.post('/api/admin/login', handleAdminLogin);
router.post('/api/store/admin/login', handleAdminLogin);

// --- Admin Logout Actions ---
function handleAdminLogout(req, res, isRedirect = false) {
  if (req.session) {
    delete req.session.isAdmin;
    delete req.session.isStoreAdmin;
    delete req.session.liveAdminAuthed;
    delete req.session.adminLoggedInAt;
    req.session.destroy(() => {});
  }
  res.clearCookie('admin_session', { path: '/' });
  res.clearCookie('is_admin', { path: '/' });

  if (isRedirect) {
    return res.redirect('/admin');
  }
  return res.json({ success: true, redirect: '/admin' });
}

router.post('/api/admin/logout', (req, res) => handleAdminLogout(req, res, false));
router.get('/admin/logout', (req, res) => handleAdminLogout(req, res, true));
router.post('/api/store/admin/logout', (req, res) => handleAdminLogout(req, res, false));

module.exports = router;
