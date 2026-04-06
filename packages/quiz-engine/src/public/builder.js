/**
 * Quiz Builder — Client-side logic
 * Search Apple Music, curate a playlist, save/load, start quiz.
 */

let playlist = [];        // PlaylistTrack[]
let playlistId = null;    // ID if loaded from saved
let searchTimeout = null;

// ─── Search ───────────────────────────────────────────────

const searchInput = document.getElementById('search-input');
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(doSearch, 300);
});
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { clearTimeout(searchTimeout); doSearch(); }
});

async function doSearch() {
  const q = searchInput.value.trim();
  const container = document.getElementById('search-results');
  const empty = document.getElementById('search-empty');

  if (!q) {
    container.innerHTML = '';
    empty.style.display = '';
    empty.textContent = 'Type to search Apple Music catalog';
    return;
  }

  empty.style.display = '';
  empty.textContent = 'Searching...';

  try {
    const res = await fetch(`/quiz/api/builder/search?q=${encodeURIComponent(q)}`);
    const data = await res.json();

    const hasResults = data.tracks?.length || data.albums?.length;
    if (!hasResults) {
      container.innerHTML = '';
      empty.style.display = '';
      empty.textContent = 'No results found';
      return;
    }

    empty.style.display = 'none';
    container.innerHTML = '';

    // Albums first
    if (data.albums?.length) {
      const albumHeader = document.createElement('div');
      albumHeader.style.cssText = 'padding:8px 12px;font-size:12px;color:var(--dimmer);font-weight:600;text-transform:uppercase;letter-spacing:1px';
      albumHeader.textContent = 'Albums';
      container.appendChild(albumHeader);

      for (const a of data.albums) {
        const wrapper = document.createElement('div');

        const row = document.createElement('div');
        row.className = 'track-row';
        row.style.cursor = 'pointer';
        row.innerHTML = `
          ${a.artworkUrl ? `<img class="artwork" src="${a.artworkUrl}" alt="">` : '<div class="artwork"></div>'}
          <div class="info">
            <div class="track-name">${a.name}</div>
            <div class="artist-name">${a.artistName}</div>
            <div class="album-year">${a.trackCount} tracks · ${a.releaseYear}</div>
          </div>
        `;

        // Add All button
        const addAllBtn = document.createElement('button');
        addAllBtn.className = 'track-action btn-add';
        addAllBtn.style.cssText = 'width:auto;padding:4px 10px;font-size:11px;border-radius:6px';
        addAllBtn.textContent = '+ All';
        addAllBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          addAllBtn.textContent = '...';
          addAllBtn.disabled = true;
          const tracks = await fetchAlbumTracks(a.id);
          let added = 0;
          for (const t of tracks) {
            if (!playlist.some(p => p.id === t.id)) { playlist.push(t); added++; }
          }
          renderPlaylist();
          addAllBtn.classList.add('added');
          addAllBtn.textContent = `✓ ${added}`;
        });
        row.appendChild(addAllBtn);

        // Click row to expand/collapse tracks
        let expanded = false;
        let tracksDiv = null;
        row.addEventListener('click', async () => {
          if (expanded) {
            tracksDiv?.remove();
            tracksDiv = null;
            expanded = false;
            return;
          }
          expanded = true;
          tracksDiv = document.createElement('div');
          tracksDiv.className = 'album-tracks';
          tracksDiv.innerHTML = '<div style="padding:8px;color:var(--dimmer);font-size:13px">Loading tracks...</div>';
          wrapper.appendChild(tracksDiv);

          const tracks = await fetchAlbumTracks(a.id);
          tracksDiv.innerHTML = '';

          for (const t of tracks) {
            const inPl = playlist.some(p => p.id === t.id);
            const trow = document.createElement('div');
            trow.className = 'track-row';
            trow.innerHTML = `
              ${t.artworkUrl ? `<img class="artwork" src="${t.artworkUrl}" alt="">` : '<div class="artwork"></div>'}
              <div class="info">
                <div class="track-name">${t.name}</div>
                <div class="artist-name">${t.artistName}</div>
              </div>
            `;
            const playBtn = document.createElement('button');
            playBtn.className = 'track-action btn-play-small';
            playBtn.innerHTML = '&#9654;';
            playBtn.addEventListener('click', (e) => { e.stopPropagation(); playTrack(t.name, t.artistName, t.artworkUrl, t.id); });
            trow.appendChild(playBtn);

            const addBtn = document.createElement('button');
            addBtn.className = `track-action btn-add${inPl ? ' added' : ''}`;
            addBtn.innerHTML = inPl ? '&#10003;' : '+';
            if (!inPl) {
              addBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                addToPlaylist(t);
                addBtn.classList.add('added');
                addBtn.innerHTML = '&#10003;';
              });
            }
            trow.appendChild(addBtn);
            tracksDiv.appendChild(trow);
          }
        });

        wrapper.appendChild(row);
        container.appendChild(wrapper);
      }
    }

    // Songs
    if (data.tracks?.length) {
      const songHeader = document.createElement('div');
      songHeader.style.cssText = 'padding:8px 12px;font-size:12px;color:var(--dimmer);font-weight:600;text-transform:uppercase;letter-spacing:1px;margin-top:8px';
      songHeader.textContent = 'Songs';
      container.appendChild(songHeader);

      for (const t of data.tracks) {
        const inPlaylist = playlist.some(p => p.id === t.id);
        const row = document.createElement('div');
        row.className = 'track-row';
        row.innerHTML = `
          ${t.artworkUrl ? `<img class="artwork" src="${t.artworkUrl}" alt="">` : '<div class="artwork"></div>'}
          <div class="info">
            <div class="track-name">${t.name}</div>
            <div class="artist-name">${t.artistName}</div>
            <div class="album-year">${t.albumName}${t.releaseYear ? ' · ' + t.releaseYear : ''}</div>
          </div>
        `;

        // Play button
        const playBtn = document.createElement('button');
        playBtn.className = 'track-action btn-play-small';
        playBtn.innerHTML = '&#9654;';
        playBtn.title = 'Play';
        playBtn.addEventListener('click', (e) => { e.stopPropagation(); playTrack(t.name, t.artistName, t.artworkUrl, t.id); });
        row.appendChild(playBtn);

        // Add button
        const addBtn = document.createElement('button');
        addBtn.className = `track-action btn-add${inPlaylist ? ' added' : ''}`;
        addBtn.innerHTML = inPlaylist ? '&#10003;' : '+';
        addBtn.title = inPlaylist ? 'Already added' : 'Add to quiz';
        if (!inPlaylist) {
          addBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            addToPlaylist(t);
            addBtn.classList.add('added');
            addBtn.innerHTML = '&#10003;';
          });
        }
        row.appendChild(addBtn);

        container.appendChild(row);
      }
    }
  } catch (err) {
    empty.style.display = '';
    empty.textContent = 'Search failed: ' + err;
  }
}

