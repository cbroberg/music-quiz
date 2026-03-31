let currentView = 'grid';
let tracks = [];
let playingTrackName = null;

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
  if (!confirm('Clear the list of used songs? This allows them to appear in quizzes again.')) return;
  try {
    await fetch('/quiz/api/admin/clear-used', { method: 'POST' });
    alert('Used songs cleared!');
  } catch {}
}

async function playTrack(name, artist, songId) {
  try {
    const res = await fetch('/quiz/api/admin/play', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, artist, songId }),
    });
    const data = await res.json();
    if (data.error) {
      console.error('Play failed:', data.error);
    } else {
      playingTrackName = name;
      renderTracks();
    }
  } catch (err) {
    console.error('Play failed:', err);
  }
}

loadTracks();
