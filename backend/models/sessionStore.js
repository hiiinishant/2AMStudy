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

module.exports = {
  getSessions: () => studySessions,
  setSessions: (s) => { studySessions = s; },
  saveStudySessions
};
