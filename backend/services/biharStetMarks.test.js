const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { parseResponseSheetText, readPdfString, scoreResponses, validateMarkingScheme } = require('./biharStetMarks');

const scheme = { correctMarks: 1, incorrectMarks: -0.25, unansweredMarks: 0 };
const questions = [
  { id: 'Q-1', answer: 'A' },
  { id: 'Q-2', answer: 'B' },
  { id: 'Q-3', answer: 'C' }
];

function makePdf(content, compressed) {
  const stream = compressed ? zlib.deflateSync(Buffer.from(content, 'latin1')) : Buffer.from(content, 'latin1');
  const dictionary = compressed ? '<< /Length 1 /Filter /FlateDecode >>' : '<< /Length 1 >>';
  return Buffer.concat([
    Buffer.from(`%PDF-1.4\n1 0 obj\n${dictionary}\nstream\n`, 'latin1'),
    stream,
    Buffer.from('\nendstream\nendobj\n%%EOF', 'latin1')
  ]);
}

test('extracts labeled responses from uncompressed and Flate-compressed PDF text streams', () => {
  const content = 'BT (Question ID: Q-1) Tj (Chosen Option: A) Tj ET';
  for (const compressed of [false, true]) {
    const text = readPdfString(makePdf(content, compressed));
    assert.deepEqual(parseResponseSheetText(text), [
      { questionId: 'Q-1', answer: 'A', readable: true }
    ]);
  }
});

test('reads text assembled with PDF TJ arrays and hex strings', () => {
  const text = readPdfString(makePdf(
    'BT [(Question ID: Q-1) 20 <43686f73656e204f7074696f6e3a2041>] TJ ET',
    false
  ));
  assert.deepEqual(parseResponseSheetText(text), [
    { questionId: 'Q-1', answer: 'A', readable: true }
  ]);
});

test('keeps explicit blanks distinct from unreadable response values', () => {
  const responses = parseResponseSheetText(
    'Question ID: Q-1 Chosen Option: Not Answered Question ID: Q-2 Response omitted'
  );
  assert.deepEqual(responses, [
    { questionId: 'Q-1', answer: null, readable: true },
    { questionId: 'Q-2', answer: null, readable: false }
  ]);
});

test('rejects invalid PDFs and response sheets without labeled question IDs', () => {
  assert.throws(() => readPdfString(Buffer.from('not a pdf')), /valid PDF/);
  assert.throws(() => parseResponseSheetText('some unrelated document'), /question IDs/);
  assert.throws(() => parseResponseSheetText('Question ID: Q-1 Question ID: Q-1'), /Duplicate question ID/);
  assert.throws(() => readPdfString(Buffer.from('%PDF-1.4\n<< /Filter /FlateDecode >>\nstream\nbad\nendstream', 'latin1')), /decode compressed PDF text/);
});

test('calculates raw marks for a complete response set and does not normalize them', () => {
  const result = scoreResponses({
    questions,
    responses: [
      { questionId: 'Q-3', answer: null, readable: true },
      { questionId: 'Q-1', answer: 'a', readable: true },
      { questionId: 'Q-2', answer: 'D', readable: true }
    ],
    markingScheme: scheme,
    keyStatus: 'final',
    answerKeyVerified: true,
    markingRulesVerified: true,
    sourceType: 'manual'
  });
  assert.equal(result.correct, 1);
  assert.equal(result.incorrect, 1);
  assert.equal(result.unanswered, 1);
  assert.equal(result.rawMarks, 0.75);
  assert.equal(result.scoreType, 'raw');
  assert.equal(result.fullyVerified, true);
});

test('withholds complete marks for missing, unreadable or unmatched question IDs', () => {
  const result = scoreResponses({
    questions,
    responses: [
      { questionId: 'Q-1', answer: 'A', readable: true },
      { questionId: 'Q-2', answer: null, readable: false },
      { questionId: 'unknown', answer: 'C', readable: true }
    ],
    markingScheme: scheme,
    keyStatus: 'final',
    answerKeyVerified: true,
    markingRulesVerified: true,
    sourceType: 'pdf'
  });
  assert.equal(result.rawMarks, null);
  assert.equal(result.fullyVerified, false);
  assert.deepEqual(result.unmatchedIds, ['unknown']);
  assert.equal(result.unreadable, 2);
  assert.deepEqual(result.missingIds, ['Q-3']);
});

test('rejects duplicate candidate answer IDs instead of counting one twice', () => {
  assert.throws(() => scoreResponses({
    questions,
    responses: [
      { questionId: 'Q-1', answer: 'A', readable: true },
      { questionId: 'Q-1', answer: 'B', readable: true }
    ],
    markingScheme: scheme,
    keyStatus: 'final',
    answerKeyVerified: true,
    markingRulesVerified: true,
    sourceType: 'manual'
  }), /Duplicate response/);
});

test('provisional key scores remain estimates, never fully verified', () => {
  const result = scoreResponses({
    questions,
    responses: questions.map(question => ({ questionId: question.id, answer: question.answer, readable: true })),
    markingScheme: scheme,
    keyStatus: 'provisional',
    answerKeyVerified: true,
    markingRulesVerified: true,
    sourceType: 'manual'
  });
  assert.equal(result.rawMarks, 3);
  assert.equal(result.fullyVerified, false);
});

test('refuses scoring unless the key and official marking rules are verified', () => {
  assert.throws(() => scoreResponses({
    questions,
    responses: questions.map(question => ({ questionId: question.id, answer: question.answer, readable: true })),
    markingScheme: scheme,
    keyStatus: 'final',
    answerKeyVerified: true,
    markingRulesVerified: false,
    sourceType: 'manual'
  }), /verified official marking rules/);
});

test('rejects marking rules that could not be represented as valid point values', () => {
  assert.throws(() => validateMarkingScheme({ correctMarks: -1, incorrectMarks: 0, unansweredMarks: 0 }));
  assert.throws(() => validateMarkingScheme({ correctMarks: 1, incorrectMarks: 0.25, unansweredMarks: 0 }));
  assert.throws(() => validateMarkingScheme({ correctMarks: 1, incorrectMarks: -0.25, unansweredMarks: NaN }));
});
