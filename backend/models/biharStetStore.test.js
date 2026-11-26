const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('./biharStetStore');

class FakeSnapshot {
  constructor(ref, data) {
    this.ref = ref;
    this.exists = data !== undefined;
    this.value = data;
  }

  data() {
    return this.value && { ...this.value };
  }
}

class FakeDocument {
  constructor(db, path) {
    this.db = db;
    this.path = path;
    this.id = path[path.length - 1];
  }

  collection(name) {
    return new FakeCollection(this.db, [...this.path, name]);
  }

  async get() {
    return new FakeSnapshot(this, this.db.documents.get(this.path.join('/')));
  }

  async set(data, options = {}) {
    const key = this.path.join('/');
    const current = this.db.documents.get(key) || {};
    this.db.documents.set(key, options.merge ? { ...current, ...data } : { ...data });
  }
}

class FakeCollection {
  constructor(db, path, filters = [], ordering = null) {
    this.db = db;
    this.path = path;
    this.filters = filters;
    this.ordering = ordering;
  }

  doc(id) {
    const nextId = id || `test-version-${++this.db.nextId}`;
    return new FakeDocument(this.db, [...this.path, nextId]);
  }

  where(field, operator, value) {
    assert.equal(operator, '==');
    return new FakeCollection(this.db, this.path, [...this.filters, [field, value]], this.ordering);
  }

  orderBy(field, direction) {
    return new FakeCollection(this.db, this.path, this.filters, [field, direction]);
  }

  async get() {
    const docs = [];
    for (const [path, data] of this.db.documents.entries()) {
      const parts = path.split('/');
      if (parts.length !== this.path.length + 1 ||
        !this.path.every((part, index) => parts[index] === part) ||
        !this.filters.every(([field, value]) => data[field] === value)) continue;
      const ref = new FakeDocument(this.db, parts);
      docs.push({ id: ref.id, ref, exists: true, data: () => ({ ...data }) });
    }
    if (this.ordering) {
      const [field, direction] = this.ordering;
      docs.sort((left, right) =>
        (left.data()[field] - right.data()[field]) * (direction === 'desc' ? -1 : 1)
      );
    }
    return { docs, empty: docs.length === 0 };
  }
}

class FakeFirestore {
  constructor() {
    this.documents = new Map();
    this.nextId = 0;
  }

  collection(name) {
    return new FakeCollection(this, [name]);
  }

  runTransaction(callback) {
    const writes = [];
    const transaction = {
      get: ref => ref.get(),
      set: (ref, data, options) => { writes.push(ref.set(data, options)); }
    };
    return Promise.resolve(callback(transaction)).then(() => Promise.all(writes));
  }
}

function keyPayload(paperId, subjectId) {
  return {
    metadata: {
      year: '2026',
      paperId,
      subjectId,
      subjectName: `Test subject ${subjectId}`,
      shiftId: 'shift-1',
      shiftName: 'Test shift'
    },
    questions: [{ id: `${subjectId}-q1`, answer: 'A' }],
    markingScheme: { correctMarks: 1, incorrectMarks: -0.25, unansweredMarks: 0 },
    source: 'https://example.invalid/test-fixture',
    markingRulesSource: 'https://example.invalid/test-rules',
    notes: 'Synthetic unit-test fixture only'
  };
}

test('validates Paper I and Paper II metadata and rejects other paper identifiers', () => {
  for (const paperId of ['paper-1', 'paper-2']) {
    assert.equal(store.validateMetadata({
      year: '2026',
      paperId,
      subjectId: 'test-subject',
      subjectName: 'Test subject',
      shiftId: 'shift-1',
      shiftName: 'Test shift'
    }).paperId, paperId);
  }
  assert.throws(() => store.validateMetadata({
    year: '2026',
    paperId: 'paper-3',
    subjectId: 'test-subject',
    subjectName: 'Test subject',
    shiftId: 'shift-1',
    shiftName: 'Test shift'
  }), /Paper must be/);
});

test('validates and preserves the official examination date in answer-key metadata', async () => {
  const db = new FakeFirestore();
  const payload = keyPayload('paper-1', 'science');
  payload.metadata.examDate = '2026-11-25';
  const version = await store.createKeyVersion(payload, db);
  const key = (await store.listAdminKeys(db))[0];
  assert.equal(key.examDate, '2026-11-25');

  const revision = await store.updateKeyVersion({
    keyId: version.keyId,
    versionId: version.versionId,
    questions: [{ id: 'science-q1', answer: 'B' }]
  }, db);
  assert.equal(revision.version, 2);
  assert.equal((await store.listAdminKeys(db))[0].examDate, '2026-11-25');
  assert.throws(() => store.validateMetadata({
    ...payload.metadata,
    examDate: '2026-02-30'
  }), /valid YYYY-MM-DD date/);
});

test('does not expose or score draft keys until answer and official-rule verification is explicit', async () => {
  const db = new FakeFirestore();
  const draft = await store.createKeyVersion(keyPayload('paper-1', 'science'), db);
  await assert.rejects(() => store.publishKeyVersion({
    keyId: draft.keyId,
    versionId: draft.versionId,
    status: 'final',
    answersVerified: true,
    markingRulesVerified: false
  }, db), /verification/);

  assert.deepEqual(await store.getCatalog(db), []);
  assert.equal(await store.getPublishedKey({
    year: '2026', paperId: 'paper-1', subjectId: 'science', shiftId: 'shift-1'
  }, db), null);
});

