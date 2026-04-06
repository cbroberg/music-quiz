/**
 * Host UI — Client-side logic
 * Connects to /quiz-ws WebSocket, manages all 7 screens.
 */

// ─── Fullscreen ──────────────────────────────────────────

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen().catch(() => {});
  }
}
document.addEventListener('fullscreenchange', () => {
  const icon = document.getElementById('fs-icon');
  if (!icon) return;
  if (document.fullscreenElement) {
    icon.innerHTML = '<polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/>';
  } else {
    icon.innerHTML = '<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>';
  }
});

// ─── State ────────────────────────────────────────────────

let ws = null;
let sessionId = null;
let joinCode = null;
let partyId = null;
let roundNumber = 0;
let muteAll = false;
let currentGameState = 'setup';
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

  ws.onopen = () => {
    console.log('🎮 Connected to quiz server');
  };

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
  if (source === 'mixed') return { source: 'mixed', genre: undefined };
  if (source === 'live') return { source: 'live', genre: undefined };
  return { source, genre: undefined };
}

// ─── Session Creation ─────────────────────────────────────

// ─── Preparing Songs Modal ────────────────────────────────

let prepTimer = null;
let prepStartTime = 0;

function showResearchingModal() {
  let modal = document.getElementById('preparing-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'preparing-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;z-index:1000';
    document.body.appendChild(modal);
  }
  modal.innerHTML = `
    <div style="background:var(--card);border-radius:20px;padding:48px 40px;text-align:center;max-width:420px;width:90%">
      <div style="font-size:32px;margin-bottom:8px">🔍</div>
      <div id="prepare-title" style="font-size:22px;font-weight:800;margin-bottom:4px">Researching...</div>
      <div id="prepare-subtitle" style="font-size:14px;color:var(--muted);margin-bottom:24px">Building song pool, generating trivia, fact-checking</div>
      <div style="background:var(--border);border-radius:8px;height:12px;overflow:hidden;margin-bottom:12px">
        <div id="prepare-gauge" style="height:100%;background:var(--red);border-radius:8px;width:0%;transition:width 0.3s ease"></div>
      </div>
      <div style="display:flex;justify-content:center;align-items:baseline;gap:8px;margin-bottom:8px">
        <div id="prepare-status" style="font-size:13px;color:var(--dimmer)">Searching Apple Music catalog...</div>
        <div id="prepare-timer" style="font-size:28px;font-weight:800;color:var(--red);font-variant-numeric:tabular-nums">0s</div>
      </div>
      <button id="prepare-cancel" onclick="cancelPreparation()" style="margin-top:12px;background:none;border:1px solid var(--border);color:var(--muted);border-radius:8px;padding:8px 24px;font-size:13px;font-weight:600;font-family:inherit;cursor:pointer">Cancel</button>
    </div>
  `;
  modal.style.display = 'flex';
  // Start countdown timer
  prepStartTime = Date.now();
  if (prepTimer) clearInterval(prepTimer);
  prepTimer = setInterval(() => {
    const elapsed = Math.floor((Date.now() - prepStartTime) / 1000);
    const el = document.getElementById('prepare-timer');
    if (el) el.textContent = elapsed + 's';
  }, 1000);
}

function showPreparingModal(totalSongs) {
  // Transition from "Researching" to "Preparing"
  const title = document.getElementById('prepare-title');
  const subtitle = document.getElementById('prepare-subtitle');
  const icon = title?.parentElement?.querySelector('div:first-child');
  if (title) title.textContent = 'Preparing Your Quiz';
  if (subtitle) subtitle.textContent = 'Stay ready and alert!';
  if (icon) icon.textContent = '🎵';
  const gauge = document.getElementById('prepare-gauge');
  if (gauge) gauge.style.width = '0%';
  const status = document.getElementById('prepare-status');
  if (status) status.textContent = `0 of ${totalSongs} songs ready`;
  // If modal doesn't exist yet (edge case), create it
  if (!document.getElementById('preparing-modal')) showResearchingModal();
}

function updatePreparingProgress(current, total) {
  const gauge = document.getElementById('prepare-gauge');
  const status = document.getElementById('prepare-status');
  if (gauge) gauge.style.width = `${(current / total) * 100}%`;
  if (status) status.textContent = `${current} of ${total} songs ready`;
}

function hidePreparingModal() {
  if (prepTimer) { clearInterval(prepTimer); prepTimer = null; }
  const modal = document.getElementById('preparing-modal');
  if (modal) modal.style.display = 'none';
}

function cancelPreparation() {
  hidePreparingModal();
  send({ type: 'end_quiz' });
  setTimeout(() => location.reload(), 300);
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.getElementById('preparing-modal')?.style.display === 'flex') {
    cancelPreparation();
  }
});

// ─── Session ─────────────────────────────────────────────

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
    includeGossip: document.getElementById('cfg-include-gossip').checked || document.getElementById('cfg-type').value === 'gossip',
  };

  timeLimit = config.timeLimit;
  questionCount = config.questionCount;
  showArtworkDuringQuestion = false;

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

// ─── Show/Hide Genre & Gossip ─────────────────────────────

document.getElementById('cfg-source').addEventListener('change', (e) => {
  document.getElementById('genre-container').style.display =
    e.target.value === 'charts-genre' ? '' : 'none';
});

