// MIT License - Copyright (c) fintonlabs.com
import AVFoundation
import Foundation
import Speech

/**
 * Transcription on macOS 26 and later.
 *
 * macOS 26 moved speech recognition onto a new framework. The old
 * `SFSpeechRecognizer` still exists there and still reports itself available —
 * and then returns nothing, because the model it wants is an asset that has to
 * be installed and never was. From the outside that is indistinguishable from a
 * silent recording, which is exactly how it was reported: loud audio, no words,
 * no error.
 *
 * So on 26 and later this path is used instead. It differs in three ways that
 * matter:
 *
 * 1. **The model is a download.** `AssetInventory` says whether the language is
 *    installed and installs it if not, which is the actual fault behind "no
 *    speech was heard" on a new Mac. It reports progress because the first run
 *    for a language is a real wait.
 * 2. **A whole file goes in at once.** The old API wanted short clips fed in
 *    sequence, which is why the rest of this file windows and overlaps and then
 *    stitches the results back together. `SpeechAnalyzer` takes an
 *    `AVAudioFile` and returns timed results, so none of that is needed —
 *    no windows, no repeats to trim, no seams.
 * 3. **Times come back attached to the words**, as a `CMTimeRange` per result,
 *    rather than being inferred from where a clip sat in the take.
 *
 * Everything below is guarded by availability and compiled against the macOS 26
 * SDK. It has *not* been run: this machine is on 15.6.1, where the older path
 * is used. The compiler has checked the shapes; nobody has checked the
 * behaviour, and the first real run is the test.
 */
@available(macOS 26.0, *)
enum ModernTranscriber {

    struct Line {
        var start: Double
        var end: Double
        var text: String
    }

    /// Whether this Mac can transcribe the language at all, and if so whether
    /// the model is already here.
    static func availability(locale: Locale) async -> (supported: Bool, installed: Bool) {
        // The framework knows which of its locales a given one corresponds to,
        // which is a better question than string equality: "en-GB" and "en_GB"
        // and a region-less "en" all have to land somewhere sensible.
        guard let matched = await SpeechTranscriber.supportedLocale(equivalentTo: locale) else {
            return (false, false)
        }
        let transcriber = SpeechTranscriber(locale: matched, preset: .transcription)
        let status = await AssetInventory.status(forModules: [transcriber])
        return (true, status == .installed)
    }

    /// The framework's own name for a locale, or nil if it cannot serve it.
    static func resolve(_ locale: Locale) async -> Locale? {
        await SpeechTranscriber.supportedLocale(equivalentTo: locale)
    }

    /**
     * Installs the language model if it is missing.
     *
     * Reported rather than done quietly: on a new Mac this is a download of
     * some hundreds of megabytes, and a transcription that appears to hang for
     * two minutes with no explanation is worse than one that says what it is
     * waiting for.
     */
    static func ensureModel(locale: Locale, onProgress: @escaping (Double) -> Void) async throws {
        let transcriber = SpeechTranscriber(locale: locale, preset: .transcription)
        let status = await AssetInventory.status(forModules: [transcriber])
        guard status != .installed else { return }

        guard let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber])
        else { return }

        let progress = request.progress
        let watcher = Task {
            while !Task.isCancelled {
                onProgress(progress.fractionCompleted)
                try? await Task.sleep(nanoseconds: 400_000_000)
            }
        }
        defer { watcher.cancel() }
        try await request.downloadAndInstall()
    }

    /**
     * The whole file in one pass.
     *
     * `SpeechAnalyzer` reads an `AVAudioFile` and publishes results as it goes,
     * each carrying the range of the recording it covers — so the windowing,
     * overlapping and repeat-trimming the older path needs simply does not
     * apply here, and neither do the seams it leaves behind.
     */
    static func transcribe(
        url: URL, locale: Locale, onProgress: @escaping (Double) -> Void
    ) async throws -> [Line] {
        let transcriber = SpeechTranscriber(locale: locale, preset: .transcription)
        let analyzer = SpeechAnalyzer(modules: [transcriber])

        let file = try AVAudioFile(forReading: url)
        let duration = Double(file.length) / file.fileFormat.sampleRate

        var lines: [Line] = []
        let collector = Task {
            for try await result in transcriber.results {
                // Volatile results are revised as more audio arrives; only the
                // settled ones belong in a transcript.
                guard result.isFinal else { continue }
                let text = String(result.text.characters)
                guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { continue }
                let start = CMTimeGetSeconds(result.range.start)
                let end = CMTimeGetSeconds(result.range.end)
                lines.append(Line(start: start, end: end, text: text))
                if duration > 0 { onProgress(min(1, end / duration)) }
            }
        }

        try await analyzer.start(inputAudioFile: file, finishAfterFile: true)
        try await analyzer.finalizeAndFinishThroughEndOfInput()
        _ = try await collector.value

        return lines.sorted { $0.start < $1.start }
    }
}
