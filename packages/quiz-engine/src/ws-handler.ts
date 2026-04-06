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
} from "@music-quiz/shared";
import {
  createSession, getSession, getSessionByCode, listActiveSessions,
  addPlayer, removePlayer, markPlayerDisconnected, findSessionByWsId,
  startQuiz, submitAnswer, endQuiz, skipQuestion,
  onGameEvent, removeGameEventListener,
  getHostQuestionData, getPlayerRankings, getFinalRankings,
  getPlayerCount, getAnswerModeForCurrentQuestion,
  trackAddedToLibrary, getAddedToLibrary, clearAddedToLibrary, prepareSongs, THEME_SONGS,
  createParty, getParty, getPartyByCode, getPartyBySessionId,
  transitionParty, endParty, addPlayerToParty, syncPartyPlayersToSession,
} from "./engine.js";
import {
  activateDjMode, deactivateDjMode, isDjModeActive,
  getAllPlayerCredits, getPlayerCredits, addToQueue, getQueue,
  advanceQueue, getCurrentSong, removeFromQueue, markCurrentFailed,
  setAutoplay, isAutoplay, getPlayerQueueCount,
  calculateCreditsForRank, addToQueueDirect,
} from "./dj-mode.js";
import { getProvider, setActiveProvider, getMusicKitWebProvider } from "./playback/provider-manager.js";
import { isMuted } from "./mute.js";
import { MusicKitWebProvider } from "./playback/musickit-web.js";
import type { AppleMusicClient } from "./apple-music.js";

// ─── Connection Registry ──────────────────────────────────

interface WsConnection {
  ws: WebSocket;
  id: string;
  role: "host" | "admin" | "player" | "waiting" | "unknown";
  isAdmin: boolean;            // true if registered as admin (survives role change to host)
  sessionId: string | null;
  partyId: string | null;
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

