# Music Quiz — Project Instructions

## Current Status (April 2026)

Music Quiz v3.0.0 — multiplayer music quiz party game powered by Apple Music.
Core quiz + DJ Mode + Party Sessions + MusicKit JS working end-to-end.

### What Works
- **Multiplayer Quiz:** WebSocket game engine, QR join, Kahoot-style scoring, AI answer evaluation
- **Party Sessions (Events):** One join code per evening, players persist, picks accumulate across rounds
- **DJ Mode:** Players earn picks through quiz → search Apple Music → add to shared queue
- **MusicKit JS:** Browser-based Apple Music playback — no Mac/Home Controller needed (F17+F18)
- **PlaybackProvider Abstraction:** Swappable playback engines (MusicKit JS, Home Controller, future Spotify)
- **AirPlay:** Safari native picker for routing browser audio to AirPlay speakers
- **Exact Match Playback:** `play-exact` via provider, no fuzzy search, verified before timer starts
- **Pre-download:** All quiz songs downloaded + verified before quiz starts (progress modal with theme music)
- **Theme Songs:** "Theme from New York, New York" (prep), "We Are the Champions" (victory)
- **Waiting Room:** Late arrivals wait, auto-join when next lobby opens
- **Player Reconnect:** Rejoin DJ Mode seamlessly after page navigation
- **Library Cleanup:** Tracks quiz-added songs, deletes on DJ Mode end (never theme songs, never user's own music)
- **Now Playing:** Embedded screen in Host (no navigation needed), plus standalone page for display
- **Admin Hub:** Tabbed layout (Recently Played, Playlists, Favorites, Quiz), provider toggle, mini player
- **Universal Player:** `player.js` — single module for all playback (MusicKit JS / Home Controller)
- **Playlists:** Create, add/remove songs, Play All, Start Quiz from playlist
- **Favorites:** Heart button on all views, dedicated tab, stored as special playlist
- **Mini Player:** Track info, progress, play/pause/next/stop — works with both providers
- **Screen Recording:** ScreenCaptureKit Swift CLI with system audio + `--crop` flag
- **E2E Testing:** Playwright, 4-window ultrawide, 2-round + 5-round tests with Waiting Room
- **MUTE_ALL:** Env var for silent testing (no music, no sound effects)

### Architecture
- **Server:** Node.js + Express + WebSocket (`server.js` → `src/`)
- **PlaybackProvider:** Abstraction layer (`src/quiz/playback/`) — MusicKit JS or Home Controller
- **MusicKit JS:** Browser-based Apple Music via Apple's CDN, auth via developer token (`.p8` key)
- **Home Controller:** Legacy Mac agent (`home/`) — osascript playback, AirPlay control (fallback)
- **Universal Player:** `player.js` — single module for all playback, provider-aware, used by all pages
- **Host UI:** Vanilla HTML/JS (`src/quiz/public/host.*`) — fullscreen on Mac/TV, embedded Now Playing
- **Player UI:** Vanilla HTML/JS PWA (`src/quiz/public/play.*`) — mobile phones
- **Now Playing:** Embedded screen in Host + standalone page (`now-playing.html`) for display only
- **Quiz Builder:** Vanilla HTML/JS (`src/quiz/public/builder.*`) — curate custom playlists, MusicKit playback
- **Admin:** Vanilla HTML/JS (`src/quiz/public/admin.*`) — audio setup, recently played, mini player, Now Playing overlay
- **Frontend:** Next.js (`web/`) — original Now Playing page (being phased out for vanilla)
- **All quiz UI is vanilla** (not Next.js) for future tvOS WebView compatibility

### Key Files
| File | Purpose |
|------|---------|
| `src/quiz/engine.ts` | Game engine: sessions, scoring, question flow, Party management |
| `src/quiz/ws-handler.ts` | WebSocket handler: host/player messages, DJ Mode, provider routing |
| `src/quiz/dj-mode.ts` | DJ Mode state: picks, queue, autoplay, calculatePicksForRank |
| `src/quiz/types.ts` | All TypeScript interfaces (Party, CompletedRound, PartyState) |
| `src/quiz/routes.ts` | Express routes + MusicKit token endpoint + now-playing push |
| `src/quiz/playback/types.ts` | PlaybackProvider interface |
| `src/quiz/playback/home-controller.ts` | Home Controller provider (wraps sendHomeCommand) |
| `src/quiz/playback/musickit-web.ts` | MusicKit JS provider (server→browser WS proxy) |
| `src/quiz/playback/provider-manager.ts` | Active provider management + fallback chain |
| `src/quiz/public/musickit-player.js` | Shared client-side MusicKit JS module (all pages) |
| `src/quiz/ai-evaluator.ts` | Claude haiku for free-text answer evaluation |
| `src/quiz/playlist-store.ts` | Disk persistence for custom playlists |
| `src/browser-ws.ts` | Now Playing WebSocket broadcaster (push from MusicKit + poll from HC) |
| `home/server.ts` | Home Controller: osascript commands, WebSocket agent |
| `server.js` | Main server: routing between Express and Next.js |
| `scripts/e2e-full-flow.js` | Full E2E test: 2 rounds, Waiting Room, DJ Mode |
| `scripts/e2e-5rounds.js` | 5-round test with accumulated playlist verification |
| `scripts/screen-record/` | ScreenCaptureKit Swift CLI for video + audio recording |

## Playback Provider Architecture

### Provider Interface (`src/quiz/playback/types.ts`)
```
PlaybackProvider: playExact, pause, resume, setVolume, nowPlaying,
                  checkLibrary, addToLibrary, deleteFromLibrary, searchAndPlay
```

### Fallback Chain
1. **MusicKit JS** (browser) — primary, cross-platform, no Mac needed
2. **Home Controller** (osascript) — legacy, Mac only, AirPlay control
3. **Preview clips** (30s) — no login required (future)

### Key Endpoints
- `GET /quiz/api/musickit-token` — Developer token (JWT from .p8 key) for MusicKit JS
- `POST /quiz/api/set-provider` — Switch active provider (musickit-web / home-controller)
- `GET /quiz/api/playback-provider` — Current active provider
- `POST /quiz/api/now-playing` — Push now-playing data from browser to server

### MusicKit JS Auth Flow
1. Page loads → `musickit-player.js` auto-inits MusicKit JS from Apple CDN
2. User clicks "Connect Apple Music" (on Admin) → Apple login popup
3. Auth persists via Apple cookies — all pages in same browser auto-authorize
4. Server notified via `POST /quiz/api/set-provider` → switches from Home Controller

### AirPlay (Safari only)
- Find MusicKit's internal audio element → `webkitShowPlaybackTargetPicker()`
- Requires a song to have been played first (element created lazily)
- Non-Safari: toast recommends Safari or macOS Sound output settings

## Party Session (Events)

**Implemented.** See [docs/PARTY-SESSION.md](docs/PARTY-SESSION.md) for design.

- **Party** (Event) = entire evening — one join code, one playlist, multiple rounds
- **Round** = one quiz game within a Party
- **Playlist** = immutable, accumulates songs across rounds
- **Round #** visible in UI (host top-left badge + player lobby)
- **Picks** accumulate across rounds (shown on podium + player final screen)
- **"New Round"** button in DJ Mode, **"End Event"** to stop everything
- Party states: `playlist` | `lobby` | `quiz` | `ceremony`
- Verified with 5-round E2E test (28 songs accumulated, same join code)

## Song Playback

**ALDRIG fuzzy søgning.** Brug altid `playExact` via provider.

### Playback Chain (via PlaybackProvider)
1. **Pre-download:** `addToLibrary(songId)` via Apple Music API under preparation modal
2. **Verify:** `provider.checkLibrary(name, artist)` confirms availability
3. **Play:** `provider.playExact(name, artist, { retries, randomSeek })` — exact match
4. **Fallback:** Try simplified name (without parentheses/remaster tags)
5. **Alt swap:** If both fail, swap question with pre-prepared alternative — NEVER silence
6. **Verify playing:** Poll `provider.nowPlaying()` with exponential backoff
7. **Nudge:** If still not playing, send `provider.resume()`

### Theme Songs (protected from cleanup)
- **Preparation:** "Theme from New York, New York" — Frank Sinatra (+ backups: Every Breath You Take, Message In A Bottle)
- **Victory:** "We Are the Champions" — Queen

## Game States & Join Rules

| Session State | New Player | Existing Player |
|---|---|---|
| **Lobby** | ✅ Join | ✅ Rejoin |
| **Game (playing/countdown/etc.)** | → Waiting Room | ❌ Closed |
| **Finished / DJ Mode** | → Waiting Room | ✅ Rejoin DJ Mode |
| **New Lobby opens** | Waiting Room → auto-join | Auto-join via `lobby_open` |

## DJ Mode Queue Rules
- Queue is immutable — songs are never deleted during a party
- Picks: #1=5, #2=3, #3=2, rest=1, streak bonus +1
- Picks accumulate across rounds
- 0 picks = search hidden, queue tab only
- Queue survives between quiz rounds

## Volume & Music
- **No fade-volume** — removed entirely, caused persistent volume=0 bugs
- Volume set to 75 at quiz start (via provider)
- Music paused (not faded) between songs and before countdown
- Champions plays async after results (non-blocking)

## Danish Language Support
- `looksLikeDanish()` detects æøå in text
- Option generation prefers Danish alternatives for Danish songs
- Year options never exceed current year

## Engine: Question Generation
- Generates **3x** requested count (e.g., 9 for 3 questions)
- Primary questions get artwork + options
- Alternatives ready for runtime swap if primary fails playback
- `excludeRecentPlays` checkbox controls recently-played exclusion

## Testing
- **E2E full flow:** `node scripts/e2e-full-flow.js` — 2 rounds, Waiting Room, DJ Mode
- **E2E 5 rounds:** `node scripts/e2e-5rounds.js` — 5 rounds, playlist accumulation
- **Manual test:** `node scripts/manual-test.js` — opens windows, user controls
- **Quiz log:** Saved to `recordings/quiz-log-{timestamp}.json`
- **Screen recording:** `recordings/` dir (in .gitignore)
- **MUTE_ALL=true** in `.env` — disables all music + sound effects for silent testing
- **Server must be fresh** for clean `usedSongIds`
- Servers: `NODE_ENV=development node server.js` (+ optional Home Controller)

## Documentation
- [docs/ROADMAP.md](docs/ROADMAP.md) — Milestones (done + planned)
- [docs/FEATURES.md](docs/FEATURES.md) — Feature list (F01-F19)
- [docs/features/](docs/features/) — Individual feature specs
- [docs/PARTY-SESSION.md](docs/PARTY-SESSION.md) — Party Session architecture
- [docs/QUIZ-PATCH-001.md](docs/QUIZ-PATCH-001.md) — Commercial platform & multi-provider plan

## Hard Rules
1. **Fortæl brugeren hvad du laver FØR du laver det**
2. **ALDRIG fuzzy søgning** — exact match or silence (but swap alternative first)
3. **ALDRIG fade-volume** — caused cascading volume=0 bugs
4. **Playlist er immutable** under en party — kun tilføjelser
5. **Picks tildeles synkront** — før DJ Mode kan aktiveres
6. **Ingen join-skærm glimt** — blank skærm under auto-rejoin
7. **Vanilla HTML/JS** for quiz UI (ikke Next.js) — tvOS WebView compatibility
8. **Now Playing er read-only** — viser kun hvad host'en spiller, afspiller aldrig selv
9. **Én connect-knap** — Apple Music connects via Admin, alle andre sider auto-detecter
