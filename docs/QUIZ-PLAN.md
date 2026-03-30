# Apple Music Quiz — Multiplayer Party Game

## Vision

En musik-quiz der bringer familien og vennerne sammen. Quizmasteren starter spillet på storskærmen (Apple TV eller en Mac i fullscreen), musikken spiller, og deltagerne svarer fra deres telefoner. Alt drevet af det eksisterende `music_quiz` MCP tool og Apple Music API.

**To spil-modes:**

1. **Web Mode** — Mac i fullscreen + telefoner via QR-kode (fase 1)
2. **TV Mode** — tvOS app på Apple TV + telefoner via QR-kode (fase 2)

Begge modes deler samme backend, same deltager-PWA, og same game engine. Forskellen er kun hvad der driver storskærmen.

---

## Forudsætninger

- Apple Music abonnement (til afspilning)
- Apple Developer konto ($99/år — allerede aktiv)
- MCP server kørende på `music.broberg.dk` (Fly.io)
- Home controller på Mac (til Web Mode afspilning)

---

## Fase 1: Web Quiz (Fuld web-oplevelse)

### Overblik

```
┌─────────────────────────────────────────────────┐
│  Mac Browser (fullscreen)                       │
│  music.broberg.dk/quiz/host                     │
│  ┌───────────────────────────────────────────┐  │
│  │  Quiz Host UI                             │  │
│  │  - Viser spørgsmål, artwork, scoreboard   │  │
│  │  - Afspiller musik via Home Controller    │  │
│  │  - Viser QR-kode til deltagere            │  │
│  └───────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
        ▲ WebSocket ▼
┌─────────────────────────────────────────────────┐
│  music.broberg.dk  (MCP server / Fly.io)        │
│  ┌────────────┐ ┌────────────┐ ┌─────────────┐ │
│  │ Quiz Game  │ │ Apple Music│ │   Home WS   │ │
│  │ Engine     │ │ API        │ │   Bridge    │ │
│  └────────────┘ └────────────┘ └─────────────┘ │
└─────────────────────────────────────────────────┘
        ▲ WebSocket ▼
┌──────────┐ ┌──────────┐ ┌──────────┐
│ iPhone 1 │ │ iPhone 2 │ │ iPhone 3 │
│ PWA      │ │ PWA      │ │ PWA      │
│ /quiz/   │ │ /quiz/   │ │ /quiz/   │
│  play    │ │  play    │ │  play    │
└──────────┘ └──────────┘ └──────────┘
```

### F1.1: Quiz Game Engine (server-side)

**Fil:** `src/quiz/engine.ts`

Game engine der orkestrerer hele quiz-flowet server-side. Stateful per session.

```typescript
interface QuizSession {
  id: string;                    // 6-char join code (f.eks. "ROCK42")
  hostId: string;                // WebSocket connection id for host
  players: Map<string, Player>;  // spillere indexed by connection id
  config: QuizConfig;
  state: GameState;
  currentQuestion: number;
  questions: QuizQuestion[];
  timer: NodeJS.Timeout | null;
}

interface Player {
  id: string;
  name: string;
  avatar: string;      // emoji valgt ved join
  score: number;
  streak: number;      // consecutive correct answers
  answers: Answer[];   // historik for scoreboard
}

interface QuizConfig {
  questionCount: number;       // 5-20
  timeLimit: number;           // sekunder per spørgsmål (10-30)
  quizType: QuizType;          // guess-the-artist | guess-the-song | guess-the-album | guess-the-year | intro-quiz | mixed
  source: QuizSource;          // recently-played | heavy-rotation | library | charts | artist
  sourceArtist?: string;       // hvis source === 'artist'
  decade?: string;             // f.eks. "1980" for 80s
  genre?: string;
  difficulty: 'easy' | 'medium' | 'hard';
}

type GameState =
  | 'lobby'           // venter på spillere
  | 'countdown'       // 3-2-1 før spørgsmål
  | 'playing'         // musik spiller, spillere svarer
  | 'reveal'          // viser korrekt svar + point
  | 'scoreboard'      // viser rangering mellem spørgsmål
  | 'finished';       // slut — final scoreboard

interface QuizQuestion {
  songId: string;
  songName: string;
  artistName: string;
  albumName: string;
  albumArtwork: string;      // URL fra Apple Music
  releaseYear: number;
  previewUrl?: string;       // 30s preview (fallback)
  options: string[];          // 4 svarmuligheder
  correctIndex: number;
  hint?: string;
}
```

