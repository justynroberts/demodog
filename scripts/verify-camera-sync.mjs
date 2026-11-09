// MIT License - Copyright (c) fintonlabs.com
/**
 * When does the camera file's zero actually happen?
 *
 * The camera is a separate recording with a timeline of its own, tied to the
 * screen by a single wall-clock stamp. Every millisecond of error in that stamp
 * slides the narration and the camera bubble against what is on screen, for the
 * whole take — and the error is invisible in the code, because the stamp looks
 * correct whatever it is.
 *
 * So it is measured. A canvas flashes white at known instants and is recorded
 * through the app's own `startCameraRecording`; the flashes are then found in
 * the file. Where a flash lands tells us what the file's zero corresponds to,
 * and that is compared against the stamp the app would have written into
 * camera.json. No webcam is involved, so this runs anywhere.
 *
 * The main thread is deliberately blocked for 600ms immediately after capture
 * starts, because that is what starting a screen capture does in a real take.
 * That is the condition under which the previous stamp — taken from
 * MediaRecorder's `start` event — was 614ms late, and real takes carried errors
 * from 90ms to 2.9 seconds.
 */
import { execFileSync, spawnSync } from 'child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const WORK = join(ROOT, 'node_modules', '.cache', 'camera-sync')
const OUT = join(WORK, 'probe')

let failures = 0
function check(ok, label, detail = '') {
  console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${label}${detail ? `  \x1b[2m${detail}\x1b[0m` : ''}`)
  if (!ok) failures++
}

console.log('\nCamera sync')

if (spawnSync('ffprobe', ['-version'], { stdio: 'ignore' }).status !== 0) {
  console.log('  \x1b[2m· skipped: ffprobe is needed to find the flashes\x1b[0m\n')
  process.exit(0)
}

rmSync(WORK, { recursive: true, force: true })
mkdirSync(WORK, { recursive: true })

// The recording module, bundled for the probe window. Bundled rather than
// reimplemented: the point is to measure the code that records real takes.
execFileSync(
  join(ROOT, 'node_modules/.bin/esbuild'),
  [
    join(ROOT, 'src/renderer/src/recorder/cameraRecorder.ts'),
    '--bundle',
    '--platform=browser',
    '--format=cjs',
    `--outfile=${join(ROOT, 'scripts/camera-sync/cameraRecorder.cjs')}`,
    '--log-level=warning'
  ],
  { stdio: 'inherit' }
)

const electron = join(ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
const run = spawnSync(electron, [join(ROOT, 'scripts/camera-sync')], {
  env: { ...process.env, PROBE_OUT: OUT },
  encoding: 'utf8'
})
if (!existsSync(`${OUT}.json`)) {
  console.log(`\n\x1b[31mthe probe produced nothing\x1b[0m\n${(run.stderr || '').slice(-400)}\n`)
  process.exit(1)
}

const probe = JSON.parse(readFileSync(`${OUT}.json`, 'utf8'))
const frames = JSON.parse(
  execFileSync('ffprobe', [
    '-v', 'error', '-f', 'lavfi', `movie=${OUT}.mp4,signalstats`,
    '-show_entries', 'frame=pts_time:frame_tags=lavfi.signalstats.YAVG', '-of', 'json'
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
).frames

/** The first frame of each flash, by its time in the recorded file. */
const lit = []
let dark = true
for (const frame of frames) {
  const y = Number(frame.tags?.['lavfi.signalstats.YAVG'] ?? 0)
  if (y > 100 && dark) lit.push(Number(frame.pts_time))
  dark = y <= 100
}

check(lit.length >= 3, 'the flashes are in the recording', `${lit.length} of ${probe.flashes.length}`)
if (lit.length < 3) {
  console.log('\n\x1b[31mcamera sync check failed.\x1b[0m\n')
  process.exit(1)
}

// Each flash was drawn a known time after capture began, and lands at a known
// time in the file. The difference is where the file's zero really is.
const errors = probe.flashes.slice(0, lit.length).map((flash, i) => (flash.since - lit[i]) * 1000)
const spread = Math.max(...errors) - Math.min(...errors)
const mean = errors.reduce((a, b) => a + b, 0) / errors.length
// The stamp is taken just before capture starts; where it sits relative to the
// file's zero is the error that reaches lip sync.
const stampError = probe.stampAfterCall - mean

check(spread < 50, 'the flashes agree with each other, so the file keeps real time', `spread ${spread.toFixed(0)}ms`)
check(
  Math.abs(stampError) < 50,
  'the stamp written into camera.json is the moment the recording really began',
  `out by ${stampError.toFixed(0)}ms`
)
check(
  Math.abs(stampError) < 1000 / 30,
  'and within a frame of it, which is what lip sync is measured in',
  `${stampError.toFixed(0)}ms vs 33ms`
)

rmSync(join(ROOT, 'scripts/camera-sync/cameraRecorder.cjs'), { force: true })
if (!process.env.KEEP) rmSync(WORK, { recursive: true, force: true })
console.log(failures ? `\n\x1b[31m${failures} camera sync check(s) failed.\x1b[0m\n` : '\n\x1b[32mCamera sync checks passed.\x1b[0m\n')
process.exit(failures ? 1 : 0)
