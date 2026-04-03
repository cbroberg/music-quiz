# F24: Genre Roulette — Progressiv afsløring

**Status:** Idea

## Summary

Én sang afspilles, men spillerne svarer i fire progressive lag: genre → årti → artist → sangtitel. Hvert lag giver points, og svaret afsløres for alle efter hver runde. Tester musikviden fra bredt til specifikt.

## How It Works

1. **Lag 1 — Genre** (efter 5 sek afspilning)
   - "Hvilken genre er dette?" — 4 muligheder (rock, pop, jazz, hip-hop osv.)
   - 250 points for korrekt
   - Korrekt genre afsløres for alle

2. **Lag 2 — Årti** (efter 10 sek afspilning)
   - "Hvilket årti?" — 4 muligheder (70s, 80s, 90s, 2000s)
   - 250 points for korrekt
   - Korrekt årti afsløres

3. **Lag 3 — Artist** (efter 15 sek afspilning)
   - "Hvem er kunstneren?" — 4 muligheder
   - 250 points for korrekt
   - Korrekt artist afsløres

4. **Lag 4 — Sang** (efter 20 sek afspilning)
   - "Hvad hedder sangen?" — 4 muligheder
   - 250 points for korrekt
   - Fuld reveal med artwork

## Scoring

- Max 1000 points per sang (250 per lag)
- Hvert lag er uafhængigt — du kan gætte genre forkert men artist rigtigt
- Tid-bonus inden for hvert lag: hurtigere svar = lidt flere points (250 max, 150 minimum)
- "Perfect" bonus: +200 hvis alle 4 lag er korrekte

## Timing

```
0s ————— 5s ————— 10s ————— 15s ————— 20s ————— 25s
|  musik  | genre   | årti    | artist  | sang    | reveal
|  spiller| svar    | svar    | svar    | svar    |
```

Musikken spiller kontinuerligt — spillerne svarer i overlay mens de lytter.

## Player PWA Changes

- 4-trins progression indicator i toppen (●○○○ → ●●○○ → ●●●○ → ●●●●)
- Svarknapper skifter indhold per lag
- Kort animation mellem lag ("Næste: Årti!")

## Host UI Changes

- 4-delt progress bar i toppen
- Hvert lag har en farve (genre=lilla, årti=blå, artist=grøn, sang=gul)
- Mini-reveal efter hvert lag (genre-badge vises, årstal vises osv.)
- Fuld reveal med artwork + alle 4 svar efter lag 4

## Data Requirements

- Genre mapping for alle sange (fra artists.json eller Apple Music API genres)
- Årti fra release_date
- Distraktorer: andre genrer, nærliggende årtier, artists fra samme genre, sange fra samme artist

## Dependencies

- Udvidet WebSocket protocol: 4 svar-events per spørgsmål i stedet for 1
- Game engine: ny state `multi_layer` med sub-states per lag
