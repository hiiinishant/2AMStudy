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

  return envPasswords.some(p => p === input);
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
  if (record.count >= 2) {
    record.lockedUntil = now + (5 * 60 * 1000); // 5 minute cooldown after 2 failed attempts
    record.count = 0;
  }
  adminLoginAttempts.set(ip, record);
  return record.lockedUntil > now
    ? 'Admin login locked for 5 minutes after 2 failed attempts. Please verify your password before trying again.'
    : null;
}

function recordAdminLoginSuccess(ip) {
  adminLoginAttempts.delete(ip);
}

function isMasterAdminAuthenticated(req) {
  // 1. In-memory session flags
  if (req.session && (req.session.isAdmin || req.session.isStoreAdmin || req.session.liveAdminAuthed)) {
    return true;
  }

  // 2. Custom Passcode Headers (e.g. x-admin-passcode or Authorization: Bearer <passcode>)
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

  // 3. Body Passcode fallback for same-session admin requests
  const directPass = req.body?.adminPasscode || req.body?.adminPassword;
  if (directPass && checkMasterPassword(directPass)) {
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
