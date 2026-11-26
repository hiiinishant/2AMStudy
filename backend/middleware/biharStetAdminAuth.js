const PRODUCTION_ORIGINS = new Set([
  'https://2amstudy.com',
  'https://www.2amstudy.com',
  'https://2amstudy.online',
  'https://www.2amstudy.online',
  'https://hiiinishant.com',
  'https://www.hiiinishant.com'
]);
const DEVELOPMENT_ORIGINS = new Set([
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:8080'
]);

function isTrustedAdminRequest(req, production = process.env.NODE_ENV === 'production') {
  const origin = req.headers?.origin;
  if (origin) {
    return PRODUCTION_ORIGINS.has(origin) || (!production && DEVELOPMENT_ORIGINS.has(origin));
  }
  return req.headers?.['sec-fetch-site'] === 'same-origin';
}

function hasAdminSession(req) {
  return Boolean(req.session && (req.session.isAdmin || req.session.isStoreAdmin || req.session.liveAdminAuthed));
}

function requireBiharStetAdmin(req, res, next) {
  if (!isTrustedAdminRequest(req)) {
    return res.status(403).json({ success: false, error: 'Admin requests must come from the 2AM Study website.' });
  }
  if (!hasAdminSession(req)) {
    return res.status(401).json({ success: false, error: 'Admin authentication required.' });
  }
  return next();
}

module.exports = { hasAdminSession, isTrustedAdminRequest, requireBiharStetAdmin };
