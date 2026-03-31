/**
 * E2E test: Multiplayer Quiz via WebSocket
 * Simulates a host creating a session + 3 players joining and answering.
 */

import WebSocket from "ws";

const URL = "ws://localhost:3000/quiz-ws";
const PLAYERS = [
  { name: "Christian", avatar: "🎸" },
  { name: "Mikkel", avatar: "🎤" },
  { name: "Anna", avatar: "🎹" },
];

function connect(label) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    ws.on("open", () => {
      console.log(`✅ ${label} connected`);
      resolve(ws);
    });
    ws.on("error", reject);
  });
}

function send(ws, msg) {
  ws.send(JSON.stringify(msg));
}

function waitFor(ws, type, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${type}`)), timeoutMs);
    const handler = (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === type) {
        clearTimeout(timer);
        ws.off("message", handler);
        resolve(msg);
      }
    };
    ws.on("message", handler);
  });
}

function onAny(ws, callback) {
  ws.on("message", (data) => callback(JSON.parse(data.toString())));
}

async function main() {
  console.log("\n🎮 === Multiplayer Quiz E2E Test ===\n");

  // 1. Host connects and creates session
  console.log("--- Step 1: Host creates session ---");
  const host = await connect("Host");

  send(host, {
    type: "create_session",
    config: {
      quizType: "mixed",
      source: "charts",
      questionCount: 3,
      timeLimit: 15,
      answerMode: "multiple-choice",
    },
  });

  const created = await waitFor(host, "session_created");
  console.log(`📋 Session: ${created.joinCode} (${created.sessionId})`);
  console.log(`🔗 Join URL: ${created.joinUrl}`);

  // Collect host messages
  const hostMessages = [];
  onAny(host, (msg) => {
    hostMessages.push(msg);
    if (msg.type === "player_joined") {
      console.log(`   Host sees: ${msg.player.avatar} ${msg.player.name} joined`);
    }
    if (msg.type === "answer_received") {
      console.log(`   Host sees: ${msg.total}/${msg.expected} answered`);
    }
    if (msg.type === "game_state") {
      console.log(`   Host state: ${msg.state}${msg.questionNumber ? ` (Q${msg.questionNumber}/${msg.totalQuestions})` : ""}`);
    }
  });

  // 2. Players join
  console.log("\n--- Step 2: Players join ---");
  const playerWs = [];
  const playerState = [];

  for (const p of PLAYERS) {
    const ws = await connect(p.name);
    playerWs.push(ws);

    send(ws, {
      type: "join_session",
      joinCode: created.joinCode,
      name: p.name,
      avatar: p.avatar,
    });

    const joined = await waitFor(ws, "joined");
    console.log(`   ${p.avatar} ${p.name} joined (${joined.players.length} players in lobby)`);

    playerState.push({ ws, name: p.name, avatar: p.avatar, answered: false });
  }

  // 3. Set up player message handlers
  for (const ps of playerState) {
    onAny(ps.ws, (msg) => {
      if (msg.type === "game_state" && msg.state === "playing") {
        // Auto-answer with random option after random delay
        if (!ps.answered) {
          ps.answered = true;
          const delay = 1000 + Math.random() * 3000;
          const answerIndex = Math.floor(Math.random() * 4);
          setTimeout(() => {
            console.log(`   ${ps.avatar} ${ps.name} answers option ${answerIndex} (after ${Math.round(delay)}ms)`);
            send(ps.ws, {
              type: "submit_answer",
              questionIndex: msg.questionNumber - 1,
              answerIndex,
              timeMs: Math.round(delay),
            });
          }, delay);
        }
      }
      if (msg.type === "game_state" && msg.state === "countdown") {
        ps.answered = false; // Reset for next question
      }
      if (msg.type === "answer_result") {
        console.log(`   ${ps.avatar} ${ps.name}: ${msg.correct ? "✅" : "❌"} +${msg.points}pts (total: ${msg.totalScore}, rank: #${msg.rank})`);
      }
      if (msg.type === "final_result") {
        console.log(`   ${ps.avatar} ${ps.name} FINAL: #${msg.rank} — ${msg.totalScore}pts (${msg.stats.correctAnswers}/${msg.stats.totalAnswers} correct, streak ${msg.stats.longestStreak})`);
      }
    });
  }

  // 4. Start quiz
  console.log("\n--- Step 3: Start quiz ---");
  send(host, { type: "start_quiz" });

  // 5. Wait for final results
  console.log("   Waiting for quiz to complete (3 questions × 15s max)...\n");

  const finalResults = await waitFor(host, "final_results", 120000);

  console.log("\n--- 🏆 Final Results ---");
  for (const r of finalResults.rankings) {
    console.log(`   #${r.rank} ${r.avatar} ${r.playerName}: ${r.totalScore}pts (${r.correctAnswers}/${r.totalAnswers} correct, streak ${r.longestStreak})`);
  }

  // 6. Verify
  console.log("\n--- Verification ---");
  const checks = [
    ["Session created", !!created.joinCode],
    ["Join code is 6 chars", created.joinCode.length === 6],
    ["3 players joined", playerState.length === 3],
    ["Final rankings received", finalResults.rankings.length === 3],
    ["Rankings are sorted", finalResults.rankings[0].rank === 1],
    ["Host received game states", hostMessages.some(m => m.type === "game_state")],
    ["Host received answer counts", hostMessages.some(m => m.type === "answer_received")],
    ["Host received question results", hostMessages.some(m => m.type === "question_results")],
  ];

  let allPassed = true;
  for (const [name, ok] of checks) {
    console.log(`   ${ok ? "✅" : "❌"} ${name}`);
    if (!ok) allPassed = false;
  }

  console.log(`\n${allPassed ? "🎉 ALL TESTS PASSED" : "💥 SOME TESTS FAILED"}\n`);

  // Cleanup
  host.close();
  playerWs.forEach(ws => ws.close());
  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error("💥 Test failed:", err);
  process.exit(1);
});
