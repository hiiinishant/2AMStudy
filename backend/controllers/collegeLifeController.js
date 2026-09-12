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
  const rawId = String(req.params.id || '').trim();
  let targetId = rawId;
  try {
    targetId = decodeURIComponent(rawId).trim();
  } catch (_) {}

  const idx = videos.findIndex(v => {
    if (!v) return false;
    const vId = String(v.id || '').trim();
    const vYtId = String(v.youtubeVideoId || '').trim();
    return vId === targetId || vId === rawId || vYtId === targetId || vYtId === rawId;
  });

  if (idx === -1) {
    return res.status(404).json({ success: false, error: 'Video not found.' });
  }

  const deleted = videos.splice(idx, 1)[0];
  collegeLifeStore.saveCollegeLifeVideos();
  res.json({ success: true, message: 'Video deleted successfully.', video: deleted });
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

function getVideoById(req, res) {
  const videos = collegeLifeStore.getVideos();
  const video = videos.find(v => v.id === req.params.id);
  if (!video) return res.status(404).json({ success: false, error: 'Video not found.' });
  res.json({ success: true, video });
}

function updateVideo(req, res) {
  const videos = collegeLifeStore.getVideos();
  const video = videos.find(v => v.id === req.params.id);
  if (!video) return res.status(404).json({ success: false, error: 'Video not found.' });

  const { youtubeUrl, title, description, category, duration, thumbnail, isFeatured } = req.body;

  if (title !== undefined) {
    if (!String(title).trim()) {
      return res.status(400).json({ success: false, error: 'Video title cannot be empty.' });
    }
    video.title = String(title).trim();
  }

  if (youtubeUrl !== undefined) {
    const trimmedUrl = String(youtubeUrl).trim();
    if (trimmedUrl) {
      const videoId = collegeLifeStore.extractYoutubeVideoId(trimmedUrl);
      if (!videoId) {
        return res.status(400).json({ success: false, error: 'Invalid YouTube URL.' });
      }
      video.youtubeUrl = trimmedUrl;
      video.youtubeVideoId = videoId;
      if (!thumbnail) {
        video.thumbnail = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
      }
    }
  }

  if (thumbnail !== undefined) {
    video.thumbnail = String(thumbnail).trim() || `https://img.youtube.com/vi/${video.youtubeVideoId}/hqdefault.jpg`;
  }
  if (description !== undefined) video.description = String(description).trim();
  if (category !== undefined) video.category = String(category).trim() || 'College Life';
  if (duration !== undefined) video.duration = String(duration).trim();

  if (isFeatured !== undefined) {
    const featBool = Boolean(isFeatured);
    if (featBool) {
      videos.forEach(v => { v.isFeatured = false; });
      video.isFeatured = true;
    } else {
      video.isFeatured = false;
    }
  }

  video.updatedAt = new Date().toISOString();
  collegeLifeStore.saveCollegeLifeVideos();

  res.json({ success: true, message: 'Video updated successfully.', video });
}

module.exports = {
  getCollegeLifePage,
  getCollegeLifeVideoPage,
  getVideoById,
  addVideo,
  updateVideo,
  deleteVideo,
  setFeaturedVideo
};
