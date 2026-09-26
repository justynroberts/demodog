// MIT License - Copyright (c) fintonlabs.com
/**
 * Undo and redo, in the real editor.
 *
 * verify-history checks the stepping itself, which is pure and cheap to test.
 * This drives the running app, because the parts that broke were the wiring:
 * an undo that regenerated the automatic zooms over the state it had just
 * restored, a caption text field whose own undo could never work because the
 * field is controlled, and an edits file left holding what had just been undone.
 *
 * DevTools is spoken over a pipe rather than a port. It needs no loopback
 * interface, which also means it cannot be reached from off the machine.
 */
import { spawn, execFileSync } from 'child_process'
import { existsSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const TAKE = join(process.env.HOME ?? '', 'Movies', 'DemoDog', 'fixture')
const EDITS = join(TAKE, 'edits.json')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let failures = 0
function check(ok, label, detail = '') {
  console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${label}${detail ? `  \x1b[2m${detail}\x1b[0m` : ''}`)
  if (!ok) failures++
}

if (!existsSync(join(TAKE, 'meta.json'))) {
  console.log('\nUndo: no fixture take — run `npm run fixture` first. Skipped.\n')
  process.exit(0)
}
// A previous run's edits would restore themselves and make this meaningless.
rmSync(EDITS, { force: true })

const bin = join(ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
const child = spawn(bin, ['.', '--remote-debugging-pipe'], {
  cwd: ROOT,
  env: { ...process.env, DEMODOG_OPEN: TAKE },
  stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe']
})
const [, , , toBrowser, fromBrowser] = child.stdio
let buffered = Buffer.alloc(0)
let id = 0
const waiting = new Map()
fromBrowser.on('data', (chunk) => {
  buffered = Buffer.concat([buffered, chunk])
  let at
  while ((at = buffered.indexOf(0)) !== -1) {
    const message = JSON.parse(buffered.subarray(0, at).toString())
    buffered = buffered.subarray(at + 1)
    if (message.id && waiting.has(message.id)) {
      waiting.get(message.id)(message)
      waiting.delete(message.id)
    }
  }
})
const call = (method, params = {}, sessionId) =>
  new Promise((resolve) => {
    const next = ++id
    waiting.set(next, resolve)
    toBrowser.write(JSON.stringify({ id: next, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0')
  })

const die = (why) => {
  console.log(`\n\x1b[31m${why}\x1b[0m\n`)
  child.kill()
  process.exit(1)
}
setTimeout(() => die('the editor never came up'), 120000).unref?.()

await sleep(4500)
const targets = (await call('Target.getTargets')).result?.targetInfos ?? []
const studio = targets.find((t) => t.url.includes('#/studio'))
if (!studio) die('no studio window')
const attached = await call('Target.attachToTarget', { targetId: studio.targetId, flatten: true })
const session = attached.result.sessionId
const ev = async (expression) => {
  const r = (await call('Runtime.evaluate', { expression, returnByValue: true }, session)).result
  if (r?.exceptionDetails) console.log('    ', r.exceptionDetails.exception?.description?.split('\n')[0])
  return r?.result?.value
}
const press = async (code, { meta = false, shift = false } = {}) => {
  const modifiers = (meta ? 4 : 0) | (shift ? 8 : 0)
  for (const type of ['keyDown', 'keyUp']) {
    await call('Input.dispatchKeyEvent', {
      type, modifiers, code,
      key: code === 'KeyZ' ? 'z' : 'Delete',
      windowsVirtualKeyCode: code === 'KeyZ' ? 90 : 46
    }, session)
  }
  await sleep(450)
}
const undo = () => press('KeyZ', { meta: true })
const redo = () => press('KeyZ', { meta: true, shift: true })
/** Longer than the editor waits before a run of changes becomes one step. */
const settle = () => sleep(800)
/**
 * Waits for the interface to catch up rather than assuming it has.
 *
 * Selecting a caption renders its text box on the next frame, and on a loaded
 * machine that is not the next millisecond — typing into a box that is not
 * there yet failed here while passing on a quiet one.
 */
const waitFor = async (expression, tries = 40) => {
  for (let i = 0; i < tries; i++) {
    const value = await ev(expression)
    if (value) return value
    await sleep(150)
  }
  return null
}
const zooms = () => ev(`document.querySelectorAll('.zoom-block').length`)
const marks = () => ev(`document.querySelectorAll('.note-block').length`)
const captions = () => ev(`document.querySelectorAll('.caption-block').length`)
const openTab = async (name) => {
  const tabs = await ev(`[...document.querySelectorAll('.insp-tabs button')].map((b) => b.getAttribute('aria-label').split(' — ')[0]).join(',')`)
  await ev(`document.querySelectorAll('.insp-tabs button')[${tabs.split(',').indexOf(name)}].click()`)
  await sleep(400)
}
/** The menu route a real ⌘Z takes; needs Accessibility, so it may be skipped. */
const viaMenu = (item) => {
  try {
    execFileSync('osascript', ['-e',
      `tell application "System Events" to tell process "Electron" to click menu item "${item}" of menu 1 of menu bar item "Edit" of menu bar 1`],
      { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

for (let i = 0; i < 60; i++) {
  if (await zooms()) break
  await sleep(500)
}
await sleep(1200)

console.log('\nUndo in the running editor')

// ---- a deleted zoom shot ----------------------------------------------------
{
  const before = await zooms()
  await ev(`document.querySelector('.zoom-block').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })); window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))`)
  await sleep(300)
  await press('Delete')
  await settle()
  const deleted = await zooms()
  await undo()
  const undone = await zooms()
  await redo()
  const redone = await zooms()
  await undo()
  await settle()
  check(deleted === before - 1, 'a zoom shot is deleted', `${before} → ${deleted}`)
  check(undone === before, 'undo brings it back — rather than regenerating the automatic shots over it', `${deleted} → ${undone}`)
  check(redone === before - 1, 'redo deletes it again')
  check((await zooms()) === before, 'and undo restores it once more')
}

// ---- a mark ------------------------------------------------------------------
{
  await openTab('Annotate')
  const box = JSON.parse(await ev(`JSON.stringify(document.querySelector('.stage canvas').getBoundingClientRect())`))
  const at = (fx, fy) => [box.left + box.width * fx, box.top + box.height * fy]
  await ev(`[...document.querySelectorAll('.annotate-tools .tool')].find((b) => b.textContent.trim() === 'Box').click()`)
  const [x0, y0] = at(0.3, 0.3)
  const [x1, y1] = at(0.6, 0.6)
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: y0, button: 'left', buttons: 1, clickCount: 1 }, session)
  for (let i = 1; i <= 6; i++) {
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0 + ((x1 - x0) * i) / 6, y: y0 + ((y1 - y0) * i) / 6, button: 'left', buttons: 1 }, session)
  }
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x1, y: y1, button: 'left', buttons: 0, clickCount: 1 }, session)
  await settle()
  const placed = await marks()
  await undo()
  const gone = await marks()
  await redo()
  const back = await marks()
  await undo()
  await settle()
  check(placed === 1 && gone === 0, 'a mark drawn on the preview is undone', `${placed} → ${gone}`)
  check(back === 1, 'and redone')
}

// ---- a caption, and typing in one ---------------------------------------------
{
  await openTab('Captions')
  await ev(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Add a line')?.click()`)
  await settle()
  const added = await captions()
  await undo()
  const removed = await captions()
  await redo()
  await settle()
  check(added === 1 && removed === 0, 'a caption added by hand is undone', `${added} → ${removed}`)

  await waitFor(`document.querySelectorAll('.caption-block').length`)
  await ev(`document.querySelector('.caption-block')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })); window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))`)
  const ready = await waitFor(`Boolean(document.querySelector('textarea.caption-text'))`)
  check(Boolean(ready), 'selecting a caption opens its text box')
  // Focused, and confirmed focused. Selecting the caption re-renders the
  // panel, and a focus() that lands on the node about to be replaced leaves
  // the keystrokes going nowhere — which is exactly how this failed once on a
  // busy machine and passed everywhere else.
  const focused = await waitFor(
    `(() => { const t = document.querySelector('textarea.caption-text'); if (!t) return false; if (document.activeElement !== t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); } return document.activeElement === t })()`
  )
  check(Boolean(focused), 'the caption text box takes focus')
  const before = await ev(`document.querySelector('textarea.caption-text')?.value`)
  for (const character of 'XY') {
    for (const type of ['keyDown', 'char', 'keyUp']) {
      await call('Input.dispatchKeyEvent', {
        type, text: type === 'char' ? character : undefined, key: character,
        code: `Key${character}`, windowsVirtualKeyCode: character.charCodeAt(0)
      }, session)
    }
  }
  await waitFor(`document.querySelector('textarea.caption-text')?.value?.endsWith('XY')`)
  await settle()
  const typed = await ev(`document.querySelector('textarea.caption-text')?.value`)
  await undo()
  await waitFor(`document.querySelector('textarea.caption-text')?.value === ${JSON.stringify('')} ? false : true`)
  const afterUndo = await ev(`document.querySelector('textarea.caption-text')?.value`)
  const stillThere = await captions()
  check(before !== null && typed === `${before}XY`, 'typing reaches the caption text field', JSON.stringify(typed))
  check(afterUndo === before, 'undo in a caption undoes the typing — the field is controlled, so the browser’s own undo cannot', `${JSON.stringify(typed)} → ${JSON.stringify(afterUndo)}`)
  check(stillThere === 1, 'and does not remove the caption itself')
}

