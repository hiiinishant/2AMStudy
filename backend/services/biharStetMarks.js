const zlib = require('zlib');

const ANSWER_LABEL = /(?:chosen|selected|your|candidate)\s+answer|chosen\s+option|selected\s+option|your\s+response|candidate\s+response/i;
const QUESTION_LABEL = /question\s*(?:id|no\.?|number)\s*[:#-]\s*([a-z0-9_-]+)/gi;
const ANSWER_VALUE = /(?:(?:chosen|selected|your|candidate)\s+answer|chosen\s+option|selected\s+option|your\s+response|candidate\s+response)\s*[:=-]?\s*(not\s+answered|not\s+attempted|unanswered|no\s+response|[a-z0-9_-]+|[-—])/i;
const BLANK_ANSWER = /^(?:-|—|not\s+answered|not\s+attempted|unanswered|no\s+response)$/i;

function decodePdfLiteral(value) {
  return value
    .replace(/\\([0-7]{1,3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)))
    .replace(/\\(n|r|t|b|f|\\|\(|\))/g, (_, escaped) => ({
      n: '\n', r: '\r', t: '\t', b: '\b', f: '\f'
    }[escaped] || escaped))
    .replace(/\\\r?\n/g, '');
}

function decodePdfHex(value) {
  const hex = value.replace(/\s/g, '');
  if (hex.length % 2 !== 0) return null;
  const decoded = Buffer.from(hex, 'hex');
  if (decoded.length >= 2 && decoded[0] === 0xfe && decoded[1] === 0xff) {
    let text = '';
    for (let i = 2; i + 1 < decoded.length; i += 2) {
      text += String.fromCharCode(decoded.readUInt16BE(i));
    }
    return text;
  }
  return decoded.every(byte => byte < 128) ? decoded.toString('ascii') : null;
}

function readPdfString(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8 || buffer.length > 10 * 1024 * 1024) {
    throw new Error('PDF must be between 8 bytes and 10 MB.');
  }
  if (buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new Error('The uploaded file is not a valid PDF.');
  }

  const source = buffer.toString('latin1');
  const streamPattern = /<<(.*?)>>\s*stream\r?\n/g;
  const chunks = [];
  let decodedByteCount = 0;
  let match;

  while ((match = streamPattern.exec(source)) !== null) {
    const streamStart = streamPattern.lastIndex;
    const streamEnd = source.indexOf('endstream', streamStart);
    if (streamEnd < 0) throw new Error('The PDF contains an incomplete stream.');

    let bytes = buffer.subarray(streamStart, streamEnd);
    while (bytes.length && (bytes[bytes.length - 1] === 10 || bytes[bytes.length - 1] === 13)) {
      bytes = bytes.subarray(0, bytes.length - 1);
    }

    if (/\/FlateDecode\b/.test(match[1])) {
      try {
        bytes = zlib.inflateSync(bytes, { maxOutputLength: 10 * 1024 * 1024 });
      } catch (_) {
        throw new Error('Could not decode compressed PDF text. Use manual answer entry instead.');
      }
    } else if (/\/(?:ASCII85Decode|LZWDecode|RunLengthDecode)\b/.test(match[1])) {
      streamPattern.lastIndex = streamEnd + 9;
      continue;
    }

    decodedByteCount += bytes.length;
    if (decodedByteCount > 20 * 1024 * 1024) {
      throw new Error('The PDF expands beyond the supported processing limit. Use manual answer entry instead.');
    }
    const content = bytes.toString('latin1');
    const textOperator = /(\((?:\\.|[^\\)])*\)|<([0-9a-fA-F\s]+)>)\s*(?:Tj|['"])/g;
    let textMatch;
    while ((textMatch = textOperator.exec(content)) !== null) {
      if (textMatch[1][0] === '(') {
        chunks.push(decodePdfLiteral(textMatch[1].slice(1, -1)));
      } else {
        const decoded = decodePdfHex(textMatch[2]);
        if (decoded !== null) chunks.push(decoded);
      }
      chunks.push('\n');
    }

    const arrayOperator = /\[((?:.|\r|\n)*?)\]\s*TJ/g;
    let arrayMatch;
    while ((arrayMatch = arrayOperator.exec(content)) !== null) {
      const tokenPattern = /\(((?:\\.|[^\\)])*)\)|<([0-9a-fA-F\s]+)>/g;
      let token;
      while ((token = tokenPattern.exec(arrayMatch[1])) !== null) {
        const decoded = token[1] !== undefined
          ? decodePdfLiteral(token[1])
          : decodePdfHex(token[2]);
        if (decoded !== null) chunks.push(decoded, ' ');
      }
      chunks.push('\n');
    }

    streamPattern.lastIndex = streamEnd + 9;
  }

  if (!chunks.length) {
    throw new Error('No readable text was found in the PDF. Use manual answer entry instead.');
  }
  return chunks.join('');
}

