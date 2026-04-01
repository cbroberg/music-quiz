/**
 * Quiz WebSocket Handler
 *
 * Manages real-time communication between host (storskærm) and players (telefoner).
 * Single endpoint /quiz-ws with role-based message routing.
 */

import { WebSocketServer, WebSocket } from "ws";
import { Server, IncomingMessage } from "node:http";
import { parse } from "node:url";
import { randomUUID } from "node:crypto";
import type {
  HostMessage, PlayerMessage,
  ServerToHostMessage, ServerToPlayerMessage,
  GameState, QuestionResult, FinalRanking,
} from "./types.js";
import {
  createSession, getSession, getSessionByCode,
  addPlayer, removePlayer, markPlayerDisconnected, findSessionByWsId,
  startQuiz, submitAnswer, endQuiz, skipQuestion,
  onGameEvent, removeGameEventListener,
  getHostQuestionData, getPlayerRankings, getFinalRankings,
  getPlayerCount, getAnswerModeForCurrentQuestion,
  trackAddedToLibrary, getAddedToLibrary, clearAddedToLibrary, prepareSongs, THEME_SONGS,
} from "./engine.js";
import {
  activateDjMode, deactivateDjMode, isDjModeActive,
  getAllPlayerPicks, getPlayerPicks, addToQueue, getQueue,
  advanceQueue, getCurrentSong, removeFromQueue,
  setAutoplay, isAutoplay, getPlayerQueueCount,
} from "./dj-mode.js";
import { sendHomeCommand, isHomeConnected } from "../home-ws.js";
import type { AppleMusicClient } from "../apple-music.js";

// ─── Connection Registry ──────────────────────────────────

interface WsConnection {
  ws: WebSocket;
  id: string;
  role: "host" | "player" | "unknown";
  sessionId: string | null;
  playerName: string | null;   // stored for DJ Mode lookup
  playerAvatar: string | null;
}

const connections = new Map<string, WsConnection>();

import { networkInterfaces } from "node:os";

function getServerUrl(): string {
  const url = process.env.SERVER_URL || "https://music.broberg.dk";
  // In dev, replace localhost with LAN IP so phones can connect
  if (url.includes("localhost") || url.includes("127.0.0.1")) {
    const nets = networkInterfaces();
    for (const ifaces of Object.values(nets)) {
      for (const iface of ifaces || []) {
        if (iface.family === "IPv4" && !iface.internal) {
          return url.replace(/localhost|127\.0\.0\.1/, iface.address);
        }
      }
    }
  }
  return url;
}

// ─── Send Helpers ─────────────────────────────────────────

