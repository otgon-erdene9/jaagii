// ══════════════════════════════════════════════════════════
//  QuizBlast — Kahoot-style offline/local quiz game
//  All data stored in localStorage. No server needed.
// ══════════════════════════════════════════════════════════

/* ─── CONSTANTS ─── */
const ANSWER_ICONS = ['▲', '●', '◆', '★'];
const ANSWER_CLASSES = ['c1', 'c2', 'c3', 'c4'];
const BASE_SCORE = 1000;

/* ─── STORAGE ─── */
const Storage = {
  getQuizzes() { return JSON.parse(localStorage.getItem('qb_quizzes') || '[]'); },
  saveQuizzes(q) { localStorage.setItem('qb_quizzes', JSON.stringify(q)); },
  getSession() { return JSON.parse(localStorage.getItem('qb_session') || 'null'); },
  saveSession(s) { localStorage.setItem('qb_session', JSON.stringify(s)); },
  clearSession() { localStorage.removeItem('qb_session'); },
};

/* ─── DEFAULT QUIZZES ─── */
(function seedIfEmpty() {
  if (Storage.getQuizzes().length === 0) {
    const demos = [
      {
        id: uid(), title: 'Монгол түүх 🏹',
        questions: [
          { text: 'Чингис хааны бодит нэр юу байсан бэ?', answers: ['Тэмүүжин','Жамуха','Өгэдэй','Мөнх'], correct: 0, time: 20 },
          { text: 'Монгол улс хэдэн онд тусгаар тогтносон бэ?', answers: ['1911','1921','1945','1990'], correct: 1, time: 20 },
          { text: 'Монголын нийслэл хот аль нь вэ?', answers: ['Эрдэнэт','Дархан','Улаанбаатар','Чойбалсан'], correct: 2, time: 15 },
        ]
      },
      {
        id: uid(), title: 'Дэлхийн нийслэлүүд 🌍',
        questions: [
          { text: 'Японы нийслэл аль нь вэ?', answers: ['Осака','Токио','Киото','Хирошима'], correct: 1, time: 15 },
          { text: 'Францын нийслэл?', answers: ['Лион','Марсель','Парис','Бордо'], correct: 2, time: 15 },
          { text: 'Бразилын нийслэл?', answers: ['Рио де Жанейро','Сан Паоло','Бразилиа','Салвадор'], correct: 2, time: 20 },
          { text: 'Австралийн нийслэл?', answers: ['Сидней','Мельбурн','Канберра','Брисбен'], correct: 2, time: 20 },
        ]
      },
    ];
    Storage.saveQuizzes(demos);
  }
})();

/* ─── UTILITIES ─── */
function uid() { return Math.random().toString(36).slice(2, 10); }
function genPin() { return String(Math.floor(100000 + Math.random() * 900000)); }
function $(id) { return document.getElementById(id); }
function rank(n) { return n === 0 ? '🥇' : n === 1 ? '🥈' : n === 2 ? '🥉' : `#${n+1}`; }

/* ─── GAME STATE ─── */
let state = {
  mode: null,          // 'host' | 'player'
  quiz: null,
  pin: null,
  players: [],         // [{id, name, score, lastCorrect}]
  myId: null,
  currentQ: 0,
  timerInterval: null,
  timeLeft: 0,
  answeredCount: 0,
  myAnswered: false,
  myAnswerCorrect: false,
};

/* ─── BroadcastChannel (same-browser tab sync) ─── */
let bc = null;
function initBC(pin) {
  if (bc) bc.close();
  bc = new BroadcastChannel('qb_' + pin);
  bc.onmessage = (e) => handleMsg(e.data);
}

function send(msg) {
  if (bc) bc.postMessage(msg);
  // Also handle locally (host processes its own msgs via handleMsg)
  if (state.mode === 'host') handleMsg(msg);
}

