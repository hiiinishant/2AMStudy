const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Multer memory storage for secure evidence uploads
const evidenceStorage = multer.memoryStorage();

const evidenceFileFilter = (req, file, cb) => {
  const allowedMimeTypes = {
    '.jpg': ['image/jpeg', 'image/jpg'],
    '.jpeg': ['image/jpeg', 'image/jpg'],
    '.png': ['image/png'],
    '.webp': ['image/webp'],
    '.pdf': ['application/pdf']
  };
  const ext = path.extname(file.originalname).toLowerCase();

  if (allowedMimeTypes[ext]?.includes(file.mimetype)) {
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
    const allowedMimeByExt = {
      '.jpg': ['image/jpeg'],
      '.jpeg': ['image/jpeg'],
      '.png': ['image/png'],
      '.webp': ['image/webp'],
      '.gif': ['image/gif'],
      '.avif': ['image/avif']
    };
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedMimeByExt[ext]?.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only matching JPG, PNG, WEBP, GIF, or AVIF image files are allowed'));
  }
});

module.exports = {
  uploadEvidence,
  uploadProductImage
};
