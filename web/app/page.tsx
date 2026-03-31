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

      {/* Nav — same position as admin header actions */}
      <nav className="fixed top-0 right-0 flex items-center gap-3 px-6 py-5 text-[13px]">
        <a href="/quiz/host" className="text-muted hover:text-foreground transition-colors">Quiz</a>
        <a href="/quiz/admin" className="text-muted hover:text-foreground transition-colors">Admin</a>
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
