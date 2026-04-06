/**
 * Multiplayer Quiz Game Engine
 *
 * Manages game sessions, players, scoring, and game state transitions.
 * Replaces the simple quiz-manager.ts with full multiplayer support.
 */

import { randomUUID } from "node:crypto";
import type {
  GameSession, GameState, Player, PlayerAnswer, QuizConfig,
  QuizQuestion, PendingAnswer, QuestionResult, FinalRanking,
  HostQuestionData, AnswerMode, Party, PartyState, CompletedRound,
} from "@music-quiz/shared";
import { generateQuiz, type QuizType as GenQuizType, type Quiz } from "./quiz.js";
import type { AppleMusicClient } from "./apple-music.js";
import { isHomeConnected } from "./home-ws.js";
import { isMuted } from "./mute.js";
import { logTrackChange } from "./browser-ws.js";
import { evaluateAnswers } from "./ai-evaluator.js";
import { awardCredits, resetDjMode } from "./dj-mode.js";
import { getProvider, getActiveProviderType } from "./playback/provider-manager.js";
import { generateTriviaQuestions, type GeneratedTrivia } from "./ai-enricher.js";
import { getRandomQuestions, saveQuestions } from "./question-bank.js";
import { getRandomGossipQuestions, getGossipBankSize } from "./gossip-bank.js";

import { writeFileSync, mkdirSync } from "node:fs";

// ─── Constants ────────────────────────────────────────────

const MAX_PLAYERS = 8;
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

// ─── Theme Songs (permanent in library, never deleted) ───

export const THEME_SONGS = {
  preparation: [
    { name: "Theme from New York, New York", artist: "Frank Sinatra", songId: "1440858721" },
    { name: "Every Breath You Take", artist: "The Police", songId: "1440857088" },
    { name: "Message In A Bottle", artist: "The Police", songId: "1440857079" },
  ],
  victory: { name: "We Are the Champions", artist: "Queen", songId: "1440822123" },
};

// ─── Quiz Log (expected vs actual playback) ──────────────

interface QuizLogEntry {
  q: number;
  expected: string;
  actual: string;
  match: boolean;
}
const quizLog: QuizLogEntry[] = [];

async function verifyPlaying(qNum: number, expectedSong: string, expectedArtist: string): Promise<void> {
  // Wait a beat for playback to settle
  await new Promise(r => setTimeout(r, 1500));
  try {
    const np = await getProvider().nowPlaying();
    const actual = np.track && np.artist ? `${np.track} — ${np.artist}` : np.state || "unknown";
    const match = (np.track || "").toLowerCase().includes(expectedSong.toLowerCase().slice(0, 10)) ||
                  (np.artist || "").toLowerCase().includes(expectedArtist.toLowerCase().slice(0, 10));
    quizLog.push({ q: qNum, expected: `${expectedSong} — ${expectedArtist}`, actual, match });
    if (!match) {
      console.error(`🎮 ⚠️ MISMATCH Q${qNum}: expected "${expectedSong}" but playing "${np.track}"`);
    } else {
      console.log(`🎮 ✓ Q${qNum} verified: ${actual}`);
    }
  } catch {
    quizLog.push({ q: qNum, expected: `${expectedSong} — ${expectedArtist}`, actual: "verify-failed", match: false });
  }
}

export function getQuizLog(): QuizLogEntry[] { return quizLog; }

export function saveQuizLog(): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const path = `recordings/quiz-log-${ts}.json`;
  try {
    mkdirSync("recordings", { recursive: true });
    writeFileSync(path, JSON.stringify(quizLog, null, 2));
    console.log(`🎮 Quiz log saved: ${path}`);
  } catch (err) {
    console.error("🎮 Failed to save quiz log:", err);
  }
  quizLog.length = 0;
  return path;
}
const JOIN_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1 confusion
const COUNTDOWN_MS = 3000;
const REVEAL_DURATION_MS = 6000;
const SCOREBOARD_DURATION_MS = 5000;

// ─── Party Store ─────────────────────────────────────────

const parties = new Map<string, Party>();
const partyJoinCodeIndex = new Map<string, string>(); // joinCode → partyId

// ─── Session Store ────────────────────────────────────────

const sessions = new Map<string, GameSession>();
const joinCodeIndex = new Map<string, string>(); // joinCode → sessionId (legacy, still used internally)

// Track used song IDs across all sessions to avoid repeats during an evening
const usedSongIds = new Set<string>();

// Track songs WE added to library (name + artist) so we can clean up without touching user's own music
const addedToLibrary = new Set<string>(); // "songName|||artistName"

export function trackAddedToLibrary(songName: string, artistName: string): void {
  addedToLibrary.add(`${songName}|||${artistName}`);
}

export function getAddedToLibrary(): Array<{ name: string; artist: string }> {
  return [...addedToLibrary].map(key => {
    const [name, artist] = key.split("|||");
    return { name, artist };
  });
}

export function clearAddedToLibrary(): void {
  addedToLibrary.clear();
}

export function clearUsedSongs(): void {
  usedSongIds.clear();
  console.log("🎮 Cleared used songs list");
}

// ─── Party Management ────────────────────────────────────

export function createParty(hostWsId: string, name?: string): Party {
  const joinCode = generateJoinCode();
  const partyId = randomUUID().slice(0, 12);

  const party: Party = {
    id: partyId,
    name: name || "Music Quiz",
    createdAt: new Date(),
    joinCode,
    players: new Map(),
    waitingPlayers: [],
    currentRound: 0,
    rounds: [],
    state: "playlist",
    activeSessionId: null,
    hostWsId,
  };

  parties.set(partyId, party);
  partyJoinCodeIndex.set(joinCode, partyId);
  console.log(`🎉 Party created: ${joinCode} (id: ${partyId})`);
  return party;
}

export function getParty(partyId: string): Party | undefined {
  return parties.get(partyId);
}

export function getPartyByCode(joinCode: string): Party | undefined {
  const partyId = partyJoinCodeIndex.get(joinCode.toUpperCase());
  return partyId ? parties.get(partyId) : undefined;
}

export function getPartyBySessionId(sessionId: string): Party | undefined {
  for (const party of parties.values()) {
    if (party.activeSessionId === sessionId) return party;
    if (party.rounds.some(r => r.number > 0)) {
      // Check if this session was part of this party
      const session = sessions.get(sessionId);
      if (session && session.joinCode === party.joinCode) return party;
    }
  }
  return undefined;
}

export function transitionParty(party: Party, newState: PartyState): void {
  const oldState = party.state;
  party.state = newState;
  console.log(`🎉 Party ${party.joinCode}: ${oldState} → ${newState} (Round ${party.currentRound})`);
}

export function completeRound(party: Party, session: GameSession): void {
  const rankings = getFinalRankings(session);
  const round: CompletedRound = {
    number: party.currentRound,
    config: session.config,
    questions: session.questions,
    rankings,
    completedAt: new Date(),
  };
  party.rounds.push(round);
  console.log(`🎉 Round ${party.currentRound} completed for Party ${party.joinCode}`);
}

export function endParty(partyId: string): boolean {
  const party = parties.get(partyId);
  if (!party) return false;

  // Destroy active session if any
  if (party.activeSessionId) {
    destroySession(party.activeSessionId);
    party.activeSessionId = null;
  }

  // Cleanup
  partyJoinCodeIndex.delete(party.joinCode);
  parties.delete(partyId);
  resetDjMode();
  console.log(`🎉 Party ended: ${party.joinCode} (${party.rounds.length} rounds played)`);
  return true;
}

export function addPlayerToParty(
  party: Party,
  wsId: string,
  name: string,
  avatar: string,
): { player: Player } | { error: string } {
  // Check if this is an existing player (by name)
  for (const [oldId, p] of party.players) {
    if (p.name.toLowerCase() === name.toLowerCase()) {
      // Reconnect — update wsId
      party.players.delete(oldId);
      p.id = wsId;
      p.connected = true;
      party.players.set(wsId, p);
      console.log(`🎉 ${p.avatar} ${p.name} reconnected to Party ${party.joinCode} (${oldId} → ${wsId})`);
      return { player: p };
    }
  }

  // New player
  if (party.players.size >= MAX_PLAYERS) return { error: "Party is full (max 8 players)" };

  const player: Player = {
    id: wsId,
    name: name.slice(0, 12),
    avatar,
    score: 0,
    streak: 0,
    connected: true,
    answers: [],
  };

  party.players.set(wsId, player);
  console.log(`🎉 ${player.avatar} ${player.name} joined Party ${party.joinCode}`);
  return { player };
}

