const express = require('express');
const router = express.Router();
const musicPlaylistStore = require('../models/musicPlaylistStore');
const { PlaylistUrlValidationError } = musicPlaylistStore;
const { requireStoreAdmin } = require('../middleware/adminAuth');

router.get('/api/admin/music-playlists', requireStoreAdmin, async (req, res) => {
  try {
    const playlists = await musicPlaylistStore.getMusicPlaylists();
    return res.json({ success: true, playlists });
  } catch (error) {
    console.error('[Music playlists] Could not load settings:', error.message);
    return res.status(503).json({
      success: false,
      error: 'Music playlist settings are currently unavailable.'
    });
  }
});

router.put('/api/admin/music-playlists', requireStoreAdmin, async (req, res) => {
  try {
    const playlists = await musicPlaylistStore.saveMusicPlaylists(req.body);
    return res.json({ success: true, playlists });
  } catch (error) {
    if (error instanceof PlaylistUrlValidationError) {
      return res.status(400).json({ success: false, error: error.message });
    }

    console.error('[Music playlists] Could not save settings:', error.message);
    return res.status(503).json({
      success: false,
      error: 'Music playlist settings could not be saved.'
    });
  }
});

module.exports = router;
