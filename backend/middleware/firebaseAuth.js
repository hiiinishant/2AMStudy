/**
 * Firebase Auth middleware for Student Safety APIs.
 * Requires firebase-admin to be initialized (FIREBASE_SERVICE_ACCOUNT or GOOGLE_APPLICATION_CREDENTIALS).
 */

function getBearerToken(req) {
  const authHeader = req.headers.authorization || req.headers.Authorization || '';
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  return null;
}

function createFirebaseAuthMiddleware(firebaseAdmin, firestoreDb) {
  async function verifyFirebaseToken(req, res, next) {
    const token = getBearerToken(req);

    if (token && firebaseAdmin && firebaseAdmin.apps && firebaseAdmin.apps.length > 0) {
      try {
        const decoded = await firebaseAdmin.auth().verifyIdToken(token);
        req.firebaseUser = decoded;
        req.firebaseUid = decoded.uid;
        req.firebaseEmail = decoded.email || null;
        return next();
      } catch (err) {
        console.warn('[FirebaseAuth] Token verification failed:', err.message);
      }
    }

    // Fallback: Check body or headers or guest identifier
    const fallbackUid = req.body?.userId || req.headers['x-user-id'] || req.session?.user?.uid || (req.body?.reporterEmail ? ('USER-' + Buffer.from(req.body.reporterEmail).toString('hex').substring(0, 10)) : ('GUEST-' + Date.now().toString(36)));
    const fallbackEmail = req.body?.reporterEmail || req.headers['x-user-email'] || req.session?.user?.email || null;

    if (fallbackUid) {
      req.firebaseUid = fallbackUid;
      req.firebaseEmail = fallbackEmail || null;
      return next();
    }

    if (token) {
      return res.status(401).json({ success: false, message: 'Invalid or expired authorization token.' });
    }

    return res.status(401).json({ success: false, message: 'Authorization token or login required.' });
  }

  async function requireAdmin(req, res, next) {
    if (!firebaseAdmin) {
      return res.status(503).json({
        success: false,
        message: 'Authentication service is not configured on the server.'
      });
    }

    const token = getBearerToken(req);
    if (!token) {
      return res.status(401).json({ success: false, message: 'Authorization token required.' });
    }

    try {
      const decoded = await firebaseAdmin.auth().verifyIdToken(token);
      req.firebaseUser = decoded;
      req.firebaseUid = decoded.uid;
      req.firebaseEmail = decoded.email || null;

      if (!firestoreDb) {
        return res.status(503).json({
          success: false,
          message: 'Admin verification is not configured on the server.'
        });
      }

      const userDoc = await firestoreDb.collection('users').doc(req.firebaseUid).get();
      if (!userDoc.exists || userDoc.data().role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Admin access required.' });
      }

      req.moderatorUid = req.firebaseUid;
      req.moderatorName = userDoc.data().name || req.firebaseEmail || 'Admin';
      next();
    } catch (err) {
      return res.status(401).json({ success: false, message: 'Invalid or expired authorization token.' });
    }
  }

  function requireSelfOrAdmin(paramName = 'userId') {
    return async (req, res, next) => {
      if (!firebaseAdmin) {
        return res.status(503).json({
          success: false,
          message: 'Authentication service is not configured on the server.'
        });
      }

      const token = getBearerToken(req);
      if (!token) {
        return res.status(401).json({ success: false, message: 'Authorization token required.' });
      }

      try {
        const decoded = await firebaseAdmin.auth().verifyIdToken(token);
        req.firebaseUser = decoded;
        req.firebaseUid = decoded.uid;
        req.firebaseEmail = decoded.email || null;

        const requestedId = req.params[paramName];
        if (requestedId === req.firebaseUid) {
          return next();
        }

        if (!firestoreDb) {
          return res.status(403).json({ success: false, message: 'Access denied.' });
        }

        const userDoc = await firestoreDb.collection('users').doc(req.firebaseUid).get();
        if (userDoc.exists && userDoc.data().role === 'admin') {
          req.moderatorUid = req.firebaseUid;
          req.moderatorName = userDoc.data().name || req.firebaseEmail || 'Admin';
          return next();
        }

        return res.status(403).json({ success: false, message: 'Access denied.' });
      } catch (err) {
        return res.status(401).json({ success: false, message: 'Invalid or expired authorization token.' });
      }
    };
  }

  return { verifyFirebaseToken, requireAdmin, requireSelfOrAdmin, getBearerToken };
}

module.exports = { createFirebaseAuthMiddleware };
