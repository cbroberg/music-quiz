import SwiftUI

/// Routes to the right screen based on the current `gameState` broadcast
/// from the server. The display is read-only — every transition is driven
/// by inbound `game_state` messages.
struct ContentView: View {
    @EnvironmentObject var coordinator: QuizCoordinator
    @State private var showDebug = false

    var body: some View {
        ZStack {
            AppBackground()

            switch coordinator.gameState {
            case "lobby":
                LobbyView(coordinator: coordinator)
            case "countdown":
                CountdownView(coordinator: coordinator)
            case "playing":
                QuestionView(coordinator: coordinator)
            case "steal":
                StealView(coordinator: coordinator)
            case "evaluating":
                EvaluatingView()
            case "reveal":
                RevealView(coordinator: coordinator)
            case "scoreboard":
                ScoreboardView(coordinator: coordinator)
            case "finished":
                FinalView(coordinator: coordinator)
            case "dj":
                DJModeView(coordinator: coordinator)
            case "idle":
                if let track = coordinator.nowPlayingTrack {
                    NowPlayingView(
                        trackName:  track.name,
                        artistName: track.artist,
                        albumName:  track.album,
                        artworkURL: track.artworkUrl.flatMap { URL(string: $0) },
                        isPlaying:  true
                    )
                } else {
                    IdleView(coordinator: coordinator)
                }
            default:
                IdleView(coordinator: coordinator)
            }

            if showDebug {
                StatusView(coordinator: coordinator)
                    .background(Color.black.opacity(0.85))
                    .transition(.opacity)
            }
        }
        .onPlayPauseCommand {
            withAnimation { showDebug.toggle() }
        }
    }
}

/// Pre-session "waiting for first quiz to be created" screen.
struct IdleView: View {
    @ObservedObject var coordinator: QuizCoordinator

    var body: some View {
        VStack(spacing: 32) {
            Text("Music Quiz")
                .font(Theme.display(96, weight: .black))
                .foregroundStyle(
                    LinearGradient(
                        colors: [Theme.red, Color(hex: 0xFF6B6B)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
            Text(statusText)
                .font(Theme.display(28, weight: .medium))
                .foregroundColor(Theme.muted)
            Text("Press ⏯ on the Siri Remote to toggle diagnostics")
                .font(Theme.display(18, weight: .regular))
                .foregroundColor(Theme.dimmer)
                .padding(.top, 32)
        }
    }

    private var statusText: String {
        switch coordinator.connectionState {
        case .disconnected:    return "Disconnected"
        case .connecting:      return "Connecting to server…"
        case .connected:       return "Waiting for the host to start a round"
        case .failed(let msg): return "Connection failed — \(msg)"
        }
    }
}

/// Brief "evaluating answers" screen — keeps the visual rhythm between
/// `playing` and `reveal`.
struct EvaluatingView: View {
    @State private var pulse = false

    var body: some View {
        VStack(spacing: 32) {
            Image(systemName: "sparkles")
                .font(.system(size: 120, weight: .light))
                .foregroundColor(Theme.red)
                .scaleEffect(pulse ? 1.15 : 1.0)
                .animation(.easeInOut(duration: 1.2).repeatForever(autoreverses: true), value: pulse)
            Text("Evaluating answers…")
                .font(Theme.display(36, weight: .medium))
                .foregroundColor(Theme.muted)
        }
        .onAppear { pulse = true }
    }
}
