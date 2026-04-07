import SwiftUI

/// Steal Round window — see `docs/TVOS-WS-PROTOCOL.md §7.2`.
///
/// Triggered when a question ends with 0 correct answers and the host
/// enabled `stealRoundEnabled`. The server gives players exactly 5 seconds
/// to free-text-type the correct answer; first correct wins 2× points.
///
/// We render a pulsing red banner, a 5-second countdown ring, and the
/// original question text (no options). Server is the source of truth for
/// when steal ends — we just animate locally.
struct StealView: View {
    @ObservedObject var coordinator: QuizCoordinator

    @State private var timeLeft: Double = 5.0
    @State private var pulse = false
    private let totalTime: Double = 5.0
    private let timer = Timer.publish(every: 0.1, on: .main, in: .common).autoconnect()

    private var question: [String: Any] { coordinator.question ?? [:] }
    private var questionText: String { (question["questionText"] as? String) ?? "Listen…" }

    var body: some View {
        VStack(spacing: 48) {
            banner
            Spacer()
            VStack(spacing: 32) {
                Text(questionText)
                    .font(Theme.display(48, weight: .heavy))
                    .foregroundColor(Theme.text)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 120)
                Text("Type your answer on your phone — first correct wins!")
                    .font(Theme.display(28, weight: .medium))
                    .italic()
                    .foregroundColor(Theme.muted)
            }
            Spacer()
            countdownRing
                .padding(.bottom, 40)
        }
        .padding(.top, 60)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .onReceive(timer) { _ in
            if timeLeft > 0 { timeLeft -= 0.1 }
        }
        .onAppear {
            timeLeft = totalTime
            withAnimation(.easeInOut(duration: 0.6).repeatForever(autoreverses: true)) {
                pulse = true
            }
        }
    }

    // ── Pulsing banner ────────────────────────────────────
    private var banner: some View {
        HStack(spacing: 16) {
            Image(systemName: "bolt.fill")
                .font(.system(size: 36, weight: .black))
            Text("STEAL ROUND")
                .font(Theme.display(36, weight: .black))
                .tracking(3)
            Text("·")
                .font(Theme.display(36, weight: .black))
                .opacity(0.5)
            Text("5 SEC")
                .font(Theme.display(32, weight: .heavy))
            Text("·")
                .font(Theme.display(36, weight: .black))
                .opacity(0.5)
            Text("2× POINTS")
                .font(Theme.display(32, weight: .heavy))
        }
        .foregroundColor(.white)
        .padding(.horizontal, 40)
        .padding(.vertical, 20)
        .background(
            Capsule().fill(Theme.red)
        )
        .shadow(color: Theme.red.opacity(pulse ? 0.85 : 0.25), radius: pulse ? 60 : 20)
        .scaleEffect(pulse ? 1.05 : 1.0)
    }

    // ── Countdown ring ────────────────────────────────────
    private var countdownRing: some View {
        let progress = CGFloat(max(0, timeLeft / totalTime))
        return ZStack {
            Circle()
                .stroke(Theme.border, style: StrokeStyle(lineWidth: 14, lineCap: .round))
                .frame(width: 180, height: 180)
            Circle()
                .trim(from: 0, to: progress)
                .stroke(Theme.red, style: StrokeStyle(lineWidth: 14, lineCap: .round))
                .frame(width: 180, height: 180)
                .rotationEffect(.degrees(-90))
                .animation(.linear(duration: 0.1), value: progress)
            Text("\(Int(ceil(timeLeft)))")
                .font(.system(size: 72, weight: .black, design: .rounded))
                .foregroundColor(Theme.text)
                .monospacedDigit()
        }
    }
}
