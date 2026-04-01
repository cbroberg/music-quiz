# Music Quiz — Project Instructions

## DJ Mode Song Playback

**Brug `play-exact` med eksakt sangnavn + artist til afspilning i DJ Mode.**

### Afspilningskæde (prioriteret):
1. `addToLibrary(songId)` via Apple Music API → tilføjer sangen til brugerens bibliotek
2. `play-exact({ name, artist, retries: 3 })` → osascript med `whose name is "X" and artist contains "Y"` (eksakt match, op til 3 retries med 1s delay for iCloud sync)
3. Fallback: `play-exact` med forenklet navn (uden parenteser/remaster-tags)
4. Last resort: `search-and-play` med artist-filter (fuzzy, kan matche forkert)

### Hvad der IKKE virker på macOS:
- **`play-ids` via URL scheme** (`music://music.apple.com/dk/song/{id}`) — navigerer Music.app men starter ikke afspilning af den rigtige sang. Afprøvet april 2026, upålidelig.
- **MusicKit `SystemMusicPlayer`** — markeret `@available(macOS, unavailable)` af Apple. Virker kun på iOS/tvOS.
- **Fuzzy `search playlist "Library" for "X"`** — matcher på tværs af alle felter, giver forkerte resultater (f.eks. "Everywhere" → "Riddles, Riddles Everywhere").

### Vigtig begrænsning:
`play-exact` kræver at sangen er i biblioteket. Derfor kalder vi altid `addToLibrary` først. iCloud sync kan tage 1-3 sekunder, håndteret via retries.
