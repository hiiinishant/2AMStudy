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
      next();
    } catch (err) {
      return res.status(401).json({ success: false, message: 'Invalid or expired authorization token.' });
    }
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
