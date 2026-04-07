# F11: Home Controller Mac App

**Status:** Planned
**Priority:** Medium

## Summary

Replace the Node.js CLI Home Controller with a native Swift menu bar app. Downloadable from the Music Quiz website. Runs as a background service with branding in the menu tray.

## Why

Current Home Controller is a Node.js script started manually from terminal. Not user-friendly for non-developers. A native Mac app:
- Auto-starts on login (launchd)
- Lives in menu bar (not Dock) — unobtrusive
- Shows connection status + Now Playing at a glance
- Downloadable from music.quiz-mash.com/download
- Branded — Music Quiz icon in menu tray

## Features

### Menu Bar
- Music Quiz icon (red when connected, grey when disconnected)
- Click → dropdown with:
  - Now Playing (track + artist + artwork)
  - Connection status (server URL, connected/disconnected)
  - AirPlay device selector
  - Pause / Resume / Next
  - Volume slider
  - "Open Music Quiz" → opens browser to /quiz/admin
  - Preferences (server URL, API key, auto-start)
  - Quit

### Now Playing Window
- Optional floating window (like Spotify mini player)
- Shows artwork, track info, progress
- Click to expand/collapse
- Stays on top (optional)

### Background Service
- Connects to server via WebSocket (same as current HC)
- Relays commands to Music.app via osascript (same as current HC)
- Auto-reconnects on disconnect
- Starts on login via LaunchAgent

### Download & Install
- DMG download from music.quiz-mash.com/download
- Drag to Applications
- First launch: enter server URL + API key
- Or: scan QR code from Admin page to auto-configure

## Technical

### Core (unchanged)
- WebSocket connection to server `/home-ws`
- osascript commands to Music.app (play-exact, pause, volume, now-playing, etc.)
- Same command set as current Node.js HC

### Swift Stack
- SwiftUI for menu bar + preferences
- `NSStatusItem` for menu bar icon
- `Process` + osascript for Music.app control (same approach as Node.js)
- `URLSessionWebSocketTask` for WebSocket
- `SMAppService` for login item (auto-start)
- `ServiceManagement` framework

### Build & Distribution
- Xcode project in `home/app/` (separate from Node.js HC in `home/`)
- Notarized + signed for Gatekeeper
- DMG built via `create-dmg` or Xcode archive
- Hosted on Fly.io static files or GitHub Releases

## Migration

- Node.js HC (`home/server.ts`) stays as-is — it becomes the "developer mode" option
- Swift app is the user-facing product
- Both use the same WebSocket protocol — server doesn't care which connects
