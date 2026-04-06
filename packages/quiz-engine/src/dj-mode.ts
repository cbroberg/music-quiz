/**
 * DJ Mode — Music Democracy
 *
 * Players earn "song credits" through quiz performance.
 * When host activates DJ Mode, players use credits to add songs to a shared queue.
 * Queue plays through Home Controller.
 */

import type { FinalRanking } from "@music-quiz/shared";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// ─── Persistent Credit Store ─────────────────────────────

const DJ_STATE_PATH = join(process.cwd(), "data", "dj-state.json");

interface StoredDjState {
  credits: { [playerName: string]: { total: number; used: number; avatar: string } };
  queue: QueuedSong[];
  currentIndex: number;
}

function loadDjState(): StoredDjState | null {
  try {
    return JSON.parse(readFileSync(DJ_STATE_PATH, "utf-8"));
  } catch {
    return null;
  }
}

function saveDjState(): void {
  const state: StoredDjState = {
    credits: {},
    queue: djSession.queue,
    currentIndex: djSession.currentIndex,
  };
  for (const [name, p] of djSession.players) {
    state.credits[name] = { total: p.totalCredits, used: p.usedCredits, avatar: p.avatar };
  }
  try {
    mkdirSync(join(process.cwd(), "data"), { recursive: true });
    writeFileSync(DJ_STATE_PATH, JSON.stringify(state, null, 2));
  } catch {}
}

function restoreDjState(): void {
  const stored = loadDjState();
  if (!stored) return;
  // Restore credits
  for (const [name, c] of Object.entries(stored.credits)) {
    djSession.players.set(name, {
      name, avatar: c.avatar,
      totalCredits: c.total, usedCredits: c.used,
      availableCredits: c.total - c.used,
    });
  }
  // Restore queue
  if (stored.queue?.length > 0) {
    djSession.queue = stored.queue;
    djSession.currentIndex = stored.currentIndex ?? -1;
    queueIdCounter = Math.max(0, ...stored.queue.map(q => parseInt(q.id) || 0));
  }
  const playerCount = Object.keys(stored.credits).length;
  const queueCount = stored.queue?.filter(q => !q.played).length || 0;
  if (playerCount > 0 || queueCount > 0) {
    console.log(`🎧 Restored: ${playerCount} players, ${queueCount} songs in queue`);
  }
}

// ─── Song Credits ─────────────────────────────────────────

export interface PlayerCredits {
  name: string;
  avatar: string;
  totalCredits: number;
  usedCredits: number;
  availableCredits: number;
}

export interface QueuedSong {
  id: string;
  songId: string;
  name: string;
  artistName: string;
  albumName: string;
  artworkUrl?: string;
  addedBy: string;       // player name
  addedByAvatar: string;
  played: boolean;
}

export interface DjSession {
  active: boolean;
  players: Map<string, PlayerCredits>;
  queue: QueuedSong[];
  currentIndex: number;  // -1 = not started
  isPlaying: boolean;
  autoplay: boolean;
}

// ─── Singleton DJ Session ─────────────────────────────────

const djSession: DjSession = {
  active: true,  // Always active — DJ is just a queue
  players: new Map(),
  queue: [],
  currentIndex: -1,
  isPlaying: false,
  autoplay: true,
};

// restoreDjState() called after queueIdCounter is declared (below)

// ─── Credit Calculation ──────────────────────────────────

const CREDITS_BY_RANK: Record<number, number> = {
  1: 5,
  2: 3,
  3: 2,
};
const DEFAULT_CREDITS = 1;
const STREAK_BONUS_THRESHOLD = 3;

/** Calculate picks for a given rank + streak (without awarding) */
export function calculateCreditsForRank(rank: number, longestStreak: number): number {
  const baseCredits = CREDITS_BY_RANK[rank] ?? DEFAULT_CREDITS;
  const streakBonus = longestStreak >= STREAK_BONUS_THRESHOLD ? 1 : 0;
  return baseCredits + streakBonus;
}

