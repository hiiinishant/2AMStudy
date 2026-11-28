const { firestoreDb } = require('../config/firebase');

const COLLECTION = 'siteSettings';
const DOCUMENT = 'musicPlaylists';
const MOTIVATION_VIDEO_COUNT = 12;
const EMPTY_MUSIC_VIDEOS = Object.freeze({
  deepFocusVideoUrl: '',
  motivationVideoUrls: Object.freeze(Array(MOTIVATION_VIDEO_COUNT).fill(''))
});
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'music.youtube.com']);
const VIDEO_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;

class VideoUrlValidationError extends Error {}

function extractYoutubeVideoId(value, label) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string') {
    throw new VideoUrlValidationError(`${label} must be a YouTube video URL.`);
  }

  const trimmed = value.trim();
  if (!trimmed) return '';

  let url;
  try {
    url = new URL(trimmed);
  } catch {
    throw new VideoUrlValidationError(`${label} must be a valid YouTube video URL.`);
  }

  let videoId = '';
  const hostname = url.hostname.toLowerCase();
  if (url.protocol === 'https:' && hostname === 'youtu.be') {
    videoId = url.pathname.split('/').filter(Boolean)[0] || '';
  } else if (url.protocol === 'https:' && YOUTUBE_HOSTS.has(hostname)) {
    if (url.pathname === '/watch') {
      videoId = url.searchParams.get('v') || '';
    } else {
      const pathMatch = url.pathname.match(/^\/(?:embed|shorts)\/([^/]+)\/?$/);
      videoId = pathMatch ? pathMatch[1] : '';
    }
  }

  if (!VIDEO_ID_PATTERN.test(videoId)) {
    throw new VideoUrlValidationError(`${label} must be a YouTube video URL with a valid video ID.`);
  }
  return videoId;
}

function normalizeVideoUrl(value, label) {
  const videoId = extractYoutubeVideoId(value, label);
  return videoId ? `https://www.youtube.com/watch?v=${videoId}` : '';
}

function normalizeMusicVideoSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new VideoUrlValidationError('Music video settings must be an object.');
  }

  const motivationVideoUrls = value.motivationVideoUrls === undefined
    ? [value.motivationVideoUrl || '']
    : value.motivationVideoUrls;
  if (!Array.isArray(motivationVideoUrls) || motivationVideoUrls.length > MOTIVATION_VIDEO_COUNT) {
    throw new VideoUrlValidationError(`Motivation videos must contain no more than ${MOTIVATION_VIDEO_COUNT} URLs.`);
  }

  return {
    deepFocusVideoUrl: normalizeVideoUrl(value.deepFocusVideoUrl, 'Deep Focus'),
    motivationVideoUrls: Array.from({ length: MOTIVATION_VIDEO_COUNT }, (_, index) =>
      normalizeVideoUrl(motivationVideoUrls[index], `Motivation ${index + 1}`)
    )
  };
}

function normalizeLegacyVideoUrl(value) {
  if (!value) return '';
  try {
    return normalizeVideoUrl(value, 'Saved');
  } catch (error) {
    if (error instanceof VideoUrlValidationError) return '';
    throw error;
  }
}

function readMusicVideoSettings(value) {
  return normalizeMusicVideoSettings({
    deepFocusVideoUrl: value.deepFocusVideoUrl !== undefined
      ? value.deepFocusVideoUrl
      : normalizeLegacyVideoUrl(value.deepFocusPlaylistUrl),
    motivationVideoUrls: value.motivationVideoUrls !== undefined
      ? value.motivationVideoUrls
      : [value.motivationVideoUrl !== undefined
        ? value.motivationVideoUrl
        : normalizeLegacyVideoUrl(value.motivationPlaylistUrl)]
  });
}

function createMusicQuickPickStore(db) {
  return {
    async getMusicVideos() {
      if (!db) throw new Error('Firestore is not configured for music quick picks.');
      const snapshot = await db.collection(COLLECTION).doc(DOCUMENT).get();
      if (!snapshot.exists) return { ...EMPTY_MUSIC_VIDEOS };
      return readMusicVideoSettings(snapshot.data() || {});
    },

    async saveMusicVideos(value) {
      if (!db) throw new Error('Firestore is not configured for music quick picks.');
      const videos = normalizeMusicVideoSettings(value);
      await db.collection(COLLECTION).doc(DOCUMENT).set({
        ...videos,
        updatedAt: new Date().toISOString()
      });
      return videos;
    }
  };
}

const store = createMusicQuickPickStore(firestoreDb);

module.exports = {
  ...store,
  createMusicQuickPickStore,
  normalizeMusicVideoSettings,
  VideoUrlValidationError,
  EMPTY_MUSIC_VIDEOS,
  MOTIVATION_VIDEO_COUNT
};
