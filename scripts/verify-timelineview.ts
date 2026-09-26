// MIT License - Copyright (c) fintonlabs.com
/**
 * What the timeline is showing, and what an edge catches on.
 *
 * The timeline used to show the whole take at a fixed scale, where a second of
 * a two-minute recording is a few pixels. These check the arithmetic that lets
 * it show a window instead — which has to be exactly right, because every
 * error in it is an edit landing somewhere other than where it looked.
 */
import {
  MIN_SPAN,
  centreOn,
  clamp,
  fit,
  follow,
  isFitted,
  panBy,
  snap,
  span,
  ticks,
  timeLabel,
  zoomAt
} from '../src/renderer/src/editor/timelineView'

let failures = 0
function check(ok: boolean, label: string, detail = ''): void {
  console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${label}${detail ? `  \x1b[2m${detail}\x1b[0m` : ''}`)
  if (!ok) failures++
}
const near = (a: number, b: number, tol = 1e-6): boolean => Math.abs(a - b) <= tol

/** A two-minute take with a three-second intro card in front of it. */
const bounds = { start: -3, end: 120 }
const whole = fit(bounds)

console.log('\nTimeline view')

// ---- zooming about a point ---------------------------------------------------
{
  const view = zoomAt(whole, bounds, 4, 0.25)
  const under = bounds.start + span(whole) * 0.25
  check(near(span(view), span(whole) / 4), 'zooming in by four shows a quarter as much', `${span(view).toFixed(1)}s`)
  check(near(view.start + span(view) * 0.25, under), 'the moment under the pointer stays under the pointer')
  const back = zoomAt(view, bounds, 1 / 4, 0.25)
  check(near(span(back), span(whole)) && isFitted(back, bounds), 'and zooming back out returns to the whole take')
}
{
  let view = whole
  for (let i = 0; i < 40; i++) view = zoomAt(view, bounds, 2, 0.5)
  check(near(span(view), MIN_SPAN), 'zooming in forever stops somewhere useful', `${span(view).toFixed(2)}s`)
  check(view.start >= bounds.start - 1e-9 && view.end <= bounds.end + 1e-9, 'and never leaves the take')
  let out = view
  for (let i = 0; i < 40; i++) out = zoomAt(out, bounds, 2, 1)
  check(out.end <= bounds.end + 1e-9, 'zooming in at the very end stays inside it', `${out.end.toFixed(2)}`)
}
{
  const tiny = { start: 0, end: 0.8 }
  const view = zoomAt(fit(tiny), tiny, 8, 0.5)
  check(near(span(view), 0.8), 'a take shorter than the closest zoom is simply shown whole')
}

// ---- panning -------------------------------------------------------------------
{
  const view = zoomAt(whole, bounds, 6, 0.5)
  const moved = panBy(view, bounds, 10)
  check(near(span(moved), span(view)), 'panning does not change how much is shown')
  check(near(moved.start, view.start + 10), 'and moves by what it was asked')
  const past = panBy(view, bounds, 10000)
  check(near(past.end, bounds.end), 'panning past the end stops at the end', `${past.start.toFixed(1)}–${past.end.toFixed(1)}`)
  const before = panBy(view, bounds, -10000)
  check(near(before.start, bounds.start), 'and past the start stops at the start, including the intro card')
}

// ---- following the playhead ------------------------------------------------------
{
  const view = zoomAt(whole, bounds, 10, 0.5)
  const middle = (view.start + view.end) / 2
  check(follow(view, bounds, middle) === view, 'nothing moves while the playhead is in the middle')
  const ahead = follow(view, bounds, view.end - span(view) * 0.01)
  check(ahead.start > view.start, 'the view moves on when the playhead reaches the edge')
  check(ahead.start <= view.end && ahead.end >= view.end, 'and keeps what was just played on screen', `${ahead.start.toFixed(1)}–${ahead.end.toFixed(1)}`)
  check(follow(whole, bounds, 60) === whole, 'a fitted timeline never scrolls: it is all already there')
  const near_end = follow(view, bounds, 119.9)
  check(near_end.end <= bounds.end + 1e-9, 'following to the last second does not scroll past it')
}

// ---- the ruler ---------------------------------------------------------------------
{
  const wide = ticks(whole, 1200)
  const gaps = wide
    .filter((t) => t.major)
    .map((t, i, all) => (i ? Math.round((t.t - all[i - 1].t) * 1e6) / 1e6 : 0))
    .slice(1)
  check(wide.some((t) => t.major), 'the whole take gets labelled marks', `${wide.filter((t) => t.major).length} of them`)
  check(new Set(gaps.map((g) => g.toFixed(6))).size === 1, 'evenly spaced')
  const step = gaps[0]
  check((step * 1200) / span(whole) >= 78, 'and far enough apart to read', `${((step * 1200) / span(whole)).toFixed(0)}px`)

  const close = ticks(zoomAt(whole, bounds, 60, 0.5), 1200)
  const majors = close.filter((t) => t.major)
  const closeStep = Math.round((majors[1].t - majors[0].t) * 1e6) / 1e6
  check(closeStep < step, 'zoomed in, the marks get finer', `${step}s → ${closeStep}s`)
  check([0.04, 0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60].includes(closeStep), 'on divisions a person recognises, never 3.7s', `${closeStep}s`)
  check(close.every((t) => t.t >= close[0].t && t.t <= close[close.length - 1].t), 'and only where they are visible')
  check(timeLabel(64, 1) === '1:04' && timeLabel(4.2, 0.1) === '4.2s', 'labelled as times, not as raw seconds', `${timeLabel(64, 1)} / ${timeLabel(4.2, 0.1)}`)
  check(timeLabel(64.5, 0.5) === '1:04.5', 'a fine mark past a minute keeps the minutes', timeLabel(64.5, 0.5))
  check(ticks({ start: 0, end: 0 }, 1200).length === 0 && ticks(whole, 0).length === 0, 'an impossible view asks for no marks rather than hanging')
}

// ---- snapping -------------------------------------------------------------------
{
  const targets = [
    { t: 10, what: 'playhead' },
    { t: 12.5, what: 'click' },
    { t: 40, what: 'line' }
  ]
  // Zoomed out: a second is about a tenth of a pixel of 1200 across 123s.
  const coarse = span(whole) / 1200
  check(snap(10.04, targets, coarse).t === 10, 'an edge near the playhead lands on it')
  check(snap(10.04, targets, coarse).target?.what === 'playhead', 'and says what it caught on')
  check(snap(11.2, targets, coarse).t === 11.2, 'one that is not near anything is left alone')
  const fine = span(zoomAt(whole, bounds, 60, 0.5)) / 1200
  check(snap(10.04, targets, fine).t === 10.04, 'zoomed right in, the same edge is no longer close enough to catch', `${(fine * 7).toFixed(3)}s tolerance`)
  check(snap(10.001, targets, fine).t === 10, 'but one truly on it still does')
  check(snap(11.3, [{ t: 10, what: 'a' }, { t: 12.5, what: 'b' }], coarse * 40).target?.what === 'b', 'between two targets, the nearer one wins')
  check(snap(5, [], coarse).target === null, 'with nothing to catch on, nothing happens')
}

// ---- clamping is the last word ----------------------------------------------------
{
  const silly = clamp({ start: -500, end: 5000 }, bounds)
  check(isFitted(silly, bounds), 'a view wider than the take is the take')
  const backwards = clamp({ start: 50, end: 10 }, bounds)
  check(backwards.end > backwards.start, 'a backwards view is made sane rather than drawn inside out')
  const centred = centreOn(zoomAt(whole, bounds, 8, 0.5), bounds, 100)
  check(near((centred.start + centred.end) / 2, 100), 'centring puts a moment in the middle')
  check(near((centreOn(zoomAt(whole, bounds, 8, 0.5), bounds, 119).end), bounds.end), 'unless it is at the end, where it stops')
}

console.log(failures ? `\n\x1b[31m${failures} timeline view check(s) failed.\x1b[0m\n` : '\n\x1b[32mTimeline view checks passed.\x1b[0m\n')
process.exit(failures ? 1 : 0)
