# F25: Music Map — Geografisk quiz

**Status:** Idea

## Summary

Host-skærmen viser et verdenskort. En sang spiller, og spillerne skal placere en pin på kortet (på deres telefon) der hvor kunstneren/bandet kommer fra. Jo tættere på det rigtige land/by, jo flere point. Visuelt spektakulært på en stor skærm.

## How It Works

1. En sang afspilles (standard playback)
2. Spillernes telefoner viser et interaktivt verdenskort
3. Spillerne tapper/trækker for at placere en pin
4. "Lås" knap confirmer positionen
5. Host-skærmen viser alle spilleres pins + det korrekte sted
6. Linjer trækkes fra hver pin til det korrekte sted (afstand vises)

## Scoring

Haversine-afstand mellem gæt og korrekt position:

```
if (distance < 50km)   → 1000 points  ("Spot on!")
if (distance < 200km)  → 800 points   ("Tæt på!")
if (distance < 500km)  → 600 points   (rigtigt land, typisk)
if (distance < 1000km) → 400 points   (rigtigt region)
if (distance < 2000km) → 200 points   (rigtigt kontinent)
else                   → 0 points
```

## Data Source

Artist origin coordinates — udleder fra `artists.json` country-koder:

```json
{
  "US": { "lat": 37.09, "lng": -95.71, "label": "USA" },
  "UK": { "lat": 51.51, "lng": -0.13, "label": "London, UK" },
  "DK": { "lat": 55.68, "lng": 12.57, "label": "København, Danmark" },
  "JM": { "lat": 18.11, "lng": -77.30, "label": "Kingston, Jamaica" },
  "KR": { "lat": 37.57, "lng": 126.98, "label": "Seoul, Sydkorea" }
}
```

For mere præcision: curated by-level koordinater for kendte kunstnere:
- The Beatles → Liverpool (53.41, -2.98)
- Bob Marley → Kingston (18.11, -77.30)
- ABBA → Stockholm (59.33, 18.07)
- Mew → København (55.68, 12.57)

## Player PWA Changes

- Interaktivt kort (Leaflet.js med OpenStreetMap tiles — gratis, ingen API key)
- Touch: tap for at placere pin, drag for at flytte
- Zoom-kontroller (pinch to zoom)
- "Lås" knap
- Kortet starter zoomed out til hele verden

## Host UI Changes

- Stort verdenskort (fylder hele skærmen)
- Spillernes pins vises i realtid med avatar/emoji (anonymiseret indtil reveal)
- Reveal-animation: korrekt sted markeres med pulserende cirkel
- Linjer trækkes fra alle pins til korrekt sted
- Afstand vises per spiller
- "Nærmest!" highlight for vinderen

## Technical

- **Kort-bibliotek:** Leaflet.js (~42KB gzipped) med OpenStreetMap tiles
- **Koordinat-beregning:** Haversine formula (simpel JS funktion, ingen dependency)
- **WebSocket:** `{ type: 'submit_location', lat: number, lng: number }`

## Fun Factor

- Visuelt imponerende på storskærm
- Lærerigt — "vidste du at reggae kommer fra Jamaica?"
- Overraskelser — "Bee Gees er fra Australien, ikke England!"
- Naturligt samtaleemne mellem runderne

## Dependencies

- Leaflet.js (CDN, gratis)
- OpenStreetMap tiles (gratis, ingen API key)
- Country → koordinat mapping (ny JSON fil)
- Curated artist → by mapping (valgfri, for præcision)
