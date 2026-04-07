import SwiftUI

/// Mirrors the vanilla `.question-screen` layout: header (number + type),
/// big artwork left, question text + 4 colored options right, timer pill
/// top-right.
struct QuestionView: View {
    @ObservedObject var coordinator: QuizCoordinator

    private var question: [String: Any] { coordinator.question ?? [:] }
    private var options: [String]      { (question["options"] as? [String]) ?? [] }
    private var artworkURL: URL?       { Self.normalisedArtworkURL(question["artworkUrl"] as? String) }
    private var questionText: String   { (question["questionText"] as? String) ?? "" }
    private var questionType: String   { (question["questionType"] as? String) ?? "" }
    private var isTrivia: Bool         { (question["isTrivia"] as? Bool) ?? false }

    var body: some View {
        VStack(spacing: 24) {
            if coordinator.blindMode {
                blindBanner
            }
            header
            HStack(alignment: .center, spacing: 56) {
                artworkView
                rightSide
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 80)
        .padding(.top, 40)
        .padding(.bottom, 40)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    /// Persistent banner shown above the question header when the host
    /// enabled `blindMode` for the entire quiz. See `docs/TVOS-WS-PROTOCOL.md §7.1`.
    private var blindBanner: some View {
        HStack(spacing: 14) {
            Image(systemName: "eye.slash.fill")
                .font(.system(size: 22, weight: .black))
            Text("BLIND ROUND")
                .font(Theme.display(22, weight: .black))
                .tracking(2)
            Text("·")
                .opacity(0.5)
            Text("3× POINTS")
                .font(Theme.display(22, weight: .heavy))
        }
        .foregroundColor(Theme.bg)
        .padding(.horizontal, 26)
        .padding(.vertical, 10)
        .background(Capsule().fill(Theme.yellow))
    }

    // ── Header ────────────────────────────────────────────
    private var header: some View {
        HStack {
            if coordinator.totalQuestions > 0 {
                Text("Q \(coordinator.questionNumber) / \(coordinator.totalQuestions)")
                    .font(Theme.display(22, weight: .medium))
                    .foregroundColor(Theme.muted)
            }
            Spacer()
            Text(typeLabel.uppercased())
                .font(Theme.display(22, weight: .heavy))
                .tracking(1.2)
                .foregroundColor(Theme.red)
            Spacer()
            if coordinator.roundNumber > 0 {
                Text("ROUND \(coordinator.roundNumber)")
                    .font(Theme.display(20, weight: .heavy))
                    .tracking(1)
                    .foregroundColor(Theme.red)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 6)
                    .background(Capsule().fill(Theme.red.opacity(0.15)))
            }
        }
    }

    private var typeLabel: String {
        switch questionType {
        case "song-title":        return "Name the song"
        case "artist":            return "Name the artist"
        case "album":             return "Name the album"
        case "year":              return "Release year"
        case "intro":             return "Name the intro"
        case "interlude":         return "Name the interlude"
        case "country-of-origin": return "Country of origin"
        case "band-members":      return "Band members"
        case "artist-trivia":     return "Artist trivia"
        case "film-soundtrack":   return "Film soundtrack"
        case "tv-theme":          return "TV theme"
        case "gossip":            return "Music gossip"
        default:                  return isTrivia ? "Music trivia" : "Listen up"
        }
    }

    // ── Artwork ───────────────────────────────────────────
    private var artworkView: some View {
        Group {
            if let url = artworkURL, !isTrivia {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image.resizable().scaledToFill()
                    case .failure, .empty:
                        Theme.card
                    @unknown default:
                        Theme.card
                    }
                }
            } else {
                ZStack {
                    Theme.card
                    Image(systemName: isTrivia ? "music.quarternote.3" : "music.note")
                        .font(.system(size: 120, weight: .light))
                        .foregroundColor(Theme.muted)
                }
            }
        }
        .frame(width: 420, height: 420)
        .clipShape(RoundedRectangle(cornerRadius: 24))
        .shadow(color: Theme.redGlow, radius: 80)
    }

    // ── Right side: question + options ────────────────────
    private var rightSide: some View {
        VStack(alignment: .leading, spacing: 32) {
            Text(questionText.isEmpty ? "Listen…" : questionText)
                .font(Theme.display(40, weight: .heavy))
                .foregroundColor(Theme.text)
                .multilineTextAlignment(.leading)
                .fixedSize(horizontal: false, vertical: true)

            if options.isEmpty || coordinator.blindMode {
                freeTextHint
            } else {
                optionsGrid
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var optionsGrid: some View {
        LazyVGrid(columns: [GridItem(.flexible(), spacing: 16),
                            GridItem(.flexible(), spacing: 16)],
                  spacing: 16) {
            ForEach(0..<options.count, id: \.self) { idx in
                optionTile(text: options[idx], color: Theme.optionColor(at: idx))
            }
        }
    }

    private func optionTile(text: String, color: Color) -> some View {
        HStack {
            Text(text)
                .font(Theme.display(24, weight: .semibold))
                .foregroundColor(.white)
                .multilineTextAlignment(.leading)
                .lineLimit(2)
            Spacer()
        }
        .padding(.horizontal, 28)
        .padding(.vertical, 24)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 14).fill(color)
        )
    }

    private var freeTextHint: some View {
        Text("Type your answer on your phone")
            .font(Theme.display(28, weight: .medium))
            .italic()
            .foregroundColor(Theme.muted)
            .padding(40)
            .frame(maxWidth: .infinity)
            .background(
                RoundedRectangle(cornerRadius: 16)
                    .fill(Theme.card)
                    .overlay(
                        RoundedRectangle(cornerRadius: 16)
                            .strokeBorder(style: StrokeStyle(lineWidth: 2, dash: [10, 6]))
                            .foregroundColor(Theme.border)
                    )
            )
    }

    // ── Helpers ───────────────────────────────────────────
    /// Apple Music artwork URLs typically include `{w}` / `{h}` placeholders.
    private static func normalisedArtworkURL(_ raw: String?) -> URL? {
        guard let raw, !raw.isEmpty else { return nil }
        let resolved = raw
            .replacingOccurrences(of: "{w}", with: "800")
            .replacingOccurrences(of: "{h}", with: "800")
        return URL(string: resolved)
    }
}
