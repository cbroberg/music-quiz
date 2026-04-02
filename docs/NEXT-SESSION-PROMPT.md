# Next Session Prompt

Paste this to start a new session:

---

## Context

Læs `CLAUDE.md` i project root — den indeholder komplet status over hele projektet.

## Hvad blev lavet i denne session (2. april 2026, aften)

### F20: Global Search (Cmd+K) ✅
- Cmd+K command palette med Apple Music search (artists, albums, songs)
- Keyboard navigation (piletaster + Enter + ESC)
- Search-knap i Admin header
- Artist Page (`#artist/{id}`) — hero med cirkulært artwork, top songs 3-kolonne grid, albums grid
- Album Page (`#album/{id}`) — hero, numbered tracks med hover play (num→▶ ved hover), Play All, Add All to Playlist
- Song Context Menu (···) — ▶ Play, 💿 Go to Album, 🎤 Go to Artist, Add to Playlist dropdown
- Hash routing inden for Admin, Back-knap med navigation history
- localStorage husker tab + hash position ved reload
- API: `GET /quiz/api/artist/:id` (top songs via view API + albums via search)
- `getArtistTopSongs()` tilføjet til AppleMusicClient

### Events (Quiz tab → Events) ✅
- Event store: disk-persisteret (`quiz-events.json`)
- Create event med navn + dato (native date picker dark mode) + kl. (selects)
- Edit Event modal: navn, dato, rounds (Unlimited/1-10 custom select), playlist picker (custom select)
- Active / Scheduled / Previous filter tabs
- Event card klik = Edit (ingen separat Edit-knap)
- Start Quiz fra Event → preloader playlist, viser event name + rounds i Host titel
- Safe update: kun overskriver felter der er sendt (ingen undefined-nuking)
- `showNewEventForm()` (renamed fra `createEvent` — kolliderede med native DOM metode)

