// MIT License - Copyright (c) fintonlabs.com
import { positionAt } from './input'
import type { ParsedInput, ZoomSegment, ZoomSettings } from './types'

interface Moment {
  t: number
  x: number
  y: number
  weight: number
  kind: 'click' | 'scroll' | 'key' | 'app' | 'dwell'
  /** Optional region the moment wants framed, in source pixels. */
  rect?: { x: number; y: number; w: number; h: number }
}

/**
 * Derives zoom segments from what the user actually did.
 *
 * The pipeline is: collect *moments* of interest → cluster moments that happen
 * close together → fit a framing around each cluster. Clustering is what stops
 * a burst of five clicks in a form producing five separate zooms that punch in
 * and out; they become one held shot that covers all five targets.
 */
export function generateSegments(
  input: ParsedInput,
  settings: ZoomSettings,
  source: { width: number; height: number },
  duration: number
): ZoomSegment[] {
  if (!settings.enabled) return []

  const moments = collectMoments(input, settings, source, duration)
  if (moments.length === 0) return []

  const clusters = cluster(moments, settings.mergeGap)
  const segments: ZoomSegment[] = []

  for (const group of clusters) {
    const first = group[0]
    const last = group[group.length - 1]

    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    let sumW = 0
    let cx = 0
    let cy = 0

    for (const m of group) {
      const rect = m.rect ?? { x: m.x, y: m.y, w: 0, h: 0 }
      minX = Math.min(minX, rect.x)
      minY = Math.min(minY, rect.y)
      maxX = Math.max(maxX, rect.x + rect.w)
      maxY = Math.max(maxY, rect.y + rect.h)
      cx += m.x * m.weight
      cy += m.y * m.weight
      sumW += m.weight
    }
    cx /= sumW || 1
    cy /= sumW || 1

    // Leave breathing room around the region of interest — a zoom cropped hard
    // to the click point loses the context that makes the action readable.
    const margin = source.width * 0.15
    const spanW = maxX - minX + margin * 2
    const spanH = maxY - minY + margin * 2
    const fit = Math.min(source.width / spanW, source.height / spanH)
    const scale = clamp(fit, settings.minScale, settings.maxScale)

    if (scale < settings.minScale + 0.001) continue

    const start = Math.max(0, first.t - settings.lead)
    const end = Math.min(duration, last.t + settings.hold)
    if (end - start < 0.5) continue

    segments.push({
      id: `auto-${segments.length}-${Math.round(start * 1000)}`,
      start,
      end,
      easeIn: settings.easeIn,
      easeOut: settings.easeOut,
      scale,
      x: cx,
      y: cy,
      auto: true,
      follow: settings.follow
    })
  }

  return resolveOverlaps(segments)
}

function collectMoments(
  input: ParsedInput,
  settings: ZoomSettings,
  source: { width: number; height: number },
  duration: number
): Moment[] {
  const moments: Moment[] = []
  const t = settings.triggers

  if (t.clicks) {
    for (const click of input.clicks) {
      if (click.t < 0 || click.t > duration) continue
      moments.push({ t: click.t, x: click.x, y: click.y, weight: 1, kind: 'click' })
    }
  }

  if (t.scrolls) {
    // A scroll gesture fires dozens of events; only the start of each burst is
    // an interesting moment.
    let lastT = -Infinity
    for (const scroll of input.scrolls) {
      if (scroll.t - lastT > 0.5) {
        moments.push({ t: scroll.t, x: scroll.x, y: scroll.y, weight: 0.55, kind: 'scroll' })
      }
      lastT = scroll.t
    }
  }

  if (t.keys) {
    let lastT = -Infinity
    for (const key of input.keys) {
      if (key.t - lastT > 0.8) {
        const p = positionAt(input.moves, key.t)
        if (p) moments.push({ t: key.t, x: p.x, y: p.y, weight: 0.5, kind: 'key' })
      }
      lastT = key.t
    }
  }

  if (t.appSwitches) {
    for (const app of input.apps) {
      if (app.t < 0.4 || app.t > duration) continue
      if (!app.rect) continue
      // Clip the window rect to the captured surface — off-screen windows
      // would otherwise drag the framing outside the video.
      const rect = clipRect(app.rect, source)
      if (!rect || rect.w < source.width * 0.12) continue
      moments.push({
        t: app.t,
        x: rect.x + rect.w / 2,
        y: rect.y + rect.h / 2,
        weight: 0.75,
        kind: 'app',
        rect
      })
    }
  }

  if (t.dwell) {
    for (const moment of detectDwell(input)) moments.push(moment)
  }

  moments.sort((a, b) => a.t - b.t)
  return moments
}

