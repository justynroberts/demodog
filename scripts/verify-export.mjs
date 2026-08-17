// MIT License - Copyright (c) fintonlabs.com
//
// Exports the fixture for real and checks the result is not frozen.
//
// This exists because an export that produced the same frame for its whole
// length shipped in 0.1.0 with the engine tests passing. `verify-engine`
// checks the zoom and cursor maths, which was correct the whole time — the
// fault was in the reader that turns a time into a source frame, and nothing
// downstream of it was covered at all. A frozen export is also the failure that
// hides best: it finishes quickly, reports every frame written, and produces a
// playable file with working audio.
//
// So the check is deliberately end-to-end and deliberately independent of the
// code under test: run the real exporter, then decode the result with ffmpeg
// and compare frames as an outsider.

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

const FIXTURE = process.env.DEMODOG_FIXTURE ?? join(homedir(), 'Movies', 'DemoDog', 'fixture')
/** Long enough to span several source keyframes, short enough to stay quick. */
const SECONDS = 6
/** Frames sampled from the exported file. */
const SAMPLES = 6

const red = (s) => `\x1b[31m${s}\x1b[0m`
const green = (s) => `\x1b[32m${s}\x1b[0m`

function run(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (out += d))
    const timer = options.timeout
      ? setTimeout(() => {
          child.kill('SIGKILL')
          resolve({ code: 'timeout', out })
        }, options.timeout)
      : null
    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      resolve({ code, out })
    })
  })
}

async function has(command) {
  const { code } = await run('which', [command])
  return code === 0
}

const failures = []
function check(ok, description, detail) {
  console.log(`  ${ok ? green('✓') : red('✗')} ${description}`)
  if (!ok) {
    failures.push(description)
    if (detail) console.log(`      ${detail}`)
  }
}

console.log('\nExport')

if (!existsSync(join(FIXTURE, 'screen.mp4'))) {
  console.log(red(`  no fixture at ${FIXTURE} — run: npm run fixture`))
  process.exit(1)
}
if (!existsSync('out/main/index.js')) {
  console.log(red('  nothing built — run: npm run build'))
  process.exit(1)
}
if (!(await has('ffmpeg'))) {
  // Skipped rather than failed: ffmpeg is the fixture's dependency, not the
  // app's, and a machine without it can still run every other check.
  console.log('  – skipped: ffmpeg not installed')
  process.exit(0)
}

const work = await mkdtemp(join(tmpdir(), 'demodog-verify-'))
const output = join(work, 'export.mp4')

try {
  const { code, out } = await run('npx', ['electron', '.'], {
    timeout: 300_000,
    env: {
      ...process.env,
      DEMODOG_BENCH: FIXTURE,
      DEMODOG_BENCH_OUT: output,
      DEMODOG_BENCH_SECONDS: String(SECONDS),
      // No zoom, cursor or PiP: with those on, the picture changes every
      // frame regardless of whether the recording underneath it does, and
      // this check passes on a completely frozen export.
      DEMODOG_BENCH_PLAIN: '1'
    }
  })

  check(code !== 'timeout', 'export finishes', 'the exporter hung — it never wrote a file')
  check(existsSync(output), 'a file is written', out.split('\n').slice(-6).join('\n      '))

  if (existsSync(output)) {
    // A frozen export compresses to almost nothing, because every frame after
    // the first is identical to the one before it.
    const size = (await readFile(output)).byteLength
    check(size > 200_000, `file is a plausible size (${(size / 1024).toFixed(0)} KB)`)

    await run('ffmpeg', [
      '-v',
      'error',
      '-i',
      output,
      '-vf',
      `fps=${SAMPLES / SECONDS}`,
      join(work, 'f%02d.png')
    ])
    const frames = (await readdir(work)).filter((f) => f.endsWith('.png')).sort()
    check(frames.length >= 3, `frames can be decoded back out (${frames.length})`)

    const digests = new Set()
    for (const frame of frames) {
      digests.add(
        createHash('md5')
          .update(await readFile(join(work, frame)))
          .digest('hex')
      )
    }
    // The whole point: one distinct frame across the sample means the export is
    // a still image with audio over it.
    check(
      digests.size === frames.length,
      `every sampled frame differs (${digests.size} of ${frames.length})`,
      digests.size === 1
        ? 'every frame is identical — the export is frozen'
        : 'some frames repeat, so the reader is not advancing cleanly'
    )
  }
  // A second pass with the overlays left on, purely to confirm the zoom shots
  // reach the exporter. They live in their own state, and an export that
  // silently rendered with an empty shot list looked completely normal — every
  // frame present, every frame different, just flat.
  const zoomRun = await run('npx', ['electron', '.'], {
    timeout: 300_000,
    env: {
      ...process.env,
      DEMODOG_BENCH: FIXTURE,
      DEMODOG_BENCH_OUT: join(work, 'zoom.mp4'),
      DEMODOG_BENCH_SECONDS: String(SECONDS)
    }
  })
  const shots = zoomRun.out.match(/\[export\][^\n]*shots (\d+)/)
  check(
    shots !== null && Number(shots[1]) > 0,
    `the export renders with zoom shots (${shots ? shots[1] : 'none reported'})`,
    'the exporter was handed an empty shot list, so the result has no zoom'
  )
} finally {
  await rm(work, { recursive: true, force: true })
}

if (failures.length > 0) {
  console.log(red(`\n${failures.length} export check(s) failed.\n`))
  process.exit(1)
}
console.log(green('\nExport checks passed.\n'))