document.getElementById('cfg-type').addEventListener('change', (e) => {
  const isGossipRound = e.target.value === 'gossip';
  const gossipCheckbox = document.getElementById('cfg-include-gossip');
  const gossipContainer = document.getElementById('gossip-container');
  if (isGossipRound) {
    gossipCheckbox.checked = true;
    gossipContainer.style.display = 'none'; // implicit — gossip round = all gossip
  } else {
    gossipContainer.style.display = 'flex';
  }
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

// ─── Round Badge ──────────────────────────────────────────

function updateRoundBadge() {
  let badge = document.getElementById('round-badge-fixed');
  if (roundNumber > 0) {
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'round-badge-fixed';
      badge.className = 'round-badge-fixed';
      document.body.appendChild(badge);
    }
    badge.textContent = `Round ${roundNumber}`;
    // Show during quiz and ceremony, hide during setup
    badge.style.display = (currentGameState === 'setup') ? 'none' : '';
  } else if (badge) {
    badge.style.display = 'none';
  }
}

// ─── Message Handler ──────────────────────────────────────

function handleMessage(msg) {
  switch (msg.type) {
    case 'researching':
      showResearchingModal();
      break;
    case 'preparing':
      showPreparingModal(msg.totalSongs);
      break;
    case 'prepare_progress':
      updatePreparingProgress(msg.current, msg.total);
      break;
    case 'session_created':
      hidePreparingModal();
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
      currentGameState = 'finished';
      onFinalResults(msg.rankings);
      break;
    // DJ messages ignored — DJ is in admin now
    case 'playback_command':
      handlePlaybackCommand(msg);
      break;
    case 'error':
      // Show error as toast instead of browser alert
      showHostToast(msg.message, true);
      document.getElementById('btn-create').disabled = false;
      document.getElementById('btn-create').textContent = 'Create Game';
      break;
  }
}

// ─── Session Created ──────────────────────────────────────

function onSessionCreated(msg) {
  sessionId = msg.sessionId;
  joinCode = msg.joinCode;
  if (msg.partyId) partyId = msg.partyId;
  if (msg.roundNumber) roundNumber = msg.roundNumber;
  if (msg.muteAll) muteAll = true;
  currentGameState = 'lobby';

  // Hide config, show clean lobby
  document.getElementById('setup-config').style.display = 'none';

  const roundBadge = roundNumber > 0 ? `<div class="round-badge">Round ${roundNumber}</div>` : '';

  const lobby = document.getElementById('lobby-view');
  lobby.style.display = '';
  lobby.innerHTML = `
    <div style="text-align:center;max-width:500px;margin:0 auto">
      ${roundBadge}
      <h1 class="setup-title">Music Quiz</h1>
      <p style="color:var(--muted);font-size:16px;margin-top:8px;margin-bottom:32px">Welcome to the lobby, where our players will join soon</p>
      <div class="qr-container" style="display:inline-block">
        <canvas id="qr-canvas-lobby"></canvas>
      </div>
      <div class="join-code" style="margin-top:20px">${joinCode}</div>
      <div class="join-url">${msg.joinUrl}</div>
      <div class="players-section" style="margin-top:24px">
        <div class="players-title">Players (<span id="player-count">0</span>/8)</div>
        <div class="players-grid" id="players-grid"></div>
      </div>
      <button id="btn-start" class="start-btn" style="margin-top:24px" disabled onclick="startGame()">Start Quiz</button>
      <button onclick="abortQuiz()" style="margin-top:12px;background:none;border:none;color:var(--dimmer);font-size:13px;font-family:inherit;cursor:pointer">Abort Quiz</button>
    </div>
  `;

  // Generate QR code
  QRCode.toCanvas(document.getElementById('qr-canvas-lobby'), msg.joinUrl, {
    width: 220,
    margin: 0,
    color: { dark: '#000', light: '#fff' },
  });
}

function abortQuiz() {
  send({ type: 'end_quiz' });
  location.reload();
}

// ─── Player Management ────────────────────────────────────

function onPlayerJoined(player) {
  players.set(player.id, player);
  updatePlayersGrid();
  document.getElementById('btn-start').disabled = players.size === 0;
  // Instrument sound on join
  console.log(`🎵 onPlayerJoined: ${player.name} (${player.avatar}), state=${currentGameState}, muteAll=${muteAll}`);
  playInstrumentSound(player.avatar);
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
  currentGameState = msg.state;
  if (msg.roundNumber) roundNumber = msg.roundNumber;
  updateRoundBadge();
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
    'country-of-origin': 'Where Are They From?',
    'band-members': "Who's in the Band?",
    'artist-trivia': 'Music Trivia',
    'film-soundtrack': 'Name That Movie!',
    'tv-theme': 'Name That Show!',
    'gossip': 'Celebrity Gossip!',
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
    'gossip': 'Celebrity Gossip!',
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

  // Song info — for trivia, show correct answer prominently
  if (q.isTrivia) {
    document.getElementById('reveal-song').textContent = q.correctAnswer || '';
    document.getElementById('reveal-artist').textContent = q.artistName ? `About: ${q.artistName}` : '';
    document.getElementById('reveal-album').textContent = '';
  } else {
    document.getElementById('reveal-song').textContent = q.songName || q.correctAnswer || '';
    document.getElementById('reveal-artist').textContent = q.artistName || '';
    document.getElementById('reveal-album').textContent = q.albumName ? `${q.albumName} (${q.releaseYear || ''})` : '';
  }

  if (q.artworkUrl) {
    document.getElementById('reveal-artwork').src = q.artworkUrl;
    document.getElementById('reveal-artwork-box').style.display = '';
  } else {
    document.getElementById('reveal-artwork-box').style.display = 'none';
  }

  // Fun fact callout (AI-generated trivia nugget)
  const funFactEl = document.getElementById('fun-fact');
  if (funFactEl) {
    if (q.funFact) {
      funFactEl.textContent = '💡 ' + q.funFact;
      funFactEl.style.display = '';
    } else {
      funFactEl.style.display = 'none';
    }
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
  playApplause();

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
    const picks = r.creditsEarned || 0;
    const place = document.createElement('div');
    place.className = `podium-place ${placeClasses[i]}`;
    place.innerHTML = `
      <div class="podium-block">
        <div class="podium-avatar">${r.avatar}</div>
        <div class="podium-name">${r.playerName}</div>
        <div class="podium-score">${r.totalScore}</div>
        <div class="podium-picks">${picks} song credit${picks !== 1 ? 's' : ''} earned</div>
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
    const picks = r.creditsEarned || 0;
    row.innerHTML = `
      <span class="score-rank ${rankClass}">${r.rank}</span>
      <span class="score-avatar">${r.avatar}</span>
      <span class="score-name">${r.playerName}</span>
      <span style="color:var(--muted);font-size:14px">${r.correctAnswers}/${r.totalAnswers} correct · streak ${r.longestStreak} · avg ${(r.averageTimeMs / 1000).toFixed(1)}s</span>
      <span style="color:var(--green);font-size:14px;font-weight:600">${picks} song credit${picks !== 1 ? 's' : ''}</span>
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

async function exitGame() {
  if (await hostConfirm('End the quiz for all players?')) {
    send({ type: 'end_quiz' });
    // Don't reload — let the game flow to finished/DJ Mode naturally
  }
}

function hostConfirm(msg) {
  return new Promise(resolve => {
    const dialog = document.getElementById('confirm-dialog');
    document.getElementById('confirm-msg').textContent = msg;
    dialog.style.display = 'flex';
    const ok = document.getElementById('confirm-ok');
    const cancel = document.getElementById('confirm-cancel');
    function cleanup() { dialog.style.display = 'none'; ok.onclick = null; cancel.onclick = null; }
    ok.onclick = () => { cleanup(); resolve(true); };
    cancel.onclick = () => { cleanup(); resolve(false); };
  });
}

// Show/hide exit button based on screen
const _origShowScreen = showScreen;
showScreen = function(id) {
  _origShowScreen(id);
  const exitBtn = document.getElementById('exit-btn');
  // Show exit button on quiz game screens only (not setup or final)
  exitBtn.style.display = (id !== 'setup' && id !== 'final') ? '' : 'none';
};

// ─── DJ Mode (moved to admin — host only shows quiz) ─────

// ─── Toast ────────────────────────────────────────────────

function showHostToast(msg, isError) {
  const el = document.getElementById('host-toast');
  el.textContent = msg;
  el.style.color = isError ? 'var(--red)' : 'var(--text)';
  el.style.transform = 'translateX(-50%) translateY(0)';
  setTimeout(() => { el.style.transform = 'translateX(-50%) translateY(80px)'; }, 4000);
}

// ─── Tick Sound (Web Audio API) ───────────────────────────

let audioCtx = null;

// Unlock AudioContext on first ANY interaction (click, touch, keydown)
// This is needed because browsers block audio until user interacts with page
// Without this, join sounds don't play because no click has happened yet
(function unlockAudio() {
  function unlock() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    document.removeEventListener('click', unlock);
    document.removeEventListener('touchstart', unlock);
    document.removeEventListener('keydown', unlock);
  }
  document.addEventListener('click', unlock);
  document.addEventListener('touchstart', unlock);
  document.addEventListener('keydown', unlock);
})();
function playTick() {
  if (muteAll) return;
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

// ─── Instrument Sounds (Web Audio synthesis per avatar) ───

function playInstrumentSound(avatar) {
  if (muteAll) return;
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const t = audioCtx.currentTime;

  const instruments = {
    '🎸': playGuitar,
    '🎤': playMic,
    '🎹': playPiano,
    '🥁': playDrums,
    '🎺': playTrumpet,
    '🎻': playViolin,
    '🎷': playSax,
    '🪘': playConga,
    '🪗': playAccordion,
    '🎧': playHeadphones,
    '🪈': playFlute,
    '🪇': playMaracas,
  };

  const fn = instruments[avatar] || playDefaultChime;
  fn(t);
}

function playGuitar(t) {
  // Quick strum — multiple notes with slight delay
  [329, 415, 494, 659].forEach((freq, i) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.type = 'triangle';
    osc.frequency.value = freq;
    const s = t + i * 0.04;
    gain.gain.setValueAtTime(0.2, s);
    gain.gain.exponentialRampToValueAtTime(0.001, s + 0.6);
    osc.start(s); osc.stop(s + 0.6);
  });
}

function playMic(t) {
  // Vocal-like "ding dong"
  [880, 660].forEach((freq, i) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.type = 'sine';
    osc.frequency.value = freq;
    const s = t + i * 0.2;
    gain.gain.setValueAtTime(0.25, s);
    gain.gain.exponentialRampToValueAtTime(0.001, s + 0.4);
    osc.start(s); osc.stop(s + 0.4);
  });
}

function playPiano(t) {
  // Piano chord — C major
  [262, 330, 392, 523].forEach((freq, i) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.2, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
    osc.start(t); osc.stop(t + 0.8);
  });
}