test('requires a separate official marking-rules citation before publishing', async () => {
  const db = new FakeFirestore();
  const payload = keyPayload('paper-1', 'science');
  delete payload.markingRulesSource;
  const draft = await store.createKeyVersion(payload, db);
  await assert.rejects(() => store.publishKeyVersion({
    keyId: draft.keyId,
    versionId: draft.versionId,
    status: 'provisional',
    answersVerified: true,
    markingRulesVerified: true
  }, db), /marking-rules source/);
});

test('publishes both papers, keeps answer revisions, and only activates verified versions', async () => {
  const db = new FakeFirestore();
  const sourceDocument = {
    provider: 'cloudinary',
    publicId: 'bihar-stet-answer-keys/official_key_1.pdf',
    resourceType: 'raw',
    deliveryType: 'authenticated',
    fileName: 'official-key.pdf',
    bytes: 64,
    sha256: 'a'.repeat(64),
    uploadedAt: '2026-01-01T00:00:00.000Z'
  };
  const paperOnePayload = keyPayload('paper-1', 'science');
  paperOnePayload.sourceDocument = sourceDocument;
  const paperOne = await store.createKeyVersion(paperOnePayload, db);
  const paperTwo = await store.createKeyVersion(keyPayload('paper-2', 'math'), db);

  for (const version of [paperOne, paperTwo]) {
    await store.publishKeyVersion({
      keyId: version.keyId,
      versionId: version.versionId,
      status: 'final',
      answersVerified: true,
      markingRulesVerified: true
    }, db);
  }

  const paperOneKey = await store.getPublishedKey({
    year: '2026', paperId: 'paper-1', subjectId: 'science', shiftId: 'shift-1'
  }, db);
  const paperTwoKey = await store.getPublishedKey({
    year: '2026', paperId: 'paper-2', subjectId: 'math', shiftId: 'shift-1'
  }, db);
  assert.equal(paperOneKey.answerKeyVerified, true);
  assert.equal(paperOneKey.markingRulesVerified, true);
  assert.equal(paperTwoKey.metadata.paperId, 'paper-2');
  assert.equal((await store.getCatalog(db)).length, 2);

  const revision = await store.updateKeyVersion({
    keyId: paperOne.keyId,
    versionId: paperOne.versionId,
    questions: [{ id: 'science-q1', answer: 'B' }]
  }, db);
  assert.equal(revision.version, 2);
  assert.deepEqual(paperOneKey.questions, [{ id: 'science-q1', answer: 'A' }]);

  const versions = (await store.listAdminKeys(db)).find(key => key.keyId === paperOne.keyId).versions;
  assert.equal(versions.length, 2);
  const originalVersion = versions.find(version => version.versionId === paperOne.versionId);
  assert.equal(originalVersion.status, 'final');
  assert.equal(originalVersion.answersVerified, true);
  assert.equal(versions.find(version => version.versionId === revision.versionId).status, 'draft');
  assert.deepEqual(originalVersion.sourceDocument, sourceDocument);
  assert.deepEqual(versions.find(version => version.versionId === revision.versionId).sourceDocument, sourceDocument);

  await store.publishKeyVersion({
    keyId: paperOne.keyId,
    versionId: revision.versionId,
    status: 'final',
    answersVerified: true,
    markingRulesVerified: true
  }, db);
  const revisedKey = await store.getPublishedKey({
    year: '2026', paperId: 'paper-1', subjectId: 'science', shiftId: 'shift-1'
  }, db);
  assert.deepEqual(revisedKey.questions, [{ id: 'science-q1', answer: 'B' }]);

  const revisedVersions = (await store.listAdminKeys(db)).find(key => key.keyId === paperOne.keyId).versions;
  assert.equal(revisedVersions.find(version => version.versionId === paperOne.versionId).status, 'superseded');
  assert.equal(revisedVersions.find(version => version.versionId === revision.versionId).status, 'final');
});

test('rejects public source document references for PDF-based versions', async () => {
  const payload = keyPayload('paper-1', 'science');
  payload.sourceDocument = {
    provider: 'cloudinary',
    publicId: 'public-answer-key',
    resourceType: 'raw',
    deliveryType: 'upload',
    fileName: 'official-key.pdf',
    bytes: 64,
    uploadedAt: '2026-01-01T00:00:00.000Z'
  };
  await assert.rejects(() => store.createKeyVersion(payload, new FakeFirestore()), /source document reference is invalid/);
});

test('stores a private PDF reference only as an unpublished draft', async () => {
  const db = new FakeFirestore();
  const payload = keyPayload('paper-1', 'science');
  payload.sourceDocument = {
    provider: 'cloudinary',
    publicId: 'bihar-stet-answer-keys/private-key.pdf',
    resourceType: 'raw',
    deliveryType: 'authenticated',
    fileName: 'bseb-key.pdf',
    bytes: 128,
    sha256: 'b'.repeat(64),
    uploadedAt: '2026-01-01T00:00:00.000Z'
  };
  const draft = await store.createKeyVersion(payload, db);
  const adminKey = (await store.listAdminKeys(db))[0];
  assert.equal(adminKey.versions[0].status, 'draft');
  assert.deepEqual(adminKey.versions[0].sourceDocument, payload.sourceDocument);
  assert.deepEqual(await store.getCatalog(db), []);
  assert.equal(await store.getPublishedKey({
    year: '2026', paperId: 'paper-1', subjectId: 'science', shiftId: 'shift-1'
  }, db), null);
  assert.ok(draft.version);
});
