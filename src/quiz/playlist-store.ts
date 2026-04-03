/**
 * Custom Quiz Playlist Store
 *
 * Persists curated playlists to disk so they survive restarts.
 * Stored as JSON in the data directory (Fly.io volume or /tmp locally).
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export interface PlaylistTrack {
  id: string;
  name: string;
  artistName: string;
  albumName: string;
  releaseYear: string;
  artworkUrl?: string;
  previewUrl?: string;
}

export interface SavedPlaylist {
  id: string;
  name: string;
  tracks: PlaylistTrack[];
  createdAt: string;     // ISO date
  updatedAt: string;
}

function getStorePath(): string {
  const dataDir = process.env.TOKEN_FILE
    ? join(process.env.TOKEN_FILE, "..")
    : join(process.cwd(), "data");
  return join(dataDir, "quiz-playlists.json");
}

let playlists: SavedPlaylist[] = [];
let loaded = false;

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  try {
    const data = await readFile(getStorePath(), "utf-8");
    playlists = JSON.parse(data);
    console.log(`🎵 Loaded ${playlists.length} saved quiz playlists`);
  } catch {
    playlists = [];
  }
  loaded = true;
}

async function persist(): Promise<void> {
  const path = getStorePath();
  try {
    await mkdir(join(path, ".."), { recursive: true });
  } catch {}
  await writeFile(path, JSON.stringify(playlists, null, 2));
}

export async function getAllPlaylists(): Promise<SavedPlaylist[]> {
  await ensureLoaded();
  return playlists.map(p => ({ ...p, tracks: p.tracks }));
}

export async function getPlaylist(id: string): Promise<SavedPlaylist | undefined> {
  await ensureLoaded();
  return playlists.find(p => p.id === id);
}

export async function savePlaylist(playlist: { id?: string; name: string; tracks: PlaylistTrack[] }): Promise<SavedPlaylist> {
  await ensureLoaded();

  // Allow custom ID (e.g. for favorites)
  const id = playlist.id || crypto.randomUUID().slice(0, 8);
  // Don't create duplicate if ID already exists
  if (playlist.id && playlists.find(p => p.id === id)) {
    return playlists.find(p => p.id === id)!;
  }

  const now = new Date().toISOString();
  const saved: SavedPlaylist = {
    id,
    name: playlist.name,
    tracks: playlist.tracks,
    createdAt: now,
    updatedAt: now,
  };

  playlists.push(saved);
  await persist();
  console.log(`🎵 Saved playlist "${saved.name}" (${saved.tracks.length} tracks)`);
  return saved;
}

export async function updatePlaylist(id: string, updates: { name?: string; tracks?: PlaylistTrack[] }): Promise<SavedPlaylist | undefined> {
  await ensureLoaded();
  const playlist = playlists.find(p => p.id === id);
  if (!playlist) return undefined;

  if (updates.name) playlist.name = updates.name;
  if (updates.tracks) playlist.tracks = updates.tracks;
  playlist.updatedAt = new Date().toISOString();

  await persist();
  return playlist;
}

export async function deletePlaylist(id: string): Promise<boolean> {
  await ensureLoaded();
  const before = playlists.length;
  playlists = playlists.filter(p => p.id !== id);
  if (playlists.length < before) {
    await persist();
    return true;
  }
  return false;
}
