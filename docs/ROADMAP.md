# Music Quiz — Roadmap

**Last updated:** 2026-04-01

---

## Done (12 milestones)

| # | Milestone | Completed |
|---|-----------|-----------|
| 01 | **MCP Server** — 34 tools (catalog, library, playback, quiz), OAuth 2.1, Apple Music API | 2026-03 |
| 02 | **Home Controller** — WebSocket agent on Mac, osascript playback, AirPlay, reconnect | 2026-03 |
| 03 | **Now Playing** — Next.js frontend, vinyl sphere (33⅓ RPM), real-time WebSocket updates | 2026-03 |
| 04 | **Multiplayer Quiz** — WebSocket game engine, QR code join, Kahoot-style scoring, AI evaluation | 2026-03 |
| 05 | **Custom Quiz Builder** — Search catalog, album expansion, save/load playlists, mini player | 2026-03 |
| 06 | **DJ Mode** — Music democracy, pick system, shared queue, autoplay detection | 2026-03 |
| 07 | **Admin Panel** — Recently played, play buttons, clear used songs | 2026-03 |
| 08 | **Rebrand** — Apple Music MCP → Music Quiz v3.0.0 | 2026-03 |
| 09 | **E2E Testing** — Playwright, 4-window ultrawide layout, screen recording with system audio | 2026-04 |
| 10 | **Exact Match Playback** — `play-exact` osascript, no fuzzy search, library pre-check before countdown | 2026-04 |
| 11 | **Player Reconnect** — Seamless re-join during DJ Mode, session persistence | 2026-04 |
| 12 | **Library Cleanup** — Track added songs, osascript delete, protect user's own library | 2026-04 |

---

## In Progress

| # | Milestone | Target |
|---|-----------|--------|
| 13 | **DJ Mode Stability** — Autoplay detection (position-based), picks enforcement, correct song matching | 2026-04 |
| 14 | **UI Polish** — Podium sizing, translate suppression, countdown spacing, sound effects (tada/applause) | 2026-04 |

---

## Planned

| # | Milestone | Notes |
|---|-----------|-------|
| 15 | **Gameplay Modes** — Steal Round, All-In, Sound Clash, Blind Round, Playlist Battle | See [FEATURES.md](FEATURES.md) F06-F10 |
| 16 | **Home Controller App** — Standalone macOS app with UI, replacing CLI-only agent | See [FEATURES.md](FEATURES.md) F11 |
| 17 | **Lyrics Display** — Show lyrics on Now Playing page | See [FEATURES.md](FEATURES.md) F12 |
| 18 | **Repo Rename** — `apple-music-mcp` → `musicquiz` | |
| 19 | **Production Deploy** — Fly.io (arn), latest code with DJ Mode, vinyl sphere, all fixes | |
| 20 | **tvOS App** — Apple TV companion app, WebView-based quiz display | See [FEATURES.md](FEATURES.md) F13 |
