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

  // ─── Play ──────────────────────────────────────────────

  async function play(songId, name, artist) {
    if (isUsingMusicKit() && songId) {
      return _mkPlay(songId);
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
    } catch { return false; }
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
    // Init MusicKit when CDN loads
    if (typeof MusicKit !== 'undefined') initMusicKit();
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('musickitloaded', () => initMusicKit());
    // Fallback
    setTimeout(() => { if (!mk && typeof MusicKit !== 'undefined') initMusicKit(); }, 3000);
    // Start HC if needed
    _init();
  }

  return {
    // Provider
    getPreferredProvider, setPreferredProvider,
    isUsingMusicKit, isUsingHomeController,
    // MusicKit
    authorize, isMusicKitAuthorized, getMusicKitInstance, initMusicKit,
    // Playback
    play, pause, resume, togglePlayPause, stop,
    // State
    getState, onUpdate,
    // AirPlay
    showAirPlayPicker,
  };
})();
