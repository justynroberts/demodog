// MIT License - Copyright (c) fintonlabs.com
/**
 * The restart prompt, run in real Electron with real windows.
 *
 * Nothing else in `npm run verify` goes near the updater, which is how a crash
 * reached users: once the studio window had been closed and reopened from the
 * Dock, an update finishing its download threw "Object has been destroyed" and
 * the prompt never appeared. That only happens days into a session, at the
 * moment an update lands, on a packaged build — so it has to be staged here.
 *
 * Only the dialog, the install and the browser are faked. The windows are real
 * BrowserWindows, created, destroyed and recreated exactly as the app does.
 *
 * Run by `npm run verify:updater`, which the release script runs before it will
 * publish anything.
 */
const { app, BrowserWindow } = require('electron')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

// A module that fails to load would otherwise put up Electron's error dialog
// and leave the process waiting on it forever — and the release script with it.
let createUpdatePrompt
try {
  ;({ createUpdatePrompt } = require(join(__dirname, '../node_modules/.cache/updater.cjs')))
} catch (error) {
  console.error(`\x1b[31m\nUpdater checks could not load the updater: ${error.stack || error}\n\x1b[0m`)
  app.exit(1)
}

const green = (s) => `\x1b[32m${s}\x1b[0m`
const red = (s) => `\x1b[31m${s}\x1b[0m`
let failures = 0
const check = (ok, label) => {
  console.log(`  ${ok ? green('✓') : red('✗')} ${label}`)
  if (!ok) failures++
}

const tick = () => new Promise((r) => setTimeout(r, 30))

// Electron quits when its last window closes unless something listens, and the
// scenarios close every window they make. Left alone the process ended after
// the first scenario with exit code 0 — a test that stopped part-way and
// reported success.
app.on('window-all-closed', () => {})

// Belt and braces: any exit before the last check is a failure, and so is a
// run that never finishes, since the release script is waiting on this.
let finished = false
app.on('will-quit', (event) => {
  if (finished) return
  event.preventDefault()
  console.error(red('\nUpdater checks ended before they finished.\n'))
  app.exit(1)
})
setTimeout(() => {
  if (finished) return
  console.error(red('\nUpdater checks timed out.\n'))
  app.exit(1)
}, 30000).unref()

/** Off-screen and tiny: `ask` really does show and focus the window. */
const makeWindow = () =>
  new BrowserWindow({ show: false, width: 1, height: 1, x: -4000, y: -4000, focusable: false })

/** A fake world around one prompt. `answer` decides what the user clicks. */
function harness({ getWindow, answer = { response: 1 } }) {
  const calls = { shown: [], focusApp: 0, quit: 0, opened: [], revealed: 0, notes: [], later: [] }
  const deps = {
    getWindow,
    showMessageBox: (win, options) => {
      calls.shown.push({ win, message: options.message })
      return typeof answer === 'function' ? answer(calls.shown.length) : Promise.resolve(answer)
    },
    focusApp: () => calls.focusApp++,
    quitAndInstall: () => calls.quit++,
    openExternal: (url) => calls.opened.push(url),
    revealLog: () => calls.revealed++,
    note: (m) => calls.notes.push(m),
    later: (fn) => calls.later.push(fn)
  }
  return { onDownloaded: createUpdatePrompt(deps), calls }
}

