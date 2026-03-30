/**
 * Browser-facing WebSocket server.
 * Broadcasts "now playing" data to connected browsers.
 */

import { WebSocketServer, WebSocket } from "ws";
import { Server, IncomingMessage } from "node:http";
import { parse } from "node:url";
import { sendHomeCommand, isHomeConnected } from "./home-ws.js";
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

function broadcast(data: unknown) {
  const msg = JSON.stringify(data);
  for (const ws of nowPlayingClients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  }
}

async function pollNowPlaying(musicClient: AppleMusicClient) {
  if (!isHomeConnected()) {
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

    broadcast({
      type: "now-playing",
      data: { ...np, artworkUrl },
    });
  } catch {
    broadcast({ type: "now-playing", data: { state: "stopped" } });
  }
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
