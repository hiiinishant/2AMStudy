const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

// Student Safety cases JSON persistence
const casesDataFilePath = path.join(dataDir, 'studentSafetyCases.json');
let studentSafetyCases = [];
try {
  if (fs.existsSync(casesDataFilePath)) {
    studentSafetyCases = JSON.parse(fs.readFileSync(casesDataFilePath, 'utf8'));
  }
} catch (e) {
  console.error('[SafetyStore] Could not load studentSafetyCases.json:', e.message);
}

function saveStudentSafetyCases() {
  try {
    fs.writeFileSync(casesDataFilePath, JSON.stringify(studentSafetyCases, null, 2), 'utf8');
  } catch (e) {
    console.error('[SafetyStore] Could not save studentSafetyCases.json:', e.message);
  }
}

// Moderation Audit Logs JSON persistence
const modLogsFilePath = path.join(dataDir, 'studentSafetyModerationLogs.json');
let studentSafetyModerationLogs = [];
try {
  if (fs.existsSync(modLogsFilePath)) {
    studentSafetyModerationLogs = JSON.parse(fs.readFileSync(modLogsFilePath, 'utf8'));
  }
} catch (e) {
  console.error('[SafetyStore] Could not load studentSafetyModerationLogs.json:', e.message);
}

function saveModerationLogs() {
  try {
    fs.writeFileSync(modLogsFilePath, JSON.stringify(studentSafetyModerationLogs, null, 2), 'utf8');
  } catch (e) {
    console.error('[SafetyStore] Could not save studentSafetyModerationLogs.json:', e.message);
  }
}

// Student Safety Notifications JSON persistence
const notificationsFilePath = path.join(dataDir, 'studentSafetyNotifications.json');
let studentSafetyNotifications = [];
try {
  if (fs.existsSync(notificationsFilePath)) {
    studentSafetyNotifications = JSON.parse(fs.readFileSync(notificationsFilePath, 'utf8'));
  }
} catch (e) {
  console.error('[SafetyStore] Could not load studentSafetyNotifications.json:', e.message);
}

function saveNotifications() {
  try {
    fs.writeFileSync(notificationsFilePath, JSON.stringify(studentSafetyNotifications, null, 2), 'utf8');
  } catch (e) {
    console.error('[SafetyStore] Could not save studentSafetyNotifications.json:', e.message);
  }
}

// Student Safety Supports JSON persistence
const supportsFilePath = path.join(dataDir, 'studentSafetySupports.json');
let studentSafetySupports = [];
try {
  if (fs.existsSync(supportsFilePath)) {
    studentSafetySupports = JSON.parse(fs.readFileSync(supportsFilePath, 'utf8'));
  }
} catch (e) {
  console.error('[SafetyStore] Could not load studentSafetySupports.json:', e.message);
}

function saveStudentSafetySupports() {
  try {
    fs.writeFileSync(supportsFilePath, JSON.stringify(studentSafetySupports, null, 2), 'utf8');
  } catch (e) {
    console.error('[SafetyStore] Could not save studentSafetySupports.json:', e.message);
  }
}

// Student Safety Notification Logs JSON persistence
const notifLogsFilePath = path.join(dataDir, 'studentSafetyNotificationLogs.json');
let studentSafetyNotificationLogs = [];
try {
  if (fs.existsSync(notifLogsFilePath)) {
    studentSafetyNotificationLogs = JSON.parse(fs.readFileSync(notifLogsFilePath, 'utf8'));
  }
} catch (e) {
  console.error('[SafetyStore] Could not load studentSafetyNotificationLogs.json:', e.message);
}

function saveNotificationLogs() {
  try {
    fs.writeFileSync(notifLogsFilePath, JSON.stringify(studentSafetyNotificationLogs, null, 2), 'utf8');
  } catch (e) {
    console.error('[SafetyStore] Could not save studentSafetyNotificationLogs.json:', e.message);
  }
}

// User Push Subscriptions JSON persistence
const pushSubsFilePath = path.join(dataDir, 'userPushSubscriptions.json');
let userPushSubscriptions = {};
try {
  if (fs.existsSync(pushSubsFilePath)) {
    userPushSubscriptions = JSON.parse(fs.readFileSync(pushSubsFilePath, 'utf8'));
  }
} catch (e) {
  console.error('[SafetyStore] Could not load userPushSubscriptions.json:', e.message);
}

function savePushSubscriptions() {
  try {
    fs.writeFileSync(pushSubsFilePath, JSON.stringify(userPushSubscriptions, null, 2), 'utf8');
  } catch (e) {
    console.error('[SafetyStore] Could not save userPushSubscriptions.json:', e.message);
  }
}

// Web Push VAPID Keys Setup
const vapidKeysFilePath = path.join(dataDir, 'vapidKeys.json');
let webpush = null;
let vapidKeys = null;
try {
  webpush = require('web-push');

  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    vapidKeys = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  } else if (fs.existsSync(vapidKeysFilePath)) {
    vapidKeys = JSON.parse(fs.readFileSync(vapidKeysFilePath, 'utf8'));
    console.log('[WebPush] Loaded persisted VAPID keys from disk.');
  } else {
    vapidKeys = webpush.generateVAPIDKeys();
    fs.writeFileSync(vapidKeysFilePath, JSON.stringify(vapidKeys, null, 2), 'utf8');
    console.log('[WebPush] Generated and persisted new VAPID keys to disk.');
  }

  webpush.setVapidDetails(
    'mailto:safety@2amstudy.online',
    vapidKeys.publicKey,
    vapidKeys.privateKey
  );
  console.log('[WebPush] VAPID keys loaded and web-push initialized successfully.');
} catch (e) {
  console.warn('[WebPush] Initialization notice:', e.message);
}

module.exports = {
  getCases: () => studentSafetyCases,
  setCases: (c) => { studentSafetyCases = c; },
  saveStudentSafetyCases,

  getModerationLogs: () => studentSafetyModerationLogs,
  saveModerationLogs,

  getNotifications: () => studentSafetyNotifications,
  saveNotifications,

  getSupports: () => studentSafetySupports,
  saveStudentSafetySupports,

  getNotificationLogs: () => studentSafetyNotificationLogs,
  saveNotificationLogs,

  getPushSubscriptions: () => userPushSubscriptions,
  setPushSubscriptions: (s) => { userPushSubscriptions = s; },
  savePushSubscriptions,

  getWebpush: () => webpush,
  getVapidKeys: () => vapidKeys,
  casesDataFilePath
};