async function run() {
  console.log('\nUpdater')

  // 1. The reported crash: the first window closed, a second made from the Dock.
  {
    const first = makeWindow()
    first.destroy()
    const second = makeWindow()
    let current = second
    const { onDownloaded, calls } = harness({ getWindow: () => current })
    let threw = null
    try {
      onDownloaded({ version: '9.9.9' })
    } catch (e) {
      threw = e
    }
    await tick()
    check(!threw, `no crash after the window was closed and reopened${threw ? ` (${threw.message})` : ''}`)
    check(calls.shown.length === 1, 'the restart prompt is shown')
    check(calls.shown[0]?.win === second, 'and attached to the window that exists now')
    current.destroy()
  }

  // 2. Still holding the dead window — the exact shape of the old bug.
  {
    const dead = makeWindow()
    dead.destroy()
    const { onDownloaded, calls } = harness({ getWindow: () => dead })
    let threw = null
    try {
      onDownloaded({ version: '9.9.9' })
    } catch (e) {
      threw = e
    }
    await tick()
    check(!threw, 'a destroyed window reference does not throw')
    check(calls.shown.length === 1 && calls.shown[0].win === null, 'the prompt stands on its own instead')
    check(calls.focusApp === 1, 'and the app is brought forward so it can be seen')
  }

  // 3. No window at all: the app left running with every window closed.
  {
    const { onDownloaded, calls } = harness({ getWindow: () => null })
    onDownloaded({ version: '9.9.9' })
    await tick()
    check(calls.shown.length === 1 && calls.shown[0].win === null, 'with no window open, it still prompts')
  }

  // 4. A second download event while the prompt is up does not stack prompts.
  {
    let release
    const pending = new Promise((r) => (release = r))
    const { onDownloaded, calls } = harness({ getWindow: () => null, answer: () => pending })
    onDownloaded({ version: '9.9.9' })
    onDownloaded({ version: '9.9.9' })
    await tick()
    check(calls.shown.length === 1, 'a second download while the prompt is open does not stack a second')
    release({ response: 1 })
    await tick()
    onDownloaded({ version: '9.9.10' })
    await tick()
    check(calls.shown.length === 2, 'once answered, the next update prompts again')
  }

  // 5. The prompt itself failing must not silence the updater for the session.
  {
    const { onDownloaded, calls } = harness({
      getWindow: () => null,
      answer: (n) => (n === 1 ? Promise.reject(new Error('dialog refused')) : Promise.resolve({ response: 1 }))
    })
    onDownloaded({ version: '9.9.9' })
    await tick()
    check(calls.notes.some((m) => m.includes('dialog refused')), 'a prompt that fails to open is logged')
    onDownloaded({ version: '9.9.9' })
    await tick()
    check(calls.shown.length === 2, 'and the updater tries again next time rather than going quiet')
  }

  // 6. A synchronous throw while putting the prompt up — the old bug's mechanism.
  {
    let boom = true
    const { onDownloaded, calls } = harness({
      getWindow: () => {
        if (boom) throw new Error('Object has been destroyed')
        return null
      }
    })
    let threw = null
    try {
      onDownloaded({ version: '9.9.9' })
    } catch (e) {
      threw = e
    }
    check(!threw, 'a throw while showing the prompt does not escape as an uncaught exception')
    check(calls.notes.some((m) => m.includes('Object has been destroyed')), 'it is logged instead')
    boom = false
    onDownloaded({ version: '9.9.9' })
    await tick()
    check(calls.shown.length === 1, 'and the next update still prompts')
  }

  // 7. Restart: installs, and the "did not take" warning finds whichever window exists then.
  {
    let current = makeWindow()
    const { onDownloaded, calls } = harness({ getWindow: () => current, answer: { response: 0 } })
    onDownloaded({ version: '9.9.9' })
    await tick()
    check(calls.quit === 1, 'Restart now calls quitAndInstall')
    check(calls.later.length === 1, 'and schedules the warning for an install that does not happen')
    current.destroy()
    current = null
    let threw = null
    try {
      calls.later[0]()
    } catch (e) {
      threw = e
    }
    await tick()
    check(!threw, 'that warning does not crash if the window has gone in the meantime')
    check(calls.shown.length === 2 && calls.shown[1].win === null, 'and still appears')
  }

  // 8. What's new opens the release page for that version.
  {
    const { onDownloaded, calls } = harness({ getWindow: () => null, answer: { response: 2 } })
    onDownloaded({ version: '9.9.9' })
    await tick()
    check(calls.opened[0] === 'https://github.com/justynroberts/demodog/releases/tag/v9.9.9', "What's new opens that release")
  }

  // 9. The wiring, which the harness cannot reach: guard it in the source.
  {
    const updater = readFileSync(join(__dirname, '../src/main/updater.ts'), 'utf8')
    const index = readFileSync(join(__dirname, '../src/main/index.ts'), 'utf8')
    check(
      /export function setupUpdates\(\s*getWindow: \(\) => BrowserWindow \| null/.test(updater),
      'setupUpdates takes a window getter, not a window'
    )
    check(!/window\.on\('focus'/.test(updater), 'no focus listener is tied to a single window')
    check(updater.includes("app.on('browser-window-focus'"), 'the switch-back check listens on the app')
    check(/setupUpdates\(\s*\(\) => studioWindow/.test(index), 'the app hands the updater a getter')
  }

  finished = true
  console.log(failures ? red(`\n${failures} updater check(s) failed.\n`) : green('\nUpdater checks passed.\n'))
  app.exit(failures ? 1 : 0)
}

app.whenReady().then(() =>
  run().catch((e) => {
    console.error(red(`\nUpdater checks crashed: ${e.stack || e}\n`))
    app.exit(1)
  })
)
