// MIT License - Copyright (c) fintonlabs.com
/**
 * Builds a DemoDog take from a written description rather than a recording.
 *
 * A take is only ever three things: a video, a stream of input events on a
 * shared clock, and some geometry. Nothing in the engine cares whether a human
 * produced them — the auto-zoom reads clicks, the cursor is drawn from samples,
 * and `render(ctx, t)` is a pure function either way. So a walkthrough driven
 * by a browser automation tool can become a take, and gets the zooms, the
 * smoothed cursor, the click rings and the captions for free.
 *
 *     npm run author -- walkthrough.json
 *     npm run walkthrough -- walkthrough.json     # author, then export
 *
 * The spec:
 *
 *     {
 *       "video": "run.webm",              // what the automation recorded
 *       "out":   "~/Movies/DemoDog/x.demodog",
 *       "fps": 60,
 *       "actions": [
 *         { "t": 0.8, "type": "move",   "x": 640, "y": 380 },
 *         { "t": 1.4, "type": "click",  "x": 640, "y": 380 },
 *         { "t": 3.0, "type": "scroll", "x": 700, "y": 500, "dy": -420 },
 *         { "t": 5.0, "type": "app",    "name": "Safari" }
 *       ],
 *       "project": { "captions": [ ... ], "music": { ... } }
 *     }
 *
 * Coordinates are in the video's own pixels. Times are seconds from its first
 * frame.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

const expand = (p) => (p.startsWith('~') ? join(homedir(), p.slice(1)) : resolve(p))

function run(command, args) {
  return new Promise((done, fail) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.on('error', fail)
    child.on('close', (code) => (code === 0 ? done(out) : fail(new Error(err || `${command} failed`))))
  })
}

async function probe(path) {
  const raw = await run('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,duration,r_frame_rate',
    '-show_entries', 'format=duration', '-of', 'json', path
  ])
  const parsed = JSON.parse(raw)
  const stream = parsed.streams?.[0] ?? {}
  const duration = Number(stream.duration || parsed.format?.duration || 0)
  if (!stream.width || !duration) throw new Error(`could not read ${path}`)
  return { width: Number(stream.width), height: Number(stream.height), duration }
}

// ---- the cursor ----------------------------------------------------------

const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2)

/**
 * A hand does not teleport, and automation does.
 *
 * Playwright and its kin jump the pointer straight to a target: two positions,
 * no path. Fed to the engine that reads as an instant snap, because the
 * smoothing filter can only smooth samples it is given. So the path between
 * two actions is invented at the rate a real pointer is sampled, eased at both
 * ends and carrying a little tremor — which is also what the filter downstream
 * was written to remove, so the result moves like a recording rather than like
 * a diagram.
 *
 * Deterministic: the same spec always produces the same take, which is the
 * point of authoring one in the first place.
 */
function tremorAt(i, scale) {
  const j = Math.sin(i * 12.9898) * 43758.5453
  return (j - Math.floor(j) - 0.5) * scale
}

function samplePath(events, base, t0, t1, from, to) {
  const seconds = Math.max(0.001, t1 - t0)
  const steps = Math.max(1, Math.round(seconds * 120))
  const still = Math.hypot(to.x - from.x, to.y - from.y) < 2
  for (let i = 0; i <= steps; i++) {
    const f = easeInOut(i / steps)
    // A pointer at rest still drifts a pixel or two; a moving one wanders more.
    const wobble = still ? 1.2 : 4.5
    events.push({
      h: base + t0 + (i / steps) * seconds,
      k: 'm',
      x: from.x + (to.x - from.x) * f + tremorAt(i, wobble),
      y: from.y + (to.y - from.y) * f + tremorAt(i + 7, wobble * 0.8)
    })
  }
}

/** How long a pointer would plausibly take to cross a distance. */
function travelTime(from, to) {
  const distance = Math.hypot(to.x - from.x, to.y - from.y)
  // Fitts' law in spirit rather than in detail: longer moves take longer, but
  // sub-linearly, and nothing is instant.
  return Math.min(1.1, 0.18 + Math.sqrt(distance) * 0.012)
}