// ─── Playlist Management ──────────────────────────────────

function addToPlaylist(track) {
  if (playlist.some(p => p.id === track.id)) return;
  playlist.push(track);
  renderPlaylist();
}

function removeFromPlaylist(id) {
  playlist = playlist.filter(p => p.id !== id);
  renderPlaylist();
  // Re-render search to update add buttons
  doSearch();
}

async function clearPlaylist() {
  const ok = await customConfirm(`Remove all ${playlist.length} tracks?`, 'This cannot be undone', 'Clear All');
  if (!ok) return;
  playlist = [];
  playlistId = null;
  document.getElementById('playlist-name').value = '';
  renderPlaylist();
  doSearch();
}

function renderPlaylist() {
  const container = document.getElementById('playlist-tracks');
  const empty = document.getElementById('playlist-empty');
  const footer = document.getElementById('playlist-footer');
  const countBadge = document.getElementById('playlist-count');
  const saveBtn = document.getElementById('btn-save');
  const clearBtn = document.getElementById('btn-clear-all');

  countBadge.textContent = playlist.length;
  saveBtn.disabled = playlist.length === 0;
  clearBtn.style.display = playlist.length > 0 ? '' : 'none';
  empty.style.display = playlist.length === 0 ? '' : 'none';
  footer.style.display = playlist.length >= 2 ? '' : 'none';

  container.innerHTML = '';

  playlist.forEach((t, i) => {
    const row = document.createElement('div');
    row.className = 'track-row';
    row.innerHTML = `
      <span class="track-number">${i + 1}</span>
      ${t.artworkUrl ? `<img class="artwork" src="${t.artworkUrl}" alt="">` : '<div class="artwork"></div>'}
      <div class="info">
        <div class="track-name">${t.name}</div>
        <div class="artist-name">${t.artistName}</div>
        <div class="album-year">${t.albumName}${t.releaseYear ? ' · ' + t.releaseYear : ''}</div>
      </div>
    `;

    // Play
    const playBtn = document.createElement('button');
    playBtn.className = 'track-action btn-play-small';
    playBtn.innerHTML = '&#9654;';
    playBtn.addEventListener('click', (e) => { e.stopPropagation(); playTrack(t.name, t.artistName, t.artworkUrl, t.id); });
    row.appendChild(playBtn);

    // Remove
    const removeBtn = document.createElement('button');
    removeBtn.className = 'track-action btn-remove';
    removeBtn.innerHTML = '&times;';
    removeBtn.title = 'Remove';
    removeBtn.addEventListener('click', (e) => { e.stopPropagation(); removeFromPlaylist(t.id); });
    row.appendChild(removeBtn);

    container.appendChild(row);
  });
}