function playDrums(t) {
  // Snare hit — noise burst + low thump
  const buf = audioCtx.createBuffer(1, audioCtx.sampleRate * 0.15, audioCtx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / 1500);
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  const hp = audioCtx.createBiquadFilter();
  hp.type = 'highpass'; hp.frequency.value = 2000;
  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(0.4, t);
  src.connect(hp); hp.connect(gain); gain.connect(audioCtx.destination);
  src.start(t);
  // Low thump
  const kick = audioCtx.createOscillator();
  const kg = audioCtx.createGain();
  kick.connect(kg); kg.connect(audioCtx.destination);
  kick.frequency.setValueAtTime(150, t);
  kick.frequency.exponentialRampToValueAtTime(50, t + 0.1);
  kg.gain.setValueAtTime(0.4, t);
  kg.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
  kick.start(t); kick.stop(t + 0.15);
}

function playTrumpet(t) {
  // Brass fanfare — two short notes
  [523, 784].forEach((freq, i) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.type = 'square';
    osc.frequency.value = freq;
    const s = t + i * 0.15;
    gain.gain.setValueAtTime(0, s);
    gain.gain.linearRampToValueAtTime(0.12, s + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, s + 0.3);
    osc.start(s); osc.stop(s + 0.3);
  });
}

function playViolin(t) {
  // Pizzicato pluck — sawtooth with fast decay
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain); gain.connect(audioCtx.destination);
  osc.type = 'sawtooth';
  osc.frequency.value = 660;
  gain.gain.setValueAtTime(0.2, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
  osc.start(t); osc.stop(t + 0.3);
}

