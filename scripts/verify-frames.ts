// MIT License - Copyright (c) fintonlabs.com
/**
 * Frame timing: does an export advance through the recording evenly?
 *
 * "Jerky" recordings turned out not to be a capture fault at all but a choice:
 * the exporter picked frames by raw capture times, which ScreenCaptureKit snaps
 * to the display refresh, so the picked frame advanced unevenly. These checks
 * build timelines shaped like real captures — refresh-snapped, with frames a
 * refresh early or late and the odd one genuinely missing — and measure the
 * rhythm an export would produce.
 */
import { frameIndexAt, regulariseTimes } from '../src/renderer/src/engine/frameTiming'

let failures = 0
function check(ok: boolean, label: string, detail = ''): void {
  console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${label}${detail ? `  \x1b[2m${detail}\x1b[0m` : ''}`)
  if (!ok) failures++
}

/** Deterministic, so a failure reproduces. */
function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

/**
 * A capture at `fps` on a display refreshing at `hz`: every frame lands on a
 * refresh, some a refresh early or late, and some never arrive.
 */
function capture(fps: number, hz: number, seconds: number, seed: number, jitter = 0.12, missing = 0.02): number[] {
  const random = rng(seed)
  const refresh = 1 / hz
  const times: number[] = []
  for (let k = 0; k < seconds * fps; k++) {
    if (k > 0 && random() < missing) continue
    let t = Math.round(k / fps / refresh) * refresh
    const r = random()
    if (r < jitter / 2) t -= refresh
    else if (r < jitter) t += refresh
    if (times.length && t <= times[times.length - 1]) t = times[times.length - 1] + refresh
    times.push(Math.max(0, t))
  }
  return times
}

/** Share of output frames that break the steady advance an export should have. */
function unevenness(times: readonly number[], sourceFps: number, outFps: number): number {
  const frames = Math.floor(times[times.length - 1] * outFps)
  const picks: number[] = []
  for (let i = 0; i < frames; i++) picks.push(frameIndexAt(times, (i + 0.5) / outFps))
  const steps = picks.slice(1).map((p, i) => p - picks[i])
  const ratio = sourceFps / outFps
  if (ratio >= 1) {
    const ideal = Math.round(ratio)
    return steps.filter((s) => s !== ideal).length / steps.length
  }
  // Slower source: a strict rhythm of holding and advancing.
  const hold = Math.round(1 / ratio) - 1
  const runs: number[] = []
  let run = 0
  for (const s of steps) {
    if (s === 0) run++
    else {
      runs.push(run)
      run = 0
    }
  }
  return runs.filter((r) => r !== hold).length / Math.max(1, runs.length)
}

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`

/**
 * The same capture with every frame on time but the same frames missing — the
 * most even an export can possibly be, since a frame that never arrived cannot
 * be shown. "Fixed" is judged against this, not against zero.
 */
const ideal = (fps: number, hz: number, seconds: number, seed: number): number[] =>
  capture(fps, hz, seconds, seed, 0)

console.log('\nFrame timing')

// A 30fps capture on a 60Hz display, exported at 60 and at 30 — the reported case.
{
  const raw = capture(30, 60, 60, 7)
  const fixed = regulariseTimes(raw)
  const best = ideal(30, 60, 60, 7)
  const before60 = unevenness(raw, 30, 60)
  const after60 = unevenness(fixed, 30, 60)
  const best60 = unevenness(best, 30, 60)
  const before30 = unevenness(raw, 30, 30)
  const after30 = unevenness(fixed, 30, 30)
  const best30 = unevenness(best, 30, 30)
  check(before30 > best30 * 2, 'the raw capture timeline reproduces the judder at 30fps', `${pct(before30)}, best possible ${pct(best30)}`)
  check(after30 <= best30 + 0.01, 'regularised, a 30fps export is as even as the missing frames allow', `${pct(before30)} → ${pct(after30)} (best ${pct(best30)})`)
  check(after60 <= best60 + 0.01 && after60 <= before60, 'and so is a 60fps export', `${pct(before60)} → ${pct(after60)} (best ${pct(best60)})`)
}

// 60fps on a 120Hz ProMotion display, which snaps every 8.3ms.
{
  const raw = capture(60, 120, 60, 11)
  const fixed = regulariseTimes(raw)
  const before = unevenness(raw, 60, 60)
  const after = unevenness(fixed, 60, 60)
  const best = unevenness(ideal(60, 120, 60, 11), 60, 60)
  check(after <= best + 0.01 && after < before, 'a 60fps capture on a 120Hz display exports as evenly as possible', `${pct(before)} → ${pct(after)} (best ${pct(best)})`)
}

// A perfect 60fps source exported at 30: the frame centre sits exactly on a
// frame boundary, which used to be decided by floating point.
{
  const perfect = Array.from({ length: 600 }, (_, k) => k / 60)
  const fixed = regulariseTimes(perfect)
  const uneven = unevenness(fixed, 60, 30)
  check(uneven === 0, 'a steady 60fps source exported at 30 advances exactly two frames each time', pct(uneven))
  check(unevenness(fixed, 60, 60) === 0, 'and exported at 60, exactly one')
}

// Nothing moves further than half a frame, and nothing drifts over a long take.
{
  const raw = capture(30, 60, 600, 23)
  const fixed = regulariseTimes(raw)
  const worst = Math.max(...raw.map((t, i) => Math.abs(fixed[i] - t)))
  check(worst <= 1 / 30 / 2 + 1e-9, 'no frame moves more than half a frame', `${(worst * 1000).toFixed(1)}ms over a 10-minute take`)
  const end = Math.abs(fixed[fixed.length - 1] - raw[raw.length - 1])
  check(end <= 1 / 30, 'picture and sound are still together at the end of a long take', `${(end * 1000).toFixed(1)}ms`)
  check(fixed.length === raw.length, 'no frame is added or removed')
  check(fixed.every((t, i) => i === 0 || t > fixed[i - 1]), 'frames stay strictly in order')
}

// A frame that genuinely never arrived must not be hidden by pulling the next one early.
{
  const times = [0, 1, 2, 4, 5, 6].map((k) => k / 30)
  const fixed = regulariseTimes(times)
  check(Math.abs(fixed[3] - 4 / 30) < 1e-9, 'a missing frame stays missing rather than being covered up')
}

// A pause far longer than a frame keeps its real time.
{
  const times = [0, 1, 2, 3].map((k) => k / 30).concat([5.0, 5 + 1 / 30])
  const fixed = regulariseTimes(times)
  check(Math.abs(fixed[4] - 5.0) < 1 / 60, 'a long pause is not squeezed onto the grid')
}

console.log(failures ? `\n\x1b[31m${failures} frame timing check(s) failed.\x1b[0m\n` : '\n\x1b[32mFrame timing checks passed.\x1b[0m\n')
process.exit(failures ? 1 : 0)
