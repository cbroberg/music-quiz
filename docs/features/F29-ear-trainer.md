# F29: Ear Trainer — Progressiv afspilning

**Status:** Idea

## Summary

Sangen starter med kun 1 sekund. Hvis ingen gætter, udvides til 3 sekunder, så 5, 10, 15. Jo kortere klip du gætter på, jo flere point. Heardle-mekanik, men multiplayer og real-time med ægte streaming.

## How It Works

```
Runde 1:  |█|                              → 1 sekund   → 1000 points
Runde 2:  |███|                            → 3 sekunder → 800 points
Runde 3:  |█████|                          → 5 sekunder → 600 points
Runde 4:  |██████████|                     → 10 sekunder → 400 points
Runde 5:  |███████████████|                → 15 sekunder → 200 points
Runde 6:  |████████████████████████████|   → 30 sekunder → 100 points
```

1. Sang starter fra et tilfældigt offset (ikke altid fra starten)
2. Kun de første N sekunder afspilles, derefter pause
3. Spillere kan gætte efter hvert klip
4. Spillere der allerede har svaret forkert kan svare igen i næste runde
5. Første korrekte svar i tidligste runde vinder mest

## Technical

### MusicKit JS:
```javascript
const startOffset = Math.floor(Math.random() * 30); // random start 0-30s
await music.seekToTime(startOffset);
await music.play();
setTimeout(() => music.pause(), clipDurationMs);
```

### Home Controller:
```
play-exact → seek to offset → pause after N seconds
```

## Scoring

| Klip-længde | Points | Svartid-bonus |
|-------------|--------|---------------|
| 1 sekund | 1000 | +200 max |
| 3 sekunder | 800 | +150 max |
| 5 sekunder | 600 | +100 max |
| 10 sekunder | 400 | +50 max |
| 15 sekunder | 200 | +25 max |
| 30 sekunder | 100 | 0 |

"Instant" bonus: +500 hvis gættet korrekt inden for 1-sekunds klippet.

## Player PWA Changes

- Svarknapper er tilgængelige under alle runder
- Forkert svar grayer ud det valgte svar (men tillader nyt forsøg i næste runde)
- Progress-indikator viser klip-længde ("🔊 3 sek")
- Animation: lydbar der vokser med hvert klip

## Host UI Changes

- Visualisering: waveform/equalizer der viser hvor meget af sangen der er afspillet
- Klip-counter: "Klip 2/6 — 3 sekunder"
- Antal spillere der har svaret korrekt per klip
- Suspense-opbygning: mørk baggrund der langsomt bliver lysere

## Random Offset Strategy

- Undgå de første 0-2 sekunder (ofte stille/intro)
- Undgå de sidste 10 sekunder (ofte fade-out)
- Foretruk chorus-offset for kendte sange (kan curates)
- Default: random offset mellem 5-45% af sangens længde

## Dependencies

- Seek-funktionalitet i playback provider (MusicKit JS: `seekToTime()`)
- Timer-præcision for korte klip (1s kræver ±100ms nøjagtighed)
