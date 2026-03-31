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
} from "./engine.js";
import type { AppleMusicClient } from "../apple-music.js";

// ─── Connection Registry ──────────────────────────────────

interface WsConnection {
  ws: WebSocket;
  id: string;
  role: "host" | "player" | "unknown";
  sessionId: string | null;
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
        const session = await createSession(msg.config, conn.id, musicClient);
        conn.role = "host";
        conn.sessionId = session.id;
        setupGameEvents(session.id);

        const joinUrl = `${getServerUrl()}/quiz/play?code=${session.joinCode}`;
        sendToWs(conn.ws, {
          type: "session_created",
          sessionId: session.id,
          joinCode: session.joinCode,
          joinUrl,
        });
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
  }
}

function handlePlayerMessage(conn: WsConnection, msg: PlayerMessage): void {
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
        sendToWs(conn.ws, { type: "error", message: result.error });
        return;
      }

      conn.role = "player";
      conn.sessionId = session.id;

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
  }
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
        };
        connections.set(connId, conn);
        console.log(`🎮 WS connected: ${connId}`);

        ws.on("message", (data) => {
          try {
            const msg = JSON.parse(data.toString());

            // Route based on message type
            if (msg.type === "create_session" || msg.type === "start_quiz" ||
                msg.type === "next_question" || msg.type === "skip_question" ||
                msg.type === "end_quiz" || msg.type === "kick_player") {
              handleHostMessage(conn, msg, musicClient);
            } else {
              handlePlayerMessage(conn, msg);
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
