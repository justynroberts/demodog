// MIT License - Copyright (c) fintonlabs.com
//
// Reports what the auto-zoom would do to a real take, so tuning is measured
// rather than guessed at.
//
//   npm run zoom-report -- ~/Movies/DemoDog/take_2026-08-15_22-05-59
//
// Prints each generated segment plus the two numbers that decide whether a
// result feels calm or twitchy: how many times the camera returns to 1x, and
// what fraction of the take is spent zoomed.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { parseInput } from '../src/renderer/src/engine/input'
import { generateSegments } from '../src/renderer/src/engine/autozoom'
import { CameraSolver } from '../src/renderer/src/engine/camera'
import { CursorTrack } from '../src/renderer/src/engine/cursorTrack'
import { defaultProject } from '../src/renderer/src/engine/defaults'
import type { CaptureMeta, RawEvent } from '../src/shared/types'
import type { ZoomSettings } from '../src/renderer/src/engine/types'

const dir = process.argv[2] ?? join(homedir(), 'Movies', 'DemoDog', 'fixture')

const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')) as CaptureMeta
const raw: RawEvent[] = readFileSync(join(dir, 'events.jsonl'), 'utf8')
  .split('\n')
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l))

const input = parseInput(raw, meta)
const source = { width: meta.capture.width, height: meta.capture.height }
const base = defaultProject(source)

function report(label: string, zoom: ZoomSettings): void {
  const segments = generateSegments(input, zoom, source, meta.duration)
  const cursor = new CursorTrack(input, meta.duration, base.cursor)
  const solver = new CameraSolver(segments, zoom, cursor, source, 16 / 9)

  // Sample the camera to see how often it actually returns to fully wide, which
  // is what "going in and out" means in practice.
  let releases = 0
  let zoomedFrames = 0
  let total = 0
  let wasWide = true
  for (let t = 0; t < meta.duration; t += 1 / 30) {
    const { scale } = solver.at(t)
    const wide = scale < 1.06
    if (wide && !wasWide) releases++
    wasWide = wide
    if (!wide) zoomedFrames++
    total++
  }

  console.log(`\n${label}`)
  console.log(`  segments        ${segments.length}`)
  console.log(`  returns to 1x   ${releases}`)
  console.log(`  time zoomed     ${Math.round((zoomedFrames / total) * 100)}%`)
  console.log(
    `  zoom every      ${segments.length ? (meta.duration / segments.length).toFixed(1) : '—'}s`
  )
  for (const s of segments) {
    console.log(
      `    ${s.start.toFixed(2)}s → ${s.end.toFixed(2)}s  ${s.scale.toFixed(2)}x  ` +
        `(${Math.round(s.x)}, ${Math.round(s.y)})`
    )
  }

  // The measurement that answers "does it zoom out between shots": across each
  // handover, how far does the scale sag below the two shots either side?
  for (let i = 1; i < segments.length; i++) {
    const prev = segments[i - 1]
    const next = segments[i]
    if (next.start >= prev.end) continue
    let low = Infinity
    for (let t = next.start; t <= prev.end; t += 1 / 60) {
      low = Math.min(low, solver.at(t).scale)
    }
    const floor = Math.min(prev.scale, next.scale)
    const sag = Math.round((1 - low / floor) * 100)
    console.log(
      `    handover ${next.start.toFixed(2)}–${prev.end.toFixed(2)}s: ` +
        `dips to ${low.toFixed(2)}x of ${floor.toFixed(2)}x (${sag}% sag)`
    )
  }
}

console.log(`Take: ${dir}`)
console.log(
  `${meta.duration.toFixed(1)}s · ${input.clicks.length} clicks · ` +
    `${input.scrolls.length} scrolls · ${input.apps.length} app switches`
)

// The settings as they were before tuning, for comparison.
const before: ZoomSettings = {
  ...base.zoom,
  lead: 0.42,
  hold: 1.5,
  mergeGap: 1.1,
  bridgeGap: 0,
  easeIn: 0.75,
  easeOut: 0.85,
  triggers: { ...base.zoom.triggers, dwell: true }
}

report('BEFORE (previous defaults)', before)
report('AFTER (current defaults)', base.zoom)
console.log()
