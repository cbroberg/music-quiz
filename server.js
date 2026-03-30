/**
 * Custom server entry point.
 * Mounts Express (MCP/OAuth/API) + Next.js (frontend) on the same port.
 * Handles WebSocket upgrades for home controller and browser clients.
 */

import { createServer } from "node:http";
import { parse } from "node:url";
import next from "next";
import { app, client, attachHomeWebSocket, PORT, logStartup } from "./dist/index.js";
import { attachBrowserWebSocket } from "./dist/browser-ws.js";

const dev = process.env.NODE_ENV !== "production";
const nextApp = next({ dev, dir: "./web" });
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
const EXPRESS_PREFIXES = ["/.well-known/"];

function isExpressRoute(pathname) {
  if (EXPRESS_PATHS.has(pathname)) return true;
  if (EXPRESS_API_PREFIXES.some((p) => pathname.startsWith(p))) return true;
  return EXPRESS_PREFIXES.some((p) => pathname.startsWith(p));
}

// Create unified HTTP server
const server = createServer((req, res) => {
  const { pathname } = parse(req.url || "", true);

  if (isExpressRoute(pathname || "")) {
    app(req, res);
  } else {
    handle(req, res);
  }
});

// Attach WebSocket handlers
attachHomeWebSocket(server);
attachBrowserWebSocket(server, client);

server.listen(PORT, () => {
  logStartup();
  console.log(`   Frontend:   ${dev ? "Next.js dev mode" : "Next.js production"}`);
  console.log(`   Now Playing: /ws/now-playing (browser WebSocket)`);
  console.log();
});
