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
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
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
/**
 * Where each pip starts, in seconds.
 *
 * Deliberately crude — a 10ms window, a fixed threshold and half a second of
 * refractory period — because the signal is a loud tone against near silence
 * and anything cleverer would be harder to trust than the thing it measures.
 */
function findOnsets(buffer) {
  const samples = new Int16Array(buffer.buffer, buffer.byteOffset, Math.floor(buffer.byteLength / 2))
  const rate = 8000
  const window = Math.round(0.01 * rate)
  const found = []
  let last = -9
  for (let i = 0; i + window < samples.length; i += window) {
    let sum = 0
    for (let j = i; j < i + window; j++) sum += samples[j] * samples[j]
    const rms = Math.sqrt(sum / window)
    const at = i / rate
    if (rms > 2000 && at - last > 0.5) {
      found.push(at)
      last = at
    }
  }
  return found
}

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
    // ---- audio against picture ------------------------------------------
    //
    // The fixture's camera track carries a 1 kHz pip every two seconds, at
    // t = 1, 3, 5. The exporter maps output time to source time itself, so if
    // those onsets come back where they went in, the sound and the picture
    // agree. This is the check that was missing when an export came back with
    // the audio running ahead of the video: everything above passes on a file
    // whose audio is a second out, because every frame still differs and the
    // file is still a plausible size.
    const raw = join(work, 'audio.raw')
    await run('ffmpeg', ['-v', 'error', '-i', output, '-vn', '-ac', '1', '-ar', '8000', '-f', 's16le', raw])
    // Said out loud rather than skipped quietly. An export with no audio track
    // cannot be judged for sync, and a check that quietly passes in that case
    // would report "audio lines up" about a file with no audio in it.
    const onsets = existsSync(raw) ? findOnsets(await readFile(raw)) : []
    const expected = [1, 3, 5].filter((t) => t < SECONDS - 0.2)

    if (!existsSync(raw)) {
      console.log(
        '  – audio sync not checked: the exported fixture has no audio track.\n' +
          '      Real takes do export audio, so this is a gap in the fixture rather\n' +
          '      than a known fault — but it means sync is currently unmeasured.'
      )
    } else if (onsets.length > 0) {
      const drifts = expected.map((want) => {
        const near = onsets.reduce((a, b) => (Math.abs(b - want) < Math.abs(a - want) ? b : a))
        return { want, got: near, off: near - want }
      })
      const worst = drifts.reduce((a, b) => (Math.abs(b.off) > Math.abs(a.off) ? b : a))
      check(
        Math.abs(worst.off) <= 0.06,
        `audio lines up with the picture (worst mark ${(worst.off * 1000).toFixed(0)}ms out)`,
        drifts.map((d) => `expected ${d.want}s, found ${d.got.toFixed(3)}s`).join('; ')
      )
      // Two marks two seconds apart that have moved by different amounts is a
      // rate problem, not an offset, and needs a different fix entirely.
      if (drifts.length > 1) {
        const spread = Math.max(...drifts.map((d) => d.off)) - Math.min(...drifts.map((d) => d.off))
        check(
          spread <= 0.04,
          `the offset does not grow across the take (${(spread * 1000).toFixed(0)}ms spread)`,
          'the marks have moved by different amounts, so the audio drifts rather than sitting at a fixed offset'
        )
      }
    }
  }

  // ---- music, and its ducking ---------------------------------------------
  //
  // The bed's level is computed twice — as Web Audio automation for the export
  // and directly for the preview's volume — and two implementations of one
  // shape drift. verify:music compares the models; this compares the file the
  // exporter actually wrote, which is the only place a wrong ramp is audible.
  //
  // The bed is 300 Hz and the fixture's narration pips are 1 kHz, so a
  // band-pass measures one without the other.
  const bed = join(FIXTURE, 'music.m4a')
  if (existsSync(bed)) {
    const musicOut = join(work, 'music.mp4')
    const settings = join(work, 'project.json')
    await writeFile(
      settings,
      JSON.stringify({
        music: {
          src: bed,
          gain: 0.9,
          fadeIn: 0.1,
          fadeOut: 0.1,
          loop: true,
          duckDb: 18,
          duckAttack: 0.2,
          duckRelease: 0.3,
          startAt: 0
        },
        captions: [{ id: 'c1', start: 3, end: 5, text: 'speaking here' }]
      })
    )

    const music = await run('npx', ['electron', '.'], {
      timeout: 300_000,
      env: {
        ...process.env,
        DEMODOG_BENCH: FIXTURE,
        DEMODOG_BENCH_OUT: musicOut,
        DEMODOG_BENCH_SECONDS: '8',
        DEMODOG_BENCH_PROJECT: settings
      }
    })
    check(music.code !== 'timeout' && existsSync(musicOut), 'an export with music finishes')

    if (existsSync(musicOut)) {
      const level = async (from, seconds) => {
        const { out } = await run('ffmpeg', [
          '-ss', String(from), '-t', String(seconds), '-i', musicOut,
          '-af', 'bandpass=f=300:width_type=h:w=40,volumedetect', '-f', 'null', '/dev/null'
        ])
        const match = /mean_volume:\s*(-?[\d.]+)/.exec(out)
        return match ? Number(match[1]) : NaN
      }
      const before = await level(1.0, 1.0)
      const during = await level(3.4, 1.2)
      const after = await level(6.0, 1.0)

      check(
        Number.isFinite(before) && before > -35,
        `the music bed reaches the export (${before.toFixed(1)} dB at 300 Hz)`,
        'no 300 Hz content — the bed was not mixed in at all'
      )
      // Within a few dB of the 18 asked for. Exact equality would be measuring
      // the band-pass rather than the ducking.
      const drop = before - during
      check(
        drop > 12,
        `it ducks under a caption (${drop.toFixed(1)} dB down, asked for 18)`,
        `before ${before.toFixed(1)} dB, during ${during.toFixed(1)} dB`
      )
      check(
        Math.abs(after - before) < 4,
        `and comes back afterwards (${after.toFixed(1)} dB)`,
        `before ${before.toFixed(1)} dB, after ${after.toFixed(1)} dB`
      )
    }
  }

  // ---- annotations reach the file -----------------------------------------
  //
  // The drawing is checked call by call in verify:annotations; this checks the
  // pixels of a real export. Two exports with the layout pinned — one with a
  // pixelate and a blur, one without — compared region by region. Where the
  // marks are, the picture must change; everywhere else, and at a moment after
  // the marks have ended, it must not.
  {
    const layout = {
      output: { width: 1728, height: 1080, fps: 30 },
      frame: { padding: 0.055, fitMode: 'contain', rotate: 0 }
    }
    // Same arithmetic as Composition.rebuildLayout for a 2880×1800 source.
    const pad = 0.055 * 1080
    const availW = 1728 - pad * 2
    const availH = 1080 - pad * 2
    const contentW = availH * 1.6
    const content = { x: pad + (availW - contentW) / 2, y: pad, scale: contentW / 2880 }
    /** The middle 60% of a source rectangle, in output pixels, as an ffmpeg crop. */
    const cropOf = ({ x, y, w, h }) => {
      const ox = content.x + (x + w * 0.2) * content.scale
      const oy = content.y + (y + h * 0.2) * content.scale
      return `crop=${Math.round(w * 0.6 * content.scale)}:${Math.round(h * 0.6 * content.scale)}:${Math.round(ox)}:${Math.round(oy)}`
    }

    // Over target 3 and target 2 of the fixture; target 4 is left alone as the control.
    const pixelated = { x: 1240, y: 750, w: 400, h: 300 }
    const blurred = { x: 2100, y: 350, w: 400, h: 300 }
    const untouched = { x: 400, y: 1300, w: 400, h: 300 }
    const mark = (id, kind, r) => ({
      id, kind, start: 0.3, end: 2.5, ...r, color: '#000000', width: 0, amount: 14, fade: 0
    })

    const exportWith = async (name, annotations) => {
      const settings = join(work, `${name}.json`)
      const file = join(work, `${name}.mp4`)
      await writeFile(settings, JSON.stringify({ ...layout, annotations }))
      const result = await run('npx', ['electron', '.'], {
        timeout: 300_000,
        env: {
          ...process.env,
          DEMODOG_BENCH: FIXTURE,
          DEMODOG_BENCH_OUT: file,
          DEMODOG_BENCH_SECONDS: '4',
          DEMODOG_BENCH_PROJECT: settings,
          DEMODOG_BENCH_PLAIN: '1'
        }
      })
      return result.code !== 'timeout' && existsSync(file) ? file : null
    }

    const plain = await exportWith('marks-off', [])
    const marked = await exportWith('marks-on', [mark('p', 'pixelate', pixelated), mark('b', 'blur', blurred)])
    check(Boolean(plain && marked), 'an export with blur and pixelate marks finishes')

    if (plain && marked) {
      const still = async (file, at, name) => {
        const png = join(work, `${name}.png`)
        await run('ffmpeg', ['-v', 'error', '-ss', String(at), '-i', file, '-frames:v', '1', '-y', png])
        return png
      }
      /** Mean luma difference between two stills inside one region. */
      const difference = async (a, b, region) => {
        const { out } = await run('ffmpeg', [
          '-i', a, '-i', b, '-filter_complex',
          `[0][1]blend=all_mode=difference,${cropOf(region)},signalstats,metadata=print:key=lavfi.signalstats.YAVG`,
          '-f', 'null', '-'
        ])
        const match = /lavfi\.signalstats\.YAVG=([\d.]+)/.exec(out)
        return match ? Number(match[1]) : NaN
      }

      const during = [await still(plain, 1.2, 'off-1'), await still(marked, 1.2, 'on-1')]
      const afterwards = [await still(plain, 3.4, 'off-3'), await still(marked, 3.4, 'on-3')]

      const pix = await difference(...during, pixelated)
      const blur = await difference(...during, blurred)
      const control = await difference(...during, untouched)
      const later = Math.max(
        await difference(...afterwards, pixelated),
        await difference(...afterwards, blurred)
      )

      check(pix > 2, `pixelate changes the picture where it was placed (${pix.toFixed(1)} luma)`,
        'the pixelated region is identical to the unmarked export — the mark never reached the file')
      check(blur > 2, `blur changes the picture where it was placed (${blur.toFixed(1)} luma)`,
        'the blurred region is identical to the unmarked export')
      check(control < 1.5, `nothing changes where there is no mark (${control.toFixed(2)} luma)`,
        'an unmarked part of the frame differs — the effect is leaking outside its region')
      check(later < 1.5, `and nothing is hidden once the marks have ended (${later.toFixed(2)} luma)`,
        'the marked regions still differ after the marks end')
    }
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
