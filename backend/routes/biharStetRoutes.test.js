const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const zlib = require('node:zlib');
const router = require('./biharStetRoutes');
const store = require('../models/biharStetStore');

function makePdf(content) {
  const stream = zlib.deflateSync(Buffer.from(content, 'latin1'));
  return Buffer.concat([
    Buffer.from('%PDF-1.4\n1 0 obj\n<< /Length 1 /Filter /FlateDecode >>\nstream\n', 'latin1'),
    stream,
    Buffer.from('\nendstream\nendobj\n%%EOF', 'latin1')
  ]);
}

async function withServer(run) {
  const app = express();
  app.use((req, res, next) => {
    req.session = { isAdmin: req.headers['x-test-admin'] === 'true' };
    next();
  });
  app.use(router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const address = server.address();
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

function pdfForm(buffer, fieldName) {
  const form = new FormData();
  form.append(fieldName, new Blob([buffer], { type: 'application/pdf' }), 'official-key.pdf');
  return form;
}

test('PDF preview requires admin auth and returns labeled rows without saving or publishing', async () => {
  await withServer(async baseUrl => {
    const pdf = makePdf('BT (Question ID: Q-1) Tj (Correct Answer: B) Tj ET');
    const unauthenticated = await fetch(`${baseUrl}/api/bihar-stet/admin/keys/preview-pdf`, {
      method: 'POST',
      headers: { Origin: 'https://2amstudy.com' },
      body: pdfForm(pdf, 'answerKeyPdf')
    });
    assert.equal(unauthenticated.status, 401);

    const response = await fetch(`${baseUrl}/api/bihar-stet/admin/keys/preview-pdf`, {
      method: 'POST',
      headers: { Origin: 'https://2amstudy.com', 'x-test-admin': 'true' },
      body: pdfForm(pdf, 'answerKeyPdf')
    });
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.rows[0].id, 'Q-1');
    assert.equal(data.rows[0].answer, 'B');
    assert.match(data.warnings.join(' '), /require administrator review/);
  });
});

test('existing JSON answer-key upload still creates a draft', async () => {
  const originalCreate = store.createKeyVersion;
  store.createKeyVersion = async () => ({ keyId: 'test-key', versionId: 'test-version', version: 1 });
  try {
    await withServer(async baseUrl => {
      const form = new FormData();
      const payload = {
        metadata: { year: '2026', paperId: 'paper-1', subjectId: 'subject', subjectName: 'Subject', shiftId: 'shift', shiftName: 'Shift' },
        questions: [{ id: 'Q-1', answer: 'A' }],
        markingScheme: { correctMarks: 1, incorrectMarks: 0, unansweredMarks: 0 },
        source: 'official source',
        markingRulesSource: 'official rules'
      };
      form.append('answerKey', new Blob([JSON.stringify(payload)], { type: 'application/json' }), 'key.json');
      const response = await fetch(`${baseUrl}/api/bihar-stet/admin/keys`, {
        method: 'POST',
        headers: { Origin: 'https://2amstudy.com', 'x-test-admin': 'true' },
        body: form
      });
      assert.equal(response.status, 201);
      assert.deepEqual(await response.json(), {
        success: true,
        keyId: 'test-key',
        versionId: 'test-version',
        version: 1
      });
    });
  } finally {
    store.createKeyVersion = originalCreate;
  }
});
