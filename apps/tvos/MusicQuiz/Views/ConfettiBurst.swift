import SwiftUI

/// Drops a brief shower of colored confetti pieces from the top of the screen.
/// Mirrors `host.css` `.confetti-piece` / `confettiFall` for podium reveal.
struct ConfettiBurst: View {
    private let pieceCount = 60

    fileprivate struct Piece: Identifiable {
        let id = UUID()
        let x: CGFloat        // 0..1 horizontal start
        let color: Color
        let size: CGFloat
        let delay: Double
        let duration: Double
        let rotation: Double
        let drift: CGFloat    // horizontal drift in points
    }

    private static let palette: [Color] = [
        Theme.red, Theme.yellow, Theme.orange,
        Theme.optionA, Theme.optionB, Theme.optionC, Theme.optionD,
        Theme.green, Theme.blue,
    ]

    @State private var pieces: [Piece] = []
    @State private var fired = false

    var body: some View {
        GeometryReader { geo in
            ZStack {
                ForEach(pieces) { piece in
                    ConfettiPieceView(
                        piece: piece,
                        screenSize: geo.size
                    )
                }
            }
            .onAppear {
                guard !fired else { return }
                fired = true
                pieces = (0..<pieceCount).map { _ in
                    Piece(
                        x: CGFloat.random(in: 0...1),
                        color: Self.palette.randomElement()!,
                        size: CGFloat.random(in: 8...16),
                        delay: Double.random(in: 0...1.5),
                        duration: Double.random(in: 2.4...3.6),
                        rotation: Double.random(in: 360...1080),
                        drift: CGFloat.random(in: -120...120)
                    )
                }
            }
        }
    }
}

private struct ConfettiPieceView: View {
    let piece: ConfettiBurst.Piece
    let screenSize: CGSize
    @State private var fall = false

    var body: some View {
        Rectangle()
            .fill(piece.color)
            .frame(width: piece.size, height: piece.size * 0.45)
            .rotationEffect(.degrees(fall ? piece.rotation : 0))
            .position(
                x: piece.x * screenSize.width + (fall ? piece.drift : 0),
                y: fall ? screenSize.height + 40 : -40
            )
            .opacity(fall ? 0 : 1)
            .onAppear {
                withAnimation(.easeIn(duration: piece.duration).delay(piece.delay)) {
                    fall = true
                }
            }
    }
}
