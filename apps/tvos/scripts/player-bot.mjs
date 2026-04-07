#!/usr/bin/env node
// Spawns N player bots that join a session via WS so we can verify display
// broadcasts of player_joined / player_left.
//
// Usage:  node apps/tvos/scripts/player-bot.mjs <joinCode> [host] [count]
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const WebSocket = require("../../../packages/mcp-server/node_modules/ws");

const JOIN  = process.argv[2];
const HOST  = process.argv[3] || "192.168.39.140:3000";
const COUNT = Number(process.argv[4] || 3);

if (!JOIN) {
  console.error("usage: player-bot.mjs <joinCode> [host] [count]");
  process.exit(1);
}

const NAMES = [
  ["Mikkel",  "🎸"],
  ["Sofie",   "🎤"],
  ["Liva",    "🥁"],
  ["Andreas", "🎹"],
  ["Emil",    "🎧"],
];

const sockets = [];
NAMES.slice(0, COUNT).forEach(([name, avatar], i) => {
  setTimeout(() => {
    const ws = new WebSocket(`ws://${HOST}/quiz-ws`);
    sockets.push(ws);
    ws.on("open", () => {
      const msg = { type: "join_session", joinCode: JOIN, name, avatar };
      ws.send(JSON.stringify(msg));
      console.log(`→ ${name} join_session ${JOIN}`);
    });
    ws.on("message", (raw) => {
      try {
        const m = JSON.parse(raw.toString());
        if (["joined", "error", "session_joined"].includes(m.type)) {
          console.log(`← ${name} ${m.type}`, m.message || "");
        }
      } catch {}
    });
    ws.on("error", (e) => console.error(`${name} ws error:`, e.message));
  }, i * 600);
});

process.on("SIGINT", () => {
  console.log("\nshutting down player bots");
  sockets.forEach((s) => { try { s.close(); } catch {} });
  process.exit(0);
});

// Stay alive until killed
setInterval(() => {}, 1000);
