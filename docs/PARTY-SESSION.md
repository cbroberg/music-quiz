# Party Session Architecture

**Status:** Designed, ready to implement

## Concept

A **Party** is the top-level container for an entire evening/event. It owns the playlist and all state. **Rounds** are quiz games within a Party that award picks/credits.

## Hierarchy

```
Party (the evening)
├── Playlist (immutable — only additions, never deletions during party)
├── Players (persist across rounds)
├── Round 1: Quiz → picks awarded → players add to playlist
├── Round 2: Quiz → more picks → more songs
├── Round N...
└── End Party → cleanup
```

## Key Rules

1. **Playlist is sacred** — once a song is added, it stays until End Party
2. **Playlist plays continuously** — between rounds, during prep, always
3. **Rounds are interruptions** — the default state is "playlist playing"
4. **Picks accumulate** — Round 1 picks + Round 2 picks = total available
5. **Players persist** — joining once = in for the evening
6. **New players can join** — via Waiting Room between rounds, or lobby when open
7. **Round # visible** — shown in host + player UI permanently

## Data Model

```typescript
interface Party {
  id: string;
  createdAt: Date;
  playlist: QueuedSong[];        // the sacred list
  players: Map<string, Player>;  // persist across rounds
  currentRound: number;          // 0 = no active round
  rounds: Round[];               // history
  state: "playlist" | "lobby" | "quiz" | "ceremony";
}

interface Round {
  number: number;
  config: QuizConfig;
  questions: QuizQuestion[];
  rankings: FinalRanking[];
  completedAt?: Date;
}
```

## States

| State | What's happening | Playlist | UI |
|-------|-----------------|----------|-----|
| `playlist` | Default — music playing, players can browse queue | Playing | DJ Mode view |
| `lobby` | Round about to start, players joining | Playing (theme) | Lobby + "Round N" |
| `quiz` | Questions active | Quiz songs | Quiz view + "Round N" |
| `ceremony` | Results, Champions, picks awarded | Champions | Podium + "Round N" |

## Flow

1. DJ opens Music Quiz → Party created, state = `playlist`
2. DJ clicks "Start Round" → state = `lobby`, theme plays, Round N++
3. DJ clicks "Start Quiz" → state = `quiz`
4. Quiz ends → state = `ceremony`, Champions plays, picks awarded
5. Ceremony ends → state = `playlist`, players add songs
6. Repeat from 2
7. DJ clicks "End Party" → cleanup, goodnight

## UI: Round Indicator

- Host: "Round 1" badge in top-left corner, always visible
- Players: "Round 1" shown under "Music Quiz" header
- During playlist state: "Between Rounds" or just the round number of last completed

## What Changes from Current Architecture

- `GameSession` → split into `Party` (long-lived) + `Round` (per-quiz)
- DJ Mode queue → Party playlist (no reset between rounds)
- `createSession` → `startRound` (within existing Party)
- `awardPicks` stays the same but accumulates
- `resetDjMode` only at End Party
- Join codes: one per Party (not per Round)
- Waiting Room: persists across rounds within a Party
