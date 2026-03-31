#!/usr/bin/env node
/**
 * Apple Music Home Controller
 *
 * Runs on a Mac at home. Controls Music.app via osascript.
 * Connects OUTBOUND to the MCP server via WebSocket (no tunnel needed).
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import WebSocket from "ws";
import os from "node:os";

const exec = promisify(execFile);

const MCP_WS_URL = process.env.MCP_WS_URL || "ws://localhost:3000/home-ws";
const HOME_API_KEY = process.env.HOME_API_KEY;

if (!HOME_API_KEY) {
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

// ─── Command handler ───────────────────────────────────────

interface Command {
  type: string;
  requestId: string;
  [key: string]: unknown;
}

async function handleCommand(cmd: Command): Promise<unknown> {
  switch (cmd.type) {
    case "ping":
      return { type: "pong" };

    case "play":
      if (cmd.track_name) {
        await osaMusic(`play (first track of playlist "Library" whose name contains "${String(cmd.track_name).replace(/"/g, '\\"')}")`);
        return { action: "play", track: cmd.track_name };
      }
      await osaMusic("play");
      return { action: "play" };

    case "pause":
      await osaMusic("pause");
      return { action: "pause" };

    case "stop":
      await osaMusic("stop");
      return { action: "stop" };

    case "next":
      await osaMusic("next track");
      return { action: "next" };

    case "previous":
      await osaMusic("previous track");
      return { action: "previous" };

    case "toggle":
      await osaMusic("playpause");
      return { action: "toggle" };

    case "volume": {
      if (cmd.level !== undefined) {
        const level = Math.max(0, Math.min(100, Number(cmd.level)));
        await osaMusic(`set sound volume to ${level}`);
        return { volume: level };
      }
      const vol = await osaMusic("get sound volume");
      return { volume: parseInt(vol) };
    }

    case "now-playing": {
      const state = await osaMusic("get player state as string");
      if (state === "stopped") return { state: "stopped" };
      const [name, artist, album, duration, position] = await Promise.all([
        osaMusic("get name of current track"),
        osaMusic("get artist of current track"),
        osaMusic("get album of current track"),
        osaMusic("get duration of current track"),
        osaMusic("get player position"),
      ]);
      return { state, track: name, artist, album, duration: Math.round(parseFloat(duration)), position: Math.round(parseFloat(position)) };
    }

    case "shuffle": {
      if (cmd.enabled !== undefined) {
        await osaMusic(`set shuffle enabled to ${cmd.enabled ? "true" : "false"}`);
        return { shuffle: cmd.enabled };
      }
      const shuffle = await osaMusic("get shuffle enabled");
      return { shuffle: shuffle === "true" };
    }

    case "search-and-play": {
      const query = String(cmd.query || "").replace(/"/g, '\\"');
      const wantArtist = String(cmd.artist || "").replace(/"/g, '\\"');
      const randomSeek = cmd.randomSeek === true;
      const found = await osa(`
        tell application "Music"
          set results to search playlist "Library" for "${query}"
          if (count of results) > 0 then
            ${wantArtist ? `
            -- Find best match: prefer tracks whose artist contains the wanted artist
            set theTrack to item 1 of results
            repeat with t in results
              if (artist of t) contains "${wantArtist}" then
                set theTrack to t
                exit repeat
              end if
            end repeat
            ` : `
            set theTrack to item 1 of results
            `}
            play theTrack
            delay 0.5
            if player state is not playing then play
            ${randomSeek ? `
            try
              set dur to duration of theTrack
              set seekTo to (random number from (round (dur * 0.15)) to (round (dur * 0.6)))
              set player position to seekTo
            end try
            ` : ""}
            return name of theTrack & " — " & artist of theTrack
          else
            return "NOT_FOUND"
          end if
        end tell
      `);
      if (found === "NOT_FOUND") return { error: "No matching track found", query: cmd.query };
      return { action: "search-and-play", playing: found };
    }

    case "play-playlist": {
      const name = String(cmd.name || "").replace(/"/g, '\\"');
      await osaMusic(`play playlist "${name}"`);
      return { action: "play-playlist", playlist: cmd.name };
    }

    case "play-ids": {
      const ids = cmd.song_ids as string[];
      if (!ids?.length) return { error: "song_ids required" };
      // Stop current playback, open catalog song via URL scheme, then play
      await osaMusic("stop").catch(() => {});
      await exec("open", [`music://music.apple.com/dk/song/${ids[0]}`]);
      // Wait for Music.app to load the song, then press play
      await new Promise((r) => setTimeout(r, 1500));
      await osaMusic("play");
      return { action: "play-ids", count: ids.length, first: ids[0] };
    }

    case "airplay-devices": {
      const raw = await osa(`
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
      `);
      const devices = raw.split(", ").map((entry) => {
        const [name, active, kind, volume] = entry.split("|");
        return { name, active: active === "true", kind, volume: parseInt(volume) || 0 };
      });
      return { devices };
    }

    case "airplay": {
      const deviceName = String(cmd.device || "").replace(/"/g, '\\"');
      const enabled = cmd.enabled !== false;
      await osa(`
        tell application "Music"
          set targetDevice to (first AirPlay device whose name is "${deviceName}")
          set selected of targetDevice to ${enabled}
        end tell
      `);
      return { device: cmd.device, enabled };
    }

    case "airplay-volume": {
      const deviceName = String(cmd.device || "").replace(/"/g, '\\"');
      const level = Math.max(0, Math.min(100, Number(cmd.level)));
      await osa(`
        tell application "Music"
          set targetDevice to (first AirPlay device whose name is "${deviceName}")
          set sound volume of targetDevice to ${level}
        end tell
      `);
      return { device: cmd.device, volume: level };
    }

    case "health":
      return { status: "ok", host: (await exec("hostname", [])).stdout.trim() };

    default:
      return { error: `Unknown command: ${cmd.type}` };
  }
}

// ─── WebSocket connection with reconnect ───────────────────

let reconnectDelay = 1_000;
const MAX_RECONNECT_DELAY = 30_000;

function connect() {
  const url = `${MCP_WS_URL}?token=${encodeURIComponent(HOME_API_KEY!)}`;
  console.log(`🔌 Connecting to ${MCP_WS_URL}...`);

  const ws = new WebSocket(url, { handshakeTimeout: 10_000 });
  let heartbeat: ReturnType<typeof setInterval>;

  ws.on("open", () => {
    console.log("✅ Connected to MCP server");
    reconnectDelay = 1_000; // reset backoff

    // Send hello
    ws.send(JSON.stringify({
      type: "hello",
      host: os.hostname(),
    }));

    // Heartbeat every 25s (Fly.io drops idle after ~75s)
    heartbeat = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
        ws.send(JSON.stringify({ type: "ping" }));
      }
    }, 25_000);
  });

  ws.on("message", async (data) => {
    let cmd: Command;
    try {
      cmd = JSON.parse(data.toString());
    } catch {
      return;
    }

    try {
      const result = await handleCommand(cmd);
      ws.send(JSON.stringify({
        type: "response",
        requestId: cmd.requestId,
        ok: true,
        data: result,
      }));
    } catch (err) {
      ws.send(JSON.stringify({
        type: "response",
        requestId: cmd.requestId,
        ok: false,
        error: String(err),
      }));
    }
  });

  ws.on("close", (code, reason) => {
    clearInterval(heartbeat);
    console.log(`🔌 Disconnected (${code}: ${reason || "no reason"}). Reconnecting in ${reconnectDelay / 1000}s...`);
    const delay = reconnectDelay;
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
    setTimeout(connect, delay);
  });

  ws.on("error", (err) => {
    console.error("❌ WebSocket error:", err.message);
    // close event will fire after this, triggering reconnect
  });
}

// ─── Start ─────────────────────────────────────────────────

console.log(`
🏠 Apple Music Home Controller (WebSocket mode)
   MCP Server: ${MCP_WS_URL}
   Commands:   play, pause, next, previous, volume, now-playing,
               shuffle, search-and-play, play-playlist, airplay, etc.
`);

connect();
