# F17: MusicKit JS Playback

**Status:** Planned
**Priority:** High
**Depends on:** F18 (PlaybackProvider Abstraction)
**Replaces:** Home Controller as primary playback

## Summary

Browser-based Apple Music playback via MusicKit JS. Eliminates the Mac/Home Controller requirement for quiz hosting. Any device with a browser + Apple Music subscription can host a quiz with full streaming.

## Why

Current playback requires a Mac running Home Controller (AppleScript via WebSocket). This limits hosting to one specific machine. MusicKit JS runs entirely in the browser — same tech Apple uses on music.apple.com.

## How It Works

1. Host opens quiz → page loads MusicKit JS from Apple CDN
2. Server provides Developer Token via `/quiz/api/musickit-token` (JWT from existing .p8 key)
3. Host clicks "Connect Apple Music" → MusicKit JS auth popup → user grants access
4. Music plays directly in the host browser via `music.setQueue({ song: songId })`
5. Quiz engine sends song IDs → MusicKit JS plays them → no Home Controller needed

## Technical Details

### New Files
- `src/quiz/playback/musickit-web.ts` — MusicKitWebProvider implementing PlaybackProvider

### Modified Files
- `src/quiz/routes.ts` — Add `GET /quiz/api/musickit-token`
- `src/quiz/public/host.html` — Load MusicKit JS CDN script
- `src/quiz/public/host.js` — Initialize MusicKit, auth flow, playback via provider

### Host HTML
```html
<script src="https://js-cdn.music.apple.com/musickit/v3/musickit.js" async></script>
```

### Developer Token Endpoint
```
GET /quiz/api/musickit-token → { token: "eyJ..." }
```
Uses existing `createDeveloperToken()` from `src/token.ts`.

### Auth Flow
- MusicKit JS shows Apple's own login popup
- User authorizes with their Apple Music account
- No password stored on our side — Apple handles it
- Token persists in browser session

### Fallback Chain
1. MusicKit JS (browser) — primary, cross-platform
2. Home Controller (AppleScript) — legacy, Mac only
3. Preview clips (30s) — no login required

## Acceptance Criteria

- [ ] Host can play full Apple Music songs directly in browser
- [ ] No Home Controller needed for quiz playback
- [ ] Works on Mac, Windows, Linux (any modern browser)
- [ ] Developer token generated from existing .p8 key
- [ ] Graceful fallback to Home Controller if MusicKit JS unavailable
- [ ] Graceful fallback to preview clips if no auth at all
- [ ] Volume control works
- [ ] Seek to random position works (for quiz variety)
