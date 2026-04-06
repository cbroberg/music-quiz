/**
 * Quiz Event Store
 *
 * Persists events (party evenings) to disk so they survive restarts.
 * Events can be scheduled, active, or completed.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export interface EventPlayer {
  name: string;
  avatar: string;
  totalScore: number;
  totalPicks: number;
}

export interface EventRound {
  number: number;
  questionCount: number;
  songCount: number;
  completedAt: string; // ISO date
}

export interface SavedEvent {
  id: string;
  name: string;
  status: "scheduled" | "active" | "completed";
  joinCode?: string;
  playlistId?: string;       // linked playlist for quiz source
  maxRounds?: number;        // 0 = unlimited (free), >0 = fixed rounds
  scheduledAt?: string;      // ISO date (optional, for scheduled events)
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  players: EventPlayer[];
  rounds: EventRound[];
  totalSongsPlayed: number;
}

function getStorePath(): string {
  const dataDir = process.env.TOKEN_FILE
    ? join(process.env.TOKEN_FILE, "..")
    : join(process.cwd(), "data");
  return join(dataDir, "quiz-events.json");
}

let events: SavedEvent[] = [];
let loaded = false;

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  try {
    const data = await readFile(getStorePath(), "utf-8");
    events = JSON.parse(data);
    console.log(`🎉 Loaded ${events.length} saved events`);
  } catch {
    events = [];
  }
  loaded = true;
}

async function persist(): Promise<void> {
  const path = getStorePath();
  try {
    await mkdir(join(path, ".."), { recursive: true });
  } catch {}
  await writeFile(path, JSON.stringify(events, null, 2));
}

export async function getAllEvents(): Promise<SavedEvent[]> {
  await ensureLoaded();
  return [...events];
}

export async function getEvent(id: string): Promise<SavedEvent | undefined> {
  await ensureLoaded();
  return events.find(e => e.id === id);
}

export async function createEvent(event: {
  name: string;
  playlistId?: string;
  scheduledAt?: string;
}): Promise<SavedEvent> {
  await ensureLoaded();
  const now = new Date().toISOString();
  const saved: SavedEvent = {
    id: crypto.randomUUID().slice(0, 12),
    name: event.name,
    status: event.scheduledAt ? "scheduled" : "active",
    playlistId: event.playlistId,
    scheduledAt: event.scheduledAt,
    createdAt: now,
    updatedAt: now,
    players: [],
    rounds: [],
    totalSongsPlayed: 0,
  };
  events.push(saved);
  await persist();
  console.log(`🎉 Created event "${saved.name}" (${saved.status})`);
  return saved;
}

export async function updateEvent(id: string, updates: Partial<Pick<SavedEvent, "name" | "status" | "joinCode" | "playlistId" | "maxRounds" | "scheduledAt" | "completedAt" | "players" | "rounds" | "totalSongsPlayed">>): Promise<SavedEvent | undefined> {
  await ensureLoaded();
  const event = events.find(e => e.id === id);
  if (!event) return undefined;

  // Only apply defined values (don't overwrite with undefined)
  for (const [key, val] of Object.entries(updates)) {
    if (val !== undefined) (event as unknown as Record<string, unknown>)[key] = val;
  }
  event.updatedAt = new Date().toISOString();
  await persist();
  return event;
}

export async function deleteEvent(id: string): Promise<boolean> {
  await ensureLoaded();
  const before = events.length;
  events = events.filter(e => e.id !== id);
  if (events.length < before) {
    await persist();
    return true;
  }
  return false;
}