**Game loop:**

1. Host opretter session → får join-kode (f.eks. "ROCK42")
2. Spillere scanner QR / indtaster kode → joiner lobby
3. Host trykker "Start" → engine kalder `music_quiz` MCP tool for at generere spørgsmål
4. Per spørgsmål:
   - State → `countdown` (3-2-1 animation på host + player screens)
   - State → `playing` — musik starter via Home Controller, timer kører
   - Spillere ser 4 svarmuligheder, trykker på svar
   - Points: hurtigere svar = flere point (1000 max, falder lineært med tid)
   - Streak bonus: 2x efter 3 korrekte i træk
   - State → `reveal` — viser korrekt svar, artwork, hvem der svarede rigtigt
   - State → `scoreboard` — animeret leaderboard
5. Efter sidste spørgsmål: `finished` — podium-animation, confetti

**Vigtige detaljer:**

- Brug det eksisterende `music_quiz` MCP tool internt til at generere spørgsmål
- Engine håndterer race conditions (svar efter timer, disconnect/reconnect)
- Sessioner timeout efter 30 min inaktivitet
- Max 8 spillere per session (for overskuelighed)

### F1.2: Quiz Host UI (storskærm)

**Fil:** `src/quiz/public/host.html` (eller route i eksisterende Express server)
**Route:** `GET /quiz/host`

Single-page app optimeret til fullscreen visning på stor skærm. Ingen scroll, ingen input-felter — alt styres via keyboard shortcuts eller fra telefon.

**Screens:**

1. **Setup Screen**
   - Konfigurer quiz (type, antal, kilde, tidsgrænse)
   - Stor QR-kode med join-URL: `music.broberg.dk/quiz/play?code=ROCK42`
   - Join-kode vises stort: `ROCK42`
   - Liste over tilsluttede spillere (live-opdateret)
   - "Start Quiz" knap (eller tryk Space)

2. **Countdown Screen**
   - Spørgsmålsnummer (`3 / 10`)
   - 3-2-1 countdown animation
   - Quiz-type hint ("Gæt kunstneren!")

3. **Question Screen**
   - Album artwork (stort, centreret)
   - 4 svarmuligheder (A/B/C/D med farver)
   - Countdown-timer (cirkulær progress)
   - Antal spillere der har svaret: `3/5 har svaret`
   - Musik spiller i baggrunden

4. **Reveal Screen**
   - Korrekt svar highlighted i grøn
   - Album artwork + sang-info
   - Hvem svarede rigtigt (avatars)
   - Point-animation per spiller

5. **Scoreboard Screen**
   - Animeret leaderboard (spillere rykker op/ned)
   - Avatar + navn + score + streak
   - Top 3 highlighted

6. **Final Screen**
   - Podium (1st, 2nd, 3rd)
   - Confetti-animation
   - Fuld statistik
   - "Spil igen" knap

**Teknisk:**

- Vanilla HTML/CSS/JS (ingen framework — holdes simpelt for WebView-kompatibilitet i fase 2)
- WebSocket forbindelse til server for real-time game state
- CSS custom properties for theming (mørkt tema, musik-vibes)
- Responsive: fungerer på 1080p+ skærme
- Keyboard shortcuts: Space (next), Escape (back to setup)
- Ingen lyd-afspilning i browseren — al musik via Home Controller

**Design-retning:**