// ─── Fetch Album Tracks ───────────────────────────────────

async function fetchAlbumTracks(albumId) {
  try {
    const res = await fetch(`/quiz/api/builder/album/${albumId}/tracks`);
    const data = await res.json();
    return data.tracks || [];
  } catch { return []; }
}

// ─── Play Track + Mini Player ─────────────────────────────

let isPlaying = false;

let playAbort = null;

async function playTrack(name, artist, artworkUrl, songId) {
  // Cancel any in-flight play request
  if (playAbort) playAbort.abort();
  playAbort = new AbortController();

  console.log(`🎵 Play: "${name}" by ${artist} (id: ${songId})`);
  showMiniPlayer(name, artist, artworkUrl, true);

  const ok = await Player.play(songId, name, artist);
  showMiniPlayer(name, artist, artworkUrl, false, !ok);
  if (!ok) showToast('Playback failed — check Audio Setup on Admin', true);
}

function showMiniPlayer(name, artist, artworkUrl, loading = false, failed = false) {
  isPlaying = !failed;
  const trackEl = document.getElementById('mini-track');
  trackEl.textContent = loading ? `${name} …` : name;
  trackEl.style.opacity = loading ? '0.5' : '1';
  document.getElementById('mini-artist').textContent = artist;
  const img = document.getElementById('mini-artwork');
  if (artworkUrl) { img.src = artworkUrl; img.style.display = ''; img.style.opacity = loading ? '0.5' : '1'; }
  else { img.style.display = 'none'; }
  document.getElementById('mini-pause').innerHTML = failed ? '!' : '&#10074;&#10074;';
  const player = document.getElementById('mini-player');
  player.classList.add('visible');
  player.classList.toggle('paused', loading || failed);
}

async function togglePause() {
  await Player.togglePlayPause();
  const ps = Player.getState();
  isPlaying = ps.state === 'playing';
  document.getElementById('mini-pause').innerHTML = isPlaying ? '&#10074;&#10074;' : '&#9654;';
  document.getElementById('mini-player').classList.toggle('paused', !isPlaying);
  try {
    await fetch(`/quiz/api/admin/playback/${isPlaying ? 'play' : 'pause'}`, { method: 'POST' });
  } catch {}
}

// ─── Save / Load ──────────────────────────────────────────

async function savePlaylist() {
  const name = document.getElementById('playlist-name').value.trim();
  if (!name) {
    document.getElementById('playlist-name').focus();
    document.getElementById('playlist-name').style.borderBottom = '2px solid var(--red)';
    setTimeout(() => { document.getElementById('playlist-name').style.borderBottom = ''; }, 2000);
    return;
  }
  if (playlist.length === 0) return;

  try {
    const method = playlistId ? 'PUT' : 'POST';
    const url = playlistId
      ? `/quiz/api/builder/playlists/${playlistId}`
      : '/quiz/api/builder/playlists';

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, tracks: playlist }),
    });
    const saved = await res.json();
    if (saved.error) throw new Error(saved.error);
    playlistId = saved.id;

    document.getElementById('save-modal-title').textContent = `"${saved.name}" saved!`;
    document.getElementById('save-modal-subtitle').textContent = `${saved.tracks.length} tracks ready to quiz`;
    document.getElementById('save-modal').style.display = '';
  } catch (err) {
    showToast('Save failed: ' + err, true);
  }
}

