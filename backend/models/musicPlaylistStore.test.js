const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createMusicPlaylistStore,
  PlaylistUrlValidationError
} = require('./musicPlaylistStore');

function createFakeFirestore(initialValue) {
  let storedValue = initialValue;
  const db = {
    collection(name) {
      assert.equal(name, 'siteSettings');
      return {
        doc(id) {
          assert.equal(id, 'musicPlaylists');
          return {
            async get() {
              return {
                exists: storedValue !== undefined,
                data: () => storedValue
              };
            },
            async set(value) {
              storedValue = value;
            }
          };
        }
      };
    }
  };

  return { db, getStoredValue: () => storedValue };
}

test('returns empty playlist links when no Firestore configuration exists yet', async () => {
  const { db } = createFakeFirestore(undefined);
  const store = createMusicPlaylistStore(db);

  assert.deepEqual(await store.getMusicPlaylists(), {
    deepFocusPlaylistUrl: '',
    motivationPlaylistUrl: ''
  });
});

test('saves and reloads the two validated playlist URLs', async () => {
  const { db, getStoredValue } = createFakeFirestore(undefined);
  const store = createMusicPlaylistStore(db);
  const playlists = {
    deepFocusPlaylistUrl: 'https://www.youtube.com/playlist?list=PL_focus_123',
    motivationPlaylistUrl: 'https://music.youtube.com/playlist?list=PL-motivation-456'
  };

  assert.deepEqual(await store.saveMusicPlaylists(playlists), playlists);
  assert.deepEqual(await store.getMusicPlaylists(), playlists);
  assert.equal(typeof getStoredValue().updatedAt, 'string');
});

test('rejects non-YouTube links and URLs without playlist IDs', async () => {
  const { db } = createFakeFirestore(undefined);
  const store = createMusicPlaylistStore(db);

  await assert.rejects(
    store.saveMusicPlaylists({
      deepFocusPlaylistUrl: 'https://example.com/playlist?list=PL_focus',
      motivationPlaylistUrl: ''
    }),
    PlaylistUrlValidationError
  );
  await assert.rejects(
    store.saveMusicPlaylists({
      deepFocusPlaylistUrl: 'https://youtube.com/watch?v=video',
      motivationPlaylistUrl: ''
    }),
    PlaylistUrlValidationError
  );
});