function playSax(t) {
  // Reedy tone — square wave
  [349, 440].forEach((freq, i) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.type = 'square';
    osc.frequency.value = freq;
    const s = t + i * 0.12;
    gain.gain.setValueAtTime(0, s);
    gain.gain.linearRampToValueAtTime(0.1, s + 0.03);
    gain.gain.setValueAtTime(0.1, s + 0.15);
    gain.gain.exponentialRampToValueAtTime(0.001, s + 0.35);
    osc.start(s); osc.stop(s + 0.35);
  });
}

function playConga(t) {
  // Low pitched drum slap
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain); gain.connect(audioCtx.destination);
  osc.frequency.setValueAtTime(200, t);
  osc.frequency.exponentialRampToValueAtTime(80, t + 0.12);
  gain.gain.setValueAtTime(0.35, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
  osc.start(t); osc.stop(t + 0.2);
}

function playAccordion(t) {
  // Wheezy chord
  [262, 330, 392].forEach(freq => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.type = 'sawtooth';
    osc.frequency.value = freq;
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.linearRampToValueAtTime(freq * 1.01, t + 0.3);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.08, t + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    osc.start(t); osc.stop(t + 0.5);
  });
}

function playHeadphones(t) {
  // Electronic blip
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain); gain.connect(audioCtx.destination);
  osc.type = 'sine';
  osc.frequency.setValueAtTime(1200, t);
  osc.frequency.exponentialRampToValueAtTime(400, t + 0.15);
  gain.gain.setValueAtTime(0.2, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
  osc.start(t); osc.stop(t + 0.2);
}

function playFlute(t) {
  // Light breathy tone
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain); gain.connect(audioCtx.destination);
  osc.type = 'sine';
  osc.frequency.value = 784;
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(0.15, t + 0.05);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
  osc.start(t); osc.stop(t + 0.4);
}

function playMaracas(t) {
  // Short noise shake
  const buf = audioCtx.createBuffer(1, audioCtx.sampleRate * 0.08, audioCtx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 + Math.sin(i / 30) * 0.5);
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  const bp = audioCtx.createBiquadFilter();
  bp.type = 'bandpass'; bp.frequency.value = 5000; bp.Q.value = 1;
  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(0.25, t);
  src.connect(bp); bp.connect(gain); gain.connect(audioCtx.destination);
  src.start(t);
}

function playDefaultChime(t) {
  // Musical chime — rising arpeggio
  [523, 659, 784, 1047].forEach((freq, i) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.frequency.value = freq;
    osc.type = 'triangle';
    const s = t + i * 0.08;
    gain.gain.setValueAtTime(0, s);
    gain.gain.linearRampToValueAtTime(0.2, s + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, s + 0.4);
    osc.start(s); osc.stop(s + 0.4);
  });
}

// ─── Howler Sound Manager ────────────────────────────────

const quizSounds = {
  applause: typeof Howl !== 'undefined' ? new Howl({ src: ['/quiz/sounds/applause.mp3'], volume: 0.8 }) : null,
};

function playApplause() {
  if (muteAll) return;
  quizSounds.applause?.play();
}

// ─── Load Custom Quiz ─────────────────────────────────────

let allHostPlaylists = [];

async function loadCustomQuiz() {
  const modal = document.getElementById('load-quiz-modal');
  const list = document.getElementById('host-saved-list');
  const searchInput = document.getElementById('host-pl-search');
  modal.style.display = 'flex';
  if (searchInput) { searchInput.value = ''; searchInput.focus(); }

  try {
    const res = await fetch('/quiz/api/builder/playlists');
    allHostPlaylists = await res.json();
    renderHostPlaylists('');
  } catch (err) {
    list.innerHTML = '<div style="padding:40px;text-align:center;color:var(--dimmer)">Failed to load</div>';
  }
}

