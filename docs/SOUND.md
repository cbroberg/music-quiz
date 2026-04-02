# Sound Design — Quiz Sound Kit

## Overblik

Lydeffekter til Music Quiz og Movie Quiz. Alle lyde er korte, festlige feedback-lyde der afspilles på host-skærmen (Mac/TV) som respons på game events. Spillernes telefoner vibrerer (`navigator.vibrate`) men afspiller ikke lyd.

---

## Afspilningsbibliotek: Howler.js

Howler.js er det mest lightweight og velunderstøttede web audio-bibliotek:

- **7KB gzipped**, ingen dependencies
- Web Audio API med HTML5 Audio fallback
- Understøtter alle browser-formater: MP3, WebM, OGG, WAV, AAC, FLAC
- Audio sprites (flere lyde i én fil)
- Automatisk håndtering af mobile browser audio-lock (autoplay-restriktioner)
- Caching af loadede lyde

### Installation

```bash
npm install howler
```

Hvis quiz-host UI'et senere flyttes til React/Next.js, brug `use-sound` som React-wrapper:

```bash
pnpm add use-sound
pnpm add -D @types/howler
```

### Brug i quiz host UI (vanilla JS)

```javascript
import { Howl } from 'howler';

const sounds = {
  correct:   new Howl({ src: ['/sounds/correct.webm', '/sounds/correct.mp3'] }),
  wrong:     new Howl({ src: ['/sounds/wrong.webm', '/sounds/wrong.mp3'] }),
  countdown: new Howl({ src: ['/sounds/countdown.webm', '/sounds/countdown.mp3'] }),
  applause:  new Howl({ src: ['/sounds/applause.webm', '/sounds/applause.mp3'] }),
  fanfare:   new Howl({ src: ['/sounds/fanfare.webm', '/sounds/fanfare.mp3'] }),
  streak:    new Howl({ src: ['/sounds/streak.webm', '/sounds/streak.mp3'] }),
  join:      new Howl({ src: ['/sounds/join.webm', '/sounds/join.mp3'] }),
  tick:      new Howl({ src: ['/sounds/tick.webm', '/sounds/tick.mp3'], loop: true }),
  reveal:    new Howl({ src: ['/sounds/reveal.webm', '/sounds/reveal.mp3'] }),
  confetti:  new Howl({ src: ['/sounds/confetti.webm', '/sounds/confetti.mp3'] }),
};

// Afspil
sounds.applause.play();

// Stop looped lyd
sounds.tick.stop();
```

### Brug med React (use-sound)

```typescript
import useSound from 'use-sound';

const QuizReveal = () => {
  const [playApplause] = useSound('/sounds/applause.mp3');
  const [playCorrect] = useSound('/sounds/correct.mp3');
  const [playWrong] = useSound('/sounds/wrong.mp3');

  return <button onClick={playApplause}>Klapsalve!</button>;
};
```

### Filformat-strategi

Hver lyd leveres i to formater:

1. **WebM (Opus)** — primært format. Bedste komprimering, bred browser-support.
2. **MP3** — fallback for ældre browsere.

Howler vælger automatisk det første kompatible format fra listen.

### Konvertering med ffmpeg

```bash
# WAV → WebM (Opus, 48kbps — perfekt til korte SFX)
ffmpeg -i applause.wav -c:a libopus -b:a 48k applause.webm

# WAV → MP3 (64kbps fallback)
ffmpeg -i applause.wav -c:a libmp3lame -b:a 64k applause.mp3
```

---

## Sound Kit — komplette lyde

### Oversigt

