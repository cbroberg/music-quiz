import Foundation
import MusicKit

/// Native MusicKit playback for tvOS. Implements the 8 commands defined in
/// `docs/TVOS-WS-PROTOCOL.md` §4. Each method returns a JSON-serialisable
/// `[String: Any]` that the caller wraps into a `playback_response`.
///
/// On tvOS we use `ApplicationMusicPlayer.shared` (audio routes through the
/// app's MusicKit session, plays through Apple TV's audio output).
actor MusicKitPlayer {

    /// Cached for `now_playing` even when MusicKit's queue clears.
    private var lastTrackInfo: [String: Any]?

    private var player: ApplicationMusicPlayer { .shared }

    // MARK: - Authorization

    /// Request MusicKit access. Call once at app launch BEFORE registering
    /// the WS display with `claimPlayback: true`.
    func authorize() async -> Bool {
        let status = await MusicAuthorization.request()
        return status == .authorized
    }

    var isAuthorized: Bool {
        MusicAuthorization.currentStatus == .authorized
    }

    // MARK: - Commands (8 total per protocol §4)

    /// `play_exact { name, artist, randomSeek? }`
    func playExact(name: String, artist: String, randomSeek: Bool) async -> [String: Any] {
        do {
            let song = try await searchSong(term: "\(name) \(artist)", preferName: name, preferArtist: artist)
            guard let song else { return ["playing": false, "error": "song not found"] }
            try await play(song: song)
            if randomSeek, let durationMs = song.duration.flatMap({ Int($0 * 1000) }), durationMs > 30_000 {
                let target = Double.random(in: 0..<(Double(durationMs - 30_000) / 1000.0))
                player.playbackTime = target
            }
            return ["playing": true, "track": trackInfo(from: song)]
        } catch {
            return ["playing": false, "error": "\(error)"]
        }
    }

    /// `play_by_id { songId, seekToPercent? }`
    func playById(songId: String, seekToPercent: Double?) async -> [String: Any] {
        do {
            let request = MusicCatalogResourceRequest<Song>(matching: \.id, equalTo: MusicItemID(songId))
            let response = try await request.response()
            guard let song = response.items.first else {
                return ["playing": false, "error": "song id not found"]
            }
            try await play(song: song)
            if let pct = seekToPercent, let dur = song.duration {
                player.playbackTime = dur * pct
            }
            return ["playing": true, "track": trackInfo(from: song)]
        } catch {
            return ["playing": false, "error": "\(error)"]
        }
    }

    /// `pause {}`
    func pause() async -> [String: Any] {
        player.pause()
        return [:]
    }

    /// `resume {}`
    func resume() async -> [String: Any] {
        do {
            try await player.play()
        } catch {
            print("⚠️ resume failed: \(error)")
        }
        return [:]
    }

    /// `set_volume { level: 0..1 }`
    /// `ApplicationMusicPlayer` does not expose a volume property on tvOS —
    /// volume is owned by the system. We accept the call and reply OK so the
    /// server's command pipeline doesn't time out.
    func setVolume(_ level: Double) async -> [String: Any] {
        // Intentional no-op on tvOS. See protocol doc §4 — volume is system-owned.
        return [:]
    }

    /// `now_playing {}`
    func nowPlaying() async -> [String: Any] {
        let stateString: String
        switch player.state.playbackStatus {
        case .playing: stateString = "playing"
        case .paused:  stateString = "paused"
        default:       stateString = "stopped"
        }

        var result: [String: Any] = ["state": stateString]
        if var info = lastTrackInfo {
            info["positionMs"] = Int(player.playbackTime * 1000)
            result["track"] = info
        }
        return result
    }

    /// `check_library { name, artist }`
    /// MusicKit on tvOS doesn't expose a personal-library lookup the same
    /// way Music JS does. We approximate by hitting the catalog and reporting
    /// whether a match exists — true enough for the quiz pre-flight check.
    func checkLibrary(name: String, artist: String) async -> [String: Any] {
        do {
            let song = try await searchSong(term: "\(name) \(artist)", preferName: name, preferArtist: artist)
            return ["found": song != nil]
        } catch {
            return ["found": false]
        }
    }

    /// `search_and_play { query }`
    func searchAndPlay(query: String) async -> [String: Any] {
        do {
            var request = MusicCatalogSearchRequest(term: query, types: [Song.self])
            request.limit = 5
            let response = try await request.response()
            guard let song = response.songs.first else {
                return ["playing": false, "error": "no result"]
            }
            try await play(song: song)
            return ["playing": true, "track": trackInfo(from: song)]
        } catch {
            return ["playing": false, "error": "\(error)"]
        }
    }

    // MARK: - Helpers

    private func play(song: Song) async throws {
        player.queue = [song]
        try await player.play()
        lastTrackInfo = trackInfo(from: song)
    }

    private func searchSong(term: String, preferName: String, preferArtist: String) async throws -> Song? {
        var request = MusicCatalogSearchRequest(term: term, types: [Song.self])
        request.limit = 10
        let response = try await request.response()

        let songs = response.songs
        if songs.isEmpty { return nil }

        let lowerName = preferName.lowercased()
        let lowerArtist = preferArtist.lowercased()

        if let exact = songs.first(where: {
            $0.title.lowercased().contains(lowerName) &&
            $0.artistName.lowercased().contains(lowerArtist)
        }) {
            return exact
        }
        return songs.first
    }

    private func trackInfo(from song: Song) -> [String: Any] {
        var info: [String: Any] = [
            "name": song.title,
            "artist": song.artistName,
            "album": song.albumTitle ?? "",
        ]
        if let duration = song.duration {
            info["durationMs"] = Int(duration * 1000)
        }
        if let artwork = song.artwork,
           let url = artwork.url(width: 800, height: 800) {
            info["artworkUrl"] = url.absoluteString
        }
        return info
    }
}
