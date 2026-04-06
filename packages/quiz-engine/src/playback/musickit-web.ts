/**
 * MusicKit JS Playback Provider
 *
 * Server-side proxy that sends playback commands to the host browser
 * via WebSocket. The host browser runs MusicKit JS and plays music directly.
 *
 * Communication:
 *   Server → ws "playback_command" → host.js → MusicKit JS → Apple Music
 *   host.js → ws "playback_response" → Server
 */

import type { PlaybackProvider, PlayResult, NowPlayingInfo } from "./types.js";
import { WebSocket } from "ws";
import { isMuted } from "../mute.js";

type SendToHostFn = (msg: any) => void;

// Pending command responses
const pendingCommands = new Map<string, {
  resolve: (value: any) => void;
  timer: ReturnType<typeof setTimeout>;
}>();

let commandIdCounter = 0;

export class MusicKitWebProvider implements PlaybackProvider {
  readonly name = "musickit-web";
  private sendToHost: SendToHostFn | null = null;
  private authorized = false;

  /** Set the function used to send messages to the host browser */
  setSendToHost(fn: SendToHostFn): void {
    this.sendToHost = fn;
  }

  setAuthorized(authorized: boolean): void {
    this.authorized = authorized;
  }

  isAvailable(): boolean {
    return this.sendToHost !== null && this.authorized && !isMuted();
  }

  /** Handle response from host browser */
  static handleResponse(msg: { commandId: string; result: any }): void {
    const pending = pendingCommands.get(msg.commandId);
    if (pending) {
      clearTimeout(pending.timer);
      pendingCommands.delete(msg.commandId);
      pending.resolve(msg.result);
    }
  }

  private sendCommand(command: string, params: any, timeoutMs = 10000): Promise<any> {
    return new Promise((resolve) => {
      if (!this.sendToHost) {
        resolve(null);
        return;
      }

      const commandId = `mk-${++commandIdCounter}`;
      const timer = setTimeout(() => {
        pendingCommands.delete(commandId);
        resolve(null);
      }, timeoutMs);

      pendingCommands.set(commandId, { resolve, timer });

      this.sendToHost({
        type: "playback_command",
        commandId,
        command,
        params,
      });
    });
  }

  async playExact(name: string, artist: string, options?: {
    retries?: number;
    randomSeek?: boolean;
  }): Promise<PlayResult> {
    if (!this.isAvailable()) return { playing: false };
    const result = await this.sendCommand("play_exact", {
      name, artist,
      randomSeek: options?.randomSeek ?? false,
    }, 15000);
    return result || { playing: false };
  }

  async playById(songId: string, options?: { seekToPercent?: number }): Promise<PlayResult> {
    if (!this.isAvailable()) return { playing: false };
    const result = await this.sendCommand("play_by_id", {
      songId,
      seekToPercent: options?.seekToPercent,
    }, 15000);
    return result || { playing: false };
  }

  async pause(): Promise<void> {
    if (!this.isAvailable()) return;
    await this.sendCommand("pause", {}, 3000);
  }

  async resume(): Promise<void> {
    if (!this.isAvailable()) return;
    await this.sendCommand("resume", {}, 3000);
  }

  async setVolume(level: number): Promise<void> {
    if (!this.isAvailable()) return;
    await this.sendCommand("set_volume", { level: level / 100 }, 3000); // MusicKit uses 0-1
  }

  async nowPlaying(): Promise<NowPlayingInfo> {
    if (!this.isAvailable()) return { state: "stopped" };
    const result = await this.sendCommand("now_playing", {}, 5000);
    return result || { state: "stopped" };
  }

  async checkLibrary(name: string, artist: string): Promise<boolean> {
    // MusicKit JS can search the user's library
    if (!this.isAvailable()) return false;
    const result = await this.sendCommand("check_library", { name, artist }, 5000);
    return result?.found ?? false;
  }

  async addToLibrary(_songIds: string[]): Promise<void> {
    // Handled by musicClient on server side via Apple Music API
  }

  async deleteFromLibrary(_name: string, _artist: string): Promise<{ deleted: number }> {
    // Not supported via MusicKit JS — only possible via Home Controller
    return { deleted: 0 };
  }

  async searchAndPlay(query: string): Promise<PlayResult> {
    if (!this.isAvailable()) return { playing: false };
    const result = await this.sendCommand("search_and_play", { query }, 10000);
    return result || { playing: false };
  }
}
