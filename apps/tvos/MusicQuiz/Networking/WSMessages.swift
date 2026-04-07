import Foundation

/// Outbound WS messages we send to `quiz-ws` are typed via Codable so the
/// JSON shape is verified at compile time. Inbound messages are intentionally
/// parsed via JSONSerialization in `QuizSocket` because the server is the
/// source of truth and the schema is a moving target — we look up the
/// fields we need at the call site.
///
/// The wire contract is owned by `docs/TVOS-WS-PROTOCOL.md`.
enum Outbound {
    /// First message after the socket opens.
    struct RegisterDisplay: Encodable {
        let type = "register_display"
        let sessionId: String?
        let partyId: String?
        let claimPlayback: Bool
    }

    /// Reply to a `playback_command` from the server. The `result` is a
    /// loosely-typed dictionary because each command has a different shape;
    /// `MusicKitPlayer` builds it.
    struct PlaybackResponse: Encodable {
        let type = "playback_response"
        let commandId: String
        let result: AnyEncodable
    }
}

/// Type-erased Encodable wrapper so we can stuff arbitrary `[String: Any]`
/// payloads into a Codable response. Only the small set of JSON-native
/// values used by the playback protocol is supported.
struct AnyEncodable: Encodable {
    private let value: Any

    init(_ value: Any) {
        self.value = value
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch value {
        case let v as String:
            try container.encode(v)
        case let v as Int:
            try container.encode(v)
        case let v as Int64:
            try container.encode(v)
        case let v as Double:
            try container.encode(v)
        case let v as Bool:
            try container.encode(v)
        case let v as [Any]:
            try container.encode(v.map(AnyEncodable.init))
        case let v as [String: Any]:
            try container.encode(v.mapValues(AnyEncodable.init))
        case is NSNull:
            try container.encodeNil()
        default:
            try container.encodeNil()
        }
    }
}
