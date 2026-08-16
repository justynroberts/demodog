// MIT License - Copyright (c) fintonlabs.com
import type { CursorTrack } from './cursorTrack'
import type { Rect, ZoomSegment, ZoomSettings } from './types'

export interface CameraState {
  /** Viewport in source pixels, mapped onto the content rect at draw time. */
  viewport: Rect
  scale: number
}

/**
 * The largest rect of the requested aspect that fits inside the source. At
 * scale 1 this *is* the camera viewport, so a 16:9 export of a 16:10 recording
 * frames the whole screen, and a 9:16 export crops to a centred column.
 */
export function baseViewport(source: { width: number; height: number }, aspect: number): Rect {
  const sourceAspect = source.width / source.height
  if (aspect > sourceAspect) {
    const h = source.width / aspect
    return { x: 0, y: (source.height - h) / 2, w: source.width, h }
  }
  const w = source.height * aspect
  return { x: (source.width - w) / 2, y: 0, w, h: source.height }
}

/** Smootherstep — zero first *and* second derivative at both ends. */
function ease(x: number): number {
  const t = Math.min(1, Math.max(0, x))
  return t * t * t * (t * (t * 6 - 15) + 10)
}

function envelope(segment: ZoomSegment, t: number): number {
  if (t <= segment.start || t >= segment.end) return 0
  const half = (segment.end - segment.start) / 2
  const easeIn = Math.min(segment.easeIn, half)
  const easeOut = Math.min(segment.easeOut, half)
  if (easeIn > 0 && t < segment.start + easeIn) return ease((t - segment.start) / easeIn)
  if (easeOut > 0 && t > segment.end - easeOut) return ease((segment.end - t) / easeOut)
  return 1
}

/**
 * Resolves the virtual camera for any point in time.
 *
 * Segments contribute additively through their envelopes, so overlapping zooms
 * hand over smoothly instead of cutting. The result is then run through a
 * short Gaussian window over *time*, which removes the residual kinks where an
 * envelope meets its neighbour without introducing the lag a causal smoother
 * would. Everything is a pure function of `t`, so the preview and the exporter
 * cannot drift apart.
 */
export class CameraSolver {
  private base: Rect
  private taps: { offset: number; weight: number }[]

  constructor(
    private segments: ZoomSegment[],
    settings: ZoomSettings,
    private track: CursorTrack | null,
    source: { width: number; height: number },
    aspect: number
  ) {
    this.base = baseViewport(source, aspect)
    this.taps = buildGaussianTaps(settings.smoothing)
  }

  /** Untimed target: where the camera wants to be at exactly `t`. */
  private target(t: number): { cx: number; cy: number; scale: number } {
    const base = this.base
    let weight = 0
    let cx = 0
    let cy = 0
    let scale = 0

    for (const segment of this.segments) {
      const w = envelope(segment, t)
      if (w <= 0) continue

      let px = segment.x
      let py = segment.y

      // Track the pointer while zoomed in, so the action does not wander out
      // of a tight shot. The anchor still holds the framing together.
      if (segment.follow > 0 && this.track) {
        const cursor = this.track.at(t)
        px += (cursor.x - px) * segment.follow
        py += (cursor.y - py) * segment.follow
      }

      cx += px * w
      cy += py * w
      scale += segment.scale * w
      weight += w
    }

    if (weight <= 0) {
      return { cx: base.x + base.w / 2, cy: base.y + base.h / 2, scale: 1 }
    }

    // Overlapping envelopes can exceed 1; normalise rather than over-zooming.
    const norm = Math.min(1, weight)
    cx /= weight
    cy /= weight
    scale /= weight

    const restX = base.x + base.w / 2
    const restY = base.y + base.h / 2
    return {
      cx: restX + (cx - restX) * norm,
      cy: restY + (cy - restY) * norm,
      scale: 1 + (scale - 1) * norm
    }
  }

  at(t: number): CameraState {
    let cx = 0
    let cy = 0
    let scale = 0
    let total = 0

    for (const tap of this.taps) {
      const s = this.target(Math.max(0, t + tap.offset))
      cx += s.cx * tap.weight
      cy += s.cy * tap.weight
      scale += s.scale * tap.weight
      total += tap.weight
    }
    cx /= total
    cy /= total
    scale /= total

    const base = this.base
    const w = base.w / scale
    const h = base.h / scale

    // Never let the viewport leave the recorded pixels — a zoom that slides
    // past the edge would show background through the frame.
    const minX = base.x + w / 2
    const maxX = base.x + base.w - w / 2
    const minY = base.y + h / 2
    const maxY = base.y + base.h - h / 2

    return {
      scale,
      viewport: {
        x: Math.min(Math.max(cx, minX), maxX) - w / 2,
        y: Math.min(Math.max(cy, minY), maxY) - h / 2,
        w,
        h
      }
    }
  }
}

function buildGaussianTaps(sigma: number): { offset: number; weight: number }[] {
  if (sigma <= 0.001) return [{ offset: 0, weight: 1 }]
  const taps: { offset: number; weight: number }[] = []
  const count = 9
  const span = sigma * 2
  for (let i = 0; i < count; i++) {
    const offset = -span + (2 * span * i) / (count - 1)
    taps.push({ offset, weight: Math.exp(-(offset * offset) / (2 * sigma * sigma)) })
  }
  return taps
}
