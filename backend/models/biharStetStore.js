const { validateMarkingScheme } = require('../services/biharStetMarks');

const COLLECTION = 'biharStetAnswerKeys';
const IDENTIFIER = /^[a-z0-9][a-z0-9-]{0,59}$/;
let defaultFirestore;

function getFirestore() {
  if (defaultFirestore === undefined) {
    defaultFirestore = require('../config/firebase').firestoreDb;
  }
  return defaultFirestore;
}

function assertFirestore(db) {
  if (!db) throw new Error('Firestore is not configured for Bihar STET key management.');
}

function validateMetadata(input) {
  const year = String(input.year || '').trim();
  const paperId = String(input.paperId || '').trim().toLowerCase();
  const subjectId = String(input.subjectId || '').trim().toLowerCase();
  const shiftId = String(input.shiftId || '').trim().toLowerCase();
  const examDate = String(input.examDate || '').trim();
  const subjectName = String(input.subjectName || '').trim();
  const shiftName = String(input.shiftName || '').trim();
  if (!/^\d{4}$/.test(year) || ![paperId, subjectId, shiftId].every(value => IDENTIFIER.test(value))) {
    throw new Error('Year, paper, subject, and shift identifiers are required and must be URL-safe.');
  }
  if (examDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(examDate)) {
      throw new Error('Examination date must be a valid YYYY-MM-DD date.');
    }
    const dateParts = examDate.split('-').map(Number);
    const parsedDate = new Date(Date.UTC(dateParts[0], dateParts[1] - 1, dateParts[2]));
    if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== examDate) {
      throw new Error('Examination date must be a valid YYYY-MM-DD date.');
    }
  }
  if (!subjectName || subjectName.length > 100 || !shiftName || shiftName.length > 100) {
    throw new Error('Subject and shift names are required and must be 100 characters or fewer.');
  }
  if (!['paper-1', 'paper-2'].includes(paperId)) {
    throw new Error('Paper must be paper-1 or paper-2.');
  }
  return { year, paperId, subjectId, shiftId, subjectName, shiftName, ...(examDate ? { examDate } : {}) };
}

function validateQuestions(questions) {
  if (!Array.isArray(questions) || !questions.length || questions.length > 500) {
    throw new Error('Answer key must contain between 1 and 500 questions.');
  }
  const ids = new Set();
  return questions.map(question => {
    const id = String(question?.id || '').trim();
    const answer = String(question?.answer || '').trim();
    if (!id || id.length > 100 || !answer || answer.length > 30 || ids.has(id)) {
      throw new Error('Each question needs a unique question ID and a non-empty answer.');
    }
    ids.add(id);
    return { id, answer };
  });
}

function validateSourceDocument(sourceDocument) {
  if (sourceDocument === undefined) return undefined;
  if (!sourceDocument || typeof sourceDocument !== 'object' ||
    sourceDocument.provider !== 'cloudinary' ||
    typeof sourceDocument.publicId !== 'string' ||
    !sourceDocument.publicId.trim() ||
    sourceDocument.publicId.length > 200 ||
    sourceDocument.resourceType !== 'raw' ||
    sourceDocument.deliveryType !== 'authenticated' ||
    typeof sourceDocument.fileName !== 'string' ||
    !sourceDocument.fileName.trim() ||
    !Number.isInteger(sourceDocument.bytes) ||
    sourceDocument.bytes < 1 ||
    sourceDocument.bytes > 10 * 1024 * 1024 ||
    !/^[a-f0-9]{64}$/.test(sourceDocument.sha256 || '') ||
    typeof sourceDocument.uploadedAt !== 'string') {
    throw new Error('The archived source document reference is invalid.');
  }
  return {
    provider: sourceDocument.provider,
    publicId: sourceDocument.publicId,
    resourceType: sourceDocument.resourceType,
    deliveryType: sourceDocument.deliveryType,
    fileName: sourceDocument.fileName.trim().slice(0, 120),
    bytes: sourceDocument.bytes,
    sha256: sourceDocument.sha256,
    uploadedAt: sourceDocument.uploadedAt
  };
}

function keyDocumentId(metadata) {
  return [metadata.year, metadata.paperId, metadata.subjectId, metadata.shiftId].join('_');
}

function collection(db = getFirestore()) {
  assertFirestore(db);
  return db.collection(COLLECTION);
}

