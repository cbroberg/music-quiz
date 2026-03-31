/**
 * Player PWA — Client-side logic
 * Connects to /quiz-ws WebSocket, handles join + answering.
 */

// ─── State ────────────────────────────────────────────────

let ws = null;
let myPlayer = null;
let sessionId = null;
let currentQuestionIndex = -1;
let questionStartTime = 0;
let timerInterval = null;
let hasAnswered = false;

const AVATARS = ['🎸', '🎤', '🎹', '🥁', '🎺', '🎻', '🎵', '🎶', '🎧', '🎼', '🪘', '🪗', '🎷', '🪈', '🪇', '🫧'];
let selectedAvatar = AVATARS[Math.floor(Math.random() * AVATARS.length)];

// ─── Init ─────────────────────────────────────────────────

function init() {
  // Populate avatar grid
  const grid = document.getElementById('avatar-grid');
  AVATARS.forEach(emoji => {
    const btn = document.createElement('button');
    btn.className = `avatar-btn${emoji === selectedAvatar ? ' selected' : ''}`;
    btn.textContent = emoji;
    btn.onclick = () => selectAvatar(emoji);
    grid.appendChild(btn);
  });

  // Pre-fill code from URL
  const params = new URLSearchParams(location.search);
  if (params.get('code')) {
    document.getElementById('join-code').value = params.get('code').toUpperCase();
  }

  // Restore name from localStorage
  const savedName = localStorage.getItem('quizPlayerName');
  if (savedName) document.getElementById('join-name').value = savedName;

  // Connect WebSocket
  connect();
}

function selectAvatar(emoji) {
  selectedAvatar = emoji;
  document.querySelectorAll('.avatar-btn').forEach(btn => {
    btn.classList.toggle('selected', btn.textContent === emoji);
  });
}

// ─── WebSocket ────────────────────────────────────────────