/** Sync Party players into a GameSession (lobby) — adds any party players not yet in the session */
export function syncPartyPlayersToSession(party: Party, session: GameSession): void {
  for (const [wsId, partyPlayer] of party.players) {
    if (!session.players.has(wsId) && partyPlayer.connected) {
      // Reset per-round stats for the new round
      const roundPlayer: Player = {
        ...partyPlayer,
        score: 0,
        streak: 0,
        answers: [],
      };
      session.players.set(wsId, roundPlayer);
    }
  }
}

export function listParties(): Array<{ id: string; joinCode: string; state: PartyState; playerCount: number; currentRound: number; totalRounds: number }> {
  return [...parties.values()].map(p => ({
    id: p.id,
    joinCode: p.joinCode,
    state: p.state,
    playerCount: p.players.size,
    currentRound: p.currentRound,
    totalRounds: p.rounds.length,
  }));
}

// Cleanup stale parties every 5 minutes
setInterval(() => {
  const now = Date.now();
  // Clean up stale sessions within parties
  for (const [id, session] of sessions) {
    if (now - session.lastActivity.getTime() > SESSION_TIMEOUT_MS) {
      destroySession(id);
    }
  }
  // Clean up parties with no activity for 2 hours
  const PARTY_TIMEOUT_MS = 2 * 60 * 60 * 1000;
  for (const [id, party] of parties) {
    const lastActivity = party.activeSessionId
      ? sessions.get(party.activeSessionId)?.lastActivity?.getTime() ?? party.createdAt.getTime()
      : party.createdAt.getTime();
    if (now - lastActivity > PARTY_TIMEOUT_MS) {
      endParty(id);
      console.log(`🎉 Party expired: ${party.joinCode}`);
    }
  }
  // Clear used songs if no active parties (new evening) — but keep DJ session alive
  if (parties.size === 0 && sessions.size === 0) {
    usedSongIds.clear();
  }
}, 5 * 60 * 1000);

// ─── Join Code Generation ─────────────────────────────────

function generateJoinCode(): string {
  let code: string;
  do {
    code = "";
    for (let i = 0; i < 6; i++) {
      code += JOIN_CODE_CHARS[Math.floor(Math.random() * JOIN_CODE_CHARS.length)];
    }
  } while (joinCodeIndex.has(code));
  return code;
}

// ─── Session Management ───────────────────────────────────