export function awardCredits(rankings: FinalRanking[]): void {
  for (const r of rankings) {
    const baseCredits = CREDITS_BY_RANK[r.rank] ?? DEFAULT_CREDITS;
    const streakBonus = r.longestStreak >= STREAK_BONUS_THRESHOLD ? 1 : 0;
    const earned = baseCredits + streakBonus;

    const existing = djSession.players.get(r.playerName);
    if (existing) {
      existing.totalCredits += earned;
      existing.availableCredits += earned;
      existing.avatar = r.avatar;
    } else {
      djSession.players.set(r.playerName, {
        name: r.playerName,
        avatar: r.avatar,
        totalCredits: earned,
        usedCredits: 0,
        availableCredits: earned,
      });
    }
    console.log(`🎧 ${r.avatar} ${r.playerName}: +${earned} credits (rank #${r.rank}${streakBonus ? ', streak bonus' : ''})`);
  }
  saveDjState();
}

// ─── DJ Mode Control ──────────────────────────────────────

export function activateDjMode(): DjSession {
  // DJ is always active — this just resets playback state for a fresh round
  djSession.active = true;
  djSession.isPlaying = false;
  djSession.currentIndex = -1;
  console.log(`🎧 DJ ready — ${djSession.players.size} players, ${getTotalAvailableCredits()} credits available`);
  return djSession;
}

export function deactivateDjMode(): void {
  djSession.active = false;
  djSession.isPlaying = false;
  console.log("🎧 DJ Mode deactivated");
}

export function isDjModeActive(): boolean {
  return djSession.active;
}

export function getDjSession(): DjSession {
  return djSession;
}

export function getPlayerCredits(playerName: string): PlayerCredits | undefined {
  return djSession.players.get(playerName);
}

export function getAllPlayerCredits(): PlayerCredits[] {
  return [...djSession.players.values()].sort((a, b) => b.availableCredits - a.availableCredits);
}

function getTotalAvailableCredits(): number {
  let total = 0;
  for (const p of djSession.players.values()) total += p.availableCredits;
  return total;
}

// ─── Queue Management ─────────────────────────────────────

let queueIdCounter = 0;

// Restore DJ state from disk (must be after queueIdCounter declaration)
restoreDjState();

/** Admin adds directly to queue (no credit check) */
export function addToQueueDirect(
  name: string, artistName: string, songId: string, albumName?: string, artworkUrl?: string,
): QueuedSong | null {
  if (!djSession.active) return null;
  if (djSession.queue.some(q => q.songId === songId && !q.played)) return null; // dupe check

  const queued: QueuedSong = {
    id: String(++queueIdCounter),
    songId,
    name,
    artistName,
    albumName: albumName || "",
    artworkUrl,
    addedBy: "DJ",
    addedByAvatar: "🎧",
    played: false,
  };
  djSession.queue.push(queued);
  saveDjState();
  console.log(`🎧 DJ added: "${name}" by ${artistName}`);

  // Auto-play if nothing playing
  if (!djSession.isPlaying && djSession.currentIndex < 0) {
    djSession.isPlaying = true;
  }
  return queued;
}

