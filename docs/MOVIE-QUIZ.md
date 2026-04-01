# Movie & TV Quiz — Multiplayer Party Game

## Vision

En film- og serie-quiz der bygger videre på Music Quiz-infrastrukturen. Samme game engine, samme PWA, men med film og serier som domæne — med fokus på indhold og bredere filmkultur. Quizmasteren kører spillet på storskærmen, deltagerne svarer fra telefonerne.

**Data-kilder:**
- **TMDB** (The Movie Database) — metadata, posters, cast, trailers
- **Apple Music** — soundtracks og scores (via eksisterende MCP server)
- **YouTube** — trailers via TMDB's video-keys

---

## Forudsætninger

- TMDB API key (gratis, kræver registrering på themoviedb.org og Christian Broberg har sågar betalt konto)
- Apple Music abonnement + eksisterende MCP server (til soundtrack-afspilning) - kan MCP skiftes til direkte API?
- Home Controller på Mac (til soundtrack-afspilning i web mode)
- Eksisterende Music Quiz infrastruktur fra `QUIZ-PLAN.md` fase 1

---

## Lyd i film-quizzen — hvad er muligt?

### Mulighed 1: Soundtracks via Apple Music (primær)

Film-soundtracks og scores er tilgængelige på Apple Music. Vi bruger den eksisterende MCP server til at søge og afspille:

- Søg `"Severance soundtrack"` → afspil score-tracks
- Søg `"Ted Lasso theme"` → afspil intro-musik
- Søg `"Hans Zimmer Inception"` → afspil ikoniske themes

**Quiz-type: "Gæt filmen/serien fra soundtracket"**

Engine søger Apple Music for `"{title} soundtrack"` eller `"{title} score"` og afspiller et track. Spillerne skal gætte hvilken film/serie det tilhører.

**Fordele:** Fuld kvalitet, lovligt, bruger eksisterende infra.
**Begrænsninger:** Ikke alle film har ikoniske/genkendelige soundtracks. Virker bedst for store produktioner.

### Mulighed 2: YouTube-trailers via TMDB (sekundær)

TMDB's API returnerer YouTube-trailer-keys for næsten alle film og serier:

```
GET /3/movie/{id}/videos → { key: "SUXWAEX2jlg", site: "YouTube", type: "Trailer" }
→ https://www.youtube.com/watch?v=SUXWAEX2jlg
```

**Quiz-type: "Gæt filmen fra traileren"**

Embed YouTube-traileren i host UI'et (via iframe), men skjul billedet — afspil kun lyden. Spillerne hører dialog, sound effects og musik fra traileren og skal gætte filmen.

**Teknisk:** YouTube IFrame API tillader `controls: 0` og kan manipulere playback. For "audio only" kan man:
- Embedde med `width: 1px; height: 1px; opacity: 0` (visuelt skjult)
- Eller vise en generisk "lytter..." animation i stedet for video

**Fordele:** Faktisk dialog og lydeffekter fra filmene. Meget engagerende.
**Begrænsninger:** Kræver internet, YouTube-embed har restriktioner på mobile devices (autoplay-blokering). Bedst egnet til host-skærmen (Mac/TV). YouTubes ToS kræver at playeren er synlig — visuelt skjult afspilning kan teknisk stride mod deres regler, så brug med omtanke til privat/familiebrrug.

### Mulighed 3: Ingen lyd — rent visuelt (fallback)

Mange quiz-typer fungerer glimrende uden lyd:
- Blurred poster der gradvist skærpes
- Silhouette af karakter
- Cast-liste uden titel
- Citater som tekst
- Still-frames fra trailers (YouTube thumbnail)

---

## TMDB API — hvad vi har adgang til

### Discover: Apple TV+ indhold

```
GET /3/discover/movie?with_watch_providers=350&watch_region=DK&sort_by=popularity.desc
GET /3/discover/tv?with_watch_providers=350&watch_region=DK&sort_by=popularity.desc
```

Provider ID 350 = Apple TV Plus. Returnerer alle film/serier tilgængelige på Apple TV+ i Danmark.

### Per titel (med append_to_response for ét API-kald)

```
GET /3/movie/{id}?append_to_response=credits,videos,images,keywords
```

**Returnerer:**
- `title`, `overview`, `release_date`, `vote_average`, `genres`
- `poster_path` → `https://image.tmdb.org/t/p/w500{poster_path}`
- `backdrop_path` → `https://image.tmdb.org/t/p/w1280{backdrop_path}`
- `credits.cast[]` — skuespillere med `character`, `profile_path`
- `credits.crew[]` — instruktør, producer osv.
- `videos.results[]` — YouTube-trailer keys
- `images.posters[]`, `images.backdrops[]` — alternative billeder

