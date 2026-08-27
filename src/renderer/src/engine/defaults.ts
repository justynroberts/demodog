// MIT License - Copyright (c) fintonlabs.com
import { DEFAULT_CAPTION_STYLE } from './captions'
import { DEFAULT_INTRO, DEFAULT_OUTRO } from './titles'
import type { Background, Project } from './types'

export const BACKGROUND_PRESETS: { id: string; name: string; background: Background }[] = [
  {
    id: 'ember',
    name: 'Ember',
    background: {
      kind: 'gradient',
      colors: ['#ff8a3d', '#e0355a', '#5b1a63'],
      angle: 135,
      grain: 0.25
    }
  },
  {
    id: 'acid',
    name: 'Acid',
    background: {
      kind: 'gradient',
      colors: ['#d6f534', '#38c98a', '#0f6b6b'],
      angle: 120,
      grain: 0.2
    }
  },
  {
    id: 'violet',
    name: 'Violet',
    background: {
      kind: 'mesh',
      colors: ['#160e2e', '#4b2fe3', '#a03bd8', '#2b1b6b'],
      angle: 0,
      grain: 0.3
    }
  },
  {
    id: 'slate',
    name: 'Slate',
    background: { kind: 'gradient', colors: ['#33383f', '#14161a'], angle: 160, grain: 0.35 }
  },
  {
    id: 'paper',
    name: 'Paper',
    background: { kind: 'gradient', colors: ['#f3efe6', '#d9d2c4'], angle: 145, grain: 0.45 }
  },
  {
    id: 'ocean',
    name: 'Ocean',
    background: {
      kind: 'mesh',
      colors: ['#04121f', '#0e7490', '#1e3a8a', '#0891b2'],
      angle: 0,
      grain: 0.25
    }
  },
  {
    id: 'ink',
    name: 'Ink',
    background: { kind: 'solid', colors: ['#0b0b0d'], angle: 0, grain: 0.2 }
  },
  {
    id: 'blur',
    name: 'From recording',
    background: {
      kind: 'gradient',
      colors: ['#000', '#000'],
      angle: 0,
      grain: 0.15,
      useWallpaperBlur: true
    }
  }
]

/**
 * Defaults are tuned to look right straight out of the recorder — the point of
 * the app is that you stop recording and it already looks edited.
 */
export function defaultProject(
  source: { width: number; height: number },
  /** Turns the picture-in-picture on when the take has a camera track. */
  hasCamera = false
): Project {
  const aspect = source.width / source.height
  const height = 1080
  const width = Math.round((height * aspect) / 2) * 2

  return {
    output: { width, height, fps: 60 },
    background: { ...BACKGROUND_PRESETS[0].background },
    frame: {
      padding: 0.055,
      radius: 18,
      shadow: { blur: 90, opacity: 0.46, y: 26, spread: 0 },
      border: { width: 1.2, color: 'rgba(255,255,255,0.10)' },
      rotate: 0,
      fitMode: 'contain'
    },
    zoom: {
      enabled: true,
      maxScale: 2.1,
      minScale: 1.25,
      lead: 0.35,
      hold: 1.4,
      mergeGap: 1.8,
      bridgeGap: 1.4,
      openingHold: 1.5,
      maxShot: 7,
      easeIn: 0.85,
      easeOut: 0.95,
      follow: 0.42,
      // Pointer-arrives is on: without it a take driven by mouse movement
      // rather than clicking gets no zooms at all. The calming now comes from
      // the thresholds and from bridging, not from switching triggers off.
      triggers: { clicks: true, scrolls: true, keys: false, appSwitches: true, dwell: true },
      smoothing: 0.16
    },
    segments: [],
    intro: { ...DEFAULT_INTRO },
    outro: { ...DEFAULT_OUTRO },
    captions: [],
    captionStyle: { ...DEFAULT_CAPTION_STYLE },
    cursor: {
      visible: true,
      style: 'dark',
      shape: 'auto',
      size: 1,
      smoothing: 0.62,
      clickAnchoring: true,
      idleHide: 3,
      returnToStart: false,
      clicks: {
        enabled: true,
        ring: true,
        color: 'rgba(255,255,255,0.92)',
        radius: 1,
        duration: 0.55,
        press: true
      },
      spotlight: { enabled: false, radius: 0.3, dim: 0.45 }
    },
    pip: {
      // If you went to the trouble of recording a camera, you want to see it.
      enabled: hasCamera,
      shape: 'circle',
      size: 0.26,
      position: 'bottom-left',
      customX: 0.16,
      customY: 0.8,
      margin: 0.04,
      mirror: true,
      radius: 40,
      border: { width: 3, color: 'rgba(255,255,255,0.9)' },
      shadow: { blur: 60, opacity: 0.4, y: 14 },
      avoidCursor: true,
      zoom: 1,
      offsetX: 0,
      offsetY: 0
    },
    keystrokes: { enabled: false, position: 'bottom', duration: 1.4 },
    // Short enough to read as polish rather than as a transition.
    fade: { in: 0.4, out: 0.6 },
    audio: { systemGain: 1, micGain: 1 },
    music: {
      src: null,
      // Quiet by default. Music under a demo is furniture, not the point, and
      // the commonest mistake is having it compete with the narration.
      gain: 0.18,
      fadeIn: 1.2,
      fadeOut: 2,
      loop: true,
      duckDb: 12,
      duckAttack: 0.25,
      duckRelease: 0.6,
      startAt: 0
    }
  }
}

