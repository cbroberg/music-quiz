"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

const GENRES = [
  { value: "20", label: "Alternative" },
  { value: "2", label: "Blues" },
  { value: "5", label: "Classical" },
  { value: "17", label: "Dance" },
  { value: "7", label: "Electronic" },
  { value: "18", label: "Hip-Hop/Rap" },
  { value: "11", label: "Jazz" },
  { value: "12", label: "Latin" },
  { value: "1153", label: "Metal" },
  { value: "14", label: "Pop" },
  { value: "15", label: "R&B/Soul" },
  { value: "24", label: "Reggae" },
  { value: "21", label: "Rock" },
  { value: "10", label: "Singer/Songwriter" },
  { value: "16", label: "Soundtrack" },
  { value: "19", label: "World" },
];

const DECADES = [
  { value: "1960", label: "60s" },
  { value: "1970", label: "70s" },
  { value: "1980", label: "80s" },
  { value: "1990", label: "90s" },
  { value: "2000", label: "00s" },
  { value: "2010", label: "10s" },
  { value: "2020", label: "20s" },
];

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
  { value: "charts", label: "Top Charts" },
  { value: "library", label: "My Library" },
  { value: "charts-genre", label: "Genre" },
  { value: "charts-soundtrack", label: "Movie Soundtracks" },
  { value: "dansk", label: "Dansk Musik" },
  { value: "random", label: "Random Shuffle" },
];

export default function QuizLobby() {
  const router = useRouter();
  const [type, setType] = useState("mixed");
  const [source, setSource] = useState("recently-played");
  const [genre, setGenre] = useState("");
  const [count, setCount] = useState(10);
  const [timerDuration, setTimerDuration] = useState(30);
  const [decade, setDecade] = useState("");
  const [participants, setParticipants] = useState<string[]>([]);
  const [newName, setNewName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [checkingAuth, setCheckingAuth] = useState(true);

  // Check login before showing quiz
  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((data) => {
        if (!data.isLoggedIn) {
          // In dev, auto-login via /api/auth/github (which sets cookie without GitHub)
          if (window.location.hostname === "localhost") {
            fetch("/api/auth/github", { redirect: "manual" }).then(() => setCheckingAuth(false));
          } else {
            router.replace("/login");
          }
        } else {
          setCheckingAuth(false);
        }
      })
      .catch(() => router.replace("/login"));
  }, [router]);

  // Recent players from localStorage
  const [recentPlayers, setRecentPlayers] = useState<string[]>([]);
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("recentPlayers") || "[]");
      if (Array.isArray(stored)) setRecentPlayers(stored.slice(0, 6));
    } catch {}
  }, []);

  if (checkingAuth) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <p className="text-muted">Checking login...</p>
      </main>
    );
  }

  async function createQuiz() {
    setLoading(true);
    setError("");
    try {
      // Map frontend source to backend source + genre
      let apiSource = source;
      let apiGenre = genre || undefined;
      if (source === "charts-genre") {
        apiSource = "charts";
        if (!genre) { setError("Please select a genre"); setLoading(false); return; }
      } else if (source === "charts-soundtrack") {
        apiSource = "charts";
        apiGenre = "16";
      } else if (source === "dansk") {
        apiSource = "charts";
        // No specific genre for Danish — use general charts for DK storefront
        // The storefront is already 'dk' so charts return Danish content
      } else if (source === "random") {
        apiSource = "charts";
        // Random genre
        const randomGenre = GENRES[Math.floor(Math.random() * GENRES.length)];
        apiGenre = randomGenre.value;
      }

      const res = await fetch("/api/quiz/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, source: apiSource, count, timerDuration, decade: decade || undefined, genre: apiGenre }),
      });
      if (!res.ok) {
        const data = await res.json();
        if (data.error === "Unauthorized") throw new Error("Not logged in. Go to /login first.");
        throw new Error(data.error || "Failed to create quiz");
      }
      const quiz = await res.json();

      // Save participants to localStorage
      const allRecent = [...new Set([...participants, ...recentPlayers])].slice(0, 6);
      localStorage.setItem("recentPlayers", JSON.stringify(allRecent));

      // Add participants
      for (const name of participants) {
        await fetch(`/api/quiz/${quiz.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
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

        {/* Genre selector (shown for Genre source) */}
        {source === "charts-genre" && (
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted">Genre</label>
            <select
              value={genre}
              onChange={(e) => setGenre(e.target.value)}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm"
            >
              <option value="">Select genre...</option>
              {GENRES.map((g) => (
                <option key={g.value} value={g.value}>{g.label}</option>
              ))}
            </select>
          </div>
        )}

        {/* Decade filter */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-muted">Decade (optional)</label>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setDecade("")}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                decade === "" ? "bg-apple-red text-white" : "bg-background border border-border text-muted hover:text-foreground"
              }`}
            >
              All
            </button>
            {DECADES.map((d) => (
              <button
                key={d.value}
                onClick={() => setDecade(d.value)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  decade === d.value ? "bg-apple-red text-white" : "bg-background border border-border text-muted hover:text-foreground"
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        {/* Participants */}
        <div className="space-y-3">
          <label className="text-sm font-medium text-muted">Players</label>
          {recentPlayers.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs text-dimmer">Recent players — click to add</p>
              <div className="flex flex-wrap gap-2">
                {recentPlayers
                  .filter((name) => !participants.includes(name))
                  .map((name) => (
                    <button
                      key={name}
                      onClick={() => setParticipants([...participants, name])}
                      className="bg-background border border-border rounded-full px-3 py-1 text-sm text-muted hover:text-foreground hover:border-apple-red transition-colors"
                    >
                      + {name}
                    </button>
                  ))}
              </div>
            </div>
          )}
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