### Søgning

```
GET /3/search/multi?query=Severance → film + serier + personer i ét kald
```

### Fri brug

TMDB API er gratis for ikke-kommerciel brug med attribution. Kræver registrering for API key. Rate limit: ~40 requests/sekund.

---

## Quiz-typer

### Visuelle (ingen lyd nødvendig)

#### Q1: Gæt fra blurred poster
- Vis poster med kraftig CSS blur (30px)
- Hvert hint reducerer blur (30 → 20 → 10 → 0)
- 4 svarmuligheder

#### Q2: Gæt fra cast
- Vis 3-4 skuespillernavne (fra `credits.cast`)
- "Hvilken film/serie har disse skuespillere?"
- Kan også vise skuespiller-fotos (TMDB `profile_path`)

#### Q3: Gæt fra beskrivelse
- Vis `overview` tekst med titlen fjernet/censureret
- Spillerne gætter hvilken film/serie det er

#### Q4: Gæt årstal
- Vis poster + titel
- "Hvornår havde [titel] premiere?"
- 4 årstal som svarmuligheder

#### Q5: Hvem spiller hvem?
- Vis et skuespillerfoto
- "Hvilken karakter spiller [navn] i [titel]?"
- 4 karakternavne som muligheder

#### Q6: Gæt fra citat (curated)
- Ikoniske citater fra film/serier
- Kræver en curated database (se nedenfor)

#### Q7: Gæt instruktøren
- Vis poster + titel
- "Hvem instruerede [titel]?"
- 4 instruktørnavne

### Med lyd

#### Q8: Gæt fra soundtrack (Apple Music)
- Afspil et track fra filmens/seriens score
- "Hvilken film/serie er dette soundtrack fra?"
- Bruger eksisterende Home Controller + Apple Music

#### Q9: Gæt fra trailer-lyd (YouTube)
- Afspil trailer-lyd uden video
- "Hvilken film/serie er denne trailer fra?"
- Bruger YouTube IFrame API

#### Q10: Gæt fra theme song (Apple Music)
- Afspil intro/theme song
- "Hvilken serie har denne theme song?"
- Særligt godt til TV-serier (Ted Lasso, Severance, For All Mankind osv.)

---

## Arkitektur

### Nyt: TMDB Service

**Fil:** `src/quiz/tmdb-service.ts`

```typescript
interface TMDBConfig {
  apiKey: string;       // TMDB API key (fra .env)
  region: string;       // 'DK' for Danmark
  language: string;     // 'da-DK' eller 'en-US'
}

interface MovieQuizSource {
  type: 'apple-tv-plus' | 'popular-movies' | 'popular-tv' | 'genre' | 'decade' | 'specific-title';
  genreId?: number;
  decade?: string;        // "2020" for 2020s
  titleQuery?: string;    // for specific-title
}

class TMDBService {
  // Discover: hent film/serier fra Apple TV+
  async discoverAppleTVPlus(mediaType: 'movie' | 'tv', page?: number): Promise<TMDBTitle[]>

  // Discover: populære film/serier generelt
  async discoverPopular(mediaType: 'movie' | 'tv', page?: number): Promise<TMDBTitle[]>

  // Discover: filtreret på genre og/eller årti
  async discoverFiltered(mediaType: 'movie' | 'tv', filters: DiscoverFilters): Promise<TMDBTitle[]>

  // Hent detaljer med credits, videos, images
  async getDetails(mediaType: 'movie' | 'tv', id: number): Promise<TMDBTitleDetails>

  // Søg på tværs af film og serier
  async search(query: string): Promise<TMDBSearchResult[]>

  // Generer quiz-spørgsmål baseret på source
  async generateQuestions(config: MovieQuizConfig): Promise<MovieQuizQuestion[]>
}
```

### Genbrugt fra Music Quiz

- **Game engine** (`engine.ts`) — session management, scoring, game loop
- **WebSocket handler** (`ws-handler.ts`) — real-time kommunikation
- **Player PWA** (`play.html/css/js`) — svarknapper, lobby, scoreboard
- **Routes** (`routes.ts`) — Express endpoints

### Udvidet: Host UI

Host UI'et skal understøtte begge quiz-domæner:
- Musik: album artwork, audio playback
- Film: posters, backdrops, cast-fotos, YouTube-trailers, tekst-citater

Den nemmeste tilgang er en `quizDomain` property på sessionen ('music' | 'movie') der styrer hvilke UI-komponenter der vises.

---

## Datamodeller

### MovieQuizQuestion

