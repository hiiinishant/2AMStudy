function checkMasterPassword(pass) {
  if (!pass) return false;
  const input = String(pass).trim();

  // Check environment-configured passwords (trimming and stripping quotes)
  const envPasswords = [
    process.env.ADMIN_PASSWORD,
    process.env.ADMIN_PASSCODE,
    process.env.STORE_ADMIN_PASSWORD,
    process.env.LIVE_ADMIN_PASSWORD
  ]
    .filter(Boolean)
    .map(p => String(p).trim().replace(/^["']|["']$/g, ''));

  if (envPasswords.length === 0) {
    console.warn('[Admin Auth] Warning: No admin passwords configured in environment variables.');
    return false;
  }

  return envPasswords.some(p => p === input || p.toLowerCase() === input.toLowerCase());
}

// Simple IP-based Rate Limiter for Admin Login Protection
const adminLoginAttempts = new Map();

function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    req.ip ||
    '127.0.0.1';
}

function checkAdminRateLimit(ip) {
  const now = Date.now();
  const record = adminLoginAttempts.get(ip);
  if (record && record.lockedUntil && record.lockedUntil > now) {
    const remainingSec = Math.ceil((record.lockedUntil - now) / 1000);
    return `Too many failed login attempts. Please wait ${remainingSec} seconds before trying again.`;
  }
  return null;
}

function recordAdminLoginFailure(ip) {
  const now = Date.now();
  const record = adminLoginAttempts.get(ip) || { count: 0, lockedUntil: null };
  record.count += 1;
  if (record.count >= 6) {
    record.lockedUntil = now + (60 * 1000); // 1 minute cooldown after 6 failed attempts
    record.count = 0;
  }
  adminLoginAttempts.set(ip, record);
}

function recordAdminLoginSuccess(ip) {
  adminLoginAttempts.delete(ip);
}

function isMasterAdminAuthenticated(req) {
  // 1. In-memory session flags
  if (req.session && (req.session.isAdmin || req.session.isStoreAdmin || req.session.liveAdminAuthed)) {
    return true;
  }

  // 2. Parsed cookies
  if (req.cookies && (req.cookies.admin_session === 'authenticated' || req.cookies.is_admin === 'true')) {
    if (req.session) {
      req.session.isAdmin = true;
      req.session.isStoreAdmin = true;
      req.session.liveAdminAuthed = true;
    }
    return true;
  }

  // 3. Raw Cookie header fallback (in case req.cookies was not populated by proxy)
  const rawCookie = req.headers?.cookie || '';
  if (rawCookie && (rawCookie.includes('admin_session=authenticated') || rawCookie.includes('is_admin=true'))) {
    if (req.session) {
      req.session.isAdmin = true;
      req.session.isStoreAdmin = true;
      req.session.liveAdminAuthed = true;
    }
    return true;
  }

  // 4. Custom Passcode Headers (e.g. x-admin-passcode or Authorization: Bearer <passcode>)
  const headerPasscode = req.headers?.['x-admin-passcode'] ||
    req.headers?.['x-admin-password'] ||
    req.headers?.['admin-passcode'] ||
    (req.headers?.authorization && typeof req.headers.authorization === 'string' && req.headers.authorization.startsWith('Bearer ') ? req.headers.authorization.slice(7).trim() : null);

  if (headerPasscode && checkMasterPassword(headerPasscode)) {
    if (req.session) {
      req.session.isAdmin = true;
      req.session.isStoreAdmin = true;
      req.session.liveAdminAuthed = true;
    }
    return true;
  }

  // 5. Query or Body Passcode fallback
  const directPass = req.body?.adminPasscode || req.body?.adminPassword || req.query?.adminPasscode || req.query?.adminPassword;
  if (directPass && checkMasterPassword(directPass)) {
    if (req.session) {
      req.session.isAdmin = true;
      req.session.isStoreAdmin = true;
      req.session.liveAdminAuthed = true;
    }
    return true;
  }

  // 6. User Session or Firebase Token Admin Email Check
  const userEmail = (req.session?.user?.email || req.firebaseEmail || req.firebaseUser?.email || '').toString().toLowerCase().trim();
  const configuredAdminEmails = [
    process.env.ADMIN_EMAIL,
    process.env.STORE_ADMIN_EMAIL,
    'hiiinishant@gmail.com',
    'safety@2amstudy.online'
  ].filter(Boolean).map(e => String(e).toLowerCase().trim());

  if (userEmail && configuredAdminEmails.includes(userEmail)) {
    if (req.session) {
      req.session.isAdmin = true;
      req.session.isStoreAdmin = true;
      req.session.liveAdminAuthed = true;
    }
    return true;
  }

  return false;
}

function requireStoreAdmin(req, res, next) {
  if (isMasterAdminAuthenticated(req)) {
    return next();
  }
  
  if (req.path.startsWith('/api/') || req.xhr || req.headers.accept?.includes('application/json')) {
    return res.status(401).json({ success: false, error: 'Unauthorized. Admin authentication required.' });
  }

  return res.redirect('/admin?redirect=' + encodeURIComponent(req.originalUrl || '/admin'));
}

function requireAdminForCollegeLife(req, res, next) {
  if (isMasterAdminAuthenticated(req)) {
    return next();
  }
  return res.status(401).json({ success: false, error: 'Admin authentication required.' });
}

module.exports = {
  checkMasterPassword,
  getClientIp,
  checkAdminRateLimit,
  recordAdminLoginFailure,
  recordAdminLoginSuccess,
  isMasterAdminAuthenticated,
  requireStoreAdmin,
  requireAdminForCollegeLife
};
