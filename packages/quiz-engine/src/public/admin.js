let currentView = 'grid';
let tracks = [];
let playingTrackName = null;
let lastSeenTrack = '';

// Auto-update Recently Played when track changes
function onTrackChanged(s) {
  if (!s.track || s.track === lastSeenTrack) return;
  lastSeenTrack = s.track;
  playingTrackName = s.track;

  // Check if already at top
  if (tracks.length > 0 && tracks[0].name === s.track && tracks[0].artistName === s.artist) {
    renderTracks();
    return;
  }

  // Prepend new track to list
  const newTrack = {
    name: s.track,
    artistName: s.artist || '',
    albumName: s.album || '',
    artworkUrl: s.artworkSmall || s.artworkUrl || '',
  };

  // Remove duplicate if exists deeper in list
  tracks = tracks.filter(t => !(t.name === newTrack.name && t.artistName === newTrack.artistName));
  tracks.unshift(newTrack);
  document.getElementById('track-count').textContent = tracks.length;
  renderTracks();
}

// Called from admin.html's Player.onUpdate callback
// (only one onUpdate callback allowed, so admin.html calls this)

async function loadTracks() {
  document.getElementById('loading').style.display = '';
  document.getElementById('empty').style.display = 'none';

  try {
    const res = await fetch('/quiz/api/admin/recent-tracks');
    const data = await res.json();
    tracks = data.tracks || [];
    document.getElementById('track-count').textContent = tracks.length;
    document.getElementById('loading').style.display = 'none';

    if (tracks.length === 0) {
      document.getElementById('empty').style.display = '';
      return;
    }

    renderTracks();
  } catch (err) {
    document.getElementById('loading').textContent = 'Failed to load tracks';
  }
}

