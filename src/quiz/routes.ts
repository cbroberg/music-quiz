/**
 * Quiz Express Routes
 *
 * Serves static files for host UI and player PWA.
 * Also provides REST API for session info (used by player join validation).
 */

import { Router } from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { getSessionByCode, listActiveSessions } from "./engine.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// In dist: dist/quiz/routes.js → need to reach src/quiz/public/
// Resolve relative to project root (two levels up from dist/quiz/)
const projectRoot = join(__dirname, "..", "..");
const publicDir = join(projectRoot, "src", "quiz", "public");

export function createQuizRouter(): Router {
  const router = Router();

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

  return router;
}
