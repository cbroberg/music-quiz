/**
 * Types for the multiplayer music quiz engine.
 */

// ─── Party States ─────────────────────────────────────────

export type PartyState =
  | "playlist"     // default — music playing, players browse queue
  | "lobby"        // round about to start, players joining
  | "quiz"         // questions active
  | "ceremony";    // results, Champions, picks awarded

// ─── Game States (within a Round) ─────────────────────────

export type GameState =
  | "lobby"        // waiting for players to join
  | "countdown"    // 3-2-1 before question
  | "playing"      // music playing, players answering
  | "evaluating"   // AI evaluating free-text answers
  | "reveal"       // showing correct answer + points
  | "scoreboard"   // showing rankings between questions
  | "finished";    // game over — final scoreboard

export type QuizType =
  | "guess-the-artist"
  | "guess-the-song"
  | "guess-the-album"
  | "guess-the-year"
  | "intro-quiz"
  // Trivia types (music plays as background, answer is not about the song)
  | "country-of-origin"
  | "band-members"
  | "artist-trivia"
  | "film-soundtrack"
  | "tv-theme"
  // Gossip (time-limited trivia with expiry dates)
  | "gossip"
  | "mixed";

export type AnswerMode = "multiple-choice" | "free-text" | "mixed";

// ─── Player ───────────────────────────────────────────────

export interface Player {
  id: string;          // WebSocket connection ID
  name: string;        // max 12 chars
  avatar: string;      // emoji
  score: number;
  streak: number;      // consecutive correct answers
  connected: boolean;
  answers: PlayerAnswer[];
}

export interface PlayerAnswer {
  questionIndex: number;
  answerIndex?: number;    // multiple-choice
  text?: string;           // free-text
  timeMs: number;          // time to answer in ms
  correct: boolean;
  points: number;
  aiExplanation?: string;  // AI evaluation note
}

// ─── Quiz Config ──────────────────────────────────────────

export interface QuizConfig {
  questionCount: number;    // 5-25
  timeLimit: number;        // seconds per question (10-60)
  quizType: QuizType;
  source: string;
  genre?: string;
  decade?: string;
  answerMode: AnswerMode;
  excludeRecentPlays?: boolean;
  includeGossip?: boolean;
  customTracks?: Array<{ id: string; name: string; artistName: string; albumName: string; releaseYear: string; artworkUrl?: string; previewUrl?: string }>;
  customName?: string;
}

// ─── Quiz Question ────────────────────────────────────────

export interface QuizQuestion {
  songId: string;
  songName: string;
  artistName: string;
  albumName: string;
  releaseYear: string;
  artworkUrl?: string;       // Apple Music artwork URL
  previewUrl?: string;       // 30s preview fallback
  questionText: string;
  correctAnswer: string;
  options: string[];          // 4 choices for multiple-choice
  questionType: QuizType;
  difficulty: "easy" | "medium" | "hard";
  // Trivia fields (music plays but answer is not about the song)
  isTrivia?: boolean;           // true = answer is not about the playing song
  backgroundSongId?: string;    // song to play as background for trivia
  backgroundSongName?: string;
  backgroundArtist?: string;
  funFact?: string;             // AI-generated fact shown during reveal
}

// ─── Game Session ─────────────────────────────────────────

export interface WaitingPlayer {
  wsId: string;
  name: string;
  avatar: string;
}

// ─── Party (the evening) ──────────────────────────────────

export interface Party {
  id: string;
  name: string;                  // event name (e.g. "Friday Night Quiz", "Family Game Night")
  createdAt: Date;
  joinCode: string;              // one code for the entire evening
  players: Map<string, Player>;  // persist across rounds
  waitingPlayers: WaitingPlayer[];
  currentRound: number;          // 0 = no active round
  rounds: CompletedRound[];      // history of finished rounds
  state: PartyState;
  activeSessionId: string | null; // current GameSession id (during lobby/quiz/ceremony)
  hostWsId: string | null;
}

export interface CompletedRound {
  number: number;
  config: QuizConfig;
  questions: QuizQuestion[];
  rankings: FinalRanking[];
  completedAt: Date;
}

// ─── Game Session (a single Round within a Party) ─────────

export interface GameSession {
  id: string;                    // UUID for internal use
  joinCode: string;              // 6-char alphanumeric (e.g. "ROCK42")
  hostWsId: string | null;       // WebSocket ID of host
  players: Map<string, Player>;  // keyed by WebSocket ID
  waitingPlayers: WaitingPlayer[]; // players who arrived while game in progress
  config: QuizConfig;
  state: GameState;
  currentQuestion: number;       // -1 = not started
  questions: QuizQuestion[];
  alternatives: QuizQuestion[];  // backup questions to replace failed songs
  questionStartTime: number;     // Date.now() when question started
  timer: ReturnType<typeof setTimeout> | null;
  pendingAnswers: Map<string, PendingAnswer>;  // answers waiting for evaluation
  createdAt: Date;
  lastActivity: Date;
}