export async function createSession(
  config: QuizConfig,
  hostWsId: string,
  musicClient: AppleMusicClient,
  party?: Party,
): Promise<GameSession> {
  let quiz: Quiz;

  if (config.source === "custom" && config.customTracks?.length) {
    // Custom quiz from builder — use provided tracks directly
    const ct = config.customTracks;
    const generators = [makeQuestion];
    const type = config.quizType as GenQuizType || "mixed";

    const questionTypes: GenQuizType[] = ["guess-the-artist", "guess-the-song", "guess-the-album", "guess-the-year", "intro-quiz"];

    quiz = {
      title: config.customName || "Custom Quiz",
      description: `Curated quiz with ${ct.length} songs`,
      type,
      source: "custom" as any,
      questionCount: ct.length,
      questions: ct.map((t, i) => {
        const qType = type === "mixed" ? questionTypes[i % questionTypes.length] : type;
        return {
          questionNumber: i + 1,
          type: qType,
          songId: t.id,
          songName: t.name,
          artistName: t.artistName,
          albumName: t.albumName,
          releaseYear: t.releaseYear || "unknown",
          question: generateQuestionText(qType, t),
          answer: generateAnswer(qType, t),
          hints: [],
          difficulty: "medium" as const,
        };
      }),
    };
    console.log(`🎮 Custom quiz: "${quiz.title}" (${quiz.questionCount} tracks)`);
  } else {
    // Standard quiz from source
    const excludeIds = new Set(usedSongIds);
    if (config.excludeRecentPlays) {
      try {
        const recent = await musicClient.getRecentlyPlayedTracks(50) as { data?: Array<{ id?: string }> };
        for (const item of recent.data || []) {
          if (item.id) excludeIds.add(item.id);
        }
        console.log(`🎮 Excluding ${excludeIds.size} songs (${usedSongIds.size} session + ${excludeIds.size - usedSongIds.size} recent)`);
      } catch {}
    }

    quiz = await generateQuiz(musicClient, {
      type: config.quizType as GenQuizType,
      source: config.source as any,
      count: config.questionCount * 3,  // Request triple for plenty of fallbacks
      genre: config.genre,
      decade: config.decade,
      excludeSongIds: excludeIds,
    });
  }

  // Track used songs so they don't repeat across sessions
  for (const q of quiz.questions) {
    if (q.songId) usedSongIds.add(q.songId);
  }

  // ─── VERIFIED POOL APPROACH ────────────────────────────
  // 1. Download ALL pool songs to library
  // 2. Verify which are playable
  // 3. Build questions ONLY from verified songs
  // 4. Trivia ONLY about verified artists
  // → ZERO failures at runtime. No swaps. No alternatives.

  const provider = getProvider();
  const allRawSongs = quiz.questions;

  // Step 1: Batch download ALL songs to library
  const allSongIds = allRawSongs.map(q => q.songId).filter(Boolean);
  if (allSongIds.length > 0 && musicClient.hasUserToken()) {
    try {
      await musicClient.addToLibrary({ songs: allSongIds });
      console.log(`🎮 Batch addToLibrary: ${allSongIds.length} songs`);
    } catch {}
    // Give library time to sync
    await new Promise(r => setTimeout(r, 3000));
  }

  // Step 2: Verify which songs are actually playable
  const muteAll = isMuted();
  const isMusicKit = getActiveProviderType() === "musickit-web";
  const verifiedSongs: typeof allRawSongs = [];
  if (isMusicKit || muteAll) {
    // MusicKit JS plays any catalog song by ID — no verify needed
    verifiedSongs.push(...allRawSongs.filter(q => q.songId));
    console.log(`🎮 MusicKit: ${verifiedSongs.length}/${allRawSongs.length} songs (skip verify — plays by catalog ID)`);
  } else if (provider.isAvailable()) {
    for (const q of allRawSongs) {
      if (!q.songId) continue;
      const artist = q.artistName.split(/[,&]/)[0].trim();
      const names = [q.songName];
      const simple = q.songName.replace(/\s*[\(\[].*?[\)\]]/g, "").trim();
      if (simple !== q.songName) names.push(simple);

      let found = false;
      for (const name of names) {
        if (await provider.checkLibrary(name, artist)) { found = true; break; }
      }
      if (found) {
        verifiedSongs.push(q);
      }
    }
    console.log(`🎮 Verified: ${verifiedSongs.length}/${allRawSongs.length} songs playable`);
  } else {
    // No provider (mute mode) — trust all songs
    verifiedSongs.push(...allRawSongs);
  }

  if (verifiedSongs.length < 3) {
    throw new Error(`Only ${verifiedSongs.length} playable songs found — need at least 3. Try a different source.`);
  }

  // Step 3: Build QuizQuestions from VERIFIED songs only
  function buildQuizQuestion(
    q: typeof allRawSongs[0],
    allQ: typeof allRawSongs,
  ): QuizQuestion {
    const options = generateOptions(q, allQ);
    return {
      songId: q.songId,
      songName: q.songName,
      artistName: q.artistName,
      albumName: q.albumName,
      releaseYear: q.releaseYear,
      questionText: q.question,
      correctAnswer: q.answer,
      options,
      questionType: q.type as QuizQuestion["questionType"],
      difficulty: q.difficulty,
    };
  }

  // Resolve artwork in parallel (non-blocking — quiz works without it)
  async function resolveArtwork(q: QuizQuestion): Promise<QuizQuestion> {
    try {
      const result = (await musicClient.searchCatalog(`${q.songName} ${q.artistName}`, ["songs"], 1)) as {
        results?: { songs?: { data?: Array<{ attributes?: { artwork?: { url?: string }; previews?: Array<{ url?: string }> } }> } };
      };
      const song = result?.results?.songs?.data?.[0];
      if (song?.attributes?.artwork?.url) {
        q.artworkUrl = song.attributes.artwork.url.replace("{w}", "600").replace("{h}", "600");
      }
      q.previewUrl = song?.attributes?.previews?.[0]?.url;
    } catch {}
    return q;
  }

  // Dedup: no duplicate songs, no duplicate artists
  function normalizeForDedup(name: string): string {
    return name
      .replace(/\s*[\(\[].*?[\)\]]/g, "")           // strip (Live), [Remastered], etc.
      .replace(/\s*[-–—].*$/, "")                    // strip " - Single", " — Deluxe"
      .replace(/\s*(English|French|Spanish|German|Italian|Japanese|Acoustic|Demo|Remix|Radio Edit|Version|Mix|Edit|Mono|Stereo).*$/i, "") // strip language/variant suffixes
      .replace(/\s*(feat\.?|ft\.?).*$/i, "")         // strip featuring
      .trim().toLowerCase();
  }
  const dedupedVerified: QuizQuestion[] = [];
  const seenSongKeys = new Set<string>();
  const seenArtists = new Set<string>();
  for (const raw of verifiedSongs) {
    const songKey = `${normalizeForDedup(raw.songName)}|${raw.artistName.toLowerCase()}`;
    const artistKey = raw.artistName.toLowerCase();
    if (!seenSongKeys.has(songKey) && !seenArtists.has(artistKey)) {
      seenSongKeys.add(songKey);
      seenArtists.add(artistKey);
      dedupedVerified.push(buildQuizQuestion(raw, verifiedSongs));
    }
  }

  console.log(`🎮 Pipeline: ${allRawSongs.length} raw → ${verifiedSongs.length} verified → ${dedupedVerified.length} deduped`);

  // Resolve artwork for all (parallel)
  await Promise.all(dedupedVerified.map(q => resolveArtwork(q)));

  // ─── Gossip + Trivia ────────────────────────────────────
  const isGossipRound = config.quizType === "gossip";
  const includeGossip = isGossipRound || config.includeGossip === true;

  // For gossip round: ALL questions are gossip (with background music)
  // For mixed with gossip: split trivia budget between gossip + regular trivia
  const triviaCount = isGossipRound
    ? config.questionCount  // all gossip
    : Math.max(2, Math.round(config.questionCount * 0.35));
  const musicCount = isGossipRound ? 0 : config.questionCount - triviaCount;
  const gossipCount = isGossipRound
    ? config.questionCount
    : includeGossip ? Math.max(1, Math.ceil(triviaCount * 0.4)) : 0;
  const regularTriviaCount = triviaCount - gossipCount;

  // Trivia should use DIFFERENT artists than music questions for maximum variety
  const musicArtistKeys = new Set(dedupedVerified.slice(0, musicCount).map(q => q.artistName.toLowerCase()));
  const triviaOnlyArtists: Array<{ name: string }> = [];
  const triviaSongPool: typeof dedupedVerified = [];
  for (const q of dedupedVerified) {
    if (!musicArtistKeys.has(q.artistName.toLowerCase())) {
      triviaOnlyArtists.push({ name: q.artistName });
      triviaSongPool.push(q);
    }
  }
  // Full song pool for background song lookup
  const songPool = dedupedVerified.map(q => ({
    id: q.songId, name: q.songName, artistName: q.artistName,
    albumName: q.albumName, releaseYear: q.releaseYear,
  }));

  console.log(`🧠 Trivia artist pool: ${triviaOnlyArtists.length} artists not in music questions`);

  // Fetch gossip + trivia in parallel
  const [freshTrivia, bankedQuestions, gossipQuestions] = await Promise.all([
    regularTriviaCount > 0 ? generateTriviaQuestions(
      { artists: triviaOnlyArtists.length >= regularTriviaCount ? triviaOnlyArtists : [...triviaOnlyArtists, ...dedupedVerified.slice(0, musicCount).map(q => ({ name: q.artistName }))],
        songs: songPool },
      regularTriviaCount + 4  // request extra — some will be filtered
    ).catch(() => [] as GeneratedTrivia[]) : Promise.resolve([] as GeneratedTrivia[]),
    regularTriviaCount > 0 ? getRandomQuestions(Math.max(1, Math.ceil(regularTriviaCount * 0.3))).catch(() => []) : Promise.resolve([]),
    gossipCount > 0 ? getRandomGossipQuestions(gossipCount + 4).catch(() => []) : Promise.resolve([]),
  ]);

  if (gossipCount > 0) {
    console.log(`🗞️ Gossip: requested ${gossipCount}, got ${gossipQuestions.length} from bank`);
  }

  // Track used SONGS across all questions (music + trivia) — no song twice
  const usedSongKeysInQuiz = new Set(
    dedupedVerified.slice(0, musicCount).map(q => normalizeForDedup(q.songName) + "|" + q.artistName.toLowerCase())
  );
  const usedTriviaArtists = new Set<string>();

  function triviaToQuestion(t: { questionType: string; questionText: string; correctAnswer: string; options: string[]; artistName: string; funFact?: string; backgroundSongName?: string; backgroundArtist?: string; difficulty: string }): QuizQuestion | null {
    const triviaArtist = t.backgroundArtist || t.artistName;
    // No trivia artist twice
    if (usedTriviaArtists.has(triviaArtist.toLowerCase())) {
      console.log(`🧠 Trivia skipped: "${triviaArtist}" already has a trivia question`);
      return null;
    }
    // Find a verified song by this artist that hasn't been used yet
    const bgSong = songPool.find(s =>
      (s.artistName === triviaArtist || s.artistName.toLowerCase() === triviaArtist.toLowerCase()) &&
      !usedSongKeysInQuiz.has(normalizeForDedup(s.name) + "|" + s.artistName.toLowerCase())
    );
    if (!bgSong) {
      console.log(`🧠 Trivia skipped: no unused song for "${triviaArtist}"`);
      return null;
    }
    // Mark song + artist as used
    usedSongKeysInQuiz.add(normalizeForDedup(bgSong.name) + "|" + bgSong.artistName.toLowerCase());
    usedTriviaArtists.add(triviaArtist.toLowerCase());
    return {
      songId: bgSong.id,
      songName: bgSong.name,
      artistName: bgSong.artistName,
      albumName: bgSong.albumName,
      releaseYear: bgSong.releaseYear,
      questionText: t.questionText,
      correctAnswer: t.correctAnswer,
      options: t.options,
      questionType: t.questionType as QuizQuestion["questionType"],
      difficulty: (t.difficulty as "easy" | "medium" | "hard") || "medium",
      isTrivia: true,
      backgroundSongId: bgSong.id,
      backgroundSongName: bgSong.name,
      backgroundArtist: bgSong.artistName,
      funFact: t.funFact || undefined,
    };
  }

  // Convert gossip to quiz questions
  // Unlike regular trivia, gossip doesn't require the artist to be in the pool.
  // If the gossip artist has a song in the pool, use it. Otherwise, use ANY unused song.
  function gossipToQuestion(g: typeof gossipQuestions[0]): QuizQuestion | null {
    const gossipArtist = g.backgroundArtist || g.artistName;
    // Try to find song by gossip artist first
    let bgSong = songPool.find(s =>
      s.artistName.toLowerCase() === gossipArtist.toLowerCase() &&
      !usedSongKeysInQuiz.has(normalizeForDedup(s.name) + "|" + s.artistName.toLowerCase())
    );
    // Fallback: use any unused song from the pool
    if (!bgSong) {
      bgSong = songPool.find(s =>
        !usedSongKeysInQuiz.has(normalizeForDedup(s.name) + "|" + s.artistName.toLowerCase())
      );
    }
    if (!bgSong) {
      console.log(`🗞️ Gossip skipped: no unused songs left for "${g.questionText.slice(0, 40)}"`);
      return null;
    }
    usedSongKeysInQuiz.add(normalizeForDedup(bgSong.name) + "|" + bgSong.artistName.toLowerCase());
    return {
      songId: bgSong.id,
      songName: bgSong.name,
      artistName: bgSong.artistName,
      albumName: bgSong.albumName,
      releaseYear: bgSong.releaseYear,
      questionText: g.questionText,
      correctAnswer: g.correctAnswer,
      options: g.options,
      questionType: "gossip",
      difficulty: g.difficulty || "medium",
      isTrivia: true,
      backgroundSongId: bgSong.id,
      backgroundSongName: bgSong.name,
      backgroundArtist: bgSong.artistName,
      funFact: g.funFact ? `🗞️ ${g.category.toUpperCase()} — ${g.funFact}` : undefined,
    };
  }

  const gossipAsTrivia: QuizQuestion[] = gossipQuestions
    .map(g => gossipToQuestion(g))
    .filter((q): q is QuizQuestion => q !== null)
    .slice(0, gossipCount);

  const regularTrivia: QuizQuestion[] = [
    ...freshTrivia.map(t => triviaToQuestion(t)),
    ...bankedQuestions.map(t => triviaToQuestion(t)),
  ].filter((q): q is QuizQuestion => q !== null).slice(0, regularTriviaCount);

  // Merge: gossip first, then regular trivia
  const triviaQuestions: QuizQuestion[] = [...gossipAsTrivia, ...regularTrivia].slice(0, triviaCount);

  // Bank fresh trivia that matched verified songs
  const freshToBank = triviaQuestions.filter(q => q.songId && !bankedQuestions.some(b => b.questionText === q.questionText));
  if (freshToBank.length > 0) {
    saveQuestions(freshToBank.map(q => ({
      questionType: q.questionType, questionText: q.questionText,
      correctAnswer: q.correctAnswer, options: q.options,
      artistName: q.backgroundArtist || q.artistName, funFact: q.funFact,
      difficulty: q.difficulty, backgroundSongName: q.backgroundSongName || q.songName,
      backgroundArtist: q.backgroundArtist || q.artistName,
    }))).catch(() => {});
  }

  // ─── Interleave — never two trivia in a row ────────────
  const primaryMusic = dedupedVerified.slice(0, musicCount);
  const questions: QuizQuestion[] = [];
  let tIdx = 0, mIdx = 0;
  const total = Math.min(config.questionCount, primaryMusic.length + triviaQuestions.length);
  const triviaPositions = new Set<number>();
  if (triviaQuestions.length > 0 && total > 0) {
    const gap = Math.max(2, Math.floor(total / triviaQuestions.length));
    for (let i = 0; i < triviaQuestions.length; i++) {
      triviaPositions.add(Math.min(gap * i + (gap - 1), total - 1));
    }
  }
  for (let pos = 0; pos < total; pos++) {
    if (triviaPositions.has(pos) && tIdx < triviaQuestions.length) {
      questions.push(triviaQuestions[tIdx++]);
    } else if (mIdx < primaryMusic.length) {
      questions.push(primaryMusic[mIdx++]);
    } else if (tIdx < triviaQuestions.length) {
      questions.push(triviaQuestions[tIdx++]);
    }
  }

  // No alternatives needed — all songs verified playable
  const alternatives: QuizQuestion[] = [];

  const gossipUsed = questions.filter(q => q.questionType === 'gossip').length;
  console.log(`🧠 Quiz: ${mIdx} music + ${tIdx - gossipUsed} trivia + ${gossipUsed} gossip = ${questions.length} (from ${verifiedSongs.length} verified songs)`);
  for (const q of questions) {
    const tag = q.questionType === 'gossip' ? 'GOSSIP' : q.isTrivia ? 'TRIVIA' : 'MUSIC ';
    console.log(`🧠  ${tag} Q: "${q.questionText}" → ${q.correctAnswer} (plays: ${q.songName} by ${q.artistName})`);
  }

  // Use Party's join code if within a Party, otherwise generate new
  const joinCode = party ? party.joinCode : generateJoinCode();
  const sessionId = randomUUID().slice(0, 12);

  const session: GameSession = {
    id: sessionId,
    joinCode,
    hostWsId,
    players: new Map(),
    waitingPlayers: [],
    config,
    state: "lobby",
    currentQuestion: -1,
    questions,
    alternatives,
    questionStartTime: 0,
    timer: null,
    pendingAnswers: new Map(),
    createdAt: new Date(),
    lastActivity: new Date(),
  };

  sessions.set(sessionId, session);
  joinCodeIndex.set(joinCode, sessionId);

  // Link to Party if within one
  if (party) {
    party.currentRound++;
    party.activeSessionId = sessionId;
    transitionParty(party, "lobby");
    // Sync party players into session (they persist across rounds)
    syncPartyPlayersToSession(party, session);
    console.log(`🎮 Round ${party.currentRound} session created: ${joinCode} (${questions.length} questions, ${session.players.size} returning players)`);
  } else {
    console.log(`🎮 Session created: ${joinCode} (${questions.length} questions)`);
  }

  return session;
}

