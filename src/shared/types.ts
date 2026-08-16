// MIT License - Copyright (c) fintonlabs.com

/** A display the native helper can capture. */
export interface DisplaySource {
  id: number
  name: string
  width: number
  height: number
  pixelWidth: number
  pixelHeight: number
  scale: number
  originX: number
  originY: number
  isPrimary: boolean
}

/** A window the native helper can capture. */
export interface WindowSource {
  id: number
  title: string
  app: string
  bundleId: string
  pid: number
  x: number
  y: number
  width: number
  height: number
  layer: number
  active: boolean
}

export interface Sources {
  displays: DisplaySource[]
  windows: WindowSource[]
}

export interface Permissions {
  screenRecording: boolean
  accessibility: boolean
}

export interface RecordOptions {
  displayId?: number
  windowId?: number
  fps: number
  systemAudio: boolean
  trackKeystrokes: boolean
  maxWidth?: number
  /** Seconds of on-screen countdown before capture begins; 0 disables it. */
  countdown: number
}

/**
 * A saved recording setup, so a repeat session is one click.
 *
 * Devices are stored with both id and label: media device ids are not stable
 * across reboots or replugs, so the label is what makes a preset survive.
 * Windows are matched back by app and title for the same reason — window ids
 * are per-session.
 */
export interface CapturePreset {
  id: string
  name: string
  isDefault?: boolean
  source: { kind: 'display' | 'window'; id: number; label: string; app?: string }
  camera: { deviceId: string; label: string } | null
  mic: { deviceId: string; label: string } | null
  fps: number
  systemAudio: boolean
  keystrokes: boolean
  countdown: number
}

/** A saved set of look-and-feel settings, reusable across recordings. */
export interface Profile {
  id: string
  name: string
  /** Applied automatically to new recordings when true. */
  isDefault?: boolean
  /** A Project minus anything tied to one specific take. */
  settings: Record<string, unknown>
}

/**
 * Raw input events, exactly as the native helper writes them to events.jsonl.
 * `h` is the monotonic host clock; the renderer converts it to a time relative
 * to the first video frame using `meta.firstFrameHost`.
 */
export type RawEvent =
  | { h: number; k: 'm'; x: number; y: number }
  | { h: number; k: 'down' | 'up'; b: number; x: number; y: number }
  | { h: number; k: 'click'; b: number; count: number; x: number; y: number }
  | { h: number; k: 'scroll'; dx: number; dy: number; x: number; y: number }
  | { h: number; k: 'cursor'; name: string }
  | { h: number; k: 'key'; code: number; mods: string[]; chars: string }
  | {
      h: number
      k: 'app'
      app: string
      bundleId: string
      title?: string
      x?: number
      y?: number
      w?: number
      h_px?: number
    }

export interface CaptureMeta {
  version: number
  mode: 'display' | 'window'
  display?: {
    id: number
    width: number
    height: number
    scale: number
    originX: number
    originY: number
  }
  window?: { id: number; title: string; app: string }
  capture: { width: number; height: number; fps: number; cursorBurnedIn: boolean }
  startWallClock: number
  startHost: number
  firstFrameHost: number
  endHost: number
  frames: number
  duration: number
  audio: { system: boolean }
}

/** Sidecar describing the camera track, written next to camera.webm. */
export interface CameraTrack {
  path: string
  startWallClock: number
  mimeType: string
}

/** What the main process hands back once a recording is finalised on disk. */
export interface RecordingResult {
  dir: string
  meta: CaptureMeta
  events: RawEvent[]
  screenPath: string
  duration: number
  /** Present when the take includes a camera recording. */
  camera?: CameraTrack | null
}
