"use client";

interface SphereProps {
  artworkUrl?: string;
  isPlaying?: boolean;
}

export function Sphere({ artworkUrl, isPlaying }: SphereProps) {
  return (
    <div className="relative w-[900px] h-[900px] max-w-[95vw] max-h-[95vw]">
      {/* Ambient glow — large, diffuse, fills the space */}
      <div
        className="absolute top-1/2 left-1/2 w-[180%] h-[180%] pointer-events-none"
        style={{
          background: "radial-gradient(circle, rgba(252,60,68,0.12) 0%, rgba(180,40,50,0.04) 40%, transparent 70%)",
          animation: "sphereGlowOuter 8s ease-in-out infinite",
          transform: "translate(-50%, -50%)",
        }}
      />

      {/* Core glow — warm, organic */}
      <div
        className="absolute top-1/2 left-1/2 w-full h-full rounded-full"
        style={{
          background: "radial-gradient(circle at 45% 40%, rgba(252,60,68,0.35) 0%, rgba(200,45,55,0.12) 35%, rgba(150,30,40,0.04) 60%, transparent 80%)",
          animation: isPlaying
            ? "spherePulse 4s ease-in-out infinite"
            : "spherePulse 8s ease-in-out infinite",
          transform: "translate(-50%, -50%)",
        }}
      />

      {/* Album artwork as vinyl record */}
      {artworkUrl && (
        <div
          className="absolute top-1/2 left-1/2 w-[55%] h-[55%] rounded-full overflow-hidden"
          style={{
            transform: "translate(-50%, -50%)",
            animation: isPlaying ? "vinylSpin 1.8s linear infinite" : "none",
          }}
        >
          <img
            src={artworkUrl}
            alt="Album artwork"
            className="w-full h-full object-cover"
            style={{ filter: "brightness(0.9) saturate(1.15)" }}
          />
          {/* Vinyl grooves overlay */}
          <div
            className="absolute inset-0 rounded-full"
            style={{
              background: `
                repeating-radial-gradient(
                  circle at center,
                  transparent 0px,
                  transparent 3px,
                  rgba(0,0,0,0.03) 3px,
                  rgba(0,0,0,0.03) 4px
                )
              `,
            }}
          />
          {/* Center hole — black circle like a 45 RPM */}
          <div
            className="absolute top-1/2 left-1/2 rounded-full"
            style={{
              width: "8%",
              height: "8%",
              transform: "translate(-50%, -50%)",
              background: "radial-gradient(circle at 40% 40%, #151515 0%, #0a0a0a 50%, #111 80%, #0a0a0a 100%)",
              boxShadow: "0 0 8px 4px rgba(0,0,0,0.8), inset 0 1px 2px rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.04)",
            }}
          />
          {/* Soft edge blend into glow */}
          <div
            className="absolute inset-0 rounded-full"
            style={{
              boxShadow: "inset 0 0 40px 20px rgba(13,13,13,0.6)",
            }}
          />
        </div>
      )}

      {/* Warm highlight spot */}
      <div
        className="absolute top-1/2 left-1/2 w-[60%] h-[60%] rounded-full pointer-events-none"
        style={{
          background: "radial-gradient(circle at 35% 30%, rgba(255,200,180,0.06) 0%, transparent 50%)",
          transform: "translate(-50%, -50%)",
        }}
      />
    </div>
  );
}
