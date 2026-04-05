# tvOS App Plan — Music Quiz for Apple TV

> **Status:** PLANNED — can run as independent cc session parallel to web development  
> **Goal:** Native tvOS shell app that displays the quiz host UI on Apple TV and plays music natively via MusicKit  
> **Location:** `apps/tvos/` in the music-quiz monorepo (see `docs/MONOREPO-MIGRATION.md`)

---

## 1. Why a Native Shell (Not Pure Web)

WKWebView on tvOS has critical limitations that prevent a pure web approach:

- **No touch events** — tvOS uses focus-based navigation with Siri Remote
- **No web audio playback** — MusicKit JS in WKWebView cannot play full Apple Music tracks on tvOS
- **No `window.open`** — popup-based auth flows don't work
- **No text input** — Siri Remote keyboard is native UIKit, not web-accessible

The solution is a thin native Swift/SwiftUI shell that:
1. Loads the existing `host.html` quiz UI in a WKWebView
2. Intercepts playback commands via JS bridge and plays music natively using MusicKit framework
3. Handles Siri Remote focus/navigation via UIKit focus engine
4. Manages MusicKit authorization natively (not through web OAuth)

---

## 2. Architecture

```
┌──────────────────────────────────────────────┐
│  Apple TV                                     │
│                                               │
│  ┌─────────────────────────────────────────┐  │
│  │  SwiftUI App                            │  │
│  │                                         │  │
│  │  ┌───────────────────────────────────┐  │  │
│  │  │  WKWebView                        │  │  │
│  │  │  loads: /quiz/host                │  │  │
│  │  │                                   │  │  │
│  │  │  WebSocket → wss://server/quiz-ws │  │  │
│  │  │  role: "host"                     │  │  │
│  │  │                                   │  │  │
│  │  │  JS → postMessage("playback")     │──┤  │
│  │  │  JS ← evaluateJavaScript(result)  │  │  │
│  │  └───────────────────────────────────┘  │  │
│  │                                         │  │
│  │  ┌───────────────────────────────────┐  │  │
│  │  │  NativePlaybackBridge             │  │  │
│  │  │  MusicKit → Apple Music playback  │  │  │
│  │  │  SystemMusicPlayer or AppPlayer   │  │  │
│  │  └───────────────────────────────────┘  │  │
│  │                                         │  │
│  │  ┌───────────────────────────────────┐  │  │
│  │  │  FocusManager                     │  │  │
│  │  │  Siri Remote → JS focus events    │  │  │
│  │  └───────────────────────────────────┘  │  │
│  └─────────────────────────────────────────┘  │
└──────────────────────────────────────────────┘
         │ WebSocket
         ▼
┌──────────────────────┐
│  music.broberg.dk    │
│  Express + MCP       │
│  /quiz-ws endpoint   │
└──────────────────────┘
         │ WebSocket
         ▼
┌──────────────────────┐
│  Player phones       │
│  /quiz/play (PWA)    │
└──────────────────────┘
```

### How Playback Works

The existing codebase has a `PlaybackProvider` abstraction with two implementations:
- `HomeControllerProvider` — sends osascript commands to Mac via WebSocket
- `MusicKitWebProvider` — sends commands to host browser, browser runs MusicKit JS

The tvOS app **reuses the MusicKit Web protocol** — when the tvOS host connects, it sends `set_provider: "musickit-web"`. The server then routes `playback_command` messages to the tvOS WebSocket. But instead of browser JS executing MusicKit JS, the WebView intercepts these commands via `WKScriptMessageHandler` and routes them to native MusicKit.

This means **zero server-side changes** for tvOS playback.

**Playback command flow:**
```
Server → ws "playback_command" {command: "play_by_id", params: {songId: "123"}}
  → WKWebView receives in host.js (existing code)
  → host.js calls window.webkit.messageHandlers.playback.postMessage(command)
  → Swift NativePlaybackBridge receives command
  → Swift calls MusicKit: MusicPlayer.shared.queue = [MusicCatalogResourceRequest(songId)]
  → Swift calls back: webView.evaluateJavaScript("handlePlaybackResponse({...})")
  → host.js sends ws "playback_response" to server
```

---

## 3. Project Structure

