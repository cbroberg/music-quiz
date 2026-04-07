# QUIZ-PATCH-001 — Commercial Platform & Multi-Provider

**Patcher:** `QUIZ-PLAN.md` + `MOVIE-QUIZ.md`
**Status:** Draft
**Dato:** 2. april 2026

Denne patch opdaterer begge planer med fire store ændringer:

1. MusicKit JS erstatter Home Controller som primær afspilning
2. Spotify som ekstra provider (multi-provider arkitektur)
3. Cross-platform support (Windows, Linux, ChromeOS)
4. Kommerciel strategi (tiers, priser, licenser, markedspositionering)

---

## P1: MusicKit JS erstatter Home Controller

### Hvad ændres

Home Controller (AppleScript via WebSocket til Mac) degraderes fra **primær** til **legacy fallback**. MusicKit JS bliver den primære afspilningsmetode for Apple Music.

### Hvorfor

MusicKit JS (`https://js-cdn.music.apple.com/musickit/v3/musickit.js`) giver fuld Apple Music-afspilning direkte i browseren. Ingen Mac, ingen AppleScript, ingen WebSocket-bridge, ingen launchd-agent. Det fungerer på enhver platform med en moderne browser.

Det vi så under test — `music.apple.com` der viste en fuld web-player — er præcis MusicKit JS i aktion. Apple bruger det selv.

### Teknisk implementation

**Nyt: `src/quiz/playback/musickit-web.ts`**

```typescript
// MusicKit JS web playback provider
import { PlaybackProvider } from './types';

export class MusicKitWebProvider implements PlaybackProvider {
  name = 'apple-music-web' as const;
  private music: MusicKit.MusicKitInstance | null = null;

  async initialize(developerToken: string): Promise<void> {
    await MusicKit.configure({
      developerToken,
      app: {
        name: 'Music Quiz',
        build: '1.0.0'
      }
    });
    this.music = MusicKit.getInstance();
  }

  async authorize(): Promise<boolean> {
    if (!this.music) return false;
    try {
      await this.music.authorize();
      return true;
    } catch {
      return false;
    }
  }

  async isAvailable(): Promise<boolean> {
    return typeof MusicKit !== 'undefined' && this.music?.isAuthorized === true;
  }

  async play(songId: string): Promise<void> {
    if (!this.music) throw new Error('MusicKit not initialized');
    await this.music.setQueue({ song: songId });
    await this.music.play();
  }

  async pause(): Promise<void> {
    this.music?.pause();
  }

  async resume(): Promise<void> {
    await this.music?.play();
  }

  async setVolume(level: number): Promise<void> {
    if (this.music) this.music.volume = level;
  }

  async search(query: string): Promise<SearchResult[]> {
    if (!this.music) return [];
    const results = await this.music.api.music(`/v1/catalog/dk/search`, {
      term: query,
      types: 'songs',
      limit: 10
    });
    return results.data.results.songs?.data || [];
  }
}
```

### Ændringer i `QUIZ-PLAN.md`

**F1.5 (Music Playback Integration)** — omskrives:

```
GAMMEL:
  Musik-afspilning sker via det eksisterende Home Controller WebSocket.

NY:
  Musik-afspilning sker primært via MusicKit JS i host-browseren.
  Host-skærmen loader MusicKit JS fra Apples CDN og beder brugeren
  om at logge ind med sit Apple Music-abonnement ved quiz-start.
  Musikken afspilles direkte i browseren — ingen Mac, ingen Home Controller.

  Fallback-kæde:
  1. MusicKit JS (browser) — primær, cross-platform
  2. Spotify Web Playback SDK — alternativ provider (se P2)
  3. Home Controller (AppleScript) — legacy, kun Mac
  4. Preview-clips (30s) — ingen login nødvendig
```

**F1.2 (Quiz Host UI)** — tilføj til Setup Screen:

```
- Vælg afspilningsmetode:
  - "Apple Music" → MusicKit JS auth flow
  - "Spotify" → Spotify OAuth flow (se P2)
  - "Previews" → ingen login, 30s clips
```

**F1.6 (Server Routes)** — tilføj:

```
GET  /quiz/musickit-token  → Developer token endpoint (JWT, server-genereret)
```

Developer token genereres server-side fra `.p8`-nøglen (allerede i Fly.io secrets) og returneres til host-browseren. Brugeren behøver aldrig se nøglen.

