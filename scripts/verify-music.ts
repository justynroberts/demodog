// MIT License - Copyright (c) fintonlabs.com
/**
 * The music bed, checked where it is most likely to go wrong.
 *
 * The level is computed twice: the exporter schedules it as Web Audio
 * automation, and the preview — which has only an `<audio>` element and a
 * volume — computes it directly. Two implementations of one shape drift, and
 * the drift is inaudible until someone compares an export with the preview it
 * was judged from. So the preview's model is asserted against the values the
 * exporter's automation produces at the same instants.
 */
import { musicLevelAt, musicTimeAt } from '../src/renderer/src/editor/music'
import type { MusicTrack } from '../src/renderer/src/engine/types'
import type { Caption } from '../src/renderer/src/engine/captions'

let failed = 0
function check(ok: boolean, label: string, detail = ''): void {
  console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${label}${!ok && detail ? `\n      ${detail}` : ''}`)
  if (!ok) failed++
}
const near = (a: number, b: number, tol = 0.02): boolean => Math.abs(a - b) < tol

const music: MusicTrack = {
  src: 'rec://local/bed.mp3',
  gain: 0.5,
  fadeIn: 2,
  fadeOut: 2,
  loop: true,
  duckDb: 12,
  duckAttack: 0.25,
  duckRelease: 0.5,
  startAt: 0
}
// A 20s take, no cards, with one line spoken from 5s to 7s.
const range = { start: 0, end: 20 }
const captions: Caption[] = [{ id: 'a', start: 5, end: 7, text: 'hello' }]
const level = (t: number, m = music, c = captions, leadIn = 0, leadOut = 0): number =>
  musicLevelAt(t, m, c, range, leadIn, leadOut)

console.log('\nMusic')

// ---- fades ---------------------------------------------------------------
check(near(level(0), 0), 'starts silent when it fades in')
check(near(level(1), 0.25), 'is half way up at half the fade')
check(near(level(2), 0.5), 'reaches full level at the end of the fade')
check(near(level(20), 0), 'ends silent')
check(near(level(19), 0.25), 'is half way down at half the out-fade')
check(near(level(3), 0.5), 'holds its level between the fades')

// ---- ducking -------------------------------------------------------------
const under = 0.5 * Math.pow(10, -12 / 20)
check(near(level(6), under), 'ducks while a caption is on screen')
check(near(level(5), under, 0.06), 'is down by the time the line starts')
check(level(4.9) < 0.5 && level(4.9) > under, 'is on the way down just before the line')
check(level(7.25) > under && level(7.25) < 0.5, 'is on the way back after the line')
check(near(level(8), 0.5), 'is fully back once the release has passed')
check(near(level(6, { ...music, duckDb: 0 }), 0.5), 'does not duck when ducking is off')

// ---- cards ---------------------------------------------------------------
// With a 3s intro the piece is 3s longer and everything shifts with it: the
// bed starts under the card, not when the recording does.
check(near(musicLevelAt(-3, music, captions, range, 3, 0), 0), 'starts silent at the top of an intro card')
check(near(musicLevelAt(-1, music, captions, range, 3, 0), 0.5), 'is at level by the end of a 2s fade over a 3s card')

// ---- position ------------------------------------------------------------
const at = (t: number, m = music, dur = 10, leadIn = 0): number | null =>
  musicTimeAt(t, m, dur, range, leadIn)
check(at(0) === 0, 'begins at the start of the file')
check(at(5) === 5, 'follows the playhead')
check(at(12) === 2, 'wraps around when looping')
check(at(12, { ...music, loop: false }) === null, 'runs out when not looping')
check(at(5, { ...music, startAt: 30 }, 60) === 35, 'honours a start offset')
// A track can be swapped for a shorter one, leaving the offset past its end.
check(at(1, { ...music, startAt: 30 }, 10) !== null, 'an offset past the end still plays')
check(at(1, { ...music, startAt: 30 }, 10) === 1, 'and ignores the offset rather than parking on the last sample')
check(at(-3, music, 10, 3) === 0, 'starts at the top of the intro card')

if (failed > 0) {
  console.error(`\n\x1b[31m${failed} music check(s) failed.\x1b[0m\n`)
  process.exit(1)
}
console.log('\n\x1b[32mMusic checks passed.\x1b[0m\n')
