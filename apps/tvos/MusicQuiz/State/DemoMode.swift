import Foundation

/// Local demo driver for validating Phase 3 views without depending on the
/// server-side broadcast pipeline. Activated by setting the env var
/// `MUSIC_QUIZ_DEMO=1` (configured via `SIMCTL_CHILD_MUSIC_QUIZ_DEMO=1`).
///
/// Cycles the coordinator through every screen so we can screenshot each
/// view in isolation. Has no production effect when the env var is unset.
@MainActor
final class DemoMode {
    static var isEnabled: Bool {
        ProcessInfo.processInfo.environment["MUSIC_QUIZ_DEMO"] == "1"
    }

    private weak var coordinator: QuizCoordinator?
    private var task: Task<Void, Never>?

    init(coordinator: QuizCoordinator) {
        self.coordinator = coordinator
    }

    func start() {
        guard Self.isEnabled, task == nil else { return }
        task = Task { [weak self] in await self?.run() }
    }

    private func run() async {
        guard let coord = coordinator else { return }

        // ── lobby ─────────────────────────────────────────
        coord.gameState = "lobby"
        coord.roundNumber = 1
        coord.joinCode = "MUSIC1"
        coord.joinUrl = "http://192.168.39.140:3000/quiz/play?code=MUSIC1"
        coord.players = [
            ["id": "1", "name": "Mikkel",  "avatar": "🎸"],
            ["id": "2", "name": "Sofie",   "avatar": "🎤"],
            ["id": "3", "name": "Andreas", "avatar": "🎹"],
            ["id": "4", "name": "Liva",    "avatar": "🥁"],
            ["id": "5", "name": "Emil",    "avatar": "🎧"],
        ]
        try? await Task.sleep(nanoseconds: 5_000_000_000)

        // ── countdown ─────────────────────────────────────
        coord.gameState = "countdown"
        coord.questionNumber = 1
        coord.totalQuestions = 3
        try? await Task.sleep(nanoseconds: 4_000_000_000)

        // ── playing (music question, with BLIND mode badge) ──
        coord.blindMode = true
        coord.gameState = "playing"
        coord.question = [
            "questionType": "song-title",
            "questionText": "Listen to the intro — name the song!",
            "options": [
                "Bohemian Rhapsody",
                "Stairway to Heaven",
                "Hotel California",
                "Sweet Child o' Mine",
            ],
            "artworkUrl": "https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/35/cf/5e/35cf5e5d-a86b-3f4e-1f9b-c5a4b0c4a0f9/00731453943322.rgb.jpg/800x800bb.jpg",
            "isTrivia": false,
        ]
        try? await Task.sleep(nanoseconds: 6_000_000_000)

        // ── steal round (5s, 0 correct → steal opens) ─────
        coord.blindMode = false
        coord.stealActive = true
        coord.gameState = "steal"
        try? await Task.sleep(nanoseconds: 6_000_000_000)
        coord.stealActive = false

        // ── reveal ────────────────────────────────────────
        coord.gameState = "reveal"
        coord.question = [
            "questionType": "song-title",
            "songName": "Bohemian Rhapsody",
            "artistName": "Queen",
            "albumName": "A Night at the Opera",
            "correctAnswer": "Bohemian Rhapsody",
            "funFact": "Recorded in 1975, the song took three weeks to record across five different studios.",
            "artworkUrl": "https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/35/cf/5e/35cf5e5d-a86b-3f4e-1f9b-c5a4b0c4a0f9/00731453943322.rgb.jpg/600x600bb.jpg",
        ]
        try? await Task.sleep(nanoseconds: 5_000_000_000)

        // ── scoreboard ────────────────────────────────────
        coord.gameState = "scoreboard"
        coord.rankings = [
            ["playerName": "Sofie",   "avatar": "🎤", "score": 2400, "streak": 3],
            ["playerName": "Mikkel",  "avatar": "🎸", "score": 1850, "streak": 2],
            ["playerName": "Liva",    "avatar": "🥁", "score": 1600, "streak": 0],
            ["playerName": "Andreas", "avatar": "🎹", "score":  900, "streak": 0],
            ["playerName": "Emil",    "avatar": "🎧", "score":  600, "streak": 0],
        ]
        try? await Task.sleep(nanoseconds: 6_000_000_000)

        // ── final podium ──────────────────────────────────
        coord.gameState = "finished"
        try? await Task.sleep(nanoseconds: 8_000_000_000)

        // ── DJ Mode ───────────────────────────────────────
        coord.gameState = "dj"
        coord.djActive = true
        coord.djAutoplay = true
        coord.djCurrent = [
            "name": "Bohemian Rhapsody",
            "artistName": "Queen",
            "addedBy": "Sofie",
            "addedByAvatar": "🎤",
        ]
        coord.djQueue = [
            ["name": "Hotel California", "artistName": "Eagles",
             "addedBy": "Mikkel",  "addedByAvatar": "🎸", "played": false],
            ["name": "Stairway to Heaven", "artistName": "Led Zeppelin",
             "addedBy": "Liva",    "addedByAvatar": "🥁", "played": false],
            ["name": "Sweet Child o' Mine", "artistName": "Guns N' Roses",
             "addedBy": "Andreas", "addedByAvatar": "🎹", "played": false],
            ["name": "Smells Like Teen Spirit", "artistName": "Nirvana",
             "addedBy": "Emil",    "addedByAvatar": "🎧", "played": false],
        ]
        coord.djPicks = [
            ["name": "Mikkel",  "avatar": "🎸", "availableCredits": 2, "queuedSongs": 1],
            ["name": "Sofie",   "avatar": "🎤", "availableCredits": 0, "queuedSongs": 1],
            ["name": "Liva",    "avatar": "🥁", "availableCredits": 1, "queuedSongs": 1],
            ["name": "Andreas", "avatar": "🎹", "availableCredits": 0, "queuedSongs": 1],
            ["name": "Emil",    "avatar": "🎧", "availableCredits": 0, "queuedSongs": 1],
        ]
        try? await Task.sleep(nanoseconds: 8_000_000_000)
        coord.djActive = false
        coord.djCurrent = nil
        coord.djQueue = []
        coord.djPicks = []

        // ── now-playing vinyl sphere (between rounds vibe) ──
        coord.gameState = "idle"
        coord.nowPlayingTrack = NowPlayingTrack(
            name: "Bohemian Rhapsody",
            artist: "Queen",
            album: "A Night at the Opera",
            durationMs: 354_000,
            // Apple Music CDN URL for "A Night at the Opera" — used for the
            // demo so the vinyl sphere shows real artwork on the simulator
            // even without a MusicKit subscription.
            artworkUrl: "https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/35/cf/5e/35cf5e5d-a86b-3f4e-1f9b-c5a4b0c4a0f9/00731453943322.rgb.jpg/800x800bb.jpg"
        )
        try? await Task.sleep(nanoseconds: 8_000_000_000)

        // Loop back
        coord.nowPlayingTrack = nil
        try? await Task.sleep(nanoseconds: 2_000_000_000)
        await run()
    }
}