export function addToQueue(
  playerName: string,
  song: { songId: string; name: string; artistName: string; albumName: string; artworkUrl?: string },
): { success: boolean; error?: string; queue?: QueuedSong[]; autoPlay?: boolean } {
  const player = djSession.players.get(playerName);
  if (!player) return { success: false, error: "Player not found" };
  if (player.availableCredits <= 0) return { success: false, error: "No credits left" };
  if (!djSession.active) return { success: false, error: "DJ Mode not active" };

  // Check duplicate
  if (djSession.queue.some(q => q.songId === song.songId && !q.played)) {
    return { success: false, error: "Song already in queue" };
  }

  player.availableCredits--;
  player.usedCredits++;
  saveDjState();

  const queued: QueuedSong = {
    id: String(++queueIdCounter),
    songId: song.songId,
    name: song.name,
    artistName: song.artistName,
    albumName: song.albumName,
    artworkUrl: song.artworkUrl,
    addedBy: playerName,
    addedByAvatar: player.avatar,
    played: false,
  };

  // Insert: shuffle among unplayed songs (not before currently playing)
  const unplayedStart = djSession.currentIndex + 1;
  const unplayed = djSession.queue.filter((q, i) => !q.played && i >= unplayedStart);
  // Insert at random position among unplayed
  const insertIdx = unplayedStart + Math.floor(Math.random() * (unplayed.length + 1));
  djSession.queue.splice(insertIdx, 0, queued);

  console.log(`🎧 ${player.avatar} ${playerName} queued "${song.name}" (${player.availableCredits} credits left)`);

  // Auto-play only the very first song — after that, polling handles advancement
  const shouldAutoPlay = !djSession.isPlaying && djSession.currentIndex < 0;
  if (shouldAutoPlay) djSession.isPlaying = true; // prevent duplicate autoPlay triggers

  return { success: true, queue: djSession.queue, autoPlay: shouldAutoPlay };
}

export function setAutoplay(on: boolean): void {
  djSession.autoplay = on;
  console.log(`🎧 Autoplay: ${on}`);
}

export function isAutoplay(): boolean {
  return djSession.autoplay;
}

export function getPlayerQueueCount(playerName: string): number {
  return djSession.queue.filter(q => q.addedBy === playerName && !q.played).length;
}

export function getQueue(): QueuedSong[] {
  return djSession.queue;
}

export function getUpcoming(): QueuedSong[] {
  return djSession.queue.filter(q => !q.played);
}

export function getCurrentSong(): QueuedSong | undefined {
  if (djSession.currentIndex < 0) return undefined;
  return djSession.queue[djSession.currentIndex];
}

export function advanceQueue(): QueuedSong | undefined {
  // Mark current as played
  if (djSession.currentIndex >= 0 && djSession.queue[djSession.currentIndex]) {
    djSession.queue[djSession.currentIndex].played = true;
  }

  // Find next unplayed
  const nextIdx = djSession.queue.findIndex((q, i) => i > djSession.currentIndex && !q.played);
  if (nextIdx === -1) {
    djSession.isPlaying = false;
    saveDjState();
    return undefined;
  }

  djSession.currentIndex = nextIdx;
  djSession.isPlaying = true;
  saveDjState();
  return djSession.queue[nextIdx];
}

/** Mark current song as failed — revert played state so it can be retried */
export function markCurrentFailed(): void {
  if (djSession.currentIndex >= 0 && djSession.queue[djSession.currentIndex]) {
    console.log(`🎧 Playback failed: "${djSession.queue[djSession.currentIndex].name}" — will retry`);
    // Don't mark as played — leave it for retry
    djSession.isPlaying = false;
  }
}

export function removeFromQueue(songQueueId: string): boolean {
  const idx = djSession.queue.findIndex(q => q.id === songQueueId && !q.played);
  if (idx === -1) return false;

  const song = djSession.queue[idx];
  // Refund pick to player
  const player = djSession.players.get(song.addedBy);
  if (player) {
    player.availableCredits++;
    player.usedCredits--;
  }

  djSession.queue.splice(idx, 1);
  // Adjust currentIndex if needed
  if (idx <= djSession.currentIndex) djSession.currentIndex--;
  return true;
}

export function resetDjMode(): void {
  djSession.active = true;  // DJ always active
  // Keep players/credits — they persist across rounds and restarts
  djSession.queue = [];
  djSession.currentIndex = -1;
  djSession.isPlaying = false;
  djSession.autoplay = true;
  queueIdCounter = 0;
  console.log("🎧 DJ queue reset (credits preserved)");
}