function connect() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}/quiz-ws`);

  ws.onopen = () => console.log('🎮 Connected');

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    handleMessage(msg);
  };

  ws.onclose = () => {
    console.log('🎮 Disconnected — reconnecting in 2s');
    setTimeout(connect, 2000);
  };

  ws.onerror = (err) => console.error('🎮 Error:', err);
}

function send(msg) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

// ─── Screen Management ────────────────────────────────────

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(`screen-${id}`).classList.add('active');
}

// ─── Join Game ────────────────────────────────────────────

function joinGame() {
  const code = document.getElementById('join-code').value.trim().toUpperCase();
  const name = document.getElementById('join-name').value.trim();

  if (!code || code.length < 4) {
    showError('Enter the game code from the screen');
    return;
  }
  if (!name) {
    showError('Enter your name');
    return;
  }

  localStorage.setItem('quizPlayerName', name);
  document.getElementById('btn-join').disabled = true;
  document.getElementById('btn-join').textContent = 'Joining...';

  send({
    type: 'join_session',
    joinCode: code,
    name,
    avatar: selectedAvatar,
  });
}

function showError(msg) {
  const el = document.getElementById('join-error');
  el.textContent = msg;
  el.style.display = '';
  setTimeout(() => { el.style.display = 'none'; }, 4000);
}

// ─── Message Handler ──────────────────────────────────────

function handleMessage(msg) {
  switch (msg.type) {
    case 'joined':
      onJoined(msg);
      break;
    case 'player_joined':
      onOtherPlayerJoined(msg.player);
      break;
    case 'player_left':
      onPlayerLeft(msg.playerId);
      break;
    case 'game_state':
      onGameState(msg);
      break;
    case 'answer_result':
      onAnswerResult(msg);
      break;
    case 'scoreboard':
      onScoreboard(msg.rankings);
      break;
    case 'final_result':
      onFinalResult(msg);
      break;
    case 'error':
      showError(msg.message);
      document.getElementById('btn-join').disabled = false;
      document.getElementById('btn-join').textContent = 'Join Game';
      break;
  }
}

// ─── Joined ───────────────────────────────────────────────

function onJoined(msg) {
  myPlayer = msg.player;
  sessionId = msg.sessionId;

  document.getElementById('lobby-avatar').textContent = myPlayer.avatar;
  document.getElementById('lobby-name').textContent = myPlayer.name;
  showScreen('lobby');

  // Show other players
  updateLobbyPlayers(msg.players);
}

function onOtherPlayerJoined(player) {
  const container = document.getElementById('lobby-players');
  const chip = document.createElement('div');
  chip.className = 'lobby-player-chip';
  chip.id = `lobby-p-${player.id}`;
  chip.innerHTML = `<span>${player.avatar}</span><span>${player.name}</span>`;
  container.appendChild(chip);
}

function onPlayerLeft(playerId) {
  const chip = document.getElementById(`lobby-p-${playerId}`);
  if (chip) chip.remove();
}

function updateLobbyPlayers(players) {
  const container = document.getElementById('lobby-players');
  container.innerHTML = '';
  for (const p of players) {
    if (p.id === myPlayer?.id) continue;
    const chip = document.createElement('div');
    chip.className = 'lobby-player-chip';
    chip.id = `lobby-p-${p.id}`;
    chip.innerHTML = `<span>${p.avatar}</span><span>${p.name}</span>`;
    container.appendChild(chip);
  }
}

// ─── Game State ───────────────────────────────────────────

function onGameState(msg) {
  switch (msg.state) {
    case 'countdown': {
      showScreen('lobby');
      const typeLabels = {
        'guess-the-artist': 'Guess the Artist!',
        'guess-the-song': 'Guess the Song!',
        'guess-the-album': 'Guess the Album!',
        'guess-the-year': 'Guess the Year!',
        'intro-quiz': 'Name That Tune!',
      };
      const typeHint = typeLabels[msg.questionType] || '';
      document.querySelector('.lobby-waiting').innerHTML =
        `Question ${msg.questionNumber} of ${msg.totalQuestions} coming up...<br><strong style="color:var(--red);font-size:20px;margin-top:8px;display:block">${typeHint}</strong>`;
      // Countdown on player
      const avatar = document.getElementById('lobby-avatar');
      let count = 3;
      avatar.textContent = count;
      avatar.style.fontSize = '80px';
      const ci = setInterval(() => {
        count--;
        if (count <= 0) { clearInterval(ci); avatar.textContent = myPlayer?.avatar || '🎵'; avatar.style.fontSize = ''; return; }
        avatar.textContent = count;
      }, 1000);
      break;
    }

    case 'playing':
      currentQuestionIndex = (msg.questionNumber || 1) - 1;
      questionStartTime = Date.now();
      hasAnswered = false;

      if (msg.answerMode === 'free-text') {
        showFreeText(msg);
      } else {
        showMultipleChoice(msg);
      }
      break;

    case 'evaluating':
      // Already answered or not — just wait
      break;

    case 'reveal':
      // Wait for answer_result
      break;

    case 'scoreboard':
      // Scoreboard shown via separate message
      break;

    case 'finished':
      // Final result shown via separate message
      break;
  }
}

// ─── Multiple Choice ──────────────────────────────────────

function showMultipleChoice(msg) {
  showScreen('mc');
  document.getElementById('mc-qnum').textContent = `Question ${msg.questionNumber} / ${msg.totalQuestions}`;

  const typeLabels = {
    'guess-the-artist': 'Who is the artist?',
    'guess-the-song': 'What song is this?',
    'guess-the-album': 'Which album?',
    'guess-the-year': 'What year?',
    'intro-quiz': 'Name that tune!',
    'mixed': msg.questionText || 'Listen and answer!',
  };
  document.getElementById('mc-type').textContent = typeLabels[msg.questionType] || msg.questionText || '';

  const grid = document.getElementById('mc-grid');
  grid.innerHTML = '';
  const colors = ['a', 'b', 'c', 'd'];

  (msg.options || []).forEach((opt, i) => {
    const btn = document.createElement('button');
    btn.className = `mc-btn ${colors[i]}`;
    btn.textContent = opt;
    btn.onclick = () => selectAnswer(i, btn);
    grid.appendChild(btn);
  });

  startPlayerTimer('mc-timer-bar', msg.timeLimit || 30);
}

function selectAnswer(index, btn) {
  if (hasAnswered) return;
  hasAnswered = true;

  const timeMs = Date.now() - questionStartTime;

  // Visual feedback
  btn.classList.add('selected');
  document.querySelectorAll('.mc-btn').forEach(b => { b.disabled = true; });

  // Vibrate
  if (navigator.vibrate) navigator.vibrate(50);

  send({
    type: 'submit_answer',
    questionIndex: currentQuestionIndex,
    answerIndex: index,
    timeMs,
  });
}

// ─── Free Text ────────────────────────────────────────────

function showFreeText(msg) {
  showScreen('ft');
  document.getElementById('ft-qnum').textContent = `Question ${msg.questionNumber} / ${msg.totalQuestions}`;

  const typeLabels = {
    'guess-the-artist': 'Type the artist name',
    'guess-the-song': 'Type the song title',
    'guess-the-album': 'Type the album name',
    'guess-the-year': 'Type the year',
    'intro-quiz': 'Song and artist?',
  };
  document.getElementById('ft-type').textContent = typeLabels[msg.questionType] || msg.questionText || 'Type your answer';

  const input = document.getElementById('ft-input');
  input.value = '';
  input.disabled = false;
  input.focus();
  document.getElementById('ft-submit-btn').style.display = '';
  document.getElementById('ft-submitted').style.display = 'none';

  startPlayerTimer('ft-timer-bar', msg.timeLimit || 30);
}

// Enter key submits free text
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && document.getElementById('screen-ft').classList.contains('active')) {
    submitTextAnswer();
  }
});

function submitTextAnswer() {
  if (hasAnswered) return;
  const input = document.getElementById('ft-input');
  const text = input.value.trim();
  if (!text) return;

  hasAnswered = true;
  const timeMs = Date.now() - questionStartTime;

  input.disabled = true;
  document.getElementById('ft-submit-btn').style.display = 'none';
  document.getElementById('ft-submitted').style.display = '';

  if (navigator.vibrate) navigator.vibrate(50);

  send({
    type: 'submit_text_answer',
    questionIndex: currentQuestionIndex,
    text,
    timeMs,
  });
}

// ─── Timer ────────────────────────────────────────────────

function startPlayerTimer(barId, seconds) {
  if (timerInterval) clearInterval(timerInterval);
  const bar = document.getElementById(barId);
  bar.style.width = '100%';
  let remaining = seconds;

  timerInterval = setInterval(() => {
    remaining--;
    bar.style.width = `${(remaining / seconds) * 100}%`;
    if (remaining <= 0) clearInterval(timerInterval);
  }, 1000);
}

// ─── Answer Result ────────────────────────────────────────

function onAnswerResult(msg) {
  if (timerInterval) clearInterval(timerInterval);
  showScreen('result');

  const container = document.getElementById('result-container');
  container.className = `result-container ${msg.correct ? 'result-correct' : 'result-wrong'}`;

  container.innerHTML = `
    <div class="result-icon">${msg.correct ? '✅' : '❌'}</div>
    <div class="result-label">${msg.correct ? 'Correct!' : 'Wrong!'}</div>
    ${msg.correct ? `<div class="result-points">+${msg.points}</div>` : ''}
    ${msg.streak >= 3 ? `<div class="result-streak">🔥 ${msg.streak} streak!</div>` : ''}
    <div class="result-rank">${getRankText(msg.rank)} place · ${msg.totalScore} points</div>
    <div class="result-answer">Answer: ${msg.correctAnswer}</div>
    ${msg.aiExplanation ? `<div class="result-ai">${msg.aiExplanation}</div>` : ''}
  `;
}

function getRankText(rank) {
  if (rank === 1) return '1st';
  if (rank === 2) return '2nd';
  if (rank === 3) return '3rd';
  return `${rank}th`;
}

// ─── Scoreboard ───────────────────────────────────────────

function onScoreboard(rankings) {
  showScreen('scoreboard');
  const container = document.getElementById('player-scoreboard');
  container.innerHTML = '';

  for (const r of rankings) {
    const row = document.createElement('div');
    const isMe = r.playerName === myPlayer?.name;
    row.style.cssText = `
      display:flex; align-items:center; gap:12px;
      background:${isMe ? 'rgba(252,60,68,0.1)' : 'var(--card)'};
      border:1px solid ${isMe ? 'var(--red)' : 'var(--border)'};
      border-radius:12px; padding:14px 16px; margin-bottom:8px;
    `;
    row.innerHTML = `
      <span style="font-size:20px;font-weight:800;color:var(--muted);width:28px">${r.rank}</span>
      <span style="font-size:24px">${r.avatar}</span>
      <span style="flex:1;font-weight:600">${r.playerName}${isMe ? ' (you)' : ''}</span>
      ${r.streak >= 3 ? `<span style="color:var(--orange);font-size:13px">🔥${r.streak}</span>` : ''}
      <span style="font-weight:800;color:var(--red);font-size:18px">${r.score}</span>
    `;
    container.appendChild(row);
  }
}

// ─── Final Result ─────────────────────────────────────────

function onFinalResult(msg) {
  if (timerInterval) clearInterval(timerInterval);
  showScreen('final');

  const container = document.getElementById('final-container');
  const rankClass = msg.rank === 1 ? 'gold' : msg.rank === 2 ? 'silver' : msg.rank === 3 ? 'bronze' : '';
  const trophies = { 1: '🏆', 2: '🥈', 3: '🥉' };

  const isWinner = msg.rank === 1;

  container.innerHTML = `
    ${isWinner ? '<div class="final-confetti" id="player-confetti"></div>' : ''}
    <div style="font-size:52px">${trophies[msg.rank] || myPlayer?.avatar || '🎵'}</div>
    <div class="final-rank-big ${rankClass} ${isWinner ? 'final-rank-pulse' : ''}">#${msg.rank}</div>
    <div class="final-score-big">${msg.totalScore} pts</div>
    <div class="final-stat-row">
      <span class="final-stat-label">Correct</span>
      <span class="final-stat-value">${msg.stats.correctAnswers}/${msg.stats.totalAnswers}</span>
    </div>
    <div class="final-stat-row">
      <span class="final-stat-label">Streak</span>
      <span class="final-stat-value">${msg.stats.longestStreak} 🔥</span>
    </div>
    <div class="final-stat-row">
      <span class="final-stat-label">Avg time</span>
      <span class="final-stat-value">${(msg.stats.averageTimeMs / 1000).toFixed(1)}s</span>
    </div>
    <div class="final-stat-row">
      <span class="final-stat-label">Accuracy</span>
      <span class="final-stat-value">${msg.stats.totalAnswers > 0 ? Math.round(msg.stats.correctAnswers / msg.stats.totalAnswers * 100) : 0}%</span>
    </div>
    <button onclick="location.href='/quiz/play'" style="margin-top:12px;background:var(--card);border:2px solid var(--border);color:var(--text);border-radius:14px;padding:14px 32px;font-size:16px;font-weight:600;font-family:inherit;cursor:pointer;width:100%">Play Again</button>
  `;

  // Confetti for the winner
  if (isWinner) {
    const confettiEl = document.getElementById('player-confetti');
    const colors = ['#fc3c44', '#ffd60a', '#5ac8fa', '#34c759', '#ff9f0a', '#bf5af2'];
    for (let i = 0; i < 60; i++) {
      const piece = document.createElement('div');
      piece.className = 'final-confetti-piece';
      piece.style.left = Math.random() * 100 + '%';
      piece.style.background = colors[Math.floor(Math.random() * colors.length)];
      piece.style.animationDelay = Math.random() * 2 + 's';
      piece.style.animationDuration = 2 + Math.random() * 2 + 's';
      piece.style.width = 6 + Math.random() * 6 + 'px';
      piece.style.height = 6 + Math.random() * 6 + 'px';
      piece.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
      confettiEl.appendChild(piece);
    }
  }
}

// ─── Register Service Worker ──────────────────────────────

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/quiz/sw.js').catch(() => {});
}

// Show PWA hint on iOS Safari (not already in standalone mode)
if (/iPhone|iPad/.test(navigator.userAgent) && !window.navigator.standalone) {
  document.getElementById('pwa-hint').style.display = '';
}

// ─── Start ────────────────────────────────────────────────

init();
