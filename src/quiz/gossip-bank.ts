/**
 * Gossip Question Bank
 *
 * Separate from trivia bank — gossip has time-limited relevance (expiresAfter).
 * Categories: breakup, controversy, dating, scandal, military, beef, legal, career.
 * Follows question-bank.ts pattern.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export type GossipCategory =
  | "breakup"
  | "controversy"
  | "dating"
  | "scandal"
  | "military"
  | "beef"
  | "legal"
  | "career";

export interface GossipQuestion {
  id: string;
  questionType: "gossip";
  questionText: string;
  correctAnswer: string;
  options: string[];
  artistName: string;
  funFact?: string;
  difficulty: "easy" | "medium" | "hard";
  backgroundSongName?: string;
  backgroundArtist?: string;
  backgroundSongId?: string;
  // Gossip-specific fields
  gossipDate: string;        // e.g. "2024-05"
  category: GossipCategory;
  expiresAfter: string;      // e.g. "2027-01" — after this date, question is stale
  // Metadata
  timesUsed: number;
  createdAt: string;
}

function getStorePath(): string {
  // Always use data/ dir in project root (persisted in repo)
  // TOKEN_FILE is for auth tokens only, NOT for question data
  const dataDir = join(process.cwd(), "data");
  return join(dataDir, "quiz-gossip-bank.json");
}

let bank: GossipQuestion[] = [];
let loaded = false;

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  try {
    const storePath = getStorePath();
    console.log(`🗞️ Gossip bank path: ${storePath}`);
    const data = await readFile(storePath, "utf-8");
    bank = JSON.parse(data);
    console.log(`🗞️ Gossip bank loaded: ${bank.length} questions`);
  } catch (err) {
    console.log(`🗞️ Gossip bank not found or error: ${(err as Error).message}`);
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

/** Save gossip questions to the bank */
export async function saveGossipQuestions(
  questions: Omit<GossipQuestion, "id" | "timesUsed" | "createdAt">[]
): Promise<void> {
  await ensureLoaded();
  const now = new Date().toISOString();
  for (const q of questions) {
    bank.push({
      ...q,
      id: randomUUID().slice(0, 8),
      timesUsed: 0,
      createdAt: now,
    });
  }
  await persist();
  console.log(`🗞️ Saved ${questions.length} gossip questions (total: ${bank.length})`);
}

/** Get random non-expired gossip questions */
export async function getRandomGossipQuestions(count: number): Promise<GossipQuestion[]> {
  await ensureLoaded();

  // Filter out expired gossip
  const now = new Date().toISOString().slice(0, 7); // "2026-04"
  const active = bank.filter(q => !q.expiresAfter || q.expiresAfter > now);

  if (active.length === 0) return [];

  // Prefer less-used questions
  const sorted = [...active].sort((a, b) => a.timesUsed - b.timesUsed);
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

/** Get total count (active only) */
export async function getGossipBankSize(): Promise<number> {
  await ensureLoaded();
  const now = new Date().toISOString().slice(0, 7);
  return bank.filter(q => !q.expiresAfter || q.expiresAfter > now).length;
}

/** Get total count including expired */
export async function getGossipBankTotalSize(): Promise<number> {
  await ensureLoaded();
  return bank.length;
}