export interface PendingAnswer {
  playerId: string;
  playerName: string;
  answerIndex?: number;
  text?: string;
  timeMs: number;
}

// ─── Scoring ──────────────────────────────────────────────

export interface QuestionResult {
  playerId: string;
  playerName: string;
  avatar: string;
  answer: string;
  correct: boolean;
  points: number;
  totalScore: number;
  streak: number;
  aiExplanation?: string;
}

export interface FinalRanking {
  rank: number;
  playerId: string;
  playerName: string;
  avatar: string;
  totalScore: number;
  correctAnswers: number;
  totalAnswers: number;
  longestStreak: number;
  averageTimeMs: number;
}

// ─── WebSocket Messages ───────────────────────────────────

// Host → Server
export type HostMessage =
  | { type: "create_session"; config: QuizConfig }
  | { type: "start_quiz" }
  | { type: "next_question" }
  | { type: "skip_question" }
  | { type: "end_quiz" }
  | { type: "kick_player"; playerId: string }
  | { type: "activate_dj" }
  | { type: "deactivate_dj" }
  | { type: "dj_next" }
  | { type: "dj_play_current" }
  | { type: "dj_remove"; songQueueId: string }
  | { type: "dj_autoplay"; enabled: boolean }
  | { type: "dj_status" }
  | { type: "end_party" }
  | { type: "set_provider"; provider: string };

// Player → Server
export type PlayerMessage =
  | { type: "join_session"; joinCode: string; name: string; avatar: string }
  | { type: "submit_answer"; questionIndex: number; answerIndex: number; timeMs: number }
  | { type: "submit_text_answer"; questionIndex: number; text: string; timeMs: number }
  | { type: "dj_add_song"; songId: string; name: string; artistName: string; albumName: string; artworkUrl?: string };

// Server → Host
export type ServerToHostMessage =
  | { type: "session_created"; sessionId: string; joinCode: string; joinUrl: string }
  | { type: "player_joined"; player: { id: string; name: string; avatar: string } }
  | { type: "player_left"; playerId: string; playerName: string }
  | { type: "game_state"; state: GameState; question?: HostQuestionData; timeLimit?: number; questionNumber?: number; totalQuestions?: number }
  | { type: "answer_received"; playerId: string; playerName: string; total: number; expected: number }
  | { type: "evaluating_answers" }
  | { type: "question_results"; results: QuestionResult[]; correctAnswer: string; question: HostQuestionData }
  | { type: "final_results"; rankings: FinalRanking[] }
  | { type: "error"; message: string };

// Server → Player
export type ServerToPlayerMessage =
  | { type: "joined"; sessionId: string; player: { id: string; name: string; avatar: string }; players: Array<{ id: string; name: string; avatar: string }> }
  | { type: "player_joined"; player: { id: string; name: string; avatar: string } }
  | { type: "player_left"; playerId: string; playerName: string }
  | { type: "game_state"; state: GameState; options?: string[]; timeLimit?: number; questionNumber?: number; totalQuestions?: number; questionType?: QuizType; questionText?: string; answerMode?: AnswerMode; artworkUrl?: string }
  | { type: "answer_result"; correct: boolean; points: number; totalScore: number; rank: number; streak: number; aiExplanation?: string; correctAnswer: string; artistName?: string; releaseYear?: string; funFact?: string }
  | { type: "scoreboard"; rankings: Array<{ rank: number; playerId: string; playerName: string; avatar: string; score: number; streak: number }> }
  | { type: "final_result"; rank: number; totalScore: number; stats: { correctAnswers: number; totalAnswers: number; longestStreak: number; averageTimeMs: number } }
  | { type: "error"; message: string };

// Question data sent to host (includes artwork, no correct answer during playing)
export interface HostQuestionData {
  songId: string;
  questionText: string;
  questionType: QuizType;
  artworkUrl?: string;
  previewUrl?: string;       // 30s Apple Music preview (fallback when no Home Controller)
  options: string[];
  answerMode: AnswerMode;
  homeConnected?: boolean;   // whether Home Controller is available
  isTrivia?: boolean;        // trivia question — answer not about the playing song
  funFact?: string;          // AI fun fact shown during reveal
  // Only included in reveal/results
  correctAnswer?: string;
  songName?: string;
  artistName?: string;
  albumName?: string;
  releaseYear?: string;
}

// ─── AI Evaluator ─────────────────────────────────────────

export interface AnswerEvaluation {
  playerId: string;
  isCorrect: boolean;
  confidence: number;        // 0-1
  explanation?: string;       // "Close enough — Fleetwood Mac accepted for Fleetwood"
}
