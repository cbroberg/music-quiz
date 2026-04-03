# F22: Time Machine — Årstals-gæt med tidslinje

**Status:** Idea

## Summary

Host-skærmen viser en interaktiv tidslinje (1950-2025). Spillerne trækker en markør på deres telefon til det år de tror sangen er fra. Jo tættere på det rigtige år, jo flere point. Continuous input i stedet for multiple choice — en helt anden dynamik.

## How It Works

1. En sang afspilles (standard quiz playback)
2. Spillernes telefoner viser en horisontalt slider: 1950 ←——→ 2025
3. Spillerne trækker markøren til deres gæt og trykker "Lås"
4. Host-skærmen viser alle spilleres gæt som farvede prikker på tidslinjen
5. Det korrekte år afsløres med en animation (zoom til årstal)
6. Points beregnes baseret på afstand

## Scoring

```
points = max(0, 1000 - (abs(guess - correct) * 100))
```

- Præcist rigtigt: 1000 points
- 1 år ved siden af: 900 points
- 5 år ved siden af: 500 points
- 10+ år ved siden af: 0 points

Difficulty modes:
- **Easy:** ±5 år = max points, 0 ved ±15
- **Medium:** Standard (ovenstående)
- **Hard:** ±2 år = max, 0 ved ±8

## Player PWA Changes

- Ny input-type: horisontalt range slider med årstal
- Stor, touch-venlig markør (mindst 44px)
- Haptic feedback ved snap til årtier (navigator.vibrate)
- Visuelt: årtier markeret (50s, 60s, 70s...)
- "Lås" knap der confirmer valget

## Host UI Changes

- Stor tidslinje der fylder skærmen
- Spillernes gæt vises som farvede cirkler med avatar/emoji
- Reveal-animation: korrekt år markeres, linjer viser afstand
- Mini-scoreboard under tidslinjen

## Data Source

- `release_date` fra Apple Music API (song metadata)
- For film-quiz: `release_date` fra TMDB API
- Fallback: `releaseYear` fra quiz-spørgsmålets metadata

## Cross-mode Support

Kan bruges i både musik- og film-quiz:
- Musik: "Hvornår udkom denne sang?"
- Film: "Hvornår havde denne film premiere?"

## Dependencies

- Ingen nye dependencies — kun ny UI-komponent
- Eksisterende WebSocket protocol udvides med `{ type: 'submit_year', year: number }`