/**
 * A fast move that ends in a stop is the user arriving somewhere — usually just
 * before they read or click. Catching it lets the zoom lead the action instead
 * of chasing it.
 */
function detectDwell(input: ParsedInput): Moment[] {
  const moves = input.moves
  const out: Moment[] = []
  if (moves.length < 8) return out

  const travelWindow = 0.5
  const stillWindow = 0.35
  let lastEmit = -Infinity

  for (let i = 0; i < moves.length; i++) {
    const m = moves[i]
    if (m.t - lastEmit < 1.2) continue

    let travelled = 0
    for (let j = i - 1; j >= 0 && m.t - moves[j].t < travelWindow; j--) {
      travelled += Math.hypot(moves[j + 1].x - moves[j].x, moves[j + 1].y - moves[j].y)
    }
    if (travelled < 260) continue

    let moved = 0
    let k = i + 1
    for (; k < moves.length && moves[k].t - m.t < stillWindow; k++) {
      moved = Math.max(moved, Math.hypot(moves[k].x - m.x, moves[k].y - m.y))
    }
    // Needs a real pause afterwards, not just the end of the samples.
    if (k >= moves.length) continue
    if (moved > 14) continue

    out.push({ t: m.t, x: m.x, y: m.y, weight: 0.45, kind: 'dwell' })
    lastEmit = m.t
  }
  return out
}

function cluster(moments: Moment[], gap: number): Moment[][] {
  const groups: Moment[][] = []
  let current: Moment[] = []

  for (const moment of moments) {
    if (current.length === 0) {
      current.push(moment)
      continue
    }
    if (moment.t - current[current.length - 1].t <= gap) current.push(moment)
    else {
      groups.push(current)
      current = [moment]
    }
  }
  if (current.length) groups.push(current)
  return groups
}

/**
 * Clustering works on moment times, so the hold on one segment can run past the
 * lead-in of the next.
 *
 * The obvious fix — fusing them into one segment — is wrong. Averaging two
 * anchors that are half a screen apart produces a single wide shot centred on
 * nothing, and because each fusion extends the segment it cascades: a whole
 * recording collapses into one static zoom. So instead the earlier segment is
 * *trimmed* to hand over, keeping both anchors intact. A deliberate sliver of
 * overlap is left in place, which the camera's envelope blending turns into a
 * move from one framing to the next rather than a cut.
 */
function resolveOverlaps(segments: ZoomSegment[]): ZoomSegment[] {
  const CROSSFADE = 0.3
  const MIN_LENGTH = 0.55

  const out: ZoomSegment[] = []
  for (const segment of segments) {
    const prev = out[out.length - 1]
    if (prev && segment.start < prev.end) {
      prev.end = Math.max(prev.start + MIN_LENGTH, segment.start + CROSSFADE)
      // Ramps cannot outlast the segment they belong to.
      const span = prev.end - prev.start
      prev.easeOut = Math.min(prev.easeOut, span / 2)
      prev.easeIn = Math.min(prev.easeIn, span / 2)
    }
    if (segment.end - segment.start >= MIN_LENGTH) out.push(segment)
  }
  return out
}

function clipRect(
  rect: { x: number; y: number; w: number; h: number },
  source: { width: number; height: number }
): { x: number; y: number; w: number; h: number } | null {
  const x1 = Math.max(0, rect.x)
  const y1 = Math.max(0, rect.y)
  const x2 = Math.min(source.width, rect.x + rect.w)
  const y2 = Math.min(source.height, rect.y + rect.h)
  if (x2 <= x1 || y2 <= y1) return null
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}
