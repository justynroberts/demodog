// MIT License - Copyright (c) fintonlabs.com

/**
 * Which recorded frame belongs to which moment.
 *
 * Kept apart from the decoder so the arithmetic can be checked without one —
 * `npm run verify:frames` runs these against captured-looking timelines.
 */

/**
 * Puts recorded frames back on the beat they were captured to.
 *
 * ScreenCaptureKit is asked for a frame every 1/fps, but it can only hand one
 * over on a display refresh. At 30fps on a 60Hz screen that is every second
 * refresh — except when the interval check lands a hair short, and the frame
 * comes one refresh late, or a hair long, and the next comes one early. Real
 * takes show gaps of 16.7, 33.3 and 50ms where 33.3 was asked for.
 *
 * The exporter used to choose frames by those raw times. Sampled at 60fps the
 * choice then advanced unevenly — hold, advance, advance, hold — on about one
 * frame in twenty, and at 30fps on about one in three: exactly the "jerky"
 * that was reported. The pixels were never the problem; the clock was.
 *
 * So each frame is moved onto the nearest slot of its own nominal rate, never
 * two onto one slot. The move is at most half a frame — 16.7ms at 30fps, well
 * inside what reads as in sync with sound — and a frame genuinely missing from
 * the capture stays missing rather than being papered over by pulling the next
 * one early. A frame that would have to move further than a whole frame keeps
 * its real time, so a long take cannot drift away from its audio.
 */
export function regulariseTimes(times: readonly number[]): number[] {
  if (times.length < 3) return [...times]

  const gaps: number[] = []
  for (let i = 1; i < times.length; i++) {
    const gap = times[i] - times[i - 1]
    if (gap > 0) gaps.push(gap)
  }
  if (gaps.length === 0) return [...times]
  gaps.sort((a, b) => a - b)
  // The median, not the mean: dropped and doubled frames are exactly the
  // outliers the correction exists for, and they must not set the beat.
  const measured = gaps[Math.floor(gaps.length / 2)]
  if (!(measured > 0)) return [...times]
  // Captures are asked for at a whole frame rate. A median taken from float
  // differences is off by a hair, and a hair multiplied by the slot count of a
  // long take is enough to move ties onto the wrong side — tens of thousands of
  // frames in, frames a whole frame out. Snap to the whole rate when it is one.
  const rate = 1 / measured
  const period = Math.abs(rate - Math.round(rate)) < 0.05 * rate ? 1 / Math.round(rate) : measured

  const out: number[] = []
  let previousSlot = -Infinity
  for (const t of times) {
    // Ties go to the earlier slot. A frame one refresh late at 30fps on 60Hz
    // sits exactly halfway between two slots; rounding it up took the next
    // frame's slot and shoved that frame a whole frame later.
    // The margin is in slots, and wide enough to swamp floating-point error
    // deep into a take — a millionth of a frame, a few nanoseconds.
    const nearest = Math.floor(t / period + 0.5 - 1e-6)
    let slot = Math.max(previousSlot + 1, nearest)
    let placed = slot * period
    if (Math.abs(placed - t) > period) {
      // Too far to be the same beat: trust the capture over the grid here.
      slot = Math.max(previousSlot + 1e-6, t / period)
      placed = slot * period
    }
    out.push(placed)
    previousSlot = slot
  }
  return out
}

/**
 * The last frame whose time has arrived by `t`.
 *
 * With frames on a grid, a sample point can sit exactly on a frame boundary —
 * the centre of a 30fps output frame is exactly the start of a 60fps source
 * frame — and floating point then decides which side it falls on, differently
 * from one frame to the next. The small tolerance makes that decision the same
 * every time; without it a 60fps take exported at 30 advanced 1, 3, 2, 1, 3
 * source frames per output frame instead of a steady 2.
 */
export function frameIndexAt(times: readonly number[], t: number): number {
  if (times.length === 0 || t <= times[0]) return 0
  const target = t + 1e-6
  let lo = 0
  let hi = times.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (times[mid] <= target) lo = mid
    else hi = mid - 1
  }
  return lo
}