- Mørk baggrund (#0a0a0a)
- Gradient accents (purple → pink for musik-vibes)
- Store fonts, læsbare på afstand
- Smooth animations (CSS transitions + keyframes)
- Album artwork som hero-element
- Inspiration: Kahoot! men med mere æstetik

### F1.3: Player PWA (deltager-telefon)

**Route:** `GET /quiz/play`
**Manifest:** `GET /quiz/manifest.json`
**Service Worker:** `GET /quiz/sw.js`

Progressive Web App der installeres via "Tilføj til hjemmeskærm" efter QR-scan.

**Screens:**

1. **Join Screen**
   - Hvis `?code=ROCK42` i URL: auto-udfyldt
   - Ellers: Indtast join-kode (6 tegn)
   - Vælg navn (max 12 tegn)
   - Vælg avatar (grid af 16 emojis: 🎸🎤🎹🥁🎺🎻🎵🎶🎧🎼🪘🪗🎷🪈🪇🫧)
   - "Join" knap

2. **Lobby Screen**
   - "Venter på at quizmasteren starter..."
   - Liste over andre spillere (navn + avatar)
   - Pulserende animation

3. **Answer Screen**
   - Spørgsmålsnummer + quiz-type
   - 4 store svarknapper (farvekodet: blå, rød, grøn, gul)
   - Countdown-timer synkroniseret med host
   - Vibrering ved tryk (navigator.vibrate)
   - Knapperne disables efter svar
   - Viser valgt svar med checkmark

4. **Result Screen**
   - ✅ Rigtigt / ❌ Forkert
   - Points earned denne runde
   - Streak counter
   - Din placering

5. **Final Score Screen**
   - Din endelige placering
   - Total score
   - Statistik: korrekte svar, gennemsnitlig svartid, longest streak

**Teknisk:**

- PWA med manifest + service worker for offline shell
- Viewport: `width=device-width, initial-scale=1, user-scalable=no`
- Touch-optimeret (store knapper, minimum 48x48px tap targets)
- WebSocket forbindelse til server
- Reconnect-logik: hvis forbindelse droppes, auto-reconnect med session ID
- Ingen lyd-afspilning på telefonen
- CSS: mobil-first, max-width 420px, centered

**PWA manifest:**

```json
{
  "name": "Music Quiz",
  "short_name": "Quiz",
  "description": "Multiplayer music quiz powered by Apple Music",
  "start_url": "/quiz/play",
  "display": "standalone",
  "background_color": "#0a0a0a",
  "theme_color": "#8b5cf6",
  "icons": [
    { "src": "/quiz/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/quiz/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

### F1.4: WebSocket Protocol

**Endpoint:** `wss://music.broberg.dk/quiz-ws`

Alle beskeder er JSON med `type` felt.

**Host → Server:**

```typescript
{ type: 'create_session', config: QuizConfig }
{ type: 'start_quiz' }
{ type: 'next_question' }        // manuelt (hvis auto-advance er slået fra)
{ type: 'skip_question' }
{ type: 'end_quiz' }
{ type: 'kick_player', playerId: string }
```

**Server → Host:**

```typescript
{ type: 'session_created', sessionId: string, joinCode: string }
{ type: 'player_joined', player: Player }
{ type: 'player_left', playerId: string }
{ type: 'game_state', state: GameState, question?: QuizQuestion, scores?: PlayerScore[] }
{ type: 'answer_received', playerId: string, total: number, expected: number }
{ type: 'question_results', results: QuestionResult[] }
{ type: 'final_results', rankings: FinalRanking[] }
```

**Player → Server:**

```typescript
{ type: 'join_session', joinCode: string, name: string, avatar: string }
{ type: 'submit_answer', questionIndex: number, answerIndex: number, timeMs: number }
```

**Server → Player:**

```typescript
{ type: 'joined', sessionId: string, player: Player, players: Player[] }
{ type: 'game_state', state: GameState, options?: string[], timeLimit?: number }
{ type: 'answer_result', correct: boolean, points: number, totalScore: number, rank: number }
{ type: 'final_result', rank: number, totalScore: number, stats: PlayerStats }
{ type: 'error', message: string }
```

### F1.5: Music Playback Integration

Musik-afspilning sker via det eksisterende Home Controller WebSocket.

Når game engine skal spille en sang:

1. Engine har `songId` fra quiz-spørgsmålet
2. Kalder internt `search_and_play` eller `play` tool via Home Controller bridge
3. Home Controller sender AppleScript til Music.app på Mac'en
4. Musik spiller ud af Mac'ens højttalere (eller via AirPlay til TV/speaker)

**Fallback (ingen Home Controller):**

Hvis Home Controller ikke er tilsluttet, brug Apple Music 30-second preview URLs:
- `previewUrl` er inkluderet i quiz-spørgsmålet fra Apple Music API
- Afspilles som `<audio>` element i host-browseren
- Markér tydeligt i UI at det er preview-mode

### F1.6: Server Routes

Tilføj til eksisterende Express server i `src/server.ts`:

```
GET  /quiz              → redirect til /quiz/host
GET  /quiz/host         → Host UI (static HTML)
GET  /quiz/play         → Player PWA (static HTML)
GET  /quiz/manifest.json → PWA manifest
GET  /quiz/sw.js        → Service worker
GET  /quiz/icon-192.png → App icon
GET  /quiz/icon-512.png → App icon
GET  /quiz/api/session/:code → Session info (for player join validation)
WSS  /quiz-ws           → WebSocket endpoint for game communication
```

### F1.7: Filstruktur (nye filer)

```
src/
  quiz/
    engine.ts           # Game engine (session management, scoring, game loop)
    routes.ts           # Express routes for quiz endpoints
    ws-handler.ts       # WebSocket handler for quiz game
    types.ts            # TypeScript interfaces for quiz
    public/
      host.html         # Host UI (fullscreen storskærm)
      host.css          # Host styling
      host.js           # Host client-side logic
      play.html         # Player PWA
      play.css          # Player styling
      play.js           # Player client-side logic
      manifest.json     # PWA manifest
      sw.js             # Service worker
      icon-192.png      # App icon
      icon-512.png      # App icon
```

### F1.8: Implementeringsrækkefølge

1. `types.ts` — alle interfaces
2. `engine.ts` — game engine med session management
3. `ws-handler.ts` — WebSocket handler
4. `routes.ts` — Express routes
5. Integrér routes + ws i `src/server.ts`
6. `host.html` + `host.css` + `host.js` — host UI
7. `play.html` + `play.css` + `play.js` — player PWA
8. `manifest.json` + `sw.js` — PWA support
9. Generer app icons (192 + 512px)
10. Test lokalt med `npm run dev`
11. Deploy til Fly.io

---

## Fase 2: tvOS App (Apple TV)

### Overblik

tvOS-appen erstatter Mac-browseren som storskærm. Deltagerne bruger præcis samme PWA som i fase 1.

```
┌─────────────────────────────────────────────────┐
│  Apple TV                                       │
│  ┌───────────────────────────────────────────┐  │
│  │  SwiftUI Shell                            │  │
│  │  ┌─────────────────────────────────────┐  │  │
│  │  │  WKWebView                          │  │  │
│  │  │  music.broberg.dk/quiz/tv           │  │  │
│  │  └─────────────────────────────────────┘  │  │
│  │  ┌─────────────┐  ┌────────────────────┐  │  │
│  │  │  MusicKit   │  │  Siri Remote       │  │  │
│  │  │  Playback   │  │  Focus Engine      │  │  │
│  │  └─────────────┘  └────────────────────┘  │  │
│  └───────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

### F2.1: Xcode Project Setup

**Projekt:** `MusicQuiz` (tvOS app)
**Bundle ID:** `dk.broberg.musicquiz`
**Minimum tvOS:** 17.0
**Capabilities:** MusicKit

**Filstruktur:**

```
MusicQuiz/
  MusicQuiz.xcodeproj
  MusicQuiz/
    App.swift                 # @main entry point
    ContentView.swift         # Root view med WKWebView
    QuizWebView.swift         # WKWebView wrapper med JS bridge
    MusicPlayer.swift         # MusicKit playback controller
    BridgeHandler.swift       # JS ↔ Swift message handler
    RemoteHandler.swift       # Siri Remote focus/navigation
    Info.plist
    Assets.xcassets/
      AppIcon.appiconset/     # tvOS app icons (krav: 400x240, 800x480, 1280x768)
      LaunchImage.launchimage/
    Entitlements.entitlements  # MusicKit entitlement
```

### F2.2: SwiftUI Shell

**`App.swift`:**

```swift
import SwiftUI
import MusicKit

@main
struct MusicQuizApp: App {
    @StateObject private var musicPlayer = MusicPlayer()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(musicPlayer)
                .task {
                    await MusicAuthorization.request()
                }
        }
    }
}
```

**`ContentView.swift`:**

```swift
import SwiftUI