```typescript
interface MovieQuizQuestion {
  // Fælles
  questionType: MovieQuestionType;
  options: string[];
  correctIndex: number;
  hint?: string;

  // TMDB data
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  title: string;
  overview: string;
  releaseYear: number;
  posterUrl: string;          // https://image.tmdb.org/t/p/w500/...
  backdropUrl: string;        // https://image.tmdb.org/t/p/w1280/...
  voteAverage: number;
  genres: string[];

  // Cast (for cast-baserede spørgsmål)
  cast?: CastMember[];

  // Crew (for instruktør-spørgsmål)
  director?: string;

  // Trailer (for lyd-spørgsmål)
  trailerYoutubeKey?: string;

  // Soundtrack (for Apple Music lyd-spørgsmål)
  soundtrackQuery?: string;   // søgeterm til Apple Music
  soundtrackSongId?: string;  // Apple Music song ID (resolved server-side)
}

type MovieQuestionType =
  | 'guess-from-blurred-poster'
  | 'guess-from-cast'
  | 'guess-from-description'
  | 'guess-the-year'
  | 'who-plays-who'
  | 'guess-the-director'
  | 'guess-from-soundtrack'
  | 'guess-from-trailer-audio'
  | 'guess-from-theme-song'
  | 'guess-from-quote';

interface CastMember {
  name: string;
  character: string;
  profileUrl?: string;        // https://image.tmdb.org/t/p/w185/...
}
```

### MovieQuizConfig

```typescript
interface MovieQuizConfig {
  questionCount: number;          // 5-20
  timeLimit: number;              // sekunder
  questionTypes: MovieQuestionType[];  // hvilke typer (kan blande)
  source: MovieQuizSource;
  difficulty: 'easy' | 'medium' | 'hard';
  includeAudio: boolean;          // om lyd-spørgsmål er med
}
```

---

## Curated Data: Citater

TMDB har ikke citater. For "gæt fra citat"-spørgsmål, vedligehold en lokal JSON-fil:

**Fil:** `src/quiz/data/movie-quotes.json`

```json
[
  {
    "quote": "I'll be back.",
    "tmdbId": 218,
    "mediaType": "movie",
    "title": "The Terminator",
    "character": "The Terminator",
    "actor": "Arnold Schwarzenegger"
  },
  {
    "quote": "Football is life!",
    "tmdbId": 97546,
    "mediaType": "tv",
    "title": "Ted Lasso",
    "character": "Dani Rojas",
    "actor": "Cristo Fernández"
  }
]
```

Start med ~50-100 citater. Kan udvides over tid. Undgå at sende selve citatteksten fra ophavsretligt beskyttet materiale i API-responses — brug dem kun til quiz-visning på host-skærmen, ikke reproduction.

---

## Spørgsmåls-generering

### Algoritme for distraktorer (forkerte svar)

God distraktorer er nøglen til en sjov quiz. Strategi per spørgsmålstype:

**Gæt filmen:** Vælg 3 andre titler fra samme genre, samme årti, eller samme streaming-platform. TMDB Discover gør dette nemt.

**Gæt årstallet:** Vælg 3 andre år inden for ±5 år af det korrekte. For "hard" mode: ±2 år.

**Gæt instruktøren:** Vælg 3 andre instruktører fra film i samme genre/periode.

**Hvem spiller hvem:** Vælg 3 andre karakternavne fra samme film/serie.

**Gæt fra cast:** Vælg 3 andre titler der deler mindst én skuespiller (for at gøre det svært).

### Soundtrack-resolution

For lyd-spørgsmål, resolv soundtrack server-side:

1. Tag filmens titel fra TMDB
2. Søg Apple Music catalog: `search_catalog("{title} official soundtrack")`
3. Hvis resultat: gem `songId` for et ikonisk track
4. Hvis intet resultat: søg `"{title} score"` eller `"{composer} {title}"`
5. Fallback: markér spørgsmålet som `includeAudio: false`

---

## Nyt MCP Tool: `movie_quiz`

Tilføj til MCP serveren som et nyt tool, parallelt med `music_quiz`:

```typescript
{
  name: 'movie_quiz',
  description: 'Generate a movie/TV quiz with questions from TMDB',
  inputSchema: {
    type: 'object',
    properties: {
      questionCount: { type: 'number', default: 10 },
      questionTypes: {
        type: 'array',
        items: { type: 'string', enum: [
          'guess-from-blurred-poster', 'guess-from-cast',
          'guess-from-description', 'guess-the-year',
          'who-plays-who', 'guess-the-director',
          'guess-from-soundtrack', 'guess-from-trailer-audio',
          'guess-from-theme-song', 'guess-from-quote'
        ]},
        default: ['guess-from-blurred-poster', 'guess-from-cast', 'guess-the-year']
      },
      source: { type: 'string', enum: [
        'apple-tv-plus', 'popular-movies', 'popular-tv', 'mixed'
      ], default: 'mixed' },
      decade: { type: 'string', description: 'e.g. "2020" for 2020s' },
      genre: { type: 'string', description: 'e.g. "comedy", "sci-fi"' },
      difficulty: { type: 'string', enum: ['easy', 'medium', 'hard'], default: 'medium' },
      includeAudio: { type: 'boolean', default: false }
    }
  }
}
```

