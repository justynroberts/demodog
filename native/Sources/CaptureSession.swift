// MIT License - Copyright (c) fintonlabs.com
import Foundation
import ScreenCaptureKit
import AVFoundation
import AppKit

/// Records a display or a window to H.264 with optional system audio, using
/// ScreenCaptureKit.
///
/// The defining choice here is `showsCursor = false`. The recorded pixels
/// contain no pointer at all — the cursor is reconstructed at render time from
/// the event stream, which is what makes smoothing, resizing and click
/// animation possible after the fact. Burning the real cursor in would make
/// all three impossible.
final class CaptureSession: NSObject, SCStreamOutput, SCStreamDelegate {
    struct Options {
        var outputDir: String
        var fps: Int
        var showsCursor: Bool
        var captureSystemAudio: Bool
        var trackKeys: Bool
        var displayID: CGDirectDisplayID?
        var windowID: CGWindowID?
        var cropRect: CGRect?
        var maxPixelWidth: Int?
        /// Windows owned by these processes are kept out of the capture. The
        /// app passes its own Electron pid so the floating control bar and
        /// camera bubble never appear in the recording.
        var excludePids: [pid_t] = []
    }

    private let options: Options
    private var stream: SCStream?
    private var writer: AVAssetWriter?
    private var videoInput: AVAssetWriterInput?
    private var audioInput: AVAssetWriterInput?
    private var tracker: InputTracker?
    private var events: JSONLWriter?

    private var sessionStarted = false
    private var firstFrameHost: Double = 0
    private var frameCount = 0
    private var lastFrameHost: Double = 0
    private var finishing = false
    private var meta: [String: Any] = [:]

    private let writeQueue = DispatchQueue(label: "demodog.writer")

    init(options: Options) {
        self.options = options
    }

    // MARK: - Start

    func start() async {
        let dir = options.outputDir
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)

        guard let eventsWriter = JSONLWriter(path: dir + "/events.jsonl") else {
            fail("Could not open events.jsonl for writing")
        }
        events = eventsWriter

        let content: SCShareableContent
        do {
            content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        } catch {
            fail("Screen recording permission denied or unavailable: \(error.localizedDescription)")
        }

        let filter: SCContentFilter
        let config = SCStreamConfiguration()
        var space: InputTracker.Space

        if let windowID = options.windowID {
            guard let window = content.windows.first(where: { $0.windowID == windowID }) else {
                fail("Window \(windowID) is no longer available")
            }
            // A window's backing scale comes from whichever display it sits on.
            let scale = Self.scaleFactor(containing: window.frame)
            filter = SCContentFilter(desktopIndependentWindow: window)
            let (w, h) = Self.evenPixelSize(
                width: window.frame.width, height: window.frame.height,
                scale: scale, maxWidth: options.maxPixelWidth
            )
            config.width = w
            config.height = h
            space = .init(
                originX: window.frame.origin.x, originY: window.frame.origin.y,
                width: window.frame.width, height: window.frame.height,
                scale: Double(w) / window.frame.width
            )
            meta["mode"] = "window"
            meta["window"] = [
                "id": Int(windowID),
                "title": window.title ?? "",
                "app": window.owningApplication?.applicationName ?? "",
            ]
        } else {
            let displayID = options.displayID ?? CGMainDisplayID()
            guard let display = content.displays.first(where: { $0.displayID == displayID }) ?? content.displays.first else {
                fail("No displays available to capture")
            }
            let bounds = CGDisplayBounds(display.displayID)
            let scale = Self.scaleFactor(for: display.displayID)

            // Keep the recorder's own UI out of the recording. The helper runs
            // as a child process, so the pids that matter are passed in by the
            // app rather than being our own.
            var excluded = Set(options.excludePids)
            excluded.insert(getpid())
            let ownWindows = content.windows.filter { window in
                guard let pid = window.owningApplication?.processID else { return false }
                return excluded.contains(pid)
            }
            filter = SCContentFilter(display: display, excludingWindows: ownWindows)

            let (w, h) = Self.evenPixelSize(
                width: CGFloat(display.width), height: CGFloat(display.height),
                scale: scale, maxWidth: options.maxPixelWidth
            )
            config.width = w
            config.height = h
            space = .init(
                originX: bounds.origin.x, originY: bounds.origin.y,
                width: Double(display.width), height: Double(display.height),
                scale: Double(w) / Double(display.width)
            )
            meta["mode"] = "display"
            meta["display"] = [
                "id": Int(display.displayID),
                "width": display.width,
                "height": display.height,
                "scale": scale,
                "originX": bounds.origin.x,
                "originY": bounds.origin.y,
            ]
        }

