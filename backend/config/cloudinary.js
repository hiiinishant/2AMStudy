const crypto = require('crypto');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

function getCredentials() {
  return {
    cloudName: (process.env.CLOUDINARY_CLOUD_NAME || '').trim(),
    apiKey: (process.env.CLOUDINARY_API_KEY || '').trim(),
    apiSecret: (process.env.CLOUDINARY_API_SECRET || '').trim()
  };
}

function isCloudinaryConfigured() {
  const { cloudName, apiKey, apiSecret } = getCredentials();
  return Boolean(cloudName && apiKey && apiSecret);
}

/**
 * Uploads a file buffer directly to Cloudinary using signed upload
 * @param {Buffer} buffer - File buffer
 * @param {Object} options - Upload options
 * @param {string} [options.folder='store-products'] - Cloudinary folder
 * @param {string} [options.prefix='img'] - Public ID prefix
 * @param {string} [options.mimetype='image/jpeg'] - MIME type
 * @param {string} [options.filename='upload'] - Original file name
 * @param {string} [options.resourceType='image'] - 'image' | 'auto' | 'raw'
 * @returns {Promise<{ url: string, secure_url: string, publicId: string, format: string, bytes: number }>}
 */
async function uploadToCloudinary(buffer, options = {}) {
  if (!buffer || buffer.length === 0) {
    throw new Error('No file buffer provided for Cloudinary upload.');
  }

  const { cloudName, apiKey, apiSecret } = getCredentials();
  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error('Cloudinary credentials missing (CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET).');
  }

  const folder = options.folder || 'store-products';
  const prefix = options.prefix || 'img';
  const publicId = `${prefix}_${Date.now()}_${uuidv4().substring(0, 8)}`;
  const timestamp = Math.floor(Date.now() / 1000);
  const isPdfFile = (options.mimetype && options.mimetype.includes('pdf')) || (options.filename && options.filename.toLowerCase().endsWith('.pdf'));
  const resourceType = options.resourceType || (isPdfFile ? 'auto' : 'image');

  // Cloudinary signature calculation:
  // All parameters must be in alphabetical order: folder, public_id, timestamp
  const paramsToSign = {
    folder,
    public_id: publicId,
    timestamp
  };

  const sortedKeys = Object.keys(paramsToSign).sort();
  const signatureStr = sortedKeys.map(k => `${k}=${paramsToSign[k]}`).join('&') + apiSecret;
  const signature = crypto.createHash('sha1').update(signatureStr).digest('hex');

  const mime = options.mimetype || 'image/jpeg';
  const filename = options.filename || 'upload.jpg';
  const blob = new Blob([buffer], { type: mime });

  const formData = new FormData();
  formData.append('file', blob, filename);
  formData.append('api_key', apiKey);
  formData.append('timestamp', timestamp.toString());
  formData.append('folder', folder);
  formData.append('public_id', publicId);
  formData.append('signature', signature);

  const endpoint = `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`;
  const response = await fetch(endpoint, {
    method: 'POST',
    body: formData
  });

  const data = await response.json();

  if (!response.ok) {
    const errMsg = (data && data.error && data.error.message) || response.statusText || 'Upload failed';
    throw new Error(`Cloudinary error (${response.status}): ${errMsg}`);
  }

  const secureUrl = data.secure_url || data.url;
  return {
    url: secureUrl,
    secure_url: secureUrl,
    publicId: data.public_id,
    format: data.format,
    bytes: data.bytes,
    width: data.width,
    height: data.height
  };
}

module.exports = {
  uploadToCloudinary,
  isCloudinaryConfigured,
  getCredentials
};
