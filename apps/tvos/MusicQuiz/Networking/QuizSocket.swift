import Foundation
import os

private let wsLog = Logger(subsystem: "dk.webhouse.music-quiz.tvos", category: "ws")

/// Lightweight WebSocket client over `URLSessionWebSocketTask`. Handles
/// auto-reconnect with exponential backoff, sends `register_display` on
/// each (re)connect, and surfaces inbound messages as parsed dictionaries
/// to a delegate.
@MainActor
final class QuizSocket: NSObject {
    enum ConnectionState: Equatable {
        case disconnected
        case connecting
        case connected
        case failed(String)
    }

    private let url: URL
    private var sessionId: String?
    private let claimPlayback: Bool

    private var session: URLSession!
    private var task: URLSessionWebSocketTask?
    private var reconnectAttempt = 0
    private var explicitlyClosed = false

    weak var delegate: QuizSocketDelegate?

    private(set) var state: ConnectionState = .disconnected {
        didSet { delegate?.quizSocket(self, didChangeState: state) }
    }

    init(url: URL, sessionId: String? = nil, claimPlayback: Bool = true) {
        self.url = url
        self.sessionId = sessionId
        self.claimPlayback = claimPlayback
        super.init()
        let config = URLSessionConfiguration.default
        config.waitsForConnectivity = true
        config.timeoutIntervalForRequest = 30
        self.session = URLSession(configuration: config, delegate: self, delegateQueue: .main)
    }

    func connect() {
        guard state != .connecting && state != .connected else { return }
        wsLog.info("connect() → \(self.url.absoluteString, privacy: .public)")
        explicitlyClosed = false
        state = .connecting
        let task = session.webSocketTask(with: url)
        self.task = task
        task.resume()
        // URLSessionWebSocketTask doesn't have an explicit "open" callback for
        // didCompleteWithError-only delegates; rely on receive loop and the
        // delegate method `webSocketTask:didOpenWithProtocol:`.
        receiveLoop()
    }

    func disconnect() {
        explicitlyClosed = true
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        state = .disconnected
    }

    /// Send a typed Encodable message.
    func send<T: Encodable>(_ message: T) {
        guard let task else { return }
        do {
            let data = try JSONEncoder().encode(message)
            if let preview = String(data: data, encoding: .utf8) {
                wsLog.debug("→ \(preview, privacy: .public)")
            }
            task.send(.data(data)) { [weak self] error in
                if let error {
                    print("⚠️ WS send failed: \(error.localizedDescription)")
                    Task { @MainActor in self?.handleDisconnect(error: error) }
                }
            }
        } catch {
            print("⚠️ WS encode failed: \(error.localizedDescription)")
        }
    }

    // MARK: - Internals

    private func receiveLoop() {
        task?.receive { [weak self] result in
            Task { @MainActor in
                guard let self else { return }
                switch result {
                case .success(let message):
                    self.handleIncoming(message)
                    self.receiveLoop()
                case .failure(let error):
                    self.handleDisconnect(error: error)
                }
            }
        }
    }

    private func handleIncoming(_ message: URLSessionWebSocketTask.Message) {
        let data: Data
        switch message {
        case .data(let d): data = d
        case .string(let s): data = Data(s.utf8)
        @unknown default: return
        }

        guard
            let raw = try? JSONSerialization.jsonObject(with: data),
            let dict = raw as? [String: Any]
        else {
            print("⚠️ WS: ignored non-JSON-object message")
            return
        }

        delegate?.quizSocket(self, didReceive: dict)
    }

    fileprivate func sendRegisterDisplay() {
        wsLog.info("→ register_display (claimPlayback=\(self.claimPlayback, privacy: .public))")
        let msg = Outbound.RegisterDisplay(
            sessionId: sessionId,
            partyId: nil,
            claimPlayback: claimPlayback
        )
        send(msg)
    }

    private func handleDisconnect(error: Error?) {
        task = nil
        if explicitlyClosed {
            state = .disconnected
            return
        }
        if let error {
            state = .failed(error.localizedDescription)
        } else {
            state = .disconnected
        }
        scheduleReconnect()
    }

    private func scheduleReconnect() {
        reconnectAttempt = min(reconnectAttempt + 1, 8)
        let delay = pow(2.0, Double(reconnectAttempt - 1))   // 1,2,4,8,…,256s
        print("🔁 reconnect in \(Int(delay))s (attempt \(reconnectAttempt))")
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            self.connect()
        }
    }
}

// MARK: - Delegate protocol

@MainActor
protocol QuizSocketDelegate: AnyObject {
    func quizSocket(_ socket: QuizSocket, didReceive message: [String: Any])
    func quizSocket(_ socket: QuizSocket, didChangeState state: QuizSocket.ConnectionState)
}

// MARK: - URLSession delegate

extension QuizSocket: URLSessionWebSocketDelegate {
    nonisolated func urlSession(_ session: URLSession,
                                webSocketTask: URLSessionWebSocketTask,
                                didOpenWithProtocol protocol: String?) {
        wsLog.info("✅ ws didOpen")
        Task { @MainActor in
            self.reconnectAttempt = 0
            self.state = .connected
            self.sendRegisterDisplay()
        }
    }

    nonisolated func urlSession(_ session: URLSession,
                                webSocketTask: URLSessionWebSocketTask,
                                didCloseWith closeCode: URLSessionWebSocketTask.CloseCode,
                                reason: Data?) {
        wsLog.info("ws didClose code=\(closeCode.rawValue, privacy: .public)")
        Task { @MainActor in
            self.handleDisconnect(error: nil)
        }
    }

    nonisolated func urlSession(_ session: URLSession,
                                task: URLSessionTask,
                                didCompleteWithError error: Error?) {
        if let error {
            wsLog.error("ws didCompleteWithError: \(error.localizedDescription, privacy: .public)")
        }
    }
}
