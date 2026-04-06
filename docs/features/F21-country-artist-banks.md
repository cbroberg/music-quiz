# F21 — Country-specific Artist Banks

## Concept

Curated lists of famous artists per country, organized by era/genre, loaded on demand for quiz generation. Guarantees authentic national music content that Apple Music's generic charts can't provide (DK storefront charts include international hits).

## Status
- **DK (Denmark):** ✅ Implemented (`src/quiz/data/artists-dk.json` — 119 artists)
- **Other countries:** Planned

## File Format

`src/quiz/data/artists-{country}.json`:

```json
{
  "country": "DK",
  "description": "Curated artists across eras and genres",
  "songsPerArtist": { "important": 10, "default": 3 },
  "artists": [
    {
      "name": "Kim Larsen",
      "genre": "Rock",
      "era": "1970s-2010s",
      "important": true
    }
  ]
}
```

**Fields:**
- `name` (required) — exact artist name for Apple Music search
- `genre` — primary genre (Pop, Rock, Jazz, Hip-hop, Electronic, Classical, Metal, Folk, etc.)
- `era` — decade range, e.g. "1970s-2010s"
- `important` — if `true`, fetch up to 10 songs; else 3

## Source usage

Quiz config: `source: "dansk"` → engine loads `artists-dk.json`, searches Apple Music for each artist's top songs, returns combined pool.

## Proposed source IDs
- `dansk` / `dk` — Denmark ✅
- `svensk` / `se` — Sweden
- `norsk` / `no` — Norway
- `finsk` / `fi` — Finland
- `islandsk` / `is` — Iceland
- `tysk` / `de` — Germany
- `britisk` / `uk` — United Kingdom
- `amerikansk` / `us` — United States

## Implementation plan for other countries

1. Create `artists-{xx}.json` with minimum 50 curated artists
2. Add source case in `src/quiz.ts` (generalize current `dansk` to take country param)
3. Add source option in admin.html + quiz-display.js mapSource
4. Add to E2E source matrix test

## Quality criteria
- **Eras covered:** pre-1970 through current decade
- **Genres:** Pop, Rock, Hip-hop, Electronic, Classical minimum
- **Important markers:** top 20% of list, representing the most iconic artists
- **Name accuracy:** must match Apple Music catalog exactly (test with search before committing)

## Rationale
Apple Music API has no "language" or "country-origin" filter for songs. Storefront-based charts (e.g. `dk`) include international hits popular in that country, not domestic artists specifically. Curated artist lists are the only reliable way to get authentic national music quiz content.