function sendToWs(ws: WebSocket, msg: ServerToHostMessage | ServerToPlayerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function sendToHost(sessionId: string, msg: ServerToHostMessage): void {
  const session = getSession(sessionId);
  if (!session?.hostWsId) return;
  const conn = connections.get(session.hostWsId);
  if (conn) sendToWs(conn.ws, msg);
}

function sendToPlayer(playerId: string, msg: ServerToPlayerMessage): void {
  const conn = connections.get(playerId);
  if (conn) sendToWs(conn.ws, msg);
}

function sendToAllPlayers(sessionId: string, msg: ServerToPlayerMessage): void {
  const session = getSession(sessionId);
  if (!session) return;
  for (const playerId of session.players.keys()) {
    sendToPlayer(playerId, msg);
  }
}

// ─── Game Event Handler ───────────────────────────────────

function setupGameEvents(sessionId: string): void {
  onGameEvent(sessionId, (event) => {
    const session = event.session;

    switch (event.type) {
      case "state_change": {
        // Send state to host
        const hostQuestion = getHostQuestionData(session, session.state === "reveal" || session.state === "scoreboard");
        sendToHost(sessionId, {
          type: "game_state",
          state: session.state,
          question: hostQuestion,
          timeLimit: session.config.timeLimit,
          questionNumber: session.currentQuestion + 1,
          totalQuestions: session.questions.length,
        });

        // Send state to players
        const q = session.questions[session.currentQuestion];
        const answerMode = getAnswerModeForCurrentQuestion(session);
        sendToAllPlayers(sessionId, {
          type: "game_state",
          state: session.state,
          options: answerMode === "multiple-choice" && q ? q.options : undefined,
          timeLimit: session.config.timeLimit,
          questionNumber: session.currentQuestion + 1,
          totalQuestions: session.questions.length,
          questionType: q?.questionType,
          questionText: q?.questionText,
          answerMode,
          artworkUrl: (session.state === "reveal" || session.state === "scoreboard") ? q?.artworkUrl : undefined,
        });

        // Send scoreboard to players
        if (session.state === "scoreboard" || session.state === "finished") {
          const rankings = getPlayerRankings(session);
          sendToAllPlayers(sessionId, { type: "scoreboard", rankings });
        }
        break;
      }

      case "answer_received": {
        const { connected, total } = getPlayerCount(session);
        sendToHost(sessionId, {
          type: "answer_received",
          playerId: event.playerId,
          playerName: event.playerName,
          total: session.pendingAnswers.size,
          expected: connected,
        });
        break;
      }

      case "question_results": {
        const results = event.results as QuestionResult[];
        const hostQuestion = getHostQuestionData(session, true)!;

        // Send full results to host
        sendToHost(sessionId, {
          type: "question_results",
          results,
          correctAnswer: hostQuestion.correctAnswer!,
          question: hostQuestion,
        });

        // Send individual results to each player
        const rankings = getPlayerRankings(session);
        for (const result of results) {
          const rank = rankings.find((r) => r.playerId === result.playerId)?.rank ?? 0;
          sendToPlayer(result.playerId, {
            type: "answer_result",
            correct: result.correct,
            points: result.points,
            totalScore: result.totalScore,
            rank,
            streak: result.streak,
            aiExplanation: result.aiExplanation,
            correctAnswer: hostQuestion.correctAnswer!,
          });
        }
        break;
      }

      case "final_results": {
        const rankings = event.rankings as FinalRanking[];

        // Send to host
        sendToHost(sessionId, { type: "final_results", rankings });

        // Send individual final results to each player
        for (const ranking of rankings) {
          sendToPlayer(ranking.playerId, {
            type: "final_result",
            rank: ranking.rank,
            totalScore: ranking.totalScore,
            stats: {
              correctAnswers: ranking.correctAnswers,
              totalAnswers: ranking.totalAnswers,
              longestStreak: ranking.longestStreak,
              averageTimeMs: ranking.averageTimeMs,
            },
          });
        }
        break;
      }
    }
  });
}

// ─── Message Handlers ─────────────────────────────────────

async function handleHostMessage(conn: WsConnection, msg: HostMessage, musicClient: AppleMusicClient): Promise<void> {
  switch (msg.type) {
    case "create_session": {
      try {
        // Start prep music IMMEDIATELY — try each theme song until one plays
        if (isHomeConnected()) {
          // Ensure volume is up (may have been left at 0)
          await sendHomeCommand("volume", { level: 75 }, 3000).catch(() => {});
          let prepPlaying = false;
          for (const theme of THEME_SONGS.preparation) {
            const res = await sendHomeCommand("play-exact", { name: theme.name, artist: theme.artist, retries: 1 }, 8000).catch(() => null) as { playing?: string } | null;
            if (res?.playing) {
              console.log(`🎵 Prep music: ${res.playing}`);
              prepPlaying = true;
              break;
            }
          }
          if (!prepPlaying) {
            // Last resort: search for first option
            await sendHomeCommand("search-and-play", { query: `${THEME_SONGS.preparation[0].name} ${THEME_SONGS.preparation[0].artist}` }, 10000).catch(() => {});
          }
        }

        const session = await createSession(msg.config, conn.id, musicClient);
        conn.role = "host";
        conn.sessionId = session.id;
        setupGameEvents(session.id);

        // Send preparing state to host
        sendToWs(conn.ws, {
          type: "preparing",
          sessionId: session.id,
          totalSongs: session.questions.length,
        } as any);

        // Download + verify all songs before showing lobby
        await prepareSongs(session.id, musicClient, (current, total) => {
          sendToWs(conn.ws, {
            type: "prepare_progress",
            current,
            total,
          } as any);
        });

        const joinUrl = `${getServerUrl()}/quiz/play?code=${session.joinCode}`;
        sendToWs(conn.ws, {
          type: "session_created",
          sessionId: session.id,
          joinCode: session.joinCode,
          joinUrl,
        });

        // Notify waiting players from ALL previous sessions that lobby is open
        for (const [, c] of connections) {
          if (c.sessionId && c.sessionId !== session.id) {
            const oldSession = getSession(c.sessionId);
            if (oldSession) {
              const waiting = oldSession.waitingPlayers.find(w => w.wsId === c.id);
              if (waiting) {
                sendToWs(c.ws, {
                  type: "lobby_open",
                  joinCode: session.joinCode,
                } as any);
                console.log(`🎮 Notified waiting player: ${waiting.name} → new lobby ${session.joinCode}`);
              }
            }
          }
        }
      } catch (err) {
        sendToWs(conn.ws, { type: "error", message: String(err) });
      }
      break;
    }

    case "start_quiz": {
      if (!conn.sessionId) return;
      const ok = await startQuiz(conn.sessionId);
      if (!ok) sendToWs(conn.ws, { type: "error", message: "Cannot start quiz" });
      break;
    }

    case "next_question": {
      if (!conn.sessionId) return;
      skipQuestion(conn.sessionId);
      break;
    }

    case "skip_question": {
      if (!conn.sessionId) return;
      skipQuestion(conn.sessionId);
      break;
    }

    case "end_quiz": {
      if (!conn.sessionId) return;
      endQuiz(conn.sessionId);
      break;
    }

    case "kick_player": {
      if (!conn.sessionId) return;
      const session = getSession(conn.sessionId);
      if (!session) return;
      const result = removePlayer(conn.sessionId, msg.playerId);
      if (result) {
        sendToPlayer(msg.playerId, { type: "error", message: "You have been removed from the game" });
        sendToAllPlayers(conn.sessionId, { type: "player_left", playerId: msg.playerId, playerName: result.player.name });
      }
      break;
    }

    // ─── DJ Mode (host) ─────────────────────────────────
    case "activate_dj": {
      activateDjMode();
      startDjAutoplayPolling(musicClient);
      const picks = getAllPlayerPicks();
      sendToWs(conn.ws, { type: "dj_activated", picks, queue: getQueue() } as any);
      // Notify all players
      for (const [id, c] of connections) {
        if (c.role === "player") {
          const pp = getPlayerPicks(getPlayerNameByWsId(id));
          sendToWs(c.ws, { type: "dj_activated", picks: pp || null, queue: getQueue() } as any);
        }
      }
      break;
    }
    case "deactivate_dj": {
      deactivateDjMode();
      stopDjAutoplayPolling();
      cleanupLibrary();
      for (const [, c] of connections) {
        if (c.role === "player") {
          sendToWs(c.ws, { type: "dj_deactivated" } as any);
        }
      }
      sendToWs(conn.ws, { type: "dj_deactivated" } as any);
      break;
    }
    case "dj_next": {
      const next = advanceQueue();
      if (next) {
        // Play via Home Controller
        playDjSong(next, musicClient);
        broadcastDjState(conn);
      } else {
        sendToWs(conn.ws, { type: "dj_queue_empty" } as any);
      }
      break;
    }
    case "dj_remove": {
      removeFromQueue((msg as any).songQueueId);
      broadcastDjState(conn);
      break;
    }
    case "dj_autoplay": {
      setAutoplay((msg as any).enabled);
      broadcastDjState(conn);
      break;
    }
    case "dj_status": {
      // Only respond if DJ Mode is active AND this connection has a finished session
      if (!conn.sessionId) break; // No session = no DJ Mode
      const djCheckSession = getSession(conn.sessionId);
      if (isDjModeActive() && djCheckSession?.state === "finished") {
        conn.role = "host";
        const picks = getAllPlayerPicks().map(p => ({
          ...p,
          queuedSongs: getPlayerQueueCount(p.name),
        }));
        sendToWs(conn.ws, { type: "dj_activated", picks, queue: getQueue(), current: getCurrentSong(), autoplay: isAutoplay() } as any);
      }
      break;
    }
  }
}

function handlePlayerMessage(conn: WsConnection, msg: PlayerMessage, musicClient: AppleMusicClient): void {
  switch (msg.type) {
    case "join_session": {
      const joinCode = msg.joinCode.toUpperCase().trim();
      const session = getSessionByCode(joinCode);
      if (!session) {
        sendToWs(conn.ws, { type: "error", message: "Game not found. Check the code and try again." });
        return;
      }

      const result = addPlayer(session.id, conn.id, msg.name, msg.avatar);
      if ("error" in result) {
        if (result.error === "__WAITING_ROOM__") {
          // Player sent to waiting room
          conn.role = "player";
          conn.sessionId = session.id;
          conn.playerName = msg.name;
          conn.playerAvatar = msg.avatar;
          sendToWs(conn.ws, {
            type: "waiting_room",
            message: "Game in progress — you're on the waiting list!",
            position: session.waitingPlayers.length,
          } as any);
          // Notify host
          sendToHost(session.id, {
            type: "player_waiting",
            playerName: msg.name,
            playerAvatar: msg.avatar,
            waitingCount: session.waitingPlayers.length,
          } as any);
          return;
        }
        sendToWs(conn.ws, { type: "error", message: result.error });
        return;
      }

      conn.role = "player";
      conn.sessionId = session.id;
      conn.playerName = result.player.name;
      conn.playerAvatar = result.player.avatar;

      // Send confirmation to player
      const players = [...session.players.values()].map((p) => ({ id: p.id, name: p.name, avatar: p.avatar }));
      sendToWs(conn.ws, {
        type: "joined",
        sessionId: session.id,
        player: { id: result.player.id, name: result.player.name, avatar: result.player.avatar },
        players,
      });

      // Notify host
      sendToHost(session.id, {
        type: "player_joined",
        player: { id: result.player.id, name: result.player.name, avatar: result.player.avatar },
      });

      // Notify other players
      for (const [pid] of session.players) {
        if (pid !== conn.id) {
          sendToPlayer(pid, {
            type: "player_joined",
            player: { id: result.player.id, name: result.player.name, avatar: result.player.avatar },
          });
        }
      }

      // If DJ Mode is active AND session is finished, send DJ state to reconnecting player
      if (isDjModeActive() && session.state === "finished") {
        const pp = getPlayerPicks(result.player.name);
        sendToWs(conn.ws, {
          type: "dj_activated",
          picks: pp || null,
          queue: getQueue(),
          current: getCurrentSong(),
          autoplay: isAutoplay(),
        } as any);
      }
      break;
    }

    case "submit_answer": {
      if (!conn.sessionId) return;
      submitAnswer(conn.sessionId, conn.id, msg.questionIndex, msg.answerIndex, undefined, msg.timeMs);
      break;
    }

    case "submit_text_answer": {
      if (!conn.sessionId) return;
      submitAnswer(conn.sessionId, conn.id, msg.questionIndex, undefined, msg.text, msg.timeMs);
      break;
    }

    // ─── DJ Mode (player) ───────────────────────────────
    case "dj_add_song": {
      const m = msg as any;
      const playerName = getPlayerNameByWsId(conn.id);
      if (!playerName) { sendToWs(conn.ws, { type: "dj_error", message: "Not in a game — try refreshing" } as any); return; }

      const result = addToQueue(playerName, {
        songId: m.songId,
        name: m.name,
        artistName: m.artistName,
        albumName: m.albumName,
        artworkUrl: m.artworkUrl,
      });

      if (!result.success) {
        sendToWs(conn.ws, { type: "dj_error", message: result.error } as any);
        return;
      }

      // Send updated picks to this player
      const pp = getPlayerPicks(playerName);
      sendToWs(conn.ws, { type: "dj_pick_used", availablePicks: pp?.availablePicks ?? 0 } as any);

      // Auto-play first song or if autoplay is on
      if (result.autoPlay) {
        const next = advanceQueue();
        if (next) playDjSong(next, musicClient);
      }

      // Broadcast updated queue to all
      broadcastDjState(conn);
      break;
    }
  }
}

// ─── DJ Mode Helpers ──────────────────────────────────────

function getPlayerNameByWsId(wsId: string): string {
  const conn = connections.get(wsId);
  return conn?.playerName || "";
}

// ─── DJ Autoplay — poll now-playing to detect song end ───

let djPollInterval: ReturnType<typeof setInterval> | null = null;
let djLastPlayingTrack = "";
let djIsAdvancing = false;

function startDjAutoplayPolling(musicClient: AppleMusicClient): void {
  if (djPollInterval) return;
  djPollInterval = setInterval(async () => {
    if (!isDjModeActive() || !isAutoplay()) return;
    if (!isHomeConnected()) return;
    if (djIsAdvancing) return; // prevent overlapping advances

    try {
      const np = await sendHomeCommand("now-playing", {}, 5000) as {
        state?: string; track?: string; position?: number; duration?: number;
      };
      const state = np.state || "stopped";
      const position = np.position ?? 0;
      const duration = np.duration ?? 0;

      if (state === "playing") {
        djLastPlayingTrack = np.track || "";
      } else if (djLastPlayingTrack && getCurrentSong()) {
        // State is stopped or paused — determine if song actually ended
        // Song ended = stopped, OR paused with position near end (within 3 seconds)
        const songEnded = state === "stopped" || (state === "paused" && duration > 0 && (duration - position) < 3);

        if (songEnded) {
          console.log(`🎧 Autoplay: song ended (state=${state}, pos=${position}/${duration}), advancing...`);
          djIsAdvancing = true;
          try {
            const next = advanceQueue();
            if (next) {
              await playDjSong(next, musicClient);
            } else {
              console.log("🎧 Autoplay: queue empty");
            }
            broadcastDjStateToAll();
          } finally {
            djIsAdvancing = false;
          }
          djLastPlayingTrack = "";
        }
        // If paused but NOT near end → user manually paused, don't advance
      }
    } catch {}
  }, 2000);
}

function stopDjAutoplayPolling(): void {
  if (djPollInterval) {
    clearInterval(djPollInterval);
    djPollInterval = null;
  }
  djLastPlayingTrack = "";
}

async function cleanupLibrary(): Promise<void> {
  const songs = getAddedToLibrary();
  if (songs.length === 0 || !isHomeConnected()) return;
  console.log(`🧹 Cleaning up ${songs.length} quiz-added songs from library...`);
  let deleted = 0;
  // Protected songs (theme songs) — never delete
  const protectedSongs = [...THEME_SONGS.preparation, THEME_SONGS.victory];
  function isProtected(name: string, artist: string): boolean {
    const n = name.toLowerCase().trim();
    const a = artist.toLowerCase().trim();
    return protectedSongs.some(t => t.name.toLowerCase().trim() === n && t.artist.toLowerCase().trim() === a);
  }

  for (const song of songs) {
    if (isProtected(song.name, song.artist)) continue;
    try {
      const result = await sendHomeCommand("delete-from-library", {
        name: song.name, artist: song.artist,
      }, 5000) as { deleted?: number };
      deleted += result.deleted || 0;
    } catch {}
  }
  clearAddedToLibrary();
  console.log(`🧹 Cleanup done: ${deleted} tracks removed`);
}

function broadcastDjStateToAll(): void {
  const queue = getQueue();
  const current = getCurrentSong();
  const picks = getAllPlayerPicks().map(p => ({
    ...p,
    queuedSongs: getPlayerQueueCount(p.name),
  }));
  const state = { type: "dj_state", queue, current, picks, autoplay: isAutoplay() };

  for (const [, c] of connections) {
    if (c.role === "host" || c.role === "player") {
      sendToWs(c.ws, state as any);
    }
  }
}

async function playDjSong(song: { songId: string; name: string; artistName: string }, musicClient: AppleMusicClient): Promise<void> {
  if (!isHomeConnected()) return;
  try {
    // Add to library first so it's available for exact match search
    if (musicClient?.hasUserToken()) {
      await musicClient.addToLibrary({ songs: [song.songId] }).catch(() => {});
      trackAddedToLibrary(song.name, song.artistName);
      await new Promise(r => setTimeout(r, 800));
    }

    // Primary: exact name + artist match (no fuzzy search, no wrong songs)
    const artist = song.artistName.split(/[,&]/)[0].trim();
    const result = await sendHomeCommand("play-exact", {
      name: song.name, artist, retries: 3,
    }, 15000) as { playing?: string; error?: string };

    if (result.playing) {
      console.log(`🎧 DJ playing: ${result.playing}`);
      return;
    }
    // Fallback: try without parentheses (remaster tags etc.)
    const simpleName = song.name.replace(/\s*[\(\[].*?[\)\]]/g, "").trim();
    if (simpleName !== song.name) {
      const retry = await sendHomeCommand("play-exact", {
        name: simpleName, artist, retries: 2,
      }, 10000) as { playing?: string };
      if (retry.playing) {
        console.log(`🎧 DJ playing (simplified): ${retry.playing}`);
        return;
      }
    }
    // No fuzzy fallback — silence is better than wrong song
    console.error(`🎧 DJ exact match failed: ${song.name} — ${song.artistName} (no fallback)`);
  } catch (err) {
    console.error("🎧 DJ play failed:", err);
  }
}

function broadcastDjState(_conn: WsConnection): void {
  broadcastDjStateToAll();
}

// ─── WebSocket Server ─────────────────────────────────────

export function attachQuizWebSocket(server: Server, musicClient: AppleMusicClient): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req: IncomingMessage, socket, head) => {
    const { pathname } = parse(req.url || "", true);

    if (pathname === "/quiz-ws") {
      wss.handleUpgrade(req, socket, head, (ws) => {
        const connId = randomUUID().slice(0, 12);
        const conn: WsConnection = {
          ws,
          id: connId,
          role: "unknown",
          sessionId: null,
          playerName: null,
          playerAvatar: null,
        };
        connections.set(connId, conn);
        console.log(`🎮 WS connected: ${connId}`);

        ws.on("message", (data) => {
          try {
            const msg = JSON.parse(data.toString());

            // Route based on message type
            if (msg.type === "create_session" || msg.type === "start_quiz" ||
                msg.type === "next_question" || msg.type === "skip_question" ||
                msg.type === "end_quiz" || msg.type === "kick_player" ||
                msg.type === "activate_dj" || msg.type === "deactivate_dj" ||
                msg.type === "dj_next" || msg.type === "dj_remove" ||
                msg.type === "dj_autoplay" || msg.type === "dj_status") {
              handleHostMessage(conn, msg, musicClient);
            } else {
              handlePlayerMessage(conn, msg, musicClient);
            }
          } catch (err) {
            console.error("🎮 WS message error:", err);
          }
        });

        ws.on("close", () => {
          console.log(`🎮 WS disconnected: ${connId}`);
          const found = findSessionByWsId(connId);
          if (found) {
            if (found.isHost) {
              // Host disconnected — don't destroy session immediately, allow reconnect
              console.log(`🎮 Host disconnected from ${found.session.joinCode}`);
            } else {
              const result = markPlayerDisconnected(connId);
              if (result) {
                sendToHost(found.session.id, {
                  type: "player_left",
                  playerId: connId,
                  playerName: result.player.name,
                });
                sendToAllPlayers(found.session.id, {
                  type: "player_left",
                  playerId: connId,
                  playerName: result.player.name,
                });
              }
            }
          }
          connections.delete(connId);
        });

        ws.on("error", (err) => {
          console.error(`🎮 WS error ${connId}:`, err.message);
        });
      });
      return;
    }

    // Don't handle other paths — let other handlers deal with them
  });

  console.log("🎮 Quiz WebSocket endpoint: /quiz-ws");
}
