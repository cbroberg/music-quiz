"use client";

import type { NowPlayingData } from "@/hooks/use-now-playing";

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

interface NowPlayingProps {
  data: NowPlayingData;
}

export function NowPlaying({ data }: NowPlayingProps) {
  if (data.state === "stopped") {
    return (
      <div className="text-center animate-[fadeUp_1s_cubic-bezier(0.16,1,0.3,1)_both]">
        <p className="text-muted text-lg">Not playing</p>
      </div>
    );
  }

  return (
    <div className="text-center space-y-3 animate-[fadeUp_1s_cubic-bezier(0.16,1,0.3,1)_both]">
      <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground">
        {data.track}
      </h2>
      <p className="text-lg text-muted">{data.artist}</p>
      <p className="text-sm text-dimmer">{data.album}</p>
      {data.duration != null && data.position != null && (
        <div className="flex items-center justify-center gap-3 text-sm text-dimmer">
          <span>{formatTime(data.position)}</span>
          <div className="w-48 h-1 bg-border rounded-full overflow-hidden">
            <div
              className="h-full bg-apple-red rounded-full transition-all duration-1000"
              style={{ width: `${(data.position / data.duration) * 100}%` }}
            />
          </div>
          <span>{formatTime(data.duration)}</span>
        </div>
      )}
      {data.state === "paused" && (
        <button
          onClick={async () => {
            try { await fetch("/api/quiz/play-pause", { method: "POST" }); } catch {}
          }}
          className="text-xs text-apple-red font-medium uppercase tracking-widest hover:opacity-70 transition-opacity cursor-pointer bg-transparent border-none"
        >
          Paused — tap to play
        </button>
      )}
    </div>
  );
}
