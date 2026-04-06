/**
 * Quiz Express Routes
 *
 * Serves static files for host UI and player PWA.
 * Also provides REST API for session info (used by player join validation).
 */

import { Router, json } from "express";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { getSessionByCode, listActiveSessions, clearUsedSongs, getAddedToLibrary, clearAddedToLibrary, createParty, listParties, endParty, getParty, getPartyByCode } from "./engine.js";
import { isMuted, setMuted } from "./mute.js";
import { getAllEvents, getEvent, createEvent as createStoredEvent, updateEvent, deleteEvent } from "./event-store.js";
import { sendHomeCommand, isHomeConnected } from "./home-ws.js";
import { createDeveloperToken } from "./token.js";
import { getActiveProviderType, getProvider, setActiveProvider } from "./playback/provider-manager.js";
import type { ProviderType } from "./playback/provider-manager.js";
import { pushNowPlaying as pushNowPlayingData, trackChangeLog } from "./browser-ws.js";
import { getAllPlaylists, getPlaylist, savePlaylist, updatePlaylist, deletePlaylist } from "./playlist-store.js";
import { getBankSize } from "./question-bank.js";
import { getGossipBankSize } from "./gossip-bank.js";
import type { AppleMusicClient } from "./apple-music.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// In dist: packages/quiz-engine/dist/routes.js → need packages/quiz-engine/src/public/
const packageRoot = resolve(__dirname, "..");
const publicDir = resolve(packageRoot, "src", "public");
// Allow dotfiles in absolute paths — needed for git worktrees under .claude/worktrees/
const SEND_OPTS = { dotfiles: "allow" as const };

