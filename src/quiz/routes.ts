/**
 * Quiz Express Routes
 *
 * Serves static files for host UI and player PWA.
 * Also provides REST API for session info (used by player join validation).
 */

import { Router, json } from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { getSessionByCode, listActiveSessions, clearUsedSongs } from "./engine.js";
import { sendHomeCommand, isHomeConnected } from "../home-ws.js";
import { getAllPlaylists, getPlaylist, savePlaylist, updatePlaylist, deletePlaylist } from "./playlist-store.js";
import type { AppleMusicClient } from "../apple-music.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// In dist: dist/quiz/routes.js → need to reach src/quiz/public/
// Resolve relative to project root (two levels up from dist/quiz/)
const projectRoot = join(__dirname, "..", "..");
const publicDir = join(projectRoot, "src", "quiz", "public");

export function createQuizRouter(musicClient?: AppleMusicClient): Router {
  const router = Router();

  // Ensure JSON body parsing for quiz API routes
  router.use(json());

  // Host UI
  router.get("/quiz/host", (_req, res) => {
    res.sendFile(join(publicDir, "host.html"));
  });

  // Player PWA
  router.get("/quiz/play", (_req, res) => {
    res.sendFile(join(publicDir, "play.html"));
  });

  // PWA manifest
  router.get("/quiz/manifest.json", (_req, res) => {
    res.sendFile(join(publicDir, "manifest.json"));
  });

  // Service worker
  router.get("/quiz/sw.js", (_req, res) => {
    res.setHeader("Content-Type", "application/javascript");
    res.sendFile(join(publicDir, "sw.js"));
  });

  // Static assets (CSS, JS)
  router.get("/quiz/static/:file", (req, res) => {
    const file = String(req.params.file).replace(/\.\./g, "");
    res.sendFile(join(publicDir, file));
  });

  // Session info API (for player join validation)
  router.get("/quiz/api/session/:code", (req, res) => {
    const code = String(req.params.code).toUpperCase();
    const session = getSessionByCode(code);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    res.json({
      joinCode: session.joinCode,
      state: session.state,
      playerCount: session.players.size,
      maxPlayers: 8,
      questionCount: session.questions.length,
      config: {
        quizType: session.config.quizType,
        answerMode: session.config.answerMode,
        timeLimit: session.config.timeLimit,
      },
    });
  });

  // List active sessions (for admin/debug)
  router.get("/quiz/api/sessions", (_req, res) => {
    res.json(listActiveSessions());
  });

  // Admin page
  router.get("/quiz/admin", (_req, res) => {
    res.sendFile(join(publicDir, "admin.html"));
  });

  // Admin API: recently played tracks with artwork
  router.get("/quiz/api/admin/recent-tracks", async (_req, res) => {
    if (!musicClient) {
      res.json({ tracks: [] });
      return;
    }
    try {
      const data = await musicClient.getRecentlyPlayedTracks(50) as {
        data?: Array<{
          id?: string;
          attributes?: {
            name?: string;
            artistName?: string;
            albumName?: string;
            artwork?: { url?: string };
          };
        }>;
      };
      const tracks = (data.data || []).map((t) => ({
        id: t.id || "",
        name: t.attributes?.name || "",
        artistName: t.attributes?.artistName || "",
        albumName: t.attributes?.albumName || "",
        artworkUrl: t.attributes?.artwork?.url
          ?.replace("{w}", "200").replace("{h}", "200") || "",
      }));
      res.json({ tracks });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Admin API: play a track via Home Controller
  router.post("/quiz/api/admin/play", async (req, res) => {
    const { name, artist, songId } = req.body;
    if (!isHomeConnected()) {
      res.status(503).json({ error: "Home Controller not connected" });
      return;
    }
    try {
      // Add to library first so search-and-play can find it
      if (songId && musicClient?.hasUserToken()) {
        await musicClient.addToLibrary({ songs: [songId] }).catch(() => {});
        // Brief delay for library sync
        await new Promise(r => setTimeout(r, 500));
      }

      // Simplify search: remove (feat. ...), [Remastered], etc.
      const simpleName = name.replace(/\s*[\(\[].*?[\)\]]/g, "").trim();
      const simpleArtist = artist.split(/[,&]/)[0].trim();

      // Try multiple queries with artist hint for precise matching
      for (const query of [`${simpleName} ${simpleArtist}`, simpleName, `${name} ${artist}`]) {
        const result = await sendHomeCommand("search-and-play", { query, artist: simpleArtist }) as { playing?: string; error?: string };
        if (result.playing) {
          res.json({ action: "search-and-play", playing: result.playing });
          return;
        }
      }
      res.json({ error: `Could not find "${name}" by ${artist}` });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Playback control
  router.post("/quiz/api/admin/playback/:action", async (req, res) => {
    const action = String(req.params.action);
    if (!isHomeConnected()) { res.status(503).json({ error: "Home Controller not connected" }); return; }
    try {
      const result = await sendHomeCommand(action, {});
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Admin API: clear used songs
  router.post("/quiz/api/admin/clear-used", (_req, res) => {
    clearUsedSongs();
    res.json({ ok: true });
  });

  // ─── Quiz Builder ─────────────────────────────────────────

  // Builder page
  router.get("/quiz/builder", (_req, res) => {
    res.sendFile(join(publicDir, "builder.html"));
  });

  // Search Apple Music catalog (songs + albums)
  router.get("/quiz/api/builder/search", async (req, res) => {
    if (!musicClient) { res.json({ tracks: [], albums: [] }); return; }
    const q = String(req.query.q || "").trim();
    if (!q) { res.json({ tracks: [], albums: [] }); return; }
    try {
      const data = await musicClient.searchCatalog(q, ["songs", "albums"], 25) as {
        results?: {
          songs?: { data?: Array<{
            id?: string;
            attributes?: {
              name?: string; artistName?: string; albumName?: string;
              releaseDate?: string;
              artwork?: { url?: string };
              previews?: Array<{ url?: string }>;
            };
          }> };
          albums?: { data?: Array<{
            id?: string;
            attributes?: {
              name?: string; artistName?: string;
              releaseDate?: string;
              artwork?: { url?: string };
              trackCount?: number;
            };
          }> };
        };
      };
      const tracks = (data.results?.songs?.data || []).map((t) => ({
        id: t.id || "",
        name: t.attributes?.name || "",
        artistName: t.attributes?.artistName || "",
        albumName: t.attributes?.albumName || "",
        releaseYear: t.attributes?.releaseDate?.substring(0, 4) || "",
        artworkUrl: t.attributes?.artwork?.url?.replace("{w}", "200").replace("{h}", "200") || "",
        previewUrl: t.attributes?.previews?.[0]?.url || "",
      }));
      const albums = (data.results?.albums?.data || []).map((a) => ({
        id: a.id || "",
        name: a.attributes?.name || "",
        artistName: a.attributes?.artistName || "",
        releaseYear: a.attributes?.releaseDate?.substring(0, 4) || "",
        artworkUrl: a.attributes?.artwork?.url?.replace("{w}", "200").replace("{h}", "200") || "",
        trackCount: a.attributes?.trackCount || 0,
      }));
      res.json({ tracks, albums });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Get album tracks
  router.get("/quiz/api/builder/album/:id/tracks", async (req, res) => {
    if (!musicClient) { res.json({ tracks: [] }); return; }
    try {
      const albumTracks = await musicClient.getAlbumTracks(String(req.params.id)) as Array<{
        id?: string;
        attributes?: {
          name?: string; artistName?: string; albumName?: string;
          releaseDate?: string;
          artwork?: { url?: string };
          previews?: Array<{ url?: string }>;
        };
      }>;
      const tracks = albumTracks.map((t) => ({
        id: t.id || "",
        name: t.attributes?.name || "",
        artistName: t.attributes?.artistName || "",
        albumName: t.attributes?.albumName || "",
        releaseYear: t.attributes?.releaseDate?.substring(0, 4) || "",
        artworkUrl: t.attributes?.artwork?.url?.replace("{w}", "200").replace("{h}", "200") || "",
        previewUrl: t.attributes?.previews?.[0]?.url || "",
      }));
      res.json({ tracks });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // List saved playlists
  router.get("/quiz/api/builder/playlists", async (_req, res) => {
    const all = await getAllPlaylists();
    res.json(all);
  });

  // Get single playlist
  router.get("/quiz/api/builder/playlists/:id", async (req, res) => {
    const pl = await getPlaylist(String(req.params.id));
    if (!pl) { res.status(404).json({ error: "Not found" }); return; }
    res.json(pl);
  });

  // Save new playlist
  router.post("/quiz/api/builder/playlists", async (req, res) => {
    const { name, tracks } = req.body;
    if (!name || !tracks?.length) { res.status(400).json({ error: "Name and tracks required" }); return; }
    const saved = await savePlaylist({ name, tracks });
    res.json(saved);
  });

  // Update playlist
  router.put("/quiz/api/builder/playlists/:id", async (req, res) => {
    const { name, tracks } = req.body;
    const updated = await updatePlaylist(String(req.params.id), { name, tracks });
    if (!updated) { res.status(404).json({ error: "Not found" }); return; }
    res.json(updated);
  });

  // Delete playlist
  router.delete("/quiz/api/builder/playlists/:id", async (req, res) => {
    const ok = await deletePlaylist(String(req.params.id));
    if (!ok) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ ok: true });
  });

  return router;
}