function renderHostPlaylists(filter) {
  const list = document.getElementById('host-saved-list');
  const filtered = filter
    ? allHostPlaylists.filter(p => p.name.toLowerCase().includes(filter.toLowerCase()))
    : allHostPlaylists;

  if (filtered.length === 0) {
    list.innerHTML = '<div style="padding:40px;text-align:center;color:var(--dimmer)">' +
      (allHostPlaylists.length === 0 ? 'No playlists yet. Create one on the Admin page.' : 'No playlists match "' + filter + '"') + '</div>';
    return;
  }

  list.innerHTML = '';
  for (const pl of filtered) {
    const arts = pl.tracks.slice(0, 4).map(t => t.artworkUrl).filter(Boolean);
    const item = document.createElement('div');
    item.style.cssText = 'display:flex;align-items:center;gap:14px;padding:10px 14px;border-radius:10px;cursor:pointer;transition:background 0.15s';
    item.onmouseover = () => item.style.background = 'rgba(255,255,255,0.06)';
    item.onmouseout = () => item.style.background = '';

    // Artwork mosaic
    let artHtml;
    if (arts.length > 0) {
      artHtml = '<div style="width:52px;height:52px;border-radius:8px;overflow:hidden;display:grid;grid-template-columns:1fr 1fr;gap:1px;flex-shrink:0;background:var(--border)">' +
        arts.map(u => '<img src="' + u + '" style="width:100%;height:100%;object-fit:cover">').join('') + '</div>';
    } else {
      artHtml = '<div style="width:52px;height:52px;border-radius:8px;background:var(--border);display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0">🎵</div>';
    }

    item.innerHTML = artHtml +
      '<div style="flex:1;min-width:0">' +
        '<div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + pl.name + '</div>' +
        '<div style="font-size:12px;color:var(--dimmer)">' + pl.tracks.length + ' tracks · ' + new Date(pl.updatedAt).toLocaleDateString('da-DK') + '</div>' +
      '</div>' +
      '<span style="color:var(--dimmer);font-size:18px">→</span>';
    item.addEventListener('click', () => {
      sessionStorage.setItem('customQuizPlaylist', JSON.stringify(pl.tracks));
      sessionStorage.setItem('customQuizName', pl.name);
      window.location.href = '/quiz/host?source=custom';
    });
    list.appendChild(item);
  }
}

// Search filtering
document.getElementById('host-pl-search')?.addEventListener('input', (e) => {
  hostPlActiveIdx = -1;
  renderHostPlaylists(e.target.value.trim());
});

// Keyboard navigation
let hostPlActiveIdx = -1;
document.getElementById('host-pl-search')?.addEventListener('keydown', (e) => {
  const items = document.querySelectorAll('#host-saved-list > div');
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    hostPlActiveIdx = Math.min(hostPlActiveIdx + 1, items.length - 1);
    updateHostPlActive(items);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    hostPlActiveIdx = Math.max(hostPlActiveIdx - 1, 0);
    updateHostPlActive(items);
  } else if (e.key === 'Enter' && hostPlActiveIdx >= 0 && items[hostPlActiveIdx]) {
    e.preventDefault();
    items[hostPlActiveIdx].click();
  }
});

function updateHostPlActive(items) {
  items.forEach((el, i) => {
    el.style.background = i === hostPlActiveIdx ? 'rgba(255,255,255,0.06)' : '';
  });
  if (hostPlActiveIdx >= 0 && items[hostPlActiveIdx]) {
    items[hostPlActiveIdx].scrollIntoView({ block: 'nearest' });
  }
}

// Close modal on backdrop click or ESC
document.getElementById('load-quiz-modal')?.addEventListener('click', (e) => {
  if (e.target.id === 'load-quiz-modal') e.target.style.display = 'none';
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const modal = document.getElementById('load-quiz-modal');
    if (modal && modal.style.display === 'flex') modal.style.display = 'none';
  }
});

// ─── Custom Quiz Detection ────────────────────────────────

