# Next Session Prompt: Music Quiz v3.0.0

## Kontekst

Music Quiz er et party-spil bygget oven på en Apple Music MCP server (`music.broberg.dk`). Spillere quizzer om musik fra telefonen, og vinder derefter retten til at vælge musik via DJ Mode. Alt kører på Fly.io med en Home Controller på en Mac der styrer Music.app via osascript.

## Hvad er bygget og virker

### Core Platform
- **34 MCP tools** for Apple Music (catalog, library, playback, AirPlay)
- **Express + Next.js** custom server på Fly.io (Stockholm/arn)
- **Home Controller** via WebSocket "phone home" (Mac → Fly.io, launchd auto-start)
- **OAuth 2.1** med 90-dages JWT tokens for claude.ai
- **Now Playing** landing page med vinyl-spinning sfære (45 RPM rotation, grooves, center hole)
- **GitHub OAuth** login (prod) + auto-login (dev)
- **Token persistence** på Fly.io volume

### Multiplayer Quiz (Phase 1 — komplet)
- **Game Engine** (`src/quiz/engine.ts`): 6-tegn join-koder, max 8 spillere, Kahoot-scoring (1000pts max, streak bonus 1.5x/2x)
- **Host UI** (`/quiz/host`): Vanilla HTML/JS. Setup → lobby med QR → countdown med tick-lyd → spørgsmål → reveal → scoreboard → podium med confetti
- **Player PWA** (`/quiz/play`): Join via QR/kode, emoji avatar, multiple-choice + free-text svar, confetti for vinder, Play Again
- **AI Evaluation** (`src/quiz/ai-evaluator.ts`): Claude haiku evaluerer free-text svar (stavefejl OK, forkortelser OK)
- **WebSocket** (`/quiz-ws`): Real-time host ↔ server ↔ player kommunikation
- **9 Sources**: Mixed (6-source aggregate), Recently Played, Charts, Library, Genre (16), Movie Soundtracks, Danish Music, Live Music, Random Shuffle
- **Custom Quiz Builder** (`/quiz/builder`): Søg Apple Music (sange + albums med expand), curatér playliste, gem/load med navn, start quiz fra curated liste
- **Admin** (`/quiz/admin`): Recently played grid/list med artwork, play-knapper med mini-player, clear used songs
- **Artist-aware search-and-play**: Home Controller itererer resultater for at matche artist
- **Song dedup**: Tracker brugte sange på tværs af sessions, "Skip recent plays" checkbox
- **Preview fallback**: 30s Apple Music preview i browser når ingen Home Controller
- **Custom UI**: Dark theme dropdowns, custom modals (ingen browser alert/confirm), toast notifications

### DJ Mode — Music Democracy (bygget, har bugs)
- **Picks system** (`src/quiz/dj-mode.ts`): #1=5, #2=3, #3=2, rest=1, streak bonus +1
- **Player search**: Albums + sange, picks enforced (disabled ved 0)
- **Queue**: Nye sange shuffles tilfældigt blandt ikke-spillede, første sang auto-plays
- **Host jukebox**: Now-playing hero card med progress gauge via `/ws/now-playing`, autoplay toggle, player chips
- **Reconnect**: `dj_status` check på WS connect → restorer DJ Mode efter page reload
- **Navigation**: DJ Mode link i host nav

### Visual & Polish
- **Vinyl sfære**: Album artwork roterer som 45 RPM plade med grooves og sort center-hul
- **Favicon**: SVG med dark/light mode support (prefers-color-scheme)
- **Logo**: `logo/music-quiz-logo.svg` + `logo/favicon.svg`
- **Playwright E2E test**: `scripts/e2e-quiz-visual.js` — 4 separate browsere på 3440x1440

## Kendte bugs at fikse

### Kritisk
1. **Forkert sang spiller i DJ Mode** — "Stand on the Rock" (Fleetwood Mac) startede "I Saw Her Standing There" (Beatles). Search-and-play matcher stadig forkert trods artist-aware matching. Mulig løsning: søg med eksakt sangnavn som frase, eller brug songId direkte.

2. **DJ Mode autoplay stopper** — Musik stopper efter første sang. Autoplay polling (`djPollInterval`) detecterer ikke sang-slut korrekt. Now-playing state kan skifte til "paused" mellem sange i stedet for "stopped".