```
apps/tvos/
├── MusicQuiz.xcodeproj/
├── MusicQuiz/
│   ├── App/
│   │   ├── MusicQuizApp.swift           ← @main entry, MusicKit auth on launch
│   │   └── ContentView.swift            ← root view with WebView
│   │
│   ├── WebView/
│   │   ├── QuizWebView.swift            ← UIViewRepresentable wrapping WKWebView
│   │   ├── WebViewCoordinator.swift     ← WKNavigationDelegate + WKScriptMessageHandler
│   │   └── JSBridge.swift               ← typed Swift↔JS message protocol
│   │
│   ├── Playback/
│   │   ├── NativePlaybackBridge.swift   ← receives JS commands, calls MusicKit
│   │   ├── MusicKitPlayer.swift         ← MusicKit framework wrapper
│   │   └── NowPlayingReporter.swift     ← reports now-playing state back to JS
│   │
│   ├── Focus/
│   │   ├── FocusOverlayView.swift       ← native overlay for Siri Remote navigation
│   │   └── RemoteEventHandler.swift     ← menu/play-pause button handling
│   │
│   ├── Config/
│   │   ├── ServerConfig.swift           ← server URL, WebSocket endpoints
│   │   └── Info.plist                   ← MusicKit entitlement, App Transport Security
│   │
│   └── Assets.xcassets/
│       ├── AppIcon.brandassets/         ← tvOS app icon (layered image)
│       ├── TopShelfImage.imageset/      ← Top Shelf banner
│       └── LaunchImage.imageset/
│
├── MusicQuizTests/
│   ├── JSBridgeTests.swift
│   └── PlaybackBridgeTests.swift
│
└── README.md
```

---

## 4. Implementation Phases

### Phase 1: Xcode Project Scaffold (cc session start)

**Goal:** Empty tvOS app that builds, runs in Simulator, and deploys to real Apple TV.

Tasks:
1. Create Xcode project via `xcodebuild` or Swift Package template:
   - Product name: `MusicQuiz`
   - Organization: `dk.webhouse`
   - Bundle ID: `dk.webhouse.music-quiz.tvos`
   - Deployment target: tvOS 17.0 (minimum for latest MusicKit APIs)
   - Swift 5.9+
2. Add MusicKit capability in entitlements:
   ```xml
   <key>com.apple.developer.musickit</key>
   <true/>
   ```
3. Add App Transport Security exception for dev:
   ```xml
   <key>NSAppTransportSecurity</key>
   <dict>
     <key>NSAllowsArbitraryLoads</key>
     <true/>
   </dict>
   ```
   Production: restrict to `music.broberg.dk` only.
4. Create `ServerConfig.swift`:
   ```swift
   enum ServerConfig {
       #if DEBUG
       static let baseURL = "http://192.168.1.X:3000"  // LAN IP for dev
       #else
       static let baseURL = "https://music.broberg.dk"
       #endif
       
       static var hostURL: URL { URL(string: "\(baseURL)/quiz/host")! }
       static var wsURL: URL { URL(string: baseURL.replacingOccurrences(of: "http", with: "ws") + "/quiz-ws")! }
   }
   ```
5. Create bare `ContentView.swift` with placeholder text
6. **Validate**: Build → run in tvOS Simulator → see placeholder

**Real device prep:**
- Pair Apple TV in Xcode: Settings → Remotes & Devices → pair with Mac on same network
- Create tvOS App ID in developer.apple.com with MusicKit entitlement
- Create provisioning profile for Apple TV
- Or use TestFlight for ad-hoc distribution

### Phase 2: WKWebView Shell

**Goal:** Load the existing host.html in a WKWebView that fills the TV screen.

Tasks:
1. Create `QuizWebView.swift` — `UIViewRepresentable` wrapping `WKWebView`:
   ```swift
   struct QuizWebView: UIViewRepresentable {
       let url: URL
       @Binding var coordinator: WebViewCoordinator?
       
       func makeUIView(context: Context) -> WKWebView {
           let config = WKWebViewConfiguration()
           config.allowsInlineMediaPlayback = true
           config.mediaTypesRequiringUserActionForPlayback = []
           
           // Register JS message handlers
           let contentController = config.userContentController
           contentController.add(context.coordinator, name: "playback")
           contentController.add(context.coordinator, name: "focus")
           contentController.add(context.coordinator, name: "log")
           
           // Inject tvOS detection script
           let tvosScript = WKUserScript(
               source: "window.__TVOS__ = true; window.__TVOS_VERSION__ = '\(UIDevice.current.systemVersion)';",
               injectionTime: .atDocumentStart,
               forMainFrameOnly: true
           )
           contentController.addUserScript(tvosScript)
           
           let webView = WKWebView(frame: .zero, configuration: config)
           webView.isOpaque = false
           webView.backgroundColor = .clear
           webView.scrollView.isScrollEnabled = false
           return webView
       }
   }
   ```
