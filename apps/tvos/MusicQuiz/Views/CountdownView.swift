import SwiftUI

/// "GET READY 3 / 2 / 1" countdown screen mirroring `host.css`
/// `.countdown-number` (200px font, count-pop animation).
struct CountdownView: View {
    @ObservedObject var coordinator: QuizCoordinator
    @State private var pop = false

    var body: some View {
        VStack(spacing: 24) {
            Text("GET READY")
                .font(Theme.display(28, weight: .heavy))
                .tracking(2)
                .foregroundColor(Theme.red)
            Text(label)
                .font(.system(size: 240, weight: .black, design: .rounded))
                .foregroundColor(Theme.text)
                .scaleEffect(pop ? 1.0 : 0.6)
                .opacity(pop ? 1 : 0.2)
                .animation(.spring(response: 0.5, dampingFraction: 0.55), value: pop)
                .id(label)
                .onAppear { pop = true }
                .onChange(of: label) { _, _ in
                    pop = false
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { pop = true }
                }
            if coordinator.totalQuestions > 0 {
                Text("Question \(max(coordinator.questionNumber, 1)) of \(coordinator.totalQuestions)")
                    .font(Theme.display(28, weight: .regular))
                    .foregroundColor(Theme.muted)
            }
        }
    }

    private var label: String {
        // The server emits a `game_state` for countdown — we don't currently
        // get the actual second number, so just show the question marker.
        if coordinator.questionNumber > 0 {
            return "\(coordinator.questionNumber)"
        }
        return "·"
    }
}
