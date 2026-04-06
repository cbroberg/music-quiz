/**
 * Custom server entry point.
 * Mounts Express (MCP/OAuth/API) + Next.js (frontend) on the same port.
 * Handles WebSocket upgrades for home controller and browser clients.
 */

import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import next from "next";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_DIR = resolve(__dirname, "..", "web");
import { app, client, PORT, logStartup } from "./dist/index.js";
import {
  attachHomeWebSocket,
  attachBrowserWebSocket,
  attachQuizWebSocket,
  createQuizRouter,
} from "@music-quiz/quiz-engine";

const dev = process.env.NODE_ENV !== "production";
const nextApp = next({ dev, dir: WEB_DIR });
const handle = nextApp.getRequestHandler();

await nextApp.prepare();

// Express routes that should NOT go to Next.js
const EXPRESS_PATHS = new Set([
  "/mcp", "/sse", "/message", "/health",
  "/authorize", "/token", "/register", "/revoke",
  "/auth",
]);
// Express owns these /api/ sub-paths
const EXPRESS_API_PREFIXES = [
  "/api/developer-token", "/api/auth",
  "/api/quiz",
];
// Quiz multiplayer routes served by Express (host, play, static, api, manifest, sw)
const QUIZ_EXPRESS_PREFIXES = ["/quiz/host", "/quiz/play", "/quiz/admin", "/quiz/builder", "/quiz/now-playing", "/quiz/static/", "/quiz/sounds/", "/quiz/api/", "/quiz/manifest.json", "/quiz/sw.js"];
const EXPRESS_PREFIXES = ["/.well-known/"];

function isExpressRoute(pathname) {
  if (EXPRESS_PATHS.has(pathname)) return true;
  if (EXPRESS_API_PREFIXES.some((p) => pathname.startsWith(p))) return true;
  if (EXPRESS_PREFIXES.some((p) => pathname.startsWith(p))) return true;
  return QUIZ_EXPRESS_PREFIXES.some((p) => pathname.startsWith(p));
}

// Mount multiplayer quiz routes on Express
app.use(createQuizRouter(client));

// Create unified HTTP server
const server = createServer((req, res) => {
  const pathname = new URL(req.url || "", `http://${req.headers.host}`).pathname;

  if (isExpressRoute(pathname)) {
    app(req, res);
  } else {
    handle(req, res);
  }
});

// Attach WebSocket handlers
attachHomeWebSocket(server);
attachBrowserWebSocket(server, client);
attachQuizWebSocket(server, client);

server.listen(PORT, () => {
  logStartup();
  console.log(`   Frontend:   ${dev ? "Next.js dev mode" : "Next.js production"}`);
  console.log(`   Now Playing: /ws/now-playing (browser WebSocket)`);
  console.log(`   Quiz Host:   /quiz/host (fullscreen storskærm)`);
  console.log(`   Quiz Player: /quiz/play (telefon PWA)`);
  console.log(`   Quiz WS:     /quiz-ws (game WebSocket)`);
  console.log();
});
