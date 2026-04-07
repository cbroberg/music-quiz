import SwiftUI

/// Mirrors `.scoreboard-screen` — ranked list of players with gold/silver/
/// bronze accent on the top three.
struct ScoreboardView: View {
    @ObservedObject var coordinator: QuizCoordinator

    var body: some View {
        VStack(spacing: 32) {
            Text("Scoreboard")
                .font(Theme.display(56, weight: .black))
                .foregroundColor(Theme.text)
            VStack(spacing: 12) {
                ForEach(0..<coordinator.rankings.count, id: \.self) { idx in
                    row(for: coordinator.rankings[idx], rank: idx + 1)
                        .transition(.asymmetric(
                            insertion: .move(edge: .bottom).combined(with: .opacity),
                            removal: .opacity
                        ))
                        .animation(
                            .spring(response: 0.55, dampingFraction: 0.78)
                                .delay(Double(idx) * 0.08),
                            value: coordinator.rankings.count
                        )
                }
            }
            .frame(maxWidth: 800)
            Spacer()
        }
        .padding(.top, 60)
        .padding(.horizontal, 80)
    }

    private func row(for entry: [String: Any], rank: Int) -> some View {
        let name   = (entry["playerName"] as? String) ?? "—"
        let avatar = (entry["avatar"] as? String) ?? ""
        let score  = entry.rankingScore
        let streak = entry.rankingStreak

        return HStack(spacing: 20) {
            Text("\(rank)")
                .font(Theme.display(32, weight: .black))
                .foregroundColor(rankColor(rank))
                .frame(width: 56)
            if !avatar.isEmpty {
                Text(avatar).font(.system(size: 40))
            }
            Text(name)
                .font(Theme.display(28, weight: .semibold))
                .foregroundColor(Theme.text)
            Spacer()
            if streak >= 2 {
                Text("🔥 \(streak)")
                    .font(Theme.display(18, weight: .bold))
                    .foregroundColor(Theme.orange)
            }
            Text("\(score)")
                .font(Theme.display(32, weight: .black))
                .foregroundColor(Theme.red)
        }
        .padding(.horizontal, 32)
        .padding(.vertical, 20)
        .background(
            RoundedRectangle(cornerRadius: 16).fill(Theme.card)
        )
    }

    private func rankColor(_ rank: Int) -> Color {
        switch rank {
        case 1: return Theme.gold
        case 2: return Theme.silver
        case 3: return Theme.bronze
        default: return Theme.muted
        }
    }
}