function buildEvents(actions, duration, base, start) {
  const events = []
  events.push({ h: base, k: 'cursor', name: 'arrow' })

  let at = { ...start }
  let last = 0

  for (const action of [...actions].sort((a, b) => a.t - b.t)) {
    const t = Math.max(0, Math.min(duration, Number(action.t) || 0))

    if (action.type === 'app') {
      events.push({ h: base + t, k: 'app', app: String(action.name ?? 'App'), bundleId: String(action.bundleId ?? '') })
      last = Math.max(last, t)
      continue
    }

    const to = { x: Number(action.x ?? at.x), y: Number(action.y ?? at.y) }
    // Arrive *at* the action's time rather than setting off then: a click is
    // timed to the thing on screen, and the pointer has to already be there.
    const travel = travelTime(at, to)
    const departs = Math.max(last, t - travel)
    if (departs > last) samplePath(events, base, last, departs, at, at)
    samplePath(events, base, departs, t, at, to)
    at = to

    if (action.type === 'click' || action.type === 'dblclick') {
      const count = action.type === 'dblclick' ? 2 : Number(action.count ?? 1)
      events.push({ h: base + t, k: 'down', b: 0, x: to.x, y: to.y })
      events.push({ h: base + t, k: 'click', b: 0, count, x: to.x, y: to.y })
      events.push({ h: base + t + 0.08, k: 'up', b: 0, x: to.x, y: to.y })
    } else if (action.type === 'scroll') {
      // Broken into steps: one enormous delta is a jump, and the auto-zoom
      // reads a burst of scrolling as sustained attention on one place.
      const total = Number(action.dy ?? 0)
      const steps = Math.max(1, Math.min(24, Math.round(Math.abs(total) / 60)))
      for (let i = 0; i < steps; i++) {
        events.push({
          h: base + t + i * 0.05,
          k: 'scroll', x: to.x, y: to.y, dx: 0, dy: total / steps
        })
      }
    }
    last = Math.max(last, t + 0.1)
  }

  // Hold to the end, so the pointer does not vanish for the final shot.
  if (last < duration) samplePath(events, base, last, duration, at, at)
  events.sort((a, b) => a.h - b.h)
  return events
}

// ---- the take ------------------------------------------------------------

const FIRST_FRAME_HOST = 1000

export async function author(spec, specDir) {
  const videoIn = expand(spec.video.startsWith('~') || spec.video.startsWith('/') ? spec.video : join(specDir, spec.video))
  if (!existsSync(videoIn)) throw new Error(`no video at ${videoIn}`)

  const out = expand(spec.out ?? join(homedir(), 'Movies/DemoDog', `authored-${basename(videoIn).replace(/\.[^.]+$/, '')}.demodog`))
  await mkdir(out, { recursive: true })

  const info = await probe(videoIn)
  const fps = Number(spec.fps ?? 60)

  // The engine decodes the screen track sequentially, which it can only do for
  // mp4; a webm falls back to seeking and exports far slower. Automation tools
  // record webm, so convert rather than making every later export pay for it.
  const screen = join(out, 'screen.mp4')
  if (videoIn.toLowerCase().endsWith('.mp4')) await copyFile(videoIn, screen)
  else {
    process.stdout.write(`  converting ${basename(videoIn)} to mp4…\n`)
    await run('ffmpeg', ['-v', 'error', '-y', '-i', videoIn, '-c:v', 'libx264', '-preset', 'veryfast',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart', screen])
  }

  const start = spec.cursorStart ?? { x: info.width / 2, y: info.height * 0.75 }
  const events = buildEvents(spec.actions ?? [], info.duration, FIRST_FRAME_HOST, start)

  const meta = {
    version: 1,
    mode: 'display',
    display: { id: 1, width: info.width, height: info.height, scale: 1, originX: 0, originY: 0 },
    capture: { width: info.width, height: info.height, fps, cursorBurnedIn: false },
    startWallClock: 1780000000,
    startHost: FIRST_FRAME_HOST - 0.1,
    firstFrameHost: FIRST_FRAME_HOST,
    endHost: FIRST_FRAME_HOST + info.duration,
    frames: Math.round(info.duration * fps),
    duration: info.duration,
    audio: { system: false },
    authored: true
  }

  await writeFile(join(out, 'events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n')
  await writeFile(join(out, 'meta.json'), JSON.stringify(meta, null, 2))
  if (spec.project) {
    await writeFile(join(out, 'project.json'), JSON.stringify(spec.project, null, 2))
  }

  return { dir: out, duration: info.duration, events: events.length, size: info }
}

// ---- cli -----------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
  const specPath = process.argv[2]
  if (!specPath) {
    console.error('usage: npm run author -- <spec.json>')
    process.exit(2)
  }
  const resolved = expand(specPath)
  const spec = JSON.parse(await readFile(resolved, 'utf8'))
  const result = await author(spec, dirname(resolved))
  console.log(`\n  take:     ${result.dir}`)
  console.log(`  duration: ${result.duration.toFixed(2)}s`)
  console.log(`  events:   ${result.events}`)
  console.log(`  source:   ${result.size.width}x${result.size.height}\n`)
}
