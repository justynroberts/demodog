// MIT License - Copyright (c) fintonlabs.com
import Foundation
import ScreenCaptureKit
import Speech
import AppKit

/// Enumerates what can be recorded: every active display, and every on-screen
/// window big enough to be worth offering. Emitted as JSON for the picker UI.
enum SourceLister {
    static func run() async {
        do {
            let content = try await SCShareableContent.excludingDesktopWindows(
                false,
                onScreenWindowsOnly: true
            )

            let displays: [[String: Any]] = content.displays.map { display in
                let bounds = CGDisplayBounds(display.displayID)
                let screen = NSScreen.screens.first {
                    ($0.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? CGDirectDisplayID) == display.displayID
                }
                let scale = screen?.backingScaleFactor ?? 2.0
                return [
                    "id": Int(display.displayID),
                    "width": display.width,
                    "height": display.height,
                    "pixelWidth": Int(Double(display.width) * scale),
                    "pixelHeight": Int(Double(display.height) * scale),
                    "scale": scale,
                    "originX": bounds.origin.x,
                    "originY": bounds.origin.y,
                    "name": screen?.localizedName ?? "Display \(display.displayID)",
                    "isPrimary": bounds.origin == .zero,
                ]
            }

            // Skip the tiny system chrome windows — menu bar items, shadows,
            // and the wallpaper layer all show up here otherwise.
            let windows: [[String: Any]] = content.windows.compactMap { window in
                guard window.frame.width > 120, window.frame.height > 120 else { return nil }
                guard let app = window.owningApplication else { return nil }
                if app.bundleIdentifier == "com.apple.dock" { return nil }
                if app.bundleIdentifier == "com.apple.WindowManager" { return nil }
                let title = window.title ?? ""
                if title.isEmpty && window.windowLayer != 0 { return nil }
                return [
                    "id": Int(window.windowID),
                    "title": title,
                    "app": app.applicationName,
                    "bundleId": app.bundleIdentifier,
                    "pid": Int(app.processID),
                    "x": window.frame.origin.x,
                    "y": window.frame.origin.y,
                    "width": window.frame.width,
                    "height": window.frame.height,
                    "layer": window.windowLayer,
                    "active": window.isActive,
                ]
            }

            emit([
                "event": "sources",
                "displays": displays,
                "windows": windows,
            ])
            exit(0)
        } catch {
            // The most common failure here by far is a missing Screen Recording
            // grant — surface that distinctly so the UI can deep-link Settings.
            emit([
                "event": "error",
                "code": "no-permission",
                "message": "Could not read shareable content: \(error.localizedDescription)",
            ])
            exit(2)
        }
    }
}

enum WindowFocus {
    static func run(windowID: CGWindowID) async {
        guard
            let content = try? await SCShareableContent.excludingDesktopWindows(
                false, onScreenWindowsOnly: true),
            let window = content.windows.first(where: { $0.windowID == windowID }),
            let pid = window.owningApplication?.processID
        else {
            emit(["event": "error", "code": "no-window", "message": "window \(windowID) is gone"])
            exit(2)
        }

        let app = NSRunningApplication(processIdentifier: pid)
        // Plain activation, not `.activateAllWindows`. Raising every window an
        // application owns rearranges the user's desktop around a choice they
        // made about one window, which is not what they asked for.
        let raised = app?.activate() ?? false
        emit([
            "event": "focused",
            "window": Int(windowID),
            "app": window.owningApplication?.applicationName ?? "",
            "raised": raised,
        ])
        exit(0)
    }
}

/// Reports whether this process currently holds the Screen Recording grant.
/// `CGPreflightScreenCaptureAccess` answers without prompting; the request
/// variant triggers the system dialog exactly once per app.
enum Permissions {
/// Brings a window to the front so it can be arranged before recording.
///
/// Choosing a window to record and then having to hunt for it behind the
/// recorder is a poor way to start a take — and a window that is behind
/// something else is exactly the one that sits idle and records nothing.
///
/// Activation goes through the owning application rather than the window: a
/// window cannot raise itself from another process, and asking the app to come
/// forward is the supported route that needs no automation permission.

    static func check(requesting: Bool) {
        let screen = CGPreflightScreenCaptureAccess()
        if !screen && requesting {
            CGRequestScreenCaptureAccess()
        }
        // Accessibility is only needed for the optional keystroke overlay, so
        // it is reported but never blocks a recording.
        let axOptions = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: requesting] as CFDictionary
        let accessibility = AXIsProcessTrustedWithOptions(axOptions)

        emit([
            "event": "permissions",
            "screenRecording": CGPreflightScreenCaptureAccess(),
            "screenRecordingBefore": screen,
            "accessibility": accessibility,
        ])
        exit(0)
    }
}

