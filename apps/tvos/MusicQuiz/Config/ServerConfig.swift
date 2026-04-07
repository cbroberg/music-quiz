import Foundation

/// Centralised server endpoints. Switch via the `DEBUG` build configuration.
///
/// In `DEBUG` builds the app talks to a LAN dev server. Override the IP via the
/// `MUSIC_QUIZ_DEV_HOST` environment variable when launching from Xcode so we
/// don't have to recompile when the Mac's LAN address changes.
enum ServerConfig {
    /// User-overridable server URL via UserDefaults key `MusicQuizServerURL`.
    /// On the real Apple TV (TestFlight Release build) we can't set env vars,
    /// so we read from UserDefaults first. Set via:
    ///   defaults write dk.webhouse.music-quiz.tvos MusicQuizServerURL "http://192.168.39.140:3000"
    /// — but on tvOS that's not exposed; this is mainly a hook for future
    /// in-app settings UI. The compile-time default is the production server.
    /// User-overridable server URL via UserDefaults key `MusicQuizServerURL`.
    /// Allows future in-app settings UI to point at LAN dev servers without
    /// rebuilding. Compile-time default is the production server in Release.
    static let baseURL: String = {
        if let override = UserDefaults.standard.string(forKey: "MusicQuizServerURL"), !override.isEmpty {
            return override
        }
        #if DEBUG
        if let host = ProcessInfo.processInfo.environment["MUSIC_QUIZ_DEV_HOST"], !host.isEmpty {
            return host.hasPrefix("http") ? host : "http://\(host):3000"
        }
        return "http://192.168.39.140:3000"
        #else
        return "https://music.broberg.dk"
        #endif
    }()

    static var hostURL: URL {
        URL(string: "\(baseURL)/quiz/host")!
    }

    static var webSocketURL: URL {
        let wsBase = baseURL
            .replacingOccurrences(of: "https://", with: "wss://")
            .replacingOccurrences(of: "http://", with: "ws://")
        return URL(string: "\(wsBase)/quiz-ws")!
    }
}