/* ─── APP ─── */
const App = {
  goTo(screenId) {
    document.querySelectorAll('.screen').forEach(s => {
      s.classList.remove('active');
      s.style.display = 'none';
    });
    const sc = $(screenId);
    sc.style.display = 'flex';
    sc.classList.add('active');

    if (screenId === 'screen-host-menu') App.renderHostMenu();
  },

  renderHostMenu() {
    const list = $('quiz-list');
    const quizzes = Storage.getQuizzes();
    if (!quizzes.length) {
      list.innerHTML = '<p style="opacity:.5;text-align:center">Одоохондоо quiz байхгүй байна. Шинэ quiz үүсгэ!</p>';
      return;
    }
    list.innerHTML = quizzes.map(q => `
      <div class="quiz-item">
        <div style="flex:1;cursor:pointer" onclick="App.hostQuiz('${q.id}')">
          <div class="quiz-item-name">${q.title}</div>
          <div class="quiz-item-meta">${q.questions.length} асуулт</div>
        </div>
        <div class="quiz-item-actions">
          <button class="quiz-item-export" onclick="FileImport.exportOne('${q.id}')" title="JSON татах">⬇</button>
          <button class="quiz-item-del" onclick="App.deleteQuiz('${q.id}')" title="Устгах">🗑</button>
          <button class="quiz-item-btn" onclick="App.hostQuiz('${q.id}')">▶</button>
        </div>
      </div>
    `).join('');
  },

  deleteQuiz(id) {
    if (!confirm('Энэ quiz-ийг устгах уу?')) return;
    const quizzes = Storage.getQuizzes().filter(q => q.id !== id);
    Storage.saveQuizzes(quizzes);
    App.renderHostMenu();
  },

  hostQuiz(quizId) {
    const quiz = Storage.getQuizzes().find(q => q.id === quizId);
    if (!quiz) return;

    state.mode = 'host';
    state.quiz = quiz;
    state.pin = genPin();
    state.players = [];
    state.currentQ = 0;

    initBC(state.pin);

    $('lobby-pin').textContent = state.pin;
    $('lobby-quiz-name').textContent = quiz.title;
    $('player-list').innerHTML = '';

    App.goTo('screen-lobby');
  },

  joinGame() {
    const pin  = $('join-code').value.trim();
    const name = $('join-name').value.trim();
    $('join-error').textContent = '';

    if (pin.length < 4) { $('join-error').textContent = 'PIN код буруу байна'; return; }
    if (!name)          { $('join-error').textContent = 'Нэрээ оруулна уу'; return; }

    state.mode = 'player';
    state.pin  = pin;
    state.myId = uid();
    state.myAnswered = false;

    initBC(pin);

    // Notify host
    bc.postMessage({ type: 'JOIN', id: state.myId, name });

    $('waiting-name').textContent = '👋 ' + name;
    App.goTo('screen-waiting');
  },

  startGame() {
    if (state.players.length === 0) {
      // Allow starting alone for testing
    }
    send({ type: 'NEXT_Q', qIndex: 0 });
  },

  showQuestion(qIndex) {
    const q = state.quiz.questions[qIndex];
    state.currentQ = qIndex;
    state.answeredCount = 0;
    state.myAnswered = false;

    $('q-num').textContent = `Асуулт ${qIndex + 1}/${state.quiz.questions.length}`;
    $('q-text').textContent = q.text;
    $('q-stats').classList.add('hidden');

    const answers = $('q-answers');
    answers.innerHTML = q.answers.map((a, i) => `
      <div class="ans-block ${ANSWER_CLASSES[i]}">
        <span class="ans-icon">${ANSWER_ICONS[i]}</span>
        <span>${a}</span>
      </div>
    `).join('');

    App.goTo('screen-question');
    App.startTimer(q.time || 20, 'q');
  },

  showPlayerQuestion(qIndex) {
    const q = state.quiz.questions[qIndex];
    state.currentQ = qIndex;
    state.myAnswered = false;

    $('pa-num').textContent = `Асуулт ${qIndex + 1}/${state.quiz.questions.length}`;
    $('pa-question').textContent = q.text;
    $('pa-result').className = 'pa-result hidden';
    $('pa-result').textContent = '';

    const choices = $('pa-choices');
    choices.innerHTML = q.answers.map((a, i) => `
      <button class="pa-btn ${ANSWER_CLASSES[i]}" onclick="App.submitAnswer(${i})">
        <span>${ANSWER_ICONS[i]}</span>
        <span>${a}</span>
      </button>
    `).join('');

    App.goTo('screen-answer');
    App.startTimer(q.time || 20, 'pa');
  },

  startTimer(seconds, prefix) {
    clearInterval(state.timerInterval);
    state.timeLeft = seconds;
    const fill = $(`${prefix}-timer-fill`);
    const text = $(`${prefix}-timer-text`);
    text.textContent = seconds;
    fill.style.width = '100%';

    state.timerInterval = setInterval(() => {
      state.timeLeft--;
      text.textContent = state.timeLeft;
      fill.style.width = ((state.timeLeft / seconds) * 100) + '%';

      if (state.timeLeft <= 0) {
        clearInterval(state.timerInterval);
        if (state.mode === 'host') {
          App.revealAnswer();
        }
      }
    }, 1000);
  },

  submitAnswer(ansIndex) {
    if (state.myAnswered) return;
    state.myAnswered = true;

    // Disable buttons
    document.querySelectorAll('.pa-btn').forEach(b => b.disabled = true);
    document.querySelectorAll('.pa-btn')[ansIndex].classList.add('selected');

    bc.postMessage({
      type: 'ANSWER',
      id: state.myId,
      answer: ansIndex,
      timeLeft: state.timeLeft,
    });
  },

  revealAnswer() {
    clearInterval(state.timerInterval);
    const q = state.quiz.questions[state.currentQ];
    const blocks = document.querySelectorAll('.ans-block');
    blocks.forEach((b, i) => {
      if (i === q.correct) b.classList.add('correct');
      else b.classList.add('wrong');
    });
    $('q-stats').classList.remove('hidden');
    $('q-stats').textContent = `✅ ${state.answeredCount} хүн хариулсан`;

    setTimeout(() => App.showLeaderboard(), 2500);
  },

  showLeaderboard() {
    const sorted = [...state.players].sort((a, b) => b.score - a.score);
    const lb = $('lb-list');
    lb.innerHTML = sorted.slice(0, 10).map((p, i) => `
      <div class="lb-item rank-${i+1}" style="animation-delay:${i*80}ms">
        <span class="lb-rank">${rank(i)}</span>
        <span class="lb-name">${p.name}</span>
        <span class="lb-score">${p.score}</span>
      </div>
    `).join('');

    const isLast = state.currentQ >= state.quiz.questions.length - 1;
    $('next-q-btn').classList.toggle('hidden', isLast);
    $('finish-btn').classList.toggle('hidden', !isLast);

    App.goTo('screen-leaderboard');
  },

  nextQuestion() {
    send({ type: 'NEXT_Q', qIndex: state.currentQ + 1 });
  },

  finishGame() {
    send({ type: 'GAME_OVER' });
    App.showFinal();
  },

  showFinal() {
    const sorted = [...state.players].sort((a, b) => b.score - a.score);
    const fl = $('final-list');
    fl.innerHTML = sorted.slice(0, 10).map((p, i) => `
      <div class="lb-item rank-${i+1}" style="animation-delay:${i*80}ms">
        <span class="lb-rank">${rank(i)}</span>
        <span class="lb-name">${p.name}</span>
        <span class="lb-score">${p.score}</span>
      </div>
    `).join('');
    App.goTo('screen-final');
    Confetti.burst();
  },
};

