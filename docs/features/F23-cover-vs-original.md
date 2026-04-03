# F23: Cover vs. Original

**Status:** Idea

## Summary

Afspil to versioner af samme sang — originalen og et cover. Spillerne skal enten gætte hvilken der er originalen, eller hvem der har lavet coveret. Tester ægte musikviden og trænet øre.

## Game Variants

### Variant A: Spot originalen

1. To klip afspilles (15-20 sek hver): Version A og Version B
2. Spillerne svarer: "A er originalen" eller "B er originalen"
3. Simpelt 50/50 — men med musik-viden er det ikke tilfældigt

### Variant B: Hvem coverer?

1. Et klip afspilles — det er et cover
2. Spillerne gætter hvem der performer dette cover (4 muligheder)
3. Originalen afspilles bagefter som reveal

### Variant C: Original eller cover?

1. Et enkelt klip afspilles
2. Spillerne svarer: "Original" eller "Cover"
3. Hvis cover → bonus-spørgsmål: "Hvem er det?"

## Technical: Finding Covers

Apple Music catalog search:
```
search_catalog("{song title}") → filtrér resultater med samme titel men forskellige artists
```

Heuristik for at matche covers:
- Samme songtitel, different artist
- Ekskludér live-versioner, remixes, karaoke (filtrér på title keywords)
- Verificér at begge tracks er tilgængelige i brugerens region

Alternativt: Curated cover-par i JSON-fil for de bedste matches:
```json
[
  {
    "title": "Hallelujah",
    "original": { "artist": "Leonard Cohen", "songId": "..." },
    "cover": { "artist": "Jeff Buckley", "songId": "..." }
  },
  {
    "title": "Hurt",
    "original": { "artist": "Nine Inch Nails", "songId": "..." },
    "cover": { "artist": "Johnny Cash", "songId": "..." }
  }
]
```

## Host UI Changes

- Split-screen: "Version A" (venstre) og "Version B" (højre)
- Equalizer-animation for den version der aktuelt spiller
- Reveal: album artwork for begge versioner side by side

## Scoring

- Variant A: 500 points for korrekt (simpelt binært)
- Variant B: 1000 points, tid-baseret (standard)
- Variant C: 500 for original/cover + 500 bonus for korrekt artist

## Dependencies

- Curated cover-pairs JSON fil (`src/quiz/data/cover-pairs.json`)
- Dobbelt playback: enten sekventielt (A derefter B) eller med en "Skift" knap
