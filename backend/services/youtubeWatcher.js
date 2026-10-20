/**
 * youtubeWatcher.js
 * Detects live streams on the @2amstudy YouTube channel in real time.
 * Uses the uploads playlist + video liveStreamingDetails check (2 quota units)
 * which instantly catches new live broadcasts without search-indexing delays.
 */

const sessionStore = require('../models/sessionStore');
const { extractYoutubeVideoId } = require('../models/collegeLifeStore');

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || 'AIzaSyB5QU3Nuhv3ENRpraq83GFX_PognBOkCB8';
const CHANNEL_HANDLE = '@2amstudy';
let CHANNEL_ID = process.env.YOUTUBE_CHANNEL_ID || 'UCR1O6_kdj7nDGWeDJHmZqjQ';
const UPLOADS_PLAYLIST_ID = 'UUR1O6_kdj7nDGWeDJHmZqjQ';

const POLL_INTERVAL_MS = 60 * 1000; // check every 60 seconds
let pollTimer = null;
let lastKnownLiveVideoId = null;

let lastOnDemandCheck = 0;
const ON_DEMAND_CACHE_TTL_MS = 30 * 1000; // 30 seconds

/**
 * Resolve the numeric channel ID from a handle using YouTube API if needed.
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
 * Fast & accurate: checks the uploads playlist (1 quota) and inspects video details (1 quota).
 */
async function checkYoutubeLiveStatus() {
  if (!YOUTUBE_API_KEY) return null;
  try {
    const { default: fetch } = await import('node-fetch');

    // Step 1: Get latest 3 uploads from the channel playlist
    const pUrl = `https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&playlistId=${UPLOADS_PLAYLIST_ID}&maxResults=3&key=${YOUTUBE_API_KEY}`;
    const pRes = await fetch(pUrl, { timeout: 8000 });
    if (!pRes.ok) {
      console.warn(`[YTWatcher] PlaylistItems error: ${pRes.status}`);
      return null;
    }
    const pData = await pRes.json();
    const ids = (pData.items || []).map(i => i.contentDetails?.videoId).filter(Boolean);

    if (ids.length === 0) return { isLive: false };

    // Step 2: Check live streaming details on recent videos
    const vUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet,liveStreamingDetails&id=${ids.join(',')}&key=${YOUTUBE_API_KEY}`;
    const vRes = await fetch(vUrl, { timeout: 8000 });
    if (!vRes.ok) {
      console.warn(`[YTWatcher] Videos API error: ${vRes.status}`);
      return null;
    }
    const vData = await vRes.json();

    for (const item of (vData.items || [])) {
      if (item.snippet && item.snippet.liveBroadcastContent === 'live') {
        return {
          isLive: true,
          videoId: item.id,
          title: item.snippet.title || '2AM Study — Live Session',
          description: item.snippet.description || '',
          startedAt: item.liveStreamingDetails?.actualStartTime || new Date().toISOString()
        };
      }
    }

    return { isLive: false };
  } catch (err) {
    console.warn('[YTWatcher] Live check error:', err.message);
    return null;
  }
}

/**
 * Core poll tick — runs on schedule and on-demand.
 */
async function pollTick() {
  const result = await checkYoutubeLiveStatus();
  if (!result) return; // network/API error — skip this tick

  const studySessions = sessionStore.getSessions();
  const existingLive = studySessions.find(s => s.status === 'LIVE');

  if (result.isLive && result.videoId) {
    // Channel IS live on YouTube
    if (existingLive) {
      if (existingLive.youtubeVideoId !== result.videoId) {
        // Stream video ID changed
        existingLive.status = 'COMPLETED';
        existingLive.endedAt = new Date().toISOString();
      } else {
        lastKnownLiveVideoId = result.videoId;
        return;
      }
    }

    // Activate live session
    const youtubeUrl = `https://www.youtube.com/watch?v=${result.videoId}`;
    const now = result.startedAt || new Date().toISOString();
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
      autoDetected: true
    };
    studySessions.unshift(session);
    sessionStore.saveStudySessions();
    lastKnownLiveVideoId = result.videoId;
    console.log(`[YTWatcher] ✅ Auto-activated live session: "${result.title}" (${result.videoId})`);

  } else {
    // Channel is NOT live on YouTube
    if (!existingLive || !existingLive.autoDetected) {
      lastKnownLiveVideoId = null;
      return;
    }
    // Auto-created session → auto-end it
    const elapsed = Date.now() - new Date(existingLive.startedAt || Date.now()).getTime();
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
 * On-demand sync helper: called by SSR routes (/live-study, /api/live-study/status, /)
 * Ensures fresh YouTube state even on serverless environments without persistent timers.
 */
async function syncLiveSessionOnDemand() {
  const now = Date.now();
  if (now - lastOnDemandCheck >= ON_DEMAND_CACHE_TTL_MS) {
    lastOnDemandCheck = now;
    await pollTick();
  }
  const studySessions = sessionStore.getSessions();
  return studySessions.find(s => s.status === 'LIVE') || null;
}

/**
 * Start the background YouTube watcher (for long-running processes like Render).
 */
async function startYoutubeWatcher() {
  if (!YOUTUBE_API_KEY) {
    console.warn('[YTWatcher] YOUTUBE_API_KEY not set — auto-detection disabled.');
    return;
  }

  if (!CHANNEL_ID) {
    CHANNEL_ID = await resolveChannelId();
  }

  console.log(`[YTWatcher] Started. Polling every ${POLL_INTERVAL_MS / 1000}s for channel ${CHANNEL_ID}`);
  await pollTick();
  pollTimer = setInterval(pollTick, POLL_INTERVAL_MS);
}

function stopYoutubeWatcher() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
    console.log('[YTWatcher] Stopped.');
  }
}

module.exports = {
  startYoutubeWatcher,
  stopYoutubeWatcher,
  checkYoutubeLiveStatus,
  syncLiveSessionOnDemand
};