// Ensure theme songs are in library (called once on first quiz)
let themeSongsEnsured = false;
async function ensureThemeSongs(musicClient: AppleMusicClient): Promise<void> {
  if (themeSongsEnsured || !musicClient.hasUserToken()) return;
  themeSongsEnsured = true;
  const allThemes = [...THEME_SONGS.preparation, THEME_SONGS.victory];
  const songIds = allThemes.map(t => t.songId).filter(Boolean);
  if (songIds.length > 0) {
    try {
      await musicClient.addToLibrary({ songs: songIds });
      console.log(`🎵 Theme songs ensured in library (${songIds.length} songs)`);
    } catch {}
  }
}

export async function prepareSongs(
  sessionId: string,
  musicClient: AppleMusicClient,
  onProgress: (current: number, total: number) => void,
): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) return;

  // Ensure theme songs are available
  await ensureThemeSongs(musicClient);

  // Prepare ALL songs — music questions AND trivia background songs
  const songs = session.questions.filter(q => q.songId);
  if (songs.length === 0 || !musicClient.hasUserToken()) return;

  const provider = getProvider();

  if (!provider.isAvailable()) {
    // In mute mode or no provider, skip library verification
    for (let i = 0; i < songs.length; i++) {
      onProgress(i + 1, songs.length);
    }
    return;
  }

  // Step 1: Check which songs are already in library
  const needsDownload: string[] = [];
  for (let i = 0; i < songs.length; i++) {
    const q = songs[i];
    const artist = q.artistName.split(/[,&]/)[0].trim();
    const simple = q.songName.replace(/\s*[\(\[].*?[\)\]]/g, "").trim();
    let found = false;
    for (const name of [q.songName, simple]) {
      if (await provider.checkLibrary(name, artist)) { found = true; break; }
    }
    if (found) {
      console.log(`🎮 ✓ Already in library: ${q.songName}`);
      onProgress(i + 1, songs.length);
    } else {
      needsDownload.push(q.songId);
      trackAddedToLibrary(q.songName, q.artistName);
    }
  }

  // Step 2: Add missing songs to library in one batch
  if (needsDownload.length > 0) {
    console.log(`🎮 Downloading ${needsDownload.length} songs to library...`);
    try {
      await musicClient.addToLibrary({ songs: needsDownload });
      console.log(`🎮 addToLibrary OK for ${needsDownload.length} songs`);
    } catch (err) {
      console.error("🎮 addToLibrary failed:", err);
    }
  }

  // Step 3: Verify all songs are available locally (4 retries × 1s)
  // Also add alternative songs to library so they're ready for replacement
  const altSongIds = session.alternatives.filter(q => q.songId).map(q => q.songId);
  if (altSongIds.length > 0) {
    try {
      await musicClient.addToLibrary({ songs: altSongIds });
      console.log(`🎮 addToLibrary OK for ${altSongIds.length} alternative songs`);
    } catch (err) {
      console.error("🎮 addToLibrary for alternatives failed:", err);
    }
  }

  for (let i = 0; i < songs.length; i++) {
    const q = songs[i];
    const artist = q.artistName.split(/[,&]/)[0].trim();
    const names = [q.songName];
    const simple = q.songName.replace(/\s*[\(\[].*?[\)\]]/g, "").trim();
    if (simple !== q.songName) names.push(simple);

    onProgress(i + 1, songs.length);

    let found = false;
    for (let attempt = 0; attempt < 4; attempt++) {
      for (const name of names) {
        if (await provider.checkLibrary(name, artist)) { found = true; break; }
      }
      if (found) break;
      await new Promise(r => setTimeout(r, 1000));
    }
    if (found) {
      console.log(`🎮 ✓ Ready: ${q.songName} — ${q.artistName}`);
    } else {
      console.warn(`🎮 ✗ Not found: ${q.songName} — ${q.artistName} (after 8 attempts)`);

      // Trivia: never replace the question — just log and continue (music is background)
      if (q.isTrivia) {
        console.warn(`🎮 Trivia bg not in library: ${q.songName} — will try searchAndPlay at runtime`);
        continue;
      }

      // Music question: try to replace with an alternative that IS in the library
      let replaced = false;
      for (let altIdx = 0; altIdx < session.alternatives.length; altIdx++) {
        const alt = session.alternatives[altIdx];
        const altArtist = alt.artistName.split(/[,&]/)[0].trim();
        const altNames = [alt.songName];
        const altSimple = alt.songName.replace(/\s*[\(\[].*?[\)\]]/g, "").trim();
        if (altSimple !== alt.songName) altNames.push(altSimple);

        let altFound = false;
        for (const name of altNames) {
          if (await provider.checkLibrary(name, altArtist)) { altFound = true; break; }
        }

        if (altFound) {
          const qIndex = session.questions.indexOf(q);
          if (qIndex !== -1) {
            session.questions[qIndex] = alt;
            console.log(`🎮 ↻ Replaced "${q.songName}" with alternative "${alt.songName}" — ${alt.artistName}`);
          }
          session.alternatives.splice(altIdx, 1);
          replaced = true;
          break;
        }
      }
      if (!replaced) {
        console.warn(`🎮 ✗ No alternative available for: ${q.songName} — ${q.artistName}`);
      }
    }
  }

  // Stop background music when preparation is done
  await provider.pause();
}

