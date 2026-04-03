/**
 * DJ Mode — Music Democracy
 *
 * Players earn "music picks" through quiz performance.
 * When host activates DJ Mode, players use picks to add songs to a shared queue.
 * Queue plays through Home Controller.
 */

import type { FinalRanking } from "./types.js";

// ─── Music Picks ──────────────────────────────────────────

export interface PlayerPicks {
  name: string;
  avatar: string;
  totalPicks: number;
  usedPicks: number;
  availablePicks: number;
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
  players: Map<string, PlayerPicks>;
  queue: QueuedSong[];
  currentIndex: number;  // -1 = not started
  isPlaying: boolean;
  autoplay: boolean;
}

// ─── Singleton DJ Session ─────────────────────────────────

const djSession: DjSession = {
  active: false,
  players: new Map(),
  queue: [],
  currentIndex: -1,
  isPlaying: false,
  autoplay: true,
};

// ─── Pick Calculation ─────────────────────────────────────

const PICKS_BY_RANK: Record<number, number> = {
  1: 5,
  2: 3,
  3: 2,
};
const DEFAULT_PICKS = 1;
const STREAK_BONUS_THRESHOLD = 3;

/** Calculate picks for a given rank + streak (without awarding) */
export function calculatePicksForRank(rank: number, longestStreak: number): number {
  const basePicks = PICKS_BY_RANK[rank] ?? DEFAULT_PICKS;
  const streakBonus = longestStreak >= STREAK_BONUS_THRESHOLD ? 1 : 0;
  return basePicks + streakBonus;
}

export function awardPicks(rankings: FinalRanking[]): void {
  for (const r of rankings) {
    const basePicks = PICKS_BY_RANK[r.rank] ?? DEFAULT_PICKS;
    const streakBonus = r.longestStreak >= STREAK_BONUS_THRESHOLD ? 1 : 0;
    const earned = basePicks + streakBonus;

    const existing = djSession.players.get(r.playerName);
    if (existing) {
      existing.totalPicks += earned;
      existing.availablePicks += earned;
      existing.avatar = r.avatar;
    } else {
      djSession.players.set(r.playerName, {
        name: r.playerName,
        avatar: r.avatar,
        totalPicks: earned,
        usedPicks: 0,
        availablePicks: earned,
      });
    }
    console.log(`🎧 ${r.avatar} ${r.playerName}: +${earned} picks (rank #${r.rank}${streakBonus ? ', streak bonus' : ''})`);
  }
}

// ─── DJ Mode Control ──────────────────────────────────────

export function activateDjMode(): DjSession {
  djSession.active = true;
  djSession.isPlaying = false;
  djSession.currentIndex = -1;
  console.log(`🎧 DJ Mode activated — ${djSession.players.size} players, ${getTotalAvailablePicks()} picks available`);
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

export function getPlayerPicks(playerName: string): PlayerPicks | undefined {
  return djSession.players.get(playerName);
}

export function getAllPlayerPicks(): PlayerPicks[] {
  return [...djSession.players.values()].sort((a, b) => b.availablePicks - a.availablePicks);
}

function getTotalAvailablePicks(): number {
  let total = 0;
  for (const p of djSession.players.values()) total += p.availablePicks;
  return total;
}

// ─── Queue Management ─────────────────────────────────────

let queueIdCounter = 0;

export function addToQueue(
  playerName: string,
  song: { songId: string; name: string; artistName: string; albumName: string; artworkUrl?: string },
): { success: boolean; error?: string; queue?: QueuedSong[]; autoPlay?: boolean } {
  const player = djSession.players.get(playerName);
  if (!player) return { success: false, error: "Player not found" };
  if (player.availablePicks <= 0) return { success: false, error: "No picks left" };
  if (!djSession.active) return { success: false, error: "DJ Mode not active" };

  // Check duplicate
  if (djSession.queue.some(q => q.songId === song.songId && !q.played)) {
    return { success: false, error: "Song already in queue" };
  }

  player.availablePicks--;
  player.usedPicks++;

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

  console.log(`🎧 ${player.avatar} ${playerName} queued "${song.name}" (${player.availablePicks} picks left)`);

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
    return undefined;
  }

  djSession.currentIndex = nextIdx;
  djSession.isPlaying = true;
  return djSession.queue[nextIdx];
}

export function removeFromQueue(songQueueId: string): boolean {
  const idx = djSession.queue.findIndex(q => q.id === songQueueId && !q.played);
  if (idx === -1) return false;

  const song = djSession.queue[idx];
  // Refund pick to player
  const player = djSession.players.get(song.addedBy);
  if (player) {
    player.availablePicks++;
    player.usedPicks--;
  }

  djSession.queue.splice(idx, 1);
  // Adjust currentIndex if needed
  if (idx <= djSession.currentIndex) djSession.currentIndex--;
  return true;
}

export function resetDjMode(): void {
  djSession.active = false;
  djSession.players.clear();
  djSession.queue = [];
  djSession.currentIndex = -1;
  djSession.isPlaying = false;
  djSession.autoplay = true;
  queueIdCounter = 0;
  console.log("🎧 DJ Mode reset");
}
