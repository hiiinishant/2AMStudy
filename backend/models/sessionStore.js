const fs = require('fs');
const path = require('path');

const studySessionsFilePath = path.join(__dirname, '..', 'data', 'studySessions.json');
let studySessions = [];

try {
  if (fs.existsSync(studySessionsFilePath)) {
    studySessions = JSON.parse(fs.readFileSync(studySessionsFilePath, 'utf8'));
  }
} catch (e) {
  console.error('[SessionStore] Could not load studySessions.json:', e.message);
}

function saveStudySessions() {
  try {
    fs.mkdirSync(path.join(__dirname, '..', 'data'), { recursive: true });
    fs.writeFileSync(studySessionsFilePath, JSON.stringify(studySessions, null, 2), 'utf8');
  } catch (e) {
    console.error('[SessionStore] Could not save studySessions.json:', e.message);
  }
}

// Auto-expire LIVE sessions that started more than 4 hours ago
const LIVE_MAX_DURATION_MS = 4 * 60 * 60 * 1000; // 4 hours

function expireStaleSessions() {
  const now = Date.now();
  let changed = false;
  studySessions.forEach(s => {
    if (s.status === 'LIVE' && s.startedAt) {
      const elapsed = now - new Date(s.startedAt).getTime();
      if (elapsed > LIVE_MAX_DURATION_MS) {
        s.status = 'COMPLETED';
        s.endedAt = new Date().toISOString();
        if (!s.duration || s.duration.trim() === '') {
          const diffMin = Math.round(elapsed / (1000 * 60));
          const hours = Math.floor(diffMin / 60);
          const mins = diffMin % 60;
          s.duration = hours > 0 && mins > 0
            ? `${hours} Hr ${mins} Min`
            : hours > 0
              ? `${hours} ${hours === 1 ? 'Hour' : 'Hours'}`
              : `${mins} Min`;
        }
        changed = true;
        console.log(`[SessionStore] Auto-expired stale LIVE session: "${s.title}"`);
      }
    }
  });
  if (changed) saveStudySessions();
}

module.exports = {
  getSessions: () => {
    expireStaleSessions();
    return studySessions;
  },
  setSessions: (s) => { studySessions = s; },
  saveStudySessions
};