struct ContentView: View {
    @EnvironmentObject var musicPlayer: MusicPlayer

    var body: some View {
        QuizWebView(
            url: URL(string: "https://music.broberg.dk/quiz/tv")!,
            musicPlayer: musicPlayer
        )
        .ignoresSafeArea()
    }
}
```

### F2.3: WKWebView + JavaScript Bridge

**`QuizWebView.swift`:**

UIViewRepresentable wrapper der:
- Loader `music.broberg.dk/quiz/tv` i WKWebView
- Registrerer JavaScript message handler: `window.webkit.messageHandlers.quiz`
- Injicerer `window.MusicQuiz` JavaScript objekt som bridge

**`BridgeHandler.swift`:**

Håndterer beskeder fra JavaScript:

```swift
// JS → Swift (via window.webkit.messageHandlers.quiz.postMessage)
enum BridgeMessage {
    case playSong(songId: String)
    case pausePlayback
    case resumePlayback
    case setVolume(level: Float)    // 0.0 - 1.0
    case nextTrack
    case getPlaybackState
}

// Swift → JS (via webView.evaluateJavaScript)
// window.MusicQuiz.onPlaybackState({ isPlaying, songId, elapsed, duration })
// window.MusicQuiz.onMusicKitReady(true/false)
```

### F2.4: MusicKit Playback

**`MusicPlayer.swift`:**

```swift
import MusicKit

