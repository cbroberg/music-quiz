/**
 * Player PWA — Client-side logic
 * Connects to /quiz-ws WebSocket, handles join + answering.
 */

// ─── State ────────────────────────────────────────────────

let ws = null;
let myPlayer = null;
let sessionId = null;
let roundNumber = 0;
let currentQuestionIndex = -1;
let questionStartTime = 0;
let timerInterval = null;
let hasAnswered = false;

const AVATARS = ['🎸', '🎤', '🎹', '🥁', '🎺', '🎻', '🎵', '🎶', '🎧', '🎼', '🪘', '🪗', '🎷', '🪈', '🪇', '🫧', '🪕', '🔔'];
let selectedAvatar = localStorage.getItem('quizPlayerAvatar') || AVATARS[Math.floor(Math.random() * AVATARS.length)];

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

  // Auto-rejoin ONLY if player was already in a session (DJ Mode page nav)
  // NOT on fresh QR scan — user must pick avatar and click Join
  const autoCode = params.get('code');
  const wasInSession = sessionStorage.getItem('inActiveSession') === 'true';
  const isAutoRejoining = autoCode && savedName && wasInSession;

  // DJ reconnect: if we have a saved name, try to reconnect to DJ directly
  const canDjReconnect = savedName && !autoCode;

  // Hide join screen during auto-rejoin or DJ reconnect
  if (isAutoRejoining || canDjReconnect) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  }

  // Connect WebSocket
  connect();

  if (isAutoRejoining) {
    // Wait for WS to open, then auto-join session
    const tryAutoJoin = setInterval(() => {
      if (ws?.readyState === WebSocket.OPEN) {
        clearInterval(tryAutoJoin);
        send({
          type: 'join_session',
          joinCode: autoCode.toUpperCase(),
          name: savedName,
          avatar: selectedAvatar,
        });
      }
    }, 200);
    setTimeout(() => {
      clearInterval(tryAutoJoin);
      if (!isDjModeActive) showScreen('join');
    }, 5000);
  } else if (canDjReconnect) {
    // No session code — try DJ reconnect with saved credentials
    const tryDjReconnect = setInterval(() => {
      if (ws?.readyState === WebSocket.OPEN) {
        clearInterval(tryDjReconnect);
        send({
          type: 'reconnect_dj',
          name: savedName,
          avatar: selectedAvatar,
        });
      }
    }, 200);
    setTimeout(() => {
      clearInterval(tryDjReconnect);
      if (!isDjModeActive) showScreen('join');
    }, 3000);
  }
}

function selectAvatar(emoji) {
  selectedAvatar = emoji;
  localStorage.setItem('quizPlayerAvatar', emoji);
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
    setTimeout(() => {
      connect();
      // Auto-rejoin if player was in an active session
      const wasInSession = sessionStorage.getItem('inActiveSession') === 'true';
      if (wasInSession) {
        const savedName = localStorage.getItem('quizPlayerName');
        const code = new URLSearchParams(location.search).get('code');
        if (savedName && code) {
          const tryRejoin = setInterval(() => {
            if (ws?.readyState === WebSocket.OPEN) {
              clearInterval(tryRejoin);
              send({ type: 'join_session', joinCode: code.toUpperCase(), name: savedName, avatar: selectedAvatar });
            }
          }, 200);
          setTimeout(() => clearInterval(tryRejoin), 5000);
        }
      }
    }, 2000);
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
    case 'waiting_room':
      onWaitingRoom(msg);
      break;
    case 'lobby_open':
      onLobbyOpen(msg);
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
    case 'dj_activated':
      isDjModeActive = true;
      onDjActivated(msg);
      break;
    case 'dj_deactivated':
      isDjModeActive = false;
      showScreen('final');
      break;
    case 'party_ended':
      isDjModeActive = false;
      sessionStorage.removeItem('inActiveSession');
      showScreen('join');
      break;
    case 'dj_pick_used':
      djCredits = msg.availableCredits;
      updateDjPicksDisplay();
      break;
    case 'dj_state':
      renderDjQueue(msg.queue, msg.current);
      break;
    case 'dj_error':
      showError(msg.message);
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
  sessionStorage.setItem('inActiveSession', 'true');
  if (msg.roundNumber) roundNumber = msg.roundNumber;

  document.getElementById('lobby-avatar').textContent = myPlayer.avatar;
  document.getElementById('lobby-name').textContent = myPlayer.name;
  updateRoundIndicator();
  requestWakeLock(); // keep screen on from lobby through entire quiz
  showScreen('lobby');
  // Show other players
  updateLobbyPlayers(msg.players);
}