### Ændringer i `QUIZ-PLAN.md` fase 2 (tvOS)

**F2.4 (MusicKit Playback)** — uændret. tvOS-appen bruger stadig native MusicKit (Swift) til afspilning. MusicKit JS er kun relevant for web-host.

Men tilføj en ny feature-detect i `/quiz/tv`:

```javascript
// I host.js / tv-mode:
if (window.webkit?.messageHandlers?.quiz) {
  // tvOS mode: brug native MusicKit via Swift bridge
  playback = new NativeMusicKitProvider();
} else if (typeof MusicKit !== 'undefined') {
  // Web mode: brug MusicKit JS
  playback = new MusicKitWebProvider();
} else {
  // Fallback: preview clips
  playback = new PreviewProvider();
}
```

### Ændringer i `MOVIE-QUIZ.md`

Soundtrack-afspilning i film-quizzen bruger nu MusicKit JS i stedet for Home Controller:

```
GAMMEL (under "Soundtrack-resolution"):
  Søg Apple Music catalog: search_catalog("{title} official soundtrack")

NY:
  Søg via MusicKit JS i host-browseren:
  const results = await music.api.music('/v1/catalog/dk/search', {
    term: `${movieTitle} official soundtrack`,
    types: 'songs'
  });
  Afspil direkte: await music.setQueue({ song: results[0].id });
```

### Filer der fjernes fra kritisk path

Home Controller (`home/` mappen) er stadig nyttig til Claude-orkestreret afspilning via MCP, men er **ikke længere påkrævet** for quiz-funktionaliteten.

---

## P2: Spotify som ekstra provider

### Provider-abstraktion

**Ny fil: `src/quiz/playback/types.ts`**

```typescript
export interface PlaybackProvider {
  name: 'apple-music-web' | 'apple-music-native' | 'spotify' | 'home-controller' | 'preview';

  // Lifecycle
  initialize(config: ProviderConfig): Promise<void>;
  authorize(): Promise<boolean>;
  isAvailable(): Promise<boolean>;

  // Playback
  play(songId: string): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  setVolume(level: number): Promise<void>;

  // Search (for quiz question resolution)
  search(query: string): Promise<SearchResult[]>;
  searchSoundtrack?(movieTitle: string): Promise<SearchResult[]>;
}

export interface SearchResult {
  id: string;
  name: string;
  artistName: string;
  albumName: string;
  artworkUrl: string;
  durationMs: number;
  previewUrl?: string;
}

export interface ProviderConfig {
  type: 'apple-music' | 'spotify';
  // Apple Music
  developerToken?: string;
  // Spotify
  clientId?: string;
  redirectUri?: string;
}
```

### Spotify Web Playback SDK

**Ny fil: `src/quiz/playback/spotify-web.ts`**

