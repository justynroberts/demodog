// MIT License - Copyright (c) fintonlabs.com
/**
 * Title cards: what plays when, and what gets drawn.
 *
 * The transport half exists because the failure it covers was inaudible in a
 * screenshot and obvious the moment you pressed play — the recording's audio
 * ran underneath the intro card, so the take was seconds in by the time the
 * card lifted. A predicate is cheap to assert; "I watched it and it seemed
 * right" is not.
 *
 * The drawing half runs against a context that records what was asked of it,
 * which is enough to tell a cropped background from a stretched one.
 */
import {
  DEFAULT_INTRO,
  drawTitleCard,
  introProgress,
  outroProgress,
  phaseAt,
  recordingEnded,
  recordingRuns,
  titleImages,
  type TitleCard
} from '../src/renderer/src/engine/titles'

let failed = 0
function check(condition: boolean, label: string): void {
  console.log(`  ${condition ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${label}`)
  if (!condition) failed++
}

console.log('\nTitle cards')

// ---- transport ----------------------------------------------------------
// A 10s take with a 2s intro and a 3s outro.
const range = { start: 0, end: 10 }
const phase = (t: number): string => phaseAt(t, range, 2, 3)

check(phase(-2) === 'intro', 'the start of the intro is the intro')
check(phase(-0.01) === 'intro', 'the last instant before the take is still the intro')
check(phase(0) === 'recording', 'the recording begins exactly when the intro ends')
check(phase(9.99) === 'recording', 'the recording runs to its end')
check(phase(10) === 'outro', 'the outro begins where the recording stops')
check(phase(12.99) === 'outro', 'the outro holds for its full length')
check(phase(13) === 'ended', 'past the outro is the end of the piece')

check(!recordingRuns(phase(-1)), 'the recording does NOT run under the intro')
check(recordingRuns(phase(5)), 'the recording runs during itself')
check(!recordingRuns(phase(11)), 'the recording does NOT run under the outro')

// With no cards every moment of the piece is the recording.
check(phaseAt(-0.5, range, 0, 0) === 'recording', 'no intro means no intro phase')
check(phaseAt(10.5, range, 0, 0) === 'ended', 'no outro means the piece ends with the take')

// The cards themselves agree with the phases.
const intro: TitleCard = { ...DEFAULT_INTRO, enabled: true, seconds: 2 }
const outro: TitleCard = { ...DEFAULT_INTRO, enabled: true, seconds: 3 }
check(introProgress(-2, intro) === 0, 'the intro starts at its beginning')
check(introProgress(-0.001, intro)! > 0.999, 'the intro finishes as the take starts')
check(introProgress(0, intro) === null, 'the intro is over once the take begins')
check(outroProgress(10, 10, outro) === 0, 'the outro starts as the take ends')
check(outroProgress(9.9, 10, outro) === null, 'the outro has not begun before the take ends')

// ---- reaching the outro -------------------------------------------------
// The failure this covers: playback stopped on the last frame of the recording
// and the outro was never shown. The playhead is read back off the video
// element, which cannot report a time past the end of its own file — so a
// handover that leaves the playhead where the element left it parks just below
// the boundary it is waiting to cross, and nothing ever crosses it.

check(recordingEnded(5, range) === null, 'mid-recording is not the end')
check(recordingEnded(9.5, range) === null, 'nearly there is not the end')
check(recordingEnded(5, range, 9.98) === null, 'a short file is not the end mid-recording')
check(recordingEnded(9.97, range, 9.98) === 10, 'a file that has run out hands over early')
check(recordingEnded(5, range, NaN) === null, 'an unknown duration is not treated as the end')

// A file that runs exactly to the trim: the last frame lands a hair short.
check(recordingEnded(9.995, range) === 10, 'a clock stopping just short still hands over')
check(recordingEnded(10, range) === 10, 'a clock reaching the end hands over')
// The value handed back must be *at* the boundary, not below it, or the next
// frame takes the recording branch again and the loop wedges.
const handover = recordingEnded(9.995, range)
check(handover !== null && handover >= range.end, 'the handover lands at the end, not near it')
check(handover !== null && phaseAt(handover, range, 2, 3) === 'outro',
  'the frame after the handover is the outro')

