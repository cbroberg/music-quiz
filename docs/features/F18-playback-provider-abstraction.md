# F18: Playback Provider Abstraction

**Status:** Planned
**Priority:** High
**Blocks:** F17 (MusicKit JS), F20 (Spotify), any future provider

## Summary

A `PlaybackProvider` interface that abstracts music playback. All playback goes through a provider — MusicKit JS, Home Controller, Spotify, or preview clips. The quiz engine doesn't care which one is active.

## Why

Currently, playback is tightly coupled to Home Controller via `sendHomeCommand()` calls spread across `engine.ts` and `ws-handler.ts`. Adding MusicKit JS (or any other provider) means duplicating all playback logic. A clean abstraction lets us swap providers without touching the game engine.

## PlaybackProvider Interface

```typescript
interface PlaybackProvider {
  readonly name: string;

  // Lifecycle
  initialize(config: any): Promise<void>;
  isAvailable(): Promise<boolean>;

  // Playback
  play(songId: string, options?: { seekToPercent?: number }): Promise<{ playing: boolean; track?: string }>;
  playExact(name: string, artist: string, options?: { retries?: number; randomSeek?: boolean }): Promise<{ playing: boolean; track?: string }>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  setVolume(level: number): Promise<void>;
  nowPlaying(): Promise<{ state: string; track?: string; artist?: string; position?: number; duration?: number }>;

  // Library (optional — not all providers need this)
  checkLibrary?(name: string, artist: string): Promise<boolean>;
  addToLibrary?(songIds: string[]): Promise<void>;
}
```

## Providers

| Provider | Where it runs | Auth | When to use |
|----------|--------------|------|-------------|
| `MusicKitWebProvider` | Host browser | Apple Music login | Primary — cross-platform |
| `HomeControllerProvider` | Server → Mac | None (WebSocket) | Legacy — Mac with Music.app |
| `PreviewProvider` | Host browser | None | Fallback — 30s clips, no login |

## Architecture

```
Quiz Engine (engine.ts)
    ↓ playback commands
PlaybackProvider interface
    ↓ routed to active provider
┌──────────────────┬─────────────────────┬──────────────┐
│ MusicKit JS      │ Home Controller     │ Preview      │
│ (host browser)   │ (server → Mac)      │ (host <audio>│
└──────────────────┴─────────────────────┴──────────────┘
```

### Key Design Decisions

1. **Provider selected at Party/Event creation** — not per-round
2. **MusicKit JS runs client-side** — server sends song IDs, host browser plays them
3. **Home Controller runs server-side** — server sends osascript commands
4. **This means playback commands are either:**
   - Sent to host browser via WebSocket (`musickit`, `preview`)
   - Sent to Home Controller via server-side call (`home-controller`)
5. **Engine doesn't know the difference** — provider handles routing

### Communication Pattern

For browser-based providers (MusicKit JS, Preview):
```
Engine → ws-handler → WebSocket to host → host.js → MusicKit JS → Apple Music
```

For server-based providers (Home Controller):
```
Engine → ws-handler → sendHomeCommand() → Home Controller → Music.app
```

## New Files

- `src/quiz/playback/types.ts` — PlaybackProvider interface
- `src/quiz/playback/musickit-web.ts` — MusicKit JS (host-side, commands via WS)
- `src/quiz/playback/home-controller.ts` — Wraps existing sendHomeCommand
- `src/quiz/playback/preview.ts` — 30s preview clips via `<audio>`
- `src/quiz/playback/provider-manager.ts` — Active provider management

## Modified Files

- `src/quiz/engine.ts` — Replace direct `sendHomeCommand` calls with provider calls
- `src/quiz/ws-handler.ts` — Add playback command routing to host browser
- `src/quiz/public/host.js` — Handle playback commands from server

## Acceptance Criteria

- [ ] PlaybackProvider interface defined
- [ ] HomeControllerProvider wraps existing sendHomeCommand (no behavior change)
- [ ] Engine uses provider instead of direct sendHomeCommand for playback
- [ ] Provider can be swapped without changing engine logic
- [ ] All existing E2E tests still pass with HomeControllerProvider
