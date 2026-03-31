/**
 * Host UI — Client-side logic
 * Connects to /quiz-ws WebSocket, manages all 7 screens.
 */

// ─── State ────────────────────────────────────────────────

let ws = null;
let sessionId = null;
let joinCode = null;
let timerInterval = null;
let timeLeft = 0;
let timeLimit = 30;
let questionCount = 10;
let answeredCount = 0;
let expectedCount = 0;
let showArtworkDuringQuestion = false;
const players = new Map(); // id → { name, avatar }

// ─── WebSocket ────────────────────────────────────────────

function connect() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}/quiz-ws`);

  ws.onopen = () => console.log('🎮 Connected to quiz server');

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    handleMessage(msg);
  };

  ws.onclose = () => {
    console.log('🎮 Disconnected — reconnecting in 2s');
    setTimeout(connect, 2000);
  };

  ws.onerror = (err) => console.error('🎮 WS error:', err);
}

function send(msg) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

// ─── Source mapping (same as quiz lobby) ──────────────────

const GENRES = {
  "20": "alternative", "2": "blues", "5": "classical", "17": "dance",
  "7": "electronic", "18": "hip hop", "11": "jazz", "12": "latin",
  "1153": "metal", "14": "pop", "15": "r&b soul", "24": "reggae",
  "21": "rock", "10": "singer songwriter", "16": "soundtrack", "19": "world",
};
const GENRE_IDS = Object.keys(GENRES);

function mapSource(source, genre) {
  if (source === 'charts-genre') return { source: 'charts', genre };
  if (source === 'charts-soundtrack') return { source: 'charts', genre: '16' };
  if (source === 'dansk') return { source: 'charts', genre: undefined };
  if (source === 'random') {
    const randomGenre = GENRE_IDS[Math.floor(Math.random() * GENRE_IDS.length)];
    return { source: 'charts', genre: randomGenre };
  }
  if (source === 'mixed') {
    // Pick a random source each time
    const sources = ['recently-played', 'charts', 'library'];
    const picked = sources[Math.floor(Math.random() * sources.length)];
    return { source: picked, genre: undefined };
  }
  return { source, genre: undefined };
}

// ─── Session Creation ─────────────────────────────────────

function createSession() {
  const rawSource = document.getElementById('cfg-source').value;
  const rawGenre = document.getElementById('cfg-genre').value;
  const { source, genre } = mapSource(rawSource, rawGenre);

  const config = {
    quizType: document.getElementById('cfg-type').value,
    source,
    genre,
    questionCount: parseInt(document.getElementById('cfg-count').value) || 10,
    timeLimit: parseInt(document.getElementById('cfg-timer').value) || 30,
    decade: document.getElementById('cfg-decade').value || undefined,
    answerMode: document.getElementById('cfg-answer-mode').value,
    excludeRecentPlays: document.getElementById('cfg-exclude-recent').checked,
  };

  timeLimit = config.timeLimit;
  questionCount = config.questionCount;
  showArtworkDuringQuestion = document.getElementById('cfg-show-artwork').checked;

  // Check for custom playlist from builder
  const customPlaylist = sessionStorage.getItem('customQuizPlaylist');
  if (customPlaylist) {
    config.source = 'custom';
    config.customTracks = JSON.parse(customPlaylist);
    config.customName = sessionStorage.getItem('customQuizName') || 'Custom Quiz';
    sessionStorage.removeItem('customQuizPlaylist');
    sessionStorage.removeItem('customQuizName');
  }

  document.getElementById('btn-create').disabled = true;
  document.getElementById('btn-create').textContent = 'Creating quiz...';

  send({ type: 'create_session', config });
}

function startGame() {
  send({ type: 'start_quiz' });
}

// ─── Show/Hide Genre ──────────────────────────────────────

document.getElementById('cfg-source').addEventListener('change', (e) => {
  document.getElementById('genre-container').style.display =
    e.target.value === 'charts-genre' ? '' : 'none';
});

// ─── Keyboard Shortcuts ───────────────────────────────────

document.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault();
    const startBtn = document.getElementById('btn-start');
    if (startBtn.style.display !== 'none' && !startBtn.disabled) {
      startGame();
    }
  }
  if (e.code === 'Escape') {
    send({ type: 'end_quiz' });
  }
  if (e.code === 'KeyN' || e.code === 'ArrowRight') {
    send({ type: 'skip_question' });
  }
});

// ─── Screen Management ────────────────────────────────────

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(`screen-${id}`).classList.add('active');
}

// ─── Message Handler ──────────────────────────────────────

function handleMessage(msg) {
  switch (msg.type) {
    case 'session_created':
      onSessionCreated(msg);
      break;
    case 'player_joined':
      onPlayerJoined(msg.player);
      break;
    case 'player_left':
      onPlayerLeft(msg.playerId, msg.playerName);
      break;
    case 'game_state':
      onGameState(msg);
      break;
    case 'answer_received':
      onAnswerReceived(msg);
      break;
    case 'evaluating_answers':
      showScreen('evaluating');
      break;
    case 'question_results':
      onQuestionResults(msg);
      break;
    case 'final_results':
      onFinalResults(msg.rankings);
      break;
    case 'error':
      alert(msg.message);
      document.getElementById('btn-create').disabled = false;
      document.getElementById('btn-create').textContent = 'Create Game';
      break;
  }
}

// ─── Session Created ──────────────────────────────────────

function onSessionCreated(msg) {
  sessionId = msg.sessionId;
  joinCode = msg.joinCode;

  document.getElementById('join-code').textContent = joinCode;
  document.getElementById('join-url').textContent = msg.joinUrl;
  document.getElementById('lobby-panel').style.display = '';
  document.getElementById('btn-create').style.display = 'none';
  document.getElementById('btn-start').style.display = '';

  // Generate QR code
  const canvas = document.getElementById('qr-canvas');
  QRCode.toCanvas(canvas, msg.joinUrl, {
    width: 220,
    margin: 0,
    color: { dark: '#000', light: '#fff' },
  });
}

// ─── Player Management ────────────────────────────────────

function onPlayerJoined(player) {
  players.set(player.id, player);
  updatePlayersGrid();
  document.getElementById('btn-start').disabled = players.size === 0;
}

function onPlayerLeft(playerId, playerName) {
  players.delete(playerId);
  updatePlayersGrid();
}

function updatePlayersGrid() {
  const grid = document.getElementById('players-grid');
  grid.innerHTML = '';
  document.getElementById('player-count').textContent = players.size;

  for (const p of players.values()) {
    const chip = document.createElement('div');
    chip.className = 'player-chip';
    chip.innerHTML = `<span>${p.avatar}</span><span>${p.name}</span>`;
    grid.appendChild(chip);
  }
}

// ─── Game State ───────────────────────────────────────────

function onGameState(msg) {
  switch (msg.state) {
    case 'countdown':
      showCountdown(msg.questionNumber, msg.totalQuestions, msg.question?.questionType);
      break;
    case 'playing':
      showQuestion(msg);
      break;
    case 'evaluating':
      showScreen('evaluating');
      break;
    case 'reveal':
      // Reveal handled by question_results message
      break;
    case 'scoreboard':
      showScoreboard(msg);
      break;
    case 'finished':
      // Final handled by final_results message
      break;
  }
}

// ─── Countdown ────────────────────────────────────────────

function showCountdown(qNum, total, questionType) {
  showScreen('countdown');
  const numEl = document.getElementById('countdown-number');
  const labelEl = document.getElementById('countdown-label');
  const typeEl = document.getElementById('countdown-type');
  labelEl.textContent = `Question ${qNum} of ${total}`;

  const typeLabels = {
    'guess-the-artist': 'Guess the Artist',
    'guess-the-song': 'Guess the Song',
    'guess-the-album': 'Guess the Album',
    'guess-the-year': 'Guess the Year',
    'intro-quiz': 'Name That Tune!',
  };
  typeEl.textContent = typeLabels[questionType] || '';

  let count = 3;
  numEl.textContent = count;
  numEl.style.animation = 'none';
  void numEl.offsetHeight;
  numEl.style.animation = 'countPop 0.8s cubic-bezier(0.16, 1, 0.3, 1)';
  playTick();

  const interval = setInterval(() => {
    count--;
    if (count <= 0) {
      clearInterval(interval);
      return;
    }
    numEl.textContent = count;
    numEl.style.animation = 'none';
    void numEl.offsetHeight;
    numEl.style.animation = 'countPop 0.8s cubic-bezier(0.16, 1, 0.3, 1)';
    playTick();
  }, 1000);
}

// ─── Question ─────────────────────────────────────────────

function showQuestion(msg) {
  showScreen('question');
  answeredCount = 0;
  expectedCount = players.size;

  document.getElementById('q-number').textContent = `Question ${msg.questionNumber} / ${msg.totalQuestions}`;

  const typeLabels = {
    'guess-the-artist': 'Guess the Artist',
    'guess-the-song': 'Guess the Song',
    'guess-the-album': 'Guess the Album',
    'guess-the-year': 'Guess the Year',
    'intro-quiz': 'Name That Tune!',
    'mixed': 'Mixed',
  };
  document.getElementById('q-type').textContent = typeLabels[msg.question?.questionType] || '';
  document.getElementById('q-text').textContent = msg.question?.questionText || '';

  // Artwork — hidden during questions by default (reveals answer!)
  const artworkContainer = document.getElementById('artwork-container');
  const artworkImg = document.getElementById('q-artwork');
  if (msg.question?.artworkUrl && showArtworkDuringQuestion) {
    artworkImg.src = msg.question.artworkUrl;
    artworkContainer.style.display = '';
    artworkImg.className = msg.question.questionType === 'intro-quiz' ? 'artwork-hidden' : '';
  } else {
    artworkContainer.style.display = 'none';
  }

  // Options
  const optionsGrid = document.getElementById('options-grid');
  const freeTextHint = document.getElementById('free-text-hint');

  if (msg.question?.answerMode === 'free-text') {
    optionsGrid.style.display = 'none';
    freeTextHint.style.display = '';
  } else {
    optionsGrid.style.display = '';
    freeTextHint.style.display = 'none';
    optionsGrid.innerHTML = '';
    const colors = ['a', 'b', 'c', 'd'];
    (msg.question?.options || []).forEach((opt, i) => {
      const btn = document.createElement('div');
      btn.className = `option-btn ${colors[i]}`;
      btn.textContent = opt;
      btn.dataset.index = i;
      optionsGrid.appendChild(btn);
    });
  }

  // Preview audio fallback (when no Home Controller)
  const audio = document.getElementById('preview-audio');
  if (!msg.question?.homeConnected && msg.question?.previewUrl) {
    audio.src = msg.question.previewUrl;
    audio.currentTime = 0;
    audio.play().catch(() => {});
    console.log('🔊 Playing preview audio (no Home Controller)');
  } else {
    audio.pause();
  }

  // Timer
  startTimer(msg.timeLimit || timeLimit);

  // Answers counter
  document.getElementById('answers-counter').textContent = `0 / ${expectedCount} answered`;
}

// ─── Timer ────────────────────────────────────────────────

function startTimer(seconds) {
  if (timerInterval) clearInterval(timerInterval);
  timeLeft = seconds;
  const circumference = 2 * Math.PI * 36; // r=36

  const progress = document.getElementById('timer-progress');
  const text = document.getElementById('timer-text');

  progress.style.strokeDasharray = circumference;
  progress.style.strokeDashoffset = '0';
  text.textContent = timeLeft;

  timerInterval = setInterval(() => {
    timeLeft--;
    if (timeLeft <= 0) {
      clearInterval(timerInterval);
      timeLeft = 0;
    }
    const offset = circumference * (1 - timeLeft / seconds);
    progress.style.strokeDashoffset = offset;
    text.textContent = timeLeft;
  }, 1000);
}

// ─── Answer Received ──────────────────────────────────────

function onAnswerReceived(msg) {
  answeredCount = msg.total;
  expectedCount = msg.expected;
  document.getElementById('answers-counter').textContent = `${answeredCount} / ${expectedCount} answered`;
}

// ─── Question Results / Reveal ────────────────────────────

function onQuestionResults(msg) {
  if (timerInterval) clearInterval(timerInterval);
  // Stop preview audio
  const audio = document.getElementById('preview-audio');
  audio.pause();
  showScreen('reveal');

  const q = msg.question;

  // Song info
  document.getElementById('reveal-song').textContent = q.songName || q.correctAnswer || '';
  document.getElementById('reveal-artist').textContent = q.artistName || '';
  document.getElementById('reveal-album').textContent = q.albumName ? `${q.albumName} (${q.releaseYear || ''})` : '';

  if (q.artworkUrl) {
    document.getElementById('reveal-artwork').src = q.artworkUrl;
    document.getElementById('reveal-artwork-box').style.display = '';
  } else {
    document.getElementById('reveal-artwork-box').style.display = 'none';
  }

  // Results grid
  const grid = document.getElementById('results-grid');
  grid.innerHTML = '';

  // Sort: correct first, then by points
  const sorted = [...msg.results].sort((a, b) => {
    if (a.correct !== b.correct) return a.correct ? -1 : 1;
    return b.points - a.points;
  });

  for (const r of sorted) {
    const card = document.createElement('div');
    card.className = `result-card ${r.correct ? 'correct' : 'wrong'}`;
    card.innerHTML = `
      <span class="result-avatar">${r.avatar}</span>
      <div>
        <div class="result-name">${r.playerName}</div>
        ${r.correct
          ? `<div class="result-points">+${r.points} pts${r.streak >= 3 ? ` 🔥${r.streak}` : ''}</div>`
          : `<div class="result-wrong-text">${r.answer}</div>`}
        ${r.aiExplanation ? `<div class="result-ai">${r.aiExplanation}</div>` : ''}
      </div>
    `;
    grid.appendChild(card);
  }
}

// ─── Scoreboard ───────────────────────────────────────────

function showScoreboard(msg) {
  showScreen('scoreboard');
  renderScoreboard();
}

function renderScoreboard() {
  // Build sorted list from players
  const sorted = [...players.values()]
    .map(p => ({
      ...p,
      // We need score from the last question_results; store it in players map
      score: p._score || 0,
      streak: p._streak || 0,
    }))
    .sort((a, b) => b.score - a.score);

  const list = document.getElementById('scoreboard-list');
  list.innerHTML = '';

  sorted.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'score-row';
    const rankClass = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';
    row.innerHTML = `
      <span class="score-rank ${rankClass}">${i + 1}</span>
      <span class="score-avatar">${p.avatar}</span>
      <span class="score-name">${p.name}</span>
      ${p.streak >= 3 ? `<span class="score-streak">🔥 ${p.streak}</span>` : ''}
      <span class="score-points">${p.score}</span>
    `;
    list.appendChild(row);
  });
}

// Update player scores when we get results
const origHandler = handleMessage;
const patchedHandler = (msg) => {
  if (msg.type === 'question_results') {
    for (const r of msg.results) {
      const p = players.get(r.playerId);
      if (p) {
        p._score = r.totalScore;
        p._streak = r.streak;
      }
    }
  }
};
// Wrap handleMessage
const _origHandleMessage = handleMessage;
// We'll just update in onQuestionResults
const _origOnQuestionResults = onQuestionResults;
onQuestionResults = function(msg) {
  // Update player scores
  for (const r of msg.results) {
    const p = players.get(r.playerId);
    if (p) {
      p._score = r.totalScore;
      p._streak = r.streak;
    }
  }
  _origOnQuestionResults(msg);
};

// ─── Final Results ────────────────────────────────────────

function onFinalResults(rankings) {
  if (timerInterval) clearInterval(timerInterval);
  showScreen('final');

  // Podium
  const podium = document.getElementById('podium');
  podium.innerHTML = '';

  // Reorder: 2nd, 1st, 3rd
  const podiumOrder = [
    rankings[1], // 2nd place (left)
    rankings[0], // 1st place (center)
    rankings[2], // 3rd place (right)
  ].filter(Boolean);

  const placeClasses = rankings.length >= 3
    ? ['second', 'first', 'third']
    : rankings.length === 2
    ? ['second', 'first']
    : ['first'];

  // If only 2 players, podiumOrder is [2nd, 1st]
  const displayOrder = rankings.length >= 3 ? podiumOrder : rankings.length === 2 ? [rankings[1], rankings[0]] : [rankings[0]];

  displayOrder.forEach((r, i) => {
    if (!r) return;
    const place = document.createElement('div');
    place.className = `podium-place ${placeClasses[i]}`;
    place.innerHTML = `
      <div class="podium-block">
        <div class="podium-avatar">${r.avatar}</div>
        <div class="podium-name">${r.playerName}</div>
        <div class="podium-score">${r.totalScore}</div>
      </div>
    `;
    podium.appendChild(place);
  });

  // Full stats
  const stats = document.getElementById('final-stats');
  stats.innerHTML = '';
  for (const r of rankings) {
    const row = document.createElement('div');
    row.className = 'score-row';
    const rankClass = r.rank === 1 ? 'gold' : r.rank === 2 ? 'silver' : r.rank === 3 ? 'bronze' : '';
    row.innerHTML = `
      <span class="score-rank ${rankClass}">${r.rank}</span>
      <span class="score-avatar">${r.avatar}</span>
      <span class="score-name">${r.playerName}</span>
      <span style="color:var(--muted);font-size:14px">${r.correctAnswers}/${r.totalAnswers} correct · streak ${r.longestStreak} · avg ${(r.averageTimeMs / 1000).toFixed(1)}s</span>
      <span class="score-points">${r.totalScore}</span>
    `;
    stats.appendChild(row);
  }

  // Confetti!
  launchConfetti();
}

// ─── Confetti ─────────────────────────────────────────────

function launchConfetti() {
  const container = document.getElementById('confetti');
  container.innerHTML = '';
  const colors = ['#fc3c44', '#ffd60a', '#5ac8fa', '#34c759', '#ff9f0a', '#bf5af2'];

  for (let i = 0; i < 100; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    piece.style.animationDelay = `${Math.random() * 2}s`;
    piece.style.animationDuration = `${2 + Math.random() * 2}s`;
    piece.style.width = `${6 + Math.random() * 8}px`;
    piece.style.height = `${6 + Math.random() * 8}px`;
    piece.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
    container.appendChild(piece);
  }
}

// ─── Exit Game ────────────────────────────────────────────

function exitGame() {
  if (confirm('End the quiz for all players?')) {
    send({ type: 'end_quiz' });
    // Pause music
    send({ type: 'end_quiz' });
    setTimeout(() => location.reload(), 500);
  }
}

// Show/hide exit button based on screen
const _origShowScreen = showScreen;
showScreen = function(id) {
  _origShowScreen(id);
  const exitBtn = document.getElementById('exit-btn');
  // Show exit button on all game screens except setup and final
  exitBtn.style.display = (id !== 'setup' && id !== 'final') ? '' : 'none';
};

// ─── Tick Sound (Web Audio API) ───────────────────────────

let audioCtx = null;
function playTick() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.frequency.value = 880;
  osc.type = 'sine';
  gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);
  osc.start(audioCtx.currentTime);
  osc.stop(audioCtx.currentTime + 0.15);
}

// ─── Load Custom Quiz ─────────────────────────────────────

async function loadCustomQuiz() {
  const modal = document.getElementById('load-quiz-modal');
  const list = document.getElementById('host-saved-list');
  modal.style.display = 'flex';

  try {
    const res = await fetch('/quiz/api/builder/playlists');
    const playlists = await res.json();

    if (playlists.length === 0) {
      list.innerHTML = '<div style="padding:40px;text-align:center;color:var(--dimmer)">No saved quizzes yet.<br><a href="/quiz/builder" style="color:var(--red);margin-top:8px;display:inline-block">Create one in Quiz Builder</a></div>';
      return;
    }

    list.innerHTML = '';
    for (const pl of playlists) {
      const item = document.createElement('div');
      item.style.cssText = 'display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:10px;cursor:pointer;transition:background 0.15s';
      item.onmouseover = () => item.style.background = 'rgba(255,255,255,0.04)';
      item.onmouseout = () => item.style.background = '';
      item.innerHTML = `
        <div style="flex:1">
          <div style="font-weight:600">${pl.name}</div>
          <div style="font-size:12px;color:var(--dimmer)">${pl.tracks.length} tracks · ${new Date(pl.updatedAt).toLocaleDateString('da-DK')}</div>
        </div>
      `;
      item.addEventListener('click', () => {
        sessionStorage.setItem('customQuizPlaylist', JSON.stringify(pl.tracks));
        sessionStorage.setItem('customQuizName', pl.name);
        window.location.href = '/quiz/host?source=custom';
      });
      list.appendChild(item);
    }
  } catch (err) {
    list.innerHTML = `<div style="padding:40px;text-align:center;color:var(--dimmer)">Failed to load</div>`;
  }
}

// Close modal on backdrop
document.getElementById('load-quiz-modal')?.addEventListener('click', (e) => {
  if (e.target.id === 'load-quiz-modal') e.target.style.display = 'none';
});

// ─── Custom Quiz Detection ────────────────────────────────

function checkCustomQuiz() {
  const params = new URLSearchParams(location.search);
  const customPlaylist = sessionStorage.getItem('customQuizPlaylist');

  if (params.get('source') === 'custom' && customPlaylist) {
    const tracks = JSON.parse(customPlaylist);
    const name = sessionStorage.getItem('customQuizName') || 'Custom Quiz';
    document.getElementById('custom-quiz-banner').style.display = '';
    document.getElementById('custom-quiz-name').textContent = name;
    document.getElementById('custom-quiz-info').textContent = `${tracks.length} curated tracks`;
    document.getElementById('setup-subtitle').textContent = 'Custom quiz ready — add players and start';

    // Hide source/genre/decade selectors (not relevant for custom)
    document.getElementById('cfg-source').closest('.config-item').style.display = 'none';
    document.getElementById('genre-container').style.display = 'none';
    document.getElementById('cfg-decade').closest('.config-item').style.display = 'none';

    // Set question count to track count
    document.getElementById('cfg-count').value = tracks.length;
    document.getElementById('cfg-count').max = tracks.length;
  }
}

// ─── Init ─────────────────────────────────────────────────

checkCustomQuiz();
connect();
