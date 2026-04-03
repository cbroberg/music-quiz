# F27: Mashup Round — To sange, én runde

**Status:** Idea

## Summary

To sange afspilles samtidigt eller i hurtige skift. Spillerne skal identificere begge sange. Dobbelt point, dobbelt svært — og ofte dobbelt sjovt.

## Game Variants

### Variant A: Simultaneous Mix

- To sange afspilles samtidigt med lige volume
- Spillerne skal gætte begge (to separate svar-runder)
- Kaotisk og sjovt — tester evnen til at separere lydlag

### Variant B: Quick Switch

- 3-sekunders klip skifter mellem sang A og sang B
- Pattern: A-B-A-B-A-B (total 18 sekunder)
- Spillerne skal gætte begge

### Variant C: Fade Mashup

- Sang A starter, crossfader langsomt til sang B over 15 sekunder
- Spillerne gætter A først (hurtigt!), derefter B

## Technical

### Simultaneous playback:

```javascript
// MusicKit JS: sæt queue med to sange
await music.setQueue({ songs: [songIdA] });
await music.play();

// Howler.js overlay for sang B (preview clip):
const overlay = new Howl({
  src: [previewUrlB],
  volume: 0.7
});
overlay.play();
```

Alternativt: Brug Web Audio API til at mixe to AudioBuffer-sources med gain-kontrol.

### Quick Switch:

```javascript
let current = 'A';
setInterval(() => {
  if (current === 'A') {
    music.pause();
    overlayB.play();
    current = 'B';
  } else {
    overlayB.pause();
    music.play();
    current = 'A';
  }
}, 3000);
```

## Scoring

- 500 points per korrekt sang (1000 total for begge)
- Bonus 200 points hvis begge gættes korrekt = 1200 total
- Tid-baseret inden for hvert gæt

## Song Pairing Strategy

- Vælg sange fra **forskellige genrer** (lettere at separere)
- Eller fra **samme genre** for hard mode (to rock-sange = kaos)
- Undgå sange i samme key/tempo (lyder for ens blandet sammen)
- Curated pairs giver bedst resultat

## Dependencies

- Web Audio API eller dual Howler.js instanser
- Preview URLs som fallback (MusicKit JS understøtter kun én aktiv queue)
