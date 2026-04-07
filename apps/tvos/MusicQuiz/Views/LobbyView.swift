import SwiftUI

/// Mirrors the vanilla setup-screen + players section from `host.css` /
/// `host.html`. The display variant has no Start button — host control lives
/// on the admin/PWA side.
struct LobbyView: View {
    @ObservedObject var coordinator: QuizCoordinator

    var body: some View {
        HStack(alignment: .top, spacing: 96) {
            leftColumn
            rightColumn
        }
        .padding(.horizontal, 80)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // ── Left ──────────────────────────────────────────────
    private var leftColumn: some View {
        VStack(alignment: .leading, spacing: 24) {
            if coordinator.roundNumber > 0 {
                roundBadge
            }
            Text("Music Quiz")
                .font(Theme.display(80, weight: .black))
                .foregroundStyle(
                    LinearGradient(
                        colors: [Theme.red, Color(hex: 0xFF6B6B)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
            Text("Scan the QR code with your phone to join")
                .font(Theme.display(28, weight: .regular))
                .foregroundColor(Theme.muted)

            if !coordinator.players.isEmpty {
                playerChips
                    .padding(.top, 24)
            } else {
                Text("Waiting for players…")
                    .font(Theme.display(24, weight: .medium))
                    .foregroundColor(Theme.dimmer)
                    .padding(.top, 32)
            }
            Spacer()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var roundBadge: some View {
        Text("ROUND \(coordinator.roundNumber)")
            .font(Theme.display(20, weight: .heavy))
            .tracking(1)
            .foregroundColor(Theme.red)
            .padding(.horizontal, 18)
            .padding(.vertical, 8)
            .background(
                Capsule().fill(Theme.red.opacity(0.15))
            )
    }

    private var playerChips: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("\(coordinator.players.count) PLAYER\(coordinator.players.count == 1 ? "" : "S")")
                .font(Theme.display(16, weight: .bold))
                .tracking(1.4)
                .foregroundColor(Theme.muted)
            FlowLayout(spacing: 10) {
                ForEach(0..<coordinator.players.count, id: \.self) { idx in
                    let p = coordinator.players[idx]
                    let name = (p["name"] as? String) ?? "—"
                    let avatar = (p["avatar"] as? String) ?? ""
                    chip(name: name, avatar: avatar)
                }
            }
        }
    }

    private func chip(name: String, avatar: String) -> some View {
        ChipView(name: name, avatar: avatar)
    }

    /// Pop-in chip animation matching `host.css` `chipIn` keyframes.
    private struct ChipView: View {
        let name: String
        let avatar: String
        @State private var appeared = false

        var body: some View {
            HStack(spacing: 10) {
                if !avatar.isEmpty {
                    Text(avatar).font(.system(size: 24))
                }
                Text(name)
                    .font(Theme.display(20, weight: .semibold))
                    .foregroundColor(Theme.text)
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 10)
            .background(Capsule().fill(Theme.card))
            .overlay(Capsule().stroke(Theme.border, lineWidth: 1))
            .scaleEffect(appeared ? 1.0 : 0.4)
            .opacity(appeared ? 1.0 : 0)
            .onAppear {
                withAnimation(.spring(response: 0.45, dampingFraction: 0.65)) {
                    appeared = true
                }
            }
        }
    }

    // ── Right ─────────────────────────────────────────────
    private var rightColumn: some View {
        VStack(spacing: 24) {
            qrCard
            joinCodeBlock
        }
        .frame(maxWidth: .infinity)
    }

    private var qrCard: some View {
        Group {
            if let url = coordinator.joinUrl {
                QRCodeImage(text: url, size: 360)
            } else {
                RoundedRectangle(cornerRadius: 16)
                    .fill(Color.white.opacity(0.06))
                    .frame(width: 360, height: 360)
                    .overlay(
                        Text("Waiting for session…")
                            .font(Theme.display(20, weight: .medium))
                            .foregroundColor(Theme.muted)
                    )
            }
        }
        .padding(20)
        .background(
            RoundedRectangle(cornerRadius: 24)
                .fill(Color.white)
                .shadow(color: Theme.redGlow, radius: 60)
        )
    }

    private var joinCodeBlock: some View {
        VStack(spacing: 8) {
            if let code = coordinator.joinCode {
                Text(code)
                    .font(.system(size: 64, weight: .black, design: .rounded))
                    .tracking(12)
                    .foregroundColor(Theme.red)
            } else {
                Text("· · · · · ·")
                    .font(.system(size: 64, weight: .black, design: .rounded))
                    .tracking(12)
                    .foregroundColor(Theme.dimmer)
            }
            if let url = coordinator.joinUrl {
                Text(url.replacingOccurrences(of: "https://", with: "").replacingOccurrences(of: "http://", with: ""))
                    .font(Theme.display(18, weight: .regular))
                    .foregroundColor(Theme.muted)
            }
        }
    }
}

// ── Simple wrap layout for player chips ──────────────────
/// Lightweight `Layout` impl since SwiftUI lacks a built-in flow layout.
/// tvOS 17 supports the Layout protocol natively.
struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        var totalWidth: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x + size.width > maxWidth {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            x += size.width + spacing
            totalWidth = max(totalWidth, x)
            rowHeight = max(rowHeight, size.height)
        }
        return CGSize(width: totalWidth, height: y + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let maxWidth = bounds.width
        var x: CGFloat = bounds.minX
        var y: CGFloat = bounds.minY
        var rowHeight: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x + size.width > bounds.minX + maxWidth {
                x = bounds.minX
                y += rowHeight + spacing
                rowHeight = 0
            }
            subview.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}
