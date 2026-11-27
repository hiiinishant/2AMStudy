const { firestoreDb } = require('../config/firebase');

const COLLECTION = 'siteSettings';
const DOCUMENT = 'musicPlaylists';
const EMPTY_PLAYLISTS = Object.freeze({
  deepFocusPlaylistUrl: '',
  motivationPlaylistUrl: ''
});
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'music.youtube.com']);

class PlaylistUrlValidationError extends Error {}

function normalizePlaylistUrl(value, label) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string') {
    throw new PlaylistUrlValidationError(`${label} must be a YouTube playlist URL.`);
  }

  const trimmed = value.trim();
  if (!trimmed) return '';

  let url;
  try {
    url = new URL(trimmed);
  } catch {
    throw new PlaylistUrlValidationError(`${label} must be a valid YouTube playlist URL.`);
  }

  const playlistId = url.searchParams.get('list');
  if (
    url.protocol !== 'https:' ||
    !YOUTUBE_HOSTS.has(url.hostname.toLowerCase()) ||
    !playlistId ||
    !/^[a-zA-Z0-9_-]+$/.test(playlistId)
  ) {
    throw new PlaylistUrlValidationError(`${label} must be a YouTube playlist URL with a playlist ID.`);
  }

  return url.toString();
}

function normalizePlaylistSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PlaylistUrlValidationError('Playlist settings must be an object.');
  }

  return {
    deepFocusPlaylistUrl: normalizePlaylistUrl(value.deepFocusPlaylistUrl, 'Deep Focus'),
    motivationPlaylistUrl: normalizePlaylistUrl(value.motivationPlaylistUrl, 'Motivation')
  };
}

function createMusicPlaylistStore(db) {
  return {
    async getMusicPlaylists() {
      if (!db) throw new Error('Firestore is not configured for music playlists.');
      const snapshot = await db.collection(COLLECTION).doc(DOCUMENT).get();
      if (!snapshot.exists) return { ...EMPTY_PLAYLISTS };
      return normalizePlaylistSettings(snapshot.data() || {});
    },

    async saveMusicPlaylists(value) {
      if (!db) throw new Error('Firestore is not configured for music playlists.');
      const playlists = normalizePlaylistSettings(value);
      await db.collection(COLLECTION).doc(DOCUMENT).set({
        ...playlists,
        updatedAt: new Date().toISOString()
      });
      return playlists;
    }
  };
}

const store = createMusicPlaylistStore(firestoreDb);

module.exports = {
  ...store,
  createMusicPlaylistStore,
  normalizePlaylistSettings,
  PlaylistUrlValidationError,
  EMPTY_PLAYLISTS
};