| Fil | Trigger | Varighed | ~Størrelse (webm) | Beskrivelse |
|-----|---------|----------|-------------------|-------------|
| `correct` | Spiller svarer rigtigt | 1-2s | ~15KB | Glad pling/chime |
| `wrong` | Spiller svarer forkert | 1s | ~10KB | Blød buzzer/bonk |
| `countdown` | 3-2-1 før spørgsmål | 3s | ~25KB | Tre ticks med stigende pitch |
| `applause` | Korrekt svar reveal + final | 3-5s | ~40KB | Klapsalve fra publikum |
| `fanfare` | Vinderpodium | 3-4s | ~35KB | Triumferende trompet/horn |
| `streak` | Streak bonus opnået (3+) | 1s | ~8KB | Hurtig opadgående pling |
| `join` | Spiller joiner lobby | 0.5s | ~5KB | Subtil pop/bloop |
| `tick` | Timer ticking (looped) | 1s | ~10KB | Ur-tick, kan loopes |
| `reveal` | Svar-reveal animation | 1s | ~10KB | Swoosh/whoosh |
| `confetti` | Party popper ved finale | 1-2s | ~15KB | Pop + konfetti-rasl |
| **Total** | | | **~170KB** | |

Samlet budget: under 200KB for hele sound kit'et i WebM. Med MP3 fallback: ~350KB total. Trivielt for en webapp.

### Game event → lyd mapping

```
GameState: lobby
  player_joined          → join

GameState: countdown
  3-2-1 animation        → countdown

GameState: playing
  timer running          → tick (loop)
  timer < 5s             → tick (hurtigere / højere pitch)
  alle har svaret         → tick.stop()

GameState: reveal
  svar vises             → reveal
  korrekt svar           → correct + applause (delay 500ms)
  forkert svar           → wrong
  streak ≥ 3             → streak (efter correct)

GameState: scoreboard
  leaderboard animation  → (ingen lyd — musikken spiller stadig)

GameState: finished
  podium animation       → fanfare
  confetti               → confetti (delay 1s efter fanfare)
  final applause         → applause (delay 2s)
```

---

## Lydkilder — CC0 / royalty-free

Alle lyde skal være CC0 eller royalty-free uden attribution for kommerciel sikkerhed.

### Primær kilde: Pixabay Sound Effects

**URL:** `https://pixabay.com/sound-effects/`

- Royalty-free, ingen attribution nødvendig
- MP3 download, konvertér til WebM
- Kommercielt sikkert

**Søgetermer:**

| Lyd | Søg på Pixabay |
|-----|----------------|
| correct | "correct answer" "success chime" "ding" |
| wrong | "wrong answer" "buzzer" "error" |
| countdown | "countdown beep" "timer" "3 2 1" |
| applause | "applause" "clapping" "crowd cheering" |
| fanfare | "fanfare" "victory" "trumpet" "winner" |
| streak | "bonus" "level up" "power up" "combo" |
| join | "pop" "notification" "bloop" "join" |
| tick | "clock tick" "timer tick" "ticking" |
| reveal | "swoosh" "whoosh" "reveal" "transition" |
| confetti | "party popper" "confetti" "celebration pop" |

### Sekundære kilder

| Kilde | URL | Licens | Bemærkning |
|-------|-----|--------|------------|
| Freesound.org | `freesound.org` | CC0 (filtrér!) | Kæmpe arkiv, filtrér på CC0 licens. Kræver gratis konto. |
| OpenGameArt.org | `opengameart.org/content/cc0-sound-effects` | CC0 | Spil-fokuseret, gode UI-lyde og celebration effects |
| Mixkit | `mixkit.co/free-sound-effects/` | Mixkit License | 36 klapsalver, gratis kommerciel brug |
| Uppbeat | `uppbeat.io/sfx/category/celebrate` | Free w/ attr | Party horns, champagne, cheers. Betalt = ingen attribution |

### AI-genereret (custom)

| Kilde | URL | Licens |
|-------|-----|--------|
| ElevenLabs | `elevenlabs.io/sound-effects/` | Gratis m/ attribution, betalt uden |

Beskrivelser til AI-generering:

```
applause:  "Short enthusiastic crowd applause, 3 seconds, medium-sized audience, warm and celebratory"
fanfare:   "Triumphant brass fanfare, 3 seconds, quiz show victory, major key, uplifting"
countdown: "Three ascending electronic beeps, 1 second apart, game show countdown"
confetti:  "Party popper pop followed by confetti falling, 2 seconds, celebratory"
```

---

## Filstruktur

