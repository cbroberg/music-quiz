/**
 * @music-quiz/quiz-engine — barrel export
 *
 * Re-exports all the modules consumed by @music-quiz/mcp-server.
 * The mcp-server package only contains the MCP entry point and the
 * Express/Next.js bootstrap; everything else lives here.
 */

export { createDeveloperToken } from "./token.js";
export { AppleMusicClient } from "./apple-music.js";
export { AppleMusicOAuthProvider } from "./oauth.js";
export { generateQuiz } from "./quiz.js";
export type { Quiz, QuizQuestion as GeneratedQuizQuestion, QuizType as GeneratedQuizType } from "./quiz.js";
export {
  createQuizSession, getPublicState, addParticipant, removeParticipant,
  getQuizSession, nextQuestion, revealAnswer, awardPoint, showScores,
  stopQuiz, listActiveSessions,
} from "./quiz-manager.js";
export {
  attachHomeWebSocket, sendHomeCommand, isHomeConnected,
} from "./home-ws.js";
export { loadMusicUserToken, saveMusicUserToken } from "./token-store.js";
export { attachBrowserWebSocket } from "./browser-ws.js";
export { attachQuizWebSocket } from "./ws-handler.js";
export { createQuizRouter } from "./routes.js";
