import SwiftUI

/// Mirrors `.reveal-screen` — shows the correct answer card with artwork +
/// song/artist/album, and (when available) a fun fact below.
struct RevealView: View {
    @ObservedObject var coordinator: QuizCoordinator

    private var question: [String: Any] { coordinator.question ?? [:] }
    private var songName: String   { (question["songName"] as? String) ?? "" }
    private var artistName: String { (question["artistName"] as? String) ?? "" }
    private var albumName: String  { (question["albumName"] as? String) ?? "" }
    private var correctAnswer: String { (question["correctAnswer"] as? String) ?? "" }
    private var funFact: String?  { question["funFact"] as? String }
    private var artworkURL: URL? {
        guard let raw = question["artworkUrl"] as? String else { return nil }
        return URL(string: raw
            .replacingOccurrences(of: "{w}", with: "600")
            .replacingOccurrences(of: "{h}", with: "600"))
    }

    /// Detect a steal-round winner: a single player whose `aiExplanation`
    /// contains the literal "STEAL" — the server tags the winner with
    /// `🎯 STEAL — 2× bonus`.
    private var stealWinner: [String: Any]? {
        coordinator.lastQuestionResults.first { result in
            ((result["aiExplanation"] as? String)?.uppercased().contains("STEAL")) ?? false
        }
    }

    var body: some View {
        VStack(spacing: 32) {
            if let winner = stealWinner {
                stealWinnerBanner(winner: winner)
            } else {
                Text("THE ANSWER")
                    .font(Theme.display(28, weight: .heavy))
                    .tracking(2)
                    .foregroundColor(Theme.red)
            }

            answerCard
                .padding(.horizontal, 80)

            if let funFact, !funFact.isEmpty {
                Text(funFact)
                    .font(Theme.display(24, weight: .regular))
                    .italic()
                    .multilineTextAlignment(.center)
                    .foregroundColor(Theme.muted)
                    .padding(.horizontal, 120)
                    .padding(.vertical, 16)
            }
            Spacer()
        }
        .padding(.top, 48)
    }

    private func stealWinnerBanner(winner: [String: Any]) -> some View {
        let name   = (winner["playerName"] as? String) ?? "—"
        let avatar = (winner["avatar"] as? String) ?? "🎯"
        let points = (winner["points"] as? Int) ?? 0
        return VStack(spacing: 8) {
            HStack(spacing: 14) {
                Image(systemName: "bolt.fill")
                    .font(.system(size: 28, weight: .black))
                Text("STEAL!")
                    .font(Theme.display(36, weight: .black))
                    .tracking(3)
            }
            .foregroundColor(.white)
            .padding(.horizontal, 36)
            .padding(.vertical, 14)
            .background(Capsule().fill(Theme.red))
            .shadow(color: Theme.red.opacity(0.6), radius: 30)

            HStack(spacing: 12) {
                Text(avatar).font(.system(size: 36))
                Text("\(name) stole \(points) points")
                    .font(Theme.display(24, weight: .heavy))
                    .foregroundColor(Theme.text)
            }
        }
    }

    private var answerCard: some View {
        HStack(spacing: 32) {
            artworkBox
            VStack(alignment: .leading, spacing: 8) {
                Text(displayTitle)
                    .font(Theme.display(40, weight: .heavy))
                    .foregroundColor(Theme.text)
                if !artistName.isEmpty {
                    Text(artistName)
                        .font(Theme.display(28, weight: .medium))
                        .foregroundColor(Theme.muted)
                }
                if !albumName.isEmpty {
                    Text(albumName)
                        .font(Theme.display(20, weight: .regular))
                        .foregroundColor(Theme.dimmer)
                }
            }
            Spacer()
        }
        .padding(32)
        .frame(maxWidth: .infinity)
        .background(
            RoundedRectangle(cornerRadius: 28).fill(Theme.card)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 28).stroke(Theme.green.opacity(0.6), lineWidth: 2)
        )
    }

    private var displayTitle: String {
        if !songName.isEmpty { return songName }
        if !correctAnswer.isEmpty { return correctAnswer }
        return "—"
    }

    private var artworkBox: some View {
        Group {
            if let url = artworkURL {
                AsyncImage(url: url) { phase in
                    if case .success(let img) = phase {
                        img.resizable().scaledToFill()
                    } else {
                        Theme.bg
                    }
                }
            } else {
                Theme.bg
            }
        }
        .frame(width: 160, height: 160)
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }
}
