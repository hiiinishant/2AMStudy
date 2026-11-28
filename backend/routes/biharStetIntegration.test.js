const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

const root = path.resolve(__dirname, '../..');

test('predictor and admin EJS views compile', () => {
  for (const relativePath of [
    'frontend/views/tools/bihar-stet-marks-predictor.ejs',
    'frontend/views/admin-bihar-stet.ejs',
    'frontend/views/admin.ejs',
    'frontend/views/music.ejs'
  ]) {
    const filename = path.join(root, relativePath);
    assert.doesNotThrow(() => ejs.compile(fs.readFileSync(filename, 'utf8'), { filename }));
  }
});

test('music page displays admin-configured video picks as clickable cards', async () => {
  const filename = path.join(root, 'frontend/views/music.ejs');
  const base = {
    pageTitle: 'Music',
    youtubeApiKey: '',
    musicVideosError: false
  };
  const configured = await ejs.renderFile(filename, {
    ...base,
    musicVideos: {
      deepFocusVideoUrl: 'https://www.youtube.com/watch?v=kB8g2lH8e48',
      motivationVideoUrls: Array(12).fill('https://www.youtube.com/watch?v=uNboFgKLGDY')
    }
  });
  assert.match(configured, /data-music-video-title="2 AM Study Deep Focus"/);
  assert.match(configured, /data-music-video-title="2 AM Study Motivation Song 1"/);
  assert.match(configured, /data-music-video-title="2 AM Study Motivation Song 12"/);
  assert.equal((configured.match(/data-music-video-url=/g) || []).length, 13);
  assert.match(configured, /async function showConfiguredVideo/);
  assert.match(configured, /youtube\/v3\/videos\?part=snippet&id=/);
  assert.match(configured, /renderMusicCards\(\[\{ id: \{ videoId \}, snippet: video\.snippet \}\]/);
  assert.match(configured, /card\.addEventListener\('click', \(\) => playVideo\(videoId, title\)\)/);
  assert.match(configured, /showConfiguredVideo\(button\.dataset\.musicVideoUrl, button\.dataset\.musicVideoTitle\)/);
  assert.doesNotMatch(configured, /playlistItems|player\.loadPlaylist/);

  const empty = await ejs.renderFile(filename, {
    ...base,
    musicVideos: { deepFocusVideoUrl: '', motivationVideoUrls: Array(12).fill('') }
  });
  assert.doesNotMatch(empty, /data-music-video-url=/);

  const admin = fs.readFileSync(path.join(root, 'frontend/views/admin.ejs'), 'utf8');
  assert.match(admin, /2 AM Study Deep Focus video URL/);
  assert.match(admin, /2 AM Study Motivation Song <%= motivationIndex %> video URL/);
  assert.match(admin, /motivationIndex <= 12/);
  assert.match(admin, /id="musicMotivationVideoUrl<%= motivationIndex %>"/);
  assert.match(admin, /querySelectorAll\('\[data-motivation-video-url\]'\)/);
  assert.doesNotMatch(admin, /playlist\?list=\.\.\./);
});

test('Bihar STET admin matches the master-console shell without dropping its controls', () => {
  const view = fs.readFileSync(path.join(root, 'frontend/views/admin-bihar-stet.ejs'), 'utf8');
  assert.match(view, /class="bstet-admin-layout"/);
  assert.match(view, /href="\/admin"[^>]*>[\s\S]*?Master dashboard/);
  assert.match(view, /class="active" href="\/admin\/bihar-stet" aria-current="page"/);
  assert.match(view, /name="robots" content="noindex, nofollow"/);
  for (const id of [
    'bstetAdminUpload',
    'bstetPreviewPdf',
    'bstetSavePdfDraft',
    'bstetAdminRefresh',
    'bstetPdfRows',
    'bstetPdfPaper',
    'bstetPdfSubjectName',
    'bstetPdfShift',
    'bstetPdfExamDate'
  ]) {
    assert.match(view, new RegExp(`id="${id}"`), `${id} must remain available to the admin workflow`);
  }
});

test('Bihar STET admin view renders both standalone and embedded modes', async () => {
  const filename = path.join(root, 'frontend/views/admin-bihar-stet.ejs');
  const standalone = await ejs.renderFile(filename, {
    pageTitle: 'Bihar STET Admin',
    pageCss: '/assets/css/bihar-stet.css'
  });
  const embedded = await ejs.renderFile(filename, { embedded: true });

  assert.match(standalone, /class="bstet-admin-layout"/);
  assert.doesNotMatch(embedded, /<!DOCTYPE html>|class="bstet-admin-layout"/);
  assert.match(embedded, /id="bstetAdminUpload"/);
  assert.match(embedded, /id="bstetAdminKeys"/);
});

test('master admin embeds Bihar STET tools as a section with its existing controller', () => {
  const view = fs.readFileSync(path.join(root, 'frontend/views/admin.ejs'), 'utf8');
  assert.match(view, /data-section="bihar-stet"/);
  assert.match(view, /id="sec-bihar-stet"/);
  assert.match(view, /include\('admin-bihar-stet', \{ embedded: true \}\)/);
  assert.match(view, /'bihar-stet': 'Bihar STET Keys'/);
  assert.match(view, /class="<%= isAuthed \? 'bstet-admin-host' : '' %>"/);
  assert.match(view, /bihar-stet-admin\.js\?v=4/);
});

test('unauthenticated admin page guards product-modal setup when dashboard markup is absent', () => {
  const view = fs.readFileSync(path.join(root, 'frontend/views/admin.ejs'), 'utf8');
  const loginHandlerIndex = view.indexOf("loginForm.addEventListener('submit'");
  const modalGuardIndex = view.indexOf("if (addProductModal) {");
  assert.ok(loginHandlerIndex >= 0);
  assert.ok(modalGuardIndex > loginHandlerIndex);
  assert.match(view, /const addProductModal = document\.getElementById\('addProductModal'\);/);
});

test('predictor hides response upload until verified answer keys are available', () => {
  const view = fs.readFileSync(
    path.join(root, 'frontend/views/tools/bihar-stet-marks-predictor.ejs'),
    'utf8'
  );
  assert.match(view, /id="bstetCatalogTitle"/);
  assert.match(view, /id="bstetCatalogMessage"/);
  assert.match(view, /id="bstetPredictorForm" hidden/);
});

test('admin UI makes PDF upload primary and keeps the blank JSON template optional', () => {
  const view = fs.readFileSync(path.join(root, 'frontend/views/admin-bihar-stet.ejs'), 'utf8');
  const controller = fs.readFileSync(
    path.join(root, 'frontend/public/assets/js/bihar-stet-admin.js'),
    'utf8'
  );
  const template = JSON.parse(fs.readFileSync(
    path.join(root, 'frontend/public/assets/templates/bihar-stet-answer-key-template.json'),
    'utf8'
  ));
  assert.match(view, /Upload/);
  assert.match(view, /Review/);
  assert.match(view, /Verify sources/);
  assert.match(view, /Save reviewed answers as draft/);
  assert.match(controller, /Publish \$\{status\}/);
  assert.match(view, /No JSON upload is required/);
  assert.match(view, /class="[^"]*bstet-admin-pdf-card/);
  assert.match(view, /class="bstet-admin-legacy-import"/);
  assert.match(view, /Optional legacy JSON import — not needed for the PDF workflow/);
  assert.match(view, /bihar-stet-answer-key-template\.json/);
  assert.deepEqual(template.questions, []);
  assert.equal(template.metadata.paperId, '');
  assert.equal(template.markingScheme.correctMarks, null);
  assert.equal(template.source, '');
  assert.equal(template.markingRulesSource, '');
});