```
src/quiz/public/sounds/
  correct.webm
  correct.mp3
  wrong.webm
  wrong.mp3
  countdown.webm
  countdown.mp3
  applause.webm
  applause.mp3
  fanfare.webm
  fanfare.mp3
  streak.webm
  streak.mp3
  join.webm
  join.mp3
  tick.webm
  tick.mp3
  reveal.webm
  reveal.mp3
  confetti.webm
  confetti.mp3
```

---

## Audio Sprite alternativ (avanceret)

For færre HTTP-requests kan alle lyde samles i én fil som en audio sprite:

```javascript
const quizSounds = new Howl({
  src: ['/sounds/quiz-sprite.webm', '/sounds/quiz-sprite.mp3'],
  sprite: {
    correct:   [0, 2000],
    wrong:     [2500, 1000],
    countdown: [4000, 3000],
    applause:  [7500, 5000],
    fanfare:   [13000, 4000],
    streak:    [17500, 1000],
    join:      [19000, 500],
    tick:      [20000, 1000],
    reveal:    [21500, 1000],
    confetti:  [23000, 2000],
  }
});

// Brug
quizSounds.play('applause');
quizSounds.play('fanfare');
```

Fordele: én HTTP-request, ~170KB total. Ulempe: sværere at opdatere individuelle lyde.

Anbefaling: start med individuelle filer (simpelt), skift til sprite hvis performance kræver det.

---

## Lyddesign-retningslinjer

### Stemning

- **Festlig og positiv** — quiz er en fest, ikke en eksamen
- **Korte og punchende** — maks 5 sekunder, de fleste under 2
- **Konsistent volume** — normaliser alle lyde til -14 LUFS
- **Undgå irritation** — lyde der høres 50+ gange skal være subtile (tick, correct)
- **Klapsalven skal føles ægte** — undgå canned laughter-vibes

### Volume-hierarki

```
1.0  fanfare (vinderpodium — sjælden, skal føles stor)
0.8  applause, confetti (celebration)
0.6  correct, wrong, countdown (game feedback)
0.4  reveal, streak (UI feedback)
0.2  join, tick (ambient/subtle)
```

Implementér i Howler:

```javascript
const sounds = {
  fanfare:   new Howl({ src: [...], volume: 1.0 }),
  applause:  new Howl({ src: [...], volume: 0.8 }),
  correct:   new Howl({ src: [...], volume: 0.6 }),
  tick:      new Howl({ src: [...], volume: 0.2, loop: true }),
};
```

### Mute-kontrol

Tilføj en mute-toggle i host UI'et (ikke alle vil have lydeffekter):

```javascript
let muted = false;

function toggleMute() {
  muted = !muted;
  Howler.mute(muted);
}
```

Gem præference i `localStorage` så den huskes mellem sessions.

---

## Implementering

### Session (del af QUIZ-PLAN.md session 4)

1. Download 10 lyde fra Pixabay (CC0)
2. Konvertér til WebM + MP3 med ffmpeg
3. Normaliser volume til -14 LUFS med ffmpeg:
   ```bash
   ffmpeg -i input.wav -af loudnorm=I=-14:TP=-1:LRA=11 -c:a libopus -b:a 48k output.webm
   ```
4. Placér i `src/quiz/public/sounds/`
5. Tilføj Howler.js sound manager til `host.js`
6. Wire game events til lyde
7. Tilføj mute-toggle i host UI
8. Test: kør en komplet quiz og vurdér lydbalance

### Definition of Done

- [ ] 10 lyde downloaded og konverteret (WebM + MP3)
- [ ] Howler.js integreret i host UI
- [ ] Alle game events trigger korrekt lyd
- [ ] Volume-hierarki implementeret
- [ ] Mute-toggle fungerer og huskes
- [ ] Total sound bundle < 200KB (WebM)
- [ ] Alle lyde er CC0 eller royalty-free uden attribution
- [ ] Ingen autoplay-problemer på mobile browsers

---

*Plan version 1.0 — Christian Broberg / WebHouse ApS*
*Genereret: 2. april 2026*
