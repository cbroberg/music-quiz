import SwiftUI

/// Mirrors `.final-screen` and `.podium` — gold/silver/bronze podium with the
/// 1st-place block elevated and softly pulsing in gold.
struct FinalView: View {
    @ObservedObject var coordinator: QuizCoordinator

    private var ordered: [[String: Any]] {
        coordinator.rankings.sorted { lhs, rhs in
            lhs.rankingScore > rhs.rankingScore
        }
    }

    var body: some View {
        VStack(spacing: 32) {
            Text("Champions")
                .font(Theme.display(72, weight: .black))
                .foregroundStyle(
                    LinearGradient(
                        colors: [Theme.yellow, Theme.orange],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .padding(.top, 40)

            podium
                .padding(.top, 24)

            if ordered.count > 3 {
                runnersUp
                    .padding(.top, 32)
            }
            Spacer()
        }
        .overlay(ConfettiBurst().allowsHitTesting(false))
    }

    /// Animated podium tile — gold-pulse loop on rank #1 mirrors the
    /// `host.css` `gold-pulse` keyframes.
    private struct PodiumPlaceView: View {
        let name: String
        let avatar: String
        let score: Int
        let rank: Int
        @State private var pulse = false

        var body: some View {
            let medalColor: Color = rank == 1 ? Theme.gold : (rank == 2 ? Theme.silver : Theme.bronze)
            let extraTop: CGFloat = rank == 1 ? 32 : (rank == 2 ? 12 : 4)

            VStack(spacing: 12) {
                Text(avatar).font(.system(size: 64))
                Text(name)
                    .font(Theme.display(28, weight: .heavy))
                    .foregroundColor(Theme.text)
                    .lineLimit(1)
                Text("\(score)")
                    .font(Theme.display(36, weight: .black))
                    .foregroundColor(Theme.red)
            }
            .padding(.horizontal, 36)
            .padding(.top, 24 + extraTop)
            .padding(.bottom, 24)
            .frame(minWidth: 220)
            .background(
                RoundedRectangle(cornerRadius: 24).fill(Theme.card)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 24)
                    .stroke(medalColor, lineWidth: rank == 1 ? 3 : 1.5)
            )
            .shadow(
                color: rank == 1 ? medalColor.opacity(pulse ? 0.55 : 0.20) : .clear,
                radius: rank == 1 ? (pulse ? 60 : 30) : 0
            )
            .scaleEffect(rank == 1 && pulse ? 1.02 : 1.0)
            .onAppear {
                guard rank == 1 else { return }
                withAnimation(.easeInOut(duration: 2).repeatForever(autoreverses: true)) {
                    pulse = true
                }
            }
        }
    }

    private var podium: some View {
        HStack(alignment: .bottom, spacing: 32) {
            if ordered.count >= 2 {
                podiumPlace(entry: ordered[1], rank: 2)
            }
            if ordered.count >= 1 {
                podiumPlace(entry: ordered[0], rank: 1)
            }
            if ordered.count >= 3 {
                podiumPlace(entry: ordered[2], rank: 3)
            }
        }
    }

    private func podiumPlace(entry: [String: Any], rank: Int) -> some View {
        PodiumPlaceView(
            name:   (entry["playerName"] as? String) ?? "—",
            avatar: (entry["avatar"] as? String) ?? "🎵",
            score:  entry.rankingScore,
            rank:   rank
        )
    }

    private var runnersUp: some View {
        VStack(spacing: 8) {
            ForEach(3..<ordered.count, id: \.self) { idx in
                let entry = ordered[idx]
                let name = (entry["playerName"] as? String) ?? "—"
                let avatar = (entry["avatar"] as? String) ?? ""
                let score = (entry["score"] as? Int) ?? 0
                HStack(spacing: 16) {
                    Text("\(idx + 1)")
                        .font(Theme.display(24, weight: .heavy))
                        .foregroundColor(Theme.muted)
                        .frame(width: 40)
                    if !avatar.isEmpty {
                        Text(avatar).font(.system(size: 28))
                    }
                    Text(name)
                        .font(Theme.display(22, weight: .semibold))
                        .foregroundColor(Theme.text)
                    Spacer()
                    Text("\(score)")
                        .font(Theme.display(24, weight: .heavy))
                        .foregroundColor(Theme.muted)
                }
                .padding(.horizontal, 24)
                .padding(.vertical, 14)
                .background(RoundedRectangle(cornerRadius: 12).fill(Theme.card))
            }
        }
        .frame(maxWidth: 600)
    }
}
