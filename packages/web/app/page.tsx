"use client";

import { Suspense } from "react";
import { Sphere } from "@/components/sphere";
import { NowPlaying } from "@/components/now-playing";
import { useNowPlaying } from "@/hooks/use-now-playing";
import { useSearchParams } from "next/navigation";

function NavBarInner() {
  const params = useSearchParams();
  const fromDj = params.get("from") === "dj";
  const djCode = params.get("code") || "";

  if (fromDj) {
    const backUrl = djCode ? `/quiz/play?code=${djCode}` : "/quiz/play";
    return (
      <nav className="fixed top-0 right-0 flex items-center gap-3 px-6 py-5 text-[13px]">
        <a href={backUrl} className="text-apple-red font-semibold hover:opacity-70 transition-opacity">Back to DJ Mode</a>
      </nav>
    );
  }

  return (
    <nav className="fixed top-0 right-0 flex items-center gap-3 px-6 py-5 text-[13px]">
      <a href="/quiz/host" className="text-apple-red font-semibold hover:opacity-70 transition-opacity">DJ Mode</a>
      <a href="/quiz/host" className="text-muted hover:text-foreground transition-colors">Quiz</a>
      <a href="/quiz/admin" className="text-muted hover:text-foreground transition-colors">Admin</a>
      <a href="/login" className="text-muted hover:text-foreground transition-colors">Login</a>
    </nav>
  );
}

function NavBar() {
  return <Suspense><NavBarInner /></Suspense>;
}

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
      <NavBar />

      {!nowPlaying.connected && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-card border border-border rounded-lg px-4 py-2 text-sm text-muted">
          Connecting...
        </div>
      )}
    </main>
  );
}
