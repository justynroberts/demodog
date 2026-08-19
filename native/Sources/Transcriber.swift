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
    /// Measured, not assumed — and then swept against real recordings.
    ///
    /// On-device recognition does not truncate a long clip so much as give up
    /// on it, returning a single empty segment marked final with no error
    /// raised. The length it tolerates depends on the audio: the same take
    /// transcribes completely in eight second pieces at every offset, and
    /// returns nothing at all when the second half is handed over as one
    /// sixteen second piece. Clean synthetic speech survives far longer, which
    /// is exactly why a fixture-based test missed this and a real recording
    /// found it immediately.
    static let windowSeconds: Double = 2

    /// Carried across a window boundary so a sentence split across two windows
    /// is heard whole by the later one. Cues are assigned to the window their
    /// midpoint falls in, so the extra second never produces a duplicate.
    /// Generous, because the recogniser loses the opening of a clip.
    ///
    /// Swept over two real takes: 8s windows with a 1s overlap left 12.5s of
    /// speech uncaptioned, and the gaps landed immediately after every window
    /// boundary. 6 and 2 leaves 4.5s. Longer windows are worse in both
    /// directions — 10s loses whole windows to the recogniser giving up.
    ///
    /// With a one second overlap the gaps in a transcript landed immediately
    /// after every window boundary — the first second or two of each piece was
    /// simply not heard. The overlap has to be longer than whatever that
    /// warm-up costs, so the words lost at one window's start are still inside
    /// the previous window's tail.
    static let overlapSeconds: Double = 4.0

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
        /// And what it said, so the next window does not repeat its ending.
        var lastText = ""
        /// Held back one line, so a trimmed stub can rejoin what it came from.
        var pending: Cue?
        /// How many windows were attempted, and how many could not even start.
        ///
        /// A window that hears nothing and a window that was refused permission
        /// both contribute no cues, and treating them the same is why a
        /// transcription that never ran came back as an empty transcript with
        /// nothing to explain it. Counted so the difference can be reported.
        var windowsTried = 0
        var windowsFailed = 0
        var lastFailure: Int32 = 0
        while offset < duration {
            let length = min(windowSeconds, duration - offset)
            let clipped = max(0, offset - (offset > 0 ? overlapSeconds : 0))
            let span = length + (offset > 0 ? overlapSeconds : 0)

            do {
                let clip = try await extract(asset: asset, start: clipped, seconds: span)
                defer { try? FileManager.default.removeItem(at: clip) }
                let window = try recogniseInChild(
                    url: clip, locale: locale, shift: clipped, context: lastText)
                windowsTried += 1
                if window.status != 0 {
                    windowsFailed += 1
                    lastFailure = window.status
                }
                let cues = window.cues
                // Windows overlap so a sentence crossing a boundary is heard
                // whole, which means the same words can arrive twice. Captions
                // have to be a sequence, not a pile: anything already covered is
                // dropped, and anything that merely starts too early is pulled
                // forward to where the last line ended.
                for var cue in cues {
                    if cue.end <= lastEnd + 0.1 { continue }
                    if cue.start < lastEnd { cue.start = lastEnd }
                    guard cue.end > cue.start else { continue }
                    // The overlap is heard by both windows, so the second one
                    // opens by repeating how the first ended. Dropping the whole
                    // line loses what follows the repeat; keeping it reads as a
                    // stutter. Only the repeated words go.
                    cue.text = withoutRepeat(of: lastText, in: cue.text)
                    guard !cue.text.isEmpty else { continue }
                    lastEnd = cue.end

                    // One line is held back rather than emitted immediately.
                    // Trimming a repeat can leave a couple of words — "good."
                    // on its own — which belongs to the line before it rather
                    // than on screen by itself.
                    if var previous = pending {
                        // Overlapping windows arrive as pieces of a sentence:
                        // each one opens with a repeat of the last, the repeat
                        // is trimmed, and what remains is a fragment. Contiguous
                        // pieces are put back together up to a readable length,
                        // which is what stops dense overlap from turning a
                        // sentence into a stack of four-word captions.
                        let combined = previous.text + " " + cue.text
                        let contiguous = cue.start - previous.end < 0.45
                        if contiguous && combined.count <= 90 {
                            previous.text = combined
                            previous.end = cue.end
                            pending = previous
                            // Compared against the assembled line, not the
                            // fragment that arrived last. A repeat that skips a
                            // fragment — the same phrase two pieces later —
                            // otherwise sails past a comparison that can only
                            // see one piece back.
                            lastText = previous.text
                            continue
                        }
                        produced += 1
                        emitCue(previous)
                    }
                    pending = cue
                    lastText = cue.text
                }
            } catch {
                // A window that fails is a gap, not a failure: the rest of the
                // take is still worth having, and saying so beats abandoning it.
                //
                // But it is counted. These were warnings and nothing else, so a
                // file that failed to extract on *every* window — a camera
                // track with no audio in it — produced no cues, no failures and
                // no explanation, and the user was told nothing was heard.
                windowsTried += 1
                windowsFailed += 1
                lastFailure = 6
                emit([
                    "event": "warning",
                    "at": offset,
                    "message": "\(error.localizedDescription)",
                ])
            }

            offset += length
            emit(["event": "progress", "seconds": min(offset, duration), "of": duration])
        }

        if let last = pending {
            produced += 1
            emitCue(last)
        }

        // Nothing heard, and every window refused: that is a failure, not a
        // silent recording, and it is the whole reason "Transcribe did nothing"
        // was impossible to act on. Reported only when nothing was produced —
        // an occasional failed window among successful ones is not worth
        // alarming anyone about, and the transcript speaks for itself.
        if produced == 0 && windowsTried > 0 && windowsFailed == windowsTried {
            let denied = lastFailure == 4
            let unreadable = lastFailure == 6
            emit([
                "event": "error",
                "code": denied ? "denied" : unreadable ? "unreadable" : "unavailable",
                "message": denied
                    ? "Speech Recognition permission was not granted, so nothing could be transcribed."
                    : unreadable
                        ? "No audio could be read from this take."
                        : "The speech recogniser was unavailable, so nothing could be transcribed.",
                "windows": windowsTried,
            ])
            exit(denied ? 4 : 5)
        }

        emit(["event": "done", "cues": produced, "windows": windowsTried, "failed": windowsFailed])
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
    /// A window's result: what was heard, and why nothing was if nothing was.
    struct WindowResult {
        var cues: [Cue]
        /// The child's exit status. Non-zero means it could not even try.
        var status: Int32
    }

    private static func recogniseInChild(
        url: URL, locale: String, shift: Double, context: String
    ) throws -> WindowResult {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: CommandLine.arguments[0])
        var arguments = ["transcribe-window", "--audio", url.path, "--locale", locale]
        if !context.isEmpty { arguments += ["--context", context] }
        process.arguments = arguments
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
        return WindowResult(cues: cues, status: process.terminationStatus)
    }

    /// The child half: recognise one clip and print its cues, timed from zero.
    static func runWindow(audioPath: String, locale: String, context: String) async {
        let url = URL(fileURLWithPath: audioPath)
        // Exit codes are the only channel back to the parent, so they have to
        // carry the reason. A child that cannot try at all is a different fact
        // from a child that tried and heard nothing, and collapsing the two is
        // what made a whole failed transcription look like a silent recording.
        guard await requestAuthorization() == .authorized else { exit(4) }
        guard
            let recognizer = SFSpeechRecognizer(locale: Locale(identifier: locale)),
            recognizer.isAvailable
        else {
            exit(5)
        }
        do {
            for cue in try await recognise(
                locale: locale, url: url, shift: 0, context: context)
            {
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

    private static func emitCue(_ cue: Cue) {
        emit([
            "event": "cue",
            "start": cue.start,
            "end": cue.end,
            "text": cue.text,
            "confidence": cue.confidence,
        ])
    }

    /// Strips a leading phrase that merely repeats how the previous line ended.
    ///
    /// Compared on words with case and punctuation removed, because the
    /// recogniser rarely renders the same phrase identically twice — "he looks
    /// pretty" and "He looks pretty good" come from the same words heard in two
    /// windows. Two words is the shortest run worth trusting; a single repeated
    /// word is usually just English.
    static func withoutRepeat(of previous: String, in text: String) -> String {
        func normalise(_ word: Substring) -> String {
            word.lowercased().trimmingCharacters(in: .punctuationCharacters)
        }
        let previousWords = previous.split(separator: " ")
        let words = text.split(separator: " ")
        guard previousWords.count >= 2, words.count >= 2 else { return text }

        // Compared loosely, because the recogniser does not render the same
        // audio the same way twice. "I'll pick the time when I'm gonna do that"
        // and "...do this" are one sentence heard in two windows, and an exact
        // comparison treats them as two and prints both. A quarter of the words
        // may differ before a run stops counting as the same words again.
        // The repeat does not always begin at the first word — the recogniser
        // often prefixes a stray one, and "Delete, I'll pick the time..."
        // repeats a sentence starting from its second word. A few leading words
        // are allowed before the match, and go with it when it is found.
        var cut = 0
        outer: for skip in 0...min(3, max(0, words.count - 2)) {
            let available = min(previousWords.count, words.count - skip)
            guard available >= 2 else { continue }
            for run in stride(from: min(14, available), through: 2, by: -1) {
                let tail = previousWords.suffix(run).map(normalise)
                let head = words[skip..<(skip + run)].map(normalise)
                let differences = zip(tail, head).reduce(0) { $0 + ($1.0 == $1.1 ? 0 : 1) }
                if differences <= max(0, run / 4) {
                    cut = skip + run
                    break outer
                }
            }
        }
        guard cut > 0 else { return text }
        return words.dropFirst(cut).joined(separator: " ")
            .trimmingCharacters(in: .whitespaces)
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
    private static func extract(asset: AVURLAsset, start: Double, seconds: Double) async throws
        -> URL
    {
        let out = FileManager.default.temporaryDirectory
            .appendingPathComponent("demodog-\(UUID().uuidString).m4a")
        let pcm = FileManager.default.temporaryDirectory
            .appendingPathComponent("demodog-\(UUID().uuidString).wav")
        defer { try? FileManager.default.removeItem(at: pcm) }

        guard let source = try await asset.loadTracks(withMediaType: .audio).first else {
            throw NSError(
                domain: "demodog", code: 1,
                userInfo: [NSLocalizedDescriptionKey: "the file has no audio"])
        }

        // 16 kHz mono AAC. Both halves of that are measured rather than
        // assumed, and the second one is genuinely strange: handed the very same
        // audio as uncompressed PCM the recogniser hears "Lead pick the time",
        // and as AAC it hears "Leeds, pick the time" and punctuates it better.
        // Repeated runs of either are identical, so it is the format and not
        // noise. A reader and a writer rather than an export session, because an
        // export session cannot change the sample rate.
        let reader = try AVAssetReader(asset: asset)
        reader.timeRange = CMTimeRange(
            start: CMTime(seconds: start, preferredTimescale: 600),
            duration: CMTime(seconds: seconds, preferredTimescale: 600))
        let readerSettings: [String: Any] = [
            AVFormatIDKey: kAudioFormatLinearPCM,
            AVSampleRateKey: 16000,
            AVNumberOfChannelsKey: 1,
            AVLinearPCMBitDepthKey: 16,
            AVLinearPCMIsFloatKey: false,
            AVLinearPCMIsBigEndianKey: false,
            AVLinearPCMIsNonInterleaved: false,
        ]
        let readerOutput = AVAssetReaderTrackOutput(track: source, outputSettings: readerSettings)
        reader.add(readerOutput)

        let writer = try AVAssetWriter(outputURL: pcm, fileType: .wav)
        let writerInput = AVAssetWriterInput(mediaType: .audio, outputSettings: readerSettings)
        writerInput.expectsMediaDataInRealTime = false
        writer.add(writerInput)

        guard reader.startReading(), writer.startWriting() else {
            throw writer.error ?? reader.error
                ?? NSError(
                    domain: "demodog", code: 2,
                    userInfo: [NSLocalizedDescriptionKey: "cannot read the audio"])
        }
        writer.startSession(atSourceTime: .zero)

        let queue = DispatchQueue(label: "com.fintonlabs.demodog.transcribe")
        await withCheckedContinuation { continuation in
            writerInput.requestMediaDataWhenReady(on: queue) {
                while writerInput.isReadyForMoreMediaData {
                    guard let buffer = readerOutput.copyNextSampleBuffer() else {
                        writerInput.markAsFinished()
                        writer.finishWriting { continuation.resume() }
                        return
                    }
                    writerInput.append(buffer)
                }
            }
        }

        guard writer.status == .completed else {
            throw writer.error
                ?? NSError(
                    domain: "demodog", code: 2,
                    userInfo: [NSLocalizedDescriptionKey: "audio export failed"])
        }

        // Encoded rather than left as PCM, because the recogniser hears the two
        // differently. AVAssetWriter refuses to encode AAC here at all, so the
        // encoding is done by an export session over the resampled file.
        guard
            let session = AVAssetExportSession(
                asset: AVURLAsset(url: pcm), presetName: AVAssetExportPresetAppleM4A)
        else {
            throw NSError(
                domain: "demodog", code: 1,
                userInfo: [NSLocalizedDescriptionKey: "cannot encode the window"])
        }
        session.outputURL = out
        session.outputFileType = .m4a
        await session.export()
        guard session.status == .completed else {
            throw session.error
                ?? NSError(
                    domain: "demodog", code: 2,
                    userInfo: [NSLocalizedDescriptionKey: "audio encode failed"])
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
        locale: String, url: URL, shift: Double, context: String = ""
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
        // Narration over a screen recording is dictation, not a search query or
        // a short command, and saying so changes which language model is used.
        request.taskHint = .dictation

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
