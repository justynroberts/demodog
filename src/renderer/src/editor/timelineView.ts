// MIT License - Copyright (c) fintonlabs.com
/**
 * What part of the take the timeline is showing, and where things snap.
 *
 * The timeline used to show the whole composition, always. On a two-minute
 * recording one second is six pixels, so trimming a caption to the word or
 * ending a zoom on a click was guesswork — the precision was in the data and
 * not on the screen. This is the arithmetic for showing a window of it
 * instead: zooming about a point, panning, keeping the playhead in view, where
 * to put the ruler's marks, and what an edge should snap to.
 *
 * Kept apart from the component because it is the part that can be wrong in
 * ways nobody sees until they are editing to the frame.
 */

/** The visible window, in composition time — which starts before zero when there is an intro. */
export interface View {
  start: number
  end: number
}

/** Everything there is to show: the take plus any title cards. */
export interface Bounds {
  start: number
  end: number
}

/**
 * The closest anyone needs to get: a second and a half across the whole lane.
 *
 * Tight enough to place an edge on a single frame at any sane frame rate, and
 * not so tight that the view is all one caption.
 */
export const MIN_SPAN = 1.5

export function fit(bounds: Bounds): View {
  return { start: bounds.start, end: bounds.end }
}

export function span(view: View): number {
  return view.end - view.start
}

/** Is the whole thing on screen? */
export function isFitted(view: View, bounds: Bounds): boolean {
  return view.start <= bounds.start + 1e-6 && view.end >= bounds.end - 1e-6
}

/**
 * Keeps a window inside what exists, and no smaller than is useful.
 *
 * A window is never allowed to be partly off the end: panning to the end of a
 * take should stop at the end, not drift into empty space where there is
 * nothing to edit and no way back except guessing.
 */
export function clamp(view: View, bounds: Bounds): View {
  const whole = bounds.end - bounds.start
  let length = Math.min(Math.max(span(view), Math.min(MIN_SPAN, whole)), whole)
  if (!Number.isFinite(length) || length <= 0) length = whole
  let start = view.start
  if (start + length > bounds.end) start = bounds.end - length
  if (start < bounds.start) start = bounds.start
  return { start, end: start + length }
}

/**
 * Zooms by `factor` about a point, given as a fraction across the view.
 *
 * The time under the pointer stays under the pointer, which is the difference
 * between zooming *into* something and zooming towards the middle and then
 * hunting for it again.
 */
export function zoomAt(view: View, bounds: Bounds, factor: number, at: number): View {
  const anchor = view.start + span(view) * Math.min(Math.max(at, 0), 1)
  const whole = bounds.end - bounds.start
  const length = Math.min(Math.max(span(view) / factor, Math.min(MIN_SPAN, whole)), whole)
  const before = (anchor - view.start) / span(view)
  return clamp({ start: anchor - length * before, end: anchor - length * before + length }, bounds)
}

export function panBy(view: View, bounds: Bounds, seconds: number): View {
  return clamp({ start: view.start + seconds, end: view.end + seconds }, bounds)
}

/** Centres the view on a moment, as far as the ends allow. */
export function centreOn(view: View, bounds: Bounds, t: number): View {
  const half = span(view) / 2
  return clamp({ start: t - half, end: t + half }, bounds)
}

/**
 * Follows the playhead while it plays, without twitching.
 *
 * Nothing moves while the playhead is in the middle of the view. Once it
 * reaches the edge the window jumps on by most of its width, the way a page
 * turns — a view that scrolls continuously under a moving playhead makes the
 * whole timeline slide about while you are trying to read it.
 */
export function follow(view: View, bounds: Bounds, t: number): View {
  if (isFitted(view, bounds)) return view
  const width = span(view)
  const margin = width * 0.08
  if (t >= view.start + margin && t <= view.end - margin) return view
  if (t < view.start + margin) return clamp({ start: t - width * 0.8, end: t + width * 0.2 }, bounds)
  return clamp({ start: t - width * 0.2, end: t + width * 0.8 }, bounds)
}

/** Steps a ruler can use, in seconds: familiar divisions, never 3.7s. */
const STEPS = [
  0.04, 0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600
]

export interface Tick {
  t: number
  /** Labelled and full height; the rest are minor marks. */
  major: boolean
  label: string
}

/** `1:04`, or `4.25s` when the marks are closer together than a second. */
export function timeLabel(t: number, step: number): string {
  const sign = t < 0 ? '-' : ''
  const at = Math.abs(t)
  if (step < 1) {
    const minutes = Math.floor(at / 60)
    const seconds = at - minutes * 60
    const shown = seconds.toFixed(step < 0.1 ? 2 : 1)
    return minutes > 0 ? `${sign}${minutes}:${seconds < 10 ? '0' : ''}${shown}` : `${sign}${shown}s`
  }
  const minutes = Math.floor(at / 60)
  const seconds = Math.round(at - minutes * 60)
  return `${sign}${minutes}:${String(seconds).padStart(2, '0')}`
}

/**
 * Marks for the ruler: as many as fit legibly, on times a person recognises.
 *
 * `minGap` is in pixels, and is what stops the labels from colliding as the
 * view zooms — the step grows through the familiar divisions until the marks
 * are far enough apart.
 */
export function ticks(view: View, width: number, minGap = 78): Tick[] {
  const length = span(view)
  if (!(length > 0) || !(width > 0)) return []
  const wanted = (length * minGap) / width
  const step = STEPS.find((candidate) => candidate >= wanted) ?? STEPS[STEPS.length - 1]
  const minor = step / (step / 2 >= wanted / 2 ? 2 : 1)
  const out: Tick[] = []
  // Counted rather than accumulated. Adding the step repeatedly drifts — by
  // the tenth minute of a take the marks no longer sit on whole seconds, and
  // none of them counts as major, so the ruler loses its labels.
  const first = Math.ceil(view.start / minor - 1e-9)
  for (let i = first; i * minor <= view.end + 1e-9; i++) {
    const at = Math.round(i * minor * 1e6) / 1e6
    const major = Math.abs(at / step - Math.round(at / step)) < 1e-6
    out.push({ t: at, major, label: major ? timeLabel(at, step) : '' })
  }
  return out
}

/** Somewhere an edge would rather land: the playhead, a cut, another block's edge. */
export interface SnapTarget {
  t: number
  /** Shown while dragging, so it is clear what it caught on. */
  what: string
}

export interface Snap {
  t: number
  target: SnapTarget | null
}

/**
 * Pulls a time onto the nearest interesting one, if it is close enough.
 *
 * Closeness is measured in pixels, not seconds, so snapping feels the same
 * zoomed in as out: a target half a second away is worth catching on a view of
 * the whole take and is an obvious mistake when a second is half the screen.
 */
export function snap(
  t: number,
  targets: SnapTarget[],
  secondsPerPixel: number,
  withinPixels = 7
): Snap {
  const tolerance = secondsPerPixel * withinPixels
  let best: SnapTarget | null = null
  let distance = tolerance
  for (const target of targets) {
    const away = Math.abs(target.t - t)
    if (away <= distance) {
      distance = away
      best = target
    }
  }
  return best ? { t: best.t, target: best } : { t, target: null }
}