function renderTracks() {
  const container = document.getElementById('tracks-container');
  container.className = currentView === 'grid' ? 'tracks-grid' : 'tracks-list';
  container.innerHTML = '';

  for (const t of tracks) {
    const artUrl = t.artworkUrl || '';

    const isPlaying = playingTrackName === t.name;
    const idx = tracks.indexOf(t);

    if (currentView === 'grid') {
      const card = document.createElement('div');
      card.className = `track-card-grid${isPlaying ? ' playing' : ''}`;
      const wrap = document.createElement('div');
      wrap.className = 'artwork-wrap';
      if (artUrl) {
        const img = document.createElement('img');
        img.className = 'artwork'; img.src = artUrl; img.loading = 'lazy';
        wrap.appendChild(img);
      } else {
        const ph = document.createElement('div'); ph.className = 'artwork';
        wrap.appendChild(ph);
      }
      const btn = document.createElement('button');
      btn.className = 'play-btn'; btn.innerHTML = '&#9654;';
      btn.addEventListener('click', () => playTrack(t.name, t.artistName, t.id));
      wrap.appendChild(btn);
      if (isPlaying) {
        const ind = document.createElement('div');
        ind.className = 'play-indicator'; ind.innerHTML = '&#9654;';
        wrap.appendChild(ind);
      }
      card.appendChild(wrap);
      const info = document.createElement('div'); info.className = 'info';
      info.innerHTML = `<div class="track-name">${t.name}</div><div class="artist-name">${t.artistName}</div><div class="album-name">${t.albumName}</div>`;
      card.appendChild(info);
      // Favorite heart + context menu
      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'grid-fav';
      actionsDiv.style.cssText = 'display:flex;align-items:center;gap:4px';
      if (typeof favBtnHtml === 'function') actionsDiv.innerHTML = favBtnHtml(t);
      const moreBtn = document.createElement('button');
      moreBtn.className = 'song-row-more';
      moreBtn.textContent = '···';
      moreBtn.style.cssText = 'background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.3);color:#fff;border-radius:8px;width:32px;height:32px;font-size:14px;font-weight:700;cursor:pointer;letter-spacing:2px;display:flex;align-items:center;justify-content:center;transition:background 0.15s';
      moreBtn.onmouseenter = () => { moreBtn.style.background = 'rgba(252,60,68,0.25)'; };
      moreBtn.onmouseleave = () => { moreBtn.style.background = 'rgba(255,255,255,0.1)'; };
      moreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const track = { id: t.id || '', name: t.name, artistName: t.artistName, albumName: t.albumName || '', artworkUrl: t.artworkUrl || '', releaseYear: t.releaseYear || '' };
        if (typeof showSongContextMenu === 'function') showSongContextMenu(e, track);
        else if (typeof showSongContextMenuAt === 'function') showSongContextMenuAt(e.clientX, e.clientY, track);
      });
      actionsDiv.appendChild(moreBtn);
      card.appendChild(actionsDiv);
      container.appendChild(card);
    } else {
      const row = document.createElement('div');
      row.className = `track-card-list${isPlaying ? ' playing' : ''}`;
      const wrap = document.createElement('div');
      wrap.className = 'artwork-wrap';
      if (artUrl) {
        const img = document.createElement('img');
        img.className = 'artwork'; img.src = artUrl; img.loading = 'lazy';
        wrap.appendChild(img);
      } else {
        const ph = document.createElement('div'); ph.className = 'artwork';
        wrap.appendChild(ph);
      }
      const btn = document.createElement('button');
      btn.className = 'play-btn-list'; btn.innerHTML = '&#9654;';
      btn.addEventListener('click', () => playTrack(t.name, t.artistName, t.id));
      wrap.appendChild(btn);
      row.appendChild(wrap);
      const info = document.createElement('div'); info.className = 'info';
      info.innerHTML = `<div class="track-name">${t.name}</div><div class="artist-name">${t.artistName}</div><div class="album-name">${t.albumName}</div>`;
      row.appendChild(info);
      // Favorite heart + context menu (list view)
      const actionsDiv = document.createElement('div');
      actionsDiv.style.cssText = 'display:flex;align-items:center;gap:4px';
      if (typeof favBtnHtml === 'function') actionsDiv.innerHTML = favBtnHtml(t);
      const moreBtn = document.createElement('button');
      moreBtn.className = 'song-row-more';
      moreBtn.textContent = '···';
      moreBtn.style.cssText = 'background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.3);color:#fff;border-radius:8px;width:32px;height:32px;font-size:14px;font-weight:700;cursor:pointer;letter-spacing:2px;display:flex;align-items:center;justify-content:center;transition:background 0.15s';
      moreBtn.onmouseenter = () => { moreBtn.style.background = 'rgba(252,60,68,0.25)'; };
      moreBtn.onmouseleave = () => { moreBtn.style.background = 'rgba(255,255,255,0.1)'; };
      moreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const track = { id: t.id || '', name: t.name, artistName: t.artistName, albumName: t.albumName || '', artworkUrl: t.artworkUrl || '', releaseYear: t.releaseYear || '' };
        if (typeof showSongContextMenu === 'function') showSongContextMenu(e, track);
        else if (typeof showSongContextMenuAt === 'function') showSongContextMenuAt(e.clientX, e.clientY, track);
      });
      actionsDiv.appendChild(moreBtn);
      row.appendChild(actionsDiv);
      if (isPlaying) {
        const ind = document.createElement('div');
        ind.className = 'play-indicator-list'; ind.innerHTML = '&#9654;';
        row.appendChild(ind);
      }
      container.appendChild(row);
    }
  }
}

function setView(view) {
  currentView = view;
  document.getElementById('btn-grid').classList.toggle('active', view === 'grid');
  document.getElementById('btn-list').classList.toggle('active', view === 'list');
  if (tracks.length) renderTracks();
}

async function clearUsedSongs() {
  if (!await customConfirm('Clear the list of used songs?')) return;
  try {
    await fetch('/quiz/api/admin/clear-used', { method: 'POST' });
    // Cleared silently
  } catch {}
}

async function playTrack(name, artist, songId) {
  try {
    if (typeof Player === 'undefined') return;

    // Queue remaining tracks from the list this track belongs to
    const idx = tracks.findIndex(t => t.id === songId || (t.name === name && t.artistName === artist));
    if (idx >= 0) {
      window.playAllQueue = tracks.slice(idx);
      window.playAllIndex = 1; // skip first — we're playing it now
    }

    const ok = await Player.play(songId, name, artist);
    playingTrackName = ok ? name : null;
    renderTracks();
  } catch (err) {
    console.error('Play failed:', err);
  }
}

loadTracks();
