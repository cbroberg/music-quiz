import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createDeveloperToken } from "./token.js";
import { AppleMusicClient } from "./apple-music.js";
import { AppleMusicOAuthProvider } from "./oauth.js";
import { fileURLToPath } from "url";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || "3000");
const STOREFRONT = process.env.APPLE_STOREFRONT || "dk";
const SERVER_URL = process.env.SERVER_URL || `http://localhost:${PORT}`;

// ─── Music User Token store ────────────────────────────────
// Persisted in memory; re-authorize via /auth when it expires.
let musicUserToken: string | null = process.env.APPLE_MUSIC_USER_TOKEN || null;

const client = new AppleMusicClient(STOREFRONT, () => musicUserToken);

// ─── OAuth 2.1 Provider ────────────────────────────────────
const oauthProvider = new AppleMusicOAuthProvider();

// ─── Express ────────────────────────────────────────────────
const app = express();
app.set("trust proxy", true); // Required behind Fly.io reverse proxy
app.use(express.json());

// OAuth 2.1 routes — must be mounted BEFORE static files and MCP endpoints.
// Installs: /.well-known/oauth-authorization-server, /.well-known/oauth-protected-resource,
//           /authorize, /token, /register, /revoke
app.use(
  mcpAuthRouter({
    provider: oauthProvider,
    issuerUrl: new URL(SERVER_URL),
    scopesSupported: ["mcp:tools"],
    resourceName: "Apple Music MCP",
    resourceServerUrl: new URL(SERVER_URL),
  }),
);

app.use(express.static(path.join(__dirname, "..", "public")));

// Serve /auth → auth.html (Apple Music user token flow)
app.get("/auth", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "auth.html"));
});

// Health check
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    hasUserToken: client.hasUserToken(),
    storefront: STOREFRONT,
  });
});

// ─── Auth endpoints ─────────────────────────────────────────

