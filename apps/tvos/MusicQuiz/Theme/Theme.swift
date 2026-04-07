import SwiftUI

/// Mirrors `packages/quiz-engine/src/public/host.css` :root variables so the
/// tvOS UI is visually consistent with the vanilla web host. When the web
/// design changes, update this file in lockstep.
enum Theme {
    // ── Backgrounds / surfaces ────────────────────────────
    static let bg     = Color(hex: 0x0A0A0A)
    static let card   = Color(hex: 0x141414)
    static let border = Color(hex: 0x1E1E1E)

    // ── Text ──────────────────────────────────────────────
    static let text   = Color(hex: 0xFAFAFA)
    static let muted  = Color(hex: 0x888888)
    static let dimmer = Color(hex: 0x555555)

    // ── Accents ───────────────────────────────────────────
    static let red       = Color(hex: 0xFC3C44)
    static let redGlow   = Color(hex: 0xFC3C44).opacity(0.3)
    static let green     = Color(hex: 0x34C759)
    static let blue      = Color(hex: 0x5AC8FA)
    static let yellow    = Color(hex: 0xFFD60A)
    static let orange    = Color(hex: 0xFF9F0A)

    // ── Quiz options (Kahoot palette) ─────────────────────
    static let optionA = Color(hex: 0xE21B3C)
    static let optionB = Color(hex: 0x1368CE)
    static let optionC = Color(hex: 0xD89E00)
    static let optionD = Color(hex: 0x26890C)

    static func optionColor(at index: Int) -> Color {
        switch index % 4 {
        case 0: return optionA
        case 1: return optionB
        case 2: return optionC
        default: return optionD
        }
    }

    // ── Medals (podium ranks) ─────────────────────────────
    static let gold   = Color(hex: 0xFFD60A)
    static let silver = Color(hex: 0xC0C0C0)
    static let bronze = Color(hex: 0xCD7F32)

    // ── Fonts ─────────────────────────────────────────────
    /// `Outfit` is the web design font. We don't bundle a custom font in the
    /// scaffold; SwiftUI's `.rounded` system design hits the same vibe and
    /// avoids licensing/bundling friction.
    static func display(_ size: CGFloat, weight: Font.Weight = .heavy) -> Font {
        .system(size: size, weight: weight, design: .rounded)
    }
}

// ── Color hex helper ─────────────────────────────────────
extension Color {
    init(hex: UInt32, alpha: Double = 1.0) {
        let r = Double((hex >> 16) & 0xFF) / 255.0
        let g = Double((hex >> 8)  & 0xFF) / 255.0
        let b = Double( hex        & 0xFF) / 255.0
        self.init(.sRGB, red: r, green: g, blue: b, opacity: alpha)
    }
}

// ── Reusable backdrop ────────────────────────────────────
struct AppBackground: View {
    var body: some View {
        Theme.bg.ignoresSafeArea()
    }
}

// ── Ranking field helpers ────────────────────────────────
/// Server emits two ranking shapes: `scoreboard` carries `score`,
/// `final_results` carries `totalScore`. Read whichever exists so the same
/// view can render either broadcast.
extension Dictionary where Key == String, Value == Any {
    var rankingScore: Int {
        (self["score"] as? Int)
            ?? (self["totalScore"] as? Int)
            ?? 0
    }
    var rankingStreak: Int {
        (self["streak"] as? Int)
            ?? (self["longestStreak"] as? Int)
            ?? 0
    }
}
