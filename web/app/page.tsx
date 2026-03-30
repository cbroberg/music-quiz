"use client";

import { Sphere } from "@/components/sphere";
import { NowPlaying } from "@/components/now-playing";
import { useNowPlaying } from "@/hooks/use-now-playing";

export default function Home() {
  const nowPlaying = useNowPlaying();

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-12 px-4">
      <Sphere
        artworkUrl={nowPlaying.artworkUrl}
        isPlaying={nowPlaying.state === "playing"}
      />
      <NowPlaying data={nowPlaying} />

      {/* Nav */}
      <nav className="fixed top-0 right-0 flex gap-4 p-4 text-sm">
        <a href="/quiz" className="text-muted hover:text-foreground transition-colors">Quiz</a>
        <a href="/login" className="text-muted hover:text-foreground transition-colors">Login</a>
      </nav>

      {!nowPlaying.connected && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-card border border-border rounded-lg px-4 py-2 text-sm text-muted">
          Connecting...
        </div>
      )}
    </main>
  );
}