class MusicPlayer: ObservableObject {
    @Published var isPlaying = false
    @Published var currentSongId: String?

    private let player = ApplicationMusicPlayer.shared

    func play(songId: String) async throws {
        let request = MusicCatalogResourceRequest<Song>(
            matching: \.id, equalTo: MusicItemID(songId)
        )
        let response = try await request.response()
        guard let song = response.items.first else { return }

        player.queue = [song]
        try await player.play()
        isPlaying = true
        currentSongId = songId
    }

    func pause() { player.pause(); isPlaying = false }
    func resume() async throws { try await player.play(); isPlaying = true }
    func setVolume(_ level: Float) { /* MPVolumeView approach */ }
}
```

Key point: MusicKit på tvOS afspiller direkte på Apple TV — ingen Home Controller nødvendig. Kræver at brugeren har Apple Music abonnement og er logget ind på Apple TV.

### F2.5: TV-optimeret Host UI

**Route:** `GET /quiz/tv`

Variant af host UI optimeret til tvOS WKWebView:
- Ingen keyboard shortcuts (bruger Siri Remote via focus engine)
- Større fonts og knapper (mindst 66pt for læsbarhed på TV)
- Focus-kompatibelt: alle interaktive elementer har `tabindex`
- Brug `window.webkit.messageHandlers.quiz.postMessage()` til playback i stedet for Home Controller
- Feature-detect: `if (window.webkit?.messageHandlers?.quiz)` → tvOS mode, ellers → web mode

Alternativt kan `/quiz/tv` være identisk med `/quiz/host` men med auto-detect af environment. Ét codebase, to modes.

### F2.6: Siri Remote Navigation

**`RemoteHandler.swift`:**

Focus engine mapping:
- **Swipe/D-pad:** Navigér mellem svarknapper og UI-elementer
- **Select (tryk):** Vælg / Start
- **Menu:** Tilbage til forrige screen
- **Play/Pause:** Toggle musik afspilning

WKWebView på tvOS understøtter focus-baseret navigation automatisk for elementer med `tabindex`. Ingen custom gesture recognizers nødvendige for basalt brug.

### F2.7: TestFlight Distribution

1. Archive i Xcode → Upload til App Store Connect
2. Tilføj internal testers (din egen Apple ID)
3. TestFlight build review: typisk < 24 timer
4. Installér TestFlight app på Apple TV → download build
5. Kræver: betalt Apple Developer Program ($99/år, allerede aktiv)

### F2.8: App Store Submission (valgfri)

Når klar til offentlig release:
- App Review Guidelines: appen er en quiz-app med MusicKit (solid use case, ikke en tom WebView)
- Privacy policy påkrævet (kan hostes på music.broberg.dk/privacy)
- Screenshots: mindst 1 screenshot i 1920x1080 eller 3840x2160
- App description på engelsk + dansk
- Rating: 4+ (ingen upassende indhold)

---

## Delt infrastruktur (begge faser)

### Quiz API endpoints

Disse endpoints bruges af både web host og tvOS app:

```
POST   /quiz/api/session          # Opret ny session
GET    /quiz/api/session/:code    # Hent session info
DELETE /quiz/api/session/:code    # Afslut session
WSS    /quiz-ws                   # Real-time game communication
```

### Scoring-algoritme

```typescript
function calculatePoints(timeMs: number, timeLimitMs: number, streak: number): number {
  if (timeMs > timeLimitMs) return 0;

  // Base: 1000 point, falder lineært med tid
  const timeRatio = 1 - (timeMs / timeLimitMs);
  const basePoints = Math.round(1000 * timeRatio);

  // Streak bonus: 1.5x efter 3, 2x efter 5
  const multiplier = streak >= 5 ? 2.0 : streak >= 3 ? 1.5 : 1.0;

  return Math.round(basePoints * multiplier);
}
```

### Apple Music Artwork

Artwork URLs fra Apple Music API følger dette mønster:
```
https://is1-ssl.mzstatic.com/image/thumb/{path}/{w}x{h}.jpg
```
Brug `600x600` for host/TV display, `200x200` for player thumbnails.

---

## Implementeringsstrategi

### Fase 1 estimat: 3-5 cc sessioner

| Session | Scope |
|---------|-------|
| 1 | `types.ts` + `engine.ts` + `ws-handler.ts` + `routes.ts` + server integration |
| 2 | `host.html/css/js` — komplet host UI med alle 6 screens |
| 3 | `play.html/css/js` — komplet player PWA med alle 5 screens |
| 4 | PWA assets (manifest, sw, icons) + end-to-end test + deploy |
| 5 | Polish: animations, edge cases, reconnect-logik, preview fallback |

### Fase 2 estimat: 2-3 cc sessioner

| Session | Scope |
|---------|-------|
| 1 | Xcode project setup + SwiftUI shell + WKWebView + MusicKit auth |
| 2 | JS ↔ Swift bridge + MusicPlayer + `/quiz/tv` route |
| 3 | Siri Remote focus + TestFlight build + polish |

### Definition of Done

**Fase 1:**
- [ ] Quizmaster kan oprette session og se QR-kode på storskærm
- [ ] 2+ spillere kan joine via QR-kode på telefon
- [ ] Quiz afspiller musik via Home Controller (eller preview fallback)
- [ ] Spillere kan svare og se point i real-time
- [ ] Scoreboard vises mellem spørgsmål
- [ ] Final podium med statistik
- [ ] Deployed og tilgængeligt på music.broberg.dk/quiz

**Fase 2:**
- [ ] tvOS app loader quiz UI i WKWebView
- [ ] MusicKit afspiller sange direkte på Apple TV
- [ ] Siri Remote kan navigere UI
- [ ] TestFlight build installeret på Apple TV
- [ ] Samme player PWA fungerer med tvOS host

---

## Tekniske noter

### Eksisterende kode der genbruges

- `music_quiz` MCP tool → kalds internt fra game engine for at generere spørgsmål
- Apple Music API auth → genbruges for catalog search og artwork
- Home Controller WebSocket → genbruges for afspilning i web mode
- Express server i `src/server.ts` → nye routes tilføjes

### Dependencies (kun nye)

- `ws` — allerede brugt i projektet til Home Controller
- Ingen nye npm dependencies nødvendige for fase 1
- Xcode + Swift dependencies for fase 2 (MusicKit er framework, ikke CocoaPod)

### Sikkerhed

- Join-koder er 6-tegn alfanumeriske, case-insensitive, expires efter 30 min
- Ingen persondata gemmes (spillernavne er kun i memory)
- WebSocket connections autentificeres per session
- Rate limiting på session creation (max 10 per time per IP)

### Performance

- Game state holdes i memory (ikke database) — sessions er kortlivede
- WebSocket messages er typisk < 1KB
- Album artwork caches via CDN (Apple Music's mzstatic.com)
- Max 8 spillere × ~10 messages per spørgsmål = triviel load

---

*Plan version 1.0 — Christian Broberg / WebHouse ApS*
*Genereret: 31. marts 2026*
