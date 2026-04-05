# Next Session Prompt

Paste this to start a new session:

---

## Context

Læs `CLAUDE.md` i project root — den indeholder komplet status over hele projektet.

## Hvad blev lavet i denne session (5-6. april 2026)

### Gossip Bank ✅
- 100 fact-checked gossip questions i `data/quiz-gossip-bank.json`
- Gossip Round quiz type + Include gossip checkbox
- Sonnet fact-check kørte, 10 opdigtede spørgsmål fjernet
- `src/quiz/gossip-bank.ts` — ny modul med expiry-filter

### Admin Setup Tab ✅
- Ny Setup tab med Audio Source, Volume/AirPlay, System Audio Output detection
- Stats dashboard: trivia (509), gossip (100), events, playlists, songs played
- Logo i header, fullscreen toggle, provider status link

### DJ Redesign v4.0 (DELVIST — PLAYBACK BROKEN)
- DJ tab er FØRSTE tab i admin — altid aktiv, ingen "Start DJ" knap
- "Picks" renamed til "Song Credits" overalt
- Host stripped til quiz-only — DJ/NP screens fjernet
- Persistent DJ state: credits + kø i `data/dj-state.json` (overlever restart)
- "Add to DJ" i Cmd+K kontekstmenu
- Play All fra playlists tilføjer til DJ-kø
- Player reconnect_dj — spillere med credits kan DJ-søge uden aktiv session
- Auto dj_activated sendt 5s efter ceremony
- P0 fix: DJ autoplay guard stopper polling under quiz
- Library cleanup DISABLED (slettede brugerens egne sange)
- Toast notification system

### BROKEN: Playback routing er LORT 🔴
**Det store problem:** MusicKit JS kører i browseren. Når host navigerer til admin (eller omvendt), dør MusicKit-instansen og musik stopper. Admin har fået en `handleAdminPlaybackCommand` men den virker ikke korrekt — tryk play fjerner bare numre fra DJ-listen uden at spille.

**Root cause:** Playback arkitekturen er en labyrint:
1. `player.js` — universal player modul (browser-side), brugt af admin+host
2. `MusicKitWebProvider` (server) — sender WS `playback_command` til host/admin browser
3. `handlePlaybackCommand` (host.js) — lytter på WS, kalder MusicKit JS direkte
4. `handleAdminPlaybackCommand` (admin.html) — forsøg på samme men broken
5. `Home Controller` — osascript, uafhængig af browser (virker altid)
6. `playDjSong` (ws-handler.ts) — server-side, vælger provider, sender command

**Problemerne:**
- `setSendToHost` på MusicKit provider peger på ÉN connection (host ELLER admin, ikke begge)
- Admin's `handleAdminPlaybackCommand` kalder `Player.play()` men sender OGSÅ response via WS — dobbelt playback trigger
- `setupPlayPause()` kalder `adminDjNext()` som advancer køen på serveren MEN playback sker via en ANDEN codepath (WS command)
- `advanceQueue()` markerer sang som played INDEN den faktisk spiller — hvis playback fejler er sangen "brugt"
- DJ autoplay polling og manual play konkurrerer

## KRITISK: Næste session — Code Review + Refactor

### 1. Playback Refactor 🔴🔴🔴
Hele playback-kæden skal simplificeres:

**Forslag: Admin ejer MusicKit, host er passiv display**
- Admin loader MusicKit JS og er den ENESTE der spiller musik
- Host viser kun quiz UI — musik under quiz styres af admin's MusicKit
- DJ kø spilles af admin's MusicKit direkte — ingen server WS proxy
- Server holder state (kø, credits) men sender IKKE playback commands
- `Player.play(songId)` i admin kalder MusicKit direkte, IKKE via server

**Eller: HC som DJ provider**
- DJ altid via Home Controller (Music.app, uafhængig af browser)
- Quiz kan bruge MusicKit JS (host) eller HC
- Simpelt: server → HC → Music.app → lyd

### 2. Player.js refactor 🔴
- `player.js` bruger `isUsingMusicKit()` check overalt — forvirrende
- HC polling + MusicKit events + Now Playing WS = 3 state sources
- Bør simplificeres til én state machine

### 3. DJ Queue Logic 🟡
- `advanceQueue()` markerer played FØR playback bekræftet
- Ingen retry ved playback fejl — sang bare tabt
- Autoplay polling + manual next kan race condition

### 4. Quiz fejl fra party (P0-P2) 🟡
- Forkerte sangversioner (acoustic/radio edit)
- AI hallucination 42% rejection rate
- checkLibrary broken med MusicKit JS (skip verify allerede delvist fixet)

## Filer ændret i denne session
| Fil | Ændring |
|-----|---------|
| `src/quiz/gossip-bank.ts` | NY: gossip bank modul |
| `src/quiz/dj-mode.ts` | Picks→Credits rename, persistent state, addToQueueDirect, always active |
| `src/quiz/ws-handler.ts` | Admin WS role, P0 autoplay guard, reconnect_dj, playback routing |
| `src/quiz/engine.ts` | MusicKit skip verify, awardCredits rename, cleanup disabled |
| `src/quiz/routes.ts` | Stats API, audio output API, gossip bank import |
| `src/quiz/ai-evaluator.ts` | Gossip type hint |
| `src/quiz/question-bank.ts` | Fixed TOKEN_FILE path bug |
| `src/quiz/types.ts` | "gossip" QuizType, includeGossip config |
| `src/quiz/public/admin.html` | DJ tab, admin WS, toast system, maxi player, context menu |
| `src/quiz/public/admin.css` | DJ tab, toast, maxi player styles |
| `src/quiz/public/host.html` | Stripped DJ/NP screens, gossip round, fullscreen |
| `src/quiz/public/host.js` | Removed DJ functions, credits rename, fullscreen |
| `src/quiz/public/host.css` | Gold pulsating podium |
| `src/quiz/public/play.js` | Credits rename, DJ reconnect |
| `src/quiz/public/play.html` | Credits text |
| `data/quiz-gossip-bank.json` | 100 fact-checked gossip questions |
| `data/gossip-raw-100.json` | Raw generated gossip |
| `data/dj-state.json` | Persistent DJ state (credits + queue) |
| `scripts/load-gossip-bank.js` | Gossip bank loader |
| `scripts/fact-check-gossip.js` | Sonnet fact-checker for gossip |

## Server start
```bash
NODE_ENV=development node server.js
source .env && MCP_WS_URL=ws://localhost:3000/home-ws HOME_API_KEY=$HOME_API_KEY node home/dist/server.js
```

## Hard Rules (opdateret)
10. **ALDRIG native confirm/alert/prompt** — brug altid custom dark-theme modal dialogs
11. **ALDRIG foreslå at stoppe** — brugeren bestemmer hvornår sessionen slutter
12. **Data i `data/`** — ALDRIG `/tmp/` for persisterede data
13. **Trivia = fakta (permanent)** — Gossip = tidsbestemt (har expiry)
14. **ALDRIG `target="_blank"`** — ingen nye faneblade inden for sitet
15. **ALDRIG library cleanup** — slet ALDRIG brugerens sange
16. **DJ er altid aktiv** — ingen Start/Stop DJ knap
17. **Mini player er afspilleren** — ingen separate DJ playback controls
