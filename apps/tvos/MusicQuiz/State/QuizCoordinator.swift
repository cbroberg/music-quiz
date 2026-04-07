import Foundation
import SwiftUI
import os

let log = Logger(subsystem: "dk.webhouse.music-quiz.tvos", category: "coordinator")

/// The single owning object behind the SwiftUI view tree. Holds the
/// WebSocket, the MusicKit player, and the latest game state. Acts as the
/// `QuizSocketDelegate` so it can route `playback_command` messages to the
/// player and post `playback_response` back through the socket.
@MainActor
final class QuizCoordinator: ObservableObject, QuizSocketDelegate {

    // MARK: Published UI state

    @Published var connectionState: QuizSocket.ConnectionState = .disconnected
    @Published var displayId: String?
    @Published var gameState: String = "idle"     // lobby/countdown/playing/reveal/scoreboard/finished
    @Published var roundNumber: Int = 0
    @Published var questionNumber: Int = 0
    @Published var totalQuestions: Int = 0
    @Published var question: [String: Any]?
    @Published var rankings: [[String: Any]] = []
    @Published var players: [[String: Any]] = []
    @Published var lastError: String?
    @Published var musicKitAuthorized: Bool = false

    /// Round modifiers — see `docs/TVOS-WS-PROTOCOL.md §7`
    @Published var blindMode: Bool = false
    @Published var stealActive: Bool = false

    /// Latest question_results.results[] payload — used by RevealView to
    /// detect a steal winner (look for aiExplanation containing "STEAL").
    @Published var lastQuestionResults: [[String: Any]] = []
    @Published var joinCode: String?
    @Published var joinUrl: String?
    @Published var sessionId: String?

    /// Latest known now-playing track for the vinyl sphere display. Updated
    /// from MusicKit responses to `play_exact` / `play_by_id` /
    /// `search_and_play` commands. nil → nothing playing.
    @Published var nowPlayingTrack: NowPlayingTrack?

    // ── DJ Mode state (mirrors `dj_state` broadcasts) ─────
    @Published var djActive: Bool = false
    @Published var djAutoplay: Bool = false
    @Published var djQueue: [[String: Any]] = []
    @Published var djCurrent: [String: Any]? = nil
    @Published var djPicks: [[String: Any]] = []

    // MARK: Internals

    private let socket: QuizSocket
    private let player = MusicKitPlayer()
    private var demo: DemoMode?

    init(serverURL: URL) {
        self.socket = QuizSocket(url: serverURL, sessionId: nil, claimPlayback: true)
        self.socket.delegate = self
    }

    func start() {
        if DemoMode.isEnabled {
            log.info("coordinator.start() — DEMO MODE active, skipping WS")
            let d = DemoMode(coordinator: self)
            self.demo = d
            d.start()
            return
        }
        log.info("coordinator.start() — connecting socket immediately, auth in parallel")
        // Connect first — display can render lobby/scoreboard without playback.
        socket.connect()
        // MusicKit auth runs in parallel; if it never resolves on Simulator
        // (no Apple Music account), the WS still works.
        Task {
            log.info("requesting MusicKit authorization…")
            self.musicKitAuthorized = await player.authorize()
            log.info("MusicKit authorized = \(self.musicKitAuthorized, privacy: .public)")
        }
    }

    // MARK: QuizSocketDelegate

    func quizSocket(_ socket: QuizSocket, didChangeState state: QuizSocket.ConnectionState) {
        self.connectionState = state
    }

