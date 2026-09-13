const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const resourceStore = require('../models/resourceStore');
const { requireAdminForCollegeLife } = require('../middleware/adminAuth');

function isHttpUrl(value) {
  try {
    const url = new URL(String(value).trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

// Add resource card
router.post('/api/resources', requireAdminForCollegeLife, (req, res) => {
  const { title, exam, category, officialUrl, description, latestYear } = req.body;
  if (!title || !exam || !officialUrl) {
    return res.status(400).json({ success: false, error: 'Title, exam name, and official URL are required.' });
  }
  if (!isHttpUrl(officialUrl)) {
    return res.status(400).json({ success: false, error: 'Official URL must use http or https.' });
  }

  const examResources = resourceStore.getResources();
  const examSlug = exam.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const newResource = {
    id: 'res-' + uuidv4().split('-')[0],
    title: title.trim(),
    exam: exam.trim(),
    examSlug: examSlug || 'general',
    category: (category || 'PYQ').trim().toUpperCase(),
    officialUrl: officialUrl.trim(),
    description: (description || '').trim(),
    lastUpdated: new Date().toISOString().split('T')[0],
    latestYear: latestYear ? parseInt(latestYear, 10) : new Date().getFullYear(),
    active: true,
    createdAt: new Date().toISOString()
  };

  examResources.unshift(newResource);
  resourceStore.saveExamResources();
  res.json({ success: true, resource: newResource });
});

// Delete resource card
router.delete('/api/resources/:id', requireAdminForCollegeLife, (req, res) => {
  const examResources = resourceStore.getResources();
  const idx = examResources.findIndex(r => r.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, error: 'Resource not found.' });
  examResources.splice(idx, 1);
  resourceStore.saveExamResources();
  res.json({ success: true });
});

module.exports = router;
