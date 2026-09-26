// MIT License - Copyright (c) fintonlabs.com
/**
 * Editing on the timeline: seeing the take closely, and landing edits exactly.
 *
 * The timeline used to show the whole composition at a fixed scale. A second
 * of a two-minute take was a few pixels wide, so trimming to a word or ending
 * a zoom on the click that caused it was guesswork. These drive the real
 * editor and read the result off the ruler it drew — deliberately not off the
 * component's own arithmetic, which would let a test agree with a bug.
 */
import { existsSync, rmSync } from 'fs'
import { join } from 'path'
import { openEditor, sleep } from './lib/app.mjs'

const TAKE = join(process.env.HOME ?? '', 'Movies', 'DemoDog', 'fixture')
let failures = 0
function check(ok, label, detail = '') {
  console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${label}${detail ? `  \x1b[2m${detail}\x1b[0m` : ''}`)
  if (!ok) failures++
}
const near = (a, b, tol) => Math.abs(a - b) <= tol

if (!existsSync(join(TAKE, 'meta.json'))) {
  console.log('\nTimeline editing: no fixture take — run `npm run fixture` first. Skipped.\n')
  process.exit(0)
}
rmSync(join(TAKE, 'edits.json'), { force: true })

const app = await openEditor(TAKE)
if (!(await app.ready())) {
  console.log('\n\x1b[31mthe editor never came up\x1b[0m\n')
  app.close()
  process.exit(1)
}
await sleep(1200)

console.log('\nTimeline editing')

const stack = await app.rect('.track-stack')
const rulerY = stack.top + 8
const labels = () => app.eval(`JSON.stringify([...document.querySelectorAll('.rule.major i')].map((i) => i.textContent))`)

// ---- seeing it closely ---------------------------------------------------------
{
  const whole = JSON.parse(await labels())
  check(whole.length >= 3, 'the ruler puts real times along the timeline', whole.slice(0, 4).join(' '))
  check(!(await app.eval(`Boolean(document.querySelector('.overview'))`)), 'and with the whole take on screen there is no strip saying where you are')

  // ⌥-scroll at a quarter across: the moment under the pointer must stay put.
  const at = { x: stack.left + stack.width * 0.25, y: rulerY }
  const before = (await app.mapping()).timeAt(at.x)
  await app.wheel(at.x, at.y, { deltaY: -300, alt: true })
  await sleep(500)
  const zoomed = await app.mapping()
  check(zoomed.perPixel * 1000 < 4, 'zooming in shows less of the take at once', `${(zoomed.perPixel * 1000).toFixed(2)}s per 1000px`)
  check(near(zoomed.timeAt(at.x), before, 0.15), 'and the moment under the pointer stays under the pointer', `${before.toFixed(2)}s → ${zoomed.timeAt(at.x).toFixed(2)}s`)
  check(JSON.parse(await labels())[0] !== whole[0], 'the marks get finer as it zooms', JSON.parse(await labels()).slice(0, 3).join(' '))
  check(await app.eval(`Boolean(document.querySelector('.overview'))`), 'and a strip appears showing where in the take you are')
}

// ---- moving about ---------------------------------------------------------------
{
  const before = (await app.mapping()).timeAt(stack.left + 10)
  await app.wheel(stack.left + stack.width / 2, rulerY, { deltaX: 200 })
  await sleep(400)
  const after = (await app.mapping()).timeAt(stack.left + 10)
  check(after > before, 'a sideways scroll moves along the take', `${before.toFixed(2)}s → ${after.toFixed(2)}s`)
  for (let i = 0; i < 12; i++) await app.wheel(stack.left + stack.width / 2, rulerY, { deltaX: -400 })
  await sleep(400)
  const atStart = (await app.mapping()).timeAt(stack.left)
  check(atStart >= -0.2, 'scrolling back stops at the beginning rather than drifting into nothing', `${atStart.toFixed(2)}s`)

  await app.key('KeyZ', { key: '0' })
  await app.eval(`document.querySelector('.tl-btn:nth-of-type(3)')?.click()`)
  await sleep(400)
  check(!(await app.eval(`Boolean(document.querySelector('.overview'))`)), 'Fit puts the whole take back on screen')
}

// ---- landing an edit exactly ------------------------------------------------------
{
  // Close enough in that a hundredth of a second is a few pixels, then put the
  // playhead somewhere awkward and drag a shot's end near it.
  await app.wheel(stack.left + stack.width * 0.3, rulerY, { deltaY: -150, alt: true })
  await sleep(500)
  const lane = await app.rect('.track.zooms')
  // A fresh shot, so there is an edge on screen to drag: the automatic ones on
  // this fixture are longer than the view once it is this close in.
  await app.eval(
    "(() => { const l = document.querySelector('.track.zooms'); const r = l.getBoundingClientRect();" +
      " l.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: r.left + r.width * 0.2, clientY: r.top + r.height / 2 })) })()"
  )
  await sleep(600)
  let map = await app.mapping()
  const playAt = map.timeAt(stack.left + stack.width * 0.55)
  await app.eval(`(() => { const s = document.querySelector('.track-stack'); const r = s.getBoundingClientRect(); s.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: ${stack.left + stack.width * 0.55}, clientY: r.top + 6 })); window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })) })()`)
  await sleep(400)

  // The shot just created is the selected one; drag its right handle, so the
  // test cannot accidentally grab the block body and move the whole thing.
  const handle = JSON.parse(await app.eval(
    "(() => { const h = document.querySelector('.zoom-block.selected .handle.r'); if (!h) return 'null';" +
      " const r = h.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }) })()"
  ))
  const endOfSelected = async () => {
    const right = await app.eval(`document.querySelector('.zoom-block.selected')?.getBoundingClientRect().right`)
    return (await app.mapping()).timeAt(right)
  }
  if (!handle) {
    check(false, 'the new shot has a handle to drag')
  } else {
    const was = await endOfSelected()
    // A few pixels short of the playhead: close enough to catch on it.
    await app.drag(handle, { x: map.xOf(playAt) - 5, y: handle.y })
    const landed = await endOfSelected()
    check(Math.abs(landed - was) > 0.05, 'the shot’s end follows the drag', `${was.toFixed(2)}s → ${landed.toFixed(2)}s`)
    check(near(landed, playAt, 0.02), 'and lands exactly on the playhead rather than a few pixels short of it', `${landed.toFixed(3)}s vs playhead ${playAt.toFixed(3)}s`)

    const grab = { x: (await app.mapping()).xOf(landed) - 2, y: handle.y }
    await app.drag(grab, { x: map.xOf(playAt) - 7, y: handle.y }, { alt: true })
    const free = await endOfSelected()
    check(!near(free, playAt, 0.005), 'holding ⌥ drags it free of the snap', `${free.toFixed(3)}s`)
  }
  check(!(await app.eval(`Boolean(document.querySelector('.snap-guide'))`)), 'the snap guide is gone once the drag ends')
}

// ---- giving the timeline the window ------------------------------------------------
{
  const before = (await app.rect('.track.zooms')).height
  await app.key('KeyT', { key: 't' })
  await sleep(500)
  const open = await app.eval(`document.querySelector('.editor').className.includes('timeline-open')`)
  const after = (await app.rect('.track.zooms')).height
  check(open, 'T gives the timeline the window')
  check(after > before, 'and the lanes get taller, so the edges are easier to catch', `${before}px → ${after}px`)
  await app.key('KeyT', { key: 't' })
  await sleep(500)
  check(!(await app.eval(`document.querySelector('.editor').className.includes('timeline-open')`)), 'and T again gives it back')
}

rmSync(join(TAKE, 'edits.json'), { force: true })
console.log(failures ? `\n\x1b[31m${failures} timeline editing check(s) failed.\x1b[0m\n` : '\n\x1b[32mTimeline editing checks passed in the running app.\x1b[0m\n')
app.close()
process.exit(failures ? 1 : 0)
