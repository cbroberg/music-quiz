# Music Quiz — Feature List

**Last updated:** 2026-04-01

---

## Legend

- **Done** — shipped and working
- **In progress** — actively being built
- **Planned** — designed, ready to build
- **Idea** — needs design/spec work

---

## Features

| # | Feature | Status | Description |
|---|---------|--------|-------------|
| F01 | [Multiplayer Quiz Engine](#f01-multiplayer-quiz-engine) | Done | WebSocket game engine, join codes, QR, real-time scoring |
| F02 | [AI Answer Evaluation](#f02-ai-answer-evaluation) | Done | Claude haiku evaluates free-text answers, generous with spelling |
| F03 | [Custom Quiz Builder](#f03-custom-quiz-builder) | Done | Search Apple Music catalog, curate playlists, save/load |
| F04 | [DJ Mode](#f04-dj-mode) | Done | Music democracy — players earn picks, shared queue, autoplay |
| F05 | [Library Cleanup](#f05-library-cleanup) | Done | Track quiz-added songs, osascript delete on DJ Mode end |
| F06 | [Steal Round](#f06-steal-round) | Planned | Wrong answers open for steal by other players |
| F07 | [All-In Round](#f07-all-in-round) | Planned | Double-or-nothing — risk current score on confidence |
| F08 | [Sound Clash](#f08-sound-clash) | Planned | 1v1 head-to-head elimination bracket |
| F09 | [Blind Round](#f09-blind-round) | Planned | No multiple choice — pure free-text, harder scoring |
| F10 | [Playlist Battle](#f10-playlist-battle) | Planned | Teams build playlists, audience votes |
| F11 | [Home Controller App](#f11-home-controller-app) | Planned | Standalone macOS app with UI, status, controls |
| F12 | [Lyrics Display](#f12-lyrics-display) | Idea | Show synced or static lyrics on Now Playing |
| F13 | [tvOS App](#f13-tvos-app) | Idea | Apple TV companion — host display on big screen |
| F14 | [Spotify Support](#f14-spotify-support) | Idea | Alternative music source for non-Apple users |
| F15 | [Tournament Mode](#f15-tournament-mode) | Idea | Multi-round tournament with brackets and finals |
| F16 | [Party Themes](#f16-party-themes) | Idea | Visual themes (80s neon, rock, jazz club, etc.) |

---

## Feature Details

### F01: Multiplayer Quiz Engine
**Status:** Done

- WebSocket real-time communication (host ↔ server ↔ players)
- 6-character join codes (excluding confusing chars I/O/0/1)
- QR code with LAN IP auto-detection
- Kahoot-style scoring: 1000pts max, linear time decay
- Streak bonuses: 1.5x after 3, 2x after 5 correct
- Game states: lobby → countdown → playing → evaluating → reveal → scoreboard → finished
- Max 8 players per session
- Question types: guess-the-artist, guess-the-song, guess-the-album, guess-the-year, intro-quiz
- Music sources: charts, recently-played, library, genre, live, mixed (6 parallel fetches)

### F02: AI Answer Evaluation
**Status:** Done

- Claude haiku batch-evaluates all player answers in a single API call
- Generous with spelling, abbreviations, partial matches
- Provides explanations for incorrect answers
- Used for free-text answer mode

### F03: Custom Quiz Builder
**Status:** Done

- Two-panel layout: search (left) + playlist (right)
- Search songs and albums from Apple Music catalog
- Album expansion with per-track add
- Mini now-playing bar with equalizer animation
- Save/load custom playlists (persisted to disk as JSON)
- Custom modals for save/load/confirm (no browser alerts)

### F04: DJ Mode
**Status:** Done

- Activated after quiz ends — players use earned picks to queue songs
- Pick distribution: #1=5, #2=3, #3=2, rest=1, streak bonus +1
- Queue shuffling: new songs inserted at random position among unplayed
- Autoplay detection via now-playing polling (2s interval, position-based)
- Wake Lock API keeps player screens on
- Player reconnect preserves picks and queue state
- Host controls: next, remove, autoplay toggle

### F05: Library Cleanup
**Status:** Done

- Tracks every song added to library via `addToLibrary` (name + artist)
- `delete-from-library` osascript command removes songs from local Music.app
- Only deletes songs that were added by the quiz system, never user's own music
- Admin API endpoint: `POST /quiz/api/admin/cleanup-library`

### F06: Steal Round
**Status:** Planned

After the main question timer ends, players who got the wrong answer can "steal" by answering again within a short window. Correct steals earn partial points.

### F07: All-In Round
**Status:** Planned

Before answering, players choose to go "all-in" (risk 50% of current score for 2x points) or play safe (normal points). High-risk, high-reward.

### F08: Sound Clash
**Status:** Planned

Two players go head-to-head. Both hear the same song snippet. First correct answer wins. Loser is eliminated. Bracket-style tournament.

### F09: Blind Round
**Status:** Planned

No multiple choice options — pure free-text answers only. Harder but more rewarding. AI evaluation required for all answers.

### F10: Playlist Battle
**Status:** Planned

Teams build playlists from their picks. Songs are played, and the opposing team + audience votes. Best playlist wins bonus points.

### F11: Home Controller App
**Status:** Planned

Standalone macOS app replacing the CLI-only Home Controller:
- Status dashboard (connection, now playing, queue)
- Manual playback controls
- Library cleanup UI
- AirPlay device management
- Auto-start on login

### F12: Lyrics Display
**Status:** Idea

Show lyrics on the Now Playing page. Options:
- Apple Music API lyrics (if available)
- Third-party lyrics API (Musixmatch, Genius)
- Synced lyrics (time-stamped) vs static display

### F13: tvOS App
**Status:** Idea

Apple TV companion app for displaying the quiz on a big screen:
- WebView-based (reuse existing vanilla HTML/CSS/JS)
- Host display with QR code, questions, scoreboard
- Now Playing with large album art and lyrics
- Controlled via iPhone (host) as remote

### F14: Spotify Support
**Status:** Idea

Alternative music source for groups where not everyone has Apple Music. Would require Spotify Web API integration and playback via Spotify Connect.

### F15: Tournament Mode
**Status:** Idea

Multi-round tournament format:
- Group stages (4 players per group)
- Semi-finals and finals
- Leaderboard across rounds
- Persistent scoring across an evening

### F16: Party Themes
**Status:** Idea

Visual themes that change the entire UI aesthetic:
- 80s Neon (synth colors, grid background)
- Rock (dark, flame effects)
- Jazz Club (warm tones, smoky overlay)
- Disco (mirror ball, rainbow gradients)