async function createKeyVersion(input, db = getFirestore()) {
  const {
    metadata: rawMetadata,
    questions: rawQuestions,
    markingScheme,
    source,
    markingRulesSource,
    notes,
    sourceDocument: rawSourceDocument
  } = input;
  const metadata = validateMetadata(rawMetadata || {});
  const questions = validateQuestions(rawQuestions);
  validateMarkingScheme(markingScheme);
  const sourceDocument = validateSourceDocument(rawSourceDocument);
  const docRef = collection(db).doc(keyDocumentId(metadata));
  const versionRef = docRef.collection('versions').doc();
  let versionNumber;

  await db.runTransaction(async transaction => {
    const parent = await transaction.get(docRef);
    const previous = parent.exists ? parent.data() : {};
    versionNumber = (Number(previous.nextVersion) || 1);
    transaction.set(docRef, {
      ...metadata,
      keyId: docRef.id,
      isPublished: Boolean(previous.isPublished),
      activeVersions: previous.activeVersions || {},
      nextVersion: versionNumber + 1,
      updatedAt: new Date().toISOString(),
      createdAt: previous.createdAt || new Date().toISOString()
    }, { merge: true });
    transaction.set(versionRef, {
      versionId: versionRef.id,
      version: versionNumber,
      status: 'draft',
      questions,
      markingScheme,
      answerKeyVerified: false,
      markingRulesVerified: false,
      source: String(source || '').trim().slice(0, 500),
      markingRulesSource: String(markingRulesSource || '').trim().slice(0, 500),
      notes: String(notes || '').trim().slice(0, 1000),
      ...(sourceDocument ? { sourceDocument } : {}),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  });

  return { keyId: docRef.id, versionId: versionRef.id, version: versionNumber };
}

async function updateKeyVersion(input, db = getFirestore()) {
  const { keyId, versionId, questions, markingScheme, source, markingRulesSource, notes } = input;
  const docRef = collection(db).doc(keyId);
  const sourceRef = docRef.collection('versions').doc(versionId);
  const [parentSnap, sourceSnap] = await Promise.all([docRef.get(), sourceRef.get()]);
  if (!parentSnap.exists || !sourceSnap.exists) throw new Error('Answer-key version was not found.');
  const original = sourceSnap.data();
  const metadata = parentSnap.data();
  return createKeyVersion({
    metadata: {
      year: metadata.year,
      paperId: metadata.paperId,
      subjectId: metadata.subjectId,
      shiftId: metadata.shiftId,
      subjectName: metadata.subjectName,
      shiftName: metadata.shiftName,
      examDate: metadata.examDate
    },
    questions: questions || original.questions,
    markingScheme: markingScheme || original.markingScheme,
    source: source === undefined ? original.source : source,
    markingRulesSource: markingRulesSource === undefined ? original.markingRulesSource : markingRulesSource,
    notes: notes === undefined ? original.notes : notes,
    sourceDocument: original.sourceDocument
  }, db);
}

async function updateKeyMetadata({ keyId, subjectName, shiftName }, db = getFirestore()) {
  const nextSubjectName = String(subjectName || '').trim();
  const nextShiftName = String(shiftName || '').trim();
  if (!nextSubjectName || nextSubjectName.length > 100 || !nextShiftName || nextShiftName.length > 100) {
    throw new Error('Subject and shift names are required and must be 100 characters or fewer.');
  }
  const docRef = collection(db).doc(keyId);
  const doc = await docRef.get();
  if (!doc.exists) throw new Error('Answer key was not found.');
  await docRef.set({
    subjectName: nextSubjectName,
    shiftName: nextShiftName,
    updatedAt: new Date().toISOString()
  }, { merge: true });
}

async function publishKeyVersion(input, db = getFirestore()) {
  const { keyId, versionId, status, answersVerified, markingRulesVerified } = input;
  if (!['provisional', 'final'].includes(status)) {
    throw new Error('Published status must be provisional or final.');
  }
  if (answersVerified !== true || markingRulesVerified !== true) {
    throw new Error('Confirm verification of every answer and the official marking rules before publishing.');
  }
  const docRef = collection(db).doc(keyId);
  const versionRef = docRef.collection('versions').doc(versionId);
  await db.runTransaction(async transaction => {
    const parentSnap = await transaction.get(docRef);
    const versionSnap = await transaction.get(versionRef);
    if (!parentSnap.exists || !versionSnap.exists) throw new Error('Answer-key version was not found.');
    const version = versionSnap.data();
    validateQuestions(version.questions);
    validateMarkingScheme(version.markingScheme);
    if (!version.source || !String(version.source).trim()) {
      throw new Error('Add the official answer-key source or citation before publishing.');
    }
    if (!version.markingRulesSource || !String(version.markingRulesSource).trim()) {
      throw new Error('Add the official marking-rules source or citation before publishing.');
    }

    const activeVersions = parentSnap.data().activeVersions || {};
    const currentId = activeVersions[status];
    const previousVersionRef = currentId && currentId !== versionId
      ? docRef.collection('versions').doc(currentId)
      : null;
    if (previousVersionRef) {
      const previousVersionSnap = await transaction.get(previousVersionRef);
      if (previousVersionSnap.exists) {
        transaction.set(previousVersionRef, {
          status: 'superseded',
          supersededAt: new Date().toISOString()
        }, { merge: true });
      }
    }
    const now = new Date().toISOString();
    transaction.set(versionRef, {
      status,
      answersVerified: true,
      markingRulesVerified: true,
      verifiedAt: now,
      publishedAt: now,
      updatedAt: now
    }, { merge: true });
    transaction.set(docRef, {
      isPublished: true,
      activeVersions: { ...activeVersions, [status]: versionId },
      updatedAt: now
    }, { merge: true });
  });
}

async function getCatalog(db = getFirestore()) {
  const snapshot = await collection(db).where('isPublished', '==', true).get();
  const catalog = [];
  for (const doc of snapshot.docs) {
    const key = doc.data();
    const active = key.activeVersions?.final || key.activeVersions?.provisional;
    if (!active) continue;
    const version = await doc.ref.collection('versions').doc(active).get();
    if (!version.exists) continue;
    const versionData = version.data();
    const activeStatus = key.activeVersions?.final ? 'final' : 'provisional';
    if (versionData.status !== activeStatus ||
      versionData.answersVerified !== true ||
      versionData.markingRulesVerified !== true ||
      !String(versionData.source || '').trim() ||
      !String(versionData.markingRulesSource || '').trim()) continue;
    catalog.push({
      year: key.year,
      paperId: key.paperId,
      paperName: key.paperId === 'paper-1' ? 'Paper I' : 'Paper II',
      subjectId: key.subjectId,
      subjectName: key.subjectName,
      shiftId: key.shiftId,
      shiftName: key.shiftName,
      examDate: key.examDate || '',
      versionId: active,
      version: versionData.version,
      keyStatus: versionData.status,
      questionCount: versionData.questions.length
    });
  }
  return catalog.sort((a, b) =>
    a.paperName.localeCompare(b.paperName) ||
    a.subjectName.localeCompare(b.subjectName) ||
    a.shiftName.localeCompare(b.shiftName)
  );
}

async function getPublishedKey({ year, paperId, subjectId, shiftId }, db = getFirestore()) {
  const metadata = validateMetadata({ year, paperId, subjectId, shiftId, subjectName: 'subject', shiftName: 'shift' });
  const docRef = collection(db).doc(keyDocumentId(metadata));
  const doc = await docRef.get();
  if (!doc.exists || !doc.data().isPublished) return null;
  const active = doc.data().activeVersions || {};
  const keyStatus = active.final ? 'final' : active.provisional ? 'provisional' : null;
  const versionId = active.final || active.provisional;
  if (!versionId) return null;
  const versionSnap = await docRef.collection('versions').doc(versionId).get();
  if (!versionSnap.exists) return null;
  const version = versionSnap.data();
  if (version.status !== keyStatus ||
    version.answersVerified !== true ||
    version.markingRulesVerified !== true ||
    !String(version.source || '').trim() ||
    !String(version.markingRulesSource || '').trim()) return null;
  validateQuestions(version.questions);
  validateMarkingScheme(version.markingScheme);
  return {
    metadata: doc.data(),
    versionId,
    version: version.version,
    keyStatus,
    answerKeyVerified: version.answersVerified,
    markingRulesVerified: version.markingRulesVerified,
    questions: version.questions,
    markingScheme: version.markingScheme
  };
}

async function listAdminKeys(db = getFirestore()) {
  const snapshot = await collection(db).get();
  const result = [];
  for (const doc of snapshot.docs) {
    const key = doc.data();
    const versions = await doc.ref.collection('versions').orderBy('version', 'desc').get();
    result.push({
      ...key,
      versions: versions.docs.map(version => {
        const data = version.data();
        return {
          versionId: data.versionId,
          version: data.version,
          status: data.status,
          answersVerified: data.answersVerified === true,
          markingRulesVerified: data.markingRulesVerified === true,
          verifiedAt: data.verifiedAt,
          questionCount: Array.isArray(data.questions) ? data.questions.length : 0,
          questions: data.questions,
          markingScheme: data.markingScheme,
          source: data.source,
          markingRulesSource: data.markingRulesSource,
          notes: data.notes,
          sourceDocument: data.sourceDocument,
          createdAt: data.createdAt,
          publishedAt: data.publishedAt
        };
      })
    });
  }
  return result;
}

module.exports = {
  createKeyVersion,
  getCatalog,
  getPublishedKey,
  keyDocumentId,
  listAdminKeys,
  publishKeyVersion,
  updateKeyMetadata,
  updateKeyVersion,
  validateMetadata,
  validateQuestions,
  validateSourceDocument
};
