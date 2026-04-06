/**
 * Quiz Display — Self-contained quiz UI module
 *
 * Manages all 7 quiz screens (setup, countdown, question, evaluating,
 * reveal, scoreboard, final). Does NOT own a WebSocket connection —
 * receives a send function from the host page (admin.html).
 *
 * This allows quiz display to live inside admin.html without navigation,
 * so MusicKit JS never dies.
 */

const QuizDisplay = (() => {
  // ─── Dependencies (injected via init) ───────────────────
  let _send = null;       // (msg) => void — send WS message
  let _onQuizStart = null; // () => void — called when quiz overlay should show
  let _onQuizEnd = null;   // () => void — called when quiz overlay should hide
  let _showToast = null;   // (msg, type) => void — toast notification

  // ─── State ──────────────────────────────────────────────
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
  let quizActive = false;
  const players = new Map();

  // Preparing modal state
  let prepTimer = null;
  let prepStartTime = 0;

  // Custom playlists
  let allHostPlaylists = [];
  let hostPlActiveIdx = -1;

  // Audio
  let audioCtx = null;
  let quizSounds = null;

  // ─── Constants ──────────────────────────────────────────

  const GENRES = {
    "20": "alternative", "2": "blues", "5": "classical", "17": "dance",
    "7": "electronic", "18": "hip hop", "11": "jazz", "12": "latin",
    "1153": "metal", "14": "pop", "15": "r&b soul", "24": "reggae",
    "21": "rock", "10": "singer songwriter", "16": "soundtrack", "19": "world",
  };
  const GENRE_IDS = Object.keys(GENRES);

  const TYPE_LABELS = {
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
    'mixed': 'Mixed',
  };

  const BANNER_STYLE = 'margin-top:12px;margin-bottom:20px;background:rgba(252,60,68,0.1);border:1px solid rgba(252,60,68,0.3);border-radius:10px;padding:14px 16px;min-height:58px;display:flex;align-items:center;justify-content:space-between';

  // ─── Init ───────────────────────────────────────────────

  function init(options) {
    _send = options.send;
    _onQuizStart = options.onQuizStart;
    _onQuizEnd = options.onQuizEnd;
    _showToast = options.showToast || ((msg) => console.log(msg));

    // Init audio
    _initAudio();

    // Init Howler sounds
    if (typeof Howl !== 'undefined') {
      quizSounds = {
        applause: new Howl({ src: ['/quiz/sounds/applause.mp3'], volume: 0.8 }),
      };
    }

    // Init custom select dropdowns
    _initCustomSelects();

    // Check for custom quiz/event in URL
    _checkCustomQuiz();

    // Source/type change handlers
    const cfgSource = document.getElementById('qz-cfg-source');
    const cfgType = document.getElementById('qz-cfg-type');
    if (cfgSource) {
      cfgSource.addEventListener('change', (e) => {
        document.getElementById('qz-genre-container').style.display =
          e.target.value === 'charts-genre' ? '' : 'none';
      });
    }
    if (cfgType) {
      cfgType.addEventListener('change', (e) => {
        const isGossipRound = e.target.value === 'gossip';
        const gossipCheckbox = document.getElementById('qz-cfg-include-gossip');
        const gossipContainer = document.getElementById('qz-gossip-container');
        if (isGossipRound) {
          gossipCheckbox.checked = true;
          gossipContainer.style.display = 'none';
        } else {
          gossipContainer.style.display = 'flex';
        }
      });
    }
  }

  function send(msg) {
    if (_send) _send(msg);
  }

  // ─── Public: Is quiz active? ────────────────────────────

  function isActive() {
    return quizActive;
  }

  // ─── Source Mapping ─────────────────────────────────────

  function mapSource(source, genre) {
    if (source === 'charts-genre') return { source: 'charts', genre };
    if (source === 'charts-soundtrack') return { source: 'charts', genre: '16' };
    if (source === 'dansk') return { source: 'dansk', genre: undefined };
    if (source === 'random') {
      const randomGenre = GENRE_IDS[Math.floor(Math.random() * GENRE_IDS.length)];
      return { source: 'charts', genre: randomGenre };
    }
    if (source === 'mixed') return { source: 'mixed', genre: undefined };
    if (source === 'live') return { source: 'live', genre: undefined };
    return { source, genre: undefined };
  }

  // ─── Create Session ─────────────────────────────────────

  function createSession() {
    const rawSource = document.getElementById('qz-cfg-source').value;
    const rawGenre = document.getElementById('qz-cfg-genre').value;
    const { source, genre } = mapSource(rawSource, rawGenre);

    const config = {
      quizType: document.getElementById('qz-cfg-type').value,
      source,
      genre,
      questionCount: parseInt(document.getElementById('qz-cfg-count').value) || 10,
      timeLimit: parseInt(document.getElementById('qz-cfg-timer').value) || 30,
      decade: document.getElementById('qz-cfg-decade').value || undefined,
      answerMode: document.getElementById('qz-cfg-answer-mode').value,
      excludeRecentPlays: document.getElementById('qz-cfg-exclude-recent').checked,
      includeGossip: document.getElementById('qz-cfg-include-gossip').checked || document.getElementById('qz-cfg-type').value === 'gossip',
    };

    timeLimit = config.timeLimit;
    questionCount = config.questionCount;

    // Check for custom playlist
    const customPlaylist = sessionStorage.getItem('customQuizPlaylist');
    if (customPlaylist) {
      config.source = 'custom';
      config.customTracks = JSON.parse(customPlaylist);
      config.customName = sessionStorage.getItem('customQuizName') || 'Custom Quiz';
      sessionStorage.removeItem('customQuizPlaylist');
      sessionStorage.removeItem('customQuizName');
    }

    const btn = document.getElementById('qz-btn-create');
    btn.disabled = true;
    btn.textContent = 'Creating quiz...';

    // Show quiz overlay
    quizActive = true;
    if (_onQuizStart) _onQuizStart();

    send({ type: 'create_session', config });
  }

  function startGame() {
    send({ type: 'start_quiz' });
  }

  // ─── Preparing Modal ────────────────────────────────────

  function showResearchingModal() {
    let modal = document.getElementById('qz-preparing-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'qz-preparing-modal';
      modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;z-index:1000';
      document.getElementById('quiz-overlay').appendChild(modal);
    }
    modal.innerHTML = `
      <div style="background:var(--card);border-radius:20px;padding:48px 40px;text-align:center;max-width:420px;width:90%">
        <div style="font-size:32px;margin-bottom:8px">🔍</div>
        <div id="qz-prepare-title" style="font-size:22px;font-weight:800;margin-bottom:4px">Researching...</div>
        <div id="qz-prepare-subtitle" style="font-size:14px;color:var(--muted);margin-bottom:24px">Building song pool, generating trivia, fact-checking</div>
        <div style="background:var(--border);border-radius:8px;height:12px;overflow:hidden;margin-bottom:12px">
          <div id="qz-prepare-gauge" style="height:100%;background:var(--red);border-radius:8px;width:0%;transition:width 0.3s ease"></div>
        </div>
        <div style="display:flex;justify-content:center;align-items:baseline;gap:8px;margin-bottom:8px">
          <div id="qz-prepare-status" style="font-size:13px;color:var(--dimmer)">Searching Apple Music catalog...</div>
          <div id="qz-prepare-timer" style="font-size:28px;font-weight:800;color:var(--red);font-variant-numeric:tabular-nums">0s</div>
        </div>
        <button onclick="QuizDisplay.cancelPreparation()" style="margin-top:12px;background:none;border:1px solid var(--border);color:var(--muted);border-radius:8px;padding:8px 24px;font-size:13px;font-weight:600;font-family:inherit;cursor:pointer">Cancel</button>
      </div>
    `;
    modal.style.display = 'flex';
    prepStartTime = Date.now();
    if (prepTimer) clearInterval(prepTimer);
    prepTimer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - prepStartTime) / 1000);
      const el = document.getElementById('qz-prepare-timer');
      if (el) el.textContent = elapsed + 's';
    }, 1000);
  }

  function showPreparingModal(totalSongs) {
    const title = document.getElementById('qz-prepare-title');
    const subtitle = document.getElementById('qz-prepare-subtitle');
    if (title) title.textContent = 'Preparing Your Quiz';
    if (subtitle) subtitle.textContent = 'Stay ready and alert!';
    const gauge = document.getElementById('qz-prepare-gauge');
    if (gauge) gauge.style.width = '0%';
    const status = document.getElementById('qz-prepare-status');
    if (status) status.textContent = `0 of ${totalSongs} songs ready`;
    if (!document.getElementById('qz-preparing-modal')) showResearchingModal();
  }

  function updatePreparingProgress(current, total) {
    const gauge = document.getElementById('qz-prepare-gauge');
    const status = document.getElementById('qz-prepare-status');
    if (gauge) gauge.style.width = `${(current / total) * 100}%`;
    if (status) status.textContent = `${current} of ${total} songs ready`;
  }

  function hidePreparingModal() {
    if (prepTimer) { clearInterval(prepTimer); prepTimer = null; }
    const modal = document.getElementById('qz-preparing-modal');
    if (modal) modal.style.display = 'none';
  }

  function cancelPreparation() {
    hidePreparingModal();
    send({ type: 'end_quiz' });
    _exitQuiz();
  }

  // ─── Screen Management ──────────────────────────────────

  function showScreen(id) {
    document.querySelectorAll('#quiz-overlay .qz-screen').forEach(s => s.classList.remove('active'));
    const el = document.getElementById(`qz-screen-${id}`);
    if (el) el.classList.add('active');

    // Exit button visibility
    const exitBtn = document.getElementById('qz-exit-btn');
    if (exitBtn) {
      exitBtn.style.display = (id !== 'setup' && id !== 'final') ? '' : 'none';
    }
  }

  function updateRoundBadge() {
    let badge = document.getElementById('qz-round-badge');
    if (roundNumber > 0) {
      if (!badge) {
        badge = document.createElement('div');
        badge.id = 'qz-round-badge';
        badge.className = 'round-badge-fixed';
        document.getElementById('quiz-overlay').appendChild(badge);
      }
      badge.textContent = `Round ${roundNumber}`;
      badge.style.display = (currentGameState === 'setup') ? 'none' : '';
    } else if (badge) {
      badge.style.display = 'none';
    }
  }

  // ─── Message Handler ────────────────────────────────────

  function handleMessage(msg) {
    switch (msg.type) {
      case 'researching':
        showResearchingModal();
        return true;
      case 'preparing':
        showPreparingModal(msg.totalSongs);
        return true;
      case 'prepare_progress':
        updatePreparingProgress(msg.current, msg.total);
        return true;
      case 'session_created':
        hidePreparingModal();
        onSessionCreated(msg);
        return true;
      case 'player_joined':
        onPlayerJoined(msg.player);
        return true;
      case 'player_left':
        onPlayerLeft(msg.playerId, msg.playerName);
        return true;
      case 'game_state':
        onGameState(msg);
        return true;
      case 'answer_received':
        onAnswerReceived(msg);
        return true;
      case 'evaluating_answers':
        showScreen('evaluating');
        return true;
      case 'question_results':
        _patchPlayerScores(msg);
        onQuestionResults(msg);
        return true;
      case 'final_results':
        currentGameState = 'finished';
        onFinalResults(msg.rankings);
        return true;
      case 'error':
        if (quizActive) {
          _showToast(msg.message, 'error');
          const btn = document.getElementById('qz-btn-create');
          if (btn) { btn.disabled = false; btn.textContent = 'Create Game'; }
          return true;
        }
        return false;
    }
    return false; // not handled
  }

  // ─── Session Created ────────────────────────────────────

  function onSessionCreated(msg) {
    sessionId = msg.sessionId;
    joinCode = msg.joinCode;
    if (msg.partyId) partyId = msg.partyId;
    if (msg.roundNumber) roundNumber = msg.roundNumber;
    if (msg.muteAll) muteAll = true;
    currentGameState = 'lobby';

    // Ensure quiz overlay is visible
    quizActive = true;
    if (_onQuizStart) _onQuizStart();

    // Hide config, show lobby
    document.getElementById('qz-setup-config').style.display = 'none';

    const roundBadge = roundNumber > 0 ? `<div class="round-badge">Round ${roundNumber}</div>` : '';

    const lobby = document.getElementById('qz-lobby-view');
    lobby.style.display = '';
    lobby.innerHTML = `
      <div style="text-align:center;max-width:500px;margin:0 auto">
        ${roundBadge}
        <h1 class="setup-title">Music Quiz</h1>
        <p style="color:var(--muted);font-size:16px;margin-top:8px;margin-bottom:32px">Welcome to the lobby, where our players will join soon</p>
        <div class="qr-container" style="display:inline-block">
          <canvas id="qz-qr-canvas"></canvas>
        </div>
        <div class="join-code" style="margin-top:20px">${joinCode}</div>
        <div class="join-url">${msg.joinUrl}</div>
        <div class="players-section" style="margin-top:24px">
          <div class="players-title">Players (<span id="qz-player-count">0</span>/8)</div>
          <div class="players-grid" id="qz-players-grid"></div>
        </div>
        <button id="qz-btn-start" class="start-btn" style="margin-top:24px" disabled onclick="QuizDisplay.startGame()">Start Quiz</button>
        <button onclick="QuizDisplay.abortQuiz()" style="margin-top:12px;background:none;border:none;color:var(--dimmer);font-size:13px;font-family:inherit;cursor:pointer">Abort Quiz</button>
      </div>
    `;

    // Generate QR code
    if (typeof QRCode !== 'undefined') {
      QRCode.toCanvas(document.getElementById('qz-qr-canvas'), msg.joinUrl, {
        width: 220, margin: 0, color: { dark: '#000', light: '#fff' },
      });
    }
  }

  function abortQuiz() {
    send({ type: 'end_quiz' });
    _exitQuiz();
  }

  // ─── Player Management ──────────────────────────────────

  function onPlayerJoined(player) {
    players.set(player.id, player);
    _updatePlayersGrid();
    const startBtn = document.getElementById('qz-btn-start');
    if (startBtn) startBtn.disabled = players.size === 0;
    playInstrumentSound(player.avatar);
  }

  function onPlayerLeft(playerId) {
    players.delete(playerId);
    _updatePlayersGrid();
  }

  function _updatePlayersGrid() {
    const grid = document.getElementById('qz-players-grid');
    if (!grid) return;
    grid.innerHTML = '';
    const countEl = document.getElementById('qz-player-count');
    if (countEl) countEl.textContent = players.size;

    for (const p of players.values()) {
      const chip = document.createElement('div');
      chip.className = 'player-chip';
      chip.innerHTML = `<span>${p.avatar}</span><span>${p.name}</span>`;
      grid.appendChild(chip);
    }
  }

  // ─── Game State ─────────────────────────────────────────

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
        break; // handled by question_results
      case 'scoreboard':
        showScoreboard(msg);
        break;
      case 'finished':
        break; // handled by final_results
    }
  }

  // ─── Countdown ──────────────────────────────────────────

  function showCountdown(qNum, total, questionType) {
    showScreen('countdown');
    const numEl = document.getElementById('qz-countdown-number');
    const labelEl = document.getElementById('qz-countdown-label');
    const typeEl = document.getElementById('qz-countdown-type');
    labelEl.textContent = `Question ${qNum} of ${total}`;
    typeEl.textContent = TYPE_LABELS[questionType] || '';

    let count = 3;
    numEl.textContent = count;
    numEl.style.animation = 'none';
    void numEl.offsetHeight;
    numEl.style.animation = 'countPop 0.8s cubic-bezier(0.16, 1, 0.3, 1)';
    _playTick();

    const interval = setInterval(() => {
      count--;
      if (count <= 0) { clearInterval(interval); return; }
      numEl.textContent = count;
      numEl.style.animation = 'none';
      void numEl.offsetHeight;
      numEl.style.animation = 'countPop 0.8s cubic-bezier(0.16, 1, 0.3, 1)';
      _playTick();
    }, 1000);
  }

  // ─── Question ───────────────────────────────────────────

  function showQuestion(msg) {
    showScreen('question');
    answeredCount = 0;
    expectedCount = players.size;

    document.getElementById('qz-q-number').textContent = `Question ${msg.questionNumber} / ${msg.totalQuestions}`;
    document.getElementById('qz-q-type').textContent = TYPE_LABELS[msg.question?.questionType] || '';
    document.getElementById('qz-q-text').textContent = msg.question?.questionText || '';

    // Artwork hidden during questions
    document.getElementById('qz-artwork-container').style.display = 'none';

    // Options
    const optionsGrid = document.getElementById('qz-options-grid');
    const freeTextHint = document.getElementById('qz-free-text-hint');

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
        optionsGrid.appendChild(btn);
      });
    }

    // Preview audio fallback
    const audio = document.getElementById('qz-preview-audio');
    if (!msg.question?.homeConnected && msg.question?.previewUrl) {
      audio.src = msg.question.previewUrl;
      audio.currentTime = 0;
      audio.play().catch(() => {});
    } else {
      audio.pause();
    }

    // Timer
    _startTimer(msg.timeLimit || timeLimit);

    // Answers counter
    document.getElementById('qz-answers-counter').textContent = `0 / ${expectedCount} answered`;
  }

  // ─── Timer ──────────────────────────────────────────────

  function _startTimer(seconds) {
    if (timerInterval) clearInterval(timerInterval);
    timeLeft = seconds;
    const circumference = 2 * Math.PI * 36;

    const progress = document.getElementById('qz-timer-progress');
    const text = document.getElementById('qz-timer-text');

    progress.style.strokeDasharray = circumference;
    progress.style.strokeDashoffset = '0';
    text.textContent = timeLeft;

    timerInterval = setInterval(() => {
      timeLeft--;
      if (timeLeft <= 0) { clearInterval(timerInterval); timeLeft = 0; }
      const offset = circumference * (1 - timeLeft / seconds);
      progress.style.strokeDashoffset = offset;
      text.textContent = timeLeft;
    }, 1000);
  }

  // ─── Answer Received ────────────────────────────────────

  function onAnswerReceived(msg) {
    answeredCount = msg.total;
    expectedCount = msg.expected;
    document.getElementById('qz-answers-counter').textContent = `${answeredCount} / ${expectedCount} answered`;
  }

  // ─── Question Results / Reveal ──────────────────────────

  function _patchPlayerScores(msg) {
    for (const r of msg.results) {
      const p = players.get(r.playerId);
      if (p) { p._score = r.totalScore; p._streak = r.streak; }
    }
  }

  function onQuestionResults(msg) {
    if (timerInterval) clearInterval(timerInterval);
    const audio = document.getElementById('qz-preview-audio');
    if (audio) audio.pause();
    showScreen('reveal');

    const q = msg.question;

    if (q.isTrivia) {
      document.getElementById('qz-reveal-song').textContent = q.correctAnswer || '';
      document.getElementById('qz-reveal-artist').textContent = q.artistName ? `About: ${q.artistName}` : '';
      document.getElementById('qz-reveal-album').textContent = '';
    } else {
      document.getElementById('qz-reveal-song').textContent = q.songName || q.correctAnswer || '';
      document.getElementById('qz-reveal-artist').textContent = q.artistName || '';
      document.getElementById('qz-reveal-album').textContent = q.albumName ? `${q.albumName} (${q.releaseYear || ''})` : '';
    }

    if (q.artworkUrl) {
      document.getElementById('qz-reveal-artwork').src = q.artworkUrl;
      document.getElementById('qz-reveal-artwork-box').style.display = '';
    } else {
      document.getElementById('qz-reveal-artwork-box').style.display = 'none';
    }

    // Fun fact
    const funFactEl = document.getElementById('qz-fun-fact');
    if (funFactEl) {
      if (q.funFact) { funFactEl.textContent = '💡 ' + q.funFact; funFactEl.style.display = ''; }
      else { funFactEl.style.display = 'none'; }
    }

    // Results grid
    const grid = document.getElementById('qz-results-grid');
    grid.innerHTML = '';
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

  // ─── Scoreboard ─────────────────────────────────────────

  function showScoreboard() {
    showScreen('scoreboard');
    const sorted = [...players.values()]
      .map(p => ({ ...p, score: p._score || 0, streak: p._streak || 0 }))
      .sort((a, b) => b.score - a.score);

    const list = document.getElementById('qz-scoreboard-list');
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

  // ─── Final Results ──────────────────────────────────────

  function onFinalResults(rankings) {
    if (timerInterval) clearInterval(timerInterval);
    showScreen('final');
    _playApplause();

    const podium = document.getElementById('qz-podium');
    podium.innerHTML = '';

    // Reorder: 2nd, 1st, 3rd
    const placeClasses = rankings.length >= 3
      ? ['second', 'first', 'third']
      : rankings.length === 2
      ? ['second', 'first']
      : ['first'];

    const displayOrder = rankings.length >= 3
      ? [rankings[1], rankings[0], rankings[2]].filter(Boolean)
      : rankings.length === 2
      ? [rankings[1], rankings[0]]
      : [rankings[0]];

    displayOrder.forEach((r, i) => {
      if (!r) return;
      const credits = r.creditsEarned || 0;
      const place = document.createElement('div');
      place.className = `podium-place ${placeClasses[i]}`;
      place.innerHTML = `
        <div class="podium-block">
          <div class="podium-avatar">${r.avatar}</div>
          <div class="podium-name">${r.playerName}</div>
          <div class="podium-score">${r.totalScore}</div>
          <div class="podium-credits">${credits} song credit${credits !== 1 ? 's' : ''} earned</div>
        </div>
      `;
      podium.appendChild(place);
    });

    // Full stats
    const stats = document.getElementById('qz-final-stats');
    stats.innerHTML = '';
    for (const r of rankings) {
      const row = document.createElement('div');
      row.className = 'score-row';
      const rankClass = r.rank === 1 ? 'gold' : r.rank === 2 ? 'silver' : r.rank === 3 ? 'bronze' : '';
      const credits = r.creditsEarned || 0;
      row.innerHTML = `
        <span class="score-rank ${rankClass}">${r.rank}</span>
        <span class="score-avatar">${r.avatar}</span>
        <span class="score-name">${r.playerName}</span>
        <span style="color:var(--muted);font-size:14px">${r.correctAnswers}/${r.totalAnswers} correct · streak ${r.longestStreak} · avg ${(r.averageTimeMs / 1000).toFixed(1)}s</span>
        <span style="color:var(--green);font-size:14px;font-weight:600">${credits} song credit${credits !== 1 ? 's' : ''}</span>
        <span class="score-points">${r.totalScore}</span>
      `;
      stats.appendChild(row);
    }

    // Confetti
    _launchConfetti();
  }

  // ─── Confetti ───────────────────────────────────────────

  function _launchConfetti() {
    const container = document.getElementById('qz-confetti');
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

  // ─── Exit Quiz ──────────────────────────────────────────

  async function exitGame() {
    if (await _confirm('End the quiz for all players?')) {
      send({ type: 'end_quiz' });
    }
  }

  function _exitQuiz() {
    quizActive = false;
    sessionId = null;
    joinCode = null;
    players.clear();
    currentGameState = 'setup';

    // Reset setup form
    const btn = document.getElementById('qz-btn-create');
    if (btn) { btn.disabled = false; btn.textContent = 'Create Game'; }
    const config = document.getElementById('qz-setup-config');
    if (config) config.style.display = '';
    const lobby = document.getElementById('qz-lobby-view');
    if (lobby) lobby.style.display = 'none';

    showScreen('setup');
    if (_onQuizEnd) _onQuizEnd();
  }

  /** Return to admin after final screen */
  function backToAdmin() {
    _exitQuiz();
  }

  function _confirm(msg) {
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

  // ─── Keyboard Shortcuts ─────────────────────────────────

  // Backdrop click closes playlist modal
  document.addEventListener('click', (e) => {
    if (e.target?.id === 'qz-load-quiz-modal') {
      e.target.style.display = 'none';
    }
  });

  document.addEventListener('keydown', (e) => {
    if (!quizActive) return;

    // ESC closes playlist modal first
    const plModal = document.getElementById('qz-load-quiz-modal');
    if (e.key === 'Escape' && plModal?.style.display === 'flex') {
      plModal.style.display = 'none';
      return;
    }

    // ESC during prep → cancel
    if (e.key === 'Escape' && document.getElementById('qz-preparing-modal')?.style.display === 'flex') {
      cancelPreparation();
      return;
    }

    if (e.code === 'Space') {
      e.preventDefault();
      const startBtn = document.getElementById('qz-btn-start');
      if (startBtn && startBtn.style.display !== 'none' && !startBtn.disabled) {
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

  // ─── Audio ──────────────────────────────────────────────

  function _initAudio() {
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
  }

  function _playTick() {
    if (muteAll) return;
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.frequency.value = 880; osc.type = 'sine';
    gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);
    osc.start(audioCtx.currentTime); osc.stop(audioCtx.currentTime + 0.15);
  }

  function _playApplause() {
    if (muteAll) return;
    quizSounds?.applause?.play();
  }

  // ─── Instrument Sounds ──────────────────────────────────

  function playInstrumentSound(avatar) {
    if (muteAll) return;
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const t = audioCtx.currentTime;

    const instruments = {
      '🎸': _playGuitar, '🎤': _playMic, '🎹': _playPiano, '🥁': _playDrums,
      '🎺': _playTrumpet, '🎻': _playViolin, '🎷': _playSax, '🪘': _playConga,
      '🪗': _playAccordion, '🎧': _playHeadphones, '🪈': _playFlute, '🪇': _playMaracas,
    };
    (instruments[avatar] || _playDefaultChime)(t);
  }

  function _playGuitar(t) {
    [329, 415, 494, 659].forEach((freq, i) => {
      const osc = audioCtx.createOscillator(); const gain = audioCtx.createGain();
      osc.connect(gain); gain.connect(audioCtx.destination); osc.type = 'triangle'; osc.frequency.value = freq;
      const s = t + i * 0.04; gain.gain.setValueAtTime(0.2, s); gain.gain.exponentialRampToValueAtTime(0.001, s + 0.6);
      osc.start(s); osc.stop(s + 0.6);
    });
  }
  function _playMic(t) {
    [880, 660].forEach((freq, i) => {
      const osc = audioCtx.createOscillator(); const gain = audioCtx.createGain();
      osc.connect(gain); gain.connect(audioCtx.destination); osc.type = 'sine'; osc.frequency.value = freq;
      const s = t + i * 0.2; gain.gain.setValueAtTime(0.25, s); gain.gain.exponentialRampToValueAtTime(0.001, s + 0.4);
      osc.start(s); osc.stop(s + 0.4);
    });
  }
  function _playPiano(t) {
    [262, 330, 392, 523].forEach(freq => {
      const osc = audioCtx.createOscillator(); const gain = audioCtx.createGain();
      osc.connect(gain); gain.connect(audioCtx.destination); osc.type = 'sine'; osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.2, t); gain.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
      osc.start(t); osc.stop(t + 0.8);
    });
  }
  function _playDrums(t) {
    const buf = audioCtx.createBuffer(1, audioCtx.sampleRate * 0.15, audioCtx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / 1500);
    const src = audioCtx.createBufferSource(); src.buffer = buf;
    const hp = audioCtx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2000;
    const gain = audioCtx.createGain(); gain.gain.setValueAtTime(0.4, t);
    src.connect(hp); hp.connect(gain); gain.connect(audioCtx.destination); src.start(t);
    const kick = audioCtx.createOscillator(); const kg = audioCtx.createGain();
    kick.connect(kg); kg.connect(audioCtx.destination);
    kick.frequency.setValueAtTime(150, t); kick.frequency.exponentialRampToValueAtTime(50, t + 0.1);
    kg.gain.setValueAtTime(0.4, t); kg.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    kick.start(t); kick.stop(t + 0.15);
  }
  function _playTrumpet(t) {
    [523, 784].forEach((freq, i) => {
      const osc = audioCtx.createOscillator(); const gain = audioCtx.createGain();
      osc.connect(gain); gain.connect(audioCtx.destination); osc.type = 'square'; osc.frequency.value = freq;
      const s = t + i * 0.15; gain.gain.setValueAtTime(0, s); gain.gain.linearRampToValueAtTime(0.12, s + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, s + 0.3); osc.start(s); osc.stop(s + 0.3);
    });
  }
  function _playViolin(t) {
    const osc = audioCtx.createOscillator(); const gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination); osc.type = 'sawtooth'; osc.frequency.value = 660;
    gain.gain.setValueAtTime(0.2, t); gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    osc.start(t); osc.stop(t + 0.3);
  }
  function _playSax(t) {
    [349, 440].forEach((freq, i) => {
      const osc = audioCtx.createOscillator(); const gain = audioCtx.createGain();
      osc.connect(gain); gain.connect(audioCtx.destination); osc.type = 'square'; osc.frequency.value = freq;
      const s = t + i * 0.12; gain.gain.setValueAtTime(0, s); gain.gain.linearRampToValueAtTime(0.1, s + 0.03);
      gain.gain.setValueAtTime(0.1, s + 0.15); gain.gain.exponentialRampToValueAtTime(0.001, s + 0.35);
      osc.start(s); osc.stop(s + 0.35);
    });
  }
  function _playConga(t) {
    const osc = audioCtx.createOscillator(); const gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.frequency.setValueAtTime(200, t); osc.frequency.exponentialRampToValueAtTime(80, t + 0.12);
    gain.gain.setValueAtTime(0.35, t); gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    osc.start(t); osc.stop(t + 0.2);
  }
  function _playAccordion(t) {
    [262, 330, 392].forEach(freq => {
      const osc = audioCtx.createOscillator(); const gain = audioCtx.createGain();
      osc.connect(gain); gain.connect(audioCtx.destination); osc.type = 'sawtooth'; osc.frequency.value = freq;
      osc.frequency.setValueAtTime(freq, t); osc.frequency.linearRampToValueAtTime(freq * 1.01, t + 0.3);
      gain.gain.setValueAtTime(0, t); gain.gain.linearRampToValueAtTime(0.08, t + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5); osc.start(t); osc.stop(t + 0.5);
    });
  }
  function _playHeadphones(t) {
    const osc = audioCtx.createOscillator(); const gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination); osc.type = 'sine';
    osc.frequency.setValueAtTime(1200, t); osc.frequency.exponentialRampToValueAtTime(400, t + 0.15);
    gain.gain.setValueAtTime(0.2, t); gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    osc.start(t); osc.stop(t + 0.2);
  }
  function _playFlute(t) {
    const osc = audioCtx.createOscillator(); const gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination); osc.type = 'sine'; osc.frequency.value = 784;
    gain.gain.setValueAtTime(0, t); gain.gain.linearRampToValueAtTime(0.15, t + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4); osc.start(t); osc.stop(t + 0.4);
  }
  function _playMaracas(t) {
    const buf = audioCtx.createBuffer(1, audioCtx.sampleRate * 0.08, audioCtx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 + Math.sin(i / 30) * 0.5);
    const src = audioCtx.createBufferSource(); src.buffer = buf;
    const bp = audioCtx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 5000; bp.Q.value = 1;
    const gain = audioCtx.createGain(); gain.gain.setValueAtTime(0.25, t);
    src.connect(bp); bp.connect(gain); gain.connect(audioCtx.destination); src.start(t);
  }
  function _playDefaultChime(t) {
    [523, 659, 784, 1047].forEach((freq, i) => {
      const osc = audioCtx.createOscillator(); const gain = audioCtx.createGain();
      osc.connect(gain); gain.connect(audioCtx.destination); osc.frequency.value = freq; osc.type = 'triangle';
      const s = t + i * 0.08; gain.gain.setValueAtTime(0, s); gain.gain.linearRampToValueAtTime(0.2, s + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, s + 0.4); osc.start(s); osc.stop(s + 0.4);
    });
  }

  // ─── Custom Quiz ────────────────────────────────────────

  async function _checkCustomQuiz() {
    const params = new URLSearchParams(location.search);
    const customPlaylist = sessionStorage.getItem('customQuizPlaylist');
    const banner = document.getElementById('qz-custom-quiz-banner');
    if (!banner) return;
    banner.style.display = '';

    const eventCode = params.get('event');
    if (eventCode) {
      try {
        const evRes = await fetch('/quiz/api/events');
        const events = await evRes.json();
        const ev = events.find(e => e.joinCode === eventCode);
        if (ev) {
          const titleEl = document.getElementById('qz-setup-title');
          const subtitleEl = document.getElementById('qz-setup-subtitle');
          if (titleEl) titleEl.textContent = ev.name || 'Music Quiz';
          const roundsLabel = ev.maxRounds ? ev.maxRounds + ' rounds' : 'Free (unlimited)';
          const dateLabel = ev.scheduledAt ? new Date(ev.scheduledAt).toLocaleDateString('da-DK', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : '';
          if (subtitleEl) subtitleEl.textContent = [dateLabel, roundsLabel].filter(Boolean).join(' · ');

          if (ev.playlistId) {
            const plRes = await fetch('/quiz/api/builder/playlists/' + ev.playlistId);
            const pl = await plRes.json();
            if (pl.tracks && pl.tracks.length > 0) {
              sessionStorage.setItem('customQuizPlaylist', JSON.stringify(pl.tracks));
              sessionStorage.setItem('customQuizName', pl.name);
              _showCustomLoaded(pl.tracks, pl.name);
              return;
            }
          }
          _showCustomEmpty();
          return;
        }
      } catch {}
    }

    if (params.get('source') === 'custom' && customPlaylist) {
      _showCustomLoaded(JSON.parse(customPlaylist), sessionStorage.getItem('customQuizName') || 'Custom Quiz');
    } else {
      _showCustomEmpty();
    }
  }

  function _showCustomEmpty() {
    const banner = document.getElementById('qz-custom-quiz-banner');
    if (!banner) return;
    banner.style.cssText = BANNER_STYLE;
    banner.innerHTML = `
      <div>
        <div style="font-size:14px;font-weight:600;color:var(--dimmer)">No playlist loaded</div>
        <div style="font-size:12px;color:var(--dimmer);margin-top:2px">Using source settings below</div>
      </div>
      <button onclick="QuizDisplay.loadCustomQuiz()" style="font-size:13px;color:var(--red);background:none;border:none;font-weight:600;font-family:inherit;cursor:pointer;white-space:nowrap">Playlists</button>
    `;
    const srcItem = document.getElementById('qz-cfg-source')?.closest('.config-item');
    const decItem = document.getElementById('qz-cfg-decade')?.closest('.config-item');
    if (srcItem) { srcItem.style.opacity = ''; srcItem.style.pointerEvents = ''; }
    if (decItem) { decItem.style.opacity = ''; decItem.style.pointerEvents = ''; }
  }

  function _showCustomLoaded(tracks, name) {
    const banner = document.getElementById('qz-custom-quiz-banner');
    if (!banner) return;
    banner.style.cssText = BANNER_STYLE;
    banner.innerHTML = `
      <div>
        <div style="font-size:14px;font-weight:600;color:var(--red)">${name}</div>
        <div style="font-size:12px;color:var(--muted);margin-top:2px">${tracks.length} tracks in pool</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <button onclick="QuizDisplay.loadCustomQuiz()" style="font-size:12px;color:var(--muted);background:none;border:none;font-family:inherit;cursor:pointer">Change</button>
        <button onclick="QuizDisplay.clearCustomQuiz()" style="font-size:11px;color:var(--red);background:rgba(252,60,68,0.1);border:1px solid rgba(252,60,68,0.2);border-radius:999px;padding:4px 12px;font-family:inherit;cursor:pointer;font-weight:600">Clear</button>
      </div>
    `;
    const srcItem = document.getElementById('qz-cfg-source')?.closest('.config-item');
    const decItem = document.getElementById('qz-cfg-decade')?.closest('.config-item');
    if (srcItem) { srcItem.style.opacity = '0.3'; srcItem.style.pointerEvents = 'none'; }
    if (decItem) { decItem.style.opacity = '0.3'; decItem.style.pointerEvents = 'none'; }
    document.getElementById('qz-genre-container').style.display = 'none';
    const countEl = document.getElementById('qz-cfg-count');
    if (countEl) { countEl.max = tracks.length; countEl.value = Math.min(3, tracks.length); }
  }

  async function loadCustomQuiz() {
    const modal = document.getElementById('qz-load-quiz-modal');
    const list = document.getElementById('qz-saved-list');
    const searchInput = document.getElementById('qz-pl-search');
    modal.style.display = 'flex';
    if (searchInput) { searchInput.value = ''; searchInput.focus(); }

    try {
      const res = await fetch('/quiz/api/builder/playlists');
      allHostPlaylists = await res.json();
      _renderHostPlaylists('');
    } catch {
      list.innerHTML = '<div style="padding:40px;text-align:center;color:var(--dimmer)">Failed to load</div>';
    }
  }

  function _renderHostPlaylists(filter) {
    const list = document.getElementById('qz-saved-list');
    const filtered = filter
      ? allHostPlaylists.filter(p => p.name.toLowerCase().includes(filter.toLowerCase()))
      : allHostPlaylists;

    if (filtered.length === 0) {
      list.innerHTML = '<div style="padding:40px;text-align:center;color:var(--dimmer)">' +
        (allHostPlaylists.length === 0 ? 'No playlists yet.' : 'No playlists match "' + filter + '"') + '</div>';
      return;
    }

    list.innerHTML = '';
    for (const pl of filtered) {
      const arts = pl.tracks.slice(0, 4).map(t => t.artworkUrl).filter(Boolean);
      const item = document.createElement('div');
      item.style.cssText = 'display:flex;align-items:center;gap:14px;padding:10px 14px;border-radius:10px;cursor:pointer;transition:background 0.15s';
      item.onmouseover = () => item.style.background = 'rgba(255,255,255,0.06)';
      item.onmouseout = () => item.style.background = '';

      const artHtml = arts.length > 0
        ? '<div style="width:52px;height:52px;border-radius:8px;overflow:hidden;display:grid;grid-template-columns:1fr 1fr;gap:1px;flex-shrink:0;background:var(--border)">' +
          arts.map(u => '<img src="' + u + '" style="width:100%;height:100%;object-fit:cover">').join('') + '</div>'
        : '<div style="width:52px;height:52px;border-radius:8px;background:var(--border);display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0">🎵</div>';

      item.innerHTML = artHtml +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + pl.name + '</div>' +
          '<div style="font-size:12px;color:var(--dimmer)">' + pl.tracks.length + ' tracks</div>' +
        '</div><span style="color:var(--dimmer);font-size:18px">→</span>';
      item.addEventListener('click', () => {
        sessionStorage.setItem('customQuizPlaylist', JSON.stringify(pl.tracks));
        sessionStorage.setItem('customQuizName', pl.name);
        document.getElementById('qz-load-quiz-modal').style.display = 'none';
        _showCustomLoaded(pl.tracks, pl.name);
      });
      list.appendChild(item);
    }
  }

  function clearCustomQuiz() {
    sessionStorage.removeItem('customQuizPlaylist');
    sessionStorage.removeItem('customQuizName');
    _showCustomEmpty();
  }

  // ─── Custom Select Dropdowns ────────────────────────────

  function _initCustomSelects() {
    document.querySelectorAll('#quiz-overlay select.config-select').forEach(select => {
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

      select.after(wrapper);
      wrapper.appendChild(select);
      wrapper.appendChild(trigger);
      wrapper.appendChild(optionsList);
    });

    document.addEventListener('click', () => {
      document.querySelectorAll('#quiz-overlay .custom-select.open').forEach(s => s.classList.remove('open'));
    });
  }

  // ─── Public API ─────────────────────────────────────────

  return {
    init,
    handleMessage,
    isActive,
    createSession,
    startGame,
    abortQuiz,
    exitGame,
    backToAdmin,
    cancelPreparation,
    loadCustomQuiz,
    clearCustomQuiz,
  };
})();