### Admin UI Improvements ✅
- Provider toggle: "Apple Music" / "Home Controller"
- AirPlay selector for HC med **active vs selected status** (grøn ● = active, rød − = selected men offline)
- Volume slider for begge providers (sender til Music.app + alle aktive AirPlay devices)
- Speaker SVG ikon efter slider
- Custom confirm dialogs OVERALT (ALDRIG native confirm/alert/prompt — Hard Rule #10)
- Custom select buttons (dark theme dropdowns via song-ctx-menu)
- SVG close button på Now Playing overlay (perfekt centreret)
- Test-knap renamed "Test" (fra "Test Play"), subtile outlined knapper
- Host playlists modal: ⌘K-style med søg + artwork mosaic + keyboard nav (piletaster)
- "No playlist loaded" → "press ⌘K to search and add songs"

### Playback Fixes ✅
- **play-exact med fuldt navn** — sender fuldt tracknavn (inkl. "(Remastered 2003)") før simplified. Root cause: osascript `whose name is` kræver exact match
- **addToLibrary + retry** fallback for sange ikke i bibliotek
- **Play log**: `GET /quiz/api/admin/play-log` — requested vs actual track
- **Track change log**: `GET /quiz/api/admin/track-log` — alt der faktisk spillede (HC poll + MusicKit push)
- **MusicKit CDN loaded dynamisk** kun for Apple Music provider (fjerner Safari autoplay dialog)
- **Revert open location** — poppede Music.app i forgrunden, fjernet helt
- Play playlist API: `POST /quiz/api/admin/play-playlist/:id`
- `playAllQueue` scope fix (`window.` prefix overalt)

### PWA Fixes ✅
- Wake Lock fra lobby (ikke kun DJ Mode) + NoSleep video fallback for iOS Safari
- Auto-rejoin kun når `sessionStorage.inActiveSession` er sat (ikke på fresh QR scan)
- Avatar persisteret i localStorage, 18 avatarer (🪕🔔 tilføjet) i 3x6 grid
- Service Worker v2: network-first med cache update, auto-checks hvert 30s
- `overflow-x: hidden` på html/body (ingen horizontal wiggle)
- Preparation modal: Cancel knap + ESC

### Engine ✅
- Fallback artist/song/album names i `generateOptions` — aldrig "—" som svarmulighed
- Questions default 3 (dev mode), min 1
- Host: Exit Game reloader ikke (lader game flow til finished/DJ naturligt)
- Host: "No playlist loaded" tekst, "Playlists" knap (renamed fra "Load Custom Quiz")

## KRITISK: Næste session prioriteter

### 1. Play-by-ID uden open location 🔴
**Problem:** Vi kan ikke spille en sang direkte via Apple Music catalog ID uden at Music.app popper i forgrunden. `open location` vækker appen. osascript `play-exact` kræver at sangen er i lokalt bibliotek med exact name match.
**Research:** Find en måde at spille en Apple Music catalog track via osascript UDEN at bringe Music.app i forgrunden og uden at søge lokalt bibliotek.
**Workaround nu:** `addToLibrary(songId)` + `play-exact(fullName, artist)` — virker men langsomt for nye sange.

### 2. AirPlay Wake (Wake-on-LAN) 🟡
**Problem:** osascript `set selected of device to true` vækker IKKE Apple TV fra dvale. Music.app UI kan det (klik checkbox).
**Mulig løsning:** Wake-on-LAN packet til Apple TV MAC-adresse. Stue MAC: `f0:d5:bf:ac:30:a5` (fra ARP cache).
**Note:** `active` property på AirPlay devices er nu eksponeret (grøn/rød status i UI).

### 3. PWA Stabilitet 🟡
- Join virkede i E2E men var ustabil fra telefon (fixed: `showQuestion` crash fjernet)
- Wake Lock + screen lock recovery: NoSleep video tilføjet men utestet på device
- Service Worker cache kan give stale content (v2 med auto-update tilføjet)

### 4. Recently Played mangler songId fra live tracks 🟡
- Tracks fra HC now-playing poll har ingen songId
- Klik på dem sender `songId: undefined` → `addToLibrary` sker ikke → `playExact` kan fejle
- Fix: slå songId op via Apple Music catalog search når track mangler id

### 5. UI Polish 🟡
- Play All / Next Song auto-advance mangler robust test
- Event creation: custom dropdowns i stedet for native `<select>` for timer/minutter
- Loader/spinner når en sang downloades til bibliotek

## Hard Rules (opdateret)
10. **ALDRIG native confirm/alert/prompt** — brug altid custom dark-theme modal dialogs

## Filer ændret i denne session
| Fil | Ændring |
|-----|---------|
| `src/apple-music.ts` | `getArtistTopSongs()` metode |
| `src/quiz/engine.ts` | Fallback options i `generateOptions` |
| `src/quiz/event-store.ts` | NY: disk-persisteret event store |
| `src/quiz/routes.ts` | Artist API, events CRUD, play-exact flow, play-log, track-log |
| `src/quiz/ws-handler.ts` | Game state + currentQuestion i join response |
| `src/quiz/public/admin.html` | Cmd+K, artist/album pages, events tab, context menu, volume, AirPlay, confirms |
| `src/quiz/public/admin.css` | Search overlay, content pages, custom selects, song rows, volume slider |
| `src/quiz/public/admin.js` | Custom confirm, removed alert |
| `src/quiz/public/host.html` | Playlists modal, confirm dialog, MusicKit CDN removed |
| `src/quiz/public/host.js` | Event loading, provider status, keyboard nav, prep cancel, questions default 3 |
| `src/quiz/public/play.js` | Wake lock, avatar persistence, auto-rejoin fix, 18 avatars |
| `src/quiz/public/play.css` | 6-column avatar grid, overflow-x hidden |
| `src/quiz/public/player.js` | Dynamic MusicKit CDN load, skip init for HC |
| `src/quiz/public/sw.js` | Service Worker v2: network-first, cache bust, auto-update |
| `src/browser-ws.ts` | Track change log |
| `home/server.ts` | AirPlay active property, play-by-id (reverted) |
| `CLAUDE.md` | Hard Rule #10 |

## Server start
```bash
NODE_ENV=development node server.js
source .env && MCP_WS_URL=ws://localhost:3000/home-ws HOME_API_KEY=$HOME_API_KEY node home/dist/server.js
```

## Debug endpoints
- `GET /quiz/api/admin/play-log` — hvad blev requested vs hvad spillede
- `GET /quiz/api/admin/track-log` — alt der faktisk spillede
- `GET /quiz/api/events` — alle events
- `GET /quiz/api/playback-provider` — aktiv provider
