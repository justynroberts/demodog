// MIT License - Copyright (c) fintonlabs.com
//
// demodog-recorder — the native capture layer for DemoDog.
//
//   demodog-recorder list
//   demodog-recorder permissions [--request]
//   demodog-recorder transcribe --audio <file> [--locale en-GB]
//   demodog-recorder record --out <dir> [--display <id> | --window <id>]
//                             [--fps 60] [--cursor 0] [--audio 1] [--keys 0]
//                             [--max-width 3840]
//
// Speaks JSON on stdout, one object per line. `record` runs until it reads
// "stop" on stdin or receives SIGINT/SIGTERM, then finalises the movie and
// writes meta.json alongside events.jsonl.

import Foundation
import AppKit

let argv = Array(CommandLine.arguments.dropFirst())
let args = Args(argv)
let command = args.positional.first ?? "help"

// A CLI that uses AppKit still needs an initialised NSApplication for global
// event monitors and NSCursor to work. `.prohibited` keeps it off the Dock.
let app = NSApplication.shared
app.setActivationPolicy(.prohibited)

/// One-shot commands talk to `replayd`, which can wedge. A process that hangs
/// there keeps a capture connection open and poisons every later attempt to
/// start a stream, so never let one linger.
func startWatchdog(seconds: Double, label: String) {
    let timer = DispatchSource.makeTimerSource(queue: .global())
    timer.schedule(deadline: .now() + seconds)
    timer.setEventHandler {
        emit(["event": "error", "code": "timeout", "message": "\(label) timed out"])
        exit(3)
    }
    timer.resume()
    signalWatchdogs.append(timer)
}

switch command {
case "list":
    startWatchdog(seconds: 8, label: "list")
    Task { await SourceLister.run() }
    RunLoop.main.run()

case "permissions":
    startWatchdog(seconds: 8, label: "permissions")
    Permissions.check(requesting: args.bool("request", default: false))

case "transcribe":
    guard let audio = args.string("audio") else {
        fail("--audio <file> is required")
    }
    // No watchdog. Recognition is genuinely slow the first time a locale is
    // used, because macOS downloads the on-device model before it can start,
    // and killing it halfway leaves the user with nothing and no explanation.
    Task { await Transcriber.run(audioPath: audio, locale: args.string("locale") ?? "en-GB") }
    RunLoop.main.run()

case "transcribe-window":
    // The child of `transcribe`: one clip, one process, times from zero.
    guard let audio = args.string("audio") else {
        fail("--audio <file> is required")
    }
    Task {
        await Transcriber.runWindow(
            audioPath: audio,
            locale: args.string("locale") ?? "en-GB",
            context: args.string("context") ?? "")
    }
    RunLoop.main.run()

case "record":
    guard let outputDir = args.string("out") else {
        fail("--out <dir> is required")
    }

    let options = CaptureSession.Options(
        outputDir: outputDir,
        fps: args.int("fps") ?? 60,
        // Default OFF. The whole point is to re-draw the cursor ourselves.
        showsCursor: args.bool("cursor", default: false),
        captureSystemAudio: args.bool("audio", default: true),
        trackKeys: args.bool("keys", default: false),
        displayID: args.int("display").map { CGDirectDisplayID($0) },
        windowID: args.int("window").map { CGWindowID($0) },
        cropRect: nil,
        maxPixelWidth: args.int("max-width"),
        excludePids: (args.string("exclude-pids") ?? "")
            .split(separator: ",")
            .compactMap { pid_t($0) }
    )

    let session = CaptureSession(options: options)

    // Signals are delivered on a dispatch source rather than a C handler so we
    // can run the async teardown that flushes the movie header.
    for sig in [SIGINT, SIGTERM] {
        signal(sig, SIG_IGN)
        let source = DispatchSource.makeSignalSource(signal: sig, queue: .main)
        source.setEventHandler { Task { await session.finish() } }
        source.resume()
        signalSources.append(source)
    }

    // Electron cannot send a signal cleanly on every platform path, so "stop"
    // on stdin is the primary control channel.
    DispatchQueue.global(qos: .utility).async {
        while let line = readLine(strippingNewline: true) {
            if line == "stop" || line == "quit" {
                Task { await session.finish() }
                return
            }
        }
        // stdin closed — the parent went away, so do not leave a stray
        // recording process holding the screen capture grant.
        Task { await session.finish() }
    }

    Task { await session.start() }
    RunLoop.main.run()

default:
    emit([
        "event": "help",
        "commands": ["list", "permissions", "record"],
        "usage": "demodog-recorder record --out <dir> [--display <id>|--window <id>] [--fps 60] [--cursor 0] [--audio 1] [--keys 0]",
    ])
    exit(command == "help" ? 0 : 1)
}