2. Create `WebViewCoordinator.swift` — implements `WKScriptMessageHandler`:
   ```swift
   class WebViewCoordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
       var playbackBridge: NativePlaybackBridge?
       weak var webView: WKWebView?
       
       func userContentController(_ controller: WKUserContentController, 
                                   didReceive message: WKScriptMessage) {
           switch message.name {
           case "playback":
               handlePlaybackCommand(message.body)
           case "focus":
               handleFocusEvent(message.body)
           case "log":
               print("🌐 JS: \(message.body)")
           default:
               break
           }
       }
   }
   ```
3. Update `ContentView.swift` to show `QuizWebView` fullscreen
4. **Validate**: Build → see host.html loading in Simulator → WebSocket connects to server

**Known issue:** The Simulator doesn't have a real Siri Remote — use keyboard arrows for focus testing. Real Apple TV testing needed for proper remote validation.

### Phase 3: JS Bridge Protocol

**Goal:** Typed bidirectional communication between host.js and Swift.

The bridge needs to handle these message types:

**JS → Swift (via `postMessage`):**
```typescript
// Playback commands (intercepted from server's playback_command messages)
{ type: "playback", command: "play_by_id", params: { songId: "1440833664" } }
{ type: "playback", command: "play_exact", params: { name: "Bohemian Rhapsody", artist: "Queen" } }
{ type: "playback", command: "search_and_play", params: { query: "New York Frank Sinatra" } }
{ type: "playback", command: "pause" }
{ type: "playback", command: "resume" }
{ type: "playback", command: "set_volume", params: { level: 0.75 } }
{ type: "playback", command: "now_playing" }

// Focus events
{ type: "focus", action: "requestFocus", elementId: "start-btn" }

// Lifecycle
{ type: "lifecycle", action: "ready" }  // host.html fully loaded
```

**Swift → JS (via `evaluateJavaScript`):**
```javascript
// Playback responses
window.__tvos_playback_response({ commandId: "mk-42", result: { playing: true, track: "Bohemian Rhapsody" } })

// Focus injection
window.__tvos_focus_update({ focusedElement: "option-2", direction: "right" })

// Native events
window.__tvos_event({ type: "musickit_authorized", authorized: true })
window.__tvos_event({ type: "remote_button", button: "playPause" })
```

Tasks:
1. Create `JSBridge.swift` — typed enums for all message types
2. Modify `host.js` detection — add tvOS-aware playback routing:
   ```javascript
   // In host.js, when receiving playback_command from server:
   if (window.__TVOS__) {
       // Route to native Swift instead of MusicKit JS
       window.webkit.messageHandlers.playback.postMessage({
           type: "playback",
           command: msg.command,
           commandId: msg.commandId,
           params: msg.params
       });
   } else {
       // Existing MusicKit JS path
       handleMusicKitCommand(msg);
   }
   ```
   **Important:** This is a small change to `host.js` (or injected via `WKUserScript`) — NOT a refactor.
3. **Validate**: Send playback command from server → see it arrive in Swift console

### Phase 4: Native MusicKit Playback

**Goal:** Music plays through Apple TV's audio output when the server sends playback commands.

