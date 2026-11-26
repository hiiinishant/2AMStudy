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
 * @param {string} [options.deliveryType] - Cloudinary delivery type, such as 'authenticated'
 * @param {string} [options.fileExtension] - Extension to preserve in the asset public ID
 * @returns {Promise<{ url: string, secure_url: string, publicId: string, format: string, bytes: number, deliveryType: string }>}
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
  const fileExtension = String(options.fileExtension || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
  const publicId = `${prefix}_${Date.now()}_${uuidv4().substring(0, 8)}${fileExtension ? `.${fileExtension}` : ''}`;
  const timestamp = Math.floor(Date.now() / 1000);
  const isPdfFile = (options.mimetype && options.mimetype.includes('pdf')) || (options.filename && options.filename.toLowerCase().endsWith('.pdf'));
  const resourceType = options.resourceType || (isPdfFile ? 'auto' : 'image');
  const deliveryType = options.deliveryType;

  const paramsToSign = {
    folder,
    public_id: publicId,
    timestamp
  };
  if (deliveryType) paramsToSign.type = deliveryType;

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
  if (deliveryType) formData.append('type', deliveryType);

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
    height: data.height,
    deliveryType: deliveryType || 'upload'
  };
}

async function deleteFromCloudinary({ publicId, resourceType = 'raw', deliveryType = 'authenticated' }) {
  if (!publicId) throw new Error('A Cloudinary public ID is required for deletion.');
  const { cloudName, apiKey, apiSecret } = getCredentials();
  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error('Cloudinary credentials are required to delete the archived document.');
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const paramsToSign = { public_id: publicId, timestamp };
  if (deliveryType) paramsToSign.type = deliveryType;
  const signatureStr = Object.keys(paramsToSign).sort()
    .map(key => `${key}=${paramsToSign[key]}`).join('&') + apiSecret;
  const signature = crypto.createHash('sha1').update(signatureStr).digest('hex');
  const formData = new FormData();
  formData.append('public_id', publicId);
  formData.append('timestamp', timestamp.toString());
  formData.append('api_key', apiKey);
  formData.append('signature', signature);
  if (deliveryType) formData.append('type', deliveryType);

  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/destroy`, {
    method: 'POST',
    body: formData
  });
  const data = await response.json();
  if (!response.ok || !['ok', 'not found'].includes(data.result)) {
    throw new Error(`Cloudinary deletion failed: ${data?.result || response.statusText}`);
  }
}

module.exports = {
  uploadToCloudinary,
  deleteFromCloudinary,
  isCloudinaryConfigured,
  getCredentials
};
