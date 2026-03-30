#!/usr/bin/env node
/**
 * Apple Music Home Controller
 *
 * Small HTTP server that runs on a Mac at home.
 * Controls Music.app via osascript, including AirPlay output.
 * Designed to be exposed via Cloudflare Tunnel.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import http from "node:http";

const exec = promisify(execFile);
const PORT = parseInt(process.env.HOME_PORT || "10516"); // MUSIC: M=1,U=0,S=5,I=1,C=6
const API_KEY = process.env.HOME_API_KEY;

if (!API_KEY) {
  console.error("HOME_API_KEY is required");
  process.exit(1);
}

// ─── osascript helper ──────────────────────────────────────

async function osa(script: string): Promise<string> {
  const { stdout } = await exec("osascript", ["-e", script]);
  return stdout.trim();
}

async function osaMusic(command: string): Promise<string> {
  return osa(`tell application "Music" to ${command}`);
}

// ─── HTTP server ───────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  // Auth check
  const auth = req.headers["x-api-key"];
  if (auth !== API_KEY) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }

  // Parse body for POST
  let body: Record<string, unknown> = {};
  if (req.method === "POST") {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    try {
      body = JSON.parse(Buffer.concat(chunks).toString());
    } catch {}
  }

  const url = new URL(req.url || "/", `http://localhost:${PORT}`);
  const path = url.pathname;

  try {
    let result: unknown;

    switch (path) {
      // ── Playback control ──────────────────────────
      case "/play":
        if (body.track_name) {
          // Search and play a specific track
          await osaMusic(`play (first track of playlist "Library" whose name contains "${String(body.track_name).replace(/"/g, '\\"')}")`);
          result = { action: "play", track: body.track_name };
        } else {
          await osaMusic("play");
          result = { action: "play" };
        }
        break;

      case "/pause":
        await osaMusic("pause");
        result = { action: "pause" };
        break;

      case "/stop":
        await osaMusic("stop");
        result = { action: "stop" };
        break;

      case "/next":
        await osaMusic("next track");
        result = { action: "next" };
        break;

      case "/previous":
        await osaMusic("previous track");
        result = { action: "previous" };
        break;

      case "/toggle":
        await osaMusic("playpause");
        result = { action: "toggle" };
        break;

      // ── Volume ────────────────────────────────────
      case "/volume": {
        if (body.level !== undefined) {
          const level = Math.max(0, Math.min(100, Number(body.level)));
          await osaMusic(`set sound volume to ${level}`);
          result = { volume: level };
        } else {
          const vol = await osaMusic("get sound volume");
          result = { volume: parseInt(vol) };
        }
        break;
      }

      // ── Now playing ───────────────────────────────
      case "/now-playing": {
        const state = await osaMusic("get player state as string");
        if (state === "stopped") {
          result = { state: "stopped" };
        } else {
          const [name, artist, album, duration, position] = await Promise.all([
            osaMusic("get name of current track"),
            osaMusic("get artist of current track"),
            osaMusic("get album of current track"),
            osaMusic("get duration of current track"),
            osaMusic("get player position"),
          ]);
          result = {
            state,
            track: name,
            artist,
            album,
            duration: Math.round(parseFloat(duration)),
            position: Math.round(parseFloat(position)),
          };
        }
        break;
      }

      // ── Queue / play specific content ─────────────
      case "/play-ids": {
        // Play catalog songs by ID — adds to queue via URL scheme
        const ids = body.song_ids as string[];
        if (!ids?.length) {
          result = { error: "song_ids required" };
          break;
        }
        // Use Music.app URL scheme to play catalog content
        await exec("open", [`music://music.apple.com/dk/song/${ids[0]}`]);
        result = { action: "play-ids", count: ids.length, first: ids[0] };
        break;
      }

      // ── Shuffle & Repeat ──────────────────────────
      case "/shuffle": {
        if (body.enabled !== undefined) {
          await osaMusic(`set shuffle enabled to ${body.enabled ? "true" : "false"}`);
          result = { shuffle: body.enabled };
        } else {
          const shuffle = await osaMusic("get shuffle enabled");
          result = { shuffle: shuffle === "true" };
        }
        break;
      }

      // ── AirPlay ───────────────────────────────────
      case "/airplay-devices": {
        const script = `
          tell application "Music"
            set deviceList to {}
            repeat with d in (get every AirPlay device)
              set deviceName to name of d
              set deviceActive to selected of d
              set deviceKind to kind of d as string
              set deviceVolume to sound volume of d
              set end of deviceList to deviceName & "|" & deviceActive & "|" & deviceKind & "|" & deviceVolume
            end repeat
            return deviceList
          end tell
        `;
        const raw = await osa(script);
        const devices = raw.split(", ").map((entry) => {
          const [name, active, kind, volume] = entry.split("|");
          return { name, active: active === "true", kind, volume: parseInt(volume) || 0 };
        });
        result = { devices };
        break;
      }

      case "/airplay": {
        const deviceName = String(body.device || "").replace(/"/g, '\\"');
        const enabled = body.enabled !== false; // default true
        await osa(`
          tell application "Music"
            set targetDevice to (first AirPlay device whose name is "${deviceName}")
            set selected of targetDevice to ${enabled}
          end tell
        `);
        result = { device: body.device, enabled };
        break;
      }

      case "/airplay-volume": {
        const deviceName = String(body.device || "").replace(/"/g, '\\"');
        const level = Math.max(0, Math.min(100, Number(body.level)));
        await osa(`
          tell application "Music"
            set targetDevice to (first AirPlay device whose name is "${deviceName}")
            set sound volume of targetDevice to ${level}
          end tell
        `);
        result = { device: body.device, volume: level };
        break;
      }

      // ── Search & play ─────────────────────────────
      case "/search-and-play": {
        const query = String(body.query || "").replace(/"/g, '\\"');
        const script = `
          tell application "Music"
            set results to search playlist "Library" for "${query}"
            if (count of results) > 0 then
              play item 1 of results
              return name of item 1 of results & " — " & artist of item 1 of results
            else
              return "NOT_FOUND"
            end if
          end tell
        `;
        const found = await osa(script);
        if (found === "NOT_FOUND") {
          result = { error: "No matching track found in library", query: body.query };
        } else {
          result = { action: "search-and-play", playing: found };
        }
        break;
      }

      // ── Play playlist by name ─────────────────────
      case "/play-playlist": {
        const playlistName = String(body.name || "").replace(/"/g, '\\"');
        await osaMusic(`play playlist "${playlistName}"`);
        result = { action: "play-playlist", playlist: body.name };
        break;
      }

      // ── Health ────────────────────────────────────
      case "/health":
        result = { status: "ok", host: (await exec("hostname", [])).stdout.trim() };
        break;

      default:
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not found" }));
        return;
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result));
  } catch (err) {
    console.error(`Error handling ${path}:`, err);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: String(err) }));
  }
});

server.listen(PORT, () => {
  console.log(`
🏠 Apple Music Home Controller
   Port:     ${PORT}
   Endpoints:
     POST /play            Play / play specific track
     POST /pause           Pause
     POST /stop            Stop
     POST /next            Next track
     POST /previous        Previous track
     POST /toggle          Play/pause toggle
     POST /volume          Set volume { level: 0-100 }
     GET  /volume          Get current volume
     GET  /now-playing      What's playing now
     POST /shuffle         Set shuffle { enabled: true/false }
     POST /search-and-play Search library and play { query: "..." }
     POST /play-playlist   Play playlist by name { name: "..." }
     POST /play-ids        Play by catalog ID { song_ids: [...] }
     GET  /airplay-devices List AirPlay devices
     POST /airplay         Enable/disable AirPlay device { device, enabled }
     POST /airplay-volume  Set AirPlay device volume { device, level }
     GET  /health          Health check
  `);
});
