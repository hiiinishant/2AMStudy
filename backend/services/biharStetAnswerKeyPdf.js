const { readPdfString } = require('./biharStetMarks');

const QUESTION_ID = /\b(?:question\s*id|q\.?\s*id)\s*[:#=-]\s*([a-z0-9][a-z0-9_-]{0,99})/gi;
const CORRECT_ANSWER = /\b(?:correct\s+(?:answer|option|response)|answer\s*key)\s*[:=-]\s*(?:option\s*)?([a-z0-9][a-z0-9_-]{0,29})\b/gi;

function parseOfficialAnswerKeyText(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return { rows: [], warnings: ['No readable text was found. Add question IDs and answers manually.'] };
  }

  const normalized = text.replace(/\s+/g, ' ');
  const questionMatches = [...normalized.matchAll(QUESTION_ID)];
  if (!questionMatches.length) {
    return { rows: [], warnings: ['No labeled question IDs were detected. Add question IDs and answers manually.'] };
  }
  if (questionMatches.length > 500) {
    throw new Error('The answer-key PDF contains more than 500 question IDs.');
  }

  const counts = new Map();
  for (const match of questionMatches) {
    const id = match[1].trim();
    counts.set(id, (counts.get(id) || 0) + 1);
  }

  let unansweredCount = 0;
  const rows = questionMatches.map((match, index) => {
    const id = match[1].trim();
    const start = match.index + match[0].length;
    const end = index + 1 < questionMatches.length
      ? questionMatches[index + 1].index
      : normalized.length;
    const answers = [...normalized.slice(start, end).matchAll(CORRECT_ANSWER)];
    const uniqueAnswers = [...new Set(answers.map(answer => answer[1].trim()))];
    const isDuplicate = counts.get(id) > 1;
    const answer = !isDuplicate && uniqueAnswers.length === 1 ? uniqueAnswers[0] : '';
    const extractionStatus = isDuplicate
      ? 'duplicate-id'
      : uniqueAnswers.length === 1
        ? 'extracted-review-required'
        : uniqueAnswers.length > 1
          ? 'ambiguous-answer'
          : 'answer-not-detected';
    if (!answer) unansweredCount += 1;
    return { id, answer, extractionStatus };
  });

  const warnings = [];
  if (unansweredCount) {
    warnings.push(`${unansweredCount} row(s) need manual review or correction.`);
  }
  warnings.push('All extracted answers are drafts and require administrator review before publishing.');
  return { rows, warnings };
}

function extractOfficialAnswerKeyPdf(buffer) {
  try {
    return parseOfficialAnswerKeyText(readPdfString(buffer));
  } catch (error) {
    if (/No readable text|Could not decode compressed PDF text/.test(error.message || '')) {
      return {
        rows: [],
        warnings: ['Text could not be extracted from this PDF. Add question IDs and answers manually.']
      };
    }
    throw error;
  }
}

module.exports = { extractOfficialAnswerKeyPdf, parseOfficialAnswerKeyText };
