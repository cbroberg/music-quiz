import SwiftUI

/// Phase 2-ny: minimal status panel so we can verify WS connect, MusicKit
/// authorization, and live game-state mirroring on a real Apple TV. Real
/// lobby/question/scoreboard rendering comes in Phase 3.
struct StatusView: View {
    @ObservedObject var coordinator: QuizCoordinator

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            VStack(alignment: .leading, spacing: 28) {
                header
                Divider().background(Color.white.opacity(0.2))
                row("Connection", value: connectionDescription, color: connectionColor)
                row("MusicKit",   value: coordinator.musicKitAuthorized ? "authorized" : "not authorized",
                     color: coordinator.musicKitAuthorized ? .green : .yellow)
                row("Display ID", value: coordinator.displayId ?? "—")
                Divider().background(Color.white.opacity(0.2))
                row("Game state", value: coordinator.gameState)
                row("Round",      value: "\(coordinator.roundNumber)")
                row("Question",   value: "\(coordinator.questionNumber) / \(coordinator.totalQuestions)")
                row("Players",    value: "\(coordinator.players.count)")
                if let err = coordinator.lastError {
                    Text("Last error: \(err)")
                        .font(.system(size: 24))
                        .foregroundColor(.red.opacity(0.8))
                }
                Spacer()
            }
            .padding(80)
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Music Quiz")
                .font(.system(size: 96, weight: .bold))
                .foregroundColor(.white)
            Text("tvOS display client · Phase 2-ny")
                .font(.system(size: 28))
                .foregroundColor(.white.opacity(0.6))
        }
    }

    private func row(_ label: String, value: String, color: Color = .white) -> some View {
        HStack(spacing: 24) {
            Text(label)
                .font(.system(size: 28, weight: .semibold))
                .foregroundColor(.white.opacity(0.6))
                .frame(width: 220, alignment: .leading)
            Text(value)
                .font(.system(size: 32, design: .monospaced))
                .foregroundColor(color)
        }
    }

    private var connectionDescription: String {
        switch coordinator.connectionState {
        case .disconnected:    return "disconnected"
        case .connecting:      return "connecting…"
        case .connected:       return "connected"
        case .failed(let msg): return "failed (\(msg))"
        }
    }

    private var connectionColor: Color {
        switch coordinator.connectionState {
        case .connected:    return .green
        case .connecting:   return .yellow
        case .disconnected: return .gray
        case .failed:       return .red
        }
    }
}
