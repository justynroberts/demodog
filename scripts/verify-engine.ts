// MIT License - Copyright (c) fintonlabs.com
//
// Numerical check of the zoom and cursor engines against the fixture, whose
// correct answers are known by construction. Screenshots can show that
// *something* moved; this shows it moved to the right place.
//
//   npm run verify

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { parseInput } from '../src/renderer/src/engine/input'
import { generateSegments } from '../src/renderer/src/engine/autozoom'
import { CameraSolver } from '../src/renderer/src/engine/camera'
import { CursorTrack } from '../src/renderer/src/engine/cursorTrack'
import { defaultProject } from '../src/renderer/src/engine/defaults'
import type { CaptureMeta, RawEvent } from '../src/shared/types'

const dir = process.argv[2] ?? join(homedir(), 'Movies', 'DemoDog', 'fixture')

const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')) as CaptureMeta
const raw: RawEvent[] = readFileSync(join(dir, 'events.jsonl'), 'utf8')
  .split('\n')
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l))

const input = parseInput(raw, meta)
const source = { width: meta.capture.width, height: meta.capture.height }
const project = defaultProject(source)

let failures = 0
const check = (name: string, ok: boolean, detail: string): void => {
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name} — ${detail}`)
  if (!ok) failures++
}

console.log(`\nFixture: ${dir}`)
console.log(
  `Parsed: ${input.moves.length} moves, ${input.clicks.length} clicks, ` +
    `${input.scrolls.length} scrolls, ${input.apps.length} app events\n`
)

// ---------------------------------------------------------------------------
console.log('Auto-zoom segments')
const segments = generateSegments(input, project.zoom, source, meta.duration)
for (const s of segments) {
  console.log(
    `  ${s.start.toFixed(2)}s → ${s.end.toFixed(2)}s  scale ${s.scale.toFixed(2)}x  ` +
      `anchor (${Math.round(s.x)}, ${Math.round(s.y)})`
  )
}
check('segments generated', segments.length >= 4, `${segments.length} segments`)
check(
  'all segments zoom in',
  segments.every((s) => s.scale > 1.2),
  `min scale ${Math.min(...segments.map((s) => s.scale)).toFixed(2)}`
)

// ---------------------------------------------------------------------------
console.log('\nCamera framing at each known target')
const cursor = new CursorTrack(input, meta.duration, project.cursor)
const aspect = 16 / 9
const solver = new CameraSolver(segments, project.zoom, cursor, source, aspect)

const expectations = [
  { t: 1.85, name: 'target 1', x: 500, y: 400 },
  { t: 3.35, name: 'target 2', x: 2300, y: 500 },
  { t: 5.4, name: 'target 3', x: 1440, y: 900 },
  { t: 7.5, name: 'target 4', x: 600, y: 1450 },
  { t: 9.1, name: 'target 5', x: 2200, y: 1400 }
]

for (const e of expectations) {
  const cam = solver.at(e.t)
  const vp = cam.viewport
  const inside = e.x >= vp.x && e.x <= vp.x + vp.w && e.y >= vp.y && e.y <= vp.y + vp.h
  // How far off-centre the target sits, as a fraction of the viewport.
  const offX = Math.abs(e.x - (vp.x + vp.w / 2)) / vp.w
  const offY = Math.abs(e.y - (vp.y + vp.h / 2)) / vp.h
  check(
    `${e.name} framed at t=${e.t}`,
    inside && cam.scale > 1.3 && offX < 0.2 && offY < 0.2,
    `scale ${cam.scale.toFixed(2)}x, off-centre ${(offX * 100).toFixed(0)}%/${(offY * 100).toFixed(0)}%`
  )
}

// Zoomed out where nothing is happening.
const idle = solver.at(13.4)
check('rests at 1x when idle', idle.scale < 1.15, `scale ${idle.scale.toFixed(3)}x at t=13.4`)

// ---------------------------------------------------------------------------
console.log('\nCamera motion smoothness')
let maxJump = 0
let prev = solver.at(0)
for (let t = 1 / 60; t < meta.duration; t += 1 / 60) {
  const now = solver.at(t)
  const jump = Math.hypot(
    now.viewport.x + now.viewport.w / 2 - (prev.viewport.x + prev.viewport.w / 2),
    now.viewport.y + now.viewport.h / 2 - (prev.viewport.y + prev.viewport.h / 2)
  )
  maxJump = Math.max(maxJump, jump)
  prev = now
}
// A hard cut between framings would show up as a large per-frame delta.
check('no camera jump cuts', maxJump < 90, `largest per-frame move ${maxJump.toFixed(1)}px`)

// ---------------------------------------------------------------------------
console.log('\nCursor smoothing')
const rawAt = (t: number): { x: number; y: number } => {
  let best = input.moves[0]
  for (const m of input.moves) if (Math.abs(m.t - t) < Math.abs(best.t - t)) best = m
  return best
}

// Tremor should be gone: measure high-frequency energy before and after.
const jitter = (sample: (t: number) => { x: number; y: number }): number => {
  let total = 0
  let n = 0
  for (let t = 0.75; t < 1.45; t += 1 / 120) {
    const a = sample(t - 1 / 120)
    const b = sample(t)
    const c = sample(t + 1 / 120)
    // Second difference isolates jitter from the underlying sweep.
    total += Math.hypot(a.x - 2 * b.x + c.x, a.y - 2 * b.y + c.y)
    n++
  }
  return total / n
}

const rawJitter = jitter(rawAt)
const smoothJitter = jitter((t) => cursor.at(t))
check(
  'tremor removed',
  smoothJitter < rawJitter * 0.35,
  `jitter ${rawJitter.toFixed(2)} → ${smoothJitter.toFixed(2)} px (${Math.round((1 - smoothJitter / rawJitter) * 100)}% reduction)`
)

// The pointer must still land on what it clicked.
let worstClickError = 0
for (const c of input.clicks) {
  const at = cursor.at(c.t)
  worstClickError = Math.max(worstClickError, Math.hypot(at.x - c.x, at.y - c.y))
}
check(
  'lands on click targets',
  worstClickError < 6,
  `worst error ${worstClickError.toFixed(2)}px across ${input.clicks.length} clicks`
)

// Idle fade at the tail.
const tail = cursor.at(13.8)
check('fades when idle', tail.opacity < 0.35, `opacity ${tail.opacity.toFixed(2)} at t=13.8`)

// ---------------------------------------------------------------------------
console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) failed.`}\n`)
process.exit(failures === 0 ? 0 : 1)
