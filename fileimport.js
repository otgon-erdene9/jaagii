// ══════════════════════════════════════════════════════════
//  FileImport — QuizBlast файл оруулах / татах модуль
//  Дэмжих форматууд: JSON, Excel (.xlsx/.xls), CSV
// ══════════════════════════════════════════════════════════

const FileImport = {

  /* ─── ENTRY POINTS ─── */

  // Host menu-с import хийх
  handle(input) {
    const file = input.files[0];
    if (!file) return;
    input.value = '';
    FileImport._process(file, (quiz) => {
      FileImport._saveAndRefresh(quiz, 'import-msg');
    });
  },

  // Editor дотор import хийх
  handleEditor(input) {
    const file = input.files[0];
    if (!file) return;
    input.value = '';
    FileImport._process(file, (quiz) => {
      // Fill editor with imported data
      $('quiz-title').value = quiz.title || '';
      Editor.questions = quiz.questions.map(q => ({
        text: q.text || '',
        answers: (q.answers || ['','','','']).slice(0, 4).concat(['','','','']).slice(0, 4),
        correct: typeof q.correct === 'number' ? q.correct : 0,
        time: q.time || 20,
      }));
      Editor.render();
      const msg = $('editor-import-msg');
      msg.style.color = '#4ade80';
      msg.textContent = `✅ "${quiz.title}" — ${quiz.questions.length} асуулт импортлогдлоо`;
      setTimeout(() => msg.textContent = '', 4000);
    });
  },

  // Drag & drop
  handleDrop(file) {
    FileImport._process(file, (quiz) => {
      FileImport._saveAndRefresh(quiz, 'import-msg');
      App.goTo('screen-host-menu');
    });
  },

  /* ─── CORE PROCESSOR ─── */

  _process(file, onSuccess) {
    const name = file.name.toLowerCase();
    if (name.endsWith('.json')) {
      FileImport._readJSON(file, onSuccess);
    } else if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
      FileImport._readExcel(file, onSuccess);
    } else if (name.endsWith('.csv')) {
      FileImport._readCSV(file, onSuccess);
    } else {
      alert('⚠ Зөвхөн .json, .xlsx, .xls, .csv файл дэмжигдэнэ.');
    }
  },

  /* ─── JSON ─── */

  _readJSON(file, cb) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        let data = JSON.parse(e.target.result);

        // Support array of quizzes OR single quiz
        if (Array.isArray(data)) {
          data.forEach(q => FileImport._saveAndRefresh(FileImport._normalizeQuiz(q), null));
          FileImport._showMsg('import-msg', `✅ ${data.length} quiz импортлогдлоо`, true);
          App.renderHostMenu();
          return;
        }

        cb(FileImport._normalizeQuiz(data));
      } catch (err) {
        alert('⚠ JSON файл уншихад алдаа гарлаа. Формат зөв эсэхийг шалгана уу.');
        console.error(err);
      }
    };
    reader.readAsText(file, 'UTF-8');
  },

  /* ─── EXCEL ─── */

  _readExcel(file, cb) {
    if (typeof XLSX === 'undefined') {
      alert('⚠ Excel дэмжлэг ачаалагдаагүй байна. Хуудсыг дахин ачаална уу.');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        const quiz = FileImport._rowsToQuiz(rows, file.name.replace(/\.[^.]+$/, ''));
        cb(quiz);
      } catch (err) {
        alert('⚠ Excel файл уншихад алдаа гарлаа.');
        console.error(err);
      }
    };
    reader.readAsArrayBuffer(file);
  },

  /* ─── CSV ─── */

  _readCSV(file, cb) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target.result;
        const rows = text.split('\n').map(line =>
          line.split(',').map(cell => cell.trim().replace(/^"|"$/g, ''))
        ).filter(r => r.some(c => c));
        const quiz = FileImport._rowsToQuiz(rows, file.name.replace('.csv', ''));
        cb(quiz);
      } catch (err) {
        alert('⚠ CSV файл уншихад алдаа гарлаа.');
        console.error(err);
      }
    };
    reader.readAsText(file, 'UTF-8');
  },

  /* ─── ROWS → QUIZ ─── */
  // Expected columns: question | answer1 | answer2 | answer3 | answer4 | correct(1-4) | time
  _rowsToQuiz(rows, defaultTitle) {
    let title = defaultTitle || 'Imported Quiz';
    let startRow = 0;

    // Check if first row is a title row (merged or labeled)
    const firstRow = rows[0] || [];
    const isHeader = firstRow[0] && typeof firstRow[0] === 'string' &&
      (firstRow[0].toLowerCase().includes('question') ||
       firstRow[0].toLowerCase().includes('асуулт') ||
       firstRow[0] === 'Q' || firstRow[0] === '#');

    // Check if there's a title cell above the header
    if (rows.length > 1 && firstRow.length === 1 && firstRow[0]) {
      title = firstRow[0];
      startRow = 1;
      // skip header row if next row looks like a header
      const nextRow = rows[1] || [];
      if (nextRow[0] && nextRow[0].toLowerCase().includes('question') ||
          nextRow[0] && nextRow[0].toLowerCase().includes('асуулт')) {
        startRow = 2;
      }
    } else if (isHeader) {
      startRow = 1;
    }

    const questions = [];
    for (let i = startRow; i < rows.length; i++) {
      const r = rows[i];
      const text = String(r[0] || '').trim();
      if (!text) continue;

      const answers = [
        String(r[1] || '').trim(),
        String(r[2] || '').trim(),
        String(r[3] || '').trim(),
        String(r[4] || '').trim(),
      ];

      // Fill missing answers
      const validAnswers = answers.map(a => a || `Хариулт ${answers.indexOf(a)+1}`);

      // correct column: 1-based number or letter A/B/C/D
      let correct = 0;
      const rawCorrect = String(r[5] || '1').trim().toUpperCase();
      if (['A','B','C','D'].includes(rawCorrect)) {
        correct = 'ABCD'.indexOf(rawCorrect);
      } else {
        correct = Math.max(0, parseInt(rawCorrect || '1') - 1);
      }
      correct = Math.min(correct, 3);

      const time = parseInt(r[6] || '20') || 20;

      questions.push({ text, answers: validAnswers, correct, time });
    }

    if (!questions.length) throw new Error('Асуулт олдсонгүй');
    return { title, questions };
  },

  /* ─── NORMALIZE (JSON input) ─── */
  _normalizeQuiz(data) {
    const title = data.title || data.name || 'Imported Quiz';
    const rawQs = data.questions || data.quiz || data.items || [];
    const questions = rawQs.map(q => {
      const text = q.text || q.question || q.q || '';
      const answers = q.answers || q.choices || q.options || ['A','B','C','D'];
      let correct = typeof q.correct === 'number' ? q.correct
        : typeof q.correctIndex === 'number' ? q.correctIndex
        : 0;
      const time = q.time || q.timeLimit || 20;
      return {
        text: String(text).trim(),
        answers: answers.slice(0,4).map(a => String(a).trim()),
        correct: Math.max(0, Math.min(correct, answers.length - 1)),
        time: Number(time) || 20,
      };
    }).filter(q => q.text);
    return { title: String(title).trim(), questions };
  },

  /* ─── SAVE HELPER ─── */
  _saveAndRefresh(quiz, msgId) {
    const quizzes = Storage.getQuizzes();
    quizzes.push({ id: uid(), ...quiz });
    Storage.saveQuizzes(quizzes);
    if (msgId) {
      FileImport._showMsg(msgId, `✅ "${quiz.title}" — ${quiz.questions.length} асуулт нэмэгдлээ`, true);
    }
    if (document.getElementById('quiz-list')) App.renderHostMenu();
  },

  _showMsg(id, text, good) {
    const el = $(id);
    if (!el) return;
    el.style.color = good ? '#4ade80' : '#f87171';
    el.textContent = text;
    setTimeout(() => { el.textContent = ''; }, 5000);
  },

  /* ─── EXPORT ─── */

  exportOne(quizId) {
    const quiz = Storage.getQuizzes().find(q => q.id === quizId);
    if (!quiz) return;
    FileImport.downloadJSON(quiz, quiz.title);
  },

  exportAll() {
    const quizzes = Storage.getQuizzes();
    if (!quizzes.length) { alert('Хадгалсан quiz байхгүй байна.'); return; }
    FileImport.downloadJSON(quizzes, 'quizblast-all-quizzes');
  },

  downloadJSON(data, filename) {
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (filename || 'quiz').replace(/[^a-zA-Z0-9а-яА-ЯөүӨҮ\-_ ]/g, '') + '.json';
    a.click();
    URL.revokeObjectURL(url);
  },

  /* ─── EXCEL TEMPLATE ─── */
  downloadTemplate() {
    if (typeof XLSX === 'undefined') {
      // Fallback: download CSV template
      const csv = [
        ['Quiz нэр'],
        ['question','answer1','answer2','answer3','answer4','correct(1-4)','time(sec)'],
        ['Монголын нийслэл аль нь вэ?','Эрдэнэт','Улаанбаатар','Дархан','Чойбалсан','2','20'],
        ['Чингис хааны бодит нэр?','Тэмүүжин','Жамуха','Өгэдэй','Мөнх','1','20'],
      ].map(r => r.join(',')).join('\n');
      const blob = new Blob(['\uFEFF'+csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'quizblast-template.csv'; a.click();
      URL.revokeObjectURL(url);
      return;
    }

    const wb = XLSX.utils.book_new();
    const data = [
      ['Quiz нэр'],
      ['question','answer1','answer2','answer3','answer4','correct(1-4)','time(sec)'],
      ['Монголын нийслэл аль нь вэ?','Эрдэнэт','Улаанбаатар','Дархан','Чойбалсан',2,20],
      ['Чингис хааны бодит нэр?','Тэмүүжин','Жамуха','Өгэдэй','Мөнх',1,20],
      ['Японы нийслэл аль нь вэ?','Осака','Токио','Киото','Хирошима',2,15],
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    // Column widths
    ws['!cols'] = [
      {wch:40},{wch:18},{wch:18},{wch:18},{wch:18},{wch:14},{wch:10}
    ];
    XLSX.utils.book_append_sheet(wb, ws, 'Quiz');
    XLSX.writeFile(wb, 'quizblast-template.xlsx');
  },
};

/* ─── DRAG & DROP (global) ─── */
(function initDragDrop() {
  const overlay = $('drop-overlay');
  let dragCounter = 0;

  document.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter++;
    overlay.classList.remove('hidden');
  });
  document.addEventListener('dragleave', (e) => {
    dragCounter--;
    if (dragCounter <= 0) { dragCounter = 0; overlay.classList.add('hidden'); }
  });
  document.addEventListener('dragover', (e) => { e.preventDefault(); });
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    dragCounter = 0;
    overlay.classList.add('hidden');
    const file = e.dataTransfer.files[0];
    if (file) FileImport.handleDrop(file);
  });
})();
