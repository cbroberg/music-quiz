/**
 * Music Quiz Generator
 *
 * Generates quiz questions from Apple Music data.
 * Claude orchestrates the flow — plays songs, asks questions, checks answers.
 */

import { AppleMusicClient } from "./apple-music.js";

export type QuizType =
  | "guess-the-artist"
  | "guess-the-song"
  | "guess-the-album"
  | "guess-the-year"
  | "intro-quiz"
  | "lyrics-or-title"
  | "mixed";

export type QuizSource =
  | "recently-played"
  | "heavy-rotation"
  | "library"
  | "charts"
  | "catalog-artist"
  | "mixed"
  | "live"
  | "dansk";

export interface QuizQuestion {
  questionNumber: number;
  type: QuizType;
  songId: string;
  songName: string;
  artistName: string;
  albumName: string;
  releaseYear: string;
  artworkUrl?: string;
  question: string;
  answer: string;
  hints: string[];
  difficulty: "easy" | "medium" | "hard";
}

export interface Quiz {
  title: string;
  description: string;
  type: QuizType;
  source: QuizSource;
  questionCount: number;
  questions: QuizQuestion[];
}

// ─── Shuffle helper ────────────────────────────────────────

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pick<T>(arr: T[], n: number): T[] {
  return shuffle(arr).slice(0, n);
}

// ─── Song data extraction ──────────────────────────────────

interface SongData {
  id: string;
  name: string;
  artistName: string;
  albumName: string;
  releaseDate: string;
  artworkUrl: string;
}

function extractSongs(data: unknown): SongData[] {
  const songs: SongData[] = [];

  function walk(obj: unknown) {
    if (!obj || typeof obj !== "object") return;
    if (Array.isArray(obj)) {
      obj.forEach(walk);
      return;
    }
    const o = obj as Record<string, unknown>;
    // Check if this looks like a song/track resource
    if (o.attributes && typeof o.attributes === "object") {
      const attrs = o.attributes as Record<string, unknown>;
      if (attrs.name && attrs.artistName) {
        // Extract artwork URL and substitute {w}x{h} with actual size
        let artworkUrl = "";
        const artwork = attrs.artwork as { url?: string } | undefined;
        if (artwork?.url) {
          artworkUrl = artwork.url.replace("{w}", "300").replace("{h}", "300");
        }
        songs.push({
          id: String(o.id || ""),
          name: String(attrs.name || ""),
          artistName: String(attrs.artistName || ""),
          albumName: String(attrs.albumName || ""),
          releaseDate: String(attrs.releaseDate || ""),
          artworkUrl,
        });
      }
    }
    // Recurse into nested structures
    if (o.data) walk(o.data);
    if (o.relationships) walk(o.relationships);
    if (o.results) walk(o.results);
    // Charts: { results: { songs: [{ data: [...] }] } }
    if (o.songs) walk(o.songs);
    if (o.albums) walk(o.albums);
  }

  walk(data);

  // Deduplicate by name + artist
  const seen = new Set<string>();
  return songs.filter((s) => {
    const key = `${s.name.toLowerCase()}|${s.artistName.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── Question generators ───────────────────────────────────

function makeGuessArtist(song: SongData, idx: number): QuizQuestion {
  return {
    questionNumber: idx,
    type: "guess-the-artist",
    songId: song.id,
    songName: song.name,
    artistName: song.artistName,
    albumName: song.albumName,
    releaseYear: song.releaseDate?.substring(0, 4) || "unknown",
    artworkUrl: song.artworkUrl,
    question: `Which artist performs this song?`,
    answer: song.artistName,
    hints: [
      `The song is called "${song.name}"`,
      `It's from the album "${song.albumName}"`,
      `Released in ${song.releaseDate?.substring(0, 4) || "unknown"}`,
    ],
    difficulty: "medium",
  };
}

function makeGuessSong(song: SongData, idx: number): QuizQuestion {
  return {
    questionNumber: idx,
    type: "guess-the-song",
    songId: song.id,
    songName: song.name,
    artistName: song.artistName,
    albumName: song.albumName,
    releaseYear: song.releaseDate?.substring(0, 4) || "unknown",
    artworkUrl: song.artworkUrl,
    question: `What is the name of this song?`,
    answer: song.name,
    hints: [
      `The artist is ${song.artistName}`,
      `It's from the album "${song.albumName}"`,
      `Released in ${song.releaseDate?.substring(0, 4) || "unknown"}`,
    ],
    difficulty: "medium",
  };
}

