import express from "express";
import cookieParser from "cookie-parser";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import jwt from "jsonwebtoken";
import {
  createDeveloperToken,
  AppleMusicClient,
  AppleMusicOAuthProvider,
  generateQuiz,
  createQuizSession, getPublicState, addParticipant, removeParticipant,
  getQuizSession, nextQuestion, revealAnswer, awardPoint, showScores, stopQuiz, listActiveSessions,
  attachHomeWebSocket, sendHomeCommand, isHomeConnected,
  loadMusicUserToken, saveMusicUserToken,
} from "@music-quiz/quiz-engine";
import { fileURLToPath } from "url";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Workspace root: packages/mcp-server/dist/ → ../../../
const WORKSPACE_ROOT = path.resolve(__dirname, "..", "..", "..");
const PORT = parseInt(process.env.PORT || "3000");
const STOREFRONT = process.env.APPLE_STOREFRONT || "dk";
const SERVER_URL = process.env.SERVER_URL || `http://localhost:${PORT}`;
// Home controller connects via WebSocket — see home-ws.ts

// ─── Music User Token store ────────────────────────────────
// Persisted to disk via token-store.ts (survives deploys).
let musicUserToken: string | null =
  loadMusicUserToken() || process.env.APPLE_MUSIC_USER_TOKEN || null;

const client = new AppleMusicClient(STOREFRONT, () => musicUserToken);

// ─── OAuth 2.1 Provider ────────────────────────────────────
const oauthProvider = new AppleMusicOAuthProvider();

// ─── Express ────────────────────────────────────────────────
const app = express();
app.set("trust proxy", 1); // Trust first proxy (Fly.io)
app.use(express.json());
app.use(cookieParser());

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

// Allow dotfiles in absolute paths — needed for git worktrees under .claude/worktrees/
app.use(express.static(path.join(WORKSPACE_ROOT, "public"), { dotfiles: "allow" }));

// Serve /auth → auth.html (Apple Music user token flow)
app.get("/auth", (_req, res) => {
  res.sendFile(path.join(WORKSPACE_ROOT, "public", "auth.html"), { dotfiles: "allow" });
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

// ─── Admin API key check ───────────────────────────────────
// Protects /api/* endpoints. Uses HOME_API_KEY as shared secret.
const ADMIN_API_KEY = process.env.HOME_API_KEY || "";

function requireAdminKey(req: express.Request, res: express.Response, next: express.NextFunction) {
  const key = req.headers["x-api-key"] as string;
  if (!ADMIN_API_KEY || !key) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  // Timing-safe comparison
  const a = Buffer.from(key);
  const b = Buffer.from(ADMIN_API_KEY);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

// Serve developer token to the auth page
app.get("/api/developer-token", requireAdminKey, (_req, res) => {
  try {
    const token = createDeveloperToken();
    res.json({ token });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Receive Music User Token from MusicKit JS auth flow
app.post("/api/auth", requireAdminKey, (req, res) => {
  const { token } = req.body;
  if (!token || typeof token !== "string") {
    res.status(400).json({ error: "Missing token" });
    return;
  }
  musicUserToken = token;
  saveMusicUserToken(token);
  console.log("✅ Music User Token received and stored");
  res.json({ success: true });
});

// ─── GitHub OAuth (Express-side) ───────────────────────────

// ─── Session auth (GitHub OAuth cookie) ────────────────────

function requireSession(req: express.Request, res: express.Response, next: express.NextFunction) {
  const token = req.cookies?.["music-session"];
  if (!token) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    jwt.verify(token, process.env.SESSION_SECRET || "dev-session-secret-change-me!!!!!");
    next();
  } catch {
    res.status(401).json({ error: "Unauthorized" });
  }
}

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || "";
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || "";
const GITHUB_ALLOWED_EMAIL = process.env.GITHUB_ALLOWED_EMAIL || "cb@webhouse.dk";

app.get("/api/auth/github", (_req, res) => {
  if (!GITHUB_CLIENT_ID) { res.status(500).send("GitHub OAuth not configured"); return; }

  // Dev mode: auto-login without GitHub
  if (process.env.NODE_ENV !== "production" && SERVER_URL.includes("localhost")) {
    const sessionToken = jwt.sign(
      { email: "cb@webhouse.dk", name: "Christian (dev)", avatarUrl: "" },
      process.env.SESSION_SECRET || "dev-session-secret-change-me!!!!!",
      { expiresIn: "30d" },
    );
    res.cookie("music-session", sessionToken, { httpOnly: true, sameSite: "lax", maxAge: 30 * 24 * 60 * 60 * 1000, path: "/" });
    res.redirect("/");
    return;
  }

  const params = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    redirect_uri: `${SERVER_URL}/api/auth/callback`,
    scope: "user:email",
    state: randomUUID(),
  });
  res.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

app.get("/api/auth/callback", async (req, res) => {
  const code = req.query.code as string;
  if (!code) { res.status(400).send("Missing code"); return; }

  // Exchange code for token
  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: GITHUB_CLIENT_ID, client_secret: GITHUB_CLIENT_SECRET, code }),
  });
  const tokenData = await tokenRes.json() as { access_token?: string };
  if (!tokenData.access_token) { res.redirect("/login?error=token_failed"); return; }

  // Get user emails
  const emailsRes = await fetch("https://api.github.com/user/emails", {
    headers: { Authorization: `Bearer ${tokenData.access_token}`, Accept: "application/vnd.github+json" },
  });
  const emails = await emailsRes.json() as Array<{ email: string; primary: boolean }>;
  const primaryEmail = emails.find((e) => e.primary)?.email || emails[0]?.email;

  if (!primaryEmail || primaryEmail.toLowerCase() !== GITHUB_ALLOWED_EMAIL.toLowerCase()) {
    res.redirect("/login?error=unauthorized");
    return;
  }

  // Get user profile
  const userRes = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const user = await userRes.json() as { name?: string; login?: string; avatar_url?: string };

  // Set a signed cookie as session
  const sessionToken = jwt.sign(
    { email: primaryEmail, name: user.name || user.login, avatarUrl: user.avatar_url },
    process.env.SESSION_SECRET || "dev-session-secret-change-me!!!!!",
    { expiresIn: "30d" },
  );

  res.cookie("music-session", sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: "/",
  });

  res.redirect("/");
});

