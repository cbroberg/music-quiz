/**
 * Home Controller Playback Provider
 *
 * Wraps the existing sendHomeCommand/isHomeConnected for the PlaybackProvider interface.
 * Server-side: sends osascript commands to Mac via WebSocket.
 */

import type { PlaybackProvider, PlayResult, NowPlayingInfo } from "./types.js";
import { sendHomeCommand, isHomeConnected } from "../home-ws.js";
import { isMuted } from "../mute.js";

export class HomeControllerProvider implements PlaybackProvider {
  readonly name = "home-controller";

  isAvailable(): boolean {
    return isHomeConnected() && !isMuted();
  }

  async playExact(name: string, artist: string, options?: {
    retries?: number;
    randomSeek?: boolean;
  }): Promise<PlayResult> {
    if (!this.isAvailable()) return { playing: false };
    try {
      const result = await sendHomeCommand("play-exact", {
        name,
        artist,
        retries: options?.retries ?? 3,
        randomSeek: options?.randomSeek ?? false,
      }, 15000) as { playing?: string; error?: string };
      return {
        playing: !!result.playing,
        track: result.playing,
      };
    } catch {
      return { playing: false };
    }
  }

  async pause(): Promise<void> {
    if (!this.isAvailable()) return;
    await sendHomeCommand("pause", {}, 3000).catch(() => {});
  }

  async resume(): Promise<void> {
    if (!this.isAvailable()) return;
    await sendHomeCommand("play", {}, 3000).catch(() => {});
  }

  async setVolume(level: number): Promise<void> {
    if (!this.isAvailable()) return;
    await sendHomeCommand("volume", { level }, 3000).catch(() => {});
  }

  async nowPlaying(): Promise<NowPlayingInfo> {
    if (!this.isAvailable()) return { state: "stopped" };
    try {
      const np = await sendHomeCommand("now-playing", {}, 5000) as {
        state?: string; track?: string; artist?: string; position?: number; duration?: number;
      };
      return {
        state: (np.state as NowPlayingInfo["state"]) || "stopped",
        track: np.track,
        artist: np.artist,
        position: np.position,
        duration: np.duration,
      };
    } catch {
      return { state: "stopped" };
    }
  }

  async checkLibrary(name: string, artist: string): Promise<boolean> {
    if (!isHomeConnected()) return false;
    try {
      const check = await sendHomeCommand("check-library", { name, artist }, 5000) as { found?: boolean };
      return !!check.found;
    } catch {
      return false;
    }
  }

  async addToLibrary(_songIds: string[]): Promise<void> {
    // addToLibrary is done via Apple Music API (musicClient), not Home Controller
    // This is a no-op here — the engine handles it via musicClient directly
  }

  async deleteFromLibrary(name: string, artist: string): Promise<{ deleted: number }> {
    if (!isHomeConnected()) return { deleted: 0 };
    try {
      const result = await sendHomeCommand("delete-from-library", {
        name, artist,
      }, 5000) as { deleted?: number };
      return { deleted: result.deleted || 0 };
    } catch {
      return { deleted: 0 };
    }
  }

  async searchAndPlay(query: string): Promise<PlayResult> {
    if (!this.isAvailable()) return { playing: false };
    try {
      const result = await sendHomeCommand("search-and-play", { query }, 10000) as { playing?: string };
      return { playing: !!result.playing, track: result.playing };
    } catch {
      return { playing: false };
    }
  }
}
