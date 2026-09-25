// MIT License - Copyright (c) fintonlabs.com
//
// Subtitles in another language, translated on this Mac.
//
// The narration is still recognised in the language it was spoken in; this
// takes the finished caption lines and translates the text. Apple's Translation
// framework does it on-device — nothing about a recording leaves the machine,
// which is the same promise transcription makes.
//
// Reads a JSON array of `{ "id": …, "text": … }` on stdin and emits one
// `line` event per caption, in order, then `done`.

import AppKit
import Foundation
import SwiftUI

#if canImport(Translation)
    import Translation
#endif

enum Translator {
    struct Line: Decodable {
        let id: String
        let text: String
    }

    /// Languages offered in the app, and what to ask macOS for.
    ///
    /// Held here rather than passed in so an unsupported tag fails as a clear
    /// error instead of a hung translation.
    static let offered = ["nl", "fr", "pt-BR", "es", "de"]

    static func run(to target: String, from source: String) {
        guard #available(macOS 15.0, *) else {
            emit([
                "event": "error", "code": "too-old",
                "message": "translating subtitles needs macOS 15 or later",
            ])
            exit(5)
        }
        #if canImport(Translation)
            let input = FileHandle.standardInput.readDataToEndOfFile()
            let lines = (try? JSONDecoder().decode([Line].self, from: input)) ?? []
            guard !lines.isEmpty else {
                emit(["event": "error", "code": "empty", "message": "no captions to translate"])
                exit(2)
            }
            Engine.start(lines: lines, from: source, to: target)
        #else
            emit([
                "event": "error", "code": "too-old",
                "message": "this build cannot translate subtitles",
            ])
            exit(5)
        #endif
    }
}

#if canImport(Translation)
    @available(macOS 15.0, *)
    enum Engine {
        /// The work, once macOS hands over a session.
        static var lines: [Translator.Line] = []

        static func start(lines input: [Translator.Line], from source: String, to target: String) {
            lines = input
            let from = Locale.Language(identifier: source)
            let to = Locale.Language(identifier: target)

            Task { @MainActor in
                let status = await LanguageAvailability().status(from: from, to: to)
                switch status {
                case .unsupported:
                    emit([
                        "event": "error", "code": "unsupported",
                        "message": "this Mac cannot translate \(source) to \(target)",
                    ])
                    exit(5)
                case .supported:
                    // Supported by this Mac, but not downloaded yet. macOS asks
                    // first, with a sheet of its own that needs a window to
                    // hang from — so one is put on screen saying what is being
                    // waited for. Downloaded once, it is shared by every app.
                    emit(["event": "downloading", "language": target])
                    present(from: from, to: to, asking: true)
                default:
                    present(from: from, to: to, asking: false)
                }
            }
        }

        @MainActor
        private static func present(from: Locale.Language, to: Locale.Language, asking: Bool) {
            // Offscreen and one pixel across unless macOS has a question. The
            // window exists at all only because macOS 15 hands out a
            // translation session through a SwiftUI view and no other way.
            let size = asking ? CGSize(width: 380, height: 140) : CGSize(width: 1, height: 1)
            let screen = NSScreen.main?.frame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
            let origin =
                asking
                ? CGPoint(x: screen.midX - size.width / 2, y: screen.midY - size.height / 2)
                : CGPoint(x: -20000, y: -20000)
            let window = NSWindow(
                contentRect: NSRect(origin: origin, size: size),
                styleMask: asking ? [.titled] : [.borderless],
                backing: .buffered,
                defer: false)
            window.title = "DemoDog — subtitles"
            window.contentView = NSHostingView(rootView: Host(from: from, to: to, asking: asking))
            if asking {
                window.orderFrontRegardless()
                NSApplication.shared.activate(ignoringOtherApps: true)
            } else {
                window.orderBack(nil)
            }
            held = window
        }

        /// Kept alive: a window that goes out of scope takes the session with it.
        private static var held: NSWindow?

        /// The only way macOS 15 hands out a translation session is through a
        /// SwiftUI view, so there is a SwiftUI view. It draws nothing.
        struct Host: View {
            let from: Locale.Language
            let to: Locale.Language
            let asking: Bool
            @State private var config: TranslationSession.Configuration?

            var body: some View {
                Group {
                    if asking {
                        VStack(spacing: 8) {
                            Text("Subtitles need this language")
                                .font(.headline)
                            Text(
                                "macOS downloads it once and shares it with every app. "
                                    + "Nothing about your recording is sent anywhere."
                            )
                            .font(.caption)
                            .multilineTextAlignment(.center)
                            .foregroundStyle(.secondary)
                        }
                        .padding(20)
                    } else {
                        Color.clear
                    }
                }
                .translationTask(config) { session in
                    await translate(with: session)
                }
                .onAppear { config = .init(source: from, target: to) }
            }
        }

        private static func translate(with session: TranslationSession) async {
            do {
                try await session.prepareTranslation()
                let requests = lines.enumerated().map {
                    TranslationSession.Request(sourceText: $1.text, clientIdentifier: "\($0)")
                }
                // Asked for in one batch and matched back by position: the
                // replies do not necessarily arrive in the order they were sent,
                // and a subtitle on the wrong line is worse than none.
                let replies = try await session.translations(from: requests)
                var byIndex: [Int: String] = [:]
                for reply in replies {
                    if let at = Int(reply.clientIdentifier ?? "") { byIndex[at] = reply.targetText }
                }
                var done = 0
                for (at, line) in lines.enumerated() {
                    guard let text = byIndex[at] else { continue }
                    emit(["event": "line", "id": line.id, "text": text])
                    done += 1
                }
                emit(["event": "done", "lines": done, "of": lines.count])
                exit(done == 0 ? 5 : 0)
            } catch {
                emit([
                    "event": "error", "code": "failed",
                    "message": "\(error.localizedDescription)",
                ])
                exit(5)
            }
        }
    }
#endif