```typescript
export class SpotifyWebProvider implements PlaybackProvider {
  name = 'spotify' as const;
  private player: Spotify.Player | null = null;
  private accessToken: string | null = null;
  private deviceId: string | null = null;

  async initialize(config: ProviderConfig): Promise<void> {
    // Spotify Web Playback SDK lades via script tag
    // <script src="https://sdk.scdn.co/spotify-player.js"></script>
    return new Promise((resolve) => {
      window.onSpotifyWebPlaybackSDKReady = () => {
        this.player = new Spotify.Player({
          name: 'Music Quiz',
          getOAuthToken: (cb) => cb(this.accessToken!)
        });
        this.player.connect();
        this.player.addListener('ready', ({ device_id }) => {
          this.deviceId = device_id;
          resolve();
        });
      };
    });
  }

  async authorize(): Promise<boolean> {
    // Spotify OAuth 2.0 PKCE flow
    // Redirect til Spotify login, returnér med access token
    // Scopes: streaming, user-read-playback-state, user-modify-playback-state
    const params = new URLSearchParams({
      client_id: config.clientId!,
      response_type: 'code',
      redirect_uri: config.redirectUri!,
      scope: 'streaming user-read-playback-state user-modify-playback-state',
      code_challenge_method: 'S256',
      code_challenge: await generateCodeChallenge()
    });
    window.location.href = `https://accounts.spotify.com/authorize?${params}`;
    return true;
  }

  async play(songId: string): Promise<void> {
    await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${this.deviceId}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${this.accessToken}` },
      body: JSON.stringify({ uris: [`spotify:track:${songId}`] })
    });
  }

  async search(query: string): Promise<SearchResult[]> {
    const res = await fetch(
      `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=10`,
      { headers: { Authorization: `Bearer ${this.accessToken}` } }
    );
    const data = await res.json();
    return data.tracks.items.map(mapSpotifyTrack);
  }
}
```

### Spotify Developer Setup

Kræver:
1. Registrer app på `developer.spotify.com/dashboard`
2. Sæt redirect URI: `https://music.quiz-mash.com/quiz/spotify-callback`
3. Gem `SPOTIFY_CLIENT_ID` i `.env` og Fly.io secrets
4. Ingen client secret nødvendig (PKCE flow er client-side only)

**Vigtigt:** Spotify Web Playback SDK kræver **Spotify Premium**. Free-brugere kan stadig deltage som spillere (PWA'en afspiller ikke musik), men hosten skal have Premium for fuld afspilning.

### Server-side song ID resolution

Quiz engine'en genererer spørgsmål med song IDs. Problemet: et Apple Music song ID er ikke det samme som et Spotify track ID. Løsning:

**Ny fil: `src/quiz/playback/song-resolver.ts`**

```typescript
export class SongResolver {
  // Givet en sang (titel + artist), find ID'et hos den aktive provider
  async resolve(
    songName: string,
    artistName: string,
    provider: 'apple-music' | 'spotify'
  ): Promise<string | null> {
    const query = `${songName} ${artistName}`;

    if (provider === 'apple-music') {
      // Brug Apple Music API (server-side, allerede implementeret)
      return this.searchAppleMusic(query);
    } else {
      // Brug Spotify Search API (server-side, kræver client credentials)
      return this.searchSpotify(query);
    }
  }
}
```

Quiz-spørgsmål gemmes med **provider-agnostiske metadata** (titel, artist, album, artwork fra Apple Music API eller TMDB). Song ID resolves on-the-fly baseret på hostens valgte provider.

### Ændringer i `QUIZ-PLAN.md`

**F1.7 (Filstruktur)** — udvid:

```
src/
  quiz/
    playback/
      types.ts              # PlaybackProvider interface
      musickit-web.ts       # Apple Music via MusicKit JS
      spotify-web.ts        # Spotify via Web Playback SDK
      home-controller.ts    # Legacy: AppleScript via WebSocket
      preview.ts            # Fallback: 30s preview clips
      song-resolver.ts      # Provider-agnostisk song lookup
      provider-factory.ts   # Factory: vælg provider baseret på config
```

**F1.6 (Server Routes)** — tilføj:

```
GET  /quiz/spotify-callback  → Spotify OAuth callback
POST /quiz/api/resolve-song  → Resolve song ID for given provider
```

### Ændringer i `MOVIE-QUIZ.md`

Film-quiz soundtracks resolves via samme SongResolver:

```typescript
// I movie-engine.ts:
const soundtrackQuery = `${movieTitle} official soundtrack`;
const songId = await songResolver.resolve(soundtrackQuery, '', activeProvider);
```

---

## P3: Cross-platform support

### Hvad ændres

Med MusicKit JS + Spotify Web Playback er der **ingen platform-specifikke krav** for quiz-hosten. Alt kører i browseren.

### Platformmatrix

| Komponent | Mac | Windows | Linux | iOS | Android | tvOS |
|-----------|-----|---------|-------|-----|---------|------|
| Host UI (browser) | ✅ | ✅ | ✅ | ⚠️* | ⚠️* | ✅ (WKWebView) |
| Player PWA | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| Apple Music playback | ✅ MusicKit JS | ✅ MusicKit JS | ✅ MusicKit JS | ✅ MusicKit JS | ✅ MusicKit JS | ✅ Native MusicKit |
| Spotify playback | ✅ Web SDK | ✅ Web SDK | ✅ Web SDK | ❌** | ❌** | ❌** |
| Preview fallback | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

\* Host UI på mobil er muligt men ikke optimalt (lille skærm). Anbefal at caste/mirre til TV.
\** Spotify Web Playback SDK understøtter ikke mobile browsers. På mobil kan Spotify Connect bruges i stedet (åbner Spotify-appen).

### Windows-specifik test

Tilføj til Definition of Done:

```
- [ ] Host UI fungerer i Chrome på Windows 10/11
- [ ] MusicKit JS auth flow fungerer i Chrome/Edge på Windows
- [ ] Spotify Web Playback fungerer i Chrome/Edge på Windows
- [ ] Player PWA fungerer på Android Chrome
```

### Home Controller position

Home Controller flyttes fra `QUIZ-PLAN.md` kernedokumentation til en separat sektion:

```
## Appendix A: Home Controller (Legacy / Claude-integration)

Home Controller er stadig relevant for:
- Claude-orkestreret afspilning via MCP tools (play, pause, next_track)
- AirPlay-kontrol fra Claude på iPhone
- Ikke-quiz use cases

Home Controller er IKKE nødvendig for quiz-funktionaliteten.
```

---

## P4: Kommerciel strategi

### Produktnavn

**"Music Quiz"** som arbejdstitel. Til kommerciel launch overvej:
- **QuizJam** — musik + fest-vibes
- **SoundClash** — konkurrence-fokus
- **PartyQ** — party quiz
- **TuneTrivia** — genre-klassiker

Domæne og branding vælges senere. Midlertidigt: `music.quiz-mash.com/quiz`.

### Markedspositionering

**Niche:** Social musik- og film-quiz med ægte streaming-afspilning.

**Konkurrentoversigt:**

| Produkt | Musik-afspilning | Multiplayer party | Film quiz | Multi-provider | Pris |
|---------|-----------------|-------------------|-----------|---------------|------|
| **Vores** | ✅ Fuld streaming | ✅ Storskærm + telefoner | ✅ TMDB | ✅ Apple + Spotify | Freemium |
| SongPop | ✅ Clips (100K+) | ❌ 1v1 async | ❌ | ❌ Egen licens | Freemium + ads |
| Kahoot | ❌ Ingen musik | ✅ Party format | ❌ | — | $3-79/md |
| SongQuiz.io | ⚠️ Preview clips | ✅ Multiplayer rooms | ❌ | ❌ | Gratis + ads |
| Heardle | ⚠️ Korte clips | ❌ Solo | ❌ | ❌ | Gratis |
| Weekend (TV) | ⚠️ Begrænset | ✅ Smart TV | ❌ | ❌ | Free trial + sub |

**Vores unikke position:** Det eneste produkt der kombinerer ægte streaming-afspilning (via brugerens eget abonnement) med Kahoot-style multiplayer party-format og film/serie-quiz. Brugeren bringer sin egen musik — vi bringer spillet.

### Prismodel

#### Tier 1: Free

- 1 quiz-session per dag
- Max 4 spillere
- Kun "popular charts" som kilde
- Preview-clips (30s) — ingen streaming-login
- Musik-quiz only (ingen film)
- Branding: "Powered by [ProductName]" vandmærke på host-skærm

#### Tier 2: Party ($4.99/md eller $39.99/år)

- Ubegrænsede sessions
- Max 8 spillere
- Alle kilder (library, history, artist, playlists, Apple TV+)
- Fuld streaming via Apple Music eller Spotify
- Musik + film quiz
- Ingen vandmærke
- Custom quiz-opsætning (årti, genre, sværhedsgrad)
- Quiz-historik og statistik

#### Tier 3: Host Pro ($9.99/md eller $79.99/år)

- Alt i Party
- Max 20 spillere
- Custom branding (logo, farver)
- Spotify + Apple Music (begge providers)
- tvOS app adgang
- Eksportér resultater (CSV)
- Prioriteret support
- API-adgang til quiz-generering

#### Tier 4: Event ($29.99 engangs)

- 48-timers adgang til alle Host Pro features
- Max 50 spillere
- Designet til: firmafester, bryllupper, fødselsdag, teambuilding
- Inkluderer print-ready QR-kode plakat (PDF)
- Ingen abonnement nødvendigt

### Revenue-estimat (konservativt)

**År 1 mål:** 1.000 betalende brugere

| Tier | Brugere | MRR | ARR |
|------|---------|-----|-----|
| Party ($4.99) | 600 | $2,994 | $35,928 |
| Host Pro ($9.99) | 200 | $1,998 | $23,976 |
| Event ($29.99) | 200/år | — | $5,998 |
| **Total** | | | **~$66K** |

Med 5.000 betalende brugere (år 2-3): ~$330K ARR.

### Teknisk implementation af tiers

**Ny fil: `src/quiz/billing/types.ts`**

```typescript
export type PlanTier = 'free' | 'party' | 'host-pro' | 'event';

export interface PlanLimits {
  maxPlayers: number;
  maxSessionsPerDay: number;      // -1 = unlimited
  allowedSources: QuizSource[];
  allowedProviders: ('apple-music' | 'spotify' | 'preview')[];
  allowedDomains: ('music' | 'movie')[];
  fullStreaming: boolean;
  customBranding: boolean;
  exportResults: boolean;
  showWatermark: boolean;
}

export const PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
  free: {
    maxPlayers: 4,
    maxSessionsPerDay: 1,
    allowedSources: ['charts'],
    allowedProviders: ['preview'],
    allowedDomains: ['music'],
    fullStreaming: false,
    customBranding: false,
    exportResults: false,
    showWatermark: true
  },
  party: {
    maxPlayers: 8,
    maxSessionsPerDay: -1,
    allowedSources: ['charts', 'recently-played', 'heavy-rotation', 'library', 'artist'],
    allowedProviders: ['apple-music', 'spotify', 'preview'],
    allowedDomains: ['music', 'movie'],
    fullStreaming: true,
    customBranding: false,
    exportResults: false,
    showWatermark: false
  },
  'host-pro': {
    maxPlayers: 20,
    maxSessionsPerDay: -1,
    allowedSources: ['charts', 'recently-played', 'heavy-rotation', 'library', 'artist'],
    allowedProviders: ['apple-music', 'spotify', 'preview'],
    allowedDomains: ['music', 'movie'],
    fullStreaming: true,
    customBranding: true,
    exportResults: true,
    showWatermark: false
  },
  event: {
    maxPlayers: 50,
    maxSessionsPerDay: -1,
    allowedSources: ['charts', 'recently-played', 'heavy-rotation', 'library', 'artist'],
    allowedProviders: ['apple-music', 'spotify', 'preview'],
    allowedDomains: ['music', 'movie'],
    fullStreaming: true,
    customBranding: true,
    exportResults: true,
    showWatermark: false
  }
};
```

### Betalingsplatform

**Anbefaling:** Stripe (undgå App Store 30% cut for web-betalinger)

- Web-signup via Stripe Checkout
- Stripe Customer Portal til plan-management
- Webhooks til at opdatere brugerens plan i database
- For tvOS app: brug App Store IAP (Apple kræver det for in-app køb), men tilbyd web-signup som alternativ

**Ny infrastruktur nødvendig:**

- Bruger-database (SQLite/Drizzle på Fly.io persistent volume, eller Supabase)
- Auth (magic link via email, ligesom cronjobs-servicen)
- Stripe integration

### Licensmæssige krav

#### Apple MusicKit

Apples vilkår tillader musik-afspilning i apps/websites, men forbyder direkte monetarisering af Apple Music-adgang. Vores model er compliant fordi:

- Gratis tier har ingen streaming (kun previews)
- Betaling er for quiz-features (multiplayer, sources, analytics)
- Brugeren bringer sit eget Apple Music-abonnement
- Samme model som SongPop, Shazam og andre godkendte apps

#### Spotify

Spotify Developer Terms tillader lignende. Krav:

- Vis Spotify-attribution og logo når Spotify er aktiv provider
- Respektér rate limits
- Brugeren skal have Spotify Premium for Web Playback SDK
- Registrér app via Spotify Developer Dashboard

#### TMDB

- Gratis for ikke-kommerciel brug
- Kommerciel brug: kontakt licensing@themoviedb.org
- Attribution påkrævet uanset: logo + tekst

### Go-to-market

**Fase 1: Soft launch (uge 1-4)**
- Deploy på music.quiz-mash.com/quiz
- Gratis tier only
- Test med familie og venner
- Iterer på UX baseret på feedback

**Fase 2: Beta (uge 5-12)**
- Tilføj Party tier via Stripe
- Lancér på Product Hunt og Hacker News
- Reddit: r/gamenight, r/boardgames, r/AppleMusic, r/spotify
- Twitter/X: demo-video med familieaften

**Fase 3: Public launch (uge 13+)**
- Alle tiers
- tvOS app på App Store
- Pressemateriale og landing page
- Overvej: eget domæne (quizjam.com e.l.)

---

## Opdateret implementeringsrækkefølge

### QUIZ-PLAN.md fase 1 (uændret scope, ny playback)

| Session | Scope | Ændring |
|---------|-------|---------|
| 1 | types + engine + ws-handler + routes | Tilføj PlaybackProvider interface |
| 2 | host UI med alle 6 screens | Tilføj provider-valg i setup, MusicKit JS loader |
| 3 | player PWA med alle 5 screens | Uændret |
| 4 | PWA assets + test + deploy | Tilføj musickit-token endpoint |
| 5 | Polish + MusicKit JS + preview fallback | Erstat Home Controller-afhængighed |

### Spotify-provider (ny)

| Session | Scope |
|---------|-------|
| 6 | spotify-web.ts + OAuth flow + song-resolver + provider-factory |

### MOVIE-QUIZ.md (uændret scope)

| Session | Scope |
|---------|-------|
| 7 | TMDB Service + movie-engine + movie_quiz tool |
| 8 | Host UI film-mode + domain switch |
| 9 | Soundtrack via MusicKit JS + YouTube trailer lyd |

### Kommercialisering (ny)

| Session | Scope |
|---------|-------|
| 10 | Bruger-auth (magic link) + SQLite user database |
| 11 | Stripe integration + plan enforcement |
| 12 | Landing page + branding + eget domæne |

### QUIZ-PLAN.md fase 2 — tvOS (uændret)

| Session | Scope |
|---------|-------|
| 13 | Xcode project + SwiftUI + WKWebView + MusicKit |
| 14 | JS ↔ Swift bridge + provider detect |
| 15 | TestFlight + App Store submission |

---

## Ny filstruktur (komplet)

```
src/
  quiz/
    playback/
      types.ts                # PlaybackProvider interface + SearchResult
      musickit-web.ts         # Apple Music via MusicKit JS (browser)
      spotify-web.ts          # Spotify via Web Playback SDK
      home-controller.ts      # Legacy: AppleScript via WebSocket
      preview.ts              # Fallback: 30s preview clips (<audio>)
      song-resolver.ts        # Provider-agnostisk song ID lookup
      provider-factory.ts     # Factory: instansiér provider fra config
    billing/
      types.ts                # PlanTier, PlanLimits
      stripe.ts               # Stripe Checkout + Webhooks
      auth.ts                 # Magic link auth (email)
      middleware.ts           # Express middleware: check plan limits
    tmdb-service.ts           # TMDB API client
    movie-engine.ts           # Film-quiz generator
    movie-quiz-tool.ts        # MCP tool: movie_quiz
    engine.ts                 # Game engine (sessions, scoring)
    ws-handler.ts             # WebSocket handler
    routes.ts                 # Express routes
    types.ts                  # Shared TypeScript interfaces
    data/
      movie-quotes.json       # Curated film-citater
      tmdb-genres.json        # Genre mapping cache
    public/
      host.html               # Host UI (storskærm)
      host.css
      host.js
      play.html               # Player PWA (telefon)
      play.css
      play.js
      manifest.json           # PWA manifest
      sw.js                   # Service worker
      spotify-callback.html   # Spotify OAuth redirect handler
      icon-192.png
      icon-512.png
```

---

## Miljøvariabler (opdateret)

Tilføj til `.env` og Fly.io secrets:

```env
# Eksisterende
APPLE_TEAM_ID=7NAG4UJCT9
APPLE_KEY_ID=9956HH4GCY
APPLE_PRIVATE_KEY="..."
SERVER_URL=https://music.quiz-mash.com
JWT_SECRET=...
HOME_API_KEY=...

# Nye — Spotify
SPOTIFY_CLIENT_ID=...              # Fra developer.spotify.com
SPOTIFY_REDIRECT_URI=https://music.quiz-mash.com/quiz/spotify-callback

# Nye — TMDB
TMDB_API_KEY=...                   # Fra themoviedb.org

# Nye — Stripe (kommerciel fase)
STRIPE_SECRET_KEY=...
STRIPE_PUBLISHABLE_KEY=...
STRIPE_WEBHOOK_SECRET=...

# Nye — Auth
AUTH_EMAIL_FROM=quiz@music.quiz-mash.com  # Eller via Resend
```

---

*Patch version 1.0 — Christian Broberg / WebHouse ApS*
*Genereret: 2. april 2026*
