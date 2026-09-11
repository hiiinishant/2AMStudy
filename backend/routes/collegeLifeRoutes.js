const express = require('express');
const router = express.Router();
const collegeLifeController = require('../controllers/collegeLifeController');
const { requireAdminForCollegeLife } = require('../middleware/adminAuth');

// Views
router.get('/college-life', collegeLifeController.getCollegeLifePage);
router.get('/college-life/:id', collegeLifeController.getCollegeLifeVideoPage);

// Public APIs
router.get('/api/college-life/videos', (req, res) => {
  const collegeLifeStore = require('../models/collegeLifeStore');
  res.json({ success: true, videos: collegeLifeStore.getVideos() });
});

// Admin API
router.get('/api/college-life/videos/:id', requireAdminForCollegeLife, collegeLifeController.getVideoById);
router.post('/api/college-life/videos', requireAdminForCollegeLife, collegeLifeController.addVideo);
router.put('/api/college-life/videos/:id', requireAdminForCollegeLife, collegeLifeController.updateVideo);
router.delete('/api/college-life/videos/:id', requireAdminForCollegeLife, collegeLifeController.deleteVideo);
router.patch('/api/college-life/videos/:id/feature', requireAdminForCollegeLife, collegeLifeController.setFeaturedVideo);

module.exports = router;