export function createQuizRouter(musicClient?: AppleMusicClient): Router {
  const router = Router();

  // Ensure JSON body parsing for quiz API routes
  router.use(json());

  // Host UI — redirects to admin (quiz display merged into admin)
  router.get("/quiz/host", (req, res) => {
    const query = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
    res.redirect("/quiz/admin" + query);
  });

  // Player PWA
  router.get("/quiz/play", (_req, res) => {
    res.sendFile(join(publicDir, "play.html"), SEND_OPTS);
  });

  // PWA manifest
  router.get("/quiz/manifest.json", (_req, res) => {
    res.sendFile(join(publicDir, "manifest.json"), SEND_OPTS);
  });

  // Service worker
  router.get("/quiz/sw.js", (_req, res) => {
    res.setHeader("Content-Type", "application/javascript");
    res.sendFile(join(publicDir, "sw.js"), SEND_OPTS);
  });

  // Static assets (CSS, JS)
  router.get("/quiz/static/:file", (req, res) => {
    const file = String(req.params.file).replace(/\.\./g, "");
    res.sendFile(join(publicDir, file), SEND_OPTS);
  });

  // Sound effects
  router.get("/quiz/sounds/:file", (req, res) => {
    const file = String(req.params.file).replace(/\.\./g, "");
    res.sendFile(join(publicDir, "sounds", file), SEND_OPTS);
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
    res.sendFile(join(publicDir, "admin.html"), SEND_OPTS);
  });

  // Now Playing page (vanilla, same design as Next.js frontpage)
  router.get("/quiz/now-playing", (_req, res) => {
    res.sendFile(join(publicDir, "now-playing.html"), SEND_OPTS);
  });

  // Admin API: recently played tracks (from track change log — persisted to disk)
  router.get("/quiz/api/admin/recent-tracks", (_req, res) => {
    const tracks = [...trackChangeLog].reverse().map((t) => ({
      id: "",
      name: t.track,
      artistName: t.artist,
      albumName: "",
      artworkUrl: t.artworkUrl || "",
    }));
    res.json({ tracks });
  });

  // Play log: tracks what was requested vs what actually played
  const playLog: Array<{ ts: string; requested: { name: string; artist: string; songId?: string }; result: string; actualTrack?: string }> = [];

  // Admin API: play a track via active provider or return songId for client-side playback
  router.post("/quiz/api/admin/play", async (req, res) => {
    const { name, artist, songId } = req.body;
    const provider = getProvider();
    const logEntry = { ts: new Date().toISOString(), requested: { name, artist, songId }, result: "", actualTrack: "" };

    // If provider is musickit-web, tell client to play locally (browser has MusicKit JS)
    if (getActiveProviderType() === "musickit-web" || !provider.isAvailable()) {
      logEntry.result = "play-client";
      playLog.push(logEntry);
      res.json({ action: "play-client", songId, name, artist });
      return;
    }

    // Home Controller path — play exact with full name first
    try {
      const simpleName = name.replace(/\s*[\(\[].*?[\)\]]/g, "").trim();
      const simpleArtist = artist.split(/[,&]/)[0].trim();

      // Try full name first (matches library entry with "(Remastered 2003)" etc.)
      let exactResult = await provider.playExact(name, artist).catch(() => ({ playing: false })) as { playing: boolean; track?: string };
      if (!exactResult.playing) {
        exactResult = await provider.playExact(simpleName, simpleArtist).catch(() => ({ playing: false })) as { playing: boolean; track?: string };
      }

      // If not in library and we have songId, add to library + retry once
      if (!exactResult.playing && songId && musicClient?.hasUserToken()) {
        console.log(`🎵 Not in library — adding "${name}" (${songId})...`);
        await musicClient.addToLibrary({ songs: [songId] }).catch(() => {});
        await new Promise(r => setTimeout(r, 3000));
        exactResult = await provider.playExact(name, artist).catch(() => ({ playing: false })) as { playing: boolean; track?: string };
        if (!exactResult.playing) {
          exactResult = await provider.playExact(simpleName, simpleArtist).catch(() => ({ playing: false })) as { playing: boolean; track?: string };
        }
      }

      logEntry.result = exactResult.playing ? "play-exact" : "not-found";
      playLog.push(logEntry);
      console.log(`🎵 PLAY: "${name}" by "${artist}" → ${exactResult.playing ? "OK" : "FAILED"}`);
      res.json(exactResult.playing
        ? { action: "play-exact", playing: exactResult.track || `${name} — ${artist}` }
        : { error: `Could not find "${name}" by ${artist}` }
      );
    } catch (err) {
      logEntry.result = "error: " + String(err);
      playLog.push(logEntry);
      res.status(500).json({ error: String(err) });
    }
  });

  // Play log viewer (requested vs actual)
  router.get("/quiz/api/admin/play-log", (_req, res) => {
    res.json(playLog.slice(-50));
  });

  // Track change log (everything that actually played)
  router.get("/quiz/api/admin/track-log", (_req, res) => {
    res.json(trackChangeLog.slice(-100));
  });

  // Stats dashboard
  router.get("/quiz/api/admin/stats", async (_req, res) => {
    const events = await getAllEvents();
    const triviaBank = await getBankSize();
    const gossipBank = await getGossipBankSize();
    const playlists = await getAllPlaylists();
    const sessions = listActiveSessions();

    // Count specialized trivia banks
    let danskTrivia = 0;
    let soundtrackTrivia = 0;
    try {
      const { readFileSync } = await import("node:fs");
      const { join } = await import("node:path");
      try {
        const dk = JSON.parse(readFileSync(join(process.cwd(), "data", "quiz-trivia-dk.json"), "utf-8"));
        danskTrivia = Array.isArray(dk) ? dk.length : 0;
      } catch {}
      try {
        const st = JSON.parse(readFileSync(join(process.cwd(), "data", "quiz-trivia-soundtrack.json"), "utf-8"));
        soundtrackTrivia = Array.isArray(st) ? st.length : 0;
      } catch {}
    } catch {}

    res.json({
      triviaBank,
      gossipBank,
      danskTrivia,
      soundtrackTrivia,
      totalQuestions: triviaBank + gossipBank + danskTrivia + soundtrackTrivia,
      events: {
        total: events.length,
        active: events.filter(e => e.status === "active").length,
        completed: events.filter(e => e.status === "completed").length,
        scheduled: events.filter(e => e.status === "scheduled").length,
      },
      playlists: playlists.length,
      activeSessions: sessions.length,
      songsPlayed: trackChangeLog.length,
      playRequests: playLog.length,
    });
  });

  // System audio output (macOS)
  router.get("/quiz/api/admin/audio-output", async (_req, res) => {
    try {
      const { execSync } = await import("node:child_process");
      const raw = execSync("system_profiler SPAudioDataType", { encoding: "utf-8", timeout: 5000 });
      const lines = raw.split("\n");
      let currentDevice: string | null = null;
      let isOutput = false;
      let transport = "";
      for (const line of lines) {
        const stripped = line.trim();
        if (stripped.endsWith(":") && !stripped.includes("=") && stripped !== "Devices:" && stripped !== "Audio:") {
          currentDevice = stripped.replace(/:$/, "");
          isOutput = false;
        }
        if (stripped.includes("Default Output Device: Yes")) isOutput = true;
        if (isOutput && stripped.startsWith("Transport:")) {
          transport = stripped.split(":")[1]?.trim() || "";
          break;
        }
      }
      res.json({ device: currentDevice || "Unknown", transport });
    } catch {
      res.json({ device: "Unknown", transport: "" });
    }
  });

  // Playback control (passes body as params to HC)
  router.post("/quiz/api/admin/playback/:action", async (req, res) => {
    const action = String(req.params.action);
    if (!isHomeConnected()) { res.status(503).json({ error: "Home Controller not connected" }); return; }
    try {
      const result = await sendHomeCommand(action, req.body || {});
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

  // Admin API: list songs we added to library
  router.get("/quiz/api/admin/added-songs", (_req, res) => {
    res.json({ songs: getAddedToLibrary() });
  });

  // Admin API: cleanup — delete songs we added from local library
  router.post("/quiz/api/admin/cleanup-library", async (_req, res) => {
    if (!isHomeConnected()) {
      return res.status(503).json({ error: "Home Controller not connected" });
    }
    const songs = getAddedToLibrary();
    let deleted = 0;
    for (const song of songs) {
      try {
        const result = await sendHomeCommand("delete-from-library", {
          name: song.name, artist: song.artist,
        }, 5000) as { deleted?: number };
        deleted += result.deleted || 0;
      } catch {}
    }
    clearAddedToLibrary();
    res.json({ ok: true, deleted, total: songs.length });
  });

  // ─── Events (persisted) ────────────────────────────────────

  // List all events
  router.get("/quiz/api/events", async (_req, res) => {
    const events = await getAllEvents();
    // Enrich active events with live party data
    for (const ev of events) {
      if (ev.status === "active" && ev.joinCode) {
        const party = getPartyByCode(ev.joinCode);
        if (party) {
          ev.players = [...party.players.values()].map(p => ({
            name: p.name, avatar: p.avatar,
            totalScore: p.score, totalPicks: 0,
          }));
          ev.rounds = party.rounds.map(r => ({
            number: r.number, questionCount: r.questions.length,
            songCount: r.questions.length, completedAt: r.completedAt.toISOString(),
          }));
        }
      }
    }
    res.json(events);
  });

  // Create new event
  router.post("/quiz/api/events", async (req, res) => {
    const { name, playlistId, scheduledAt } = req.body || {};
    if (!name) { res.status(400).json({ error: "Name required" }); return; }
    const event = await createStoredEvent({ name, playlistId, scheduledAt });

    // If active (not scheduled), also create a live party
    if (event.status === "active") {
      const party = createParty("admin", name);
      event.joinCode = party.joinCode;
      await updateEvent(event.id, { joinCode: party.joinCode });
    }
    res.json(event);
  });

  // Get event details
  router.get("/quiz/api/events/:id", async (req, res) => {
    const event = await getEvent(String(req.params.id));
    if (!event) { res.status(404).json({ error: "Event not found" }); return; }
    res.json(event);
  });

  // Update event
  router.put("/quiz/api/events/:id", async (req, res) => {
    // Only pass fields that were explicitly sent (avoid undefined overwriting)
    const body = req.body || {};
    const updates: Record<string, unknown> = {};
    for (const key of ["name", "playlistId", "scheduledAt", "status", "maxRounds"]) {
      if (key in body) updates[key] = body[key];
    }
    const updated = await updateEvent(String(req.params.id), updates as Parameters<typeof updateEvent>[1]);
    if (!updated) { res.status(404).json({ error: "Event not found" }); return; }
    res.json(updated);
  });

  // Complete/end event
  router.post("/quiz/api/events/:id/complete", async (req, res) => {
    const event = await getEvent(String(req.params.id));
    if (!event) { res.status(404).json({ error: "Event not found" }); return; }

    // End live party if exists
    if (event.joinCode) {
      const party = getPartyByCode(event.joinCode);
      if (party) {
        // Save final stats before ending
        await updateEvent(event.id, {
          players: [...party.players.values()].map(p => ({
            name: p.name, avatar: p.avatar,
            totalScore: p.score, totalPicks: 0,
          })),
          rounds: party.rounds.map(r => ({
            number: r.number, questionCount: r.questions.length,
            songCount: r.questions.length, completedAt: r.completedAt.toISOString(),
          })),
        });
        endParty(party.id);
      }
    }
    await updateEvent(event.id, { status: "completed", completedAt: new Date().toISOString() });
    res.json({ ok: true });
  });

  // Delete event
  router.delete("/quiz/api/events/:id", async (req, res) => {
    const event = await getEvent(String(req.params.id));
    if (event?.joinCode) {
      const party = getPartyByCode(event.joinCode);
      if (party) endParty(party.id);
    }
    const ok = await deleteEvent(String(req.params.id));
    if (!ok) { res.status(404).json({ error: "Event not found" }); return; }
    res.json({ ok: true });
  });

  // Play entire playlist via Home Controller
  router.post("/quiz/api/admin/play-playlist/:id", async (req, res) => {
    try {
      const pl = await getPlaylist(String(req.params.id));
      if (!pl || pl.tracks.length === 0) { res.status(404).json({ error: "Playlist empty or not found" }); return; }
      const shuffle = req.body?.shuffle === true;
      const tracks = shuffle ? [...pl.tracks].sort(() => Math.random() - 0.5) : pl.tracks;

      // Play first track — add to library first if songId available, then play exact
      const first = tracks[0];
      const provider = getProvider();
      if (provider.isAvailable()) {
        if (first.id && musicClient?.hasUserToken()) {
          await musicClient.addToLibrary({ songs: [first.id] }).catch(() => {});
          await new Promise(r => setTimeout(r, 500));
        }
        const simpleName = first.name.replace(/\s*[\(\[].*?[\)\]]/g, "").trim();
        const simpleArtist = first.artistName.split(/[,&]/)[0].trim();
        await provider.playExact(simpleName, simpleArtist).catch(() =>
          provider.searchAndPlay(`${simpleName} ${simpleArtist}`)
        );
      }

      // Return full queue for client to manage
      res.json({ playing: first.name, queue: tracks.slice(1).map(t => ({ id: t.id, name: t.name, artistName: t.artistName })), total: tracks.length });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ─── Quiz Builder ─────────────────────────────────────────

  // Builder page
  router.get("/quiz/builder", (_req, res) => {
    res.sendFile(join(publicDir, "builder.html"), SEND_OPTS);
  });

  // Search Apple Music catalog (songs + albums)
  router.get("/quiz/api/builder/search", async (req, res) => {
    if (!musicClient) { res.json({ tracks: [], albums: [] }); return; }
    const q = String(req.query.q || "").trim();
    if (!q) { res.json({ tracks: [], albums: [] }); return; }
    try {
      const data = await musicClient.searchCatalog(q, ["songs", "albums", "artists"], 25) as {
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
          artists?: { data?: Array<{
            id?: string;
            attributes?: {
              name?: string;
              genreNames?: string[];
              artwork?: { url?: string };
            };
          }> };
        };
      };
      const songs = (data.results?.songs?.data || []).map((t) => ({
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
      const artists = (data.results?.artists?.data || []).map((a) => ({
        id: a.id || "",
        name: a.attributes?.name || "",
        genres: (a.attributes?.genreNames || []).join(", "),
        artworkUrl: a.attributes?.artwork?.url?.replace("{w}", "200").replace("{h}", "200") || "",
      }));
      res.json({ songs, tracks: songs, albums, artists });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Get artist info + top songs + albums
  router.get("/quiz/api/artist/:id", async (req, res) => {
    if (!musicClient) { res.json({ artist: null, songs: [], albums: [] }); return; }
    try {
      const artistId = String(req.params.id);

      // Fetch artist info
      const artistData = await musicClient.getArtist(artistId) as {
        id?: string;
        attributes?: { name?: string; genreNames?: string[]; artwork?: { url?: string } };
      };
      const artistName = artistData.attributes?.name || "";
      const artist = {
        id: artistData.id || artistId,
        name: artistName,
        genres: (artistData.attributes?.genreNames || []).join(", "),
        artworkUrl: artistData.attributes?.artwork?.url?.replace("{w}", "600").replace("{h}", "600") || "",
      };

      // Fetch top songs and albums in parallel (both are fault-tolerant)
      const [topSongs, albumSearch] = await Promise.all([
        musicClient.getArtistTopSongs(artistId, 20).catch(() => []) as Promise<Array<{
          id?: string;
          attributes?: {
            name?: string; artistName?: string; albumName?: string;
            releaseDate?: string; artwork?: { url?: string };
            previews?: Array<{ url?: string }>;
          };
        }>>,
        // Use catalog search for albums (artist relationship endpoint can fail)
        musicClient.searchCatalog(artistName, ["albums"], 25).catch(() => ({ results: {} })) as Promise<{
          results?: {
            albums?: { data?: Array<{
              id?: string;
              attributes?: {
                name?: string; artistName?: string; releaseDate?: string;
                trackCount?: number; artwork?: { url?: string };
              };
            }> };
          };
        }>,
      ]);

      // Filter albums to only those by this artist
      const allAlbums = albumSearch.results?.albums?.data || [];
      const albums = allAlbums.filter(a =>
        a.attributes?.artistName?.toLowerCase().includes(artistName.toLowerCase())
      );

      const mappedSongs = (topSongs || []).slice(0, 20).map((t) => ({
        id: t.id || "",
        name: t.attributes?.name || "",
        artistName: t.attributes?.artistName || "",
        albumName: t.attributes?.albumName || "",
        releaseYear: t.attributes?.releaseDate?.substring(0, 4) || "",
        artworkUrl: t.attributes?.artwork?.url?.replace("{w}", "200").replace("{h}", "200") || "",
        previewUrl: t.attributes?.previews?.[0]?.url || "",
      }));
      const mappedAlbums = (albums || []).map((a) => ({
        id: a.id || "",
        name: a.attributes?.name || "",
        artistName: a.attributes?.artistName || "",
        releaseYear: a.attributes?.releaseDate?.substring(0, 4) || "",
        artworkUrl: a.attributes?.artwork?.url?.replace("{w}", "300").replace("{h}", "300") || "",
        trackCount: a.attributes?.trackCount || 0,
      }));
      res.json({ artist, songs: mappedSongs, albums: mappedAlbums });
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
    if (!name || !Array.isArray(tracks)) { res.status(400).json({ error: "Name and tracks required" }); return; }
    const saved = await savePlaylist({ id: req.body.id, name, tracks });
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

  // DJ Mode search uses builder search endpoint directly (player JS calls /quiz/api/builder/search)

  // ─── MusicKit JS ──────────────────────────────────────────

  // Developer token for MusicKit JS (host browser needs this to initialize)
  router.get("/quiz/api/musickit-token", (_req, res) => {
    try {
      const token = createDeveloperToken();
      res.json({ token, storefront: process.env.APPLE_STOREFRONT || "dk" });
    } catch (err) {
      res.status(500).json({ error: "Failed to generate developer token" });
    }
  });

  // Active playback provider info
  router.get("/quiz/api/playback-provider", (_req, res) => {
    res.json({ provider: getActiveProviderType() });
  });

  // Runtime mute toggle (for E2E tests — no server restart needed)
  router.post("/quiz/api/mute", (req, res) => {
    const muted = req.body?.muted === true;
    setMuted(muted);
    res.json({ ok: true, muted });
  });
  router.get("/quiz/api/mute", (_req, res) => {
    res.json({ muted: isMuted() });
  });

  // Set active playback provider (from Admin page)
  router.post("/quiz/api/set-provider", (req, res) => {
    const { provider } = req.body;
    if (provider === "musickit-web" || provider === "home-controller") {
      setActiveProvider(provider as ProviderType);
      res.json({ ok: true, provider });
    } else {
      res.status(400).json({ error: "Unknown provider" });
    }
  });

  // Push now-playing from MusicKit JS (browser → server → all Now Playing pages)
  // Sanitized: only allow known fields with string/number types
  router.post("/quiz/api/now-playing", (req, res) => {
    const b = req.body;
    const sanitized = {
      state: typeof b.state === "string" ? b.state.slice(0, 20) : "stopped",
      track: typeof b.track === "string" ? b.track.slice(0, 200) : undefined,
      artist: typeof b.artist === "string" ? b.artist.slice(0, 200) : undefined,
      album: typeof b.album === "string" ? b.album.slice(0, 200) : undefined,
      artworkUrl: typeof b.artworkUrl === "string" && b.artworkUrl.startsWith("https://") ? b.artworkUrl.slice(0, 500) : undefined,
      duration: typeof b.duration === "number" ? b.duration : 0,
      position: typeof b.position === "number" ? b.position : 0,
    };
    pushNowPlayingData(sanitized);
    res.json({ ok: true });
  });

  return router;
}
