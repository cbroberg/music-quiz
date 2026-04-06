/**
 * WebSocket server for home controller connections.
 * The home Mac connects here; MCP tools send commands through this connection.
 */

import { WebSocketServer, WebSocket } from "ws";
import crypto from "node:crypto";
import { IncomingMessage, Server } from "node:http";
import { parse } from "node:url";

interface PendingRequest {
  resolve: (data: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface HomeConnection {
  ws: WebSocket;
  host: string;
  connectedAt: Date;
  pending: Map<string, PendingRequest>;
}

let homeAgent: HomeConnection | null = null;

// ─── Token validation (timing-safe) ───────────────────────

function validateToken(provided: string): boolean {
  const expected = process.env.HOME_API_KEY || "";
  if (!expected || !provided) return false;
  try {
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ─── Send command to home agent ────────────────────────────

export function isHomeConnected(): boolean {
  return homeAgent !== null && homeAgent.ws.readyState === WebSocket.OPEN;
}

export function sendHomeCommand(
  type: string,
  params: Record<string, unknown> = {},
  timeoutMs = 15_000,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!homeAgent || homeAgent.ws.readyState !== WebSocket.OPEN) {
      reject(new Error("Home controller not connected"));
      return;
    }

    const requestId = crypto.randomUUID();
    const timer = setTimeout(() => {
      homeAgent?.pending.delete(requestId);
      reject(new Error("Home controller request timed out"));
    }, timeoutMs);

    homeAgent.pending.set(requestId, { resolve, reject, timer });
    homeAgent.ws.send(JSON.stringify({ type, requestId, ...params }));
  });
}

// ─── Attach to HTTP server ─────────────────────────────────

export function attachHomeWebSocket(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req: IncomingMessage, socket, head) => {
    const { pathname, query } = parse(req.url || "", true);
    if (pathname !== "/home-ws") {
      // Not for us — let other upgrade handlers deal with it
      return;
    }

    const token = query.token as string;
    if (!validateToken(token)) {
      console.log("🏠 Home WS: rejected (bad token)");
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      handleHomeConnection(ws);
    });
  });

  console.log("🏠 Home WebSocket endpoint: /home-ws");
}

// ─── Handle incoming home connection ───────────────────────

function handleHomeConnection(ws: WebSocket): void {
  // Close previous connection if any
  if (homeAgent && homeAgent.ws.readyState === WebSocket.OPEN) {
    console.log("🏠 Replacing existing home connection");
    homeAgent.ws.close(1000, "Replaced by new connection");
  }

  const conn: HomeConnection = {
    ws,
    host: "unknown",
    connectedAt: new Date(),
    pending: new Map(),
  };
  homeAgent = conn;
  console.log("🏠 Home controller connected");

  ws.on("message", (data) => {
    let msg: { type: string; requestId?: string; ok?: boolean; data?: unknown; error?: string; host?: string };
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }

    // Hello message
    if (msg.type === "hello") {
      conn.host = msg.host || "unknown";
      console.log(`🏠 Home controller identified: ${conn.host}`);
      return;
    }

    // Pong
    if (msg.type === "pong") return;

    // Response to a pending command
    if (msg.type === "response" && msg.requestId) {
      const pending = conn.pending.get(msg.requestId);
      if (pending) {
        conn.pending.delete(msg.requestId);
        clearTimeout(pending.timer);
        if (msg.ok) {
          pending.resolve(msg.data);
        } else {
          pending.reject(new Error(msg.error || "Home command failed"));
        }
      }
    }
  });

  ws.on("close", () => {
    console.log("🏠 Home controller disconnected");
    // Reject all pending
    for (const [id, pending] of conn.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Home controller disconnected"));
    }
    conn.pending.clear();
    if (homeAgent === conn) homeAgent = null;
  });

  ws.on("error", (err) => {
    console.error("🏠 Home WS error:", err.message);
  });
}
