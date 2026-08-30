const path = require('path');
const fs = require('fs');
require('dotenv').config();

let firebaseAdmin = null;
let firestoreDb = null;

try {
  firebaseAdmin = require('firebase-admin');
  const getApps = () => (Array.isArray(firebaseAdmin.apps) ? firebaseAdmin.apps : (typeof firebaseAdmin.getApps === 'function' ? firebaseAdmin.getApps() : []));
  let existingApps = getApps();
  if (existingApps.length === 0) {
    const serviceAccountEnv = process.env.FIREBASE_SERVICE_ACCOUNT;
    const getCredential = (acc) => {
      try {
        const { cert } = require('firebase-admin/app');
        return cert(acc);
      } catch (_) {
        return firebaseAdmin.credential.cert(acc);
      }
    };

    if (serviceAccountEnv) {
      firebaseAdmin.initializeApp({
        credential: getCredential(JSON.parse(serviceAccountEnv))
      });
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      const credPath = path.isAbsolute(process.env.GOOGLE_APPLICATION_CREDENTIALS)
        ? process.env.GOOGLE_APPLICATION_CREDENTIALS
        : path.join(__dirname, '..', '..', process.env.GOOGLE_APPLICATION_CREDENTIALS);
      if (fs.existsSync(credPath)) {
        const serviceAccount = JSON.parse(fs.readFileSync(credPath, 'utf8'));
        firebaseAdmin.initializeApp({
          credential: getCredential(serviceAccount)
        });
      } else {
        console.warn(`[Firebase Admin] Credentials file not found at ${credPath}`);
      }
    } else {
      console.warn('[Firebase Admin] No credentials found — Firestore inventory disabled. Set FIREBASE_SERVICE_ACCOUNT or GOOGLE_APPLICATION_CREDENTIALS to enable.');
    }
    existingApps = getApps();
    if (existingApps.length > 0) {
      try {
        const { getFirestore } = require('firebase-admin/firestore');
        firestoreDb = getFirestore();
      } catch (_) {
        firestoreDb = typeof firebaseAdmin.firestore === 'function' ? firebaseAdmin.firestore() : null;
      }
      console.log('[Firebase Admin] Firestore connected — atomic inventory enabled.');
    }
  } else {
    try {
      const { getFirestore } = require('firebase-admin/firestore');
      firestoreDb = getFirestore();
    } catch (_) {
      firestoreDb = typeof firebaseAdmin.firestore === 'function' ? firebaseAdmin.firestore() : null;
    }
  }
} catch (e) {
  console.warn('[Firebase Admin] Initialization warning:', e.message);
}

module.exports = { firebaseAdmin, firestoreDb };
