const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createMusicQuickPickStore,
  VideoUrlValidationError
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

test('returns empty direct video links when no Firestore configuration exists yet', async () => {
  const { db } = createFakeFirestore(undefined);
  const store = createMusicQuickPickStore(db);

  assert.deepEqual(await store.getMusicVideos(), {
    deepFocusVideoUrl: '',
    motivationVideoUrl: ''
  });
});

test('saves direct video links and strips playlist parameters from watch URLs', async () => {
  const { db, getStoredValue } = createFakeFirestore(undefined);
  const store = createMusicQuickPickStore(db);
  const videos = {
    deepFocusVideoUrl: 'https://www.youtube.com/watch?v=kB8g2lH8e48&list=PLA1IG2dsOU-c',
    motivationVideoUrl: 'https://www.youtube.com/watch?v=uNboFgKLGDY&list=PLQfqZFVQZ3To'
  };
  const normalized = {
    deepFocusVideoUrl: 'https://www.youtube.com/watch?v=kB8g2lH8e48',
    motivationVideoUrl: 'https://www.youtube.com/watch?v=uNboFgKLGDY'
  };

  assert.deepEqual(await store.saveMusicVideos(videos), normalized);
  assert.deepEqual(await store.getMusicVideos(), normalized);
  assert.deepEqual(getStoredValue().deepFocusVideoUrl, normalized.deepFocusVideoUrl);
  assert.equal(typeof getStoredValue().updatedAt, 'string');
});

test('migrates existing watch links and ignores playlist-only legacy values', async () => {
  const { db } = createFakeFirestore({
    deepFocusPlaylistUrl: 'https://www.youtube.com/watch?v=kB8g2lH8e48&list=PLA1IG2dsOU-c',
    motivationPlaylistUrl: 'https://www.youtube.com/playlist?list=PLQfqZFVQZ3To'
  });
  const store = createMusicQuickPickStore(db);

  assert.deepEqual(await store.getMusicVideos(), {
    deepFocusVideoUrl: 'https://www.youtube.com/watch?v=kB8g2lH8e48',
    motivationVideoUrl: ''
  });
});

test('rejects non-YouTube links, playlist-only links, and invalid video IDs', async () => {
  const { db } = createFakeFirestore(undefined);
  const store = createMusicQuickPickStore(db);

  for (const invalidUrl of [
    'https://example.com/watch?v=kB8g2lH8e48',
    'https://www.youtube.com/playlist?list=PLA1IG2dsOU-c',
    'https://www.youtube.com/watch?v=short'
  ]) {
    await assert.rejects(
      store.saveMusicVideos({
        deepFocusVideoUrl: invalidUrl,
        motivationVideoUrl: ''
      }),
      VideoUrlValidationError
    );
  }
});