/**
 * What a file's audio actually contains.
 *
 * Transcription picked its source by which file *existed*, not by which had
 * anything in it — so a take recorded with a camera but no microphone handed
 * the recogniser a video-only file, every window failed to extract, and the
 * user was told "no speech was heard". That is confidently wrong: it sends
 * someone to check their microphone level when the microphone was never in the
 * take at all.
 *
 * Reports whether there is an audio track and how loud it gets, so the three
 * cases — no track, silence, and genuinely no speech — can be told apart and
 * said out loud.
 */
enum AudioProbe {
    /// Only the opening is scanned. Peak level is being used to tell silence
    /// from speech, and half a minute settles that for any real recording.
    private static let scanSeconds = 30.0

    static func run(path: String) async {
        let asset = AVURLAsset(url: URL(fileURLWithPath: path))
        guard let audio = try? await asset.loadTracks(withMediaType: .audio).first ?? nil
        else {
            emit(["event": "probe", "hasAudio": false, "path": path])
            exit(0)
        }

        let duration = (try? await CMTimeGetSeconds(asset.load(.duration))) ?? 0
        var peak: Float = 0

        if let reader = try? AVAssetReader(asset: asset) {
            let output = AVAssetReaderTrackOutput(
                track: audio,
                outputSettings: [
                    AVFormatIDKey: kAudioFormatLinearPCM,
                    AVLinearPCMBitDepthKey: 32,
                    AVLinearPCMIsFloatKey: true,
                    AVLinearPCMIsNonInterleaved: false,
                ])
            reader.add(output)
            reader.timeRange = CMTimeRange(
                start: .zero, duration: CMTime(seconds: scanSeconds, preferredTimescale: 600))
            reader.startReading()
            while let buffer = output.copyNextSampleBuffer() {
                guard let block = CMSampleBufferGetDataBuffer(buffer) else { continue }
                var length = 0
                var pointer: UnsafeMutablePointer<Int8>?
                guard
                    CMBlockBufferGetDataPointer(
                        block, atOffset: 0, lengthAtOffsetOut: nil, totalLengthOut: &length,
                        dataPointerOut: &pointer) == noErr, let raw = pointer
                else { continue }
                raw.withMemoryRebound(to: Float.self, capacity: length / 4) { samples in
                    for i in 0..<(length / 4) { peak = max(peak, abs(samples[i])) }
                }
            }
            reader.cancelReading()
        }

        // dBFS, floored so a digitally silent track reports a number rather
        // than negative infinity, which nothing downstream wants to parse.
        let db = peak > 0 ? 20 * log10(Double(peak)) : -120.0
        emit([
            "event": "probe", "hasAudio": true, "path": path,
            "duration": duration, "peakDb": db,
        ])
        exit(0)
    }
}

/**
 * What the speech recogniser can actually do on this machine.
 *
 * "Transcription found nothing" has too many causes to guess between from a
 * description, and they live on the user's Mac rather than in the take: the
 * permission, whether a locale is supported at all, and whether its on-device
 * model has been downloaded. macOS 26 moved speech recognition onto a new
 * framework and the old one can report itself available while quietly
 * returning empty results, which is indistinguishable from silence.
 *
 * So this reports the state rather than inferring it, and travels in the bug
 * report.
 */
enum SpeechCheck {
    static func run(locale: String) async {
        let status = await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { continuation.resume(returning: $0) }
        }
        let name: String
        switch status {
        case .authorized: name = "authorized"
        case .denied: name = "denied"
        case .restricted: name = "restricted"
        case .notDetermined: name = "notDetermined"
        @unknown default: name = "unknown"
        }

        let supported = SFSpeechRecognizer.supportedLocales().map { $0.identifier }
        let recogniser = SFSpeechRecognizer(locale: Locale(identifier: locale))
        var info: [String: Any] = [
            "event": "speech",
            "os": ProcessInfo.processInfo.operatingSystemVersionString,
            "authorization": name,
            "requested": locale,
            "localeSupported": supported.contains(where: { $0.replacingOccurrences(of: "_", with: "-") == locale }),
            "supportedCount": supported.count,
        ]
        if let recogniser {
            info["available"] = recogniser.isAvailable
            info["onDevice"] = recogniser.supportsOnDeviceRecognition
        } else {
            info["available"] = false
            info["onDevice"] = false
            info["note"] = "no recogniser could be created for that locale"
        }
        // A handful, so a report shows what this Mac would accept instead.
        info["someSupported"] = Array(supported.prefix(8))
        emit(info)
        exit(0)
    }
}