---

## Implementeringsplan

### Afhængighed: Music Quiz fase 1

Movie Quiz bygger oven på Music Quiz infrastrukturen. Implementér `QUIZ-PLAN.md` fase 1 først.

### Session 1: TMDB Service + Movie Quiz Generator

1. Tilføj `TMDB_API_KEY` til `.env` og Fly.io secrets
2. `src/quiz/tmdb-service.ts` — TMDB API client med caching
3. `src/quiz/movie-engine.ts` — spørgsmålsgenerering med distraktorer
4. `src/quiz/data/movie-quotes.json` — 50+ curated citater
5. `movie_quiz` MCP tool
6. Test: generér 10 spørgsmål fra Apple TV+ indhold

### Session 2: Host UI — Film-mode

1. Udvid `host.html/js` med film-specifikke screens:
   - Blurred poster med progressiv reveal
   - Cast-grid med skuespiller-fotos
   - Beskrivelse med censureret titel
   - YouTube-trailer embed (hidden video, audio only)
2. `quizDomain` switch i game engine
3. Setup screen: vælg mellem "Musik Quiz" og "Film Quiz"
4. Test: komplet film-quiz flow uden lyd

### Session 3: Soundtrack Integration + Polish

1. Soundtrack-resolution via Apple Music API
2. Theme song detection og afspilning
3. YouTube-trailer lyd-afspilning på host
4. Fallback-håndtering (ingen soundtrack → visuel quiz)
5. Deploy til Fly.io
6. End-to-end test med familie

---

## Filstruktur (nye/ændrede filer)

```
src/
  quiz/
    tmdb-service.ts         # NY: TMDB API client
    movie-engine.ts         # NY: Film-quiz spørgsmålsgenerator
    movie-quiz-tool.ts      # NY: MCP tool for movie_quiz
    data/
      movie-quotes.json     # NY: Curated citater
      tmdb-genres.json      # NY: Genre ID → navn mapping (cache)
    engine.ts               # ÆNDRET: quizDomain support
    types.ts                # ÆNDRET: MovieQuizQuestion interfaces
    ws-handler.ts           # ÆNDRET: håndtér movie quiz messages
    public/
      host.html             # ÆNDRET: film-mode screens
      host.css              # ÆNDRET: poster/cast styling
      host.js               # ÆNDRET: YouTube embed, blur-reveal
```

---

## TMDB Attribution

Påkrævet for brug af TMDB API:

> "This product uses the TMDB API but is not endorsed or certified by TMDB."

Vis TMDB-logo i footer på host-skærmen og i "Om"-sektion. Logo-assets: https://www.themoviedb.org/about/logos-attribution

---

## Definition of Done

- [ ] TMDB Service kan hente Apple TV+ titler med metadata
- [ ] Movie quiz generator producerer 10 spørgsmål med gode distraktorer
- [ ] `movie_quiz` MCP tool fungerer fra Claude
- [ ] Host UI viser blurred poster, cast, beskrivelse korrekt
- [ ] Soundtrack-afspilning virker for film med tilgængelig score
- [ ] YouTube-trailer lyd fungerer som fallback
- [ ] Setup screen lader quizmaster vælge mellem musik og film
- [ ] Curated quote-database med 50+ citater
- [ ] TMDB attribution vises korrekt
- [ ] Deployed og tilgængeligt som del af music.broberg.dk/quiz

---

## Samspil med QUIZ-PLAN.md

```
QUIZ-PLAN.md Fase 1     →  Grund-infrastruktur (engine, PWA, WebSocket, host UI)
MOVIE-QUIZ.md            →  Film-udvidelse (TMDB, nye quiz-typer, soundtrack-bridge)
QUIZ-PLAN.md Fase 2     →  tvOS app (fungerer med begge quiz-domæner)
```

tvOS-appen i fase 2 arver automatisk film-quiz support, da den loader web UI'et fra serveren. MusicKit på Apple TV kan afspille soundtracks direkte.

---

## Estimat: 3 cc sessioner

| Session | Scope |
|---------|-------|
| 1 | TMDB Service + movie-engine + movie_quiz tool + quotes.json |
| 2 | Host UI film-mode (blurred poster, cast, YouTube embed) + domain switch |
| 3 | Soundtrack integration + polish + deploy |

---

*Plan version 1.0 — Christian Broberg / WebHouse ApS*
*Genereret: 31. marts 2026*
