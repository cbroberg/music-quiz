Foreslået feature-opdeling

  ┌───────────────────────────┬───────────────┬───────────┬──────────────────────────────────────────────────────────┐
  │          Feature          │      Fra      │ Prioritet │                       Beskrivelse                        │
  ├───────────────────────────┼───────────────┼───────────┼──────────────────────────────────────────────────────────┤
  │ F17: MusicKit JS Playback │ P1            │ 🔴 Høj    │ Browser-baseret Apple Music afspilning, erstatter Home   │
  │                           │               │           │ Controller som primær                                    │
  ├───────────────────────────┼───────────────┼───────────┼──────────────────────────────────────────────────────────┤
  │ F18: Playback Provider    │ P1+P2         │ 🔴 Høj    │ PlaybackProvider interface — foundation for              │
  │ Abstraction               │               │           │ multi-provider                                           │
  ├───────────────────────────┼───────────────┼───────────┼──────────────────────────────────────────────────────────┤
  │ F19: Party Session        │ Netop done    │ ✅ Done   │ Event → Rounds, immutable playlist, picks akkumulerer    │
  ├───────────────────────────┼───────────────┼───────────┼──────────────────────────────────────────────────────────┤
  │ F20: Spotify Support      │ P2            │ 🟡 Medium │ Web Playback SDK + OAuth PKCE + song resolver            │
  ├───────────────────────────┼───────────────┼───────────┼──────────────────────────────────────────────────────────┤
  │ F21: Movie/TV Quiz        │ MOVIE-QUIZ.md │ 🟡 Medium │ TMDB, film-citater, soundtrack-afspilning                │
  ├───────────────────────────┼───────────────┼───────────┼──────────────────────────────────────────────────────────┤
  │ F22: User Auth            │ P4            │ 🟡 Medium │ Magic link email, bruger-database                        │
  ├───────────────────────────┼───────────────┼───────────┼──────────────────────────────────────────────────────────┤
  │ F23: Billing (Stripe)     │ P4            │ 🟠 Lav    │ Tiers, Stripe Checkout, plan enforcement                 │
  ├───────────────────────────┼───────────────┼───────────┼──────────────────────────────────────────────────────────┤
  │ F24: Landing Page         │ P4            │ 🟠 Lav    │ Branding, eget domæne, go-to-market                      │
  └───────────────────────────┴───────────────┴───────────┴──────────────────────────────────────────────────────────┘
  