async function checkCustomQuiz() {
  const params = new URLSearchParams(location.search);
  const customPlaylist = sessionStorage.getItem('customQuizPlaylist');
  const banner = document.getElementById('custom-quiz-banner');
  banner.style.display = '';

  // Event mode: load event config + playlist
  const eventCode = params.get('event');
  if (eventCode) {
    try {
      const evRes = await fetch('/quiz/api/events');
      const events = await evRes.json();
      const ev = events.find(e => e.joinCode === eventCode);
      if (ev) {
        // Update title with event name
        const titleEl = document.querySelector('.setup-title');
        const subtitleEl = document.getElementById('setup-subtitle');
        if (titleEl) titleEl.textContent = ev.name || 'Music Quiz';
        const roundsLabel = ev.maxRounds ? ev.maxRounds + ' rounds' : 'Free (unlimited)';
        const dateLabel = ev.scheduledAt ? new Date(ev.scheduledAt).toLocaleDateString('da-DK', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : '';
        if (subtitleEl) subtitleEl.textContent = [dateLabel, roundsLabel].filter(Boolean).join(' · ');

        // Load linked playlist
        if (ev.playlistId) {
          const plRes = await fetch('/quiz/api/builder/playlists/' + ev.playlistId);
          const pl = await plRes.json();
          if (pl.tracks && pl.tracks.length > 0) {
            sessionStorage.setItem('customQuizPlaylist', JSON.stringify(pl.tracks));
            sessionStorage.setItem('customQuizName', pl.name);
            showCustomLoaded(pl.tracks, pl.name);
            return;
          }
        }
        // Event without playlist
        showCustomEmpty();
        return;
      }
    } catch {}
  }

  if (params.get('source') === 'custom' && customPlaylist) {
    showCustomLoaded(JSON.parse(customPlaylist), sessionStorage.getItem('customQuizName') || 'Custom Quiz');
  } else {
    showCustomEmpty();
  }
}

const BANNER_STYLE = 'margin-top:12px;margin-bottom:20px;background:rgba(252,60,68,0.1);border:1px solid rgba(252,60,68,0.3);border-radius:10px;padding:14px 16px;min-height:58px;display:flex;align-items:center;justify-content:space-between';

function showCustomEmpty() {
  const banner = document.getElementById('custom-quiz-banner');
  banner.style.cssText = BANNER_STYLE;
  banner.innerHTML = `
    <div>
      <div style="font-size:14px;font-weight:600;color:var(--dimmer)">No playlist loaded</div>
      <div style="font-size:12px;color:var(--dimmer);margin-top:2px">Using source settings below</div>
    </div>
    <button onclick="loadCustomQuiz()" style="font-size:13px;color:var(--red);background:none;border:none;font-weight:600;font-family:inherit;cursor:pointer;white-space:nowrap">Playlists</button>
  `;
  // Restore source selectors
  for (const el of [document.getElementById('cfg-source').closest('.config-item'), document.getElementById('cfg-decade').closest('.config-item')]) {
    el.style.opacity = '';
    el.style.pointerEvents = '';
  }
}

function showCustomLoaded(tracks, name) {
  const banner = document.getElementById('custom-quiz-banner');
  banner.style.cssText = BANNER_STYLE;
  banner.innerHTML = `
    <div>
      <div style="font-size:14px;font-weight:600;color:var(--red)">${name}</div>
      <div style="font-size:12px;color:var(--muted);margin-top:2px">${tracks.length} tracks in pool</div>
    </div>
    <div style="display:flex;align-items:center;gap:8px">
      <button onclick="loadCustomQuiz()" style="font-size:12px;color:var(--muted);background:none;border:none;font-family:inherit;cursor:pointer">Change</button>
      <button onclick="clearCustomQuiz()" style="font-size:11px;color:var(--red);background:rgba(252,60,68,0.1);border:1px solid rgba(252,60,68,0.2);border-radius:999px;padding:4px 12px;font-family:inherit;cursor:pointer;font-weight:600">Clear</button>
    </div>
  `;

  // Grey out source/genre/decade selectors
  for (const el of [document.getElementById('cfg-source').closest('.config-item'), document.getElementById('cfg-decade').closest('.config-item')]) {
    el.style.opacity = '0.3';
    el.style.pointerEvents = 'none';
  }
  document.getElementById('genre-container').style.display = 'none';

  // Set question count: default 10, max is pool size
  const countEl = document.getElementById('cfg-count');
  countEl.max = tracks.length;
  countEl.value = Math.min(3, tracks.length);
}

function clearCustomQuiz() {
  sessionStorage.removeItem('customQuizPlaylist');
  sessionStorage.removeItem('customQuizName');
  // Remove ?source=custom from URL
  history.replaceState(null, '', '/quiz/host');
  showCustomEmpty();
}

// ─── Host Now Playing state (must be declared before startHostNpUpdater) ───
let hostNpSyncPos = 0, hostNpSyncTime = 0, hostNpDuration = 0, hostNpState = 'stopped';
let hostNpLastReceivedPos = -1;

// ─── Init ─────────────────────────────────────────────────

// MusicKit state (must be declared before updateProviderStatus)
let musicKit = null;
let musicKitReady = false;
let musicKitAuthorized = false;

checkCustomQuiz();
initCustomSelects();
connect();
startHostNpUpdater();
updateProviderStatus();

// ─── Custom Select Dropdowns ──────────────────────────────

function initCustomSelects() {
  document.querySelectorAll('select.config-select').forEach(select => {
    const wrapper = document.createElement('div');
    wrapper.className = 'custom-select';

    const trigger = document.createElement('div');
    trigger.className = 'custom-select-trigger';
    trigger.textContent = select.options[select.selectedIndex]?.text || '';

    const optionsList = document.createElement('div');
    optionsList.className = 'custom-select-options';

    for (const opt of select.options) {
      const div = document.createElement('div');
      div.className = `custom-select-option${opt.selected ? ' selected' : ''}`;
      div.textContent = opt.text;
      div.dataset.value = opt.value;
      div.addEventListener('click', (e) => {
        e.stopPropagation();
        select.value = opt.value;
        select.dispatchEvent(new Event('change'));
        trigger.textContent = opt.text;
        optionsList.querySelectorAll('.custom-select-option').forEach(o => o.classList.remove('selected'));
        div.classList.add('selected');
        wrapper.classList.remove('open');
      });
      optionsList.appendChild(div);
    }

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelectorAll('.custom-select.open').forEach(s => { if (s !== wrapper) s.classList.remove('open'); });
      wrapper.classList.toggle('open');
    });

    // Replace the select in-place (keep select as hidden child for value)
    select.after(wrapper);
    wrapper.appendChild(select);
    wrapper.appendChild(trigger);
    wrapper.appendChild(optionsList);
  });

  document.addEventListener('click', () => {
    document.querySelectorAll('.custom-select.open').forEach(s => s.classList.remove('open'));
  });
}

// ─── MusicKit JS Integration ─────────────────────────────

// musicKit vars declared earlier (before updateProviderStatus call)

async function initMusicKit() {
  // Check if MusicKit JS is loaded
  if (typeof MusicKit === 'undefined') {
    console.log('🎵 MusicKit JS not loaded yet');
    return;
  }

  try {
    // Fetch developer token from server
    const res = await fetch('/quiz/api/musickit-token');
    const { token, storefront } = await res.json();

    await MusicKit.configure({
      developerToken: token,
      app: { name: 'Music Quiz', build: '3.0.0' },
    });

    musicKit = MusicKit.getInstance();
    musicKitReady = true;
    console.log('🎵 MusicKit JS initialized');

    // Check if already authorized (from previous session)
    if (musicKit.isAuthorized) {
      onMusicKitAuthorized();
    }

    updateProviderStatus();
  } catch (err) {
    console.error('🎵 MusicKit init failed:', err);
  }
}

// connectAppleMusic is now on Admin page only — Host auto-detects

function onMusicKitAuthorized() {
  musicKitAuthorized = true;
  console.log('🎵 Apple Music authorized — browser playback ready');
  updateProviderStatus();
  startMusicKitNowPlayingPush();

  // Tell server that MusicKit Web is available
  send({ type: 'set_provider', provider: 'musickit-web' });
}

// Push now-playing from MusicKit JS — event-driven + periodic sync
let mkNpPushInterval = null;

