// MIT License - Copyright (c) fintonlabs.com
import Foundation
import CoreMedia

/// Monotonic host clock, in seconds. Every timestamp the helper emits — cursor
/// samples, clicks, video frame PTS — is expressed on this one clock so the
/// renderer can align input events against video frames without guessing.
@inline(__always)
func hostSeconds() -> Double {
    CMClockGetTime(CMClockGetHostTimeClock()).seconds
}

/// Line-buffered JSONL writer. Used for the event stream; flushed on every
/// write so a crashed recording still yields usable input data.
final class JSONLWriter {
    private let handle: FileHandle
    private let queue = DispatchQueue(label: "finscreen.jsonl")

    init?(path: String) {
        FileManager.default.createFile(atPath: path, contents: nil)
        guard let h = FileHandle(forWritingAtPath: path) else { return nil }
        handle = h
    }

    func write(_ dict: [String: Any]) {
        queue.async { [handle] in
            guard
                let data = try? JSONSerialization.data(withJSONObject: dict, options: [.withoutEscapingSlashes]),
                var line = String(data: data, encoding: .utf8)
            else { return }
            line += "\n"
            try? handle.write(contentsOf: Data(line.utf8))
        }
    }

    func close() {
        queue.sync { try? handle.close() }
    }
}

/// Emits a single JSON object on stdout. This is the helper's control channel
/// back to the Electron main process.
func emit(_ dict: [String: Any]) {
    guard
        let data = try? JSONSerialization.data(withJSONObject: dict, options: [.withoutEscapingSlashes]),
        let line = String(data: data, encoding: .utf8)
    else { return }
    print(line)
    fflush(stdout)
}

func fail(_ message: String) -> Never {
    emit(["event": "error", "message": message])
    exit(1)
}

func writeJSON(_ dict: [String: Any], to path: String) {
    guard let data = try? JSONSerialization.data(
        withJSONObject: dict,
        options: [.prettyPrinted, .withoutEscapingSlashes]
    ) else { return }
    try? data.write(to: URL(fileURLWithPath: path))
}

struct Args {
    private var flags: [String: String] = [:]
    let positional: [String]

    init(_ argv: [String]) {
        var pos: [String] = []
        var i = 0
        while i < argv.count {
            let a = argv[i]
            if a.hasPrefix("--") {
                let key = String(a.dropFirst(2))
                if i + 1 < argv.count && !argv[i + 1].hasPrefix("--") {
                    flags[key] = argv[i + 1]
                    i += 2
                } else {
                    flags[key] = "1"
                    i += 1
                }
            } else {
                pos.append(a)
                i += 1
            }
        }
        positional = pos
    }

    func string(_ key: String) -> String? { flags[key] }
    func int(_ key: String) -> Int? { flags[key].flatMap { Int($0) } }
    func bool(_ key: String, default def: Bool) -> Bool {
        guard let v = flags[key] else { return def }
        return v == "1" || v == "true" || v == "yes"
    }
}