Tasks:
1. Create `MusicKitPlayer.swift`:
   ```swift
   import MusicKit
   
   actor MusicKitPlayer {
       private let player = ApplicationMusicPlayer.shared
       
       func authorize() async -> Bool {
           let status = await MusicAuthorization.request()
           return status == .authorized
       }
       
       func playById(_ songId: String, seekToPercent: Double? = nil) async -> PlayResult {
           do {
               let request = MusicCatalogResourceRequest<Song>(matching: \.id, equalTo: MusicItemID(songId))
               let response = try await request.response()
               guard let song = response.items.first else { return .failure }
               
               player.queue = [song]
               try await player.play()
               
               if let seek = seekToPercent, let duration = song.duration {
                   player.playbackTime = duration * seek
               }
               
               return .success(track: song.title)
           } catch {
               return .failure
           }
       }
       
       func playExact(name: String, artist: String) async -> PlayResult {
           // Search catalog by name + artist
           var request = MusicCatalogSearchRequest(term: "\(name) \(artist)", types: [Song.self])
           request.limit = 5
           do {
               let response = try await request.response()
               // Find best match
               if let song = response.songs.first(where: { 
                   $0.title.localizedCaseInsensitiveContains(name) &&
                   $0.artistName.localizedCaseInsensitiveContains(artist)
               }) ?? response.songs.first {
                   player.queue = [song]
                   try await player.play()
                   return .success(track: "\(song.title) — \(song.artistName)")
               }
               return .failure
           } catch {
               return .failure
           }
       }
       
       func pause() async { player.pause() }
       func resume() async { try? await player.play() }
       func setVolume(_ level: Float) { player.volume = level }
       
       func nowPlaying() -> NowPlayingInfo {
           let state: String
           switch player.state.playbackStatus {
           case .playing: state = "playing"
           case .paused: state = "paused"
           default: state = "stopped"
           }
           return NowPlayingInfo(
               state: state,
               track: player.queue.currentEntry?.title,
               artist: player.queue.currentEntry?.subtitle,
               position: player.playbackTime,
               duration: player.queue.currentEntry?.item?.duration
           )
       }
   }
   ```
2. Create `NativePlaybackBridge.swift` — receives JS commands, calls MusicKitPlayer, sends response back
3. Request MusicKit authorization on app launch (before loading WebView)
4. **Validate**: Start quiz from admin → music plays through Apple TV speakers → quiz flow works end-to-end

### Phase 5: Siri Remote & Focus Engine

**Goal:** Navigate the quiz host UI with Siri Remote.

The host UI has these interactive elements that need focus navigation:
- Setup screen: quiz type selector, playlist picker, question count slider, Start button
- Lobby: Start Quiz button
- Quiz: Next Question button, Skip button
- Results: New Round button, End Party button

Approach:
1. Create `FocusOverlayView.swift` — native UIKit overlay on top of WKWebView:
   - Renders transparent focus rings on focusable elements
   - Uses `UIFocusSystem` for tvOS focus engine
   - Maps focus movement to JS scroll/click events
2. Create `RemoteEventHandler.swift`:
   - **Select (click center)**: triggers click on focused web element
   - **Play/Pause**: sends play/pause to MusicKit player
   - **Menu**: back navigation or show overlay menu
   - **Swipe up/down/left/right**: focus movement
3. Inject focusable element mapping via `WKUserScript`:
   ```javascript
   // Scan for buttons and interactive elements
   document.querySelectorAll('button, [data-focusable], select, input').forEach((el, i) => {
       el.dataset.focusIndex = i;
       el.classList.add('tvos-focusable');
   });
   ```
4. **Validate**: Navigate host UI with arrow keys in Simulator → all buttons clickable

### Phase 6: Polish & Real Device

**Goal:** Production-ready app that runs on a real Apple TV.

Tasks:
1. **App icon**: Create layered tvOS app icon (front layer, back layer, middle layer) — tvOS uses parallax effect
2. **Top Shelf**: Design Top Shelf image (1920×720 or 2320×720) showing Music Quiz branding
3. **Launch screen**: Branded launch screen matching quiz aesthetic
4. **Overscan safe area**: Ensure all UI respects tvOS safe area insets (60pt from edges)
5. **Audio session**: Configure `AVAudioSession` for `.playback` category:
   ```swift
   try AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
   try AVAudioSession.sharedInstance().setActive(true)
   ```
6. **Reconnection**: Handle WebSocket disconnect/reconnect (Apple TV sleeps aggressively)
7. **App lifecycle**: Resume WebSocket when app becomes active, pause music when app backgrounds

**Real Apple TV deployment:**
```bash
# 1. In Xcode: Select Apple TV as target device (must be on same WiFi)
# 2. Product → Run
# 3. Or for TestFlight:
#    Product → Archive → Distribute → TestFlight
```