        config.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(options.fps))
        config.queueDepth = 8
        config.showsCursor = options.showsCursor
        config.capturesAudio = options.captureSystemAudio
        config.sampleRate = 48_000
        config.channelCount = 2
        config.pixelFormat = kCVPixelFormatType_420YpCbCr8BiPlanarFullRange
        config.colorSpaceName = CGColorSpace.sRGB
        config.scalesToFit = true

        setUpWriter(width: config.width, height: config.height)

        let stream = SCStream(filter: filter, configuration: config, delegate: self)
        do {
            try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: writeQueue)
            if options.captureSystemAudio {
                try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: writeQueue)
            }
            try await stream.startCapture()
        } catch {
            fail("Could not start capture: \(error.localizedDescription)")
        }
        self.stream = stream

        let tracker = InputTracker(
            writer: eventsWriter,
            space: space,
            sampleHz: 120,
            trackKeys: options.trackKeys
        )
        tracker.start()
        self.tracker = tracker

        meta["version"] = 1
        meta["capture"] = [
            "width": config.width,
            "height": config.height,
            "fps": options.fps,
            "cursorBurnedIn": options.showsCursor,
        ]
        meta["startWallClock"] = Date().timeIntervalSince1970
        meta["startHost"] = hostSeconds()
        meta["audio"] = ["system": options.captureSystemAudio]

        emit([
            "event": "started",
            "width": config.width,
            "height": config.height,
            "fps": options.fps,
            "startWallClock": Date().timeIntervalSince1970,
            "startHost": hostSeconds(),
        ])
    }

    // MARK: - Writer

    private func setUpWriter(width: Int, height: Int) {
        let url = URL(fileURLWithPath: options.outputDir + "/screen.mp4")
        try? FileManager.default.removeItem(at: url)

        guard let assetWriter = try? AVAssetWriter(outputURL: url, fileType: .mp4) else {
            fail("Could not create the output file")
        }

        // Screen content is flat colour and sharp text, so it survives a lower
        // bit-per-pixel budget than camera footage, but this is an editing
        // master that gets re-encoded on export — keep it generous.
        let pixels = Double(width * height)
        let bitrate = Int(min(max(pixels * Double(options.fps) * 0.09, 8_000_000), 120_000_000))

        let video = AVAssetWriterInput(mediaType: .video, outputSettings: [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: width,
            AVVideoHeightKey: height,
            AVVideoCompressionPropertiesKey: [
                AVVideoAverageBitRateKey: bitrate,
                AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
                AVVideoAllowFrameReorderingKey: false,
                // Keyframe spacing drives how fast a take can be exported and
                // scrubbed, because every seek re-decodes from the previous
                // keyframe. Shortening it to 15 frames measured 3.2x faster to
                // export — but screen content compresses to almost nothing
                // between keyframes, so the file went from 25 MB/min to
                // 214 MB/min. Eight times the disk for three times the speed is
                // the wrong trade; the fix belongs in the exporter.
                AVVideoMaxKeyFrameIntervalKey: options.fps * 2,
                AVVideoExpectedSourceFrameRateKey: options.fps,
            ],
        ])
        video.expectsMediaDataInRealTime = true
        if assetWriter.canAdd(video) { assetWriter.add(video) }
        videoInput = video

        if options.captureSystemAudio {
            let audio = AVAssetWriterInput(mediaType: .audio, outputSettings: [
                AVFormatIDKey: kAudioFormatMPEG4AAC,
                AVSampleRateKey: 48_000,
                AVNumberOfChannelsKey: 2,
                AVEncoderBitRateKey: 192_000,
            ])
            audio.expectsMediaDataInRealTime = true
            if assetWriter.canAdd(audio) { assetWriter.add(audio) }
            audioInput = audio
        }

        assetWriter.startWriting()
        writer = assetWriter
    }

    // MARK: - SCStreamOutput

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard !finishing, CMSampleBufferDataIsReady(sampleBuffer) else { return }

        switch type {
        case .screen:
            // ScreenCaptureKit emits buffers for idle/blank frames too; only
            // `.complete` ones carry new pixels.
            guard
                let attachments = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
                let raw = attachments.first?[.status] as? Int,
                let status = SCFrameStatus(rawValue: raw),
                status == .complete
            else { return }

            guard let writer, let videoInput else { return }

            if !sessionStarted {
                let pts = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
                writer.startSession(atSourceTime: pts)
                sessionStarted = true
                firstFrameHost = pts.seconds
                meta["firstFrameHost"] = firstFrameHost
            }

            if videoInput.isReadyForMoreMediaData {
                videoInput.append(sampleBuffer)
                frameCount += 1
                lastFrameHost = CMSampleBufferGetPresentationTimeStamp(sampleBuffer).seconds
            }

        case .audio:
            guard sessionStarted, let audioInput, audioInput.isReadyForMoreMediaData else { return }
            audioInput.append(sampleBuffer)

        default:
            break
        }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        let ns = error as NSError
        emit([
            "event": "error",
            "code": "stream-stopped",
            "domain": ns.domain,
            "errorCode": ns.code,
            "screenRecordingGranted": CGPreflightScreenCaptureAccess(),
            "message": "Capture stopped: \(error.localizedDescription)",
        ])
        Task { await finish() }
    }

    // MARK: - Finish

    func finish() async {
        guard !finishing else { return }
        finishing = true

        tracker?.stop()
        if let stream { try? await stream.stopCapture() }

        videoInput?.markAsFinished()
        audioInput?.markAsFinished()

        if let writer, sessionStarted {
            await writer.finishWriting()
        }
        events?.close()

        let duration = max(0, lastFrameHost - firstFrameHost)
        meta["frames"] = frameCount
        meta["duration"] = duration
        meta["endHost"] = hostSeconds()
        writeJSON(meta, to: options.outputDir + "/meta.json")

        emit([
            "event": "stopped",
            "dir": options.outputDir,
            "frames": frameCount,
            "duration": duration,
            "firstFrameHost": firstFrameHost,
        ])
        exit(0)
    }

    // MARK: - Helpers

    private static func scaleFactor(for displayID: CGDirectDisplayID) -> Double {
        let screen = NSScreen.screens.first {
            ($0.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? CGDirectDisplayID) == displayID
        }
        return screen.map { Double($0.backingScaleFactor) } ?? 2.0
    }

    private static func scaleFactor(containing rect: CGRect) -> Double {
        for screen in NSScreen.screens where screen.frame.intersects(rect) {
            return Double(screen.backingScaleFactor)
        }
        return NSScreen.main.map { Double($0.backingScaleFactor) } ?? 2.0
    }

    /// H.264 requires even dimensions; an optional cap keeps 5K displays from
    /// producing an unplayable editing master.
    private static func evenPixelSize(width: CGFloat, height: CGFloat, scale: Double, maxWidth: Int?) -> (Int, Int) {
        var w = Double(width) * scale
        var h = Double(height) * scale
        if let maxWidth, w > Double(maxWidth) {
            let ratio = Double(maxWidth) / w
            w *= ratio
            h *= ratio
        }
        return (Int(w / 2).multipliedReportingOverflow(by: 2).partialValue,
                Int(h / 2).multipliedReportingOverflow(by: 2).partialValue)
    }
}
