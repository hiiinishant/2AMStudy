const { v4: uuidv4 } = require('uuid');
const collegeLifeStore = require('../models/collegeLifeStore');

function getCollegeLifePage(req, res) {
  const videos = collegeLifeStore.getVideos();
  res.render('college-life', {
    pageTitle: 'College Life Enjoy & Campus Stories | 2AM Study',
    metaDescription: 'Watch college life videos, campus fests, hostel fun, and student vlogs on 2AM Study. Enjoy the best moments of student life.',
    videos
  });
}

function getCollegeLifeVideoPage(req, res) {
  const videos = collegeLifeStore.getVideos();
  const video = videos.find(v => v.id === req.params.id);
  if (!video) {
    return res.status(404).render('404', {
      pageTitle: 'Video Not Found | 2AM Study',
      metaDescription: 'The college life video you are looking for could not be found.'
    });
  }
  const relatedVideos = videos.filter(v => v.id !== video.id).slice(0, 3);
  res.render('college-life-video', {
    pageTitle: `${video.title} | College Life | 2AM Study`,
    metaDescription: video.description || 'Watch college life and campus videos on 2AM Study.',
    video,
    relatedVideos
  });
}

function addVideo(req, res) {
  const { youtubeUrl, title, description, category, duration, thumbnail, isFeatured } = req.body;
  if (!youtubeUrl || !title) {
    return res.status(400).json({ success: false, error: 'YouTube URL and title are required.' });
  }
  const youtubeVideoId = collegeLifeStore.extractYoutubeVideoId(youtubeUrl);
  if (!youtubeVideoId) {
    return res.status(400).json({ success: false, error: 'Invalid YouTube URL.' });
  }

  const videos = collegeLifeStore.getVideos();
  const duplicate = videos.find(v => v.youtubeVideoId === youtubeVideoId);
  if (duplicate) {
    return res.status(409).json({ success: false, error: 'This YouTube video has already been added to College Life.' });
  }

  const newVideo = {
    id: 'cl-' + uuidv4().split('-')[0],
    title: title.trim(),
    description: (description || '').trim(),
    category: (category || 'College Life').trim(),
    duration: (duration || '').trim(),
    youtubeUrl: youtubeUrl.trim(),
    youtubeVideoId,
    thumbnail: (thumbnail && thumbnail.trim()) || `https://img.youtube.com/vi/${youtubeVideoId}/hqdefault.jpg`,
    isFeatured: Boolean(isFeatured),
    createdAt: new Date().toISOString()
  };

  if (newVideo.isFeatured) {
    videos.forEach(v => { v.isFeatured = false; });
  }

  videos.unshift(newVideo);
  collegeLifeStore.saveCollegeLifeVideos();
  res.json({ success: true, video: newVideo });
}

function deleteVideo(req, res) {
  const videos = collegeLifeStore.getVideos();
  const idx = videos.findIndex(v => v.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, error: 'Video not found.' });
  videos.splice(idx, 1);
  collegeLifeStore.saveCollegeLifeVideos();
  res.json({ success: true });
}

function setFeaturedVideo(req, res) {
  const videos = collegeLifeStore.getVideos();
  videos.forEach(v => { v.isFeatured = false; });
  const video = videos.find(v => v.id === req.params.id);
  if (!video) return res.status(404).json({ success: false, error: 'Video not found.' });
  video.isFeatured = true;
  collegeLifeStore.saveCollegeLifeVideos();
  res.json({ success: true, video });
}

module.exports = {
  getCollegeLifePage,
  getCollegeLifeVideoPage,
  addVideo,
  deleteVideo,
  setFeaturedVideo
};