function pushHostNowPlaying() {
  if (!musicKit || !musicKitAuthorized) return;
  try {
    const stateMap = { 2: 'playing', 3: 'paused', 0: 'stopped', 1: 'loading' };
    const state = stateMap[musicKit.playbackState] || 'stopped';
    const np = musicKit.nowPlayingItem;
    if (!np && state !== 'playing') return;

    fetch('/quiz/api/now-playing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        state,
        track: np?.title,
        artist: np?.artistName,
        album: np?.albumName,
        artworkUrl: np?.artwork?.url?.replace('{w}', '600')?.replace('{h}', '600'),
        duration: musicKit.currentPlaybackDuration || 0,
        position: musicKit.currentPlaybackTime || 0,
      }),
    }).catch(() => {});
  } catch {}
}

function startMusicKitNowPlayingPush() {
  if (mkNpPushInterval) return;
  try {
    musicKit.addEventListener('playbackStateDidChange', () => pushHostNowPlaying());
    musicKit.addEventListener('nowPlayingItemDidChange', () => pushHostNowPlaying());
  } catch (e) {}
  mkNpPushInterval = setInterval(pushHostNowPlaying, 1000);
  pushHostNowPlaying();
}

function findMusicKitAudioElement() {
  // MusicKit JS creates audio/video elements internally — find the active one
  const mediaEls = [...document.querySelectorAll('audio, video')];
  for (const el of mediaEls) {
    if (el.src && !el.src.startsWith('data:') && el.webkitShowPlaybackTargetPicker) {
      return el;
    }
  }
  for (const el of mediaEls) {
    if (el.webkitShowPlaybackTargetPicker) return el;
  }
  return null;
}

function showAirPlayPicker() {
  const el = findMusicKitAudioElement();
  if (el) {
    el.webkitShowPlaybackTargetPicker();
  } else {
    showHostToast('Play a song first, then click AirPlay to select speakers', false);
  }
}

function updateProviderStatus() {
  const icon = document.getElementById('provider-icon');
  const label = document.getElementById('provider-label');
  const btn = document.getElementById('btn-connect-music');
  const setupLink = document.getElementById('provider-setup-link');
  const prov = typeof Player !== 'undefined' ? Player.getPreferredProvider() : 'home-controller';

  if (prov === 'home-controller') {
    icon.textContent = '🏠';
    label.textContent = 'Home Controller';
    label.style.color = '#5ac8fa';
    setupLink.style.display = 'none';
    btn.style.display = 'none';
  } else if (musicKitAuthorized) {
    icon.textContent = '🎵';
    label.textContent = 'Apple Music';
    label.style.color = 'var(--green)';
    setupLink.style.display = 'none';
    btn.style.display = '';
    btn.textContent = 'AirPlay';
    btn.style.borderColor = 'var(--blue)';
    btn.style.color = 'var(--blue)';
  } else if (musicKitReady) {
    icon.textContent = '🔑';
    label.textContent = 'Apple Music available';
    label.style.color = 'var(--yellow)';
    setupLink.textContent = 'Connect via Admin';
  } else {
    icon.textContent = '🏠';
    label.textContent = 'Home Controller';
    label.style.color = 'var(--muted)';
    setupLink.textContent = '';
  }
}

// ─── MusicKit JS Playback Commands (from server) ─────────

function handlePlaybackCommand(msg) {
  if (!musicKit || !musicKitAuthorized) {
    // Send failure response
    send({ type: 'playback_response', commandId: msg.commandId, result: { playing: false } });
    return;
  }

  const { command, params, commandId } = msg;

  switch (command) {
    case 'play_by_id':
      mkPlayById(params.songId, params.seekToPercent).then(result => {
        send({ type: 'playback_response', commandId, result });
      });
      break;

    case 'play_exact':
      mkPlayExact(params.name, params.artist, params.randomSeek).then(result => {
        send({ type: 'playback_response', commandId, result });
      });
      break;

    case 'search_and_play':
      mkSearchAndPlay(params.query).then(result => {
        send({ type: 'playback_response', commandId, result });
      });
      break;

    case 'pause':
      musicKit.pause();
      send({ type: 'playback_response', commandId, result: {} });
      break;

    case 'resume':
      musicKit.play().then(() => {
        send({ type: 'playback_response', commandId, result: {} });
      }).catch(() => {
        send({ type: 'playback_response', commandId, result: {} });
      });
      break;

    case 'set_volume':
      musicKit.volume = params.level; // 0-1
      send({ type: 'playback_response', commandId, result: {} });
      break;

    case 'now_playing':
      mkNowPlaying().then(result => {
        send({ type: 'playback_response', commandId, result });
      });
      break;

    case 'check_library':
      mkCheckLibrary(params.name, params.artist).then(result => {
        send({ type: 'playback_response', commandId, result });
      });
      break;

    default:
      send({ type: 'playback_response', commandId, result: null });
  }
}

async function mkPlayById(songId, seekToPercent) {
  try {
    await musicKit.setQueue({ song: songId });
    await musicKit.play();
    // Seek to position if requested
    if (seekToPercent && musicKit.currentPlaybackDuration > 0) {
      const seekTime = (seekToPercent / 100) * musicKit.currentPlaybackDuration;
      await musicKit.seekToTime(seekTime);
    }
    const np = musicKit.nowPlayingItem;
    return { playing: true, track: np?.title || songId };
  } catch (err) {
    console.error('🎵 MusicKit play failed:', err);
    return { playing: false };
  }
}