export function getSession(sessionId: string): GameSession | undefined {
  return sessions.get(sessionId);
}

export function getSessionByCode(joinCode: string): GameSession | undefined {
  const code = joinCode.toUpperCase();
  // First check direct session index
  const sessionId = joinCodeIndex.get(code);
  if (sessionId) return sessions.get(sessionId);
  // Then check Party — return the active session within the Party
  const party = getPartyByCode(code);
  if (party?.activeSessionId) return sessions.get(party.activeSessionId);
  return undefined;
}

export function getWaitingPlayers(sessionId: string): import("@music-quiz/shared").WaitingPlayer[] {
  // Check Party first, then session
  const party = getPartyBySessionId(sessionId);
  if (party) return party.waitingPlayers;
  return sessions.get(sessionId)?.waitingPlayers || [];
}

export function promoteWaitingPlayers(sessionId: string): import("@music-quiz/shared").WaitingPlayer[] {
  // Promote from Party if available, otherwise from session
  const party = getPartyBySessionId(sessionId);
  if (party) {
    const waiting = [...party.waitingPlayers];
    party.waitingPlayers = [];
    return waiting;
  }
  const session = sessions.get(sessionId);
  if (!session) return [];
  const waiting = [...session.waitingPlayers];
  session.waitingPlayers = [];
  return waiting;
}

export function destroySession(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  if (session.timer) clearTimeout(session.timer);
  joinCodeIndex.delete(session.joinCode);
  sessions.delete(sessionId);
  console.log(`🎮 Session destroyed: ${session.joinCode} (was ${session.state}, ${session.players.size} players)`);
}

// ─── Player Management ────────────────────────────────────

export function addPlayer(
  sessionId: string,
  wsId: string,
  name: string,
  avatar: string,
): { player: Player; session: GameSession } | { error: string } {
  const session = sessions.get(sessionId);
  if (!session) return { error: "Session not found" };

  // Find Party context (if any)
  const party = getPartyBySessionId(sessionId);

  // State-based join/rejoin rules:
  // - lobby: new players can join, existing can rejoin
  // - playing/countdown/evaluating/reveal/scoreboard: → Waiting Room (new) or CLOSED (existing)
  // - finished (DJ Mode / ceremony): existing can rejoin DJ, new → Waiting Room
  const isExistingInSession = [...session.players.values()].some(p => p.name.toLowerCase() === name.toLowerCase());
  const isExistingInParty = party ? [...party.players.values()].some(p => p.name.toLowerCase() === name.toLowerCase()) : false;

  if (session.state === "finished") {
    if (isExistingInSession || isExistingInParty) {
      // Existing player rejoins — update in both Party and session
      if (party) {
        addPlayerToParty(party, wsId, name, avatar);
      }
      for (const [oldId, p] of session.players) {
        if (p.name.toLowerCase() === name.toLowerCase()) {
          session.players.delete(oldId);
          p.id = wsId;
          p.connected = true;
          session.players.set(wsId, p);
          console.log(`🎮 Player reconnected to DJ Mode: ${name} (${oldId} → ${wsId})`);
          return { player: p, session };
        }
      }
    }
    // New player → Waiting Room (on Party level if available)
    if (party) {
      party.waitingPlayers.push({ wsId, name: name.slice(0, 12), avatar });
      console.log(`🎮 ${avatar} ${name} → Waiting Room (Party ${party.joinCode}, ${party.waitingPlayers.length} waiting)`);
    } else {
      session.waitingPlayers.push({ wsId, name: name.slice(0, 12), avatar });
      console.log(`🎮 ${avatar} ${name} → Waiting Room (game finished, ${session.waitingPlayers.length} waiting)`);
    }
    return { error: "__WAITING_ROOM__" };
  }

  if (session.state !== "lobby") {
    // Game in progress → Waiting Room
    if (party) {
      party.waitingPlayers.push({ wsId, name: name.slice(0, 12), avatar });
      console.log(`🎮 ${avatar} ${name} → Waiting Room (Party ${party.joinCode}, quiz in progress, ${party.waitingPlayers.length} waiting)`);
    } else {
      session.waitingPlayers.push({ wsId, name: name.slice(0, 12), avatar });
      console.log(`🎮 ${avatar} ${name} → Waiting Room (game in progress, ${session.waitingPlayers.length} waiting)`);
    }
    return { error: "__WAITING_ROOM__" };
  }

  if (session.players.size >= MAX_PLAYERS) return { error: "Game is full (max 8 players)" };

  // In lobby — add player to Party (if exists) and session
  if (party) {
    const partyResult = addPlayerToParty(party, wsId, name, avatar);
    if ("error" in partyResult) return partyResult;

    // Remove old session entry if player reconnected with new wsId
    for (const [oldId, p] of session.players) {
      if (p.name.toLowerCase() === name.toLowerCase() && oldId !== wsId) {
        session.players.delete(oldId);
        console.log(`🎮 Replaced old session entry: ${name} (${oldId} → ${wsId})`);
        break;
      }
    }

    // For the round, reset per-round stats
    const roundPlayer: Player = {
      ...partyResult.player,
      score: 0,
      streak: 0,
      answers: [],
    };
    session.players.set(wsId, roundPlayer);
    session.lastActivity = new Date();
    console.log(`🎮 ${roundPlayer.avatar} ${roundPlayer.name} joined Round ${party.currentRound} (${session.joinCode})`);
    return { player: roundPlayer, session };
  }

  // Legacy (no Party) — check name uniqueness
  for (const p of session.players.values()) {
    if (p.name.toLowerCase() === name.toLowerCase()) {
      return { error: "Name already taken" };
    }
  }

  const player: Player = {
    id: wsId,
    name: name.slice(0, 12),
    avatar,
    score: 0,
    streak: 0,
    connected: true,
    answers: [],
  };

  session.players.set(wsId, player);
  session.lastActivity = new Date();
  console.log(`🎮 ${player.avatar} ${player.name} joined ${session.joinCode}`);
  return { player, session };
}

