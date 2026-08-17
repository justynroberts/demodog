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
    /// is heard whole by the later one. Cues are assigned to the window their
    /// midpoint falls in, so the extra second never produces a duplicate.
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
                // The overlap exists so a sentence crossing a boundary is heard
                // whole, not so it is transcribed twice. Each cue belongs to the
                // window its middle falls in, which assigns every one exactly
                // once without needing to compare text.
                for cue in cues where offset == 0 || (cue.start + cue.end) / 2 >= offset {
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
    /// caption. Two passes: gather words into sentences, then break a sentence
    /// that is too long to read into near-equal parts.
    ///
    /// The equal split is the point. Filling each line to a character limit and
    /// starting a new one when it overflows leaves the tail of a sentence alone
    /// on screen — a caption reading "dog." for a third of a second, which
    /// looks exactly like a transcript with words missing from it. Nearly a
    /// third of the lines were fragments like that.
    private static func group(segments: [SFTranscriptionSegment], shift: Double) -> [Cue] {
        // A caption wraps to a second line when it needs to, so a whole
        // sentence usually belongs in one cue.
        let comfortable = 90

        func cue(_ words: [SFTranscriptionSegment]) -> Cue? {
            guard let first = words.first, let last = words.last else { return nil }
            let confidence =
                words.reduce(0.0) { $0 + Double($1.confidence) } / Double(words.count)
            return Cue(
                start: shift + first.timestamp,
                end: shift + last.timestamp + last.duration,
                text: words.map(\.substring).joined(separator: " "),
                confidence: confidence)
        }

        // ---- sentences ------------------------------------------------
        var sentences: [[SFTranscriptionSegment]] = []
        var current: [SFTranscriptionSegment] = []
        for (index, segment) in segments.enumerated() {
            current.append(segment)
            let last = segment.substring.last
            let ends = last == "." || last == "?" || last == "!"
            let next = index + 1 < segments.count ? segments[index + 1] : nil
            let gap = next.map { $0.timestamp - (segment.timestamp + segment.duration) } ?? 0
            if ends || gap > 0.7 {
                sentences.append(current)
                current = []
            }
        }
        if !current.isEmpty { sentences.append(current) }

        // ---- break the long ones evenly -------------------------------
        var cues: [Cue] = []
        for words in sentences {
            let length = words.map(\.substring).joined(separator: " ").count
            if length <= comfortable || words.count < 4 {
                if let one = cue(words) { cues.append(one) }
                continue
            }
            let parts = max(2, Int(ceil(Double(length) / Double(comfortable))))
            // Ceiling, so the last part is the short one and never emptier than
            // the rest by more than a word.
            let per = Int(ceil(Double(words.count) / Double(parts)))
            var index = 0
            while index < words.count {
                let slice = Array(words[index..<min(index + per, words.count)])
                if let one = cue(slice) { cues.append(one) }
                index += per
            }
        }
        return cues
    }
}
