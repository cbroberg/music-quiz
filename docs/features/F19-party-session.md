# F19: Party Session (Event → Rounds)

**Status:** Done (2026-04-02)

## Summary

An Event is the top-level container for an entire evening. One join code, one playlist, multiple quiz rounds. Players persist across rounds. Picks accumulate.

## What Was Built

- `Party` type with states: `playlist` | `lobby` | `quiz` | `ceremony`
- One join code per Event (same QR code all evening)
- Players persist across rounds with per-round score reset
- DJ Mode playlist accumulates songs across all rounds
- Picks accumulate: Round 1 picks + Round 2 picks = total
- Round # badge visible on host (fixed top-left) and player (lobby)
- Picks earned shown on host podium and player final screen
- "New Round" button (was "New Quiz"), "End Event" button (was "End DJ Mode")
- `end_party` WebSocket message for full cleanup
- MUTE_ALL env var for silent testing
- Verified with 5-round E2E test (28 songs accumulated)

## Key Files Changed

- `src/quiz/types.ts` — Party, CompletedRound, PartyState types
- `src/quiz/engine.ts` — Party management (createParty, startRound, endParty)
- `src/quiz/ws-handler.ts` — Party-aware message routing
- `src/quiz/dj-mode.ts` — calculatePicksForRank export
- Host + Player UI — Round badge, picks display, End Event

## See Also

- [PARTY-SESSION.md](../PARTY-SESSION.md) — Original architecture design
