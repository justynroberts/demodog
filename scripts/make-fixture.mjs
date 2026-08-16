// MIT License - Copyright (c) fintonlabs.com
//
// Generates a synthetic take: a video with numbered targets at known
// coordinates, plus an event stream that visits and clicks each one.
//
// This exists because verifying auto-zoom against a real recording is
// guesswork — you cannot tell a correct framing from a plausible one. Here the
// answer is known: at 1.75s the camera must be centred on target 1 at
// (500, 400). Run it, open the take, and the engine is either right or it is not.
//
//   node scripts/make-fixture.mjs [outputDir]

import { execFile } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { homedir } from 'node:os'

const run = promisify(execFile)

const WIDTH = 2880
const HEIGHT = 1800
const FPS = 60
// Long enough that the tail idle exceeds the default 3s cursor-hide delay.
const DURATION = 14
const FIRST_FRAME_HOST = 1000

const TARGETS = [
  { n: 1, x: 500, y: 400 },
  { n: 2, x: 2300, y: 500 },
  { n: 3, x: 1440, y: 900 },
  { n: 4, x: 600, y: 1450 },
  { n: 5, x: 2200, y: 1400 }
]

const out = process.argv[2] ?? join(homedir(), 'Movies', 'DemoDog', 'fixture')

// ---------------------------------------------------------------------------
// Video
// ---------------------------------------------------------------------------

async function buildVideo(path) {
  const font = '/System/Library/Fonts/Supplemental/Arial Bold.ttf'
  const boxSize = 190

  const filters = ['drawgrid=w=160:h=160:t=2:c=0x232733@1.0']
  for (const t of TARGETS) {
    const x = t.x - boxSize / 2
    const y = t.y - boxSize / 2
    filters.push(`drawbox=x=${x}:y=${y}:w=${boxSize}:h=${boxSize}:color=0xD6F534@1.0:t=fill`)
    filters.push(
      `drawbox=x=${x - 14}:y=${y - 14}:w=${boxSize + 28}:h=${boxSize + 28}:color=0x4B2FE3@1.0:t=6`
    )
    filters.push(
      `drawtext=fontfile=${font}:text='${t.n}':fontcolor=0x101014:fontsize=120:` +
        `x=${t.x}-text_w/2:y=${t.y}-text_h/2`
    )
    // Coordinate label, so a frame grab can be checked against the event log.
    filters.push(
      `drawtext=fontfile=${font}:text='${t.x}\\,${t.y}':fontcolor=0x9aa0aa:fontsize=34:` +
        `x=${t.x}-text_w/2:y=${y + boxSize + 26}`
    )
  }

  // A patch of content that changes on *every* frame, composited over the
  // static test card. Top-left, clear of the picture-in-picture, which sits
  // bottom-left by default and hid it completely. This is what makes a frozen export detectable: the rest
  // of the fixture only changes when a target lights up, so an export stuck on
  // one source frame still looked plausible. An earlier attempt used a drawbox
  // with a time expression, which silently never moved — hence a real animated
  // source rather than an expression that has to be trusted.
  await run('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `color=c=0x101014:s=${WIDTH}x${HEIGHT}:d=${DURATION}:r=${FPS}`,
    '-f',
    'lavfi',
    '-i',
    `testsrc2=s=320x180:d=${DURATION}:r=${FPS}`,
    '-filter_complex',
    `[0:v]${filters.join(',')}[card];[card][1:v]overlay=x=40:y=40[out]`,
    '-map',
    '[out]',
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '18',
    '-pix_fmt',
    'yuv420p',
    path
  ])
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

const events = []
const push = (t, obj) => events.push({ h: FIRST_FRAME_HOST + t, ...obj })

const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2)

/**
 * Emits a move from `from` to `to` at 120Hz with a little tremor, so the
 * cursor smoothing has something real to remove.
 */
function moveTo(t0, duration, from, to) {
  const steps = Math.round(duration * 120)
  for (let i = 0; i <= steps; i++) {
    const f = easeInOut(i / steps)
    // Deterministic pseudo-jitter — no Math.random, so runs are reproducible.
    const j = Math.sin(i * 12.9898) * 43758.5453
    const tremor = (j - Math.floor(j) - 0.5) * 5.5
    push(t0 + (i / steps) * duration, {
      k: 'm',
      x: from.x + (to.x - from.x) * f + tremor,
      y: from.y + (to.y - from.y) * f + tremor * 0.8
    })
  }
}

