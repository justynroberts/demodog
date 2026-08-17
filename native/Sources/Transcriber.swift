// MIT License - Copyright (c) fintonlabs.com
import AVFoundation
import Foundation
import Speech

/// Turns the narration in a take into timed cues.
///
/// On-device recognition, always. It is free, works with no network, and — the
/// part that actually matters — never sends a recording of someone's screen
/// session to a server they did not choose. The trade is that the first run for
/// a locale downloads a model, which the caller has to be prepared to wait for.
///
/// The audio is recognised in windows rather than in one pass. Speech
/// recognition has historically truncated long inputs without saying so, and a
/// transcript that quietly stops a minute in looks like a recording with
/// nothing said in it. Windowing removes the question: each one is short, and
/// segment times are shifted back into the timeline the caller knows about.
enum Transcriber {
    /// Long enough that sentences are rarely cut, short enough to stay well
    /// inside anything the recogniser might impose.
    static let windowSeconds: Double = 45

    /// Carried across a window boundary so a sentence split across two windows
    /// is offered to both and de-duplicated by the caller.
    static let overlapSeconds: Double = 1.0

    struct Cue {
        var start: Double
        var end: Double
        var text: String
        var confidence: Double
    }

    static func run(audioPath: String, locale: String) async {
        let url = URL(fileURLWithPath: audioPath)
        guard FileManager.default.fileExists(atPath: audioPath) else {
            emit(["event": "error", "code": "missing", "message": "no audio at \(audioPath)"])
            exit(2)
        }

        let status = await requestAuthorization()
        guard status == .authorized else {
            emit([
                "event": "error",
                "code": "denied",
                "message": "Speech Recognition permission was not granted",
            ])
            exit(4)
        }

        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: locale)) else {
            emit(["event": "error", "code": "locale", "message": "no recogniser for \(locale)"])
            exit(5)
        }
        guard recognizer.isAvailable else {
            emit(["event": "error", "code": "unavailable", "message": "recogniser unavailable"])
            exit(5)
        }
        // Without this the audio goes to Apple's servers. A screen recording is
        // exactly the kind of thing that must not leave the machine silently.
        guard recognizer.supportsOnDeviceRecognition else {
            emit([
                "event": "error",
                "code": "no-on-device",
                "message": "on-device recognition is unavailable for \(locale)",
            ])
            exit(5)
        }

        let asset = AVURLAsset(url: url)
        let duration: Double
        do {
            duration = try await CMTimeGetSeconds(asset.load(.duration))
        } catch {
            emit(["event": "error", "code": "unreadable", "message": "\(error)"])
            exit(2)
        }
        guard duration.isFinite, duration > 0 else {
            emit(["event": "error", "code": "empty", "message": "audio has no duration"])
            exit(2)
        }

        emit(["event": "started", "duration": duration, "locale": locale])

        var offset: Double = 0
        var produced = 0
        while offset < duration {
            let length = min(windowSeconds, duration - offset)
            let clipped = max(0, offset - (offset > 0 ? overlapSeconds : 0))
            let span = length + (offset > 0 ? overlapSeconds : 0)

            do {
                let clip = try await extract(asset: asset, start: clipped, seconds: span)
                defer { try? FileManager.default.removeItem(at: clip) }
                let cues = try await recognise(recognizer: recognizer, url: clip, shift: clipped)
                for cue in cues {
                    produced += 1
                    emit([
                        "event": "cue",
                        "start": cue.start,
                        "end": cue.end,
                        "text": cue.text,
                        "confidence": cue.confidence,
                    ])
                }
            } catch {
                // A window that fails is a gap, not a failure: the rest of the
                // take is still worth having, and saying so beats abandoning it.
                emit([
                    "event": "warning",
                    "at": offset,
                    "message": "\(error.localizedDescription)",
                ])
            }

            offset += length
            emit(["event": "progress", "seconds": min(offset, duration), "of": duration])
        }

        emit(["event": "done", "cues": produced])
        exit(0)
    }

    // ------------------------------------------------------------------

    private static func requestAuthorization() async -> SFSpeechRecognizerAuthorizationStatus {
        await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { continuation.resume(returning: $0) }
        }
    }

    /// Writes one window to a temporary m4a.
    ///
    /// The recogniser takes a URL, not a buffer, so each window has to exist as
    /// a file. m4a because it is what the export session produces without
    /// re-encoding surprises.
    private static func extract(asset: AVURLAsset, start: Double, seconds: Double) async throws -> URL {
        let out = FileManager.default.temporaryDirectory
            .appendingPathComponent("demodog-\(UUID().uuidString).m4a")

        guard
            let session = AVAssetExportSession(
                asset: asset, presetName: AVAssetExportPresetAppleM4A)
        else {
            throw NSError(
                domain: "demodog", code: 1,
                userInfo: [NSLocalizedDescriptionKey: "cannot export audio"])
        }
        session.outputURL = out
        session.outputFileType = .m4a
        session.timeRange = CMTimeRange(
            start: CMTime(seconds: start, preferredTimescale: 600),
            duration: CMTime(seconds: seconds, preferredTimescale: 600))

        await session.export()
        guard session.status == .completed else {
            throw session.error
                ?? NSError(
                    domain: "demodog", code: 2,
                    userInfo: [NSLocalizedDescriptionKey: "audio export failed"])
        }
        return out
    }

    /// Recognises one window and groups its words into readable cues.
    private static func recognise(
        recognizer: SFSpeechRecognizer, url: URL, shift: Double
    ) async throws -> [Cue] {
        let request = SFSpeechURLRecognitionRequest(url: url)
        request.requiresOnDeviceRecognition = true
        request.shouldReportPartialResults = false
        if #available(macOS 13.0, *) {
            request.addsPunctuation = true
        }

        let result: SFSpeechRecognitionResult = try await withCheckedThrowingContinuation {
            continuation in
            var resumed = false
            recognizer.recognitionTask(with: request) { result, error in
                guard !resumed else { return }
                if let error {
                    resumed = true
                    continuation.resume(throwing: error)
                } else if let result, result.isFinal {
                    resumed = true
                    continuation.resume(returning: result)
                }
            }
        }

        return group(segments: result.bestTranscription.segments, shift: shift)
    }

    /// Words into lines.
    ///
    /// The recogniser returns one segment per word, which is useless as a
    /// caption. Lines break on a real pause, on sentence-ending punctuation, or
    /// once a line is long enough to be worth showing on its own — roughly how
    /// a person would break them.
    private static func group(segments: [SFTranscriptionSegment], shift: Double) -> [Cue] {
        var cues: [Cue] = []
        var words: [SFTranscriptionSegment] = []

        func flush() {
            guard let first = words.first, let last = words.last else { return }
            let text = words.map(\.substring).joined(separator: " ")
            let confidence =
                words.reduce(0.0) { $0 + Double($1.confidence) } / Double(words.count)
            cues.append(
                Cue(
                    start: shift + first.timestamp,
                    end: shift + last.timestamp + last.duration,
                    text: text,
                    confidence: confidence))
            words.removeAll()
        }

        for (index, segment) in segments.enumerated() {
            words.append(segment)

            let ends = segment.substring.hasSuffix(".") || segment.substring.hasSuffix("?")
                || segment.substring.hasSuffix("!")
            let next = index + 1 < segments.count ? segments[index + 1] : nil
            let gap = next.map { $0.timestamp - (segment.timestamp + segment.duration) } ?? 0
            let line = words.map(\.substring).joined(separator: " ")

            if ends || gap > 0.6 || line.count > 62 {
                flush()
            }
        }
        flush()
        return cues
    }
}