/**
 * Merges saved settings over the current defaults, key by key.
 *
 * A remembered look is JSON written by whatever version of the app saved it.
 * Spreading it wholesale replaces entire sections, so any setting added later
 * arrives as `undefined` — which is not a cosmetic problem: a missing
 * `openingHold` makes every zoom segment start at NaN and silently disappear.
 * Merging means an old look simply inherits the new defaults for anything it
 * has never heard of.
 */
export function mergeSettings<T>(base: T, saved: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(saved)) {
    return saved === undefined ? base : (saved as T)
  }
  const out: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(saved)) {
    // Only adopt keys the current version actually knows about.
    if (!(key in out)) continue
    out[key] = mergeSettings(out[key], value)
  }
  return out as T
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Where the video is going, rather than what size it is.
 *
 * Each carries the size, frame rate and quality that destination actually
 * wants. The rates are deliberate: platforms that re-encode hard gain nothing
 * from 60fps and only cost upload time, while a screen demo on YouTube is worth
 * the smoother rate.
 */
export interface ExportTarget {
  id: string
  name: string
  hint: string
  width: number
  height: number
  fps: number
  quality: 'good' | 'high' | 'max'
}

export const EXPORT_TARGETS: ExportTarget[] = [
  {
    id: 'youtube-1080',
    name: 'YouTube · 1080p',
    hint: '1920×1080 · 60fps — smooth motion for screen demos',
    width: 1920,
    height: 1080,
    fps: 60,
    quality: 'high'
  },
  {
    id: 'youtube-4k',
    name: 'YouTube · 4K',
    hint: '3840×2160 · 60fps — survives YouTube re-encoding best',
    width: 3840,
    height: 2160,
    fps: 60,
    quality: 'max'
  },
  {
    id: 'shorts',
    name: 'Shorts / Reels / TikTok',
    hint: '1080×1920 vertical · 30fps',
    width: 1080,
    height: 1920,
    fps: 30,
    quality: 'high'
  },
  {
    id: 'linkedin',
    name: 'LinkedIn',
    hint: '1920×1080 · 30fps — plays inline in the feed',
    width: 1920,
    height: 1080,
    fps: 30,
    quality: 'high'
  },
  {
    id: 'x',
    name: 'X / Twitter',
    hint: '1280×720 · 30fps — heavily re-encoded, so keep it small',
    width: 1280,
    height: 720,
    fps: 30,
    quality: 'good'
  },
  {
    id: 'instagram',
    name: 'Instagram feed',
    hint: '1080×1350 portrait · 30fps',
    width: 1080,
    height: 1350,
    fps: 30,
    quality: 'high'
  },
  {
    id: 'slack',
    name: 'Slack / email',
    hint: '1280×720 · 30fps — small enough to attach',
    width: 1280,
    height: 720,
    fps: 30,
    quality: 'good'
  },
  {
    id: 'docs',
    name: 'Docs / web embed',
    hint: '1920×1080 · 30fps — crisp text at a modest size',
    width: 1920,
    height: 1080,
    fps: 30,
    quality: 'good'
  },
  {
    id: 'master',
    name: 'Master · highest quality',
    hint: '2560×1440 · 60fps — for re-editing elsewhere',
    width: 2560,
    height: 1440,
    fps: 60,
    quality: 'max'
  }
]

export const OUTPUT_PRESETS: { id: string; name: string; width: number; height: number }[] = [
  { id: '1080p', name: '1080p · 16:9', width: 1920, height: 1080 },
  { id: '1440p', name: '1440p · 16:9', width: 2560, height: 1440 },
  { id: '4k', name: '4K · 16:9', width: 3840, height: 2160 },
  { id: 'square', name: 'Square · 1:1', width: 1080, height: 1080 },
  { id: 'vertical', name: 'Vertical · 9:16', width: 1080, height: 1920 },
  { id: 'portrait', name: 'Portrait · 4:5', width: 1080, height: 1350 }
]

/**
 * The look of the last take: background, frame, zoom, cursor, camera, and the
 * rest of what makes recordings from one person resemble each other.
 *
 * This is the *only* copy. There were once named profiles beside it, and every
 * bug in this area came from the two disagreeing about which one the next
 * recording should use — a starred profile that was not applied, a look that
 * was applied over the profile someone had just chosen. How the app was left is
 * now the whole of the setting.
 */
const LOOK_KEY = 'demodog-last-look'

/** Everything that describes a look, and nothing that belongs to one take. */
const LOOK_KEYS = [
  'background',
  'frame',
  'zoom',
  'cursor',
  'pip',
  'keystrokes',
  'fade',
  'audio',
  'output',
  'captionStyle',
  'intro',
  'outro',
  // Added late, and its absence was silent: a music bed and its ducking were
  // set up, saved into a profile, and simply not there next time — the profile
  // was fine, the key was never in the list.
  'music'
] as const

/** The subset of a project that is a look, and nothing that is one take. */
export function lookOf(project: Project): Record<string, unknown> {
  const look: Record<string, unknown> = {}
  for (const key of LOOK_KEYS) look[key] = project[key]
  return look
}

export function rememberLook(project: Project): void {
  const look: Record<string, unknown> = {}
  for (const key of LOOK_KEYS) look[key] = project[key]
  try {
    localStorage.setItem(LOOK_KEY, JSON.stringify(look))
  } catch {
    // Not remembering a look is not worth interrupting anyone over.
  }
}

export function rememberedLook(): Record<string, unknown> | null {
  try {
    const stored = localStorage.getItem(LOOK_KEY)
    return stored ? (JSON.parse(stored) as Record<string, unknown>) : null
  } catch {
    return null
  }
}
