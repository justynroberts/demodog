// MIT License - Copyright (c) fintonlabs.com
import Foundation
import AppKit
import CoreGraphics

/// Captures the global input stream that the recorded video deliberately does
/// not contain: where the cursor was, when it was pressed, what it scrolled,
/// which window came forward.
///
/// Two independent mechanisms run together, because neither alone is enough:
///
///  * A high-rate **poll** (`sampleHz`) reads the cursor position and the
///    physical button state. This needs no permissions, never misses a sample,
///    and gives an evenly spaced track — which is what the smoothing filter
///    downstream wants.
///  * **Global monitors** add the things a poll cannot infer: scroll deltas,
///    click counts (double/triple), and modifier keys.
///
/// Coordinates are emitted in the captured surface's *pixel* space, with the
/// origin at its top-left, so the renderer can use them directly as texture
/// coordinates with no further conversion.
final class InputTracker {
    struct Space {
        /// Global top-left origin of the captured surface, in points.
        var originX: Double
        var originY: Double
        /// Size of the captured surface in points.
        var width: Double
        var height: Double
        /// Points -> pixels.
        var scale: Double
    }

    private let writer: JSONLWriter
    private var space: Space
    private let sampleHz: Double
    private let trackKeys: Bool

    private var timer: DispatchSourceTimer?
    private var monitors: [Any] = []
    private var keyTap: CFMachPort?

    private var lastPoint: CGPoint = .zero
    private var lastButtons: [Bool] = [false, false, false]
    private var lastCursorName: String = ""
    private var lastFrontApp: String = ""

    init(writer: JSONLWriter, space: Space, sampleHz: Double, trackKeys: Bool) {
        self.writer = writer
        self.space = space
        self.sampleHz = sampleHz
        self.trackKeys = trackKeys
    }

    /// Recomputes the mapping when recording a window that the user moves
    /// mid-recording.
    func updateSpace(_ space: Space) {
        self.space = space
    }

    // MARK: - Coordinate mapping

    private func toCapture(_ global: CGPoint) -> (x: Double, y: Double) {
        (
            x: (global.x - space.originX) * space.scale,
            y: (global.y - space.originY) * space.scale
        )
    }

    // MARK: - Lifecycle

    func start() {
        startPolling()
        startMonitors()
        startFrontAppTracking()
        if trackKeys { startKeyTap() }
    }

    func stop() {
        timer?.cancel()
        timer = nil
        for m in monitors { NSEvent.removeMonitor(m) }
        monitors.removeAll()
        if let tap = keyTap {
            CGEvent.tapEnable(tap: tap, enable: false)
            keyTap = nil
        }
        NSWorkspace.shared.notificationCenter.removeObserver(self)
    }

    // MARK: - Polling

    private func startPolling() {
        let t = DispatchSource.makeTimerSource(queue: DispatchQueue.global(qos: .userInteractive))
        t.schedule(deadline: .now(), repeating: 1.0 / sampleHz, leeway: .milliseconds(1))
        t.setEventHandler { [weak self] in self?.sample() }
        t.resume()
        timer = t
    }

    private func sample() {
        // CGEvent's location is already in global top-left coordinates, which
        // saves flipping NSEvent.mouseLocation against the primary screen.
        guard let point = CGEvent(source: nil)?.location else { return }
        let h = hostSeconds()

        if point != lastPoint {
            let p = toCapture(point)
            writer.write(["h": h, "k": "m", "x": p.x, "y": p.y])
            lastPoint = point
        }

        // Physical button state needs no accessibility grant, so this is the
        // reliable edge detector; the global monitor only enriches it.
        let buttons: [CGMouseButton] = [.left, .right, .center]
        for (i, button) in buttons.enumerated() {
            let down = CGEventSource.buttonState(.combinedSessionState, button: button)
            if down != lastButtons[i] {
                lastButtons[i] = down
                let p = toCapture(point)
                writer.write([
                    "h": h,
                    "k": down ? "down" : "up",
                    "b": i,
                    "x": p.x,
                    "y": p.y,
                ])
            }
        }

        sampleCursorShape(h: h)
    }

    /// We swap recorded cursors for crisp vector versions, so we need to know
    /// *which* cursor was showing. `currentSystem` is best-effort from a
    /// background process and Apple has it slated to return nil in a future
    /// release, so the renderer treats a missing shape as a plain arrow.
    private func sampleCursorShape(h: Double) {
        guard let current = NSCursor.currentSystem else { return }
        let name = Self.classify(current)
        if name != lastCursorName {
            lastCursorName = name
            writer.write(["h": h, "k": "cursor", "name": name])
        }
    }

    private static let knownCursors: [(String, NSCursor)] = [
        ("arrow", .arrow),
        ("iBeam", .iBeam),
        ("pointingHand", .pointingHand),
        ("openHand", .openHand),
        ("closedHand", .closedHand),
        ("crosshair", .crosshair),
        ("resizeLeftRight", .resizeLeftRight),
        ("resizeUpDown", .resizeUpDown),
        ("operationNotAllowed", .operationNotAllowed),
        ("dragCopy", .dragCopy),
        ("contextualMenu", .contextualMenu),
        ("disappearingItem", .disappearingItem),
        ("iBeamCursorForVerticalLayout", .iBeamCursorForVerticalLayout),
    ]