async function mkPlayExact(name, artist, randomSeek) {
  try {
    // Search for the exact song
    const query = `${name} ${artist}`;
    const results = await musicKit.api.music(`/v1/catalog/${musicKit.storefrontId || 'dk'}/search`, {
      term: query,
      types: 'songs',
      limit: 5,
    });

    const songs = results?.data?.results?.songs?.data || [];
    if (songs.length === 0) return { playing: false };

    // Find best match — exact name + artist
    const nameLower = name.toLowerCase();
    const artistLower = artist.toLowerCase();
    let bestMatch = songs[0]; // fallback to first result

    for (const s of songs) {
      const sName = (s.attributes?.name || '').toLowerCase();
      const sArtist = (s.attributes?.artistName || '').toLowerCase();
      if (sName.includes(nameLower.slice(0, 10)) && sArtist.includes(artistLower.slice(0, 10))) {
        bestMatch = s;
        break;
      }
    }

    await musicKit.setQueue({ song: bestMatch.id });
    await musicKit.play();

    // Random seek for quiz variety
    if (randomSeek) {
      // Wait for duration to be available
      await new Promise(r => setTimeout(r, 500));
      const duration = musicKit.currentPlaybackDuration;
      if (duration > 30) {
        const seekPercent = 20 + Math.random() * 50; // 20-70%
        await musicKit.seekToTime((seekPercent / 100) * duration);
      }
    }

    return { playing: true, track: `${bestMatch.attributes?.name} — ${bestMatch.attributes?.artistName}` };
  } catch (err) {
    console.error('🎵 MusicKit playExact failed:', err);
    return { playing: false };
  }
}

async function mkSearchAndPlay(query) {
  try {
    const results = await musicKit.api.music(`/v1/catalog/${musicKit.storefrontId || 'dk'}/search`, {
      term: query,
      types: 'songs',
      limit: 1,
    });
    const song = results?.data?.results?.songs?.data?.[0];
    if (!song) return { playing: false };

    await musicKit.setQueue({ song: song.id });
    await musicKit.play();
    return { playing: true, track: `${song.attributes?.name} — ${song.attributes?.artistName}` };
  } catch (err) {
    return { playing: false };
  }
}

async function mkNowPlaying() {
  try {
    const state = musicKit.playbackState;
    const stateMap = { 2: 'playing', 3: 'paused', 0: 'stopped' };
    const np = musicKit.nowPlayingItem;
    return {
      state: stateMap[state] || 'stopped',
      track: np?.title || undefined,
      artist: np?.artistName || undefined,
      position: musicKit.currentPlaybackTime || 0,
      duration: musicKit.currentPlaybackDuration || 0,
    };
  } catch {
    return { state: 'stopped' };
  }
}

async function mkCheckLibrary(name, artist) {
  try {
    const results = await musicKit.api.music(`/v1/me/library/search`, {
      term: `${name} ${artist}`,
      types: 'library-songs',
      limit: 5,
    });
    const songs = results?.data?.results?.['library-songs']?.data || [];
    const found = songs.some(s => {
      const sName = (s.attributes?.name || '').toLowerCase();
      const sArtist = (s.attributes?.artistName || '').toLowerCase();
      return sName.includes(name.toLowerCase().slice(0, 10)) &&
             sArtist.includes(artist.toLowerCase().slice(0, 10));
    });
    return { found };
  } catch {
    return { found: false };
  }
}

// ─── Host Now Playing Screen (embedded, Player-driven) ───

function startHostNpUpdater() {
  // Receive state changes from Player
  Player.onUpdate((s) => {
    if (s.position != null && Math.abs(s.position - hostNpLastReceivedPos) > 0.5) {
      hostNpSyncPos = s.position;
      hostNpSyncTime = Date.now();
      hostNpLastReceivedPos = s.position;
    }
    if (s.duration) hostNpDuration = s.duration;
    hostNpState = s.state || 'stopped';

    // Update track info
    if (s.track) {
      const artEl = document.getElementById('hnp-artwork');
      if (s.artworkUrl && artEl.src !== s.artworkUrl) artEl.src = s.artworkUrl;
      document.getElementById('hnp-track').textContent = s.track;
      document.getElementById('hnp-artist').textContent = s.artist || '';
      document.getElementById('hnp-album').textContent = s.album || '';
      document.getElementById('hnp-glow').classList.toggle('np-playing', s.state === 'playing');
      document.getElementById('hnp-vinyl').classList.toggle('np-spinning', s.state === 'playing');
    }
  });

  // Interpolate time every second
  setInterval(() => {
    const pos = hostNpState === 'playing' && hostNpSyncTime > 0
      ? Math.min(hostNpSyncPos + (Date.now() - hostNpSyncTime) / 1000, hostNpDuration)
      : hostNpSyncPos;
    const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s) % 60).padStart(2, '0')}`;
    document.getElementById('hnp-pos').textContent = fmt(pos);
    document.getElementById('hnp-dur').textContent = fmt(hostNpDuration);
    if (hostNpDuration > 0) document.getElementById('hnp-progress').style.width = `${(pos / hostNpDuration) * 100}%`;
  }, 1000);
}

// Instant render when showing NP screen
const _origShowScreenForNp = showScreen;
showScreen = function(id) {
  _origShowScreenForNp(id);
  if (id === 'np') {
    const s = Player.getState();
    if (s.track) {
      const artEl = document.getElementById('hnp-artwork');
      if (s.artworkUrl) artEl.src = s.artworkUrl;
      document.getElementById('hnp-track').textContent = s.track;
      document.getElementById('hnp-artist').textContent = s.artist || '';
      document.getElementById('hnp-album').textContent = s.album || '';
      document.getElementById('hnp-glow').classList.toggle('np-playing', s.state === 'playing');
      document.getElementById('hnp-vinyl').classList.toggle('np-spinning', s.state === 'playing');
    }
  }
};

// ─── Init MusicKit on load ───────────────────────────────

// Wait for MusicKit JS to load, then initialize
document.addEventListener('musickitloaded', () => {
  initMusicKit();
});
// Also try after a delay (in case event already fired)
setTimeout(() => {
  if (!musicKitReady && typeof MusicKit !== 'undefined') initMusicKit();
}, 3000);