function makeGuessAlbum(song: SongData, idx: number): QuizQuestion {
  return {
    questionNumber: idx,
    type: "guess-the-album",
    songId: song.id,
    songName: song.name,
    artistName: song.artistName,
    albumName: song.albumName,
    releaseYear: song.releaseDate?.substring(0, 4) || "unknown",
    artworkUrl: song.artworkUrl,
    question: `Which album is this song from?`,
    answer: song.albumName,
    hints: [
      `The song is "${song.name}" by ${song.artistName}`,
      `Released in ${song.releaseDate?.substring(0, 4) || "unknown"}`,
    ],
    difficulty: "hard",
  };
}

function makeGuessYear(song: SongData, idx: number): QuizQuestion {
  const year = song.releaseDate?.substring(0, 4) || "unknown";
  return {
    questionNumber: idx,
    type: "guess-the-year",
    songId: song.id,
    songName: song.name,
    artistName: song.artistName,
    albumName: song.albumName,
    releaseYear: year,
    artworkUrl: song.artworkUrl,
    question: `In which year was this song released? (within 2 years counts as correct)`,
    answer: year,
    hints: [
      `The song is "${song.name}" by ${song.artistName}`,
      `It's from the album "${song.albumName}"`,
    ],
    difficulty: "hard",
  };
}

function makeIntroQuiz(song: SongData, idx: number): QuizQuestion {
  return {
    questionNumber: idx,
    type: "intro-quiz",
    songId: song.id,
    songName: song.name,
    artistName: song.artistName,
    albumName: song.albumName,
    releaseYear: song.releaseDate?.substring(0, 4) || "unknown",
    artworkUrl: song.artworkUrl,
    question: `Listen to the intro — name the song AND the artist!`,
    answer: `${song.name} by ${song.artistName}`,
    hints: [
      `The album is "${song.albumName}"`,
      `Released in ${song.releaseDate?.substring(0, 4) || "unknown"}`,
    ],
    difficulty: "easy",
  };
}

const GENERATORS: Record<string, (s: SongData, i: number) => QuizQuestion> = {
  "guess-the-artist": makeGuessArtist,
  "guess-the-song": makeGuessSong,
  "guess-the-album": makeGuessAlbum,
  "guess-the-year": makeGuessYear,
  "intro-quiz": makeIntroQuiz,
};

// ─── Quiz generator ────────────────────────────────────────