function updateRoundIndicator() {
  const el = document.getElementById('round-indicator');
  if (el && roundNumber > 0) {
    el.textContent = `Round ${roundNumber}`;
    el.style.display = '';
  } else if (el) {
    el.style.display = 'none';
  }
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
  if (msg.roundNumber) roundNumber = msg.roundNumber;
  updateRoundIndicator();
  switch (msg.state) {
    case 'countdown': {
      showScreen('lobby');
      const typeLabels = {
        'guess-the-artist': 'Guess the Artist!',
        'guess-the-song': 'Guess the Song!',
        'guess-the-album': 'Guess the Album!',
        'guess-the-year': 'Guess the Year!',
        'intro-quiz': 'Name That Tune!',
        'gossip': 'Celebrity Gossip!',
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
    'country-of-origin': 'Where are they from?',
    'band-members': "Who's in the band?",
    'artist-trivia': 'Music trivia!',
    'film-soundtrack': 'Name that movie!',
    'tv-theme': 'Name that show!',
    'gossip': 'Celebrity gossip!',
    'mixed': msg.questionText || 'Listen and answer!',
  };
  // For trivia, use the actual question text from AI (more specific than label)
  const displayText = msg.isTrivia ? (msg.questionText || typeLabels[msg.questionType]) : typeLabels[msg.questionType];
  document.getElementById('mc-type').textContent = displayText || msg.questionText || '';

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
    'country-of-origin': 'Which country?',
    'band-members': 'Who is it?',
    'artist-trivia': 'Your answer?',
    'film-soundtrack': 'Which film?',
    'tv-theme': 'Which show?',
    'gossip': 'Gossip time!',
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
  const secEl = document.getElementById(barId.replace('-bar', '-sec'));
  bar.style.width = '100%';
  let remaining = seconds;
  if (secEl) secEl.textContent = remaining;

  timerInterval = setInterval(() => {
    remaining--;
    bar.style.width = `${(remaining / seconds) * 100}%`;
    if (secEl) secEl.textContent = remaining > 0 ? remaining : '';
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
    <div class="result-answer">${msg.correctAnswer}${msg.artistName ? ` — ${msg.artistName}` : ''}${msg.releaseYear && msg.releaseYear !== 'unknown' ? ` (${msg.releaseYear})` : ''}</div>
    ${msg.funFact ? `<div class="result-ai" style="font-style:italic">💡 ${msg.funFact}</div>` : ''}
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

  const picks = msg.creditsEarned || 0;
  container.innerHTML = `
    ${isWinner ? '<div class="final-confetti" id="player-confetti"></div>' : ''}
    <div style="font-size:52px">${trophies[msg.rank] || myPlayer?.avatar || '🎵'}</div>
    <div class="final-rank-big ${rankClass} ${isWinner ? 'final-rank-pulse' : ''}">#${msg.rank}</div>
    <div class="final-score-big">${msg.totalScore} pts</div>
    <div class="final-stat-row" style="background:rgba(52,199,89,0.1);border-color:rgba(52,199,89,0.2)">
      <span class="final-stat-label" style="color:#34c759;font-weight:700">Song credits</span>
      <span class="final-stat-value" style="color:#34c759;font-weight:700">${picks} 🎵</span>
    </div>
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

// ─── DJ Mode ──────────────────────────────────────────────

let djCredits = 0;
let djSearchTimeout = null;
let djAddedSongIds = new Set();

// ─── Waiting Room ────────────────────────────────────────

function onWaitingRoom(msg) {
  showScreen('waiting');
  const posEl = document.getElementById('waiting-position');
  if (posEl) posEl.textContent = `Position #${msg.position} in line`;
}

function onLobbyOpen(msg) {
  // Server opened a new lobby — auto-join with saved credentials
  const name = localStorage.getItem('quizPlayerName');
  if (name) {
    send({
      type: 'join_session',
      joinCode: msg.joinCode,
      name,
      avatar: selectedAvatar,
    });
  }
}

// ─── DJ Mode ──────────────────────────────────────────────

function onDjActivated(msg) {
  if (msg.roundNumber) roundNumber = msg.roundNumber;
  djCredits = msg.picks?.availableCredits ?? 0;
  djAddedSongIds.clear();
  isDjModeActive = true;
  // Store join code so Now Playing can link back
  const code = document.getElementById('join-code')?.value || new URLSearchParams(location.search).get('code') || '';
  if (code) sessionStorage.setItem('djJoinCode', code);
  sessionStorage.setItem('djAvatar', selectedAvatar);
  // Update all Now Playing links with code for return navigation
  const npLink = document.getElementById('dj-np-link');
  if (npLink && code) npLink.href = `/quiz/now-playing?from=dj&code=${code}`;
  const npPageLink = document.getElementById('dj-np-page-link');
  if (npPageLink && code) npPageLink.href = `/quiz/now-playing?from=dj&code=${code}`;
  // Show player identity
  const identEl = document.getElementById('dj-player-identity');
  if (identEl && myPlayer) identEl.textContent = `${myPlayer.avatar} ${myPlayer.name}`;
  showScreen('dj');
  updateDjPicksDisplay();
  requestWakeLock();

  const input = document.getElementById('dj-search');
  input.value = '';
  input.oninput = () => {
    clearTimeout(djSearchTimeout);
    djSearchTimeout = setTimeout(djDoSearch, 300);
  };
  document.getElementById('dj-search-results').innerHTML = '';
  document.getElementById('dj-all-picked').style.display = 'none';

  // Render queue if available (reconnect scenario)
  if (msg.queue || msg.current) {
    renderDjQueue(msg.queue, msg.current);
    // If picks are 0, switch to queue tab
    if (djCredits <= 0 && msg.queue?.some(q => !q.played)) {
      switchDjTab('queue');
    }
  }
}

function updateDjPicksDisplay() {
  const el = document.getElementById('dj-picks-left');
  el.textContent = `${djCredits} song credit${djCredits !== 1 ? 's' : ''} left`;
  const searchPanel = document.getElementById('dj-panel-search');
  if (djCredits <= 0) {
    // Hide search entirely — no searching at 0 picks
    if (searchPanel) searchPanel.style.display = 'none';
    // Switch to queue tab automatically
    switchDjTab('queue');
    // Disable any remaining add buttons
    document.querySelectorAll('.dj-add-btn:not(.used)').forEach(btn => {
      btn.classList.add('used');
      btn.disabled = true;
      btn.innerHTML = '–';
    });
    // Hide search tab
    const searchTab = document.getElementById('dj-tab-search');
    if (searchTab) searchTab.style.display = 'none';
  } else {
    if (searchPanel) searchPanel.style.display = '';
    const searchTab = document.getElementById('dj-tab-search');
    if (searchTab) searchTab.style.display = '';
    document.getElementById('dj-search').disabled = false;
  }
}

async function djDoSearch() {
  const q = document.getElementById('dj-search').value.trim();
  const container = document.getElementById('dj-search-results');
  if (!q) { container.innerHTML = ''; return; }

  try {
    const res = await fetch(`/quiz/api/builder/search?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    container.innerHTML = '';

    // Albums
    if (data.albums?.length) {
      const hdr = document.createElement('div');
      hdr.style.cssText = 'padding:6px 10px;font-size:11px;color:var(--dimmer);font-weight:600;text-transform:uppercase;letter-spacing:1px';
      hdr.textContent = 'Albums';
      container.appendChild(hdr);

      for (const a of data.albums) {
        const wrapper = document.createElement('div');
        const row = document.createElement('div');
        row.className = 'dj-track-row';
        row.style.cursor = 'pointer';
        row.innerHTML = `
          ${a.artworkUrl ? `<img src="${a.artworkUrl}" alt="">` : ''}
          <div class="dj-track-info">
            <div class="dj-track-name">${a.name}</div>
            <div class="dj-track-artist">${a.artistName} · ${a.trackCount} tracks</div>
          </div>
        `;
        let expanded = false;
        let tracksDiv = null;
        row.addEventListener('click', async () => {
          if (expanded) { tracksDiv?.remove(); tracksDiv = null; expanded = false; return; }
          expanded = true;
          tracksDiv = document.createElement('div');
          tracksDiv.style.cssText = 'padding:0 0 8px 54px';
          tracksDiv.innerHTML = '<div style="font-size:12px;color:var(--dimmer);padding:4px">Loading...</div>';
          wrapper.appendChild(tracksDiv);
          try {
            const res2 = await fetch(`/quiz/api/builder/album/${a.id}/tracks`);
            const data2 = await res2.json();
            tracksDiv.innerHTML = '';
            for (const t of (data2.tracks || [])) {
              tracksDiv.appendChild(createDjTrackRow(t));
            }
          } catch { tracksDiv.innerHTML = '<div style="color:var(--dimmer);font-size:12px">Failed</div>'; }
        });
        wrapper.appendChild(row);
        container.appendChild(wrapper);
      }
    }

    // Songs
    if (data.tracks?.length) {
      const hdr = document.createElement('div');
      hdr.style.cssText = 'padding:6px 10px;font-size:11px;color:var(--dimmer);font-weight:600;text-transform:uppercase;letter-spacing:1px;margin-top:4px';
      hdr.textContent = 'Songs';
      container.appendChild(hdr);
      for (const t of data.tracks) {
        container.appendChild(createDjTrackRow(t));
      }
    }
  } catch {}
}

function createDjTrackRow(t) {
  const row = document.createElement('div');
  row.className = 'dj-track-row';
  row.innerHTML = `
    ${t.artworkUrl ? `<img src="${t.artworkUrl}" alt="">` : ''}
    <div class="dj-track-info">
      <div class="dj-track-name">${t.name}</div>
      <div class="dj-track-artist">${t.artistName}</div>
    </div>
  `;
  const added = djAddedSongIds.has(t.id);
  const btn = document.createElement('button');
  btn.className = `dj-add-btn${added ? ' used' : ''}`;
  btn.innerHTML = added ? '✓' : '+';
  if (!added) {
    btn.disabled = djCredits <= 0;
    if (djCredits <= 0) btn.classList.add('used');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      // Re-check picks at click time (server also enforces this)
      if (djCredits <= 0 || djAddedSongIds.has(t.id)) return;
      djAddedSongIds.add(t.id);
      btn.classList.add('used');
      btn.disabled = true;
      btn.innerHTML = '✓';
      send({
        type: 'dj_add_song',
        songId: t.id,
        name: t.name,
        artistName: t.artistName,
        albumName: t.albumName || '',
        artworkUrl: t.artworkUrl || '',
      });
    });
  } else {
    btn.disabled = true;
  }
  row.appendChild(btn);
  return row;
}

function switchDjTab(tab) {
  document.getElementById('dj-tab-search').classList.toggle('active', tab === 'search');
  document.getElementById('dj-tab-queue').classList.toggle('active', tab === 'queue');
  document.getElementById('dj-panel-search').style.display = tab === 'search' ? '' : 'none';
  document.getElementById('dj-panel-queue').style.display = tab === 'queue' ? '' : 'none';
}

function renderDjQueue(queue, current) {
  const list = document.getElementById('dj-queue-list');
  list.innerHTML = '';
  // Filter: not played AND not the currently playing song
  const currentId = current?.id;
  const upcoming = (queue || []).filter(q => !q.played && q.id !== currentId);

  // Now Playing on queue tab
  const npDiv = document.getElementById('dj-now-playing-player');
  if (current && !current.played) {
    npDiv.style.display = '';
    document.getElementById('dj-np-art').src = current.artworkUrl || '';
    document.getElementById('dj-np-title').textContent = current.name;
    document.getElementById('dj-np-artist').textContent = current.artistName;
  } else {
    npDiv.style.display = 'none';
  }

  // Sticky mini Now Playing bar (visible on all tabs)
  const miniNp = document.getElementById('dj-mini-np');
  if (current && !current.played) {
    miniNp.style.display = '';
    document.getElementById('dj-mini-np-art').src = current.artworkUrl || '';
    document.getElementById('dj-mini-np-title').textContent = current.name;
    document.getElementById('dj-mini-np-artist').textContent = current.artistName;
    // Update Now Playing link with code
    const code = sessionStorage.getItem('djJoinCode') || '';
    const npLink = document.getElementById('dj-np-link');
    if (npLink && code) npLink.href = `/quiz/now-playing?from=dj&code=${code}`;
  } else {
    miniNp.style.display = 'none';
  }

  // Queue tab badge
  const queueTab = document.getElementById('dj-tab-queue');
  queueTab.textContent = upcoming.length > 0 ? `Queue (${upcoming.length})` : 'Queue';

  if (upcoming.length === 0) {
    list.innerHTML = '<div style="color:var(--dimmer);font-size:13px;text-align:center;padding:12px">No songs in queue yet</div>';
    return;
  }
  for (const q of upcoming) {
    const item = document.createElement('div');
    item.className = 'dj-queue-item';
    item.innerHTML = `
      ${q.artworkUrl ? `<img src="${q.artworkUrl}" alt="">` : ''}
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${q.name}</div>
        <div class="dj-who">${q.addedByAvatar} ${q.addedBy}</div>
      </div>
    `;
    list.appendChild(item);
  }
}

// ─── Wake Lock (keep screen on) ──────────────────────────

let wakeLock = null;
let noSleepVideo = null;
async function requestWakeLock() {
  // Try native Wake Lock API first
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      console.log('Screen wake lock acquired');
      // Also start video fallback — native lock can be released on tab switch
    }
  } catch {}
  // Always start invisible looping video as belt-and-suspenders for iOS Safari
  if (!noSleepVideo) {
    noSleepVideo = document.createElement('video');
    noSleepVideo.setAttribute('playsinline', '');
    noSleepVideo.setAttribute('loop', '');
    noSleepVideo.setAttribute('muted', '');
    noSleepVideo.muted = true;
    noSleepVideo.style.cssText = 'position:fixed;top:-1px;left:-1px;width:1px;height:1px;opacity:0.01';
    // Tiny base64 mp4 (silent, 1 frame)
    noSleepVideo.src = 'data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAAA0BtZGF0AAACrwYF//+r3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE1NyByMjk4MCBBYW15IC0gSC4yNjQvTVBFRy00IEFWQyBjb2RlYyAtIENvcHlsZWZ0IDIwMDMtMjAyMCAtIGh0dHA6Ly93d3cudmlkZW9sYW4ub3JnL3gyNjQuaHRtbCAtIG9wdGlvbnM6IGNhYmFjPTEgcmVmPTMgZGVibG9jaz0xOjA6MCBhbmFseXNlPTB4MzoweDExMyBtZT1oZXggc3VibWU9NyBwc3k9MSBwc3lfcmQ9MS4wMDowLjAwIG1peGVkX3JlZj0xIG1lX3JhbmdlPTE2IGNocm9tYV9tZT0xIHRyZWxsaXM9MSA4eDhkY3Q9MSBjcW09MCBkZWFkem9uZT0yMSwxMSBmYXN0X3Bza2lwPTEgY2hyb21hX3FwX29mZnNldD0tMiB0aHJlYWRzPTEgbG9va2FoZWFkX3RocmVhZHM9MSBzbGljZWRfdGhyZWFkcz0wIG5yPTAgZGVjaW1hdGU9MSBpbnRlcmxhY2VkPTAgYmx1cmF5X2NvbXBhdD0wIGNvbnN0cmFpbmVkX2ludHJhPTAgYmZyYW1lcz0zIGJfcHlyYW1pZD0yIGJfYWRhcHQ9MSBiX2JpYXM9MCBkaXJlY3Q9MSB3ZWlnaHRiPTEgb3Blbl9nb3A9MCB3ZWlnaHRwPTIga2V5aW50PTI1MCBrZXlpbnRfbWluPTEgc2NlbmVjdXQ9NDAgaW50cmFfcmVmcmVzaD0wIHJjX2xvb2thaGVhZD00MCByYz1jcmYgbWJ0cmVlPTEgY3JmPTIzLjAgcWNvbXA9MC42MCBxcG1pbj0wIHFwbWF4PTY5IHFwc3RlcD00IGlwX3JhdGlvPTEuNDAgYXE9MToxLjAwAIAAAAAMZYiEAD//8m+P5OkAAAAHQZokbEF/AAAABEGAZJG/AAAABEGAZJHAAAAABEGAZJHAAAAABEGAZJHAAAAAB0GaRCxBfwAAAARBmkQsQX8AAAABAAADAFBliIQAP//ybk/k6YAAAAALQZpELEF/AAAAMQ==';
    document.body.appendChild(noSleepVideo);
  }
  try { await noSleepVideo.play(); console.log('NoSleep video fallback active'); } catch {}
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    // Re-acquire wake lock
    requestWakeLock();
    // Reconnect WS if dead — only rejoin if player was in an active session
    const wasInSession = sessionStorage.getItem('inActiveSession') === 'true';
    if (ws?.readyState !== WebSocket.OPEN) {
      connect();
      if (wasInSession) {
        const savedName = localStorage.getItem('quizPlayerName');
        const code = new URLSearchParams(location.search).get('code');
        if (savedName && code) {
          const tryRejoin = setInterval(() => {
            if (ws?.readyState === WebSocket.OPEN) {
              clearInterval(tryRejoin);
              send({ type: 'join_session', joinCode: code.toUpperCase(), name: savedName, avatar: selectedAvatar });
            }
          }, 200);
          setTimeout(() => clearInterval(tryRejoin), 5000);
        }
      }
    }
  }
});
let isDjModeActive = false;

// ─── Register Service Worker ──────────────────────────────

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/quiz/sw.js').then(reg => {
    // Check for updates every 30s
    setInterval(() => reg.update(), 30000);
    reg.addEventListener('updatefound', () => {
      const newSW = reg.installing;
      newSW?.addEventListener('statechange', () => {
        if (newSW.state === 'activated') {
          // New version available — reload if not mid-game
          if (!sessionId) location.reload();
        }
      });
    });
  }).catch(() => {});
}

// Show PWA hint on iOS Safari (not already in standalone mode)
if (/iPhone|iPad/.test(navigator.userAgent) && !window.navigator.standalone) {
  document.getElementById('pwa-hint').style.display = '';
}

// ─── Start ────────────────────────────────────────────────

init();