// ---- a slider drag is one step -------------------------------------------------
{
  await openTab('Zoom')
  const read = () => ev(`(() => { const row = [...document.querySelectorAll('.slider-row')].find((r) => r.querySelector('.name')?.textContent === 'Ease in'); return row ? row.querySelector('input').value : null })()`)
  const before = await read()
  await ev(`(() => {
    const row = [...document.querySelectorAll('.slider-row')].find((r) => r.querySelector('.name')?.textContent === 'Ease in')
    const input = row.querySelector('input')
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    let v = parseFloat(input.value)
    for (let i = 0; i < 30; i++) { v = Math.min(parseFloat(input.max), v + 0.02); set.call(input, String(v)); input.dispatchEvent(new Event('input', { bubbles: true })) }
  })()`)
  await settle()
  const dragged = await read()
  await undo()
  const afterOne = await read()
  await redo()
  const afterRedo = await read()
  await undo()
  await settle()
  check(dragged !== before, 'a slider moves under the thumb', `${before} → ${dragged}`)
  check(afterOne === before, 'one undo puts back the whole drag, not one step of it')
  check(afterRedo === dragged, 'redo returns to where the drag ended')
}

// ---- the menu, which is the route a real ⌘Z takes -------------------------------
{
  const before = await zooms()
  await ev(`document.querySelector('.zoom-block').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })); window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))`)
  await sleep(300)
  await press('Delete')
  await settle()
  if (!viaMenu('Undo')) {
    console.log('  \x1b[2m· Edit ▸ Undo not exercised: no Accessibility permission for osascript here\x1b[0m')
    await undo()
  } else {
    await sleep(800)
    check((await zooms()) === before, 'Edit ▸ Undo in the menu bar reaches the editor, not just a text field')
    if (viaMenu('Redo')) {
      await sleep(800)
      check((await zooms()) === before - 1, 'Edit ▸ Redo does too')
      viaMenu('Undo')
      await sleep(800)
    }
  }
  await settle()
}

// ---- what is saved is what is on screen -----------------------------------------
{
  for (let i = 0; i < 14; i++) await undo()
  await sleep(1600)
  const onScreen = { captions: await captions(), marks: await marks(), zooms: await zooms() }
  const saved = existsSync(EDITS) ? JSON.parse(readFileSync(EDITS, 'utf8')) : null
  check(saved !== null, 'the take has an edits file')
  check(
    saved?.captions.length === onScreen.captions && saved?.annotations.length === onScreen.marks,
    'undoing everything is written to disk too — the file cannot be left holding what was just undone',
    `saved ${saved?.captions.length} captions / ${saved?.annotations.length} marks, on screen ${onScreen.captions} / ${onScreen.marks}`
  )
  check(onScreen.zooms > 0, 'and the automatic zooms are still there', `${onScreen.zooms} shots`)
}

rmSync(EDITS, { force: true })
console.log(failures ? `\n\x1b[31m${failures} undo check(s) failed.\x1b[0m\n` : '\n\x1b[32mUndo checks passed in the running app.\x1b[0m\n')
child.kill()
process.exit(failures ? 1 : 0)