export function removePlayer(sessionId: string, wsId: string): { player: Player; session: GameSession } | undefined {
  const session = sessions.get(sessionId);
  if (!session) return undefined;
  const player = session.players.get(wsId);
  if (!player) return undefined;
  session.players.delete(wsId);
  session.lastActivity = new Date();
  console.log(`🎮 ${player.avatar} ${player.name} left ${session.joinCode}`);
  return { player, session };
}

export function markPlayerDisconnected(wsId: string): { player: Player; session: GameSession } | undefined {
  for (const session of sessions.values()) {
    const player = session.players.get(wsId);
    if (player) {
      player.connected = false;
      return { player, session };
    }
  }
  return undefined;
}

export function reconnectPlayer(sessionId: string, newWsId: string, name: string): { player: Player; session: GameSession } | undefined {
  const session = sessions.get(sessionId);
  if (!session) return undefined;

  // Find disconnected player by name
  for (const [oldId, player] of session.players) {
    if (player.name.toLowerCase() === name.toLowerCase() && !player.connected) {
      session.players.delete(oldId);
      player.id = newWsId;
      player.connected = true;
      session.players.set(newWsId, player);
      console.log(`🎮 ${player.avatar} ${player.name} reconnected to ${session.joinCode}`);
      return { player, session };
    }
  }
  return undefined;
}

// ─── Game Flow ────────────────────────────────────────────

export type GameEvent =
  | { type: "state_change"; session: GameSession }
  | { type: "question_results"; session: GameSession; results: QuestionResult[] }
  | { type: "final_results"; session: GameSession; rankings: FinalRanking[] }
  | { type: "answer_received"; session: GameSession; playerId: string; playerName: string };

type EventCallback = (event: GameEvent) => void;
const eventListeners = new Map<string, EventCallback>();

export function onGameEvent(sessionId: string, callback: EventCallback): void {
  eventListeners.set(sessionId, callback);
}

export function removeGameEventListener(sessionId: string): void {
  eventListeners.delete(sessionId);
}

function emit(sessionId: string, event: GameEvent): void {
  eventListeners.get(sessionId)?.(event);
}

function transition(session: GameSession, newState: GameState): void {
  session.state = newState;
  session.lastActivity = new Date();
  emit(session.id, { type: "state_change", session });
}

export async function startQuiz(sessionId: string): Promise<boolean> {
  const session = sessions.get(sessionId);
  if (!session || session.state !== "lobby") return false;
  if (session.players.size === 0) return false;

  // Transition Party to quiz state
  const party = getPartyBySessionId(sessionId);
  if (party) {
    transitionParty(party, "quiz");
  }

  // Start first question with countdown
  await advanceToNextQuestion(session);
  return true;
}

async function advanceToNextQuestion(session: GameSession): Promise<void> {
  session.currentQuestion++;

  if (session.currentQuestion >= session.questions.length) {
    // Game over
    finishGame(session);
    return;
  }

  const provider = getProvider();

  // Stop any playing music before countdown (awaited!)
  await provider.pause();

  // Countdown phase (songs already verified in library during preparation)
  transition(session, "countdown");

  session.timer = setTimeout(async () => {
    // Play music — songs are pre-verified, no need to wait for confirmation
    await playQuestionMusic(session);

    // Start the clock immediately — music is playing
    session.pendingAnswers.clear();
    session.questionStartTime = Date.now();
    transition(session, "playing");

    // Set timer for question end
    session.timer = setTimeout(() => {
      endQuestion(session);
    }, session.config.timeLimit * 1000);
  }, COUNTDOWN_MS);
}

async function playQuestionMusic(session: GameSession): Promise<void> {
  const q = session.questions[session.currentQuestion];
  if (!q) return;

  const qNum = session.currentQuestion + 1;
  const isTrivia = q.isTrivia === true;

  const provider = getProvider();

  if (provider.isAvailable()) {
    try {
      const artist = q.artistName.split(/[,&]/)[0].trim();

      // Primary: exact name + artist match with retries
      const result = await provider.playExact(q.songName, artist, { retries: 3, randomSeek: true });
      if (result.playing) {
        console.log(`🎮 Playing: ${result.track}`);
        logTrackChange(q.songName, q.artistName, "quiz", q.artworkUrl);
        verifyPlaying(qNum, q.songName, q.artistName);
        return;
      }

      // Fallback: try without parentheses (remaster tags)
      const simpleName = q.songName.replace(/\s*[\(\[].*?[\)\]]/g, "").trim();
      if (simpleName !== q.songName) {
        const retry = await provider.playExact(simpleName, artist, { retries: 2, randomSeek: true });
        if (retry.playing) {
          console.log(`🎮 Playing (simplified): ${retry.track}`);
          verifyPlaying(qNum, q.songName, q.artistName);
          return;
        }
      }

      // Primary song failed
      if (isTrivia) {
        // Trivia: specific song failed — search-and-play ANY song by this artist
        const triviaArtist = (q.backgroundArtist || q.artistName).split(/[,&]/)[0].trim();
        console.warn(`🎮 ⚠️ Trivia bg failed: "${q.songName}" — searching for any ${triviaArtist} song...`);
        try {
          const searchResult = await provider.searchAndPlay(triviaArtist);
          if (searchResult && !("error" in searchResult)) {
            console.log(`🎮 Trivia bg fallback: playing ${triviaArtist} via search`);
            return;
          }
        } catch {}
        console.warn(`🎮 ⚠️ No ${triviaArtist} song found — trivia continues without music`);
        quizLog.push({ q: qNum, expected: `${q.songName} — ${q.artistName}`, actual: "TRIVIA_BG_SKIP", match: false });
      } else {
        // Music question: try alternatives until one plays (swap entire question)
        console.warn(`🎮 ⚠️ Primary failed: ${q.songName} — trying alternatives...`);
        for (let altIdx = 0; altIdx < session.alternatives.length; altIdx++) {
          const alt = session.alternatives[altIdx];
          const altArtist = alt.artistName.split(/[,&]/)[0].trim();
          const altSimple = alt.songName.replace(/\s*[\(\[].*?[\)\]]/g, "").trim();

          for (const name of [alt.songName, altSimple]) {
            const altResult = await provider.playExact(name, altArtist, { retries: 1, randomSeek: true });
            if (altResult.playing) {
              const qIndex = session.currentQuestion;
              console.log(`🎮 ↻ Swapped Q${qNum}: "${q.songName}" → "${alt.songName}" (playing: ${altResult.track})`);
              session.questions[qIndex] = alt;
              session.alternatives.splice(altIdx, 1);
              verifyPlaying(qNum, alt.songName, alt.artistName);
              return;
            }
          }
        }
        // All alternatives exhausted — this should never happen with 3x questions
        console.error(`🎮 ❌ ALL alternatives exhausted for Q${qNum} — no music`);
        quizLog.push({ q: qNum, expected: `${q.songName} — ${q.artistName}`, actual: "ALL_FAILED", match: false });
      }
    } catch (err) {
      console.error("🎮 Playback failed:", err);
    }
  } else {
    console.log(`🎮 No playback provider — preview fallback for: ${q.songName}`);
    // Log to track change log so Recently Played still shows what would have played (muted mode)
    if (q.songName && q.artistName) {
      logTrackChange(q.songName, q.artistName, "quiz-muted", q.artworkUrl);
    }
  }
}

