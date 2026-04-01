import AVFoundation
import CoreGraphics
import ScreenCaptureKit
import Foundation

// ── Entry point ──────────────────────────────────────────────

guard CGPreflightScreenCaptureAccess() else {
    CGRequestScreenCaptureAccess()
    fputs("❌ No screen capture permission. Grant access in System Settings > Privacy & Security > Screen Recording, then re-run.\n", stderr)
    exit(1)
}

// Parse args: screen-record [output.mov] [--crop]
let args = Array(CommandLine.arguments.dropFirst())
let cropChrome = args.contains("--crop")
let outputPath = args.first(where: { !$0.hasPrefix("-") }) ?? "recording-\(ISO8601DateFormatter().string(from: Date()).replacingOccurrences(of: ":", with: "-")).mov"

let url = URL(filePath: outputPath)
fputs("🎬 Recording screen + system audio → \(outputPath)\(cropChrome ? " (cropped)" : "")\n", stderr)
fputs("   Send SIGINT (Ctrl+C) to stop.\n", stderr)

let recorder = try await ScreenRecorder(url: url, displayID: CGMainDisplayID(), cropMenuAndDock: cropChrome)
try await recorder.start()

// Wait for SIGINT
let stopSemaphore = DispatchSemaphore(value: 0)
signal(SIGINT) { _ in stopSemaphore.signal() }
signal(SIGTERM) { _ in stopSemaphore.signal() }
stopSemaphore.wait()

fputs("\n🛑 Stopping...\n", stderr)
try await recorder.stop()
fputs("✅ Saved: \(outputPath)\n", stderr)

// ── ScreenRecorder ───────────────────────────────────────────

struct ScreenRecorder {
    private let assetWriter: AVAssetWriter
    private let videoInput: AVAssetWriterInput
    private let audioInput: AVAssetWriterInput
    private let streamOutput: StreamOutput
    private var stream: SCStream

    private let videoQueue = DispatchQueue(label: "video-q")
    private let audioQueue = DispatchQueue(label: "audio-q")

    init(url: URL, displayID: CGDirectDisplayID, cropMenuAndDock: Bool = false) async throws {
        assetWriter = try AVAssetWriter(url: url, fileType: .mov)

        // Display dimensions (retina-aware)
        let bounds = CGDisplayBounds(displayID).size
        let scale: Int
        if let mode = CGDisplayCopyDisplayMode(displayID) {
            scale = mode.pixelWidth / mode.width
        } else {
            scale = 1
        }

        // Crop menu bar (top 25pt) and dock (bottom 80pt) if requested
        let menuBarPt: CGFloat = cropMenuAndDock ? 25 : 0
        let dockPt: CGFloat = cropMenuAndDock ? 80 : 0
        let cropRect = cropMenuAndDock ? CGRect(
            x: 0,
            y: menuBarPt,
            width: bounds.width,
            height: bounds.height - menuBarPt - dockPt
        ) : nil

        var width = Int((cropRect?.width ?? bounds.width)) * scale
        var height = Int((cropRect?.height ?? bounds.height)) * scale

        // Clamp to H.264 max (4096x2304)
        let ratio = max(Double(width) / 4096.0, Double(height) / 2304.0)
        if ratio > 1 {
            width = Int(Double(width) / ratio)
            height = Int(Double(height) / ratio)
        }
        // Ensure even dimensions
        width = width & ~1
        height = height & ~1

        // Video input
        let videoSettings: [String: Any] = [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: width,
            AVVideoHeightKey: height,
        ]
        videoInput = AVAssetWriterInput(mediaType: .video, outputSettings: videoSettings)
        videoInput.expectsMediaDataInRealTime = true

        // Audio input (AAC stereo 48kHz)
        let audioSettings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: 48000,
            AVNumberOfChannelsKey: 2,
            AVEncoderBitRateKey: 192_000,
        ]
        audioInput = AVAssetWriterInput(mediaType: .audio, outputSettings: audioSettings)
        audioInput.expectsMediaDataInRealTime = true

        assetWriter.add(videoInput)
        assetWriter.add(audioInput)
        guard assetWriter.startWriting() else {
            throw assetWriter.error ?? RecorderError("Couldn't start writing")
        }

