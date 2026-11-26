const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { extractOfficialAnswerKeyPdf, parseOfficialAnswerKeyText } = require('./biharStetAnswerKeyPdf');

function makePdf(content) {
  const stream = zlib.deflateSync(Buffer.from(content, 'latin1'));
  return Buffer.concat([
    Buffer.from('%PDF-1.4\n1 0 obj\n<< /Length 1 /Filter /FlateDecode >>\nstream\n', 'latin1'),
    stream,
    Buffer.from('\nendstream\nendobj\n%%EOF', 'latin1')
  ]);
}

test('extracts explicitly labeled question IDs and correct answers from PDF text', () => {
  const result = extractOfficialAnswerKeyPdf(makePdf(
    'BT (Question ID: Q-12) Tj (Correct Answer: Option B) Tj (Question ID: Q-13) Tj (Correct Option: D) Tj ET'
  ));
  assert.deepEqual(result.rows.map(({ id, answer }) => ({ id, answer })), [
    { id: 'Q-12', answer: 'B' },
    { id: 'Q-13', answer: 'D' }
  ]);
  assert.ok(result.rows.every(row => row.extractionStatus === 'extracted-review-required'));
  assert.match(result.warnings.join(' '), /require administrator review/);
});

test('leaves absent or conflicting answers blank and flags duplicate IDs', () => {
  const result = parseOfficialAnswerKeyText([
    'Question ID: Q-1 Correct Answer: A',
    'Question ID: Q-2',
    'Question ID: Q-3 Correct Answer: B Correct Answer: C',
    'Question ID: Q-1 Correct Answer: D'
  ].join(' '));
  assert.deepEqual(result.rows.map(row => row.answer), ['', '', '', '']);
  assert.equal(result.rows[0].extractionStatus, 'duplicate-id');
  assert.equal(result.rows[1].extractionStatus, 'answer-not-detected');
  assert.equal(result.rows[2].extractionStatus, 'ambiguous-answer');
  assert.equal(result.rows[3].extractionStatus, 'duplicate-id');
});

test('supports manual entry when a valid PDF has no readable text or labeled IDs', () => {
  const imageOnlyPdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Length 0 >>\nstream\n\nendstream\nendobj\n%%EOF', 'latin1');
  assert.deepEqual(extractOfficialAnswerKeyPdf(imageOnlyPdf), {
    rows: [],
    warnings: ['Text could not be extracted from this PDF. Add question IDs and answers manually.']
  });
  assert.deepEqual(parseOfficialAnswerKeyText('BSEB official key without labeled rows').rows, []);
});

test('rejects a file that is not a PDF instead of treating it as a manual-entry PDF', () => {
  assert.throws(() => extractOfficialAnswerKeyPdf(Buffer.from('not a PDF')), /valid PDF/);
});
