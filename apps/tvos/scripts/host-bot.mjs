#!/usr/bin/env node
// Tiny WebSocket host bot for tvOS visual smoke tests.
//
// Drives a full quiz lifecycle: create_session → start_quiz (after a short
// lobby delay) → engine auto-advances through questions on its timer until
// `finished` lands. Stays connected so the display keeps the final state.
//
// Usage:  node apps/tvos/scripts/host-bot.mjs [host] [questionCount] [--no-start]
//   host           default: 192.168.39.140:3000
//   questionCount  default: 3
//   --no-start     stop after create_session (lobby only)
//
// Press Ctrl-C to disconnect.
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const WebSocket = require("../../../packages/mcp-server/node_modules/ws");

const HOST    = process.argv[2] || "192.168.39.140:3000";
const COUNT   = Number(process.argv[3] || 3);
const NO_START = process.argv.includes("--no-start");
const URL     = `ws://${HOST}/quiz-ws`;

const ws = new WebSocket(URL);
let started = false;

ws.on("open", () => {
  console.log(`✅ host bot connected to ${URL}`);
  const config = {
    quizType: "top-songs",
    questionCount: COUNT,
    timeLimit: 15,
    storefront: "dk",
  };
  ws.send(JSON.stringify({ type: "create_session", config }));
  console.log(`→ create_session ${JSON.stringify(config)}`);
});

ws.on("message", (raw) => {
  let msg;
  try { msg = JSON.parse(raw.toString()); } catch { return; }
  const type = msg.type;
  if (["session_created", "game_state", "player_joined", "preparing", "researching", "error", "final_results"].includes(type)) {
    console.log(`← ${type}`, JSON.stringify(msg).slice(0, 160));
  }
  if (type === "session_created" && !NO_START && !started) {
    started = true;
    // Give the lobby ~12s so the display + screenshot can render it, then start the quiz.
    setTimeout(() => {
      console.log("→ start_quiz");
      ws.send(JSON.stringify({ type: "start_quiz" }));
    }, 12000);
  }
});

ws.on("close", () => console.log("ws closed"));
ws.on("error", (e) => console.error("ws error:", e.message));

process.on("SIGINT", () => {
  console.log("\nshutting down host bot");
  try { ws.send(JSON.stringify({ type: "end_party" })); } catch {}
  ws.close();
  process.exit(0);
});