/* ─── MESSAGE HANDLER ─── */
function handleMsg(msg) {
  switch (msg.type) {

    case 'JOIN':
      if (state.mode !== 'host') return;
      if (state.players.find(p => p.id === msg.id)) return;
      state.players.push({ id: msg.id, name: msg.name, score: 0 });
      renderPlayerList();
      // Ack to everyone
      bc.postMessage({ type: 'JOIN_OK', players: state.players });
      break;

    case 'JOIN_OK':
      // Players update their player list knowledge
      if (state.mode === 'player') {
        state.players = msg.players;
      }
      break;

    case 'NEXT_Q':
      if (state.mode === 'host') {
        App.showQuestion(msg.qIndex);
      } else {
        // Need quiz data — fetch from storage by guessing (pin-based lookup not ideal)
        // Players need quiz to display question texts/answers
        // We broadcast quiz data on NEXT_Q
      }
      break;

    case 'QUIZ_DATA':
      // Players receive quiz info
      if (state.mode === 'player') {
        state.quiz = msg.quiz;
      }
      break;

    case 'SHOW_Q':
      if (state.mode === 'player') {
        state.quiz = msg.quiz;
        App.showPlayerQuestion(msg.qIndex);
      }
      break;

    case 'ANSWER':
      if (state.mode !== 'host') return;
      {
        const q = state.quiz.questions[state.currentQ];
        const player = state.players.find(p => p.id === msg.id);
        if (!player || player.answered) return;
        player.answered = true;
        state.answeredCount++;

        const correct = msg.answer === q.correct;
        if (correct) {
          const speedBonus = Math.floor((msg.timeLeft / (q.time || 20)) * 500);
          player.score += BASE_SCORE + speedBonus;
        }
        player.lastCorrect = correct;

        // Tell that player result
        bc.postMessage({ type: 'ANSWER_RESULT', id: msg.id, correct, score: player.score });

        // Update host stats
        if ($('q-stats')) {
          $('q-stats').classList.remove('hidden');
          $('q-stats').textContent = `✅ ${state.answeredCount} хүн хариулсан`;
        }

        // Auto-reveal when all answered
        if (state.answeredCount >= state.players.length) {
          setTimeout(() => App.revealAnswer(), 400);
        }
      }
      break;

    case 'ANSWER_RESULT':
      if (state.mode !== 'player' || msg.id !== state.myId) return;
      {
        const res = $('pa-result');
        res.classList.remove('hidden', 'correct-res', 'wrong-res');
        if (msg.correct) {
          res.classList.add('correct-res');
          res.textContent = '✅ Зөв! +' + (msg.score - (state.myScore || 0)) + ' оноо';
        } else {
          res.classList.add('wrong-res');
          res.textContent = '❌ Буруу...';
        }
        state.myScore = msg.score;
        clearInterval(state.timerInterval);
        $('pa-timer-fill').style.width = '0%';
      }
      break;

    case 'LEADERBOARD':
      if (state.mode === 'player') {
        state.players = msg.players;
        // Show simple waiting screen
        $('waiting-name').textContent = '📊 Дүн харуулж байна...';
        App.goTo('screen-waiting');
      }
      break;

    case 'GAME_OVER':
      if (state.mode === 'player') {
        state.players = msg.players || state.players;
        App.showFinal();
      }
      break;
  }
}