export async function generateQuiz(
  client: AppleMusicClient,
  options: {
    type?: QuizType;
    source?: QuizSource;
    count?: number;
    genre?: string;
    artist?: string;
    decade?: string;
    excludeSongIds?: Set<string>;
  } = {},
): Promise<Quiz> {
  const type = options.type || "mixed";
  const source = options.source || "recently-played";
  const count = options.count || 10;

  // Fetch songs based on source
  let rawData: unknown;
  let title: string;
  let description: string;

  switch (source) {
    case "recently-played": {
      rawData = await client.getRecentlyPlayedTracks(50);
      title = "Your Music Quiz";
      description = "Based on your recently played tracks";
      break;
    }
    case "heavy-rotation": {
      // Heavy rotation returns albums/playlists — fetch their tracks
      const hrData = await client.getHeavyRotation(10) as { data?: Array<{ id: string; type: string }> };
      const allTracks: unknown[] = [];
      for (const item of hrData.data || []) {
        try {
          if (item.type === "albums") {
            const tracks = await client.getAlbumTracks(item.id);
            allTracks.push(...tracks.map(t => ({ id: t.id, type: "songs", attributes: t.attributes })));
          }
        } catch {}
      }
      rawData = { data: allTracks };
      title = "Heavy Rotation Quiz";
      description = "Based on your most played music";
      break;
    }
    case "charts": {
      rawData = await client.getCharts(["songs"], options.genre, 50);
      title = "Charts Quiz";
      description = `Top songs${options.genre ? ` in genre ${options.genre}` : ""}`;
      break;
    }
    case "catalog-artist": {
      if (!options.artist) throw new Error("artist ID required for catalog-artist source");
      const songs = await client.getArtistAllSongs(options.artist);
      rawData = { data: songs };
      const artistName = songs[0]?.attributes?.artistName || "Unknown";
      title = `${artistName} Quiz`;
      description = `How well do you know ${artistName}?`;
      break;
    }
    case "library": {
      rawData = await client.searchLibrary(
        options.decade || options.genre || "a",
        ["library-songs"],
        25,
      );
      title = "Library Quiz";
      description = "From your personal music library";
      break;
    }
    case "mixed": {
      // ─── ARTIST POOL APPROACH ──────────────────────────────
      // 1. Load 1158-artist bruttoliste from data/artist-pool.json
      // 2. Shuffle + pick N artists (5x question count)
      // 3. Search Apple Music for one song per artist
      // 4. Guaranteed unique artists — no dedup needed

      const mixedSongs: SongData[] = [];

      // Load artist pool
      let artistPool: Array<{ name: string; country: string; genres: string[]; decade: string }> = [];
      try {
        const { readFileSync } = await import("node:fs");
        const { join } = await import("node:path");
        const poolPath = join(process.cwd(), "data", "artist-pool.json");
        artistPool = JSON.parse(readFileSync(poolPath, "utf-8"));
      } catch (err) {
        console.error("🎵 Failed to load artist-pool.json:", err);
      }

      // Pick N random artists (5x questions for plenty of headroom after verify)
      const targetArtists = Math.min(artistPool.length, count * 5);
      const selectedArtists = shuffle(artistPool).slice(0, targetArtists);

      console.log(`🎵 Artist pool: ${artistPool.length} total, picked ${selectedArtists.length} for ${count} questions`);

      // Search for one song per artist (parallel, batched to avoid rate limits)
      const BATCH_SIZE = 20;
      for (let i = 0; i < selectedArtists.length; i += BATCH_SIZE) {
        const batch = selectedArtists.slice(i, i + BATCH_SIZE);
        const results = await Promise.allSettled(
          batch.map(a => client.searchCatalog(a.name, ["songs"], 3).then(extractSongs))
        );
        for (let j = 0; j < results.length; j++) {
          const result = results[j];
          if (result.status === "fulfilled" && result.value.length > 0) {
            // Pick first song that matches the artist name (avoid covers)
            const artistName = batch[j].name.toLowerCase();
            const match = result.value.find(s =>
              s.artistName.toLowerCase().includes(artistName) ||
              artistName.includes(s.artistName.toLowerCase())
            ) || result.value[0];
            mixedSongs.push(match);
          }
        }
      }

      console.log(`🎵 Found songs for ${mixedSongs.length}/${selectedArtists.length} artists`);

      // Artists are already unique from pool — just dedup songs (covers etc.)
      const poolSeen = new Set<string>();
      const dedupedPool = mixedSongs.filter(s => {
        const key = s.artistName.toLowerCase();
        if (poolSeen.has(key)) return false;
        poolSeen.add(key);
        return true;
      });

      console.log(`🎵 Artist pool: ${dedupedPool.length} unique artists with songs`);

      rawData = { data: dedupedPool.map(s => ({ id: s.id, type: "songs", attributes: { name: s.name, artistName: s.artistName, albumName: s.albumName, releaseDate: s.releaseDate } })) };
      title = "Mixed Quiz";
      description = "Songs from all sources";
      break;
    }
    case "live": {
      // Live performances and concert recordings
      const liveSearches = ["live concert", "live at", "live recording", "unplugged"];
      const searchTerm = liveSearches[Math.floor(Math.random() * liveSearches.length)];
      rawData = await client.searchCatalog(searchTerm, ["songs"], 25);
      title = "Live Music Quiz";
      description = "Live performances and concerts";
      break;
    }
    case "dansk": {
      // ─── CACHED DANISH ARTIST SONGS ────────────────────────
      // Load pre-cached songs from data/artist-songs-dk.json (fast — no API calls)
      // Fallback to live search if cache doesn't exist
      const allTracks: unknown[] = [];
      const seenArtists = new Set<string>();
      try {
        const { readFileSync } = await import("node:fs");
        const { join } = await import("node:path");
        const cachePath = join(process.cwd(), "data", "artist-songs-dk.json");
        const cache = JSON.parse(readFileSync(cachePath, "utf-8")) as {
          artists: Record<string, Array<{ id: string; name: string; artistName: string; albumName: string; releaseYear: string; artworkUrl: string }>>;
          totalSongs: number;
          matchedArtists: number;
        };
        console.log(`🎵 Dansk: Loaded cache (${cache.totalSongs} songs from ${cache.matchedArtists} artists)`);

        // Convert cache to Apple Music format and shuffle artists
        const artistNames = shuffle(Object.keys(cache.artists));
        for (const artistName of artistNames) {
          const songs = cache.artists[artistName];
          for (const s of songs) {
            allTracks.push({
              id: s.id,
              type: "songs",
              attributes: {
                name: s.name,
                artistName: s.artistName,
                albumName: s.albumName,
                releaseDate: s.releaseYear ? `${s.releaseYear}-01-01` : "",
                artwork: s.artworkUrl ? { url: s.artworkUrl.replace("300", "{w}").replace("300", "{h}") } : undefined,
              },
            });
          }
          seenArtists.add(artistName);
          if (allTracks.length >= count * 5) break;
        }
        console.log(`🎵 Dansk: ${allTracks.length} songs from ${seenArtists.size} artists (from cache)`);
      } catch (err) {
        console.warn("🎵 Dansk cache miss, falling back to live search:", err);
        // Fallback: live search — artists-dk.json is a flat array
        type DkArtist = { name: string; country?: string; genres?: string[]; decade?: string };
        const { readFileSync } = await import("node:fs");
        const { join } = await import("node:path");
        const path = join(process.cwd(), "src", "quiz", "data", "artists-dk.json");
        const dkArtists: DkArtist[] = JSON.parse(readFileSync(path, "utf-8"));
        const shuffled = shuffle(dkArtists);
        const BATCH_SIZE = 10;
        for (let i = 0; i < shuffled.length && allTracks.length < count * 5; i += BATCH_SIZE) {
          const batch = shuffled.slice(i, i + BATCH_SIZE);
          const results = await Promise.allSettled(
            batch.map(async (artist) => {
              const limit = 5;
              const searchRes = await client.searchCatalog(artist.name, ["songs"], limit) as any;
              return { artist, songs: searchRes.results?.songs?.data || [] };
            })
          );
          for (const result of results) {
            if (result.status !== "fulfilled") continue;
            const { artist, songs } = result.value;
            const artistLower = artist.name.toLowerCase().replace(/['\u2019]/g, "");
            const matching = songs.filter((s: any) => {
              const sArtist = (s.attributes?.artistName || "").toLowerCase().replace(/['\u2019]/g, "");
              return sArtist.includes(artistLower) || artistLower.includes(sArtist);
            });
            for (const song of matching) {
              allTracks.push(song);
              seenArtists.add(artist.name);
            }
          }
        }
      }

      rawData = { data: allTracks };
      title = "Dansk Musik Quiz";
      description = `Fra ${seenArtists.size} danske kunstnere`;
      break;
    }
    default:
      throw new Error(`Unknown source: ${source}`);
  }

  let allSongs = extractSongs(rawData);

  // Filter out previously used songs
  if (options.excludeSongIds?.size) {
    const before = allSongs.length;
    allSongs = allSongs.filter((s) => !options.excludeSongIds!.has(s.id));
    if (allSongs.length < before) {
      console.log(`🎵 Excluded ${before - allSongs.length} already-used songs (${allSongs.length} remaining)`);
    }
  }

  // Fallback: if charts returned no songs, try catalog search with genre name
  if (allSongs.length === 0 && source === "charts" && options.genre) {
    const genreNames: Record<string, string> = {
      "20": "alternative", "2": "blues", "5": "classical", "17": "dance",
      "7": "electronic", "18": "hip hop", "11": "jazz", "12": "latin",
      "1153": "metal", "14": "pop", "15": "r&b soul", "24": "reggae",
      "21": "rock", "10": "singer songwriter", "16": "soundtrack", "19": "world",
    };
    const searchTerm = genreNames[options.genre] || "music";
    const searchData = await client.searchCatalog(searchTerm, ["songs"], 25);
    allSongs = extractSongs(searchData);
  }

  if (allSongs.length === 0) {
    throw new Error("No songs found for quiz generation. Try a different source.");
  }

  // Filter by decade if specified
  let songs = allSongs;
  if (options.decade) {
    const decadeStart = parseInt(options.decade);
    songs = allSongs.filter((s) => {
      const year = parseInt(s.releaseDate?.substring(0, 4) || "0");
      return year >= decadeStart && year < decadeStart + 10;
    });
    if (songs.length === 0) songs = allSongs; // fallback
    title += ` (${options.decade}s)`;
  }

  const selected = pick(songs, count);

  // Generate questions — for mixed: rotate types but fewer year questions (~10%)
  const generators = type === "mixed"
    ? [makeGuessArtist, makeGuessSong, makeGuessAlbum, makeIntroQuiz, makeGuessArtist, makeGuessSong, makeGuessAlbum, makeIntroQuiz, makeGuessSong, makeGuessYear]
    : [GENERATORS[type] || makeIntroQuiz];

  const questions: QuizQuestion[] = selected.map((song, i) => {
    const gen = generators[i % generators.length];
    return gen(song, i + 1);
  });

  return {
    title,
    description,
    type,
    source,
    questionCount: questions.length,
    questions,
  };
}
