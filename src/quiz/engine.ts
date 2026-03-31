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
  HostQuestionData, AnswerMode,
} from "./types.js";
import { generateQuiz, type QuizType as GenQuizType } from "../quiz.js";
import type { AppleMusicClient } from "../apple-music.js";
import { sendHomeCommand, isHomeConnected } from "../home-ws.js";
import { evaluateAnswers } from "./ai-evaluator.js";

// ─── Constants ────────────────────────────────────────────

const MAX_PLAYERS = 8;
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const JOIN_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1 confusion
const COUNTDOWN_MS = 3000;
const REVEAL_DURATION_MS = 6000;
const SCOREBOARD_DURATION_MS = 5000;

// ─── Session Store ────────────────────────────────────────

const sessions = new Map<string, GameSession>();
const joinCodeIndex = new Map<string, string>(); // joinCode → sessionId

// Track used song IDs across all sessions to avoid repeats during an evening
const usedSongIds = new Set<string>();

export function clearUsedSongs(): void {
  usedSongIds.clear();
  console.log("🎮 Cleared used songs list");
}

// Cleanup stale sessions every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastActivity.getTime() > SESSION_TIMEOUT_MS) {
      destroySession(id);
    }
  }
  // Clear used songs if no active sessions (new evening)
  if (sessions.size === 0) usedSongIds.clear();
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
): Promise<GameSession> {
  let quiz;

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
      count: config.questionCount,
      genre: config.genre,
      decade: config.decade,
      excludeSongIds: excludeIds,
    });
  }

  // Track used songs so they don't repeat across sessions
  for (const q of quiz.questions) {
    if (q.songId) usedSongIds.add(q.songId);
  }

  // Pre-load all songs to library
  const songIds = quiz.questions.map((q) => q.songId).filter(Boolean);
  if (songIds.length > 0 && musicClient.hasUserToken()) {
    musicClient.addToLibrary({ songs: songIds })
      .then(() => console.log(`🎮 Pre-loaded ${songIds.length} quiz songs to library`))
      .catch((err: Error) => console.error("🎮 Pre-load failed:", err));
  }

  // Build quiz questions with artwork and multiple-choice options
  const questions: QuizQuestion[] = await Promise.all(
    quiz.questions.map(async (q) => {
      // Resolve artwork
      let artworkUrl: string | undefined;
      let previewUrl: string | undefined;
      try {
        const result = (await musicClient.searchCatalog(`${q.songName} ${q.artistName}`, ["songs"], 1)) as {
          results?: { songs?: { data?: Array<{ attributes?: { artwork?: { url?: string }; previews?: Array<{ url?: string }> } }> } };
        };
        const song = result?.results?.songs?.data?.[0];
        if (song?.attributes?.artwork?.url) {
          artworkUrl = song.attributes.artwork.url.replace("{w}", "600").replace("{h}", "600");
        }
        previewUrl = song?.attributes?.previews?.[0]?.url;
      } catch {}

      // Generate multiple-choice options
      const options = generateOptions(q, quiz.questions);

      return {
        songId: q.songId,
        songName: q.songName,
        artistName: q.artistName,
        albumName: q.albumName,
        releaseYear: q.releaseYear,
        artworkUrl,
        previewUrl,
        questionText: q.question,
        correctAnswer: q.answer,
        options,
        questionType: q.type as QuizQuestion["questionType"],
        difficulty: q.difficulty,
      };
    }),
  );

  const joinCode = generateJoinCode();
  const sessionId = randomUUID().slice(0, 12);

  const session: GameSession = {
    id: sessionId,
    joinCode,
    hostWsId,
    players: new Map(),
    config,
    state: "lobby",
    currentQuestion: -1,
    questions,
    questionStartTime: 0,
    timer: null,
    pendingAnswers: new Map(),
    createdAt: new Date(),
    lastActivity: new Date(),
  };

  sessions.set(sessionId, session);
  joinCodeIndex.set(joinCode, sessionId);

  console.log(`🎮 Session created: ${joinCode} (${questions.length} questions)`);
  return session;
}

export function getSession(sessionId: string): GameSession | undefined {
  return sessions.get(sessionId);
}

export function getSessionByCode(joinCode: string): GameSession | undefined {
  const sessionId = joinCodeIndex.get(joinCode.toUpperCase());
  return sessionId ? sessions.get(sessionId) : undefined;
}

export function destroySession(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  if (session.timer) clearTimeout(session.timer);
  joinCodeIndex.delete(session.joinCode);
  sessions.delete(sessionId);
  console.log(`🎮 Session destroyed: ${session.joinCode}`);
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
  if (session.state !== "lobby") return { error: "Game already started" };
  if (session.players.size >= MAX_PLAYERS) return { error: "Game is full (max 8 players)" };

  // Check name uniqueness
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

  // Countdown phase
  transition(session, "countdown");

  session.timer = setTimeout(async () => {
    // Start playing
    session.pendingAnswers.clear();
    session.questionStartTime = Date.now();
    transition(session, "playing");

    // Play music via Home Controller
    playQuestionMusic(session);

    // Set timer for question end
    session.timer = setTimeout(() => {
      endQuestion(session);
    }, session.config.timeLimit * 1000);
  }, COUNTDOWN_MS);
}

async function playQuestionMusic(session: GameSession): Promise<void> {
  const q = session.questions[session.currentQuestion];
  if (!q) return;

  if (isHomeConnected()) {
    try {
      const simpleName = q.songName.replace(/\s*[\(\[].*?[\)\]]/g, "").trim();
      const artist = q.artistName.split(/[,&]/)[0].trim();

      for (const delay of [300, 1500, 3000]) {
        await new Promise((r) => setTimeout(r, delay));
        for (const query of [`${simpleName} ${artist}`, simpleName]) {
          const result = await sendHomeCommand("search-and-play", { query, artist, randomSeek: true }) as { playing?: string };
          if (result.playing) {
            console.log(`🎮 Playing: ${result.playing}`);
            return;
          }
        }
      }
      console.error(`🎮 All retries failed for: ${q.songName}`);
    } catch (err) {
      console.error("🎮 Playback failed:", err);
    }
  } else {
    console.log(`🎮 No Home Controller — preview fallback for: ${q.songName}`);
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
    session.timer = setTimeout(() => {
      advanceToNextQuestion(session);
    }, SCOREBOARD_DURATION_MS);
  }, REVEAL_DURATION_MS);
}

function finishGame(session: GameSession): void {
  if (session.timer) {
    clearTimeout(session.timer);
    session.timer = null;
  }

  session.state = "finished";
  session.lastActivity = new Date();

  const rankings = getFinalRankings(session);
  emit(session.id, { type: "final_results", session, rankings });
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
    if (!isNaN(year)) {
      for (const offset of [-3, -1, 1, 2, 3, -2, 4, -4]) {
        pool.add(String(year + offset));
      }
    }
  }

  // Pick 3 wrong answers
  const wrongs = shuffle([...pool]).slice(0, 3);

  // Pad if needed (shouldn't happen with 5+ questions)
  while (wrongs.length < 3) {
    wrongs.push("—");
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