/* ─── Patch App.startGame & App.showQuestion to broadcast ─── */
const _origShowQ = App.showQuestion.bind(App);
App.showQuestion = function(qIndex) {
  // Reset answered flags
  state.players.forEach(p => p.answered = false);
  // Broadcast to players
  if (bc) bc.postMessage({ type: 'SHOW_Q', qIndex, quiz: state.quiz });
  _origShowQ(qIndex);
};

const _origShowLB = App.showLeaderboard.bind(App);
App.showLeaderboard = function() {
  if (bc && state.mode === 'host') {
    bc.postMessage({ type: 'LEADERBOARD', players: state.players });
  }
  _origShowLB();
};

function renderPlayerList() {
  const list = $('player-list');
  list.innerHTML = state.players.map(p =>
    `<div class="player-chip">${p.name}</div>`
  ).join('');
}

/* ─── EDITOR ─── */
const Editor = {
  questions: [],

  init() {
    Editor.questions = [Editor.blankQ()];
    Editor.render();
  },

  blankQ() {
    return { text: '', answers: ['', '', '', ''], correct: 0, time: 20 };
  },

  addQuestion() {
    Editor.questions.push(Editor.blankQ());
    Editor.render();
  },

  removeQuestion(i) {
    if (Editor.questions.length <= 1) return;
    Editor.questions.splice(i, 1);
    Editor.render();
  },

  render() {
    const wrap = $('questions-editor');
    wrap.innerHTML = Editor.questions.map((q, i) => `
      <div class="q-editor-card">
        <div class="q-num-label">Асуулт ${i+1}</div>
        <input class="big-input" placeholder="Асуулт бичнэ үү..."
          value="${esc(q.text)}"
          oninput="Editor.questions[${i}].text=this.value" />
        <div class="ans-row">
          ${q.answers.map((a, j) => `
            <div class="ans-input-wrap">
              <label style="color:${['#e8217a','#3b82f6','#fbbf24','#22c55e'][j]}">${ANSWER_ICONS[j]}</label>
              <input class="ans-input" placeholder="Хариулт ${j+1}"
                value="${esc(a)}"
                oninput="Editor.questions[${i}].answers[${j}]=this.value" />
            </div>
          `).join('')}
        </div>
        <select class="correct-sel" onchange="Editor.questions[${i}].correct=parseInt(this.value)">
          ${q.answers.map((a, j) => `<option value="${j}" ${q.correct===j?'selected':''}>✅ Зөв хариулт: ${ANSWER_ICONS[j]} ${esc(a||'Хариулт '+(j+1))}</option>`).join('')}
        </select>
        <select class="time-sel" onchange="Editor.questions[${i}].time=parseInt(this.value)">
          <option value="10" ${q.time===10?'selected':''}>⏱ 10 секунд</option>
          <option value="20" ${q.time===20?'selected':''}>⏱ 20 секунд</option>
          <option value="30" ${q.time===30?'selected':''}>⏱ 30 секунд</option>
          <option value="60" ${q.time===60?'selected':''}>⏱ 60 секунд</option>
        </select>
        ${Editor.questions.length > 1 ? `<br/><button class="remove-q-btn" onclick="Editor.removeQuestion(${i})">🗑 Устгах</button>` : ''}
      </div>
    `).join('');
  },

  exportCurrent() {
    const title = $('quiz-title').value.trim() || 'quiz';
    const data = { title, questions: Editor.questions };
    FileImport.downloadJSON(data, title);
  },

  save() {
    const title = $('quiz-title').value.trim();
    const msg = $('editor-msg');
    if (!title) { msg.textContent = '⚠ Quiz нэр оруулна уу'; msg.style.color='#f87171'; return; }

    const valid = Editor.questions.every(q =>
      q.text.trim() && q.answers.every(a => a.trim())
    );
    if (!valid) { msg.textContent = '⚠ Бүх асуулт, хариултуудыг бөглөнө үү'; msg.style.color='#f87171'; return; }

    const quizzes = Storage.getQuizzes();
    quizzes.push({ id: uid(), title, questions: Editor.questions });
    Storage.saveQuizzes(quizzes);

    msg.style.color = '#4ade80';
    msg.textContent = '✅ Амжилттай хадгалагдлаа! Хост менюгаас олж болно.';

    $('quiz-title').value = '';
    Editor.questions = [Editor.blankQ()];
    Editor.render();

    setTimeout(() => { msg.textContent = ''; }, 3000);
  },
};

