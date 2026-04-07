import SwiftUI
import os

private let appLog = Logger(subsystem: "dk.webhouse.music-quiz.tvos", category: "app")

@main
struct MusicQuizApp: App {
    @StateObject private var coordinator: QuizCoordinator

    init() {
        let url = ServerConfig.webSocketURL
        appLog.info("MusicQuizApp.init — ws url: \(url.absoluteString, privacy: .public)")
        let coord = QuizCoordinator(serverURL: url)
        _coordinator = StateObject(wrappedValue: coord)
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(coordinator)
                .onAppear { coordinator.start() }
        }
    }
}