        streamOutput = StreamOutput(videoInput: videoInput, audioInput: audioInput)

        // SCStream setup
        let content = try await SCShareableContent.current
        guard let display = content.displays.first(where: { $0.displayID == displayID }) else {
            throw RecorderError("Display \(displayID) not found")
        }
        let filter = SCContentFilter(display: display, excludingWindows: [])

        let config = SCStreamConfiguration()
        config.width = width
        config.height = height
        if let rect = cropRect {
            config.sourceRect = rect
        }
        config.pixelFormat = kCVPixelFormatType_32BGRA
        config.queueDepth = 6
        // System audio
        config.capturesAudio = true
        config.sampleRate = 48000
        config.channelCount = 2
        config.excludesCurrentProcessAudio = true

        stream = SCStream(filter: filter, configuration: config, delegate: nil)
        try stream.addStreamOutput(streamOutput, type: .screen, sampleHandlerQueue: videoQueue)
        try stream.addStreamOutput(streamOutput, type: .audio, sampleHandlerQueue: audioQueue)
    }

    func start() async throws {
        try await stream.startCapture()
        assetWriter.startSession(atSourceTime: .zero)
        streamOutput.sessionStarted = true
    }

    func stop() async throws {
        try await stream.stopCapture()

        // Write final frame to ensure correct duration
        if let lastBuf = streamOutput.lastVideoBuffer {
            let elapsed = CMTime(
                seconds: ProcessInfo.processInfo.systemUptime,
                preferredTimescale: 100
            ) - streamOutput.firstSampleTime
            let timing = CMSampleTimingInfo(
                duration: lastBuf.duration,
                presentationTimeStamp: elapsed,
                decodeTimeStamp: lastBuf.decodeTimeStamp
            )
            if let final = try? CMSampleBuffer(copying: lastBuf, withNewTiming: [timing]) {
                videoInput.append(final)
            }
            assetWriter.endSession(atSourceTime: elapsed)
        }

        videoInput.markAsFinished()
        audioInput.markAsFinished()
        await assetWriter.finishWriting()
    }
}

// ── Stream output handler ────────────────────────────────────

private class StreamOutput: NSObject, SCStreamOutput {
    let videoInput: AVAssetWriterInput
    let audioInput: AVAssetWriterInput
    var sessionStarted = false
    var firstSampleTime: CMTime = .zero
    var lastVideoBuffer: CMSampleBuffer?

    init(videoInput: AVAssetWriterInput, audioInput: AVAssetWriterInput) {
        self.videoInput = videoInput
        self.audioInput = audioInput
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard sessionStarted, sampleBuffer.isValid else { return }

        switch type {
        case .screen:
            guard let attachments = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
                  let first = attachments.first,
                  let rawStatus = first[.status] as? Int,
                  let status = SCFrameStatus(rawValue: rawStatus),
                  status == .complete
            else { return }

            if videoInput.isReadyForMoreMediaData {
                if firstSampleTime == .zero {
                    firstSampleTime = sampleBuffer.presentationTimeStamp
                }
                let offset = sampleBuffer.presentationTimeStamp - firstSampleTime
                let timing = CMSampleTimingInfo(
                    duration: sampleBuffer.duration,
                    presentationTimeStamp: offset,
                    decodeTimeStamp: sampleBuffer.decodeTimeStamp
                )
                if let retimed = try? CMSampleBuffer(copying: sampleBuffer, withNewTiming: [timing]) {
                    videoInput.append(retimed)
                    lastVideoBuffer = sampleBuffer
                }
            }

        case .audio:
            if audioInput.isReadyForMoreMediaData && firstSampleTime != .zero {
                let offset = sampleBuffer.presentationTimeStamp - firstSampleTime
                let timing = CMSampleTimingInfo(
                    duration: sampleBuffer.duration,
                    presentationTimeStamp: offset,
                    decodeTimeStamp: sampleBuffer.decodeTimeStamp
                )
                if let retimed = try? CMSampleBuffer(copying: sampleBuffer, withNewTiming: [timing]) {
                    audioInput.append(retimed)
                }
            }

        @unknown default:
            break
        }
    }
}

struct RecorderError: Error, CustomDebugStringConvertible {
    var debugDescription: String
    init(_ msg: String) { debugDescription = msg }
}
