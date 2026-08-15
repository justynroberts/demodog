// MIT License - Copyright (c) fintonlabs.com
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
      lead: 0.45,
      hold: 1.9,
      mergeGap: 1.8,
      bridgeGap: 2.2,
      easeIn: 0.85,
      easeOut: 0.95,
      follow: 0.42,
      // Dwell is off by default: it is the trigger that most often produces
      // zooms the user did not ask for.
      triggers: { clicks: true, scrolls: true, keys: false, appSwitches: true, dwell: false },
      smoothing: 0.16
    },
    segments: [],
    cursor: {
      visible: true,
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
    clips: [],
    audio: { systemGain: 1, micGain: 1 }
  }
}

export const OUTPUT_PRESETS: { id: string; name: string; width: number; height: number }[] = [
  { id: '1080p', name: '1080p · 16:9', width: 1920, height: 1080 },
  { id: '1440p', name: '1440p · 16:9', width: 2560, height: 1440 },
  { id: '4k', name: '4K · 16:9', width: 3840, height: 2160 },
  { id: 'square', name: 'Square · 1:1', width: 1080, height: 1080 },
  { id: 'vertical', name: 'Vertical · 9:16', width: 1080, height: 1920 },
  { id: 'portrait', name: 'Portrait · 4:5', width: 1080, height: 1350 }
]
