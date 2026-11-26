const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { deleteFromCloudinary, uploadToCloudinary } = require('./cloudinary');

test('uploads archived PDFs as authenticated raw assets and signs their access type', async () => {
  const originalFetch = global.fetch;
  const originalEnv = {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    apiSecret: process.env.CLOUDINARY_API_SECRET
  };
  const calls = [];
  process.env.CLOUDINARY_CLOUD_NAME = 'test-cloud';
  process.env.CLOUDINARY_API_KEY = 'test-key';
  process.env.CLOUDINARY_API_SECRET = 'test-secret';
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      json: async () => url.endsWith('/destroy')
        ? { result: 'ok' }
        : { secure_url: 'https://private.example.invalid/file.pdf', public_id: options.body.get('public_id'), bytes: 64, format: 'pdf' }
    };
  };

  try {
    const upload = await uploadToCloudinary(Buffer.from('%PDF-1.4\n'), {
      folder: 'bihar-stet-answer-keys',
      prefix: 'official_key',
      filename: 'official-answer-key.pdf',
      mimetype: 'application/pdf',
      fileExtension: 'pdf',
      resourceType: 'raw',
      deliveryType: 'authenticated'
    });
    const form = calls[0].options.body;
    const signatureParams = {
      folder: form.get('folder'),
      public_id: form.get('public_id'),
      timestamp: form.get('timestamp'),
      type: form.get('type')
    };
    const expectedSignature = crypto.createHash('sha1')
      .update(Object.keys(signatureParams).sort()
        .map(key => `${key}=${signatureParams[key]}`).join('&') + 'test-secret')
      .digest('hex');
    assert.match(calls[0].url, /\/raw\/upload$/);
    assert.equal(form.get('type'), 'authenticated');
    assert.match(form.get('public_id'), /\.pdf$/);
    assert.equal(form.get('signature'), expectedSignature);
    assert.equal(upload.deliveryType, 'authenticated');

    await deleteFromCloudinary({
      publicId: upload.publicId,
      resourceType: 'raw',
      deliveryType: 'authenticated'
    });
    assert.match(calls[1].url, /\/raw\/destroy$/);
    assert.equal(calls[1].options.body.get('type'), 'authenticated');
  } finally {
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries({
      CLOUDINARY_CLOUD_NAME: originalEnv.cloudName,
      CLOUDINARY_API_KEY: originalEnv.apiKey,
      CLOUDINARY_API_SECRET: originalEnv.apiSecret
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