async function loadPlaylistPicker() {
  const modal = document.getElementById('load-modal');
  const list = document.getElementById('saved-list');
  modal.style.display = '';

  try {
    const res = await fetch('/quiz/api/builder/playlists');
    const playlists = await res.json();

    if (playlists.length === 0) {
      list.innerHTML = '<div class="saved-empty">No saved quizzes yet</div>';
      return;
    }

    list.innerHTML = '';
    for (const pl of playlists) {
      const item = document.createElement('div');
      item.className = 'saved-item';

      const info = document.createElement('div');
      info.style.cssText = 'flex:1;cursor:pointer';
      info.innerHTML = `
        <div class="saved-name">${pl.name}</div>
        <div class="saved-meta">${pl.tracks.length} tracks · ${new Date(pl.updatedAt).toLocaleDateString('da-DK')}</div>
      `;
      info.addEventListener('click', () => loadPlaylist(pl));
      item.appendChild(info);

      const del = document.createElement('button');
      del.className = 'saved-delete';
      del.innerHTML = '&times;';
      del.title = 'Delete';
      del.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (await customConfirm(`Delete "${pl.name}"?`, `${pl.tracks.length} tracks will be removed`, 'Delete')) {
          await fetch(`/quiz/api/builder/playlists/${pl.id}`, { method: 'DELETE' });
          item.remove();
          if (playlistId === pl.id) playlistId = null;
        }
      });
      item.appendChild(del);

      list.appendChild(item);
    }
  } catch (err) {
    list.innerHTML = `<div class="saved-empty">Failed to load: ${err}</div>`;
  }
}

async function loadPlaylist(pl) {
  closeModal('load-modal');

  if (playlist.length > 0) {
    const replace = await customConfirm(
      `Load "${pl.name}"?`,
      `You have ${playlist.length} tracks. Replace or add ${pl.tracks.length} tracks?`,
      'Replace'
    );
    if (replace) {
      playlistId = pl.id;
      playlist = [...pl.tracks];
      document.getElementById('playlist-name').value = pl.name;
    } else {
      // Add to existing — merge without duplicates
      let added = 0;
      for (const t of pl.tracks) {
        if (!playlist.some(p => p.id === t.id)) { playlist.push(t); added++; }
      }
      showToast(`Added ${added} tracks from "${pl.name}"`);
    }
  } else {
    playlistId = pl.id;
    playlist = [...pl.tracks];
    document.getElementById('playlist-name').value = pl.name;
  }

  renderPlaylist();
  doSearch(); // refresh add buttons
}

function closeModal(id) {
  document.getElementById(id || 'load-modal').style.display = 'none';
}

// Close modal on backdrop click
document.getElementById('load-modal').addEventListener('click', (e) => {
  if (e.target.id === 'load-modal') closeModal('load-modal');
});
document.getElementById('save-modal').addEventListener('click', (e) => {
  if (e.target.id === 'save-modal') closeModal('save-modal');
});

// ─── Start Quiz from Playlist ─────────────────────────────

function startQuizFromPlaylist() {
  if (playlist.length < 2) { showToast('Add at least 2 songs', true); return; }

  // Store playlist in sessionStorage for host to pick up
  sessionStorage.setItem('customQuizPlaylist', JSON.stringify(playlist));
  sessionStorage.setItem('customQuizName', document.getElementById('playlist-name').value.trim() || 'Custom Quiz');

  // Go to host page
  window.location.href = '/quiz/host?source=custom';
}

// ─── Custom Confirm / Toast ───────────────────────────────

let confirmResolver = null;

function customConfirm(title, subtitle, actionLabel = 'Confirm') {
  return new Promise((resolve) => {
    confirmResolver = resolve;
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-subtitle').textContent = subtitle || '';
    document.getElementById('confirm-action-btn').textContent = actionLabel;
    document.getElementById('confirm-modal').style.display = '';
  });
}

function resolveConfirm(value) {
  document.getElementById('confirm-modal').style.display = 'none';
  if (confirmResolver) { confirmResolver(value); confirmResolver = null; }
}

document.getElementById('confirm-modal').addEventListener('click', (e) => {
  if (e.target.id === 'confirm-modal') resolveConfirm(false);
});

function showToast(msg, isError) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.style.color = isError ? 'var(--red)' : 'var(--text)';
  el.style.transform = 'translateX(-50%) translateY(0)';
  setTimeout(() => { el.style.transform = 'translateX(-50%) translateY(80px)'; }, 3000);
}

// ─── Init ─────────────────────────────────────────────────

renderPlaylist();
searchInput.focus();
