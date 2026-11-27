const express = require('express');
const router = express.Router();
const musicQuickPickStore = require('../models/musicPlaylistStore');
const { VideoUrlValidationError } = musicQuickPickStore;
const { requireStoreAdmin } = require('../middleware/adminAuth');

router.get('/api/admin/music-playlists', requireStoreAdmin, async (req, res) => {
  try {
    const videos = await musicQuickPickStore.getMusicVideos();
    return res.json({ success: true, videos });
  } catch (error) {
    console.error('[Music quick picks] Could not load settings:', error.message);
    return res.status(503).json({
      success: false,
      error: 'Music Quick Pick settings are currently unavailable.'
    });
  }
});

router.put('/api/admin/music-playlists', requireStoreAdmin, async (req, res) => {
  try {
    const videos = await musicQuickPickStore.saveMusicVideos(req.body);
    return res.json({ success: true, videos });
  } catch (error) {
    if (error instanceof VideoUrlValidationError) {
      return res.status(400).json({ success: false, error: error.message });
    }

    console.error('[Music quick picks] Could not save settings:', error.message);
    return res.status(503).json({
      success: false,
      error: 'Music Quick Pick settings could not be saved.'
    });
  }
});

module.exports = router;
