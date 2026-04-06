/**
 * Quiz session state machine.
 * Manages active quizzes with participants, scoring, and phase transitions.
 */

import { randomUUID } from "node:crypto";
import type { Quiz, QuizQuestion } from "./quiz.js";

export type QuizPhase = "lobby" | "question" | "reveal" | "scores" | "finished";

export interface Participant {
  name: string;
  score: number;
}

export interface QuizSession {
  id: string;
  quiz: Quiz;
  participants: Participant[];
  currentQuestion: number;
  phase: QuizPhase;
  timerDuration: number;       // seconds per question
  timerEnd: number | null;     // unix ms when timer expires
  playOffset: number | null;   // random offset in seconds for current song
  createdAt: Date;
}

// ─── In-memory store ───────────────────────────────────────

const sessions = new Map<string, QuizSession>();

export function createQuizSession(quiz: Quiz, timerDuration = 30): QuizSession {
  const session: QuizSession = {
    id: randomUUID().slice(0, 8),
    quiz,
    participants: [],
    currentQuestion: -1,
    phase: "lobby",
    timerDuration,
    timerEnd: null,
    playOffset: null,
    createdAt: new Date(),
  };
  sessions.set(session.id, session);
  return session;
}

export function getQuizSession(id: string): QuizSession | undefined {
  return sessions.get(id);
}

export function addParticipant(id: string, name: string): QuizSession | undefined {
  const session = sessions.get(id);
  if (!session || session.phase !== "lobby") return undefined;
  if (!session.participants.find((p) => p.name === name)) {
    session.participants.push({ name, score: 0 });
  }
  return session;
}

export function removeParticipant(id: string, name: string): QuizSession | undefined {
  const session = sessions.get(id);
  if (!session || session.phase !== "lobby") return undefined;
  session.participants = session.participants.filter((p) => p.name !== name);
  return session;
}

function randomOffset(duration: number): number {
  // Play from 20-60% of song duration
  const min = Math.floor(duration * 0.2);
  const max = Math.floor(duration * 0.6);
  return min + Math.floor(Math.random() * (max - min));
}

export function nextQuestion(id: string): { session: QuizSession; question: QuizQuestion; offset: number } | undefined {
  const session = sessions.get(id);
  if (!session) return undefined;

  session.currentQuestion++;
  if (session.currentQuestion >= session.quiz.questions.length) {
    session.phase = "finished";
    session.timerEnd = null;
    return undefined;
  }

  const question = session.quiz.questions[session.currentQuestion];
  session.phase = "question";
  session.timerEnd = Date.now() + session.timerDuration * 1000;

  // Random offset: 20-60% of typical song duration (~210s)
  const songDuration = question.type === "intro-quiz" ? 0 : 210;
  session.playOffset = songDuration > 0 ? randomOffset(songDuration) : 0;

  return { session, question, offset: session.playOffset };
}

export function revealAnswer(id: string): { session: QuizSession; question: QuizQuestion } | undefined {
  const session = sessions.get(id);
  if (!session || session.phase !== "question") return undefined;

  session.phase = "reveal";
  session.timerEnd = null;
  const question = session.quiz.questions[session.currentQuestion];
  return { session, question };
}

export function stopQuiz(id: string): QuizSession | undefined {
  const session = sessions.get(id);
  if (!session) return undefined;
  session.phase = "finished";
  session.timerEnd = null;
  return session;
}

export function awardPoint(id: string, participantName: string): QuizSession | undefined {
  const session = sessions.get(id);
  if (!session) return undefined;

  const participant = session.participants.find(
    (p) => p.name.toLowerCase() === participantName.toLowerCase(),
  );
  if (participant) participant.score++;
  return session;
}

export function showScores(id: string): QuizSession | undefined {
  const session = sessions.get(id);
  if (!session) return undefined;
  session.phase = "scores";
  return session;
}

export function getPublicState(session: QuizSession) {
  const question = session.currentQuestion >= 0 && session.currentQuestion < session.quiz.questions.length
    ? session.quiz.questions[session.currentQuestion]
    : null;

  return {
    id: session.id,
    title: session.quiz.title,
    phase: session.phase,
    currentQuestion: session.currentQuestion + 1,
    totalQuestions: session.quiz.questionCount,
    participants: session.participants.sort((a, b) => b.score - a.score),
    timerEnd: session.timerEnd,
    timerDuration: session.timerDuration,
    // Only show question details, not the answer (unless reveal phase)
    question: question
      ? {
          questionNumber: question.questionNumber,
          type: question.type,
          question: question.question,
          songId: question.songId,
          difficulty: question.difficulty,
          // Answer only in reveal/finished phase
          ...(session.phase === "reveal" || session.phase === "finished" || session.phase === "scores"
            ? { answer: question.answer, songName: question.songName, artistName: question.artistName, albumName: question.albumName }
            : {}),
        }
      : null,
    playOffset: session.playOffset,
  };
}

export function listActiveSessions(): Array<{ id: string; title: string; phase: QuizPhase; participants: number }> {
  return [...sessions.values()]
    .filter((s) => s.phase !== "finished")
    .map((s) => ({
      id: s.id,
      title: s.quiz.title,
      phase: s.phase,
      participants: s.participants.length,
    }));
}
