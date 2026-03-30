"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const QUIZ_TYPES = [
  { value: "mixed", label: "Mixed" },
  { value: "intro-quiz", label: "Intro Quiz" },
  { value: "guess-the-artist", label: "Guess the Artist" },
  { value: "guess-the-song", label: "Guess the Song" },
  { value: "guess-the-album", label: "Guess the Album" },
  { value: "guess-the-year", label: "Guess the Year" },
];

const SOURCES = [
  { value: "recently-played", label: "Recently Played" },
  { value: "heavy-rotation", label: "Heavy Rotation" },
  { value: "charts", label: "Charts" },
  { value: "library", label: "Library" },
];

export default function QuizLobby() {
  const router = useRouter();
  const [type, setType] = useState("mixed");
  const [source, setSource] = useState("recently-played");
  const [count, setCount] = useState(10);
  const [timerDuration, setTimerDuration] = useState(30);
  const [decade, setDecade] = useState("");
  const [participants, setParticipants] = useState<string[]>([]);
  const [newName, setNewName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function createQuiz() {
    setLoading(true);
    setError("");
    try {
      const apiKey = localStorage.getItem("adminKey") || "";
      const headers: Record<string, string> = { "Content-Type": "application/json", "X-Api-Key": apiKey };

      const res = await fetch("/api/quiz/create", {
        method: "POST",
        headers,
        body: JSON.stringify({ type, source, count, timerDuration, decade: decade || undefined }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create quiz. Are you logged in?");
      }
      const quiz = await res.json();

      // Add participants
      for (const name of participants) {
        await fetch(`/api/quiz/${quiz.id}`, {
          method: "PATCH",
          headers,
          body: JSON.stringify({ action: "add-participant", name }),
        });
      }

      router.push(`/quiz/${quiz.id}`);
    } catch (err) {
      setError(String(err));
      setLoading(false);
    }
  }

  function addParticipant() {
    const name = newName.trim();
    if (name && !participants.includes(name)) {
      setParticipants([...participants, name]);
      setNewName("");
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg bg-card border border-border rounded-2xl p-8 space-y-8 animate-[fadeUp_0.6s_cubic-bezier(0.16,1,0.3,1)_both]">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Music Quiz</h1>
          <p className="text-muted text-sm mt-2">Set up your quiz and add players</p>
        </div>

        {/* Quiz type */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-muted">Quiz Type</label>
          <div className="grid grid-cols-2 gap-2">
            {QUIZ_TYPES.map((t) => (
              <button
                key={t.value}
                onClick={() => setType(t.value)}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  type === t.value
                    ? "bg-apple-red text-white"
                    : "bg-background border border-border text-muted hover:text-foreground"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Source */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-muted">Music Source</label>
          <div className="grid grid-cols-2 gap-2">
            {SOURCES.map((s) => (
              <button
                key={s.value}
                onClick={() => setSource(s.value)}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  source === s.value
                    ? "bg-apple-red text-white"
                    : "bg-background border border-border text-muted hover:text-foreground"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Settings */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted">Questions</label>
            <input
              type="number"
              min={3}
              max={25}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted">Timer (sec)</label>
            <input
              type="number"
              min={10}
              max={120}
              value={timerDuration}
              onChange={(e) => setTimerDuration(Number(e.target.value))}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm"
            />
          </div>
        </div>

        {/* Decade filter */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-muted">Decade (optional)</label>
          <input
            type="text"
            placeholder="e.g. 1980"
            value={decade}
            onChange={(e) => setDecade(e.target.value)}
            className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm"
          />
        </div>

        {/* Participants */}
        <div className="space-y-3">
          <label className="text-sm font-medium text-muted">Players</label>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Player name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addParticipant()}
              className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-sm"
            />
            <button
              onClick={addParticipant}
              className="px-4 py-2 bg-border rounded-lg text-sm font-medium hover:bg-card-hover transition-colors"
            >
              Add
            </button>
          </div>
          {participants.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {participants.map((name) => (
                <span
                  key={name}
                  className="inline-flex items-center gap-1 bg-background border border-border rounded-full px-3 py-1 text-sm"
                >
                  {name}
                  <button
                    onClick={() => setParticipants(participants.filter((p) => p !== name))}
                    className="text-muted hover:text-apple-red ml-1"
                  >
                    &times;
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {error && (
          <div className="bg-red-950/50 border border-red-900/50 rounded-lg px-4 py-2 text-sm text-red-400">
            {error}
          </div>
        )}

        <button
          onClick={createQuiz}
          disabled={loading || participants.length === 0}
          className="w-full bg-apple-red text-white font-semibold rounded-xl px-6 py-3 hover:opacity-90 transition-opacity disabled:opacity-40"
        >
          {loading ? "Creating quiz..." : "Start Quiz"}
        </button>

        <a href="/" className="block text-center text-sm text-dimmer hover:text-muted transition-colors">
          Back to now playing
        </a>
      </div>
    </main>
  );
}
