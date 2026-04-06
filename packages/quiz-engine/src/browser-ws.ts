/**
 * Browser-facing WebSocket server.
 * Broadcasts "now playing" data to connected browsers.
 */

import { WebSocketServer, WebSocket } from "ws";
import { Server, IncomingMessage } from "node:http";
import { parse } from "node:url";
import { sendHomeCommand, isHomeConnected } from "./home-ws.js";
import { getProvider, getActiveProviderType } from "./playback/provider-manager.js";
import { AppleMusicClient } from "./apple-music.js";

let artworkCache: { key: string; url: string } | null = null;

// ─── Now Playing broadcaster ───────────────────────────────

const nowPlayingClients = new Set<WebSocket>();
let pollInterval: ReturnType<typeof setInterval> | null = null;
let lastTrackKey = "";

async function resolveArtwork(
  track: string,
  artist: string,
  client: AppleMusicClient,
): Promise<string | undefined> {
  const key = `${track}|${artist}`;
  if (artworkCache?.key === key) return artworkCache.url;

  try {
    const result = (await client.searchCatalog(`${track} ${artist}`, ["songs"], 1)) as {
      results?: { songs?: { data?: Array<{ attributes?: { artwork?: { url?: string } } }> } };
    };
    const artUrl = result?.results?.songs?.data?.[0]?.attributes?.artwork?.url;
    if (artUrl) {
      // Replace {w}x{h} with actual dimensions
      const url = artUrl.replace("{w}", "600").replace("{h}", "600");
      artworkCache = { key, url };
      return url;
    }
  } catch (err) {
    console.error("🎨 Artwork lookup failed:", err);
  }
  return undefined;
}

// Track change log (accessible via routes) — persisted to disk
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const TRACK_LOG_PATH = join(process.cwd(), "data", "track-log.json");

export const trackChangeLog: Array<{ ts: string; track: string; artist: string; artworkUrl?: string; source: string }> = [];
let lastLoggedTrack = "";

// Restore from disk on startup
try {
  const stored = JSON.parse(readFileSync(TRACK_LOG_PATH, "utf-8"));
  if (Array.isArray(stored)) {
    trackChangeLog.push(...stored.slice(-500));
    console.log(`🎵 Restored ${trackChangeLog.length} recently played tracks`);
  }
} catch {}

function saveTrackLog() {
  try {
    mkdirSync(join(process.cwd(), "data"), { recursive: true });
    writeFileSync(TRACK_LOG_PATH, JSON.stringify(trackChangeLog, null, 2));
  } catch {}
}

export function logTrackChange(track: string, artist: string, source: string, artworkUrl?: string) {
  const key = `${track}|${artist}`;
  if (key === lastLoggedTrack) return;
  lastLoggedTrack = key;
  const entry = { ts: new Date().toISOString(), track, artist, artworkUrl, source };
  trackChangeLog.push(entry);
  if (trackChangeLog.length > 500) trackChangeLog.shift();
  saveTrackLog();
  console.log(`🎵 NOW PLAYING: "${track}" — ${artist} [${source}]`);
}

function broadcast(data: unknown) {
  const msg = JSON.stringify(data);
  for (const ws of nowPlayingClients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  }
}

// Track last push time — if MusicKit pushed recently, don't overwrite with polling
let lastPushTime = 0;

async function pollNowPlaying(musicClient: AppleMusicClient) {
  // If MusicKit JS pushed data within the last 10 seconds, skip polling
  if (Date.now() - lastPushTime < 10000) return;

  // MusicKit JS provider: now-playing comes via pushNowPlaying
  if (getActiveProviderType() === "musickit-web") return;

  if (!isHomeConnected()) {
    // Only send stopped if we haven't had a recent push (avoid overwriting MusicKit data)
    broadcast({ type: "now-playing", data: { state: "stopped" } });
    return;
  }

  try {
    const np = (await sendHomeCommand("now-playing", {}, 5000)) as {
      state: string;
      track?: string;
      artist?: string;
      album?: string;
      duration?: number;
      position?: number;
    };

    let artworkUrl: string | undefined;
    if (np.track && np.artist) {
      const trackKey = `${np.track}|${np.artist}`;
      if (trackKey !== lastTrackKey) {
        console.log(`🎨 Resolving artwork for: ${np.track} — ${np.artist}`);
        artworkUrl = await resolveArtwork(np.track, np.artist, musicClient);
        lastTrackKey = trackKey;
        console.log(`🎨 Artwork: ${artworkUrl || "not found"}`);
      } else {
        artworkUrl = artworkCache?.url;
      }
    }

    if (np.track && np.artist) logTrackChange(np.track, np.artist, "hc-poll", artworkUrl);
    broadcast({
      type: "now-playing",
      data: { ...np, artworkUrl },
    });
  } catch {
    broadcast({ type: "now-playing", data: { state: "stopped" } });
  }
}

/** Push now-playing data from MusicKit JS (client-side) to all Now Playing pages */
export function pushNowPlaying(data: {
  state: string;
  track?: string;
  artist?: string;
  album?: string;
  artworkUrl?: string;
  duration?: number;
  position?: number;
}): void {
  lastPushTime = Date.now();
  if (data.track && data.artist) logTrackChange(data.track, data.artist, "musickit-push", data.artworkUrl);
  broadcast({ type: "now-playing", data });
}

function startPolling(musicClient: AppleMusicClient) {
  if (pollInterval) return;
  pollNowPlaying(musicClient); // immediate first poll
  pollInterval = setInterval(() => pollNowPlaying(musicClient), 3000);
}

function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
  lastTrackKey = "";
}

// ─── Attach to HTTP server ─────────────────────────────────

export function attachBrowserWebSocket(server: Server, musicClient: AppleMusicClient): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req: IncomingMessage, socket, head) => {
    const { pathname } = parse(req.url || "", true);

    if (pathname === "/ws/now-playing") {
      wss.handleUpgrade(req, socket, head, (ws) => {
        nowPlayingClients.add(ws);
        console.log(`🌐 Browser connected to /ws/now-playing (${nowPlayingClients.size} clients)`);

        // Start polling when first client connects
        if (nowPlayingClients.size === 1) {
          startPolling(musicClient);
        }

        ws.on("close", () => {
          nowPlayingClients.delete(ws);
          console.log(`🌐 Browser disconnected from /ws/now-playing (${nowPlayingClients.size} clients)`);
          if (nowPlayingClients.size === 0) {
            stopPolling();
          }
        });
      });
      return;
    }

    // Don't destroy — other handlers (home-ws) may handle this path
  });

  console.log("🌐 Browser WebSocket endpoints: /ws/now-playing");
}
