import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import { createDeveloperToken } from "./token.js";
import { AppleMusicClient } from "./apple-music.js";
import { fileURLToPath } from "url";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || "3000");
const STOREFRONT = process.env.APPLE_STOREFRONT || "dk";

// ─── Music User Token store ────────────────────────────────
// Persisted in memory; re-authorize via /auth when it expires.
let musicUserToken: string | null = process.env.APPLE_MUSIC_USER_TOKEN || null;

const client = new AppleMusicClient(STOREFRONT, () => musicUserToken);

// ─── Express ────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

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
    version: "1.0.0",
  });

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
            text: `✅ Playlist \"${name}\" created with ${track_ids.length} tracks.\n\n${JSON.stringify(result, null, 2)}`,
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
              ? "✅ Authorized – playlist creation is available."
              : "❌ Not authorized. User needs to visit the /auth page and sign in with Apple Music.",
          },
        ],
      };
    }
  );

  return server;
}

// ─── SSE Transport for MCP ──────────────────────────────────
// Each client connection gets its own transport instance.

const transports = new Map<string, SSEServerTransport>();

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
  if (!transport) {
    res.status(400).json({ error: "Unknown session" });
    return;
  }
  await transport.handlePostMessage(req, res);
});

// ─── Start ──────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`
🎵 Apple Music MCP Server
   Port:       ${PORT}
   Storefront: ${STOREFRONT}
   Auth:       http://localhost:${PORT}/auth
   MCP SSE:    http://localhost:${PORT}/sse
   Health:     http://localhost:${PORT}/health
   User token: ${client.hasUserToken() ? "✅" : "❌ visit /auth"}
`);
});
