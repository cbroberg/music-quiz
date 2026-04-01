// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "screen-record",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(name: "screen-record", path: "Sources"),
    ]
)
