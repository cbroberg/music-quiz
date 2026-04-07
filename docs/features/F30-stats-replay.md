# F30: Stats & Replay — Personlig quiz-historik

**Status:** Idea

## Summary

Efter quizzen: vis personlig statistik — genre-styrke, hurtigste svar, streak-rekord. Gem historik server-side og vis trends over tid. Giver grund til at vende tilbage og forbedre sig.

## Post-Quiz Stats Screen

Vises efter final scoreboard, inden DJ Mode:

### Per-spiller statistik:

- **Genre-radar:** Spiderdiagram med korrekt-procent per genre
  - "Du er 90% på rock, men kun 30% på hip-hop"
- **Hurtigste svar:** Titel + tid (f.eks. "Bohemian Rhapsody — 0.8s")
- **Længste streak:** Antal + sange i strækken
- **Gennemsnitlig svartid:** Sekunder
- **Sværhedsgrad-kurve:** Korrekt-rate per spørgsmålsnummer (faldt du af halvvejs?)
- **Årtis-styrke:** Bar chart over korrekte svar per årti

### Gruppe-statistik:

- **Mest gættede sang:** Hvilken sang gættede alle rigtigt?
- **Sværeste sang:** Hvilken sang slog alle?
- **Tættest race:** Runde med mindst point-forskel
- **MVR (Most Valuable Round):** Runden med størst point-swing

## Historik over tid (kræver auth)

### Personlig profil:

- Total antal quizzer spillet
- Win/loss ratio
- Samlet antal korrekte svar
- Genre-udvikling over tid ("Du er blevet 15% bedre til 80s musik")
- All-time streak-rekord
- Yndlings-quiz-kilde (charts, library, artist)
- Head-to-head record mod specifikke spillere

### Achievements/badges:

- 🎯 "Perfect Round" — alle svar korrekte i én runde
- ⚡ "Speed Demon" — gennemsnitlig svartid under 2s
- 🔥 "On Fire" — 10+ streak
- 🌍 "World Traveler" — korrekt i 10+ forskellige genrer
- 🎵 "Vinyl Collector" — 100+ quizzer spillet
- 👑 "Quiz Master" — 50+ sejre
- 🎸 "Genre Expert: Rock" — 95%+ i rock-kategorien
- 🎹 "Genre Expert: Jazz" — 95%+ i jazz-kategorien

## Technical

### Data model:

```typescript
interface QuizResult {
  sessionId: string;
  date: string;
  players: PlayerResult[];
  questions: QuestionResult[];
  config: QuizConfig;
}

interface PlayerResult {
  playerId: string;
  name: string;
  totalScore: number;
  rank: number;
  answers: AnswerResult[];
  stats: {
    correctCount: number;
    avgResponseTimeMs: number;
    longestStreak: number;
    genreAccuracy: Record<string, { correct: number, total: number }>;
    decadeAccuracy: Record<string, { correct: number, total: number }>;
  };
}
```

### Storage:

- **Pre-auth (fase 1):** `localStorage` på player PWA — begrænsede stats, kun denne enhed
- **Post-auth (fase 2):** SQLite on Fly.io — fuld historik, cross-device, leaderboards

### Visualisering:

- Genre-radar: Chart.js radar chart (allerede tilgængelig i quiz-host)
- Årtis-bar: Simpelt SVG eller Chart.js bar chart
- Trends: Sparkline (mini line chart) for udvikling over tid

## Shareable Results

"Del dine resultater" — generér et billede (canvas → PNG) eller en shareable URL:

```
music.quiz-mash.com/quiz/results/abc123
```

Viser:
- Spillerens navn + rank
- Score + statistik
- Genre-radar
- "Spil mod mig!" CTA

## Host UI Changes

- Ny screen mellem "finished" og DJ Mode: "Stats"
- Auto-cycle gennem per-spiller stats (5s per spiller)
- Gruppe-statistik summary

## Player PWA Changes

- Ny screen: personlig stats deep-dive
- "Del" knap (Web Share API eller copy-to-clipboard)
- Historik-tab (hvis auth er aktiveret)
- Achievement-notifikationer (toast/badge animation)

## Commercial Value

- Stats screen er gratis (engagement driver)
- Historik over tid kræver konto (gratis signup)
- Achievements gamificerer gentagne besøg (retention)
- Shareable results driver word-of-mouth (acquisition)

## Dependencies

- Chart.js (allerede tilgængelig i projektet)
- SQLite + Drizzle (planlagt i auth fase)
- Web Share API (native browser API)
- Canvas API for billede-generering
