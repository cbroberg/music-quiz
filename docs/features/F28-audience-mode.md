# F28: Audience Mode — Tilskuer-voting

**Status:** Idea

## Summary

For større events (20+ mennesker): ikke alle behøver at være aktive spillere. Audience Mode lader tilskuere deltage med afstemninger, predictions og voting uden at svare på quiz-spørgsmål. Udvider event-tier's value proposition.

## Roller

| Rolle | Max antal | Deltager via | Interaktion |
|-------|-----------|-------------|-------------|
| Host | 1 | Storskærm | Styrer quiz |
| Spiller | 8-20 | Telefon (PWA) | Svarer på spørgsmål |
| Tilskuer | Ubegrænset | Telefon (PWA) | Stemmer og predicter |

## Tilskuer-interaktioner

### 1. Predictions
- Før hver runde: "Hvem vinder denne runde?" → stem på en spiller
- Korrekt prediction = tilskueren optjener virtuelle points
- Tilskuer-leaderboard vises mellem runderne

### 2. Crowd Vote (Playlist Battle)
- Under Playlist Battle (F10): tilskuere stemmer på bedste playlist
- Deres stemmer tæller som bonus-points for det vindende hold

### 3. "Hjælp" vote
- Spillere kan aktivere "Ask the Audience" (én gang per quiz)
- Tilskuere ser svarmuligheder og stemmer
- Fordelingen vises som søjlediagram (à la "Hvem vil være millionær")

### 4. Reactions
- Emoji-reactions i realtid (🔥 👏 😂 😱)
- Vises som floating emojis på host-skærmen
- Simpelt og visuelt engagement

## Routes

```
GET /quiz/watch         → Tilskuer PWA
GET /quiz/watch?code=X  → Auto-join som tilskuer
```

QR-koden på host-skærmen kan have to links:
- "Spil med" → /quiz/play?code=X
- "Se med" → /quiz/watch?code=X

## Player PWA Changes (tilskuer-variant)

- Simplificeret UI: ingen svarknapper, kun voting/reactions
- Prediction-kort per runde
- Emoji-reaction knapper (persistent i bunden)
- Mini-scoreboard (spiller-scores + tilskuer-prediction-scores)

## Host UI Changes

- Floating emoji-reactions overlay
- Tilskuer-count badge: "👀 47 ser med"
- Prediction-resultater mellem runderne
- "Ask the Audience" resultat-diagram

## WebSocket Protocol

```typescript
// Tilskuer → Server
{ type: 'join_audience', joinCode: string, name: string }
{ type: 'predict_winner', playerId: string }
{ type: 'audience_vote', optionIndex: number }
{ type: 'reaction', emoji: string }

// Server → Host
{ type: 'audience_count', count: number }
{ type: 'reaction_burst', emoji: string, count: number }
{ type: 'audience_vote_result', distribution: number[] }
```

## Commercial Value

- Gratis tier: 0 tilskuere
- Party tier: 10 tilskuere
- Host Pro tier: 50 tilskuere
- Event tier: ubegrænset tilskuere

Gør event-tier'et markant mere værdifuldt for firmafester og bryllupper.

## Dependencies

- Ny WebSocket rolle-type ('audience')
- Separat tilskuer PWA route
- Emoji floating animation (CSS keyframes)