export function submitAnswer(
  sessionId: string,
  wsId: string,
  questionIndex: number,
  answerIndex?: number,
  text?: string,
  timeMs?: number,
): boolean {
  const session = sessions.get(sessionId);
  if (!session || session.state !== "playing") return false;
  if (questionIndex !== session.currentQuestion) return false;

  const player = session.players.get(wsId);
  if (!player) return false;

  // Don't allow double answers
  if (session.pendingAnswers.has(wsId)) return false;

  const elapsed = timeMs ?? (Date.now() - session.questionStartTime);

  session.pendingAnswers.set(wsId, {
    playerId: wsId,
    playerName: player.name,
    answerIndex,
    text,
    timeMs: elapsed,
  });

  emit(session.id, {
    type: "answer_received",
    session,
    playerId: wsId,
    playerName: player.name,
  });

  // Check if all connected players have answered
  const connectedCount = [...session.players.values()].filter((p) => p.connected).length;
  if (session.pendingAnswers.size >= connectedCount) {
    // All answered — end question early
    if (session.timer) clearTimeout(session.timer);
    endQuestion(session);
  }

  return true;
}

async function endQuestion(session: GameSession): Promise<void> {
  if (session.timer) {
    clearTimeout(session.timer);
    session.timer = null;
  }

  const question = session.questions[session.currentQuestion];
  if (!question) return;

  const answerMode = getAnswerModeForQuestion(session);

  // Evaluate answers
  if (answerMode === "free-text" && session.pendingAnswers.size > 0) {
    transition(session, "evaluating");
    await evaluateAndScore(session, question, "free-text");
  } else {
    await evaluateAndScore(session, question, "multiple-choice");
  }
}

async function evaluateAndScore(
  session: GameSession,
  question: QuizQuestion,
  mode: "multiple-choice" | "free-text",
): Promise<void> {
  const results: QuestionResult[] = [];

  if (mode === "free-text") {
    // AI evaluation
    const playerAnswers = [...session.pendingAnswers.values()].map((a) => ({
      playerId: a.playerId,
      answer: a.text || "",
      timeMs: a.timeMs,
    }));

    let evaluations: Array<{ playerId: string; isCorrect: boolean; explanation?: string }>;
    try {
      evaluations = await evaluateAnswers(
        question.correctAnswer,
        question.questionType,
        playerAnswers,
      );
    } catch (err) {
      console.error("🎮 AI evaluation failed, marking all as incorrect:", err);
      evaluations = playerAnswers.map((a) => ({ playerId: a.playerId, isCorrect: false, explanation: "AI evaluation failed — quiz master decides" }));
    }

    for (const ev of evaluations) {
      const pending = session.pendingAnswers.get(ev.playerId);
      const player = session.players.get(ev.playerId);
      if (!pending || !player) continue;

      const points = ev.isCorrect ? calculatePoints(pending.timeMs, session.config.timeLimit * 1000, player.streak) : 0;
      player.streak = ev.isCorrect ? player.streak + 1 : 0;
      player.score += points;

      player.answers.push({
        questionIndex: session.currentQuestion,
        text: pending.text,
        timeMs: pending.timeMs,
        correct: ev.isCorrect,
        points,
        aiExplanation: ev.explanation,
      });

      results.push({
        playerId: ev.playerId,
        playerName: player.name,
        avatar: player.avatar,
        answer: pending.text || "",
        correct: ev.isCorrect,
        points,
        totalScore: player.score,
        streak: player.streak,
        aiExplanation: ev.explanation,
      });
    }
  } else {
    // Multiple-choice evaluation
    const correctIndex = question.options.indexOf(question.correctAnswer);

    for (const [wsId, pending] of session.pendingAnswers) {
      const player = session.players.get(wsId);
      if (!player) continue;

      const correct = pending.answerIndex === correctIndex;
      const points = correct ? calculatePoints(pending.timeMs, session.config.timeLimit * 1000, player.streak) : 0;
      player.streak = correct ? player.streak + 1 : 0;
      player.score += points;

      player.answers.push({
        questionIndex: session.currentQuestion,
        answerIndex: pending.answerIndex,
        timeMs: pending.timeMs,
        correct,
        points,
      });

      results.push({
        playerId: wsId,
        playerName: player.name,
        avatar: player.avatar,
        answer: question.options[pending.answerIndex ?? -1] || "(no answer)",
        correct,
        points,
        totalScore: player.score,
        streak: player.streak,
      });
    }
  }

  // Players who didn't answer get 0 points and streak reset
  for (const [wsId, player] of session.players) {
    if (!session.pendingAnswers.has(wsId)) {
      player.streak = 0;
      player.answers.push({
        questionIndex: session.currentQuestion,
        timeMs: session.config.timeLimit * 1000,
        correct: false,
        points: 0,
      });
      results.push({
        playerId: wsId,
        playerName: player.name,
        avatar: player.avatar,
        answer: "(no answer)",
        correct: false,
        points: 0,
        totalScore: player.score,
        streak: 0,
      });
    }
  }

  // Emit results
  transition(session, "reveal");
  emit(session.id, { type: "question_results", session, results });

  // Auto-advance: reveal → scoreboard → next question
  session.timer = setTimeout(() => {
    transition(session, "scoreboard");
    session.timer = setTimeout(async () => {
      await advanceToNextQuestion(session);
    }, SCOREBOARD_DURATION_MS);
  }, REVEAL_DURATION_MS);
}

function finishGame(session: GameSession): void {
  if (session.timer) {
    clearTimeout(session.timer);
    session.timer = null;
  }
  saveQuizLog();

  session.state = "finished";
  session.lastActivity = new Date();

  const rankings = getFinalRankings(session);

  // Award music picks IMMEDIATELY (synchronous — must happen before DJ Mode can activate)
  awardCredits(rankings);
  console.log(`🎮 Picks awarded to ${rankings.length} players`);

  // Complete round in Party context
  const party = getPartyBySessionId(session.id);
  if (party) {
    completeRound(party, session);
    transitionParty(party, "ceremony");
  }

  // Emit results first so UI shows podium
  emit(session.id, { type: "final_results", session, rankings });

  // Play Champions async — plays until DJ Mode takes over or admin stops it
  const victoryProvider = getProvider();
  if (victoryProvider.isAvailable()) {
    (async () => {
      try {
        const theme = THEME_SONGS.victory;
        const result = await victoryProvider.playExact(theme.name, theme.artist, { retries: 2 });
        if (!result.playing) {
          await victoryProvider.searchAndPlay(`${theme.name} ${theme.artist}`);
        }
      } catch {}
    })();
  }
}

export function endQuiz(sessionId: string): boolean {
  const session = sessions.get(sessionId);
  if (!session) return false;
  finishGame(session);
  return true;
}

export function skipQuestion(sessionId: string): boolean {
  const session = sessions.get(sessionId);
  if (!session || (session.state !== "playing" && session.state !== "countdown")) return false;
  if (session.timer) clearTimeout(session.timer);
  advanceToNextQuestion(session);
  return true;
}

// ─── Scoring ──────────────────────────────────────────────

export function calculatePoints(timeMs: number, timeLimitMs: number, streak: number): number {
  if (timeMs > timeLimitMs) return 0;

  // Base: 1000 points, falls linearly with time
  const timeRatio = 1 - (timeMs / timeLimitMs);
  const basePoints = Math.round(1000 * timeRatio);

  // Streak bonus: 1.5x after 3, 2x after 5
  const multiplier = streak >= 5 ? 2.0 : streak >= 3 ? 1.5 : 1.0;

  return Math.round(basePoints * multiplier);
}

// ─── Danish Language Detection ───────────────────────────

function looksLikeDanish(text: string): boolean {
  return /[æøåÆØÅ]/.test(text);
}

// ─── Multiple-Choice Options ──────────────────────────────