    // Get round number from Party context
    const eventParty = getPartyBySessionId(sessionId);
    const roundNumber = eventParty?.currentRound ?? 0;

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
          roundNumber,
        } as any);

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
          isTrivia: q?.isTrivia || false,
          roundNumber,
        } as any);

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
            artistName: hostQuestion.artistName,
            releaseYear: hostQuestion.releaseYear,
            funFact: hostQuestion.funFact,
          });
        }
        break;
      }

      case "final_results": {
        const rankings = event.rankings as FinalRanking[];

        // Enrich rankings with picks earned this round
        const rankingsWithPicks = rankings.map(r => ({
          ...r,
          creditsEarned: calculateCreditsForRank(r.rank, r.longestStreak),
        }));

        // Send to host
        sendToHost(sessionId, { type: "final_results", rankings: rankingsWithPicks, roundNumber } as any);

        // Send individual final results to each player
        for (const r of rankingsWithPicks) {
          sendToPlayer(r.playerId, {
            type: "final_result",
            rank: r.rank,
            totalScore: r.totalScore,
            creditsEarned: r.creditsEarned,
            stats: {
              correctAnswers: r.correctAnswers,
              totalAnswers: r.totalAnswers,
              longestStreak: r.longestStreak,
              averageTimeMs: r.averageTimeMs,
            },
          } as any);
        }

        // Auto-send DJ state to all players after ceremony (5s delay)
        setTimeout(() => {
          for (const [id, c] of connections) {
            if (c.role === "player") {
              const pp = getPlayerCredits(getPlayerNameByWsId(id));
              sendToWs(c.ws, {
                type: "dj_activated",
                picks: pp || null,
                queue: getQueue(),
                current: getCurrentSong(),
              } as any);
            }
          }
          // Also notify admin
          broadcastDjStateToAll();
        }, 5000);
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
        // Start prep music — Frank Sinatra first, fallback to Police
        const prepProvider = getProvider();
        if (prepProvider.isAvailable()) {
          await prepProvider.setVolume(75);
          let prepPlaying = false;
          for (const theme of THEME_SONGS.preparation) {
            const res = await prepProvider.playExact(theme.name, theme.artist, { retries: 3 });
            if (res.playing) {
              console.log(`🎵 Prep music: ${res.track}`);
              prepPlaying = true;
              break;
            }
          }
          if (!prepPlaying) {
            // Last resort: search-and-play Frank
            await prepProvider.searchAndPlay(`Theme from New York New York Frank Sinatra`);
          }
        }

        // Auto-create or reuse Party
        let party = conn.partyId ? getParty(conn.partyId) : undefined;
        if (!party) {
          party = createParty(conn.id);
          conn.partyId = party.id;
        }
        party.hostWsId = conn.id;

        // Phase 1: Researching (AI trivia + pool building + verification)
        sendToWs(conn.ws, { type: "researching" } as any);

        const session = await createSession(msg.config, conn.id, musicClient, party);
        conn.role = "host";
        conn.sessionId = session.id;
        setupGameEvents(session.id);

        // Phase 2: Preparing songs (download + library verify)
        sendToWs(conn.ws, {
          type: "preparing",
          sessionId: session.id,
          totalSongs: session.questions.filter(q => q.songId).length,
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
          partyId: party.id,
          roundNumber: party.currentRound,
          muteAll: isMuted(),
        } as any);

        // Notify ALL players in this Party about new lobby
        for (const [, c] of connections) {
          if (c.id === conn.id) continue; // skip host
          if (c.partyId === party.id || (c.sessionId && c.sessionId !== session.id)) {
            if (c.role === "player" || c.role === "waiting") {
              sendToWs(c.ws, { type: "lobby_open", joinCode: session.joinCode, roundNumber: party.currentRound } as any);
              console.log(`🎮 ${c.role} ${c.playerName || "?"} → Round ${party.currentRound} lobby ${session.joinCode}`);
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
      // Stop DJ autoplay during quiz — prevents DJ queue from trampling quiz playback
      stopDjAutoplayPolling();
      console.log("🎧 DJ autoplay stopped for quiz");
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
      // Let Champions keep playing — DJ Mode takes over when first song hits the queue
      startDjAutoplayPolling(musicClient);
      // Transition Party to playlist state (between rounds)
      const djParty = conn.partyId ? getParty(conn.partyId) : undefined;
      if (djParty) {
        transitionParty(djParty, "playlist");
      }
      const picks = getAllPlayerCredits();
      const roundNum = djParty?.currentRound ?? 0;
      sendToWs(conn.ws, { type: "dj_activated", picks, queue: getQueue(), roundNumber: roundNum } as any);
      // Notify all players
      for (const [id, c] of connections) {
        if (c.role === "player") {
          const pp = getPlayerCredits(getPlayerNameByWsId(id));
          sendToWs(c.ws, { type: "dj_activated", picks: pp || null, queue: getQueue(), roundNumber: roundNum } as any);
        }
      }
      break;
    }
    case "deactivate_dj": {
      // deactivate_dj is now only used for End Party (full cleanup)
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
    case "dj_play_current": {
      // Play current song WITHOUT advancing queue (retry / resume)
      const current = getCurrentSong();
      if (current && !current.played) {
        playDjSong(current, musicClient);
        broadcastDjState(conn);
      } else {
        // No current — advance to first unplayed
        const next = advanceQueue();
        if (next) {
          playDjSong(next, musicClient);
          broadcastDjState(conn);
        } else {
          sendToWs(conn.ws, { type: "dj_queue_empty" } as any);
        }
      }
      break;
    }
    case "dj_next": {
      const next = advanceQueue();
      if (next) {
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
        const party = conn.partyId ? getParty(conn.partyId) : undefined;
        const picks = getAllPlayerCredits().map(p => ({
          ...p,
          queuedSongs: getPlayerQueueCount(p.name),
        }));
        sendToWs(conn.ws, {
          type: "dj_activated", picks, queue: getQueue(), current: getCurrentSong(), autoplay: isAutoplay(),
          roundNumber: party?.currentRound ?? 0,
        } as any);
      }
      break;
    }

    case "set_provider": {
      const providerType = (msg as any).provider;
      if (providerType === "musickit-web") {
        // Set up MusicKit Web provider with host's WS connection for sending commands
        const mkProvider = getMusicKitWebProvider();
        mkProvider.setSendToHost((m: any) => sendToWs(conn.ws, m));
        mkProvider.setAuthorized(true);
        setActiveProvider("musickit-web");
        sendToWs(conn.ws, { type: "provider_set", provider: "musickit-web" } as any);
        console.log(`🎵 Playback provider set to MusicKit JS (via host browser)`);
      } else if (providerType === "home-controller") {
        setActiveProvider("home-controller");
        sendToWs(conn.ws, { type: "provider_set", provider: "home-controller" } as any);
      }
      break;
    }

    case "end_party": {
      if (!conn.partyId) {
        sendToWs(conn.ws, { type: "error", message: "No active party" });
        break;
      }
      // Stop music
      await getProvider().pause();
      stopDjAutoplayPolling();
      cleanupLibrary();

      // Notify all players
      for (const [, c] of connections) {
        if (c.partyId === conn.partyId && c.id !== conn.id) {
          sendToWs(c.ws, { type: "party_ended" } as any);
          c.partyId = null;
          c.sessionId = null;
        }
      }

      endParty(conn.partyId);
      conn.partyId = null;
      conn.sessionId = null;
      sendToWs(conn.ws, { type: "party_ended" } as any);
      console.log(`🎉 Party ended by host`);
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

      // Find Party context
      const joinParty = getPartyByCode(joinCode) || getPartyBySessionId(session.id);

      const result = addPlayer(session.id, conn.id, msg.name, msg.avatar);
      if ("error" in result) {
        if (result.error === "__WAITING_ROOM__") {
          // Player sent to waiting room — NOT a player, cannot receive DJ Mode
          conn.role = "waiting";
          conn.sessionId = session.id;
          conn.partyId = joinParty?.id ?? null;
          conn.playerName = msg.name;
          conn.playerAvatar = msg.avatar;
          const waitingCount = joinParty ? joinParty.waitingPlayers.length : session.waitingPlayers.length;
          sendToWs(conn.ws, {
            type: "waiting_room",
            message: "Game in progress — you're on the waiting list!",
            position: waitingCount,
          } as any);
          // Notify host
          sendToHost(session.id, {
            type: "player_waiting",
            playerName: msg.name,
            playerAvatar: msg.avatar,
            waitingCount,
          } as any);
          return;
        }
        sendToWs(conn.ws, { type: "error", message: result.error });
        return;
      }

      conn.role = "player";
      conn.sessionId = session.id;
      conn.partyId = joinParty?.id ?? null;
      conn.playerName = result.player.name;
      conn.playerAvatar = result.player.avatar;

      // Send confirmation to player (include round number + current game state for reconnect)
      const players = [...session.players.values()].map((p) => ({ id: p.id, name: p.name, avatar: p.avatar }));
      const joinMsg: Record<string, unknown> = {
        type: "joined",
        sessionId: session.id,
        player: { id: result.player.id, name: result.player.name, avatar: result.player.avatar },
        players,
        roundNumber: joinParty?.currentRound ?? 0,
        gameState: session.state,
      };
      // If game is mid-question, send current question so reconnecting player can answer
      if ((session.state === "playing" || session.state === "countdown") && session.currentQuestion >= 0) {
        const q = session.questions[session.currentQuestion];
        if (q) {
          joinMsg.currentQuestion = {
            index: session.currentQuestion,
            total: session.questions.length,
            question: q.questionText,
            options: q.options,
            artworkUrl: q.artworkUrl,
            questionType: q.questionType,
          };
        }
      }
      sendToWs(conn.ws, joinMsg as any);

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
        const pp = getPlayerCredits(result.player.name);
        sendToWs(conn.ws, {
          type: "dj_activated",
          picks: pp || null,
          queue: getQueue(),
          current: getCurrentSong(),
          autoplay: isAutoplay(),
          roundNumber: joinParty?.currentRound ?? 0,
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
      const pp = getPlayerCredits(playerName);
      sendToWs(conn.ws, { type: "dj_pick_used", availableCredits: pp?.availableCredits ?? 0 } as any);

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
let djLastPlayStartTime = 0;
let djIsAdvancing = false;

function startDjAutoplayPolling(musicClient: AppleMusicClient): void {
  if (djPollInterval) return;
  djPollInterval = setInterval(async () => {
    if (!isDjModeActive() || !isAutoplay()) return;
    // P0 FIX: Never advance DJ queue while a quiz is actively running
    const activeSessions = listActiveSessions();
    const quizInProgress = activeSessions.some(s => s.state !== "finished" && s.state !== "lobby");
    if (quizInProgress) return;
    const pollProvider = getProvider();
    if (!pollProvider.isAvailable()) return;
    if (djIsAdvancing) return; // prevent overlapping advances

    try {
      const np = await pollProvider.nowPlaying();
      const state = np.state || "stopped";
      const position = np.position ?? 0;
      const duration = np.duration ?? 0;

      if (state === "playing") {
        djLastPlayingTrack = np.track || "";
        djLastPlayStartTime = Date.now();
      } else if (djLastPlayingTrack && getCurrentSong()) {
        // State is stopped or paused — determine if song actually ended
        // Ignore stopped with pos=0 (song hasn't started yet — HC needs time to load)
        // Also ignore if less than 5s since we started playing (loading delay)
        const timeSincePlay = Date.now() - (djLastPlayStartTime || 0);
        const songNeverStarted = position === 0 && duration === 0 && timeSincePlay < 15000;
        if (songNeverStarted) {
          // Still loading — don't advance
        } else {
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
  // DISABLED — cleanup was deleting user's own library songs that happened to
  // match quiz-added songs by name. Too dangerous without pre-quiz library snapshot.
  const songs = getAddedToLibrary();
  if (songs.length > 0) {
    console.log(`🧹 Cleanup skipped: ${songs.length} quiz-added songs kept in library (safety)`);
    clearAddedToLibrary();
  }
}

function broadcastDjStateToAll(): void {
  const queue = getQueue();
  const current = getCurrentSong();
  const picks = getAllPlayerCredits().map(p => ({
    ...p,
    queuedSongs: getPlayerQueueCount(p.name),
  }));
  const state = { type: "dj_state", queue, current, picks, autoplay: isAutoplay() };

  for (const [, c] of connections) {
    if (c.role === "host" || c.role === "player" || c.isAdmin) {
      sendToWs(c.ws, state as any);
    }
  }
}

async function playDjSong(song: { songId: string; name: string; artistName: string }, musicClient: AppleMusicClient): Promise<boolean> {
  // MUTE_ALL: pretend playback succeeded (DJ queue still advances)
  if (isMuted()) {
    console.log(`🎧 DJ playing (muted): ${song.name}`);
    return true;
  }
  const djProvider = getProvider();
  if (!djProvider.isAvailable()) {
    console.error(`🎧 DJ play failed: provider not available`);
    markCurrentFailed();
    return false;
  }
  try {
    // Don't pause before play — MusicKit handles transition automatically
    // Calling pause() then play() causes Chrome "play() interrupted by pause()" error

    // Primary: play by catalog ID (fastest, works with MusicKit JS directly)
    if (song.songId && djProvider.playById) {
      const result = await djProvider.playById(song.songId);
      if (result.playing) {
        console.log(`🎧 DJ playing (by ID): ${song.name}`);
        return true;
      }
    }

    // Fallback: exact name + artist match
    const artist = song.artistName.split(/[,&]/)[0].trim();
    const result = await djProvider.playExact(song.name, artist, { retries: 2 });
    if (result.playing) {
      console.log(`🎧 DJ playing: ${result.track}`);
      return true;
    }

    // Last resort: searchAndPlay
    const search = await djProvider.searchAndPlay(`${song.name} ${artist}`);
    if (search.playing) {
      console.log(`🎧 DJ playing (search): ${search.track}`);
      return true;
    }
    console.error(`🎧 DJ play FAILED all methods: ${song.name} — ${song.artistName}`);
    markCurrentFailed();
    return false;
  } catch (err) {
    console.error("🎧 DJ play FAILED:", err);
    markCurrentFailed();
    return false;
  }
}

function broadcastDjState(_conn: WsConnection): void {
  broadcastDjStateToAll();
}

// ─── WebSocket Server ─────────────────────────────────────

export function attachQuizWebSocket(server: Server, musicClient: AppleMusicClient): void {
  const wss = new WebSocketServer({ noServer: true });

  // DJ autoplay polling starts immediately — guarded against quiz-in-progress
  startDjAutoplayPolling(musicClient);

  // WebSocket keepalive — send ping every 30s to prevent idle disconnects during long operations
  setInterval(() => {
    for (const [, conn] of connections) {
      if (conn.ws.readyState === WebSocket.OPEN) {
        try { conn.ws.ping(); } catch {}
      }
    }
  }, 30000);

  server.on("upgrade", (req: IncomingMessage, socket, head) => {
    const { pathname } = parse(req.url || "", true);

    if (pathname === "/quiz-ws") {
      wss.handleUpgrade(req, socket, head, (ws) => {
        const connId = randomUUID().slice(0, 12);
        const conn: WsConnection = {
          ws,
          id: connId,
          role: "unknown",
          isAdmin: false,
          sessionId: null,
          partyId: null,
          playerName: null,
          playerAvatar: null,
        };
        connections.set(connId, conn);
        console.log(`🎮 WS connected: ${connId}`);

        ws.on("message", (data) => {
          try {
            const msg = JSON.parse(data.toString());

            // Route based on message type
            // Handle playback responses from MusicKit JS
            if (msg.type === "playback_response") {
              MusicKitWebProvider.handleResponse(msg);
              return;
            }

            // Admin registration
            if (msg.type === "register_admin") {
              conn.role = "admin";
              conn.isAdmin = true;
              // Admin owns MusicKit — set up playback routing and authorize
              const mkProvider = getMusicKitWebProvider();
              mkProvider.setSendToHost((m: any) => sendToWs(conn.ws, m));
              mkProvider.setAuthorized(true);
              console.log(`🎮 Admin registered: ${conn.id} (MusicKit routing + authorized)`);
              // Always send DJ state — DJ is always active
              const picks = getAllPlayerCredits().map(p => ({
                ...p, queuedSongs: getQueue().filter(q => q.addedBy === p.name && !q.played).length,
              }));
              sendToWs(conn.ws, {
                type: "dj_activated",
                picks,
                queue: getQueue(),
                current: getCurrentSong(),
                autoplay: isAutoplay(),
              } as any);
              return;
            }

            // Player DJ reconnect (no session, just credits)
            if (msg.type === "reconnect_dj") {
              const name = (msg as any).name;
              const avatar = (msg as any).avatar;
              if (!name) return;
              conn.role = "player";
              conn.playerName = name;
              conn.playerAvatar = avatar;
              const pp = getPlayerCredits(name);
              if (pp && pp.availableCredits > 0) {
                sendToWs(conn.ws, {
                  type: "dj_activated",
                  picks: pp,
                  queue: getQueue(),
                  current: getCurrentSong(),
                } as any);
                console.log(`🎧 DJ reconnect: ${name} (${pp.availableCredits} credits)`);
              } else {
                // No credits — show join screen
                sendToWs(conn.ws, { type: "error", message: "No credits" } as any);
              }
              return;
            }

            // DJ commands from admin (same handlers as host — works even when admin is also host)
            if (conn.isAdmin && (
                msg.type === "activate_dj" || msg.type === "deactivate_dj" ||
                msg.type === "dj_next" || msg.type === "dj_play_current" || msg.type === "dj_remove" ||
                msg.type === "dj_autoplay" || msg.type === "dj_status" ||
                msg.type === "admin_dj_add" || msg.type === "end_party")) {
              if (msg.type === "admin_dj_add") {
                // Admin adds directly to queue (no credit check)
                const song = msg as any;
                console.log(`🎧 Admin adding to DJ: "${song.name}" by ${song.artistName} (id: ${song.songId}, art: ${song.artworkUrl ? 'YES' : 'NO'})`);
                const queued = addToQueueDirect(song.name, song.artistName, song.songId, song.albumName, song.artworkUrl);
                if (queued) {
                  console.log(`🎧 Admin DJ add OK — queue now ${getQueue().length}`);
                  broadcastDjStateToAll();
                } else {
                  console.log(`🎧 Admin DJ add FAILED — DJ active: ${isDjModeActive()}`);
                }
              } else {
                handleHostMessage(conn, msg, musicClient);
              }
              return;
            }

            if (msg.type === "create_session" || msg.type === "start_quiz" ||
                msg.type === "next_question" || msg.type === "skip_question" ||
                msg.type === "end_quiz" || msg.type === "kick_player" ||
                msg.type === "activate_dj" || msg.type === "deactivate_dj" ||
                msg.type === "dj_next" || msg.type === "dj_play_current" || msg.type === "dj_remove" ||
                msg.type === "dj_autoplay" || msg.type === "dj_status" ||
                msg.type === "end_party" || msg.type === "set_provider") {
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

          // If this was the admin with MusicKit routing, clear it so next admin takes over
          if (conn.isAdmin) {
            const mkProvider = getMusicKitWebProvider();
            // Only clear if this connection's callback is still the active one
            // (another admin may have already taken over)
            mkProvider.setSendToHost(null as any);
            mkProvider.setAuthorized(false);
            console.log(`🎮 Admin disconnected — MusicKit routing cleared`);

            // Check if another admin is still connected and re-route to them
            for (const [, c] of connections) {
              if (c.id !== connId && c.isAdmin && c.ws.readyState === WebSocket.OPEN) {
                mkProvider.setSendToHost((m: any) => sendToWs(c.ws, m));
                mkProvider.setAuthorized(true);
                console.log(`🎮 MusicKit routing re-assigned to ${c.id}`);
                break;
              }
            }
          }

          const found = findSessionByWsId(connId);
          if (found) {
            if (found.isHost) {
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
