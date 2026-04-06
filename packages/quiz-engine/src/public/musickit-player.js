/**
 * Shared MusicKit JS Player
 *
 * Single module used by all pages (Admin, Builder, Host, etc.)
 * Handles init, auth, playback, and now-playing push to server.
 */

const MKPlayer = (() => {
  let mk = null;
  let authorized = false;
  let updateInterval = null;
  let pushInterval = null;
  let onStateChange = null; // callback for UI updates

  /** Initialize MusicKit JS (call after CDN script loaded) */
  async function init() {
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
        authorized = true;
        _onAuthorized();
      }
      return true;
    } catch (err) {
      console.error('🎵 MusicKit init failed:', err);
      return false;
    }
  }

  /** Authorize (shows Apple login popup) */
  async function authorize() {
    if (!mk) {
      const ok = await init();
      if (!ok) return false;
    }
    if (authorized) return true;
    try {
      await mk.authorize();
      authorized = true;
      _onAuthorized();
      return true;
    } catch {
      return false;
    }
  }

  function _onAuthorized() {
    _startPush();
    _autoShowAirPlayIfNeeded();
    // Tell server
    fetch('/quiz/api/set-provider', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'musickit-web' }),
    }).catch(() => {});
  }

  /** Play a song by catalog ID */
  async function play(songId) {
    if (!mk || !authorized) return false;
    try {
      await mk.setQueue({ song: songId });
      await mk.play();
      return true;
    } catch (err) {
      console.error('🎵 Play failed:', err);
      return false;
    }
  }

  /** Pause */
  function pause() {
    if (mk) mk.pause();
  }

  /** Resume */
  async function resume() {
    if (mk) await mk.play().catch(() => {});
  }

  /** Toggle play/pause */
  async function togglePlayPause() {
    if (!mk) return;
    if (mk.playbackState === 2) { mk.pause(); }
    else { await mk.play().catch(() => {}); }
  }

  /** Stop */
  function stop() {
    if (mk) { mk.stop(); }
  }

  /** Get current state */
  function getState() {
    if (!mk) return { state: 'stopped' };
    const pbState = mk.playbackState;
    const isPlaying = pbState === 2;
    const isPaused = pbState === 3;
    const np = mk.nowPlayingItem;
    return {
      state: isPlaying ? 'playing' : isPaused ? 'paused' : 'stopped',
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

  /** Is authorized? */
  function isAuthorized() { return authorized; }

  /** Should this page use local MusicKit playback? (vs server-side Home Controller) */
  function isActivePlayer() {
    const pref = localStorage.getItem('preferred-provider');
    return authorized && pref !== 'home-controller';
  }

  /** Is available? */
  function isReady() { return mk !== null; }

  /** Get MusicKit instance (for advanced use) */
  function getInstance() { return mk; }

  /** Register a callback for state updates (called every 500ms) */
  function onUpdate(callback) {
    onStateChange = callback;
    if (!updateInterval && authorized) {
      updateInterval = setInterval(() => {
        if (onStateChange) onStateChange(getState());
      }, 500);
    }
  }

  /** Push now-playing to server (for Now Playing pages) */
  function _startPush() {
    if (pushInterval) return;
    // Event-driven
    try {
      mk.addEventListener('playbackStateDidChange', _push);
      mk.addEventListener('nowPlayingItemDidChange', _push);
    } catch {}
    // Reliable interval
    pushInterval = setInterval(_push, 1000);
    _push();
    // Start UI updates if callback registered
    if (onStateChange && !updateInterval) {
      updateInterval = setInterval(() => {
        if (onStateChange) onStateChange(getState());
      }, 500);
    }
  }

  function _push() {
    if (!mk || !authorized) return;
    const s = getState();
    if (!s.track && s.state !== 'playing') return;
    fetch('/quiz/api/now-playing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(s),
    }).catch(() => {});
  }

  /** Show AirPlay picker (Safari only) */
  function showAirPlayPicker() {
    const el = _findMediaElement();
    if (el) {
      el.webkitShowPlaybackTargetPicker();
      // Remember that user wants AirPlay
      localStorage.setItem('mk-airplay-preferred', 'true');
      return true;
    }
    return false;
  }

  /** Check if user previously selected AirPlay and auto-show picker */
  function _autoShowAirPlayIfNeeded() {
    if (localStorage.getItem('mk-airplay-preferred') !== 'true') return;
    // Wait for a media element to exist, then show picker
    const check = setInterval(() => {
      const el = _findMediaElement();
      if (el) {
        clearInterval(check);
        // Listen for wireless target changes
        el.addEventListener('webkitcurrentplaybacktargetiswirelesschanged', () => {
          const isWireless = el.webkitCurrentPlaybackTargetIsWireless;
          if (!isWireless) {
            // Lost AirPlay — show picker again
            setTimeout(() => el.webkitShowPlaybackTargetPicker(), 500);
          }
        });
        // Auto-show picker after brief delay (gives audio element time to initialize)
        setTimeout(() => {
          if (el.webkitShowPlaybackTargetPicker) {
            el.webkitShowPlaybackTargetPicker();
          }
        }, 1500);
      }
    }, 1000);
    // Stop checking after 30s
    setTimeout(() => clearInterval(check), 30000);
  }

  function _findMediaElement() {
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

  // Auto-init when MusicKit JS loads
  if (typeof document !== 'undefined') {
    document.addEventListener('musickitloaded', () => init());
    setTimeout(() => { if (!mk && typeof MusicKit !== 'undefined') init(); }, 3000);
  }

  return {
    init, authorize, isAuthorized, isActivePlayer, isReady, getInstance,
    play, pause, resume, togglePlayPause, stop,
    getState, onUpdate, showAirPlayPicker,
  };
})();
