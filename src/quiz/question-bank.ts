/**
 * Global Question Bank
 *
 * Persists ALL AI-generated trivia questions to disk.
 * Grows with every quiz anyone runs — shared across events, sessions, future users.
 * Follows playlist-store.ts pattern.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export interface BankedQuestion {
  id: string;
  questionType: string;
  questionText: string;
  correctAnswer: string;
  options: string[];
  artistName: string;
  funFact?: string;
  difficulty: "easy" | "medium" | "hard";
  // Background song for playback during trivia
  backgroundSongName?: string;
  backgroundArtist?: string;
  backgroundSongId?: string;
  // Metadata
  validated: boolean;       // true = passed Sonnet fact-check
  timesUsed: number;
  createdAt: string;
}

function getStorePath(): string {
  // Always use data/ dir in project root (persisted in repo)
  // TOKEN_FILE is for auth tokens only, NOT for question data
  const dataDir = join(process.cwd(), "data");
  return join(dataDir, "quiz-question-bank.json");
}

let bank: BankedQuestion[] = [];
let loaded = false;

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  try {
    const data = await readFile(getStorePath(), "utf-8");
    bank = JSON.parse(data);
    console.log(`🧠 Question bank loaded: ${bank.length} questions`);
  } catch {
    bank = [];
  }
  loaded = true;
}

async function persist(): Promise<void> {
  const path = getStorePath();
  try {
    await mkdir(join(path, ".."), { recursive: true });
  } catch {}
  await writeFile(path, JSON.stringify(bank, null, 2));
}

/** Save multiple questions to the bank (called after AI generation) */
export async function saveQuestions(questions: Omit<BankedQuestion, "id" | "validated" | "timesUsed" | "createdAt">[]): Promise<void> {
  await ensureLoaded();
  const now = new Date().toISOString();
  for (const q of questions) {
    bank.push({
      ...q,
      id: randomUUID().slice(0, 8),
      validated: true,
      timesUsed: 0,
      createdAt: now,
    });
  }
  await persist();
  console.log(`🧠 Saved ${questions.length} questions to bank (total: ${bank.length})`);
}

/** Get random questions from the bank for reuse */
export async function getRandomQuestions(count: number): Promise<BankedQuestion[]> {
  await ensureLoaded();
  const validOnly = bank.filter(q => q.validated !== false);
  if (validOnly.length === 0) return [];

  // Shuffle and pick — prefer less-used questions
  const sorted = [...validOnly].sort((a, b) => a.timesUsed - b.timesUsed);
  const pool = sorted.slice(0, Math.max(count * 3, sorted.length));
  const shuffled = pool.sort(() => Math.random() - 0.5);
  const picked = shuffled.slice(0, Math.min(count, shuffled.length));

  // Mark as used
  for (const q of picked) {
    const original = bank.find(b => b.id === q.id);
    if (original) original.timesUsed++;
  }
  await persist();

  return picked;
}

/** Get total count */
export async function getBankSize(): Promise<number> {
  await ensureLoaded();
  return bank.length;
}
