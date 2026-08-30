const fs = require('fs');
const path = require('path');

const collegeLifeVideosFilePath = path.join(__dirname, '..', 'data', 'collegeLifeVideos.json');
let collegeLifeVideos = [];

try {
  if (fs.existsSync(collegeLifeVideosFilePath)) {
    collegeLifeVideos = JSON.parse(fs.readFileSync(collegeLifeVideosFilePath, 'utf8'));
  }
} catch (e) {
  console.error('[CollegeLifeStore] Could not load collegeLifeVideos.json:', e.message);
}

function saveCollegeLifeVideos() {
  try {
    fs.mkdirSync(path.join(__dirname, '..', 'data'), { recursive: true });
    fs.writeFileSync(collegeLifeVideosFilePath, JSON.stringify(collegeLifeVideos, null, 2), 'utf8');
  } catch (e) {
    console.error('[CollegeLifeStore] Could not save collegeLifeVideos.json:', e.message);
  }
}

function extractYoutubeVideoId(url) {
  if (!url) return null;
  const trimmed = url.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;
  try {
    const validUrl = trimmed.startsWith('http://') || trimmed.startsWith('https://') ? trimmed : `https://${trimmed}`;
    const u = new URL(validUrl);
    if (u.hostname === 'youtu.be') return u.pathname.slice(1).split('/')[0].split('?')[0];
    if (u.pathname.startsWith('/live/')) return u.pathname.split('/live/')[1].split('/')[0].split('?')[0];
    if (u.pathname.startsWith('/shorts/')) return u.pathname.split('/shorts/')[1].split('/')[0].split('?')[0];
    if (u.pathname.startsWith('/embed/')) return u.pathname.split('/embed/')[1].split('/')[0].split('?')[0];
    if (u.searchParams.get('v')) return u.searchParams.get('v');
  } catch (_) {}
  return null;
}

module.exports = {
  getVideos: () => collegeLifeVideos,
  setVideos: (v) => { collegeLifeVideos = v; },
  saveCollegeLifeVideos,
  extractYoutubeVideoId
};
