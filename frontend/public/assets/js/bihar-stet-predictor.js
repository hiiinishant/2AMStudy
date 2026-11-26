(() => {
  const form = document.getElementById('bstetPredictorForm');
  if (!form) return;

  document.documentElement.classList.add('bstet-hide-scrollbar');

  const catalogNotice = document.getElementById('bstetCatalogNotice');
  const catalogTitle = document.getElementById('bstetCatalogTitle');
  const catalogMessage = document.getElementById('bstetCatalogMessage');
  const paperSelect = document.getElementById('bstetPaper');
  const subjectSelect = document.getElementById('bstetSubject');
  const shiftSelect = document.getElementById('bstetShift');
  const pdfInput = document.getElementById('bstetPdf');
  const fileName = document.getElementById('bstetFileName');
  const manualRows = document.getElementById('bstetManualRows');
  const calculateButton = document.getElementById('bstetCalculate');
  const errorBox = document.getElementById('bstetFormError');
  const resultCard = document.getElementById('bstetResult');
  let catalog = [];
  let questionIds = [];
  let activeMode = 'pdf';
  let lastReport = null;
  let questionLoadToken = 0;

  function option(label, value) {
    const item = document.createElement('option');
    item.value = value;
    item.textContent = label;
    return item;
  }

  function resetSelect(select, placeholder) {
    select.replaceChildren(option(placeholder, ''));
    select.value = '';
  }

  function getSelection() {
    return {
      year: '2026',
      paperId: paperSelect.value,
      subjectId: subjectSelect.value,
      shiftId: shiftSelect.value
    };
  }

  function selectionKey(selection) {
    return catalog.find(item =>
      item.year === selection.year &&
      item.paperId === selection.paperId &&
      item.subjectId === selection.subjectId &&
      item.shiftId === selection.shiftId
    );
  }

  function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = !message;
  }

  function showCatalogNotice(title, message) {
    catalogTitle.textContent = title;
    catalogMessage.textContent = message;
    catalogNotice.hidden = false;
  }

  function renderSubjects() {
    questionLoadToken += 1;
    const paperId = paperSelect.value;
    resetSelect(subjectSelect, paperId ? 'Select subject' : 'Select paper first');
    resetSelect(shiftSelect, 'Select subject first');
    shiftSelect.disabled = true;
    questionIds = [];
    manualRows.replaceChildren(document.createTextNode('Select a published paper, subject and shift to load question IDs.'));

    const subjects = [...new Map(catalog
      .filter(item => item.year === '2026' && item.paperId === paperId)
      .map(item => [item.subjectId, item])).values()];
    subjects.forEach(item => subjectSelect.append(option(item.subjectName, item.subjectId)));
    subjectSelect.disabled = !subjects.length;
    if (paperId && !subjects.length) {
      subjectSelect.replaceChildren(option('No published keys', ''));
    }
    updateCalculateState();
  }

  function renderShifts() {
    questionLoadToken += 1;
    const selection = getSelection();
    resetSelect(shiftSelect, selection.subjectId ? 'Select examination shift' : 'Select subject first');
    const shifts = catalog.filter(item =>
      item.year === '2026' &&
      item.paperId === selection.paperId &&
      item.subjectId === selection.subjectId
    );
    shifts.forEach(item => shiftSelect.append(option(item.shiftName, item.shiftId)));
    shiftSelect.disabled = !shifts.length;
    questionIds = [];
    manualRows.replaceChildren(document.createTextNode('Select a published paper, subject and shift to load question IDs.'));
    updateCalculateState();
  }

  function renderManualRows() {
    manualRows.replaceChildren();
    if (!questionIds.length) {
      manualRows.textContent = 'No published question IDs are available.';
      return;
    }
    const fragment = document.createDocumentFragment();
    questionIds.forEach((questionId, index) => {
      const row = document.createElement('div');
      row.className = 'bstet-manual-row';
      const label = document.createElement('label');
      const input = document.createElement('input');
      const inputId = `bstet-answer-${index}`;
      label.htmlFor = inputId;
      label.textContent = `Question ${questionId}`;
      input.id = inputId;
      input.type = 'text';
      input.maxLength = 30;
      input.autocomplete = 'off';
      input.dataset.questionId = questionId;
      input.placeholder = 'Answer';
      input.setAttribute('aria-label', `Answer for question ${questionId}`);
      row.append(label, input);
      fragment.append(row);
    });
    manualRows.append(fragment);
  }

  async function loadQuestions() {
    const selection = getSelection();
    const requestToken = ++questionLoadToken;
    if (!selectionKey(selection)) {
      questionIds = [];
      updateCalculateState();
      return;
    }
    const query = new URLSearchParams(selection);
    try {
      const response = await fetch(`/api/bihar-stet/key-questions?${query}`, { credentials: 'same-origin' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not load question IDs.');
      if (requestToken !== questionLoadToken) return;
      questionIds = data.questionIds;
      renderManualRows();
      showError('');
    } catch (error) {
      if (requestToken !== questionLoadToken) return;
      questionIds = [];
      renderManualRows();
      showError(error.message);
    }
    updateCalculateState();
  }

  function updateCalculateState() {
    calculateButton.disabled = !selectionKey(getSelection()) ||
      (activeMode === 'manual' && questionIds.length === 0) ||
      (activeMode === 'pdf' && !pdfInput.files.length);
  }

  function renderResult(data) {
    const { result, exam } = data;
    lastReport = data;
    document.getElementById('bstetResultSubtitle').textContent =
      `${exam.year} · ${exam.paperId === 'paper-1' ? 'Paper I' : 'Paper II'} · ${exam.subjectName} · ${exam.shiftName} · ${exam.keyStatus} key v${exam.keyVersion}`;
    document.getElementById('bstetRawMarks').textContent =
      result.rawMarks === null ? 'Incomplete' : String(result.rawMarks);
    document.getElementById('bstetScoreStatus').textContent =
      result.rawMarks === null ? 'A complete raw score could not be calculated' :
        result.fullyVerified ? 'Final key · verified responses' : 'Provisional key · estimate only';
    document.getElementById('bstetCorrect').textContent = String(result.correct);
    document.getElementById('bstetIncorrect').textContent = String(result.incorrect);
    document.getElementById('bstetUnanswered').textContent = String(result.unanswered);
    document.getElementById('bstetUnreadable').textContent = String(result.unreadable + result.unmatchedIds.length);
    const issues = [];
    if (result.unmatchedIds.length) issues.push(`Unmatched IDs: ${result.unmatchedIds.join(', ')}`);
    if (result.unreadableIds.length) issues.push(`Unreadable IDs: ${result.unreadableIds.join(', ')}`);
    if (result.missingIds.length) issues.push(`Missing IDs: ${result.missingIds.join(', ')}`);
    document.getElementById('bstetVerification').textContent =
      `${result.verificationMessage}${issues.length ? ` ${issues.join('. ')}` : ''}`;
    resultCard.hidden = false;
    resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function loadCatalog() {
    try {
      const response = await fetch('/api/bihar-stet/catalog', { credentials: 'same-origin' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Published answer keys are temporarily unavailable.');
      catalog = data.catalog.filter(item => item.year === '2026');
      if (!catalog.length) {
        form.hidden = true;
        showCatalogNotice(
          'No verified answer keys are available yet.',
          'The calculator will unlock after an administrator verifies the official answer key and marking scheme. You do not need to upload a response sheet yet.'
        );
        return;
      }
      catalogNotice.hidden = true;
      form.hidden = false;
      renderSubjects();
    } catch (error) {
      form.hidden = true;
      showCatalogNotice(
        'Could not check published answer keys.',
        `${error.message} Refresh the page to try again.`
      );
    }
  }

  document.querySelectorAll('[data-bstet-mode]').forEach(button => {
    button.addEventListener('click', () => {
      activeMode = button.dataset.bstetMode;
      document.querySelectorAll('[data-bstet-mode]').forEach(tab => {
        const selected = tab === button;
        tab.classList.toggle('active', selected);
        tab.setAttribute('aria-selected', String(selected));
      });
      document.getElementById('bstetPdfPanel').hidden = activeMode !== 'pdf';
      document.getElementById('bstetManualPanel').hidden = activeMode !== 'manual';
      updateCalculateState();
      showError('');
    });
  });

  paperSelect.addEventListener('change', renderSubjects);
  subjectSelect.addEventListener('change', renderShifts);
  shiftSelect.addEventListener('change', loadQuestions);
  pdfInput.addEventListener('change', () => {
    const file = pdfInput.files[0];
    fileName.textContent = file ? file.name : 'Text-based PDF only · 10 MB maximum';
    updateCalculateState();
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    showError('');
    resultCard.hidden = true;
    const selection = getSelection();
    const body = new FormData();
    Object.entries(selection).forEach(([key, value]) => body.append(key, value));
    if (activeMode === 'pdf') {
      const file = pdfInput.files[0];
      if (!file || file.size > 10 * 1024 * 1024) {
        showError('Choose a PDF no larger than 10 MB.');
        return;
      }
      body.append('responseSheet', file);
    } else {
      const inputs = [...manualRows.querySelectorAll('[data-question-id]')];
      body.append('responses', JSON.stringify(inputs.map(input => ({
        questionId: input.dataset.questionId,
        answer: input.value.trim() || null
      }))));
    }

    calculateButton.disabled = true;
    calculateButton.textContent = 'Calculating…';
    try {
      const response = await fetch('/api/bihar-stet/score', {
        method: 'POST',
        body,
        credentials: 'same-origin'
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not calculate marks.');
      renderResult(data);
    } catch (error) {
      showError(error.message);
    } finally {
      calculateButton.textContent = 'Calculate marks';
      updateCalculateState();
    }
  });

  document.getElementById('bstetDownload').addEventListener('click', () => window.print());
  document.getElementById('bstetShare').addEventListener('click', async event => {
    if (!lastReport) return;
    const { exam, result } = lastReport;
    const score = result.rawMarks === null ? 'incomplete' : `${result.rawMarks} raw marks`;
    const text = `Bihar STET 2026 ${exam.paperId === 'paper-1' ? 'Paper I' : 'Paper II'} estimate: ${score} (${exam.subjectName}, ${exam.shiftName}).`;
    try {
      if (navigator.share) await navigator.share({ title: 'Bihar STET marks estimate', text });
      else if (navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        event.currentTarget.textContent = 'Copied';
      } else {
        throw new Error('Sharing is not supported in this browser.');
      }
    } catch (error) {
      if (error.name !== 'AbortError') showError(error.message);
    }
  });

  loadCatalog();
})();