test('embedded Bihar STET admin omits summary panels and keeps the upload and key library', () => {
  const view = fs.readFileSync(path.join(root, 'frontend/views/admin-bihar-stet.ejs'), 'utf8');
  const master = fs.readFileSync(path.join(root, 'frontend/views/admin.ejs'), 'utf8');
  const controller = fs.readFileSync(
    path.join(root, 'frontend/public/assets/js/bihar-stet-admin.js'),
    'utf8'
  );

  assert.doesNotMatch(view, /bstet-admin-workflow|bstet-admin-status-grid|bstetAdminDataWarning|bstetStatusNoKey/);
  assert.doesNotMatch(master, /Manage Bihar STET answer keys|Preview student tool/);
  assert.doesNotMatch(controller, /bstetAdminDataWarning|bstetStatusNoKey|bstetStatusDraft/);
  assert.match(view, /id="bstetKeyPdf"/);
  assert.match(view, /id="bstetAdminKeys"/);
});

test('PDF answer-key intake offers catalog-based exam selections and a required date', () => {
  const view = fs.readFileSync(path.join(root, 'frontend/views/admin-bihar-stet.ejs'), 'utf8');
  const controller = fs.readFileSync(
    path.join(root, 'frontend/public/assets/js/bihar-stet-admin.js'),
    'utf8'
  );
  assert.match(view, /id="bstetPdfPaper" required/);
  assert.match(view, /id="bstetPdfSubjectName" list="bstetPdfSubjectOptions".*required/);
  assert.match(view, /<datalist id="bstetPdfSubjectOptions"><\/datalist>/);
  assert.match(view, /id="bstetPdfShift" required/);
  assert.match(view, /id="bstetPdfExamDate" type="date" required/);
  assert.match(view, /Official BSEB answer-key PDF/);
  assert.ok(view.indexOf('id="bstetPdfPaper"') < view.indexOf('id="bstetKeyPdf"'));
  assert.match(controller, /subjectNameInput\.addEventListener\('input'/);
});

test('Vercel routes admin, music, College Life, predictor, and feature assets to Render', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  const sources = new Set(config.rewrites.map(rewrite => rewrite.source));
  for (const source of [
    '/tools/bihar-stet-marks-predictor',
    '/music',
    '/college-life',
    '/college-life/:id',
    '/admin',
    '/admin/logout',
    '/admin/bihar-stet',
    '/assets/css/bihar-stet.css',
    '/assets/js/bihar-stet-predictor.js',
    '/assets/js/bihar-stet-admin.js',
    '/assets/templates/bihar-stet-answer-key-template.json'
  ]) {
    assert.equal(sources.has(source), true, `${source} needs a Render rewrite`);
  }
});
