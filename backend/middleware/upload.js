const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Multer memory storage for secure evidence uploads
const evidenceStorage = multer.memoryStorage();

const evidenceFileFilter = (req, file, cb) => {
  const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf'];
  const ext = path.extname(file.originalname).toLowerCase();
  const allowedExts = ['.jpg', '.jpeg', '.png', '.webp', '.pdf'];

  if (allowedMimeTypes.includes(file.mimetype) || allowedExts.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file format. Only JPG, PNG, and PDF files are allowed.'), false);
  }
};

const uploadEvidence = multer({
  storage: evidenceStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB limit per file
  fileFilter: evidenceFileFilter
}).array('evidence', 5);

// Multer memory storage for store product and blog image uploads
const imageMemoryStorage = multer.memoryStorage();

const uploadProductImage = multer({
  storage: imageMemoryStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter: function (req, file, cb) {
    const allowed = /jpg|jpeg|png|webp|gif|svg|avif/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype.split('/')[1]);
    if (ext || mime) cb(null, true);
    else cb(new Error('Only image files (jpg, png, webp, gif, svg, avif) are allowed'));
  }
});

module.exports = {
  uploadEvidence,
  uploadProductImage
};