app.get("/api/auth/session", (req, res) => {
  const token = req.cookies?.["music-session"];
  if (!token) { res.json({ isLoggedIn: false }); return; }
  try {
    const data = jwt.verify(token, process.env.SESSION_SECRET || "dev-session-secret-change-me!!!!!") as Record<string, unknown>;
    res.json({ isLoggedIn: true, name: data.name, avatarUrl: data.avatarUrl });
  } catch {
    res.json({ isLoggedIn: false });
  }
});

app.post("/api/auth/logout", (_req, res) => {
  res.clearCookie("music-session");
  res.json({ ok: true });
});

// ─── Quiz API (Express-side, used by Next.js frontend) ─────

app.get("/api/quiz/sessions", (_req, res) => {
  res.json(listActiveSessions());
});

app.post("/api/quiz/play-pause", async (_req, res) => {
  try {
    if (!isHomeConnected()) { res.status(503).json({ error: "Home Controller not connected" }); return; }
    const result = await sendHomeCommand("play", {});
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post("/api/quiz/create", requireSession, async (req, res) => {
  try {
    const { type, source, count, timerDuration, decade, genre, artist } = req.body;
    const quiz = await generateQuiz(client, { type, source, count, genre, artist, decade });
    const session = createQuizSession(quiz, timerDuration || 30);

    // Pre-load all quiz songs to library in background
    const songIds = quiz.questions.map((q) => q.songId).filter(Boolean);
    if (songIds.length > 0 && client.hasUserToken()) {
      client.addToLibrary({ songs: songIds })
        .then(() => console.log(`🎵 Pre-loaded ${songIds.length} quiz songs to library`))
        .catch((err) => console.error("🎵 Pre-load failed:", err));
    }

    res.json(getPublicState(session));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get("/api/quiz/:id", (req, res) => {
  const session = getQuizSession(String(req.params.id));
  if (!session) { res.status(404).json({ error: "Not found" }); return; }
  res.json(getPublicState(session));
});

app.patch("/api/quiz/:id", requireSession, (req, res) => {
  const id = String(req.params.id);
  const { action: act, name } = req.body;

  let session;
  switch (act) {
    case "add-participant": session = addParticipant(id, String(name)); break;
    case "remove-participant": session = removeParticipant(id, String(name)); break;
    case "next-question": {
      const r = nextQuestion(id);
      session = r?.session ?? getQuizSession(id) ?? undefined;
      // Auto-play the song for this question
      if (r && isHomeConnected()) {
        const q = r.question;
        console.log(`🎵 Quiz: playing "${q.songName}" by ${q.artistName} (id: ${q.songId})`);
        // Add song to library first (ensures it's playable), then search-and-play
        (async () => {
          try {
            // Add to library so it's playable
            await client.addToLibrary({ songs: [q.songId] });
            // Simplify search name: remove (feat. ...), [Mono], etc.
            const simpleName = q.songName.replace(/\s*[\(\[].*?[\)\]]/g, "").trim();
            const artist = q.artistName.split(/[,&]/)[0].trim();
            // Songs are pre-loaded at quiz creation, short retry for sync
            for (const delay of [500, 1500, 3000]) {
              await new Promise((resolve) => setTimeout(resolve, delay));
              // Try song name + artist first, then just song name
              for (const query of [`${simpleName} ${artist}`, simpleName]) {
                console.log(`🎵 Quiz: trying "${query}" (after ${delay}ms)`);
                const result = await sendHomeCommand("search-and-play", { query, randomSeek: true }) as { error?: string; playing?: string };
                if (result.playing) {
                  console.log(`🎵 Quiz playback: ${result.playing}`);
                  return;
                }
              }
            }
            console.error("🎵 Quiz: all retries failed for", q.songName);
          } catch (err) {
            console.error("🎵 Quiz playback failed:", err);
          }
        })();
      } else {
        console.log(`🎵 Quiz: no playback (r=${!!r}, home=${isHomeConnected()})`);
      }
      break;
    }
    case "reveal": {
      const r = revealAnswer(id);
      session = r?.session;
      break;
    }
    case "award-point": session = awardPoint(id, String(name)); break;
    case "scores": session = showScores(id); break;
    case "stop-quiz": session = stopQuiz(id); break;
    default: res.status(400).json({ error: "Unknown action" }); return;
  }
  if (!session) { res.status(404).json({ error: "Quiz not found" }); return; }
  res.json(getPublicState(session));
});

// Check auth status
app.get("/api/auth/status", requireAdminKey, (_req, res) => {
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

  // Tool: recently_played_tracks
  server.tool(
    "recently_played_tracks",
    "Get the user's recently played tracks with full song details (up to 50). More detailed than recently_played which returns albums/playlists too.",
    {
      limit: z
        .number()
        .min(1)
        .max(50)
        .optional()
        .describe("Number of tracks. Default: 10, max: 50"),
    },
    async ({ limit }) => {
      if (!client.hasUserToken()) {
        return {
          content: [{ type: "text", text: "❌ Not authorized. Visit /auth first." }],
        };
      }
      const data = await client.getRecentlyPlayedTracks(limit || 10);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // Tool: replay
  server.tool(
    "replay",
    "Get the user's Apple Music Replay data — their top songs, artists, and albums for the year, ranked by play count. This is the best way to find a user's all-time favorites.",
    {},
    async () => {
      if (!client.hasUserToken()) {
        return {
          content: [{ type: "text", text: "❌ Not authorized. Visit /auth first." }],
        };
      }
      const data = await client.getReplay();
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // Tool: get_playlist_tracks
  server.tool(
    "get_playlist_tracks",
    "Get all tracks in a user's library playlist. Use list_playlists first to find the playlist ID.",
    {
      playlist_id: z.string().describe("Library playlist ID (from list_playlists)"),
    },
    async ({ playlist_id }) => {
      if (!client.hasUserToken()) {
        return {
          content: [{ type: "text", text: "❌ Not authorized. Visit /auth first." }],
        };
      }
      const data = await client.getPlaylistTracks(playlist_id);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // Tool: add_to_library
  server.tool(
    "add_to_library",
    "Add songs, albums, or playlists from the Apple Music catalog to the user's personal library.",
    {
      song_ids: z.array(z.string()).optional().describe("Catalog song IDs to add"),
      album_ids: z.array(z.string()).optional().describe("Catalog album IDs to add"),
      playlist_ids: z.array(z.string()).optional().describe("Catalog playlist IDs to add"),
    },
    async ({ song_ids, album_ids, playlist_ids }) => {
      if (!client.hasUserToken()) {
        return {
          content: [{ type: "text", text: "❌ Not authorized. Visit /auth first." }],
        };
      }
      if (!song_ids?.length && !album_ids?.length && !playlist_ids?.length) {
        return {
          content: [{ type: "text", text: "❌ Provide at least one song_ids, album_ids, or playlist_ids." }],
        };
      }
      await client.addToLibrary({ songs: song_ids, albums: album_ids, playlists: playlist_ids });
      const count = (song_ids?.length || 0) + (album_ids?.length || 0) + (playlist_ids?.length || 0);
      return {
        content: [{ type: "text", text: `✅ Added ${count} item(s) to library.` }],
      };
    }
  );

  // Tool: get_song_details
  server.tool(
    "get_song_details",
    "Get full details for one or more songs from the Apple Music catalog by their IDs, including artwork, preview URL, and release date.",
    {
      song_ids: z.array(z.string()).min(1).max(50).describe("Catalog song IDs"),
    },
    async ({ song_ids }) => {
      const data = await client.getSongDetails(song_ids);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // Tool: get_album_details
  server.tool(
    "get_album_details",
    "Get full details for an album from the Apple Music catalog, including all tracks, artwork, editorial notes, and release info.",
    {
      album_id: z.string().describe("Catalog album ID"),
    },
    async ({ album_id }) => {
      const data = await client.getAlbumDetails(album_id);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ═══════════════════════════════════════════════════════════
  // QUIZ TOOLS
  // ═══════════════════════════════════════════════════════════

  server.tool(
    "music_quiz",
    `Generate a music quiz! Returns structured quiz data with questions, song IDs for playback, answers, and hints.

Quiz types: guess-the-artist, guess-the-song, guess-the-album, guess-the-year, intro-quiz, mixed
Sources: recently-played, heavy-rotation, library, charts, catalog-artist

After generating, use play/search_and_play to play each song, ask the question, wait for the answer, then reveal and move to next.
Give hints if the player is stuck. Keep score and announce the winner at the end.`,
    {
      type: z.enum(["guess-the-artist", "guess-the-song", "guess-the-album", "guess-the-year", "intro-quiz", "mixed"])
        .optional()
        .describe("Quiz type. Default: mixed"),
      source: z.enum(["recently-played", "heavy-rotation", "library", "charts", "catalog-artist"])
        .optional()
        .describe("Where to get songs from. Default: recently-played"),
      count: z.number().min(3).max(25).optional()
        .describe("Number of questions. Default: 10"),
      genre: z.string().optional()
        .describe("Genre ID for charts source (use get_genres to find IDs)"),
      artist: z.string().optional()
        .describe("Artist ID for catalog-artist source (use search_catalog to find)"),
      decade: z.string().optional()
        .describe("Filter by decade, e.g. '1980' for 80s music"),
    },
    async ({ type, source, count, genre, artist, decade }) => {
      if (source === "recently-played" || source === "heavy-rotation" || source === "library") {
        if (!client.hasUserToken()) {
          return { content: [{ type: "text", text: "❌ Not authorized. Visit /auth first." }] };
        }
      }
      const quiz = await generateQuiz(client, { type, source, count, genre, artist, decade });
      return {
        content: [{
          type: "text",
          text: JSON.stringify(quiz, null, 2),
        }],
      };
    }
  );

  // Tool: create_visual_quiz
  server.tool(
    "create_visual_quiz",
    `Create a visual music quiz with a shareable URL for display on a TV/monitor.
Opens a quiz lobby where participants are added, then the game starts with visual questions, countdown timer, and scoreboard.
Returns the quiz URL to open on a big screen. Control the quiz from this chat or from the web UI.`,
    {
      type: z.enum(["guess-the-artist", "guess-the-song", "guess-the-album", "guess-the-year", "intro-quiz", "mixed"])
        .optional().describe("Quiz type. Default: mixed"),
      source: z.enum(["recently-played", "heavy-rotation", "library", "charts", "catalog-artist"])
        .optional().describe("Music source. Default: recently-played"),
      count: z.number().min(3).max(25).optional().describe("Number of questions. Default: 10"),
      timer_duration: z.number().min(10).max(120).optional().describe("Seconds per question. Default: 30"),
      participants: z.array(z.string()).optional().describe("Player names to add to the quiz"),
      decade: z.string().optional().describe("Filter by decade, e.g. '1980'"),
    },
    async ({ type, source, count, timer_duration, participants, decade }) => {
      if (source === "recently-played" || source === "heavy-rotation" || source === "library") {
        if (!client.hasUserToken()) {
          return { content: [{ type: "text", text: "❌ Not authorized. Visit /auth first." }] };
        }
      }
      const quiz = await generateQuiz(client, { type, source, count, decade });
      const session = createQuizSession(quiz, timer_duration || 30);

      if (participants) {
        for (const name of participants) {
          addParticipant(session.id, name);
        }
      }

      const url = `${SERVER_URL}/quiz/${session.id}`;
      const state = getPublicState(session);

      return {
        content: [{
          type: "text",
          text: `🎵 Visual Quiz created!\n\n` +
            `**${quiz.title}** — ${quiz.questionCount} questions\n` +
            `Open on TV/monitor: ${url}\n\n` +
            `Players: ${state.participants.map((p: { name: string }) => p.name).join(", ") || "none yet"}\n` +
            `Timer: ${timer_duration || 30}s per question\n\n` +
            `Quiz ID: ${session.id}\n` +
            JSON.stringify(state, null, 2),
        }],
      };
    }
  );

  // ═══════════════════════════════════════════════════════════
  // PLAYBACK TOOLS (requires home controller)
  // ═══════════════════════════════════════════════════════════

  const noHome = { content: [{ type: "text" as const, text: "❌ Home controller not connected. Start the home agent on your Mac." }] };

  // Tool: now_playing
  server.tool(
    "now_playing",
    "See what's currently playing on the home Mac's Music app, including track name, artist, album, and playback position.",
    {},
    async () => {
      if (!isHomeConnected()) return noHome;
      const data = await sendHomeCommand("now-playing");
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // Tool: play
  server.tool(
    "play",
    "Start or resume playback on the home Mac. Optionally play a specific track by name from the library.",
    {
      track_name: z.string().optional().describe("Track name to search and play from library"),
    },
    async ({ track_name }) => {
      if (!isHomeConnected()) return noHome;
      const data = await sendHomeCommand("play", track_name ? { track_name } : {});
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // Tool: pause
  server.tool(
    "pause",
    "Pause playback on the home Mac.",
    {},
    async () => {
      if (!isHomeConnected()) return noHome;
      const data = await sendHomeCommand("pause");
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // Tool: next_track
  server.tool(
    "next_track",
    "Skip to the next track on the home Mac.",
    {},
    async () => {
      if (!isHomeConnected()) return noHome;
      const data = await sendHomeCommand("next");
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // Tool: previous_track
  server.tool(
    "previous_track",
    "Go back to the previous track on the home Mac.",
    {},
    async () => {
      if (!isHomeConnected()) return noHome;
      const data = await sendHomeCommand("previous");
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // Tool: set_volume
  server.tool(
    "set_volume",
    "Set or get the Music app volume on the home Mac (0-100).",
    {
      level: z.number().min(0).max(100).optional().describe("Volume level 0-100. Omit to get current volume."),
    },
    async ({ level }) => {
      if (!isHomeConnected()) return noHome;
      const data = level !== undefined
        ? await sendHomeCommand("volume", { level })
        : await sendHomeCommand("volume");
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // Tool: search_and_play
  server.tool(
    "search_and_play",
    "Search the user's Music library on the home Mac and play the first matching track.",
    {
      query: z.string().describe("Search query (artist, song name, etc.)"),
    },
    async ({ query }) => {
      if (!isHomeConnected()) return noHome;
      const data = await sendHomeCommand("search-and-play", { query });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // Tool: play_playlist
  server.tool(
    "play_playlist_on_mac",
    "Play a playlist by name on the home Mac's Music app.",
    {
      name: z.string().describe("Playlist name"),
    },
    async ({ name }) => {
      if (!isHomeConnected()) return noHome;
      const data = await sendHomeCommand("play-playlist", { name });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // Tool: shuffle
  server.tool(
    "shuffle",
    "Enable or disable shuffle on the home Mac's Music app.",
    {
      enabled: z.boolean().optional().describe("true/false. Omit to get current state."),
    },
    async ({ enabled }) => {
      if (!isHomeConnected()) return noHome;
      const data = enabled !== undefined
        ? await sendHomeCommand("shuffle", { enabled })
        : await sendHomeCommand("shuffle");
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // Tool: airplay_devices
  server.tool(
    "airplay_devices",
    "List all available AirPlay devices (Apple TVs, HomePods, speakers) from the home Mac.",
    {},
    async () => {
      if (!isHomeConnected()) return noHome;
      const data = await sendHomeCommand("airplay-devices");
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // Tool: set_airplay
  server.tool(
    "set_airplay",
    "Enable or disable an AirPlay device for playback from the home Mac. Use airplay_devices to see available devices.",
    {
      device: z.string().describe("AirPlay device name (e.g. 'Stue Apple TV')"),
      enabled: z.boolean().optional().describe("true to enable, false to disable. Default: true"),
    },
    async ({ device, enabled }) => {
      if (!isHomeConnected()) return noHome;
      const data = await sendHomeCommand("airplay", { device, enabled: enabled ?? true });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // Tool: set_airplay_volume
  server.tool(
    "set_airplay_volume",
    "Set the volume for a specific AirPlay device.",
    {
      device: z.string().describe("AirPlay device name"),
      level: z.number().min(0).max(100).describe("Volume level 0-100"),
    },
    async ({ device, level }) => {
      if (!isHomeConnected()) return noHome;
      const data = await sendHomeCommand("airplay-volume", { device, level });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // Tool: auth_status
  server.tool(
    "auth_status",
    "Check if the user has authorized Apple Music access and if the home controller is connected.",
    {},
    async () => {
      const lines = [];
      lines.push(client.hasUserToken()
        ? "✅ Apple Music: Authorized"
        : "❌ Apple Music: Not authorized. Visit /auth to sign in.");
      if (isHomeConnected()) {
        try {
          const health = await sendHomeCommand("health") as { host?: string };
          lines.push(`✅ Home Controller: Connected (${health.host || "unknown"})`);
        } catch {
          lines.push("❌ Home Controller: Error");
        }
      } else {
        lines.push("❌ Home Controller: Not connected");
      }
      return { content: [{ type: "text", text: lines.join("\n") }] };
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
  } else if (sessionId && !transports.has(sessionId)) {
    // Session was lost (server restart, idle cleanup). Return 404 so client re-initializes.
    res.status(404).json({ jsonrpc: "2.0", error: { code: -32001, message: "Session not found. Please re-initialize." }, id: null });
    return;
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

app.get("/sse", requireAdminKey, async (req, res) => {
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

app.post("/message", requireAdminKey, async (req, res) => {
  const sessionId = req.query.sessionId as string;
  const transport = transports.get(sessionId);
  if (!transport || !(transport instanceof SSEServerTransport)) {
    res.status(400).json({ error: "Unknown session" });
    return;
  }
  await transport.handlePostMessage(req, res);
});

// ─── Export for custom server ──────────────────────────────

export { app, client, attachHomeWebSocket, PORT, SERVER_URL, STOREFRONT };

export function logStartup() {
  console.log(`
🎵 Music Quiz v3.0.0
   Port:       ${PORT}
   Server URL: ${SERVER_URL}
   Storefront: ${STOREFRONT}
   OAuth 2.1:  ${SERVER_URL}/.well-known/oauth-authorization-server
   MCP:        ${SERVER_URL}/mcp (Streamable HTTP + OAuth)
   MCP SSE:    ${SERVER_URL}/sse (API key)
   Apple Auth: ${SERVER_URL}/auth
   Health:     ${SERVER_URL}/health
   User token: ${client.hasUserToken() ? "✅" : "❌ visit /auth"}
   Home ctrl:  WebSocket /home-ws (agent connects here)
   Tools:      34 (8 catalog + 12 library + 2 quiz + 12 playback)
`);
}

// ─── Standalone execution ──────────────────────────────────

if (process.argv[1]?.endsWith("index.js")) {
  const server = app.listen(PORT, () => logStartup());
  attachHomeWebSocket(server);
}
