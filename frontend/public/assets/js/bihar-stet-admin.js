(() => {
  const uploadForm = document.getElementById('bstetAdminUpload');
  if (!uploadForm) return;

  const keyList = document.getElementById('bstetAdminKeys');
  const message = document.getElementById('bstetAdminMessage');
  const pdfFileInput = document.getElementById('bstetKeyPdf');
  const pdfEditor = document.getElementById('bstetPdfEditor');
  const pdfRows = document.getElementById('bstetPdfRows');
  const pdfMessage = document.getElementById('bstetPdfMessage');
  const pdfWarnings = document.getElementById('bstetPdfWarnings');
  const paperSelect = document.getElementById('bstetPdfPaper');
  const shiftSelect = document.getElementById('bstetPdfShift');
  const subjectOptions = document.getElementById('bstetPdfSubjectOptions');
  const subjectEntry = document.getElementById('bstetPdfNewSubject');
  const subjectNameInput = document.getElementById('bstetPdfSubjectName');
  const shiftEntry = document.getElementById('bstetPdfNewShift');
  const subjectIdInput = document.getElementById('bstetPdfSubjectId');
  const shiftIdInput = document.getElementById('bstetPdfShiftId');
  const shiftNameInput = document.getElementById('bstetPdfShiftName');
  const NEW_SELECTION = '__new__';
  let adminKeys = [];
  let generatedSubjectId = '';
  let knownSubjectId = '';
  let selectedPdf = null;

  function showMessage(text, isError) {
    message.textContent = text;
    message.hidden = !text;
    message.classList.toggle('bstet-error', Boolean(isError));
    if (text && !isError) {
      message.style.borderColor = '#ccebd9';
      message.style.background = '#f1fbf5';
      message.style.color = '#247347';
    } else {
      message.removeAttribute('style');
    }
  }

  function showPdfMessage(text, isError) {
    pdfMessage.textContent = text;
    pdfMessage.hidden = !text;
    pdfMessage.classList.toggle('bstet-error', Boolean(isError));
    if (text && !isError) {
      pdfMessage.style.borderColor = '#ccebd9';
      pdfMessage.style.background = '#f1fbf5';
      pdfMessage.style.color = '#247347';
    } else {
      pdfMessage.removeAttribute('style');
    }
  }

  async function request(url, options) {
    const response = await fetch(url, { credentials: 'same-origin', ...options });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'The request could not be completed.');
    return data;
  }

  function makeButton(text, className, action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `btn ${className}`;
    button.textContent = text;
    button.addEventListener('click', action);
    return button;
  }

  function createEditor(key, version) {
    const editor = document.createElement('div');
    editor.className = 'bstet-admin-editor';
    const heading = document.createElement('p');
    heading.className = 'bstet-empty';
    heading.textContent = `Review version ${version.version}. Saving creates a new draft and preserves this version.`;
    const textarea = document.createElement('textarea');
    textarea.className = 'form-control';
    textarea.setAttribute('aria-label', 'Editable answer key JSON');
    textarea.value = JSON.stringify({
      questions: version.questions,
      markingScheme: version.markingScheme,
      source: version.source || '',
      markingRulesSource: version.markingRulesSource || '',
      notes: version.notes || ''
    }, null, 2);
    const save = makeButton('Save revised draft', 'btn-primary mt-2', async () => {
      try {
        const payload = JSON.parse(textarea.value);
        const saved = await request(
          `/api/bihar-stet/admin/keys/${encodeURIComponent(key.keyId)}/versions/${encodeURIComponent(version.versionId)}/edit`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          }
        );
        showMessage(`Saved as draft version ${saved.version}. Review it before publishing.`, false);
        await loadKeys();
      } catch (error) {
        showMessage(error.message, true);
      }
    });
    editor.append(heading, textarea, save);
    return editor;
  }

  function addPdfQuestionRow(row = {}) {
    const tableRow = document.createElement('tr');
    const idCell = document.createElement('td');
    const answerCell = document.createElement('td');
    const statusCell = document.createElement('td');
    const actionCell = document.createElement('td');
    const idInput = document.createElement('input');
    const answerInput = document.createElement('input');
    const removeButton = makeButton('Remove', 'btn-outline-secondary btn-sm', () => tableRow.remove());

    idInput.className = 'form-control form-control-sm';
    idInput.maxLength = 100;
    idInput.value = row.id || '';
    idInput.setAttribute('aria-label', 'Question ID');
    answerInput.className = 'form-control form-control-sm';
    answerInput.maxLength = 30;
    answerInput.value = row.answer || '';
    answerInput.setAttribute('aria-label', `Correct answer for ${row.id || 'question'}`);
    statusCell.className = 'bstet-admin-pdf-status';
    statusCell.textContent = row.extractionStatus || 'manually added';
    idCell.append(idInput);
    answerCell.append(answerInput);
    actionCell.append(removeButton);
    tableRow.append(idCell, answerCell, statusCell, actionCell);
    pdfRows.append(tableRow);
  }

  function appendOption(select, label, value, data = {}) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    Object.entries(data).forEach(([key, item]) => {
      option.dataset[key] = item;
    });
    select.append(option);
  }

  function setEntryState(container, inputs, visible) {
    container.hidden = !visible;
    inputs.forEach(input => {
      input.disabled = !visible;
      input.required = visible;
      if (!visible) input.value = '';
    });
  }

  function normalizeName(value) {
    return String(value || '').trim().toLowerCase();
  }

  function findExistingSubject(name) {
    const normalizedName = normalizeName(name);
    if (!normalizedName) return null;
    return adminKeys.find(key =>
      key.paperId === paperSelect.value && normalizeName(key.subjectName) === normalizedName
    ) || null;
  }

  function createSubjectId(name) {
    const baseId = name.normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60);
    if (!baseId) return '';

    let subjectId = baseId;
    let suffix = 2;
    while (adminKeys.some(key =>
      key.paperId === paperSelect.value &&
      key.subjectId === subjectId &&
      normalizeName(key.subjectName) !== normalizeName(name)
    )) {
      const suffixText = `-${suffix++}`;
      subjectId = `${baseId.slice(0, 60 - suffixText.length)}${suffixText}`;
    }
    return subjectId;
  }

  function syncSubjectIdentity() {
    const name = subjectNameInput.value.trim();
    const existing = findExistingSubject(name);
    if (existing) {
      subjectIdInput.value = existing.subjectId;
      knownSubjectId = existing.subjectId;
      generatedSubjectId = '';
      setEntryState(subjectEntry, [subjectIdInput], false);
      return;
    }

    const currentId = subjectIdInput.value.trim();
    const canRegenerate = !currentId || currentId === generatedSubjectId || currentId === knownSubjectId;
    knownSubjectId = '';
    if (!name) {
      generatedSubjectId = '';
      setEntryState(subjectEntry, [subjectIdInput], false);
      return;
    }

    const nextId = createSubjectId(name);
    if (canRegenerate) subjectIdInput.value = nextId;
    generatedSubjectId = canRegenerate ? nextId : generatedSubjectId;
    setEntryState(subjectEntry, [subjectIdInput], true);
  }

  function populateShiftSelect(preserveSelection = false) {
    const previousShift = preserveSelection ? shiftSelect.value : '';
    shiftSelect.replaceChildren();
    const subject = getSelectedSubject();
    if (!paperSelect.value || !subject.id || !subject.name) {
      appendOption(shiftSelect, 'Select a paper and enter a subject', '');
      shiftSelect.disabled = true;
      setEntryState(shiftEntry, [shiftIdInput, shiftNameInput], false);
      return;
    }

    shiftSelect.disabled = false;
    appendOption(shiftSelect, 'Select shift', '');
    const shifts = new Map();
    adminKeys
      .filter(key => key.paperId === paperSelect.value &&
        (!findExistingSubject(subject.name) || key.subjectId === subject.id))
      .forEach(key => shifts.set(key.shiftId, key));
    [...shifts.values()]
      .sort((left, right) => left.shiftName.localeCompare(right.shiftName))
      .forEach(key => appendOption(shiftSelect, key.shiftName, key.shiftId, {
        shiftName: key.shiftName,
        examDate: key.examDate || ''
      }));
    appendOption(shiftSelect, 'Add a shift from the official source', NEW_SELECTION);
    if ([...shiftSelect.options].some(option => option.value === previousShift)) {
      shiftSelect.value = previousShift;
    } else if (!findExistingSubject(subject.name) && shifts.size === 0) {
      shiftSelect.value = NEW_SELECTION;
    }
    setEntryState(shiftEntry, [shiftIdInput, shiftNameInput], shiftSelect.value === NEW_SELECTION);
  }

  function populateSubjectOptions(preserveSubject = false, preserveShift = preserveSubject) {
    const previousSubject = preserveSubject ? subjectNameInput.value : '';
    subjectOptions.replaceChildren();
    const subjects = new Map();
    adminKeys
      .filter(key => key.paperId === paperSelect.value)
      .forEach(key => subjects.set(key.subjectId, key));
    [...subjects.values()]
      .sort((left, right) => left.subjectName.localeCompare(right.subjectName))
      .forEach(key => appendOption(subjectOptions, key.subjectName, key.subjectName));
    subjectNameInput.value = previousSubject;
    syncSubjectIdentity();
    populateShiftSelect(preserveShift);
  }

  function getSelectedSubject() {
    const name = subjectNameInput.value.trim();
    const existing = findExistingSubject(name);
    return { id: existing?.subjectId || subjectIdInput.value.trim(), name };
  }

  function getSelectedShift() {
    if (shiftSelect.value === NEW_SELECTION) {
      return { id: shiftIdInput.value.trim(), name: shiftNameInput.value.trim() };
    }
    const option = shiftSelect.selectedOptions[0];
    return { id: shiftSelect.value, name: option?.dataset.shiftName || '' };
  }

  function invalidatePdfPreview() {
    if (!selectedPdf) return;
    selectedPdf = null;
    pdfEditor.hidden = true;
    showPdfMessage('Exam details changed. Extract the selected PDF again before reviewing or saving.', true);
  }

  function renderPdfPreview(data) {
    pdfRows.replaceChildren();
    data.rows.forEach(addPdfQuestionRow);
    if (!data.rows.length) addPdfQuestionRow();
    pdfWarnings.replaceChildren();
    if (data.warnings.length) {
      pdfWarnings.hidden = false;
      const heading = document.createElement('strong');
      heading.textContent = 'Review required: ';
      pdfWarnings.append(heading, document.createTextNode(data.warnings.join(' ')));
    } else {
      pdfWarnings.hidden = true;
    }
    pdfEditor.hidden = false;
  }

  function readPdfMarkingValue(id, label) {
    const raw = document.getElementById(id).value.trim();
    const value = Number(raw);
    if (!raw || !Number.isFinite(value)) {
      throw new Error(`Enter the verified official value for ${label}.`);
    }
    return value;
  }

  async function previewOfficialPdf() {
    const subject = getSelectedSubject();
    const shift = getSelectedShift();
    const year = document.getElementById('bstetPdfYear').value.trim();
    const examDate = document.getElementById('bstetPdfExamDate').value;
    if (!/^\d{4}$/.test(year) || !paperSelect.value ||
      !subject.id || !subject.name || !shift.id || !shift.name || !examDate) {
      showPdfMessage('Select the examination year, paper, subject, shift and date before extracting the PDF.', true);
      return;
    }
    const file = pdfFileInput.files[0];
    if (!file || file.size > 10 * 1024 * 1024) {
      showPdfMessage('Choose an official answer-key PDF no larger than 10 MB.', true);
      return;
    }
    selectedPdf = file;
    pdfEditor.hidden = true;
    const body = new FormData();
    body.append('answerKeyPdf', file);
    const button = document.getElementById('bstetPreviewPdf');
    button.disabled = true;
    button.textContent = 'Extracting…';
    try {
      const data = await request('/api/bihar-stet/admin/keys/preview-pdf', { method: 'POST', body });
      renderPdfPreview(data);
      showPdfMessage('Extraction preview only. Nothing has been saved or published yet.', false);
    } catch (error) {
      selectedPdf = null;
      showPdfMessage(error.message, true);
    } finally {
      button.disabled = false;
      button.textContent = 'Extract for review';
    }
  }

  async function savePdfDraft() {
    if (!selectedPdf) {
      showPdfMessage('Choose and preview the original PDF before saving.', true);
      return;
    }
    try {
      const rows = [...pdfRows.querySelectorAll('tr')].map(row => {
        const inputs = row.querySelectorAll('input');
        return { id: inputs[0].value.trim(), answer: inputs[1].value.trim() };
      });
      if (!rows.length || rows.some(row => !row.id || !row.answer)) {
        throw new Error('Complete every question ID and answer. Missing answers are never inferred.');
      }
      if (new Set(rows.map(row => row.id)).size !== rows.length) {
        throw new Error('Question IDs must be unique before saving the draft.');
      }

      const payload = {
        metadata: {
          year: document.getElementById('bstetPdfYear').value.trim(),
          paperId: document.getElementById('bstetPdfPaper').value,
          subjectId: getSelectedSubject().id,
          subjectName: getSelectedSubject().name,
          shiftId: getSelectedShift().id,
          shiftName: getSelectedShift().name,
          examDate: document.getElementById('bstetPdfExamDate').value
        },
        questions: rows,
        markingScheme: {
          correctMarks: readPdfMarkingValue('bstetPdfCorrectMarks', 'marks per correct answer'),
          incorrectMarks: readPdfMarkingValue('bstetPdfIncorrectMarks', 'marks per incorrect answer'),
          unansweredMarks: readPdfMarkingValue('bstetPdfUnansweredMarks', 'marks per unanswered question')
        },
        source: document.getElementById('bstetPdfSource').value.trim(),
        markingRulesSource: document.getElementById('bstetPdfRulesSource').value.trim(),
        notes: document.getElementById('bstetPdfNotes').value.trim()
      };
      const requiredText = [
        payload.source,
        payload.markingRulesSource,
        payload.metadata.year,
        payload.metadata.paperId,
        payload.metadata.subjectId,
        payload.metadata.subjectName,
        payload.metadata.shiftId,
        payload.metadata.shiftName,
        payload.metadata.examDate
      ];
      if (requiredText.some(value => !value)) {
        throw new Error('Complete the examination details, exam date and both official source citations.');
      }

      const body = new FormData();
      body.append('answerKeyPdf', selectedPdf);
      body.append('payload', JSON.stringify(payload));
      const saveButton = document.getElementById('bstetSavePdfDraft');
      saveButton.disabled = true;
      saveButton.textContent = 'Saving draft…';
      const result = await request('/api/bihar-stet/admin/keys/from-pdf', { method: 'POST', body });
      showPdfMessage(`Saved as unpublished draft version ${result.version}. Review it before publishing.`, false);
      pdfEditor.hidden = true;
      selectedPdf = null;
      pdfFileInput.value = '';
      await loadKeys();
    } catch (error) {
      showPdfMessage(error.message, true);
    } finally {
      const saveButton = document.getElementById('bstetSavePdfDraft');
      saveButton.disabled = false;
      saveButton.textContent = 'Save reviewed answers as draft';
    }
  }

  function getKeyStatus(key) {
    const activeVersions = key.activeVersions || {};
    if (activeVersions.final && key.versions.some(version =>
      version.versionId === activeVersions.final && version.status === 'final')) return 'final';
    if (activeVersions.provisional && key.versions.some(version =>
      version.versionId === activeVersions.provisional && version.status === 'provisional')) return 'provisional';
    if (key.versions.some(version => version.status === 'draft')) return 'draft';
    return 'no-key';
  }

  function makeStatusBadge(status) {
    const badge = document.createElement('span');
    badge.className = `bstet-admin-status-badge bstet-admin-badge-${status}`;
    badge.textContent = {
      'no-key': 'No Key',
      draft: 'Draft',
      provisional: 'Provisional',
      final: 'Final',
      superseded: 'Superseded'
    }[status] || status;
    return badge;
  }

  function formatCreatedAt(value) {
    const date = value ? new Date(value) : null;
    return date && Number.isFinite(date.getTime()) ? date.toLocaleDateString() : '—';
  }

  function makeSourceCell(version) {
    const cell = document.createElement('td');
    cell.className = 'bstet-admin-source-cell';
    [
      ['Answer key', version.source],
      ['Marking rules', version.markingRulesSource]
    ].forEach(([label, source]) => {
      const line = document.createElement('div');
      const name = document.createElement('span');
      const value = document.createElement('span');
      name.className = 'bstet-admin-source-label';
      name.textContent = `${label}: `;
      value.className = source ? 'bstet-admin-source-value' : 'bstet-admin-source-missing';
      value.textContent = source || 'Missing';
      line.append(name, value);
      cell.append(line);
    });
    if (version.sourceDocument) {
      const archive = document.createElement('div');
      archive.className = 'bstet-admin-pdf-status';
      archive.textContent = `Private PDF archive: ${version.sourceDocument.fileName} · ${version.sourceDocument.publicId} · ${version.sourceDocument.bytes} bytes · SHA-256 ${version.sourceDocument.sha256}`;
      cell.append(archive);
    }
    return cell;
  }

  function showEditor(card, key, version) {
    const previous = card.querySelector('.bstet-admin-editor');
    if (previous) previous.remove();
    card.append(createEditor(key, version));
  }

  function createVersionTable(key, card) {
    const wrap = document.createElement('div');
    wrap.className = 'table-responsive bstet-admin-history-wrap';
    const table = document.createElement('table');
    table.className = 'table align-middle bstet-admin-history-table';
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    ['Version', 'Status', 'Questions', 'Official sources & archive', 'Created', 'Actions'].forEach(label => {
      const th = document.createElement('th');
      th.scope = 'col';
      th.textContent = label;
      headRow.append(th);
    });
    thead.append(headRow);
    const tbody = document.createElement('tbody');

    (key.versions || []).forEach(version => {
      const row = document.createElement('tr');
      const versionCell = document.createElement('th');
      versionCell.scope = 'row';
      versionCell.textContent = `v${version.version}`;
      const statusCell = document.createElement('td');
      statusCell.append(makeStatusBadge(version.status));
      const questionCell = document.createElement('td');
      questionCell.textContent = String(version.questionCount);
      const dateCell = document.createElement('td');
      dateCell.textContent = formatCreatedAt(version.createdAt);
      const actionsCell = document.createElement('td');
      const actions = document.createElement('div');
      actions.className = 'bstet-admin-version-actions';
      actions.append(makeButton('Review / edit', 'btn-outline-secondary', () => showEditor(card, key, version)));
      if (version.status === 'draft') {
        ['provisional', 'final'].forEach(status => {
          actions.append(makeButton(`Publish ${status}`, status === 'final' ? 'btn-outline-danger' : 'btn-outline-primary', async () => {
            const answersVerified = window.confirm(`Before publishing version ${version.version}, confirm that you compared every question ID and answer with the cited official key.`);
            if (!answersVerified) return;
            const markingRulesVerified = window.confirm('Confirm that the marking values were checked against the separately cited official marking-rules source. Do not publish assumed or sample rules.');
            if (!markingRulesVerified) return;
            try {
              await request(
                `/api/bihar-stet/admin/keys/${encodeURIComponent(key.keyId)}/versions/${encodeURIComponent(version.versionId)}/publish`,
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ status, answersVerified, markingRulesVerified })
                }
              );
              showMessage(`Version ${version.version} published as ${status}.`, false);
              await loadKeys();
            } catch (error) {
              showMessage(error.message, true);
            }
          }));
        });
      }
      actionsCell.append(actions);
      row.append(versionCell, statusCell, questionCell, makeSourceCell(version), dateCell, actionsCell);
      tbody.append(row);
    });

    table.append(thead, tbody);
    wrap.append(table);
    return wrap;
  }

  function createShiftCard(key) {
    const card = document.createElement('article');
    card.className = 'bstet-admin-shift-card';
    const heading = document.createElement('div');
    heading.className = 'bstet-admin-shift-heading';
    const shiftDetails = document.createElement('div');
    const title = document.createElement('h4');
    title.textContent = key.shiftName;
    if (key.examDate) {
      const examDate = document.createElement('span');
      examDate.className = 'bstet-admin-identifier bstet-admin-exam-date';
      examDate.textContent = new Date(`${key.examDate}T00:00:00`).toLocaleDateString();
      title.append(' ', examDate);
    }
    const shiftId = document.createElement('span');
    shiftId.className = 'bstet-admin-identifier';
    shiftId.textContent = key.shiftId;
    shiftDetails.append(title, shiftId);
    const status = getKeyStatus(key);
    const statusAndEdit = document.createElement('div');
    statusAndEdit.className = 'bstet-admin-shift-controls';
    statusAndEdit.append(makeStatusBadge(status));
    const editNames = makeButton('Edit names', 'btn-outline-secondary btn-sm', async () => {
      const editor = document.createElement('div');
      editor.className = 'bstet-admin-editor bstet-admin-name-editor';
      const subjectName = document.createElement('input');
      subjectName.className = 'form-control mb-2';
      subjectName.maxLength = 100;
      subjectName.value = key.subjectName;
      subjectName.setAttribute('aria-label', 'Subject display name');
      const shiftName = document.createElement('input');
      shiftName.className = 'form-control mb-2';
      shiftName.maxLength = 100;
      shiftName.value = key.shiftName;
      shiftName.setAttribute('aria-label', 'Shift display name');
      const save = makeButton('Save names', 'btn-primary', async () => {
        try {
          await request(`/api/bihar-stet/admin/keys/${encodeURIComponent(key.keyId)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subjectName: subjectName.value, shiftName: shiftName.value })
          });
          showMessage('Subject and shift names updated.', false);
          await loadKeys();
        } catch (error) {
          showMessage(error.message, true);
        }
      });
      editor.append(subjectName, shiftName, save);
      const previous = card.querySelector('.bstet-admin-name-editor');
      if (previous) previous.remove();
      card.append(editor);
    });
    statusAndEdit.append(editNames);
    heading.append(shiftDetails, statusAndEdit);

    const warnings = [];
    (key.versions || []).filter(version => version.status === 'draft').forEach(version => {
      if (!version.source) warnings.push(`Version ${version.version}: official answer-key source is missing.`);
      if (!version.markingRulesSource) warnings.push(`Version ${version.version}: official marking-rules source is missing.`);
      if (version.answersVerified !== true) warnings.push(`Version ${version.version}: answers have not been verified.`);
      if (version.markingRulesVerified !== true) warnings.push(`Version ${version.version}: marking rules have not been verified.`);
    });
    let sourceNotice;
    if (warnings.length) {
      sourceNotice = document.createElement('div');
      sourceNotice.className = 'bstet-admin-source-warning';
      sourceNotice.setAttribute('role', 'status');
      sourceNotice.textContent = warnings.join(' ');
    }

    card.append(heading);
    if (sourceNotice) card.append(sourceNotice);
    if (key.versions?.length) {
      const historyHeading = document.createElement('h5');
      historyHeading.className = 'bstet-admin-history-heading';
      historyHeading.textContent = 'Version history';
      card.append(historyHeading, createVersionTable(key, card));
    } else {
      const empty = document.createElement('p');
      empty.className = 'bstet-admin-empty-note';
      empty.textContent = 'No answer-key versions are recorded for this shift.';
      card.append(empty);
    }
    return { card, status };
  }

  function renderKeys(keys) {
    keyList.replaceChildren();
    const papers = [
      { id: 'paper-1', label: 'Paper I' },
      { id: 'paper-2', label: 'Paper II' }
    ];
    papers.forEach(paper => {
      const paperKeys = keys.filter(key => key.paperId === paper.id);
      const section = document.createElement('section');
      section.className = 'bstet-admin-paper-section';
      const heading = document.createElement('div');
      heading.className = 'bstet-admin-paper-heading';
      const titleWrap = document.createElement('div');
      const title = document.createElement('h3');
      title.textContent = paper.label;
      const subtitle = document.createElement('p');
      const subjectCount = new Set(paperKeys.map(key => key.subjectId)).size;
      subtitle.textContent = `${subjectCount} subject${subjectCount === 1 ? '' : 's'} · ${paperKeys.length} shift key record${paperKeys.length === 1 ? '' : 's'}`;
      titleWrap.append(title, subtitle);
      const paperStatus = !paperKeys.length ? 'no-key' :
        paperKeys.some(key => getKeyStatus(key) === 'final') ? 'final' :
          paperKeys.some(key => getKeyStatus(key) === 'provisional') ? 'provisional' :
            paperKeys.some(key => getKeyStatus(key) === 'draft') ? 'draft' : 'no-key';
      heading.append(titleWrap, makeStatusBadge(paperStatus));
      section.append(heading);

      if (!paperKeys.length) {
        const empty = document.createElement('div');
        empty.className = 'bstet-admin-empty-state';
        empty.textContent = 'No answer-key records yet. Upload an official key to add its subject and shifts; nothing is prefilled.';
        section.append(empty);
      } else {
        const subjects = new Map();
        paperKeys.forEach(key => {
          const subject = subjects.get(key.subjectId) || {
            id: key.subjectId,
            name: key.subjectName,
            keys: []
          };
          subject.keys.push(key);
          subjects.set(key.subjectId, subject);
        });

        subjects.forEach(subject => {
          const subjectSection = document.createElement('section');
          subjectSection.className = 'bstet-admin-subject-section';
          const subjectHeading = document.createElement('div');
          subjectHeading.className = 'bstet-admin-subject-heading';
          const subjectName = document.createElement('h4');
          subjectName.textContent = subject.name;
          const subjectId = document.createElement('span');
          subjectId.className = 'bstet-admin-identifier';
          subjectId.textContent = subject.id;
          subjectHeading.append(subjectName, subjectId);
          subjectSection.append(subjectHeading);
          subject.keys.forEach(key => {
            const shift = createShiftCard(key);
            subjectSection.append(shift.card);
          });
          section.append(subjectSection);
        });
      }
      keyList.append(section);
    });
  }

  async function loadKeys() {
    try {
      const data = await request('/api/bihar-stet/admin/keys');
      const preserveSelection = Boolean(paperSelect.value);
      adminKeys = data.keys;
      populateSubjectOptions(preserveSelection);
      renderKeys(data.keys);
    } catch (error) {
      keyList.textContent = error.message;
    }
  }

  uploadForm.addEventListener('submit', async event => {
    event.preventDefault();
    const file = document.getElementById('bstetKeyFile').files[0];
    if (!file || file.size > 2 * 1024 * 1024) {
      showMessage('Choose an answer-key JSON file no larger than 2 MB.', true);
      return;
    }
    const body = new FormData();
    body.append('answerKey', file);
    try {
      const result = await request('/api/bihar-stet/admin/keys', { method: 'POST', body });
      showMessage(`Uploaded as draft version ${result.version}. Review the extracted key before publishing.`, false);
      uploadForm.reset();
      await loadKeys();
    } catch (error) {
      showMessage(error.message, true);
    }
  });

  document.getElementById('bstetAdminRefresh').addEventListener('click', loadKeys);
  paperSelect.addEventListener('change', () => {
    invalidatePdfPreview();
    document.getElementById('bstetPdfExamDate').value = '';
    populateSubjectOptions(true, false);
  });
  subjectNameInput.addEventListener('input', () => {
    invalidatePdfPreview();
    document.getElementById('bstetPdfExamDate').value = '';
    syncSubjectIdentity();
    populateShiftSelect();
  });
  subjectIdInput.addEventListener('input', () => {
    invalidatePdfPreview();
    populateShiftSelect();
  });
  shiftSelect.addEventListener('change', () => {
    invalidatePdfPreview();
    const isNewShift = shiftSelect.value === NEW_SELECTION;
    setEntryState(shiftEntry, [shiftIdInput, shiftNameInput], isNewShift);
    const selectedOption = shiftSelect.selectedOptions[0];
    document.getElementById('bstetPdfExamDate').value = selectedOption?.dataset.examDate || '';
  });
  [
    document.getElementById('bstetPdfYear'),
    document.getElementById('bstetPdfExamDate'),
    shiftIdInput,
    shiftNameInput
  ].forEach(input => input.addEventListener('input', invalidatePdfPreview));
  document.getElementById('bstetPreviewPdf').addEventListener('click', previewOfficialPdf);
  pdfFileInput.addEventListener('change', () => {
    selectedPdf = null;
    pdfEditor.hidden = true;
    showPdfMessage('', false);
  });
  document.getElementById('bstetAddPdfRow').addEventListener('click', () => addPdfQuestionRow());
  document.getElementById('bstetSavePdfDraft').addEventListener('click', savePdfDraft);
  loadKeys();
})();