// Play the last second frame by frame and confirm the piece actually leaves the
// recording — the element's clock freezes at 9.98, as a short file's does.
{
  const elementDuration = 9.98
  let t = 9.9
  let reached: string | null = null
  for (let frame = 0; frame < 120 && reached === null; frame++) {
    const elementTime = Math.min(elementDuration, t + 1 / 60)
    const finished = recordingEnded(elementTime, range, elementDuration)
    t = finished ?? elementTime
    if (phaseAt(t, range, 2, 3) === 'outro') reached = 'outro'
  }
  check(reached === 'outro', 'a file ending short of the trim still reaches the outro')
}

// ---- drawing ------------------------------------------------------------

interface Call {
  op: string
  args: number[]
}

/** Just enough canvas to record what a card asked to be drawn. */
function stubContext(): { ctx: never; calls: Call[] } {
  const calls: Call[] = []
  const ctx = {
    save: () => {},
    restore: () => {},
    fillRect: (...args: number[]) => calls.push({ op: 'fillRect', args }),
    drawImage: (_i: unknown, ...args: number[]) => calls.push({ op: 'drawImage', args }),
    fillText: () => {},
    measureText: () => ({ width: 100 }),
    beginPath: () => {},
    roundRect: () => {},
    fill: () => {},
    strokeText: () => {},
    globalAlpha: 1,
    fillStyle: '',
    font: '',
    textAlign: '',
    textBaseline: ''
  }
  return { ctx: ctx as never, calls }
}

const output = { width: 1920, height: 1080 }
// A 2:1 picture in a 16:9 frame — wider than the frame, so the two fits differ.
const picture = { naturalWidth: 2000, naturalHeight: 1000, complete: true } as never

const withPicture: TitleCard = {
  ...DEFAULT_INTRO,
  enabled: true,
  seconds: 2,
  title: 'Hello',
  backgroundSrc: 'rec://local/picture.png',
  backgroundDim: 0.5,
  fade: 0
}

// The cache is keyed by src, so seeding it stands in for a decode.
titleImages.set(withPicture.backgroundSrc!, picture)

{
  const cover = stubContext()
  drawTitleCard(cover.ctx, { ...withPicture, backgroundFit: 'cover' }, 0.5, output, 'Helvetica')
  const drawn = cover.calls.find((c) => c.op === 'drawImage')
  check(!!drawn, 'a background picture is drawn')
  // cover: the height fills, the width overflows and is centred.
  check(!!drawn && Math.abs(drawn.args[3] - 1080) < 0.5, 'cover fills the frame height')
  check(!!drawn && drawn.args[2] > output.width, 'cover overflows the width rather than squashing')
  check(!!drawn && Math.abs(drawn.args[0] + drawn.args[2] / 2 - output.width / 2) < 0.5,
    'cover centres the overflow')

  const contain = stubContext()
  drawTitleCard(contain.ctx, { ...withPicture, backgroundFit: 'contain' }, 0.5, output, 'Helvetica')
  const fitted = contain.calls.find((c) => c.op === 'drawImage')
  check(!!fitted && Math.abs(fitted.args[2] - 1920) < 0.5, 'contain fits the whole width')
  check(!!fitted && fitted.args[3] < output.height, 'contain leaves the frame taller than the image')

  // Background, then the picture, then the dim wash: three paints before the type.
  const dim = stubContext()
  drawTitleCard(dim.ctx, withPicture, 0.5, output, 'Helvetica')
  check(dim.calls.filter((c) => c.op === 'fillRect').length === 2,
    'the dim wash is painted over the picture')

  const undimmed = stubContext()
  drawTitleCard(undimmed.ctx, { ...withPicture, backgroundDim: 0 }, 0.5, output, 'Helvetica')
  check(undimmed.calls.filter((c) => c.op === 'fillRect').length === 1,
    'no wash is painted when dim is off')
}

if (failed > 0) {
  console.error(`\n\x1b[31m${failed} title check(s) failed.\x1b[0m\n`)
  process.exit(1)
}
console.log('\n\x1b[32mTitle card checks passed.\x1b[0m\n')
