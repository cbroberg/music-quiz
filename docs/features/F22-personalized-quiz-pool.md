# F22 — Personalized Quiz Pool from Participant Profiles

## Concept

Invited participants can connect their Apple Music (or Spotify) account to a persistent user profile. When they join a quiz as a "known" user, 10-20% of questions are drawn from a pool of their own library/favorites — creating moments of recognition and personalization.

## User flow

1. Host creates an Event and invites participants via email
2. Email contains unique invite link → opens a profile setup page
3. Participant creates account (name, avatar) and optionally connects Apple Music / Spotify
4. When they join the event's quiz via their profile, the quiz engine pulls a percentage of songs from their library
5. Other participants see: "🎧 Christian's pick: Kashmir - Rocket Brothers" (creates recognition moments)

## Technical feasibility (Apple Music)

All endpoints already available via MusicUserToken (MusicKit JS auth flow we already use):

| Endpoint | Use |
|---|---|
| `/me/library/playlists` | User's saved playlists |
| `/me/library/songs` | Full library (paginated) |
| `/me/library/albums` | Saved albums |
| `/me/library/artists` | Followed artists |
| `/me/ratings/songs` | ❤️ favorites |
| `/me/recent/played` | Recently played (last ~50) |
| `/me/history/heavy-rotation` | Most played lately |
| `/me/recommendations` | Apple's personalized recs |

## Data model additions

```typescript
interface UserProfile {
  id: string;
  email: string;
  name: string;
  avatar: string;
  musicService?: "apple-music" | "spotify" | null;
  musicUserTokenRef?: string;  // encrypted, server-side
  lastSyncAt?: string;
  librarySnapshot?: {
    topArtists: string[];       // top 50 unique artists from library
    recentFavorites: string[];  // song IDs from last 30 days
    ratedSongs: string[];       // explicit ❤️ song IDs
    playlists: Array<{ id: string; name: string; trackIds: string[] }>;
  };
}

interface EventInvite {
  eventId: string;
  email: string;
  inviteToken: string;
  profileId?: string;  // set after signup
  rsvp: "pending" | "accepted" | "declined";
}
```

## Quiz engine integration

```typescript
// engine.ts — in createSession
if (party?.participants.some(p => p.profileId)) {
  const profiles = await loadProfiles(party.participants);
  const personalPool = mergePersonalLibraries(profiles);  // dedupe, mix
  const personalPercent = 0.15;  // 15% personal, 85% curated
  const personalCount = Math.floor(config.questionCount * personalPercent);
  // Inject personal questions into pool
}
```

**Personal question format:**
- Question: "Who added this song to their library?" (guess-the-owner — new type)
- Question: "This is [Christian]'s favorite — what's the song?"
- Question: "Name this song from [Nina]'s library"

## Privacy & consent

- **Opt-in only** — user must explicitly authorize via MusicKit flow
- **Encrypted storage** — MusicUserToken stored encrypted server-side
- **Revocable** — user can disconnect anytime, library snapshot deleted
- **Transparent** — each personal question shows the source ("from Christian's library")
- **No data sharing** — library data never leaves the quiz context
- **GDPR compliant** — delete all data on request

## Multi-service support

Same feature works for Spotify users via Spotify Web API:
- `/me/tracks` (saved songs)
- `/me/playlists`
- `/me/top/tracks` (top played)
- `/me/following/artists`

Future: Mix an Apple Music user's library with a Spotify user's in the same quiz.

## UX details

**Pre-quiz (in profile setup):**
- "Connect Apple Music to supercharge your quiz experience!"
- "🎵 Your favorites will be mixed into the questions"
- Toggle to adjust personalization amount

**During quiz:**
- Personal questions have a special visual indicator (avatar of the owner)
- After answer: "This was [Christian]'s favorite from Kashmir!"

**After quiz:**
- "Did you know Nina has 8 Beyoncé songs in her library? Try 'Beyoncé Round' next time!"

## Implementation phases

**Phase 1** — Profile system
- User signup, email invites, profile storage
- No music connection yet

**Phase 2** — Apple Music connect
- MusicKit JS auth flow on profile page
- Library snapshot on first connect
- Sync refresh on each quiz join

**Phase 3** — Quiz integration
- New question type: `guess-the-owner`
- Pool merging with personal percentage
- Visual indicators

**Phase 4** — Spotify
- Spotify auth flow
- Unified pool merging (Apple Music + Spotify)

## Prerequisites

- User accounts / profiles (currently only `playerName` stored per session)
- Persistent profile storage (database or enhanced file system)
- Email delivery (we have AWS SES via fysiodk-aalborg-sport's `scripts/send-mail.sh`)
- Session security (profile → quiz binding)
- GDPR consent UI

## Risks

- **Token expiry** — MusicUserToken expires, need refresh flow
- **Library size** — user with 10k songs → limit snapshot to relevant subset
- **Privacy perception** — clear messaging that we only read, never write
- **Apple review** — if app goes to App Store, data use must be disclosed
