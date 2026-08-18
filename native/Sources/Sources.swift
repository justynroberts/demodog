// MIT License - Copyright (c) fintonlabs.com
import Foundation
import ScreenCaptureKit
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
        let raised = app?.activate(options: [.activateAllWindows]) ?? false
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
