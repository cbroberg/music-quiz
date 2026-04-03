# F26: Setlist Challenge — Hvad kommer næst?

**Status:** Idea

## Summary

Afspil 3-4 sange i træk fra et album eller en kunstners mest kendte numre. Spillerne skal gætte den næste sang i rækkefølgen. Tester dybdegående kendskab til albums og kunstnere.

## Game Variants

### Variant A: Album Track Order

1. Afspil track 1, 2, 3 fra et album (korte klip, 10s hver)
2. "Hvad er track 4?" — 4 muligheder (alle fra samme album)
3. Tester om du kender albummet godt nok til at kende rækkefølgen

### Variant B: Greatest Hits Sequence

1. Afspil 3 sange fra en artists mest populære (sorteret efter popularitet)
2. "Hvad er den næste mest populære?" — 4 muligheder
3. Mere tilgængeligt — kræver ikke album-kendskab

### Variant C: Chronological

1. Afspil 3 sange fra en artist i kronologisk rækkefølge
2. "Hvad kom derefter?" — 4 muligheder (sange fra samme artist, forskellige år)
3. Tester karriere-kendskab

## Data Source

- **Album tracks:** Apple Music API `get_album_details` → tracks i korrekt rækkefølge
- **Greatest hits:** Apple Music API `get_artist_songs` sorteret efter popularitet
- **Kronologisk:** `get_artist_songs` sorteret efter release_date

## Scoring

- Standard 1000 points, tid-baseret
- Bonus: Hvis spilleren kan nævne ALLE resterende tracks → 500 ekstra (free-text, AI eval)

## Host UI Changes

- "Setlist" visning: nummererede slots (1. ✓  2. ✓  3. ✓  4. ?)
- Album artwork i baggrunden
- Reveal: slot 4 udfyldes med sangtitel
- Mini-afspilning af det korrekte svar

## Dependencies

- Apple Music API album/artist endpoints (allerede implementeret)
- Ingen nye biblioteker