function generateOptions(
  question: { type: string; answer: string; songName: string; artistName: string; albumName: string; releaseYear: string },
  allQuestions: Array<{ songName: string; artistName: string; albumName: string; releaseYear: string }>,
): string[] {
  const correct = question.answer;
  const pool = new Set<string>();

  // Extract the RIGHT kind of value based on question type
  function extractValue(q: { songName: string; artistName: string; albumName: string; releaseYear: string }): string {
    switch (question.type) {
      case "guess-the-artist": return q.artistName;
      case "guess-the-song": return q.songName;
      case "guess-the-album": return q.albumName;
      case "guess-the-year": return q.releaseYear;
      case "intro-quiz": return `${q.songName} by ${q.artistName}`;
      default: return q.songName; // fallback to songs, never mix types
    }
  }

  // Collect wrong answers from other questions (same type!)
  for (const q of allQuestions) {
    const value = extractValue(q);
    if (value && value !== correct) pool.add(value);
  }

  // For guess-the-year, add nearby years if not enough options
  if (question.type === "guess-the-year" && pool.size < 3) {
    const year = parseInt(correct);
    const currentYear = new Date().getFullYear();
    if (!isNaN(year)) {
      for (const offset of [-3, -1, 1, 2, 3, -2, 4, -4]) {
        const candidate = year + offset;
        if (candidate <= currentYear) pool.add(String(candidate));
      }
    }
  }

  // Prefer Danish-looking wrong answers when the correct answer or song looks Danish
  const isDanish = looksLikeDanish(correct) || looksLikeDanish(question.songName) || looksLikeDanish(question.artistName);
  let poolArray = [...pool];
  if (isDanish && question.type !== "guess-the-year") {
    const danishPool = poolArray.filter(v => looksLikeDanish(v));
    const otherPool = poolArray.filter(v => !looksLikeDanish(v));
    // Danish first, then fill with others
    poolArray = [...shuffle(danishPool), ...shuffle(otherPool)];
  } else {
    poolArray = shuffle(poolArray);
  }

  // Pick 3 wrong answers
  const wrongs = poolArray.slice(0, 3);

  // Pad with well-known fallback names if pool is exhausted (e.g. single-artist playlist)
  const fallbacks: Record<string, string[]> = {
    "guess-the-artist": ["The Beatles", "Led Zeppelin", "Pink Floyd", "Queen", "Fleetwood Mac", "David Bowie", "Stevie Wonder", "Bob Marley", "Nirvana", "Radiohead", "U2", "Coldplay", "Adele", "Michael Jackson", "Prince"],
    "guess-the-song": ["Bohemian Rhapsody", "Imagine", "Hotel California", "Stairway to Heaven", "Billie Jean", "Smells Like Teen Spirit", "Wonderwall", "Hey Jude", "Purple Rain", "Superstition"],
    "guess-the-album": ["Abbey Road", "Thriller", "Dark Side of the Moon", "Rumours", "Back in Black", "OK Computer", "Nevermind", "The Wall", "Purple Rain", "Born to Run"],
    "guess-the-year": [],
  };
  const fb = shuffle(fallbacks[question.type] || fallbacks["guess-the-artist"]).filter(f => f !== correct && !wrongs.includes(f));
  while (wrongs.length < 3 && fb.length > 0) {
    wrongs.push(fb.shift()!);
  }

  // Shuffle correct answer into random position
  const options = [...wrongs, correct];
  return shuffle(options);
}

// ─── Custom Quiz Helpers ──────────────────────────────────

function generateQuestionText(type: string, t: { name: string; artistName: string; albumName: string }): string {
  const types = type === "mixed"
    ? ["guess-the-artist", "guess-the-song", "guess-the-album", "guess-the-year", "intro-quiz"]
    : [type];
  const picked = types[Math.floor(Math.random() * types.length)];

  switch (picked) {
    case "guess-the-artist": return "Which artist performs this song?";
    case "guess-the-song": return "What is the name of this song?";
    case "guess-the-album": return "Which album is this song from?";
    case "guess-the-year": return "In which year was this song released?";
    case "intro-quiz": return "Listen to the intro — name the song AND the artist!";
    default: return "Which artist performs this song?";
  }
}

function generateAnswer(type: string, t: { name: string; artistName: string; albumName: string; releaseYear?: string }): string {
  // For mixed type, derive the answer from the question text pattern
  switch (type) {
    case "guess-the-artist": return t.artistName;
    case "guess-the-song": return t.name;
    case "guess-the-album": return t.albumName;
    case "guess-the-year": return t.releaseYear || "unknown";
    case "intro-quiz": return `${t.name} by ${t.artistName}`;
    default: return t.artistName;
  }
}

// Unused but required by custom quiz path for type compatibility
function makeQuestion() {}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ─── Answer Mode Helper ───────────────────────────────────

function getAnswerModeForQuestion(session: GameSession): "multiple-choice" | "free-text" {
  const mode = session.config.answerMode;
  if (mode === "multiple-choice" || mode === "free-text") return mode;
  // Mixed: alternate between MC and free-text
  return session.currentQuestion % 2 === 0 ? "multiple-choice" : "free-text";
}

export function getAnswerModeForCurrentQuestion(session: GameSession): AnswerMode {
  return getAnswerModeForQuestion(session);
}

// ─── Public State Helpers ─────────────────────────────────

export function getHostQuestionData(session: GameSession, includeAnswer: boolean): HostQuestionData | undefined {
  const q = session.questions[session.currentQuestion];
  if (!q) return undefined;

  return {
    songId: q.songId,
    questionText: q.questionText,
    questionType: q.questionType,
    artworkUrl: q.artworkUrl,
    previewUrl: q.previewUrl,
    options: q.options,
    answerMode: getAnswerModeForQuestion(session),
    homeConnected: isHomeConnected(),
    isTrivia: q.isTrivia || false,
    funFact: includeAnswer ? q.funFact : undefined,
    ...(includeAnswer ? {
      correctAnswer: q.correctAnswer,
      songName: q.songName,
      artistName: q.artistName,
      albumName: q.albumName,
      releaseYear: q.releaseYear,
    } : {}),
  };
}

export function getPlayerRankings(session: GameSession): Array<{ rank: number; playerId: string; playerName: string; avatar: string; score: number; streak: number }> {
  const sorted = [...session.players.values()].sort((a, b) => b.score - a.score);
  return sorted.map((p, i) => ({
    rank: i + 1,
    playerId: p.id,
    playerName: p.name,
    avatar: p.avatar,
    score: p.score,
    streak: p.streak,
  }));
}

export function getFinalRankings(session: GameSession): FinalRanking[] {
  const sorted = [...session.players.values()].sort((a, b) => b.score - a.score);
  return sorted.map((p, i) => {
    const correctAnswers = p.answers.filter((a) => a.correct).length;
    const answeredQuestions = p.answers.filter((a) => a.timeMs < session.config.timeLimit * 1000).length;
    const totalTimeMs = p.answers.reduce((sum, a) => sum + a.timeMs, 0);
    let longestStreak = 0;
    let currentStreak = 0;
    for (const a of p.answers) {
      currentStreak = a.correct ? currentStreak + 1 : 0;
      longestStreak = Math.max(longestStreak, currentStreak);
    }

    return {
      rank: i + 1,
      playerId: p.id,
      playerName: p.name,
      avatar: p.avatar,
      totalScore: p.score,
      correctAnswers,
      totalAnswers: p.answers.length,
      longestStreak,
      averageTimeMs: answeredQuestions > 0 ? Math.round(totalTimeMs / answeredQuestions) : 0,
    };
  });
}

export function getPlayerCount(session: GameSession): { connected: number; total: number } {
  const total = session.players.size;
  const connected = [...session.players.values()].filter((p) => p.connected).length;
  return { connected, total };
}

export function listActiveSessions(): Array<{ id: string; joinCode: string; state: GameState; playerCount: number; questionCount: number }> {
  return [...sessions.values()]
    .filter((s) => s.state !== "finished")
    .map((s) => ({
      id: s.id,
      joinCode: s.joinCode,
      state: s.state,
      playerCount: s.players.size,
      questionCount: s.questions.length,
    }));
}

// Find which session a WebSocket belongs to (for disconnect handling)
export function findSessionByWsId(wsId: string): { session: GameSession; isHost: boolean } | undefined {
  for (const session of sessions.values()) {
    if (session.hostWsId === wsId) return { session, isHost: true };
    if (session.players.has(wsId)) return { session, isHost: false };
  }
  return undefined;
}