function esc(s) { return String(s).replace(/"/g,'&quot;').replace(/</g,'&lt;'); }

/* ─── CONFETTI ─── */
const Confetti = {
  burst() {
    const container = $('confetti-container');
    container.innerHTML = '';
    const colors = ['#a78bfa','#f472b6','#fbbf24','#34d399','#60a5fa','#f87171'];
    for (let i = 0; i < 80; i++) {
      const el = document.createElement('div');
      el.style.cssText = `
        position:absolute;
        width:${6+Math.random()*8}px;
        height:${6+Math.random()*8}px;
        background:${colors[Math.floor(Math.random()*colors.length)]};
        border-radius:${Math.random()>.5?'50%':'2px'};
        left:${Math.random()*100}vw;
        top:-10px;
        animation: fall ${1.5+Math.random()*2}s ${Math.random()*1.5}s linear forwards;
      `;
      container.appendChild(el);
    }
  }
};

// Inject confetti keyframes
const style = document.createElement('style');
style.textContent = `
  @keyframes fall {
    to { transform: translateY(105vh) rotate(${Math.random()*720}deg); opacity: 0; }
  }
`;
document.head.appendChild(style);

/* ─── INIT ─── */
document.addEventListener('DOMContentLoaded', () => {
  Editor.init();
  App.goTo('screen-home');
});