    private static func classify(_ cursor: NSCursor) -> String {
        let data = cursor.image.tiffRepresentation
        for (name, known) in knownCursors {
            if known.image.tiffRepresentation == data { return name }
        }
        return "arrow"
    }

    // MARK: - Global monitors

    private func startMonitors() {
        let mask: NSEvent.EventTypeMask = [
            .scrollWheel, .leftMouseDown, .rightMouseDown, .otherMouseDown,
        ]
        if let m = NSEvent.addGlobalMonitorForEvents(matching: mask, handler: { [weak self] event in
            self?.handle(event)
        }) {
            monitors.append(m)
        }
    }

    private func handle(_ event: NSEvent) {
        let h = hostSeconds()
        guard let point = CGEvent(source: nil)?.location else { return }
        let p = toCapture(point)

        switch event.type {
        case .scrollWheel:
            writer.write([
                "h": h, "k": "scroll",
                "dx": event.scrollingDeltaX, "dy": event.scrollingDeltaY,
                "x": p.x, "y": p.y,
            ])
        case .leftMouseDown, .rightMouseDown, .otherMouseDown:
            // Click count is what distinguishes a double-click zoom from two
            // separate ones; the poll cannot see it.
            writer.write([
                "h": h, "k": "click",
                "b": event.buttonNumber,
                "count": event.clickCount,
                "x": p.x, "y": p.y,
            ])
        default:
            break
        }
    }

    // MARK: - Frontmost window

    /// Used by the auto-zoom engine: switching apps is a strong signal that the
    /// region of interest just moved, and gives us a rect to frame.
    private func startFrontAppTracking() {
        NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didActivateApplicationNotification,
            object: nil,
            queue: .main
        ) { [weak self] note in
            guard
                let self,
                let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
            else { return }
            self.emitFrontWindow(for: app)
        }
        if let app = NSWorkspace.shared.frontmostApplication {
            emitFrontWindow(for: app)
        }
    }

    private func emitFrontWindow(for app: NSRunningApplication) {
        let name = app.localizedName ?? "?"
        guard name != lastFrontApp else { return }
        lastFrontApp = name

        var payload: [String: Any] = [
            "h": hostSeconds(),
            "k": "app",
            "app": name,
            "bundleId": app.bundleIdentifier ?? "",
        ]

        // CGWindowList gives us the frontmost window's rect without needing
        // accessibility; good enough to frame a zoom on.
        if let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] {
            for entry in list {
                guard
                    let pid = entry[kCGWindowOwnerPID as String] as? pid_t,
                    pid == app.processIdentifier,
                    let layer = entry[kCGWindowLayer as String] as? Int, layer == 0,
                    let boundsDict = entry[kCGWindowBounds as String] as? [String: Any],
                    let rect = CGRect(dictionaryRepresentation: boundsDict as CFDictionary)
                else { continue }
                let tl = toCapture(rect.origin)
                payload["x"] = tl.x
                payload["y"] = tl.y
                payload["w"] = rect.width * space.scale
                payload["h_px"] = rect.height * space.scale
                payload["title"] = entry[kCGWindowName as String] as? String ?? ""
                break
            }
        }
        writer.write(payload)
    }

    // MARK: - Keystrokes (optional, needs Accessibility)

    private func startKeyTap() {
        let mask = (1 << CGEventType.keyDown.rawValue) | (1 << CGEventType.flagsChanged.rawValue)
        guard let tap = CGEvent.tapCreate(
            tap: .cgSessionEventTap,
            place: .headInsertEventTap,
            options: .listenOnly,
            eventsOfInterest: CGEventMask(mask),
            callback: { _, type, event, refcon in
                guard let refcon else { return Unmanaged.passUnretained(event) }
                let tracker = Unmanaged<InputTracker>.fromOpaque(refcon).takeUnretainedValue()
                tracker.handleKey(type: type, event: event)
                return Unmanaged.passUnretained(event)
            },
            userInfo: Unmanaged.passUnretained(self).toOpaque()
        ) else {
            // No Accessibility grant. The recording is still fine — only the
            // keystroke overlay is unavailable.
            emit(["event": "warning", "code": "no-accessibility"])
            return
        }
        keyTap = tap
        let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
        CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)
    }

    private func handleKey(type: CGEventType, event: CGEvent) {
        guard type == .keyDown else { return }
        let flags = event.flags
        var mods: [String] = []
        if flags.contains(.maskCommand) { mods.append("cmd") }
        if flags.contains(.maskAlternate) { mods.append("alt") }
        if flags.contains(.maskControl) { mods.append("ctrl") }
        if flags.contains(.maskShift) { mods.append("shift") }

        let keyCode = event.getIntegerValueField(.keyboardEventKeycode)

        // Only surface actual shortcuts — logging every keystroke of a typed
        // password would be indefensible for a screen recorder.
        guard !mods.isEmpty else { return }

        var chars = ""
        var length = 0
        var buffer = [UniChar](repeating: 0, count: 4)
        event.keyboardGetUnicodeString(maxStringLength: 4, actualStringLength: &length, unicodeString: &buffer)
        if length > 0 { chars = String(utf16CodeUnits: buffer, count: length) }

        writer.write([
            "h": hostSeconds(),
            "k": "key",
            "code": keyCode,
            "mods": mods,
            "chars": chars.uppercased(),
        ])
    }
}