Requirements for real device:
- Apple Developer account (you have this)
- tvOS App ID: `dk.webhouse.music-quiz.tvos` with MusicKit entitlement enabled
- Provisioning profile for the Apple TV device
- Apple TV paired with Xcode (Settings → Remotes and Devices on Apple TV)
- Mac and Apple TV on same WiFi network

---

## 5. WebSocket Protocol Reference

The tvOS app connects to `/quiz-ws` as a **host** role. Here's the complete message protocol it must handle:

### Messages the tvOS Host Sends

```typescript
// Create a new quiz round
{ type: "create_session", config: QuizConfig }

// Game control
{ type: "start_quiz" }
{ type: "next_question" }
{ type: "skip_question" }
{ type: "end_quiz" }
{ type: "kick_player", playerId: string }

// DJ Mode (between rounds)
{ type: "activate_dj" }
{ type: "deactivate_dj" }
{ type: "dj_next" }
{ type: "dj_remove", songQueueId: string }
{ type: "dj_autoplay", enabled: boolean }
{ type: "dj_status" }

// Lifecycle
{ type: "set_provider", provider: "musickit-web" }
{ type: "end_party" }
```

### Messages the tvOS Host Receives

```typescript
// Session lifecycle
{ type: "researching" }                    // AI building questions
{ type: "preparing", sessionId, totalSongs }  // downloading songs
{ type: "prepare_progress", current, total }   // progress updates
{ type: "session_created", sessionId, joinCode, joinUrl, partyId, roundNumber }

// Player events
{ type: "player_joined", player: { id, name, avatar } }
{ type: "player_left", playerId, playerName }
{ type: "player_waiting", playerName, playerAvatar, waitingCount }

// Game state transitions
{ type: "game_state", state: GameState, question?: HostQuestionData, timeLimit?, questionNumber?, totalQuestions? }
// states: "lobby" → "countdown" → "playing" → "evaluating" → "reveal" → "scoreboard" → "finished"

// Answer tracking
{ type: "answer_received", playerId, playerName, total, expected }
{ type: "evaluating_answers" }

// Results
{ type: "question_results", results: QuestionResult[], correctAnswer, question: HostQuestionData }
{ type: "final_results", rankings: FinalRanking[], roundNumber }

// Playback commands (when provider is "musickit-web")
{ type: "playback_command", commandId, command: string, params: object }
// commands: "play_by_id", "play_exact", "search_and_play", "pause", "resume", "set_volume", "now_playing"

// DJ Mode
{ type: "dj_activated", picks, queue, current?, autoplay? }
{ type: "dj_deactivated" }
{ type: "dj_state", queue, current, picks, autoplay }
{ type: "dj_queue_empty" }

// Provider
{ type: "provider_set", provider: string }

// Errors
{ type: "error", message: string }
```

### Playback Command/Response Protocol

When the server needs music playback, it sends a `playback_command` through the WebSocket:

```json
// Server → tvOS (via WebSocket to host.js → JS bridge → Swift)
{
  "type": "playback_command",
  "commandId": "mk-42",
  "command": "play_by_id",
  "params": { "songId": "1440833664", "seekToPercent": 0.3 }
}

// tvOS → Server (Swift → JS bridge → host.js → WebSocket)
{
  "type": "playback_response",
  "commandId": "mk-42",
  "result": { "playing": true, "track": "Bohemian Rhapsody" }
}
```

Supported commands and their expected params/results:

| Command | Params | Expected Result |
|---------|--------|-----------------|
| `play_by_id` | `{ songId, seekToPercent? }` | `{ playing: bool, track?: string }` |
| `play_exact` | `{ name, artist, randomSeek? }` | `{ playing: bool, track?: string }` |
| `search_and_play` | `{ query }` | `{ playing: bool, track?: string }` |
| `pause` | `{}` | `{}` |
| `resume` | `{}` | `{}` |
| `set_volume` | `{ level: 0-1 }` | `{}` |
| `now_playing` | `{}` | `{ state, track?, artist?, position?, duration? }` |
| `check_library` | `{ name, artist }` | `{ found: bool }` |

---

## 6. Changes to Existing Code

Only **one small change** to the existing codebase is needed:

**`host.js` (or injected via WKUserScript):**

Add tvOS detection at the top of the MusicKit playback handler. When `window.__TVOS__` is true, route `playback_command` messages to the native bridge instead of MusicKit JS:

```javascript
// Add to the playback_command handler in host.js:
function handleServerPlaybackCommand(msg) {
    if (window.__TVOS__ && window.webkit?.messageHandlers?.playback) {
        // tvOS native path — Swift handles MusicKit
        window.webkit.messageHandlers.playback.postMessage({
            type: "playback",
            command: msg.command,
            commandId: msg.commandId,
            params: msg.params || {}
        });
    } else {
        // Existing browser MusicKit JS path
        handleMusicKitCommand(msg);
    }
}
```

And a callback function for Swift to deliver responses:
```javascript
window.__tvos_playback_response = function(response) {
    // Send back to server via existing WebSocket
    ws.send(JSON.stringify({
        type: "playback_response",
        commandId: response.commandId,
        result: response.result
    }));
};
```

This can alternatively be injected entirely via `WKUserScript` at document start, avoiding any changes to host.js at all.

---

## 7. Key Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| UI framework | SwiftUI + WKWebView | SwiftUI for native chrome, WKWebView for quiz display |
| Playback | MusicKit framework (ApplicationMusicPlayer) | Native playback, no web audio limitations |
| Provider type | Reuse `musickit-web` protocol | Zero server changes, same command/response flow |
| Focus engine | Native UIFocusSystem + JS injection | tvOS focus engine is required, CSS :focus won't work alone |
| Min tvOS version | 17.0 | Required for latest MusicKit APIs (MusicCatalogSearchRequest, async/await) |
| Auth | MusicAuthorization.request() on launch | Native prompt, no web OAuth needed |
| WebSocket | Via WKWebView (host.js handles it) | Reuses existing WebSocket connection code |
| Bundle ID | `dk.webhouse.music-quiz.tvos` | Under your existing Apple Developer org |

---

## 8. Testing Checklist

### Simulator Testing (Phase 1-5)
- [ ] App builds and runs in tvOS Simulator
- [ ] WKWebView loads host.html from server
- [ ] WebSocket connects (check server log for "WS connected")
- [ ] `set_provider: "musickit-web"` sent on connect
- [ ] Keyboard navigation works (arrow keys = focus, Enter = select)
- [ ] Playback commands arrive in Swift (visible in Xcode console)
- [ ] Note: MusicKit playback does NOT work in Simulator (no Apple Music subscription context)

### Real Apple TV Testing (Phase 6)
- [ ] App installs on Apple TV (via Xcode or TestFlight)
- [ ] MusicKit authorization prompt appears and succeeds
- [ ] Music plays through Apple TV (AirPlay, HDMI, HomePod)
- [ ] Siri Remote navigates quiz host UI
- [ ] Select button triggers UI actions
- [ ] Play/Pause button controls music
- [ ] Full quiz flow: create session → players join on phones → quiz runs → music plays → scores shown
- [ ] DJ Mode works: players pick songs → songs play through Apple TV
- [ ] App survives backgrounding and returns gracefully
- [ ] WebSocket reconnects after Apple TV sleep/wake

---

## 9. Prerequisites

Before starting the cc session:

1. **Monorepo migration done** — `apps/tvos/` directory exists in `cbroberg/music-quiz`
2. **Xcode 16+** installed on Mac
3. **Apple Developer account** active with MusicKit entitlement capability
4. **Apple TV 4K** (4th gen or later) on same WiFi as dev Mac, paired in Xcode
5. **Server running** — `music.broberg.dk` accessible, or local dev server on LAN
6. **MusicKit App ID** created at developer.apple.com:
   - Bundle ID: `dk.webhouse.music-quiz.tvos`
   - Capabilities: MusicKit enabled
   - Provisioning profile generated for tvOS

---

## 10. cc Session Kickoff Prompt

When ready to start:

```
Read docs/TVOS-APP-PLAN.md and CLAUDE.md.

Phase 1: Create the Xcode project scaffold for tvOS in apps/tvos/.
- Product: MusicQuiz  
- Bundle ID: dk.webhouse.music-quiz.tvos
- tvOS 17.0+ deployment target
- MusicKit entitlement
- SwiftUI lifecycle
- ServerConfig with dev/prod URL toggle
- Build and verify it runs in tvOS Simulator with placeholder UI

Then proceed to Phase 2: WKWebView shell loading /quiz/host.
```