function hold(t0, duration, at) {
  const steps = Math.round(duration * 20)
  for (let i = 0; i <= steps; i++) {
    const j = Math.sin(i * 78.233) * 12345.6789
    const tremor = (j - Math.floor(j) - 0.5) * 2.2
    push(t0 + (i / steps) * duration, { k: 'm', x: at.x + tremor, y: at.y + tremor })
  }
}

function click(t, at, count = 1) {
  push(t, { k: 'down', b: 0, x: at.x, y: at.y })
  push(t, { k: 'click', b: 0, count, x: at.x, y: at.y })
  push(t + 0.08, { k: 'up', b: 0, x: at.x, y: at.y })
}

const [T1, T2, T3, T4, T5] = TARGETS

push(0, { k: 'cursor', name: 'arrow' })
push(0.05, { k: 'app', app: 'Fixture', bundleId: 'com.fintonlabs.fixture' })

hold(0, 0.7, { x: 1200, y: 950 })
moveTo(0.7, 0.8, { x: 1200, y: 950 }, T1)
hold(1.5, 0.6, T1)
click(1.75, T1)

moveTo(2.3, 0.75, T1, T2)
hold(3.05, 0.9, T2)
click(3.2, T2)
click(3.55, T2, 2)

moveTo(4.2, 0.8, T2, T3)
hold(5.0, 1.4, T3)
for (let i = 0; i < 8; i++) {
  push(5.1 + i * 0.07, { k: 'scroll', dx: 0, dy: -22, x: T3.x, y: T3.y })
}

moveTo(6.5, 0.75, T3, T4)
hold(7.25, 0.7, T4)
click(7.4, T4)

moveTo(8.1, 0.8, T4, T5)
hold(8.9, 0.7, T5)
click(9.0, T5)

// Long idle tail, which should trigger the idle cursor fade.
hold(9.7, 4.3, T5)

events.sort((a, b) => a.h - b.h)

// ---------------------------------------------------------------------------

const meta = {
  version: 1,
  mode: 'display',
  display: { id: 1, width: WIDTH / 2, height: HEIGHT / 2, scale: 2, originX: 0, originY: 0 },
  capture: { width: WIDTH, height: HEIGHT, fps: FPS, cursorBurnedIn: false },
  startWallClock: 1780000000,
  startHost: FIRST_FRAME_HOST - 0.1,
  firstFrameHost: FIRST_FRAME_HOST,
  endHost: FIRST_FRAME_HOST + DURATION,
  frames: DURATION * FPS,
  duration: DURATION,
  audio: { system: false }
}

/**
 * A stand-in camera track, so picture-in-picture can be exercised without a
 * webcam. Deliberately 4:3 and animated: the PiP crops to a square, and a
 * static image would hide sync errors.
 *
 * MP4 rather than WebM because that is what the recorder writes now, and the
 * two take different paths through the exporter — MP4 is decoded sequentially,
 * WebM can only be seeked. A fixture on the fallback path would leave the path
 * every real take uses untested.
 */
async function buildCamera(path) {
  await run('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `testsrc2=s=640x480:d=${DURATION}:r=30`,
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=420:duration=${DURATION}`,
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-pix_fmt',
    'yuv420p',
    '-b:v',
    '1M',
    '-c:a',
    'aac',
    '-b:a',
    '96k',
    '-shortest',
    path
  ])
}

await mkdir(out, { recursive: true })
await buildVideo(join(out, 'screen.mp4'))
await buildCamera(join(out, 'camera.mp4'))

// Line the camera up exactly with the screen track's first frame, so any
// visible drift in the editor is a real bug rather than fixture noise.
await writeFile(
  join(out, 'camera.json'),
  JSON.stringify(
    {
      startWallClock: meta.startWallClock + (FIRST_FRAME_HOST - meta.startHost),
      mimeType: 'video/mp4'
    },
    null,
    2
  )
)
await writeFile(join(out, 'events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n')
await writeFile(join(out, 'meta.json'), JSON.stringify(meta, null, 2))

console.log(`fixture written to ${out}`)
console.log(`  ${events.length} events, ${DURATION}s, ${WIDTH}x${HEIGHT}@${FPS}`)
console.log('  expected zoom anchors:')
console.log('    t=1.75  target 1  (500, 400)')
console.log('    t=3.20  target 2  (2300, 500)   [double click at 3.55]')
console.log('    t=5.10  target 3  (1440, 900)   [scroll burst]')
console.log('    t=7.40  target 4  (600, 1450)')
console.log('    t=9.00  target 5  (2200, 1400)')