    func quizSocket(_ socket: QuizSocket, didReceive message: [String: Any]) {
        guard let type = message["type"] as? String else { return }
        log.info("← \(type, privacy: .public)")

        switch type {
        case "display_registered":
            displayId = message["id"] as? String
            print("✅ display registered: \(displayId ?? "?")")

        case "session_created":
            sessionId = message["sessionId"] as? String
            joinCode  = message["joinCode"]  as? String
            joinUrl   = message["joinUrl"]   as? String
            if let r = message["roundNumber"] as? Int { roundNumber = r }
            // Reset transient state for the new round
            players = []
            rankings = []
            question = nil
            gameState = "lobby"

        case "game_state":
            gameState        = (message["state"] as? String) ?? gameState
            questionNumber   = (message["questionNumber"] as? Int) ?? questionNumber
            totalQuestions   = (message["totalQuestions"] as? Int) ?? totalQuestions
            roundNumber      = (message["roundNumber"] as? Int) ?? roundNumber
            question         = (message["question"] as? [String: Any]) ?? question
            if let code = message["joinCode"] as? String { joinCode = code }
            if let url  = message["joinUrl"]  as? String { joinUrl  = url }
            // Round modifiers (default to false if absent for backward compat)
            blindMode    = (message["blindMode"]    as? Bool) ?? false
            stealActive  = (message["stealActive"]  as? Bool) ?? (gameState == "steal")

        case "player_joined":
            // Server shape: { player: { id, name, avatar } }
            if let player = message["player"] as? [String: Any],
               let id = player["id"] as? String,
               let name = player["name"] as? String {
                // Avoid duplicates if reconnect/lobby snapshot lands twice
                if !players.contains(where: { ($0["id"] as? String) == id }) {
                    players.append([
                        "id": id,
                        "name": name,
                        "avatar": player["avatar"] as? String ?? ""
                    ])
                }
            }

        case "player_left":
            // Server shape: { playerId, playerName }
            if let id = message["playerId"] as? String {
                players.removeAll { ($0["id"] as? String) == id }
            }

        case "scoreboard":
            rankings = (message["rankings"] as? [[String: Any]]) ?? rankings

        case "final_results":
            rankings = (message["rankings"] as? [[String: Any]]) ?? rankings
            // Engine emits final_results instead of a game_state="finished"
            // transition — flip the state ourselves so FinalView mounts.
            gameState = "finished"
            if let r = message["roundNumber"] as? Int { roundNumber = r }

        case "question_results":
            // The reveal screen reads from `question` (which now carries
            // correctAnswer/funFact) and `rankings` updated in next scoreboard.
            question            = message["question"] as? [String: Any] ?? question
            lastQuestionResults = (message["results"] as? [[String: Any]]) ?? []

        case "dj_state":
            djActive   = true
            djQueue    = (message["queue"]   as? [[String: Any]]) ?? []
            djCurrent  = message["current"] as? [String: Any]
            djPicks    = (message["picks"]   as? [[String: Any]]) ?? []
            djAutoplay = (message["autoplay"] as? Bool) ?? false
            // dj_state arrives between rounds — flip the screen so DJModeView mounts
            if gameState != "lobby" && gameState != "playing" && gameState != "countdown" {
                gameState = "dj"
            }

        case "dj_activated":
            djActive   = true
            djQueue    = (message["queue"]   as? [[String: Any]]) ?? djQueue
            djCurrent  = (message["current"] as? [String: Any]) ?? djCurrent
            djPicks    = (message["picks"]   as? [[String: Any]]) ?? djPicks
            djAutoplay = (message["autoplay"] as? Bool) ?? djAutoplay
            gameState = "dj"

        case "dj_deactivated":
            djActive = false
            if gameState == "dj" { gameState = "idle" }

        case "answer_received", "evaluating_answers", "preparing", "researching":
            // Phase 2-ny: noted but not rendered yet
            break

        case "error":
            lastError = message["message"] as? String
            print("❌ ws error: \(lastError ?? "?")")

        case "playback_command":
            let cmd = message["command"] as? String ?? "?"
            log.info("  └ playback_command: \(cmd, privacy: .public)")
            handlePlaybackCommand(message)

        default:
            print("ℹ️ unhandled ws type: \(type)")
        }
    }

    // MARK: Playback command routing

    private func handlePlaybackCommand(_ msg: [String: Any]) {
        guard
            let commandId = msg["commandId"] as? String,
            let command   = msg["command"] as? String
        else { return }

        let params = (msg["params"] as? [String: Any]) ?? [:]

        Task {
            let result: [String: Any]
            switch command {
            case "play_exact":
                let name      = params["name"] as? String ?? ""
                let artist    = params["artist"] as? String ?? ""
                let randomSeek = params["randomSeek"] as? Bool ?? false
                result = await player.playExact(name: name, artist: artist, randomSeek: randomSeek)

            case "play_by_id":
                let songId = params["songId"] as? String ?? ""
                let pct    = params["seekToPercent"] as? Double
                result = await player.playById(songId: songId, seekToPercent: pct)

            case "pause":
                result = await player.pause()

            case "resume":
                result = await player.resume()

            case "set_volume":
                let level = (params["level"] as? Double) ?? 0
                result = await player.setVolume(level)

            case "now_playing":
                result = await player.nowPlaying()

            case "check_library":
                let name   = params["name"] as? String ?? ""
                let artist = params["artist"] as? String ?? ""
                result = await player.checkLibrary(name: name, artist: artist)

            case "search_and_play":
                let query = params["query"] as? String ?? ""
                result = await player.searchAndPlay(query: query)

            default:
                result = ["error": "unknown command: \(command)"]
            }

            // Side-effect: update nowPlayingTrack from any successful play.
            self.updateNowPlaying(from: command, result: result)

            socket.send(Outbound.PlaybackResponse(
                commandId: commandId,
                result: AnyEncodable(result)
            ))
        }
    }

    private func updateNowPlaying(from command: String, result: [String: Any]) {
        switch command {
        case "play_exact", "play_by_id", "search_and_play":
            if let playing = result["playing"] as? Bool, playing,
               let track = result["track"] as? [String: Any] {
                nowPlayingTrack = NowPlayingTrack(
                    name:   (track["name"]   as? String) ?? "",
                    artist: (track["artist"] as? String) ?? "",
                    album:  (track["album"]  as? String) ?? "",
                    durationMs: (track["durationMs"] as? Int) ?? 0,
                    artworkUrl: track["artworkUrl"] as? String
                )
            }
        case "now_playing":
            if let state = result["state"] as? String, state == "stopped" {
                // Don't clear; the track stays visible after a song ends so
                // the display can keep the visual instead of going dark.
            }
        case "pause", "resume":
            break
        default:
            break
        }
    }
}

struct NowPlayingTrack: Equatable {
    let name: String
    let artist: String
    let album: String
    let durationMs: Int
    let artworkUrl: String?
}