3. **Players kan stadig vælge sange efter 0 picks** — `updateDjPicksDisplay` clearer søgeresultater, men timing-issue med eksisterende knapper.

### UX
4. **Player kan ikke navigere fra Now Playing tilbage til DJ Mode** — `history.back()` virker ikke altid. Bør bruge en mere robust approach (evt. sessionStorage med DJ state flag).

5. **Host setup flicker ved reload** — Setup-skærmen vises kortvarigt før DJ Mode activeres via `dj_status`.

6. **E2E test hænger efter Q2** — Timing-issue med reveal + scoreboard + countdown varighed.

## Features til næste session

### Prioritet 1: Fix DJ Mode bugs (3 kritiske)
- Fix sang-matching (brug songId eller eksakt søgning)
- Fix autoplay (bedre end-of-song detection)
- Fix picks enforcement (server-side reject)

### Prioritet 2: DJ Mode UX polish
- Player sticky nav i toppen (Now Playing / Queue links)
- Player kø-visning med Now Playing artwork
- Bedre layout på player DJ Mode skærm

### Prioritet 3: Gameplay modes
- **Steal Round** — Ingen svarede rigtigt? 5 ekstra sekunder, dobbelt points
- **All-In Round** — Sidste spørgsmål: sæt X% af dine points på spil
- **Sound Clash** — To spillere head-to-head, først til at svare
- **Blind Round** — Kun free-text, ingen options, triple points
- **Playlist Battle** — Spillere indsender sange, "hvem valgte denne?" som bonus

### Prioritet 4: Nye features
- **Sangtekster på Now Playing** — Apple Music API lyrics (kræver undersøgelse)
- **Repo omdøbning** — `apple-music-mcp` → `musicquiz` (GitHub + lokal mappe)
- **Phase 2: tvOS app** — Se `docs/QUIZ-PLAN.md`

## Teknisk setup

### API-arkitektur
- **Quiz/DJ/Builder/Admin** kalder Apple Music REST API **direkte** via `AppleMusicClient` (`src/apple-music.ts`)
- **MCP** er kun wrapper-lag for Claude-interaktion (claude.ai / iPhone)
- **Home Controller** kommunikerer via direkte WebSocket, ikke MCP
- Ingen MCP overhead i quiz-flowet

### Lokal udvikling
```bash
# Terminal 1: Server
npx tsc && NODE_ENV=development node server.js

# Terminal 2: Home Controller
./scripts/dev-home.sh

# Terminal 3: E2E test (valgfrit)
node scripts/e2e-quiz-visual.js
```

### Deploy
```bash
fly deploy
```
**VIGTIGT**: Seneste kode er IKKE fuldt deployed. Sidste deploy mangler DJ Mode fixes, vinyl sfære, og mange UI ændringer. Kør `fly deploy` tidligt.

### Filer at læse først
- `src/quiz/engine.ts` — Game engine + custom quiz support
- `src/quiz/dj-mode.ts` — DJ Mode state management
- `src/quiz/ws-handler.ts` — WebSocket handler (quiz + DJ Mode)
- `src/quiz/routes.ts` — Express routes (builder, admin, DJ search, playback)
- `src/quiz/public/host.js` — Host UI logik (alle screens inkl. DJ)
- `src/quiz/public/play.js` — Player UI logik (quiz + DJ)
- `home/server.ts` — Home Controller (osascript, artist-aware search)

### Vigtige patterns
- **Vanilla HTML/JS** til quiz/DJ UI (ikke Next.js) — for fremtidig tvOS WebView
- **Express routes** til auth/redirects (ALDRIG Next.js API routes bag Fly.io proxy)
- **Artist-aware search**: `sendHomeCommand("search-and-play", { query, artist })`
- **Custom selects**: Native `<select>` hidden, custom dropdown wrappers via `initCustomSelects()`
- **DJ Mode state**: In-memory, tabes ved restart. `dj_status` WS message restorer for host reconnect
- **Song dedup**: `usedSongIds` Set + `excludeSongIds` til `generateQuiz()`
- **LAN IP**: `getServerUrl()` replacer localhost med LAN IP for QR-koder
- **Ultrawide test**: Christians skærm er 3440x1440, E2E test positionerer 4 browsere
