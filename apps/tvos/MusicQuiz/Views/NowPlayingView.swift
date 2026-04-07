import SwiftUI

/// SwiftUI port of the vanilla `host.css` `.np-screen` — pulsing red glow
/// halo with a spinning vinyl record at its centre. Driven by the latest
/// `track` info pushed from the playback bridge.
///
/// Used as the "between rounds" / DJ Mode visual when the display has a
/// playback claim and the engine is idle on a track. Also doubles as the
/// `playing` background when artwork would otherwise be blurred.
struct NowPlayingView: View {
    let trackName:  String
    let artistName: String
    let albumName:  String?
    let artworkURL: URL?
    let isPlaying:  Bool

    @State private var spin: Double = 0

    var body: some View {
        VStack(spacing: 36) {
            Spacer(minLength: 0)
            sphere
            info
            Spacer(minLength: 0)
        }
        .padding(60)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // ── Vinyl sphere ──────────────────────────────────────
    private var sphere: some View {
        ZStack {
            // Outer glow halo (pulses with `pulsePhase`)
            Circle()
                .fill(
                    RadialGradient(
                        colors: [
                            Theme.red.opacity(0.30),
                            Theme.red.opacity(0.10),
                            Color.clear,
                        ],
                        center: .center,
                        startRadius: 0,
                        endRadius: 460
                    )
                )
                .frame(width: 920, height: 920)
                .modifier(BreathingScale(min: 0.95, max: 1.10, period: 6))

            // Core glow (more saturated, faster pulse when playing)
            Circle()
                .fill(
                    RadialGradient(
                        colors: [
                            Theme.red.opacity(0.55),
                            Theme.red.opacity(0.20),
                            Theme.red.opacity(0.04),
                            Color.clear,
                        ],
                        center: UnitPoint(x: 0.45, y: 0.40),
                        startRadius: 0,
                        endRadius: 320
                    )
                )
                .frame(width: 540, height: 540)
                .modifier(BreathingScale(min: 0.96, max: 1.12, period: isPlaying ? 4 : 8))

            // The vinyl itself
            vinyl
                .frame(width: 320, height: 320)
        }
    }

    private var vinyl: some View {
        ZStack {
            // Album artwork as the record surface
            Group {
                if let url = artworkURL {
                    AsyncImage(url: url) { phase in
                        switch phase {
                        case .success(let image):
                            image.resizable().scaledToFill()
                        default:
                            Theme.card
                        }
                    }
                } else {
                    Theme.card
                }
            }
            .saturation(1.15)
            .brightness(-0.05)
            .clipShape(Circle())

            // Concentric grooves
            Circle()
                .fill(
                    AngularGradient(
                        gradient: Gradient(colors: [
                            Color.black.opacity(0.06),
                            Color.black.opacity(0.0),
                            Color.black.opacity(0.06),
                        ]),
                        center: .center
                    )
                )

            // Inner shadow for depth
            Circle()
                .strokeBorder(Color.black.opacity(0.55), lineWidth: 30)
                .blur(radius: 20)
                .clipShape(Circle())

            // Centre label
            Circle()
                .fill(
                    RadialGradient(
                        colors: [Color(hex: 0x151515), Color(hex: 0x0A0A0A), Color(hex: 0x111111)],
                        center: UnitPoint(x: 0.4, y: 0.4),
                        startRadius: 1, endRadius: 18
                    )
                )
                .frame(width: 28, height: 28)
                .overlay(Circle().stroke(Color.white.opacity(0.04), lineWidth: 0.5))

            // Specular highlight
            Circle()
                .fill(
                    RadialGradient(
                        colors: [Color.white.opacity(0.08), Color.clear],
                        center: UnitPoint(x: 0.35, y: 0.30),
                        startRadius: 0, endRadius: 100
                    )
                )
        }
        .rotationEffect(.degrees(spin))
        .onAppear {
            if isPlaying { startSpin() }
        }
        .onChange(of: isPlaying) { _, playing in
            if playing { startSpin() }
        }
    }

    private func startSpin() {
        // Slow continuous rotation while playing — 33 rpm vibe (~1.8s/rev).
        withAnimation(.linear(duration: 1.8).repeatForever(autoreverses: false)) {
            spin += 360
        }
    }

    // ── Info block ────────────────────────────────────────
    private var info: some View {
        VStack(spacing: 8) {
            Text(trackName)
                .font(Theme.display(40, weight: .heavy))
                .foregroundColor(Theme.text)
                .lineLimit(1)
                .truncationMode(.tail)
            Text(artistName)
                .font(Theme.display(24, weight: .medium))
                .foregroundColor(Theme.muted)
            if let album = albumName, !album.isEmpty {
                Text(album)
                    .font(Theme.display(18, weight: .regular))
                    .foregroundColor(Theme.dimmer)
            }
        }
        .multilineTextAlignment(.center)
    }
}

// ── BreathingScale modifier ──────────────────────────────
/// Continuous "breathing" scale animation between two values.
private struct BreathingScale: ViewModifier {
    let min: Double
    let max: Double
    let period: Double
    @State private var phase = false

    func body(content: Content) -> some View {
        content
            .scaleEffect(phase ? max : min)
            .onAppear {
                withAnimation(.easeInOut(duration: period).repeatForever(autoreverses: true)) {
                    phase = true
                }
            }
    }
}
