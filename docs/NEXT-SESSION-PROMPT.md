# Next Session Prompt

Paste this to start a new session:

---

## Context

Læs `CLAUDE.md` i project root — den indeholder komplet status over hele projektet.

## Hvad blev lavet i denne session (3. april 2026)

### Quiz Engine v2 — AI Trivia + Verified Pool ✅
- 5 nye trivia-typer: country-of-origin, band-members, artist-trivia, film-soundtrack, tv-theme
- AI Enricher: Claude Haiku genererer trivia, Claude Sonnet (4) fact-checker
- Token tracking: Haiku ~5K + Sonnet ~4K per quiz
- Verified Pool approach: download → verify → build questions (ZERO runtime failures)
- 1158-artist bruttoliste i `data/artist-pool.json` (37 lande, alle genrer, 1700s-2020s)
- 67 danske kunstnere (Gasolin', Kim Larsen, TV-2, D-A-D, Kashmir, L.O.C., Kesi, Gilli, etc.)
- Artist-dedup: ingen kunstner to gange i en quiz, ingen sang to gange
- Normalize-dedup: stripper (Live), (Remastered), English Version, feat. etc.
- Interleaving: ~50% trivia fra bank, ~50% frisk fra AI. Aldrig to trivia i træk
- "Researching..." modal med live sekunder-nedtælling under quiz-generation

### Trivia Question Bank ✅
- **499 validerede trivia-spørgsmål** i `data/quiz-question-bank.json`
- 114 artist-trivia, 105 country-of-origin, 97 band-members, 92 film-soundtrack, 82 tv-theme
- 8 batches manuelt kurateret (0 API cost)
- Bank vokser automatisk: nye trivia fra AI gemmes efter fact-check + pool-match
- Alle persisteret i `data/` (IKKE /tmp/ — var en kritisk bug der blev fixet)

### Gossip Bank Design ✅
- 10 gossip-eksempler i `data/gossip-examples.json`
- Format: questionType "gossip", gossipDate, category, expiresAfter
- Kategorier: breakup, controversy, dating, scandal, military, beef, legal, career
- Klar til implementation som egen DB + question type

### Song Pool ✅
- `data/artist-pool.json`: 1158 kunstnere → shuffle → søg Apple Music → verified pool
- Fjernet hardcoded max 25 sang cap i generateQuiz
- Pool skalerer med question count (5x)
- 95% hit rate på Apple Music søgning per kunstner
- Covers filtreres fra (matcher artistnavn)

### AirPlay Toggle ✅
- osascript `set selected of device to true/false` virker
- Wake af sovende Apple TV virker via osascript
- Toggle UI i Admin med live status-refresh

### PWA Fixes ✅
- Wake Lock: native + NoSleep video parallelt
- WS reconnect auto-rejoin med `inActiveSession` guard
- Service Worker v3

### UI Improvements ✅
- Timer sekunder på player PWA (ved siden af progress bar)
- Fun fact callout (💡) under reveal — større, tydeligere
- Podium-højder: 1. > 2. > 3. (CSS padding)
- Picks earned: rounded corners + padding
- ··· context menu på Recently Played tracks
- ··· context menu i Cmd+K søgeresultater (songs)
- Mini player: forbliver synlig ved pause/stop
- Provider status ved page load (Home Controller vises korrekt)
- Howler.js + applause.mp3 ved podium
- "Researching..." → "Preparing Your Quiz" modal transition

### Bug Fixes ✅
- TDZ: hostNpState + musicKitAuthorized variabler moved before usage
- Duplicate players: reconnect sletter gammel session-entry
- Theme songs: hardcoded Apple Music catalog IDs (Frank Sinatra, Queen)
- Double verifyPlaying log entries removed
- MUTE_ALL=true skips song verification

### E2E Testing ✅
- `e2e-screenshot-test-3players.js`: 4 vinduer, screenshots, post-test validation
- `e2e-headless-muted-1player.js`: headless, 1 browser, stabil
- `e2e-observer.js`: headless watcher under manuel test
- Post-test validation: duplicate artists, question types, music match, bank growth
- Anthropic SDK 0.82.0

## KRITISK: Næste session prioriteter

### 1. Gossip Bank Implementation 🔴
- Ny `quiz-gossip-bank.json` i `data/`
- Ny question type `gossip` i types.ts
- Populate med 50+ gossip spørgsmål
- Quiz setting: "Include gossip" toggle
- Gossip kan køres som selvstændig runde

### 2. Quiz Mix 50/50 Bank/Frisk 🔴
- Wire quiz til at hente 50% trivia fra bank, 50% frisk fra AI
- Trivia bank runner script (kør manuelt for at vokse banken)
- Bed Haiku om flere trivia (30+ i stedet for 20) for bedre coverage

### 3. Sonnet Fact-Check Læmpning 🟡
- "Cannot verify" bør IKKE afvise — kun "bevisligt forkert"
- Ændr prompt til: kun reject det der er FAKTUELT FORKERT
- Stikprøver: fact-check 50% tilfældigt i stedet for alle

### 4. E2E Script Fixes 🟡
- Script timeout efter Q38 (venter på Q39 der ikke eksisterer)
- Auto-close efter 10s Champions (virker ikke altid)
- Test med 100Q kræver større pool (pool-skalering virker men verify er bottleneck)

### 5. Sound Design (SOUND.md) 🟡
- Kun applause.mp3 implementeret — resten mangler (correct, wrong, countdown, tick, etc.)
- Howler.js er klar — mangler CC0 lydeffekter fra Pixabay

### 6. Setup Tab i Admin 🟡
- Flyt controller/AirPlay/volume til Setup tab
- Stats dashboard: bank size, quizzes completed, songs played, events held
- Logo top-left i header

### 7. Exclude List 🟡
- Admin UI: ekskluder kunstnere fra quiz (f.eks. Kanye)

### 8. Nye Kunstnere i Pool Automatisk 🟡
- Når AI trivia nævner en kunstner der ikke er i pool → tilføj automatisk

## Hard Rules (opdateret)
10. **ALDRIG native confirm/alert/prompt** — brug altid custom dark-theme modal dialogs
11. **ALDRIG foreslå at stoppe** — brugeren bestemmer hvornår sessionen slutter
12. **Data i `data/`** — ALDRIG `/tmp/` for persisterede data
13. **Trivia = fakta (permanent)** — Gossip = tidsbestemt (har expiry)

## Filer ændret i denne session
| Fil | Ændring |
|-----|---------|
| `src/quiz/ai-enricher.ts` | NY: AI trivia generation + Sonnet fact-check + token logging |
| `src/quiz/question-bank.ts` | NY: global question bank persistence (data/ dir) |
| `src/quiz/engine.ts` | Verified pool, trivia integration, artist dedup, no verify backoff |
| `src/quiz.ts` | Artist pool approach (1158 artists), removed 25-cap, pool scaling |
| `src/quiz/types.ts` | 5 nye QuizTypes, isTrivia, backgroundSong fields, funFact |
| `src/quiz/ai-evaluator.ts` | Type hints for nye trivia-typer |
| `src/quiz/ws-handler.ts` | isTrivia + funFact i WS messages, researching phase |
| `src/quiz/playlist-store.ts` | data/ dir i stedet for /tmp/ |
| `src/quiz/event-store.ts` | data/ dir i stedet for /tmp/ |
| `src/quiz/public/host.html` | Fun fact element, researching modal, timer default 5, Mixed label |
| `src/quiz/public/host.js` | Researching modal, type labels, funFact reveal, TDZ fixes, Howler |
| `src/quiz/public/host.css` | Podium heights |
| `src/quiz/public/play.js` | Timer seconds, type labels, answer result artist+year+funFact |
| `src/quiz/public/play.html` | Timer seconds span |
| `src/quiz/public/play.css` | Timer padding, stat row rounded corners |
| `src/quiz/public/admin.html` | AirPlay toggle, song ctx in search, mini player pause state |
| `src/quiz/public/admin.js` | ··· context menu on Recently Played |
| `src/quiz/public/admin.css` | Search item ctx button |
| `src/quiz/public/sw.js` | v3 cache bust |
| `server.js` | /quiz/sounds/ route |
| `data/artist-pool.json` | NY: 1158 kunstnere |
| `data/quiz-question-bank.json` | NY: 499 validerede trivia |
| `data/gossip-examples.json` | NY: 10 gossip format eksempler |
| `data/trivia-batch-001-008.json` | NY: trivia batches |
| `scripts/e2e-screenshot-test-3players.js` | NY: 3-player visual test |
| `scripts/e2e-headless-muted-1player.js` | NY: headless 1-player test |
| `scripts/e2e-observer.js` | NY: headless observer |
| `scripts/merge-artist-pool.js` | NY: merge artist pools |
| `scripts/list-artist-pool.js` | NY: generate text list |

## Server start
```bash
NODE_ENV=development node server.js
source .env && MCP_WS_URL=ws://localhost:3000/home-ws HOME_API_KEY=$HOME_API_KEY node home/dist/server.js
```

## Husk før lørdag
- Fjern `MUTE_ALL=true` fra `.env`
- Kør en manual test med lyd for at verificere Frank Sinatra + Champions
- Test fra telefon (PWA wake lock, join sound, timer seconds)
