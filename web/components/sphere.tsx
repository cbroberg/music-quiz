"use client";

interface SphereProps {
  artworkUrl?: string;
  isPlaying?: boolean;
}

export function Sphere({ artworkUrl, isPlaying }: SphereProps) {
  return (
    <div className="relative w-[500px] h-[500px] max-w-[80vw] max-h-[80vw]">
      {/* Outer glow */}
      <div
        className="absolute top-1/2 left-1/2 w-[140%] h-[140%] rounded-full pointer-events-none"
        style={{
          background:
            "radial-gradient(circle, rgba(252,60,68,0.08) 0%, transparent 70%)",
          animation: isPlaying
            ? "sphereGlowOuter 6s ease-in-out infinite alternate"
            : "none",
          transform: "translate(-50%, -50%)",
          opacity: isPlaying ? undefined : 0.2,
        }}
      />

      {/* Main sphere */}
      <div
        className="absolute top-1/2 left-1/2 w-full h-full rounded-full overflow-hidden"
        style={{
          background: artworkUrl
            ? undefined
            : "radial-gradient(circle at 40% 35%, rgba(252,60,68,0.6) 0%, rgba(252,60,68,0.15) 50%, rgba(252,60,68,0.03) 80%, transparent 100%)",
          animation: isPlaying
            ? "spherePulse 4s ease-in-out infinite, sphereBreath 3s ease-in-out infinite"
            : "spherePulse 8s ease-in-out infinite",
          transform: "translate(-50%, -50%)",
        }}
      >
        {artworkUrl && (
          <img
            src={artworkUrl}
            alt="Album artwork"
            className="w-full h-full object-cover rounded-full"
            style={{
              filter: "brightness(0.85) saturate(1.1)",
            }}
          />
        )}
      </div>

      {/* Inner highlight */}
      <div
        className="absolute top-1/2 left-1/2 w-full h-full rounded-full pointer-events-none"
        style={{
          background:
            "radial-gradient(circle at 35% 30%, rgba(255,255,255,0.08) 0%, transparent 50%)",
          transform: "translate(-50%, -50%)",
        }}
      />
    </div>
  );
}