// Serve developer token to the auth page (public, short-lived page)
app.get("/api/developer-token", (_req, res) => {
  try {
    const token = createDeveloperToken();
    res.json({ token });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Receive Music User Token from MusicKit JS auth flow
app.post("/api/auth", (req, res) => {
  const { token } = req.body;
  if (!token || typeof token !== "string") {
    res.status(400).json({ error: "Missing token" });
    return;
  }
  musicUserToken = token;
  console.log("✅ Music User Token received and stored");
  res.json({ success: true });
});

// Check auth status
app.get("/api/auth/status", (_req, res) => {
  res.json({ authorized: client.hasUserToken() });
});

// ─── MCP Server ─────────────────────────────────────────────

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "apple-music",
    version: "1.1.0",
  });

  // ═══════════════════════════════════════════════════════════
  // CATALOG TOOLS (no auth required)
  // ═══════════════════════════════════════════════════════════

  // Tool: search_catalog
  server.tool(
    "search_catalog",
    "Search the Apple Music catalog for songs, artists, or albums",
    {
      query: z.string().describe("Search term (artist name, song title, album)"),
      types: z
        .array(z.enum(["songs", "artists", "albums"]))
        .optional()
        .describe("Types to search. Default: all"),
      limit: z
        .number()
        .min(1)
        .max(25)
        .optional()
        .describe("Max results per type. Default: 10"),
    },
    async ({ query, types, limit }) => {
      const data = await client.searchCatalog(
        query,
        types || ["songs", "artists", "albums"],
        limit || 10
      );
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // Tool: get_artist_songs
  server.tool(
    "get_artist_songs",
    "Get all songs by an artist from the Apple Music catalog. First search for the artist to get their ID, then use this tool.",
    {
      artist_id: z.string().describe("Apple Music artist ID (from search results)"),
    },
    async ({ artist_id }) => {
      const songs = await client.getArtistAllSongs(artist_id);
      const summary = songs.map((s) => ({
        id: s.id,
        name: s.attributes.name,
        album: s.attributes.albumName,
        duration: Math.round(s.attributes.durationInMillis / 1000),
        year: s.attributes.releaseDate?.substring(0, 4),
        track: s.attributes.trackNumber,
        disc: s.attributes.discNumber,
      }));
      return {
        content: [
          {
            type: "text",
            text: `Found ${songs.length} unique songs.\n\n${JSON.stringify(summary, null, 2)}`,
          },
        ],
      };
    }
  );

  // Tool: get_artist_albums
  server.tool(
    "get_artist_albums",
    "Get all albums by an artist from the Apple Music catalog",
    {
      artist_id: z.string().describe("Apple Music artist ID"),
    },
    async ({ artist_id }) => {
      const albums = await client.getArtistAlbums(artist_id);
      const summary = albums.map((a) => ({
        id: a.id,
        name: a.attributes.name,
        artist: a.attributes.artistName,
        releaseDate: a.attributes.releaseDate,
        trackCount: a.attributes.trackCount,
      }));
      return {
        content: [
          {
            type: "text",
            text: `Found ${albums.length} albums.\n\n${JSON.stringify(summary, null, 2)}`,
          },
        ],
      };
    }
  );

  // Tool: get_charts
  server.tool(
    "get_charts",
    "Get Apple Music charts — top songs, albums, and playlists for the configured storefront (Denmark by default). Optionally filter by genre.",
    {
      types: z
        .array(z.enum(["songs", "albums", "playlists"]))
        .optional()
        .describe("Chart types to fetch. Default: songs, albums, playlists"),
      genre: z
        .string()
        .optional()
        .describe("Genre ID to filter charts (use get_genres to find IDs)"),
      limit: z
        .number()
        .min(1)
        .max(50)
        .optional()
        .describe("Number of results per chart. Default: 25"),
    },
    async ({ types, genre, limit }) => {
      const data = await client.getCharts(
        types || ["songs", "albums", "playlists"],
        genre,
        limit || 25
      );
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // Tool: get_genres
  server.tool(
    "get_genres",
    "List all available music genres in the Apple Music catalog. Useful for filtering charts by genre.",
    {},
    async () => {
      const data = await client.getGenres();
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // Tool: get_catalog_playlist
  server.tool(
    "get_catalog_playlist",
    "Get a curated/editorial Apple Music playlist with its tracks. Use the playlist ID from charts or search results.",
    {
      playlist_id: z.string().describe("Apple Music catalog playlist ID"),
    },
    async ({ playlist_id }) => {
      const data = await client.getCatalogPlaylist(playlist_id);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ═══════════════════════════════════════════════════════════
  // LIBRARY & PERSONALIZED TOOLS (auth required)
  // ═══════════════════════════════════════════════════════════

  // Tool: create_playlist
  server.tool(
    "create_playlist",
    "Create a new playlist in the user's Apple Music library with the given songs. Requires user authorization.",
    {
      name: z.string().describe("Playlist name"),
      description: z.string().optional().describe("Playlist description"),
      track_ids: z
        .array(z.string())
        .describe("Array of Apple Music catalog song IDs to add"),
    },
    async ({ name, description, track_ids }) => {
      if (!client.hasUserToken()) {
        return {
          content: [
            {
              type: "text",
              text: "❌ Not authorized. The user needs to visit /auth and sign in with Apple Music first.",
            },
          ],
        };
      }
      const result = await client.createPlaylist(
        name,
        description || "",
        track_ids
      );
      return {
        content: [
          {
            type: "text",
            text: `✅ Playlist "${name}" created with ${track_ids.length} tracks.\n\n${JSON.stringify(result, null, 2)}`,
          },
        ],
      };
    }
  );

  // Tool: add_tracks_to_playlist
  server.tool(
    "add_tracks_to_playlist",
    "Add tracks to an existing playlist in the user's library",
    {
      playlist_id: z.string().describe("Library playlist ID"),
      track_ids: z.array(z.string()).describe("Song IDs to add"),
    },
    async ({ playlist_id, track_ids }) => {
      if (!client.hasUserToken()) {
        return {
          content: [
            {
              type: "text",
              text: "❌ Not authorized. Visit /auth first.",
            },
          ],
        };
      }
      await client.addTracksToPlaylist(playlist_id, track_ids);
      return {
        content: [
          {
            type: "text",
            text: `✅ Added ${track_ids.length} tracks to playlist.`,
          },
        ],
      };
    }
  );

  // Tool: list_playlists
  server.tool(
    "list_playlists",
    "List the user's Apple Music library playlists. Requires user authorization.",
    {},
    async () => {
      if (!client.hasUserToken()) {
        return {
          content: [
            {
              type: "text",
              text: "❌ Not authorized. Visit /auth first.",
            },
          ],
        };
      }
      const data = await client.listPlaylists();
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  // Tool: recently_played
  server.tool(
    "recently_played",
    "Get the user's recently played songs, albums, and playlists from Apple Music. Requires user authorization.",
    {
      limit: z
        .number()
        .min(1)
        .max(25)
        .optional()
        .describe("Number of results. Default: 10"),
    },
    async ({ limit }) => {
      if (!client.hasUserToken()) {
        return {
          content: [
            {
              type: "text",
              text: "❌ Not authorized. Visit /auth first.",
            },
          ],
        };
      }
      const data = await client.getRecentlyPlayed(limit || 10);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // Tool: recommendations
  server.tool(
    "recommendations",
    "Get personalized music recommendations based on the user's listening history. Requires user authorization.",
    {
      limit: z
        .number()
        .min(1)
        .max(25)
        .optional()
        .describe("Number of recommendation groups. Default: 10"),
    },
    async ({ limit }) => {
      if (!client.hasUserToken()) {
        return {
          content: [
            {
              type: "text",
              text: "❌ Not authorized. Visit /auth first.",
            },
          ],
        };
      }
      const data = await client.getRecommendations(limit || 10);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // Tool: heavy_rotation
  server.tool(
    "heavy_rotation",
    "Get the user's most frequently played content (heavy rotation) from Apple Music. Requires user authorization.",
    {
      limit: z
        .number()
        .min(1)
        .max(25)
        .optional()
        .describe("Number of results. Default: 10"),
    },
    async ({ limit }) => {
      if (!client.hasUserToken()) {
        return {
          content: [
            {
              type: "text",
              text: "❌ Not authorized. Visit /auth first.",
            },
          ],
        };
      }
      const data = await client.getHeavyRotation(limit || 10);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // Tool: search_library
  server.tool(
    "search_library",
    "Search within the user's personal Apple Music library for songs, albums, or artists. Requires user authorization.",
    {
      query: z.string().describe("Search term"),
      types: z
        .array(z.enum(["library-songs", "library-albums", "library-artists"]))
        .optional()
        .describe("Types to search. Default: all"),
      limit: z
        .number()
        .min(1)
        .max(25)
        .optional()
        .describe("Max results. Default: 25"),
    },
    async ({ query, types, limit }) => {
      if (!client.hasUserToken()) {
        return {
          content: [
            {
              type: "text",
              text: "❌ Not authorized. Visit /auth first.",
            },
          ],
        };
      }
      const data = await client.searchLibrary(
        query,
        types || ["library-songs", "library-albums", "library-artists"],
        limit || 25
      );
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // Tool: auth_status
  server.tool(
    "auth_status",
    "Check if the user has authorized Apple Music access",
    {},
    async () => {
      return {
        content: [
          {
            type: "text",
            text: client.hasUserToken()
              ? "✅ Authorized – playlist creation and personalized features are available."
              : "❌ Not authorized. User needs to visit the /auth page and sign in with Apple Music.",
          },
        ],
      };
    }
  );

  return server;
}

// ─── MCP Transports ────────────────────────────────────────
// Supports both Streamable HTTP (/mcp) and legacy SSE (/sse).

const transports = new Map<string, SSEServerTransport | StreamableHTTPServerTransport>();

// Bearer auth middleware for /mcp — claude.ai sends OAuth tokens here.
const mcpBearerAuth = requireBearerAuth({
  verifier: oauthProvider,
  resourceMetadataUrl: new URL("/.well-known/oauth-protected-resource", SERVER_URL).href,
});

// --- Streamable HTTP (protocol version 2025-11-25) ---

app.all("/mcp", mcpBearerAuth, async (req, res) => {
  console.log(`🔌 MCP ${req.method} ${req.path}`, req.method === "POST" ? JSON.stringify(req.body?.method || req.body) : "");
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  let transport: StreamableHTTPServerTransport;

  if (sessionId && transports.has(sessionId)) {
    const existing = transports.get(sessionId)!;
    if (existing instanceof StreamableHTTPServerTransport) {
      transport = existing;
    } else {
      res.status(400).json({ jsonrpc: "2.0", error: { code: -32000, message: "Session uses a different transport" }, id: null });
      return;
    }
  } else if (!sessionId && req.method === "POST" && isInitializeRequest(req.body)) {
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid) => {
        transports.set(sid, transport);
      },
    });
    transport.onclose = () => {
      const sid = transport.sessionId;
      if (sid) transports.delete(sid);
    };
    const server = createMcpServer();
    await server.connect(transport);
  } else {
    res.status(400).json({ jsonrpc: "2.0", error: { code: -32000, message: "Bad Request: No valid session ID" }, id: null });
    return;
  }

  await transport.handleRequest(req, res, req.body);
});

// --- Legacy SSE (protocol version 2024-11-05) ---

app.get("/sse", async (req, res) => {
  console.log("📡 New MCP SSE connection");
  const transport = new SSEServerTransport("/message", res);
  const sessionId = transport.sessionId;
  transports.set(sessionId, transport);

  const server = createMcpServer();

  res.on("close", () => {
    console.log(`📡 SSE connection closed: ${sessionId}`);
    transports.delete(sessionId);
  });

  await server.connect(transport);
});

app.post("/message", async (req, res) => {
  const sessionId = req.query.sessionId as string;
  const transport = transports.get(sessionId);
  if (!transport || !(transport instanceof SSEServerTransport)) {
    res.status(400).json({ error: "Unknown session" });
    return;
  }
  await transport.handlePostMessage(req, res);
});

// ─── Start ──────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`
🎵 Apple Music MCP Server v1.2.0
   Port:       ${PORT}
   Server URL: ${SERVER_URL}
   Storefront: ${STOREFRONT}
   OAuth 2.1:  ${SERVER_URL}/.well-known/oauth-authorization-server
   MCP:        ${SERVER_URL}/mcp (Streamable HTTP + OAuth)
   MCP SSE:    ${SERVER_URL}/sse (legacy, no auth)
   Apple Auth: ${SERVER_URL}/auth
   Health:     ${SERVER_URL}/health
   User token: ${client.hasUserToken() ? "✅" : "❌ visit /auth"}
   Tools:      14 (6 catalog + 8 library/personal)
`);
});
