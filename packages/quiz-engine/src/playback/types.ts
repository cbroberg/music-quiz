/**
 * Playback Provider Interface
 *
 * Abstracts music playback so the quiz engine doesn't care
 * whether music comes from MusicKit JS, Home Controller, or preview clips.
 */

export interface NowPlayingInfo {
  state: "playing" | "paused" | "stopped";
  track?: string;
  artist?: string;
  position?: number;
  duration?: number;
}

export interface PlayResult {
  playing: boolean;
  track?: string;
}

export interface PlaybackProvider {
  /** Provider name for logging */
  readonly name: string;

  /** Check if this provider is currently usable */
  isAvailable(): boolean;

  /** Play a song by exact name + artist match */
  playExact(name: string, artist: string, options?: {
    retries?: number;
    randomSeek?: boolean;
  }): Promise<PlayResult>;

  /** Pause playback */
  pause(): Promise<void>;

  /** Resume playback */
  resume(): Promise<void>;

  /** Set volume (0-100) */
  setVolume(level: number): Promise<void>;

  /** Get current playback state */
  nowPlaying(): Promise<NowPlayingInfo>;

  /** Check if a song exists in the user's library */
  checkLibrary(name: string, artist: string): Promise<boolean>;

  /** Add songs to library by catalog ID */
  addToLibrary(songIds: string[]): Promise<void>;

  /** Delete a song from library */
  deleteFromLibrary(name: string, artist: string): Promise<{ deleted: number }>;

  /** Search and play (fallback for theme songs etc.) */
  searchAndPlay(query: string): Promise<PlayResult>;

  /** Play a song by catalog ID (for MusicKit JS) */
  playById?(songId: string, options?: { seekToPercent?: number }): Promise<PlayResult>;
}
