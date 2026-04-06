"use client";

import { useEffect, useState, useCallback, useRef, use } from "react";

interface QuizState {
  id: string;
  title: string;
  phase: string;
  currentQuestion: number;
  totalQuestions: number;
  participants: Array<{ name: string; score: number }>;
  timerEnd: number | null;
  timerDuration: number;
  question: {
    questionNumber: number;
    type: string;
    question: string;
    songId: string;
    difficulty: string;
    answer?: string;
    songName?: string;
    artistName?: string;
    albumName?: string;
  } | null;
  playOffset: number | null;
}

function CountdownTimer({ timerEnd, onExpired }: { timerEnd: number; onExpired: () => void }) {
  const [remaining, setRemaining] = useState(0);
  const expiredRef = useRef(false);

  useEffect(() => {
    expiredRef.current = false;
  }, [timerEnd]);

  useEffect(() => {
    const tick = () => {
      const left = Math.max(0, Math.ceil((timerEnd - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0 && !expiredRef.current) {
        expiredRef.current = true;
        onExpired();
      }
    };
    tick();
    const i = setInterval(tick, 100);
    return () => clearInterval(i);
  }, [timerEnd, onExpired]);

  const pct = remaining > 0 ? (remaining / 30) * 100 : 0;

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="text-6xl font-bold tabular-nums" style={{
        color: remaining <= 5 ? "#fc3c44" : remaining <= 10 ? "#f59e0b" : "#e8e8e8",
      }}>
        {remaining}
      </div>
      <div className="w-64 h-2 bg-border rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-200"
          style={{
            width: `${pct}%`,
            background: remaining <= 5 ? "#fc3c44" : remaining <= 10 ? "#f59e0b" : "#22c55e",
          }}
        />
      </div>
    </div>
  );
}

export default function QuizGame({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [state, setState] = useState<QuizState | null>(null);
  const [error, setError] = useState("");

  const fetchState = useCallback(async () => {
    const res = await fetch(`/api/quiz/${id}`);
    if (res.ok) setState(await res.json());
    else setError("Quiz not found");
  }, [id]);

  useEffect(() => {
    fetchState();
    const i = setInterval(fetchState, 2000);
    return () => clearInterval(i);
  }, [fetchState]);

  async function action(body: Record<string, unknown>) {
    const res = await fetch(`/api/quiz/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) setState(await res.json());
  }

  if (error) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-6">
        <p className="text-muted text-xl">Quiz session ended</p>
        <a
          href="/quiz"
          className="bg-apple-red text-white font-bold rounded-2xl px-10 py-3 hover:opacity-90 transition-opacity"
        >
          Start New Quiz
        </a>
      </main>
    );
  }

  if (!state) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <p className="text-muted text-xl">Loading quiz...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 py-8 gap-8">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-3xl font-bold">{state.title}</h1>
        {state.phase !== "lobby" && state.phase !== "finished" && (
          <p className="text-muted mt-1">
            Question {state.currentQuestion} / {state.totalQuestions}
          </p>
        )}
      </div>

      {/* ── LOBBY ── */}
      {state.phase === "lobby" && (
        <div className="text-center space-y-6 animate-[fadeUp_0.6s_cubic-bezier(0.16,1,0.3,1)_both]">
          <p className="text-muted text-lg">Waiting for players...</p>
          <div className="flex flex-wrap justify-center gap-3">
            {state.participants.map((p) => (
              <span key={p.name} className="bg-card border border-border rounded-full px-5 py-2 text-lg font-medium">
                {p.name}
              </span>
            ))}
          </div>
          <button
            onClick={() => action({ action: "next-question" })}
            disabled={state.participants.length === 0}
            className="bg-apple-red text-white font-bold text-xl rounded-2xl px-12 py-4 hover:opacity-90 transition-opacity disabled:opacity-40"
          >
            Start Quiz
          </button>
        </div>
      )}

      {/* ── QUESTION ── */}
      {state.phase === "question" && state.question && (
        <div className="flex flex-col items-center gap-8 animate-[fadeUp_0.4s_cubic-bezier(0.16,1,0.3,1)_both]">
          <div className="bg-card border border-border rounded-2xl px-8 py-6 text-center max-w-2xl">
            <p className="text-sm text-apple-red font-semibold uppercase tracking-widest mb-2">
              {state.question.type.replace(/-/g, " ")}
            </p>
            <p className="text-2xl font-bold">{state.question.question}</p>
          </div>

          {state.timerEnd && <CountdownTimer timerEnd={state.timerEnd} onExpired={() => {}} />}

          {/* Participant buttons — click to award point */}
          <div className="flex flex-wrap justify-center gap-3">
            {state.participants.map((p) => (
              <button
                key={p.name}
                onClick={() => {
                  action({ action: "award-point", name: p.name });
                  action({ action: "reveal" });
                }}
                className="bg-card border-2 border-border hover:border-apple-red rounded-2xl px-6 py-4 transition-colors group"
              >
                <div className="text-lg font-bold group-hover:text-apple-red transition-colors">{p.name}</div>
                <div className="text-sm text-muted">{p.score} pts</div>
              </button>
            ))}
          </div>

          <button
            onClick={() => action({ action: "reveal" })}
            className="text-muted hover:text-foreground text-sm transition-colors"
          >
            Reveal answer (no points)
          </button>

          <button
            onClick={async () => {
              await action({ action: "stop-quiz" });
              window.location.href = "/quiz";
            }}
            className="text-dimmer hover:text-apple-red text-sm transition-colors mt-4"
          >
            Stop Quiz
          </button>
        </div>
      )}

      {/* ── REVEAL ── */}
      {state.phase === "reveal" && state.question && (
        <div className="flex flex-col items-center gap-8 animate-[fadeUp_0.4s_cubic-bezier(0.16,1,0.3,1)_both]">
          <div className="bg-card border border-apple-red/30 rounded-2xl px-8 py-6 text-center max-w-2xl">
            <p className="text-sm text-muted uppercase tracking-widest mb-2">Answer</p>
            <p className="text-3xl font-bold text-apple-red">{state.question.answer}</p>
            {state.question.songName && (
              <p className="text-muted mt-2">
                {state.question.songName} — {state.question.artistName}
              </p>
            )}
          </div>

          {/* Scoreboard */}
          <div className="flex flex-wrap justify-center gap-4">
            {state.participants.map((p, i) => (
              <div
                key={p.name}
                className={`rounded-2xl px-6 py-4 text-center ${
                  i === 0 ? "bg-apple-red/10 border border-apple-red/30" : "bg-card border border-border"
                }`}
              >
                <div className="text-lg font-bold">{p.name}</div>
                <div className="text-2xl font-bold tabular-nums">{p.score}</div>
              </div>
            ))}
          </div>

          <button
            onClick={() => action({ action: "next-question" })}
            className="bg-apple-red text-white font-bold text-lg rounded-2xl px-10 py-3 hover:opacity-90 transition-opacity"
          >
            {state.currentQuestion >= state.totalQuestions ? "Finish" : "Next Question"}
          </button>
          <button
            onClick={async () => {
              await action({ action: "stop-quiz" });
              window.location.href = "/quiz";
            }}
            className="text-dimmer hover:text-apple-red text-sm transition-colors"
          >
            Stop Quiz
          </button>
        </div>
      )}

      {/* ── SCORES ── */}
      {state.phase === "scores" && (
        <div className="flex flex-col items-center gap-8 animate-[fadeUp_0.4s_cubic-bezier(0.16,1,0.3,1)_both]">
          <h2 className="text-2xl font-bold">Scores</h2>
          <div className="space-y-3 w-full max-w-md">
            {state.participants.map((p, i) => (
              <div
                key={p.name}
                className={`flex items-center justify-between rounded-xl px-6 py-4 ${
                  i === 0 ? "bg-apple-red/10 border border-apple-red/30" : "bg-card border border-border"
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl font-bold text-muted w-8">{i + 1}</span>
                  <span className="text-lg font-bold">{p.name}</span>
                </div>
                <span className="text-2xl font-bold tabular-nums">{p.score}</span>
              </div>
            ))}
          </div>
          <button
            onClick={() => action({ action: "next-question" })}
            className="bg-apple-red text-white font-bold text-lg rounded-2xl px-10 py-3 hover:opacity-90 transition-opacity"
          >
            Next Question
          </button>
        </div>
      )}

      {/* ── FINISHED ── */}
      {state.phase === "finished" && (
        <div className="flex flex-col items-center gap-8 animate-[fadeUp_0.6s_cubic-bezier(0.16,1,0.3,1)_both]">
          <h2 className="text-4xl font-bold">Quiz Complete!</h2>
          {state.participants.length > 0 && (
            <>
              <div className="text-6xl">🏆</div>
              <p className="text-2xl font-bold text-apple-red">
                {state.participants[0].name} wins with {state.participants[0].score} points!
              </p>
            </>
          )}
          <div className="space-y-3 w-full max-w-md">
            {state.participants.map((p, i) => (
              <div
                key={p.name}
                className={`flex items-center justify-between rounded-xl px-6 py-4 ${
                  i === 0 ? "bg-apple-red/10 border border-apple-red/30" : "bg-card border border-border"
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl font-bold text-muted w-8">{i + 1}</span>
                  <span className="text-lg font-bold">{p.name}</span>
                </div>
                <span className="text-2xl font-bold tabular-nums">{p.score}</span>
              </div>
            ))}
          </div>
          <a
            href="/quiz"
            className="bg-apple-red text-white font-bold text-lg rounded-2xl px-10 py-3 hover:opacity-90 transition-opacity"
          >
            New Quiz
          </a>
        </div>
      )}
    </main>
  );
}
