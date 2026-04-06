/**
 * Universal Player — single API for all playback
 *
 * Checks localStorage 'preferred-provider' and routes to:
 * - MusicKit JS (browser playback)
 * - Home Controller (server-side, via REST API)
 *
 * Every page includes this one file. No provider-specific code elsewhere.
 */

const Player = (() => {
  let mk = null;
  let mkAuthorized = false;
  let pushInterval = null;
  let updateInterval = null;
  let onStateChange = null;
  let hcWs = null;
  let hcNpData = null;

  // ─── Provider ──────────────────────────────────────────

  function getPreferredProvider() {
    return localStorage.getItem('preferred-provider') || 'musickit-web';
  }

  function setPreferredProvider(provider) {
    localStorage.setItem('preferred-provider', provider);
    fetch('/quiz/api/set-provider', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider }),
    }).catch(() => {});
    if (provider === 'home-controller') _startHcWebSocket();
  }

  function isUsingMusicKit() {
    return getPreferredProvider() === 'musickit-web' && mkAuthorized;
  }

  function isUsingHomeController() {
    return getPreferredProvider() === 'home-controller';
  }

  // ─── MusicKit JS Init ──────────────────────────────────

  async function initMusicKit() {
    if (mk) return true;
    if (typeof MusicKit === 'undefined') return false;
    try {
      const res = await fetch('/quiz/api/musickit-token');
      const { token } = await res.json();
      await MusicKit.configure({
        developerToken: token,
        app: { name: 'Music Quiz', build: '3.0.0' },
      });
      mk = MusicKit.getInstance();
      if (mk.isAuthorized) {
        mkAuthorized = true;
        _onMkAuthorized();
      }
      return true;
    } catch (err) {
      console.error('🎵 MusicKit init failed:', err);
      return false;
    }
  }

  async function authorize() {
    if (mkAuthorized) return true;
    if (!mk) { const ok = await initMusicKit(); if (!ok) return false; }
    try {
      await mk.authorize();
      mkAuthorized = true;
      _onMkAuthorized();
      return true;
    } catch { return false; }
  }

  function _onMkAuthorized() {
    _markMkReady();
    if (getPreferredProvider() === 'musickit-web') {
      _startMkPush();
    }
    // Auto-show AirPlay if preferred
    if (localStorage.getItem('mk-airplay-preferred') === 'true') {
      _autoShowAirPlay();
    }
  }

  function isMusicKitAuthorized() { return mkAuthorized; }
  function getMusicKitInstance() { return mk; }

  // ─── MusicKit Ready Gate ─────────────────────────────────
  // Ensures mk is initialized before playback attempts

  let _mkReadyResolve = null;
  let _mkReadyPromise = new Promise(r => { _mkReadyResolve = r; });

  function _markMkReady() {
    if (_mkReadyResolve) { _mkReadyResolve(); _mkReadyResolve = null; }
  }

  /** Wait up to timeoutMs for MusicKit to be ready. If not ready, try to initialize. */
  async function _waitForMk(timeoutMs = 5000) {
    if (mk && mkAuthorized) return true;

    // Try to initialize if not yet done
    if (!mk && typeof MusicKit !== 'undefined') {
      console.log('🎵 _waitForMk: MusicKit available but not initialized — initializing now');
      await initMusicKit();
      if (mk && mkAuthorized) return true;
    }

    // Wait for async init to complete
    return Promise.race([
      _mkReadyPromise.then(() => true),
      new Promise(r => setTimeout(() => r(false), timeoutMs)),
    ]);
  }

  // ─── Play ──────────────────────────────────────────────

  async function play(songId, name, artist) {
    if (isUsingMusicKit() && songId) {
      return await _mkPlay(songId);
    }
    // If MusicKit preferred but not ready yet, wait briefly
    if (getPreferredProvider() === 'musickit-web' && songId) {
      const ready = await _waitForMk(3000);
      if (ready) return await _mkPlay(songId);
    }
    // No songId but have name — search and play (MusicKit or HC)
    if (!songId && name && getPreferredProvider() === 'musickit-web') {
      return await playExact(name, artist || '');
    }
    // Home Controller (server-side)
    return _hcPlay(name || songId, artist || '', songId);
  }

  async function _mkPlay(songId) {
    if (!mk) return false;
    try {
      await mk.setQueue({ song: songId });
      await mk.play();
      return true;
    } catch (err) {
      console.error('🎵 MusicKit play failed:', err);
      return false;
    }
  }

  /** Search catalog and play exact match by name + artist */
  async function playExact(name, artist, options) {
    if (getPreferredProvider() === 'musickit-web') {
      if (!mk || !mkAuthorized) {
        const ready = await _waitForMk(3000);
        if (!ready) return false;
      }
      return await _mkPlayExact(name, artist, options?.randomSeek);
    }
    return _hcPlay(name, artist);
  }

  async function _mkPlayExact(name, artist, randomSeek) {
    if (!mk) return false;
    try {
      const query = `${name} ${artist}`;
      const results = await mk.api.music(`/v1/catalog/${mk.storefrontId || 'dk'}/search`, {
        term: query, types: 'songs', limit: 5,
      });
      const songs = results?.data?.results?.songs?.data || [];
      if (songs.length === 0) return false;

      // Find best match
      const nameLower = name.toLowerCase();
      const artistLower = artist.toLowerCase();
      let bestMatch = songs[0];
      for (const s of songs) {
        const sName = (s.attributes?.name || '').toLowerCase();
        const sArtist = (s.attributes?.artistName || '').toLowerCase();
        if (sName.includes(nameLower.slice(0, 10)) && sArtist.includes(artistLower.slice(0, 10))) {
          bestMatch = s; break;
        }
      }

      await mk.setQueue({ song: bestMatch.id });
      await mk.play();

      if (randomSeek) {
        await new Promise(r => setTimeout(r, 500));
        const duration = mk.currentPlaybackDuration;
        if (duration > 30) {
          await mk.seekToTime(((20 + Math.random() * 50) / 100) * duration);
        }
      }
      return true;
    } catch (err) {
      console.error('🎵 MusicKit playExact failed:', err);
      return false;
    }
  }

  /** Search and play first result */
  async function searchAndPlay(query) {
    if (getPreferredProvider() === 'musickit-web') {
      if (!mk || !mkAuthorized) {
        const ready = await _waitForMk(3000);
        if (!ready) return false;
      }
      return await _mkSearchAndPlay(query);
    }
    return _hcPlay(query, '');
  }

  async function _mkSearchAndPlay(query) {
    if (!mk) return false;
    try {
      const results = await mk.api.music(`/v1/catalog/${mk.storefrontId || 'dk'}/search`, {
        term: query, types: 'songs', limit: 1,
      });
      const song = results?.data?.results?.songs?.data?.[0];
      if (!song) return false;
      await mk.setQueue({ song: song.id });
      await mk.play();
      return true;
    } catch (err) {
      console.error('🎵 MusicKit searchAndPlay failed:', err);
      return false;
    }
  }

  async function _hcPlay(name, artist, songId) {
    try {
      const res = await fetch('/quiz/api/admin/play', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, artist, songId }),
      });
      const data = await res.json();
      return !data.error;
    } catch { return false; }
  }

  // ─── Pause / Resume / Stop ─────────────────────────────

  async function pause() {
    if (isUsingMusicKit()) { mk?.pause(); return; }
    if (hcNpData) hcNpData.state = 'paused'; // optimistic
    _notifyUpdate();
    fetch('/quiz/api/admin/playback/pause', { method: 'POST' }).catch(() => {});
  }

  async function resume() {
    if (isUsingMusicKit()) { await mk?.play().catch(() => {}); return; }
    if (hcNpData) hcNpData.state = 'playing'; // optimistic
    _notifyUpdate();
    fetch('/quiz/api/admin/playback/play', { method: 'POST' }).catch(() => {});
  }

  async function togglePlayPause() {
    if (isUsingMusicKit()) {
      if (mk?.playbackState === 2) mk.pause();
      else await mk?.play().catch(() => {});
      return;
    }
    if (hcNpData?.state === 'playing') {
      hcNpData.state = 'paused'; // optimistic
      _notifyUpdate();
      fetch('/quiz/api/admin/playback/pause', { method: 'POST' }).catch(() => {});
    } else {
      if (hcNpData) hcNpData.state = 'playing'; // optimistic
      _notifyUpdate();
      fetch('/quiz/api/admin/playback/play', { method: 'POST' }).catch(() => {});
    }
  }

  function stop() {
    if (isUsingMusicKit()) { mk?.stop(); return; }
    if (hcNpData) hcNpData.state = 'stopped'; // optimistic
    _notifyUpdate();
    fetch('/quiz/api/admin/playback/pause', { method: 'POST' }).catch(() => {});
  }

  /** Immediately notify UI callback (don't wait for interval) */
  function _notifyUpdate() {
    if (onStateChange) onStateChange(getState());
  }

  // ─── State ─────────────────────────────────────────────

  function getState() {
    if (isUsingMusicKit()) return _mkState();
    if (hcNpData) return hcNpData;
    return { state: 'stopped' };
  }

  function _mkState() {
    if (!mk) return { state: 'stopped' };
    const np = mk.nowPlayingItem;
    const pbState = mk.playbackState;
    return {
      state: pbState === 2 ? 'playing' : pbState === 3 ? 'paused' : 'stopped',
      track: np?.title || null,
      artist: np?.artistName || null,
      album: np?.albumName || null,
      artworkUrl: np?.artwork?.url?.replace('{w}', '600')?.replace('{h}', '600') || null,
      artworkSmall: np?.artwork?.url?.replace('{w}', '200')?.replace('{h}', '200') || null,
      songId: np?.id || null,
      position: mk.currentPlaybackTime || 0,
      duration: mk.currentPlaybackDuration || 0,
    };
  }

  // ─── Updates (callback for UI) ─────────────────────────

  function onUpdate(callback) {
    onStateChange = callback;
    // Only start interval — callbacks fire on actual state changes + _notifyUpdate
    if (!updateInterval) {
      let lastKey = '';
      updateInterval = setInterval(() => {
        if (!onStateChange) return;
        const s = getState();
        const key = s.state + '|' + (s.track || '') + '|' + Math.floor(s.position || 0);
        if (key !== lastKey) {
          lastKey = key;
          onStateChange(s);
        }
      }, 500);
    }
  }

  // ─── Now-Playing Push (to server for Now Playing pages) ─

  function _startMkPush() {
    if (pushInterval) return;
    try {
      mk.addEventListener('playbackStateDidChange', _push);
      mk.addEventListener('nowPlayingItemDidChange', _push);
    } catch {}
    pushInterval = setInterval(_push, 1000);
    _push();
  }

  function _push() {
    if (!mk || !mkAuthorized || getPreferredProvider() !== 'musickit-web') return;
    const s = _mkState();
    if (!s.track && s.state !== 'playing') return;
    fetch('/quiz/api/now-playing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(s),
    }).catch(() => {});
  }

  // ─── Home Controller WebSocket (now-playing data) ──────

  let hcWsConnecting = false;
  function _startHcWebSocket() {
    if (hcWs || hcWsConnecting) return;
    hcWsConnecting = true;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(proto + '//' + location.host + '/ws/now-playing');
    ws.onopen = () => { hcWs = ws; hcWsConnecting = false; console.log('🎵 Player: now-playing WS connected'); };
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'now-playing') {
          hcNpData = msg.data;
        }
      } catch {}
    };
    ws.onclose = () => { hcWs = null; hcWsConnecting = false; setTimeout(_startHcWebSocket, 2000); };
    ws.onerror = () => { ws.close(); };
  }

  // ─── AirPlay ───────────────────────────────────────────

  function showAirPlayPicker() {
    const el = _findMediaElement();
    if (el?.webkitShowPlaybackTargetPicker) {
      el.webkitShowPlaybackTargetPicker();
      localStorage.setItem('mk-airplay-preferred', 'true');
      return true;
    }
    return false;
  }

  function _autoShowAirPlay() {
    const check = setInterval(() => {
      const el = _findMediaElement();
      if (el?.webkitShowPlaybackTargetPicker) {
        clearInterval(check);
        setTimeout(() => el.webkitShowPlaybackTargetPicker(), 1500);
      }
    }, 1000);
    setTimeout(() => clearInterval(check), 30000);
  }

  function _findMediaElement() {
    const els = [...document.querySelectorAll('audio, video')];
    for (const el of els) {
      if (el.src && !el.src.startsWith('data:') && el.webkitShowPlaybackTargetPicker) return el;
    }
    for (const el of els) {
      if (el.webkitShowPlaybackTargetPicker) return el;
    }
    return null;
  }

  // ─── Auto-init ─────────────────────────────────────────

  function _init() {
    const prov = getPreferredProvider();
    // Sync saved provider to server on every page load
    fetch('/quiz/api/set-provider', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: prov }),
    }).catch(() => {});
    // Always start HC WebSocket (for now-playing data from HC polling)
    _startHcWebSocket();
    // Only load + init MusicKit if it's the preferred provider (avoids autoplay errors on HC)
    if (prov === 'musickit-web') {
      _loadMusicKitCDN();
    }
  }

  function _loadMusicKitCDN() {
    if (typeof MusicKit !== 'undefined') { initMusicKit(); return; }
    if (document.querySelector('script[src*="musickit"]')) return;
    const s = document.createElement('script');
    s.src = 'https://js-cdn.music.apple.com/musickit/v3/musickit.js';
    s.defer = true;
    document.head.appendChild(s);
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('musickitloaded', () => {
      if (getPreferredProvider() === 'musickit-web') initMusicKit();
    });
    _init();

    // Retry MusicKit init after delay — catches case where musickitloaded fired before we registered
    setTimeout(() => {
      if (!mk && typeof MusicKit !== 'undefined' && getPreferredProvider() === 'musickit-web') {
        console.log('🎵 MusicKit retry init (musickitloaded may have fired early)');
        initMusicKit();
      }
    }, 2000);
  }

  return {
    // Provider
    getPreferredProvider, setPreferredProvider,
    isUsingMusicKit, isUsingHomeController,
    // MusicKit
    authorize, isMusicKitAuthorized, getMusicKitInstance, initMusicKit,
    // Playback
    play, playExact, searchAndPlay, pause, resume, togglePlayPause, stop,
    // State
    getState, onUpdate,
    // AirPlay
    showAirPlayPicker,
  };
})();
