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
    /// Measured, not assumed.
    ///
    /// On-device recognition does not truncate a long clip so much as give up
    /// on it, returning a single empty segment marked final with no error
    /// raised. The length it tolerates depends on the audio: the same take
    /// transcribes completely in eight second pieces at every offset, and
    /// returns nothing at all when the second half is handed over as one
    /// sixteen second piece. Clean synthetic speech survives far longer, which
    /// is exactly why a fixture-based test missed this and a real recording
    /// found it immediately.
    static let windowSeconds: Double = 8

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
        /// Where the last emitted line ended, so windows cannot overlap.
        var lastEnd: Double = 0
        while offset < duration {
            let length = min(windowSeconds, duration - offset)
            let clipped = max(0, offset - (offset > 0 ? overlapSeconds : 0))
            let span = length + (offset > 0 ? overlapSeconds : 0)

            do {
                let clip = try await extract(asset: asset, start: clipped, seconds: span)
                defer { try? FileManager.default.removeItem(at: clip) }
                let cues = try recogniseInChild(url: clip, locale: locale, shift: clipped)
                // Windows overlap so a sentence crossing a boundary is heard
                // whole, which means the same words can arrive twice. Captions
                // have to be a sequence, not a pile: anything already covered is
                // dropped, and anything that merely starts too early is pulled
                // forward to where the last line ended.
                for var cue in cues {
                    if cue.end <= lastEnd + 0.1 { continue }
                    if cue.start < lastEnd { cue.start = lastEnd }
                    guard cue.end > cue.start else { continue }
                    lastEnd = cue.end
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

    /// Recognises one window, in a process of its own.
    ///
    /// Only the first file recognition in a process returns anything. Every
    /// window after it comes back with a single empty segment, marked final,
    /// with no error raised — and the very same clip transcribes correctly when
    /// it is the first thing a fresh process is asked to do. A new recogniser
    /// per window, explicitly finishing the previous task, and waiting between
    /// them all failed to change that, so the boundary being respected here is
    /// the process itself.
    ///
    /// The cost is one short-lived child per fifteen seconds of audio, which is
    /// nothing beside the recognition it performs.
    private static func recogniseInChild(url: URL, locale: String, shift: Double) throws -> [Cue] {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: CommandLine.arguments[0])
        process.arguments = ["transcribe-window", "--audio", url.path, "--locale", locale]
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = FileHandle.nullDevice
        try process.run()

        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()

        var cues: [Cue] = []
        for line in String(decoding: data, as: UTF8.self).split(separator: "\n") {
            guard
                let payload = try? JSONSerialization.jsonObject(with: Data(line.utf8))
                    as? [String: Any],
                payload["event"] as? String == "cue",
                let start = payload["start"] as? Double,
                let end = payload["end"] as? Double,
                let text = payload["text"] as? String
            else { continue }
            cues.append(
                Cue(
                    start: shift + start, end: shift + end, text: text,
                    confidence: payload["confidence"] as? Double ?? 0))
        }
        return cues
    }

    /// The child half: recognise one clip and print its cues, timed from zero.
    static func runWindow(audioPath: String, locale: String) async {
        let url = URL(fileURLWithPath: audioPath)
        guard await requestAuthorization() == .authorized,
            let recognizer = SFSpeechRecognizer(locale: Locale(identifier: locale)),
            recognizer.isAvailable
        else {
            exit(4)
        }
        do {
            for cue in try await recognise(locale: locale, url: url, shift: 0) {
                emit([
                    "event": "cue", "start": cue.start, "end": cue.end, "text": cue.text,
                    "confidence": cue.confidence,
                ])
            }
        } catch {
            // Silence and failure look the same to the parent, which is correct:
            // either way this window contributed nothing.
        }
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

        // Copied into a composition at time zero rather than exported with a
        // timeRange. Exporting a range leaves the clip carrying an edit list
        // that says it begins part-way through the original, and the recogniser
        // returns a single empty segment for such a file — no error, just
        // nothing, which is why only the very first window of a take ever
        // produced captions. A composition has no such history: the clip starts
        // at zero because that is genuinely where its audio starts.
        let composition = AVMutableComposition()
        guard
            let track = composition.addMutableTrack(
                withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid)
        else {
            throw NSError(
                domain: "demodog", code: 1,
                userInfo: [NSLocalizedDescriptionKey: "cannot create an audio track"])
        }
        let sources = try await asset.loadTracks(withMediaType: .audio)
        guard let source = sources.first else {
            throw NSError(
                domain: "demodog", code: 1,
                userInfo: [NSLocalizedDescriptionKey: "the file has no audio"])
        }
        try track.insertTimeRange(
            CMTimeRange(
                start: CMTime(seconds: start, preferredTimescale: 600),
                duration: CMTime(seconds: seconds, preferredTimescale: 600)),
            of: source, at: .zero)

        guard
            let session = AVAssetExportSession(
                asset: composition, presetName: AVAssetExportPresetAppleM4A)
        else {
            throw NSError(
                domain: "demodog", code: 1,
                userInfo: [NSLocalizedDescriptionKey: "cannot export audio"])
        }
        session.outputURL = out
        session.outputFileType = .m4a

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
    ///
    /// A recogniser per window, deliberately. Reusing one across windows looks
    /// natural and fails silently: the first window transcribes, and every one
    /// after it returns a final result with an empty transcription — no error,
    /// no warning, just a take that stops having captions fifteen seconds in.
    /// Each clip transcribes perfectly when handed to a fresh instance, which
    /// is what makes the reuse the culprit rather than the audio.
    private static func recognise(
        locale: String, url: URL, shift: Double
    ) async throws -> [Cue] {
        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: locale)) else {
            throw NSError(
                domain: "demodog", code: 3,
                userInfo: [NSLocalizedDescriptionKey: "no recogniser for \(locale)"])
        }
        let request = SFSpeechURLRecognitionRequest(url: url)
        request.requiresOnDeviceRecognition = true
        request.shouldReportPartialResults = false
        if #available(macOS 13.0, *) {
            request.addsPunctuation = true
        }

        // The task is held and explicitly finished. Letting it fall out of
        // scope leaves the previous recognition apparently still open, and the
        // next window then returns an empty final result with no error — the
        // symptom being a transcript that stops dead at the first window
        // boundary while every clip transcribes fine on its own.
        var task: SFSpeechRecognitionTask?
        let result: SFSpeechRecognitionResult = try await withCheckedThrowingContinuation {
            continuation in
            var resumed = false
            task = recognizer.recognitionTask(with: request) { result, error in
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
        task?.finish()
        task = nil

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
            // A window with nothing in it comes back as a single empty segment
            // rather than no segments, and that became a caption of no text
            // sitting at zero — which reads as a transcript that ran and found
            // one blank line, rather than one that heard nothing.
            let joined = words.map(\.substring).joined(separator: " ")
            guard !joined.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                return nil
            }
            let confidence =
                words.reduce(0.0) { $0 + Double($1.confidence) } / Double(words.count)
            return Cue(
                start: shift + first.timestamp,
                end: shift + last.timestamp + last.duration,
                text: joined,
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