function parseResponseSheetText(text) {
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('No readable response-sheet text was found.');
  }

  const normalized = text.replace(/\s+/g, ' ');
  const questionMatches = [...normalized.matchAll(QUESTION_LABEL)];
  if (!questionMatches.length) {
    throw new Error('Could not find labeled question IDs in this response sheet. Use manual answer entry instead.');
  }
  if (questionMatches.length > 500) {
    throw new Error('The response sheet contains more than 500 question IDs and cannot be processed safely.');
  }

  const responses = [];
  const seen = new Set();
  for (let i = 0; i < questionMatches.length; i += 1) {
    const questionId = questionMatches[i][1];
    if (seen.has(questionId)) throw new Error(`Duplicate question ID ${questionId} in response sheet.`);
    seen.add(questionId);
    const start = questionMatches[i].index + questionMatches[i][0].length;
    const end = i + 1 < questionMatches.length ? questionMatches[i + 1].index : normalized.length;
    const segment = normalized.slice(start, end);
    const answerIndex = segment.search(ANSWER_LABEL);

    if (answerIndex < 0) {
      responses.push({ questionId, answer: null, readable: false });
      continue;
    }

    const answerMatch = segment.slice(answerIndex).match(ANSWER_VALUE);
    if (!answerMatch) {
      responses.push({ questionId, answer: null, readable: false });
      continue;
    }

    const answer = answerMatch[1].trim();
    responses.push({
      questionId,
      answer: BLANK_ANSWER.test(answer) ? null : answer,
      readable: true
    });
  }

  return responses;
}

function validateMarkingScheme(markingScheme) {
  if (!markingScheme || typeof markingScheme !== 'object') {
    throw new Error('A verified marking scheme is required.');
  }
  const { correctMarks, incorrectMarks, unansweredMarks } = markingScheme;
  if (![correctMarks, incorrectMarks, unansweredMarks].every(Number.isFinite) || correctMarks < 0 || incorrectMarks > 0) {
    throw new Error('Marking scheme values must be finite; correct marks cannot be negative and incorrect marks cannot be positive.');
  }
}

function scoreResponses({
  questions,
  responses,
  markingScheme,
  keyStatus,
  answerKeyVerified,
  markingRulesVerified,
  sourceType
}) {
  if (!Array.isArray(questions) || !questions.length) {
    throw new Error('This exam does not have a published answer key.');
  }
  if (!Array.isArray(responses)) throw new Error('Candidate responses must be an array.');
  if (responses.length > 1000) throw new Error('Candidate responses exceed the processing limit.');
  if (!['provisional', 'final'].includes(keyStatus)) {
    throw new Error('Scoring requires a published answer-key version.');
  }
  if (answerKeyVerified !== true || markingRulesVerified !== true) {
    throw new Error('Scoring requires a published answer key and verified official marking rules.');
  }
  validateMarkingScheme(markingScheme);

  const key = new Map();
  for (const question of questions) {
    if (!question || typeof question.id !== 'string' || !question.id.trim() ||
      typeof question.answer !== 'string' || !question.answer.trim() || key.has(question.id)) {
      throw new Error('The published answer key contains invalid or duplicate question data.');
    }
    key.set(question.id, question.answer.trim().toLowerCase());
  }

  const seen = new Set();
  const unmatchedIds = [];
  const unreadableIds = [];
  const missingIds = [];
  const responseById = new Map();
  for (const response of responses) {
    if (!response || typeof response.questionId !== 'string' || !response.questionId.trim()) {
      throw new Error('Every response must include a question ID.');
    }
    const id = response.questionId.trim();
    if (seen.has(id)) throw new Error(`Duplicate response for question ID ${id}.`);
    seen.add(id);
    if (!key.has(id)) unmatchedIds.push(id);
    if (response.readable === false) unreadableIds.push(id);
    responseById.set(id, response);
  }

  let correct = 0;
  let incorrect = 0;
  let unanswered = 0;
  let unreadable = 0;
  for (const questionId of key.keys()) {
    const response = responseById.get(questionId);
    if (!response || response.readable === false) {
      unreadable += 1;
      if (!response) missingIds.push(questionId);
    } else if (response.answer === null || response.answer === undefined || String(response.answer).trim() === '') {
      unanswered += 1;
    } else if (String(response.answer).trim().toLowerCase() === key.get(questionId)) {
      correct += 1;
    } else {
      incorrect += 1;
    }
  }

  const complete = unreadable === 0 && unmatchedIds.length === 0;
  const rawMarks = complete
    ? (correct * markingScheme.correctMarks) +
      (incorrect * markingScheme.incorrectMarks) +
      (unanswered * markingScheme.unansweredMarks)
    : null;

  return {
    correct,
    incorrect,
    unanswered,
    unreadable,
    totalQuestions: questions.length,
    unmatchedIds,
    unreadableIds,
    missingIds,
    rawMarks,
    scoreType: 'raw',
    keyStatus,
    sourceType,
    fullyVerified: complete && keyStatus === 'final',
    verificationMessage: !complete
      ? 'Some question responses could not be matched or read. No complete score is shown.'
      : keyStatus !== 'final'
        ? 'This score uses a provisional answer key and is not final.'
        : 'All responses matched a final answer key. This is a raw score, not a normalized score.'
  };
}

module.exports = {
  parseResponseSheetText,
  readPdfString,
  scoreResponses,
  validateMarkingScheme
};
