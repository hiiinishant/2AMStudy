/**
 * youtubeWatcher.js
 * Polls the YouTube Data API every 60 seconds.
 * When the 2amstudy channel goes LIVE, automatically activates a session.
 * When it goes offline, automatically ends the session.
 */

const sessionStore = require('../models/sessionStore');
const { extractYoutubeVideoId } = require('../models/collegeLifeStore');

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
// Channel ID for @2amstudy — resolved once on startup, or set here directly
const CHANNEL_HANDLE = '@2amstudy';
// Fallback hardcoded channel ID (fetch once via resolveChannelId, or set manually)
let CHANNEL_ID = process.env.YOUTUBE_CHANNEL_ID || null;

const POLL_INTERVAL_MS = 60 * 1000; // check every 60 seconds
let pollTimer = null;
let lastKnownLiveVideoId = null;

/**
 * Resolve the numeric channel ID from a handle using YouTube API.
 * Only called once on startup if CHANNEL_ID is not already set.
 */
async function resolveChannelId() {
  if (!YOUTUBE_API_KEY) return null;
  try {
    const { default: fetch } = await import('node-fetch');
    const url = `https://www.googleapis.com/youtube/v3/channels?part=id&forHandle=${encodeURIComponent(CHANNEL_HANDLE)}&key=${YOUTUBE_API_KEY}`;
    const res = await fetch(url, { timeout: 8000 });
    if (!res.ok) return null;
    const data = await res.json();
    const id = data?.items?.[0]?.id || null;
    if (id) console.log(`[YTWatcher] Resolved channel ID for ${CHANNEL_HANDLE}: ${id}`);
    return id;
  } catch (err) {
    console.warn('[YTWatcher] Could not resolve channel ID:', err.message);
    return null;
  }
}

/**
 * Check YouTube for an active live stream on the channel.
 * Returns { isLive, videoId, title, description } or null on failure.
 */
async function checkYoutubeLiveStatus() {
  if (!YOUTUBE_API_KEY || !CHANNEL_ID) return null;
  try {
    const { default: fetch } = await import('node-fetch');
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${CHANNEL_ID}&eventType=live&type=video&key=${YOUTUBE_API_KEY}`;
    const res = await fetch(url, { timeout: 8000 });
    if (!res.ok) {
      console.warn(`[YTWatcher] YouTube API error: ${res.status}`);
      return null;
    }
    const data = await res.json();
    if (!data.items || data.items.length === 0) {
      return { isLive: false };
    }
    const item = data.items[0];
    return {
      isLive: true,
      videoId: item.id?.videoId,
      title: item.snippet?.title || '2AM Study — Live Session',
      description: item.snippet?.description || '',
    };
  } catch (err) {
    console.warn('[YTWatcher] Poll error:', err.message);
    return null;
  }
}

/**
 * Core poll tick — runs every POLL_INTERVAL_MS.
 */
async function pollTick() {
  const result = await checkYoutubeLiveStatus();
  if (!result) return; // network/API error — skip this tick

  const studySessions = sessionStore.getSessions();
  const existingLive = studySessions.find(s => s.status === 'LIVE');

  if (result.isLive && result.videoId) {
    // Channel IS live on YouTube
    if (existingLive) {
      // Already tracked — nothing to do
      lastKnownLiveVideoId = result.videoId;
      return;
    }
    // NEW live stream detected — auto-create session
    const youtubeUrl = `https://www.youtube.com/watch?v=${result.videoId}`;
    const now = new Date().toISOString();
    const session = {
      id: require('crypto').randomUUID(),
      title: result.title,
      description: result.description,
      youtubeUrl,
      youtubeVideoId: result.videoId,
      thumbnail: `https://img.youtube.com/vi/${result.videoId}/hqdefault.jpg`,
      duration: '',
      status: 'LIVE',
      scheduledAt: null,
      startedAt: now,
      endedAt: null,
      createdAt: now,
      autoDetected: true, // flag: created by watcher, not admin
    };
    studySessions.unshift(session);
    sessionStore.saveStudySessions();
    lastKnownLiveVideoId = result.videoId;
    console.log(`[YTWatcher] ✅ Auto-activated live session: "${result.title}" (${result.videoId})`);

  } else {
    // Channel is NOT live on YouTube
    if (!existingLive || !existingLive.autoDetected) {
      // Either no live session, or it was manually created — don't auto-end manual ones
      lastKnownLiveVideoId = null;
      return;
    }
    // Auto-created session → auto-end it
    const elapsed = Date.now() - new Date(existingLive.startedAt).getTime();
    const diffMin = Math.round(elapsed / (1000 * 60));
    const hours = Math.floor(diffMin / 60);
    const mins = diffMin % 60;
    existingLive.status = 'COMPLETED';
    existingLive.endedAt = new Date().toISOString();
    existingLive.duration = existingLive.duration?.trim()
      ? existingLive.duration
      : hours > 0 && mins > 0
        ? `${hours} Hr ${mins} Min`
        : hours > 0
          ? `${hours} ${hours === 1 ? 'Hour' : 'Hours'}`
          : `${mins} Min`;
    sessionStore.saveStudySessions();
    lastKnownLiveVideoId = null;
    console.log(`[YTWatcher] ✅ Auto-ended live session: "${existingLive.title}"`);
  }
}

/**
 * Start the background YouTube watcher.
 * Called once from server.js on startup.
 */
async function startYoutubeWatcher() {
  if (!YOUTUBE_API_KEY) {
    console.warn('[YTWatcher] YOUTUBE_API_KEY not set — auto-detection disabled.');
    return;
  }

  // Resolve channel ID if not already set
  if (!CHANNEL_ID) {
    CHANNEL_ID = await resolveChannelId();
    if (!CHANNEL_ID) {
      console.warn('[YTWatcher] Could not resolve YouTube channel ID — auto-detection disabled.');
      return;
    }
  }

  console.log(`[YTWatcher] Started. Polling every ${POLL_INTERVAL_MS / 1000}s for channel ${CHANNEL_ID}`);

  // Run immediately on start
  await pollTick();

  // Then repeat on interval
  pollTimer = setInterval(pollTick, POLL_INTERVAL_MS);
}

/**
 * Stop the watcher (for clean shutdown / tests).
 */
function stopYoutubeWatcher() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
    console.log('[YTWatcher] Stopped.');
  }
}

module.exports = { startYoutubeWatcher, stopYoutubeWatcher };
