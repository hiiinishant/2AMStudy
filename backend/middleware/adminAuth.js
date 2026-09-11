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
  if (req.session && (req.session.isAdmin || req.session.isStoreAdmin || req.session.liveAdminAuthed)) {
    return true;
  }
  if (req.cookies && (req.cookies.admin_session === 'authenticated' || req.cookies.is_admin === 'true')) {
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
