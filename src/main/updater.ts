// MIT License - Copyright (c) fintonlabs.com
import { app, dialog, shell } from 'electron'
import type { BrowserWindow } from 'electron'
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import electronUpdater from 'electron-updater'

/**
 * Checks GitHub Releases for a newer build and offers to install it.
 *
 * Deliberately quiet and deliberately manual about the last step. Downloading
 * in the background is fine — it costs the user nothing and makes the update
 * instant when they accept — but restarting is not something to do to someone
 * mid-recording, so the install always waits for an answer.
 *
 * There is no check while a recording is in progress. An update dialog stealing
 * focus is bad enough on its own; during a take it would be captured into the
 * recording.
 */

const { autoUpdater } = electronUpdater

/**
 * Updates fail where nobody can see them.
 *
 * A packaged app has no console, so an update that downloads and then refuses
 * to install leaves the user with a dialog that does nothing and no way to say
 * why. Everything the updater reports goes to a file next to the app's other
 * logs, and `quitAndInstall` is bracketed so its own failure is recorded rather
 * than lost.
 */
const logPath = join(app.getPath('logs'), 'updater.log')

function note(message: string): void {
  const line = `${new Date().toISOString()} ${message}\n`
  try {
    mkdirSync(app.getPath('logs'), { recursive: true })
    appendFileSync(logPath, line)
  } catch {
    // Logging must never be the thing that breaks an update.
  }
  console.log(`[update] ${message}`)
}

autoUpdater.logger = {
  info: (m: unknown) => note(`info  ${String(m)}`),
  warn: (m: unknown) => note(`warn  ${String(m)}`),
  error: (m: unknown) => note(`error ${String(m)}`),
  debug: (m: unknown) => note(`debug ${String(m)}`)
}

/** How long after launch to look, so it never competes with starting up. */
const FIRST_CHECK_DELAY = 8_000
/**
 * And then every couple of hours.
 *
 * It was daily, which sounds harmless and is not: a release published while the
 * app is open goes unnoticed until tomorrow, so "it didn't update" is the
 * expected behaviour rather than a fault. Two hours costs a request nobody
 * notices and removes a whole day of staleness.
 */
const RECHECK_INTERVAL = 2 * 60 * 60 * 1000

/** Never check more often than this, however many times focus changes. */
const MIN_GAP = 20 * 60 * 1000

/**
 * Everything the restart prompt touches outside itself.
 *
 * Injected rather than imported so the prompt can be run in real Electron with
 * real windows but without a real dialog, a real install or a real download —
 * which is what `npm run verify:updater` does. The crash this exists to prevent
 * was invisible to every other check: it only happens after a window has been
 * closed and remade, days into a session, at the moment an update lands.
 */
export interface PromptDeps {
  getWindow: () => BrowserWindow | null
  showMessageBox: (
    win: BrowserWindow | null,
    options: Electron.MessageBoxOptions
  ) => Promise<Electron.MessageBoxReturnValue>
  focusApp: () => void
  quitAndInstall: () => void
  openExternal: (url: string) => void
  revealLog: () => void
  note: (message: string) => void
  later: (fn: () => void, ms: number) => void
}

/** The studio window if there is a live one; null if it was closed. */
export function live(getWindow: () => BrowserWindow | null): BrowserWindow | null {
  const win = getWindow()
  return win && !win.isDestroyed() ? win : null
}

/**
 * Builds the `update-downloaded` handler.
 *
 * The window is asked for each time, never captured. It used to be handed over
 * once at launch; close that window and reopen from the Dock — ordinary for an
 * app left running for days — and the updater held a destroyed window. When an
 * update finished downloading, `isMinimized()` threw "Object has been
 * destroyed", the prompt never appeared, and `busy` stayed set so it never
 * would for the rest of the session.
 *
 * Anything that throws while putting the prompt up — synchronously or not —
 * is logged and releases `busy`, so one failure cannot silence every later
 * update.
 */
export function createUpdatePrompt(deps: PromptDeps): (info: { version: string }) => void {
  let busy = false

  /**
   * A dialog attached to the window when there is one, free-standing when
   * there is not, with the app brought forward either way — a prompt nobody can
   * see is the same as no prompt.
   */
  const ask = (
    options: Electron.MessageBoxOptions
  ): Promise<Electron.MessageBoxReturnValue> => {
    const win = live(deps.getWindow)
    if (win) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    } else {
      deps.focusApp()
    }
    return deps.showMessageBox(win, options)
  }

  const failed = (error: unknown): void => {
    busy = false
    deps.note(`could not show the restart prompt: ${String(error)}`)
  }

  return (info) => {
    if (busy) return
    busy = true

    let prompt: Promise<Electron.MessageBoxReturnValue>
    try {
      prompt = ask({
        type: 'info',
        message: `DemoDog ${info.version} is ready to install`,
        detail:
          'DemoDog will close, swap itself for the new version, and reopen. ' +
          'It stays closed for about ten seconds in the middle — that gap is ' +
          'the installer working, not a crash.\n\nAnything you have recorded ' +
          'is saved and will still be there afterwards.',
        buttons: ['Restart now', 'Later', "What's new"],
        defaultId: 0,
        cancelId: 1
      })
    } catch (error) {
      failed(error)
      return
    }

    prompt
      .then((result) => {
        busy = false
        if (result.response === 0) {
          deps.note('user chose to restart; calling quitAndInstall')
          try {
            // Nothing is torn down first, deliberately: quitAndInstall asks the
            // app to quit by itself, which gives Squirrel the moment it needs.
            // Destroying windows first once ended the process before the
            // install had begun, and ShipIt was never launched at all.
            deps.quitAndInstall()
          } catch (error) {
            deps.note(`quitAndInstall threw: ${String(error)}`)
          }
          // Still here long after a genuine install would have finished: say
          // so, with a way out, rather than leave a button that did nothing.
          // The window is looked up again here too — it may be gone by now.
          deps.later(() => {
            deps.note('still running after quitAndInstall')
            try {
              void ask({
                type: 'warning',
                message: 'The update could not be installed',
                detail:
                  `DemoDog is still running ${info.version} rather than restarting, so ` +
                  'the update did not take effect.\n\nDownloading it by hand always ' +
                  'works, and takes about a minute.',
                buttons: ['Download it manually', 'Show me the log', 'Not now'],
                defaultId: 0,
                cancelId: 2
              })
                .then((choice) => {
                  if (choice.response === 0) {
                    deps.openExternal('https://github.com/justynroberts/demodog/releases/latest')
                  } else if (choice.response === 1) {
                    deps.revealLog()
                  }
                })
                .catch((error) => deps.note(`could not show the install warning: ${String(error)}`))
            } catch (error) {
              deps.note(`could not show the install warning: ${String(error)}`)
            }
          }, 25000)
        } else if (result.response === 2) {
          deps.openExternal(
            `https://github.com/justynroberts/demodog/releases/tag/v${info.version}`
          )
        }
      })
      .catch(failed)
  }
}

/** Checks for, downloads and offers updates for the installed app. */
export function setupUpdates(
  getWindow: () => BrowserWindow | null,
  isRecording: () => boolean
): void {
  // A build running from source has no version to compare against a release,
  // and would offer to "update" a dev tree to the last published dmg.
  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  // The restart is the user's call, so never install behind their back.
  autoUpdater.autoInstallOnAppQuit = false

  autoUpdater.on(
    'update-downloaded',
    createUpdatePrompt({
      getWindow,
      showMessageBox: (win, options) =>
        win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options),
      focusApp: () => app.focus({ steal: true }),
      // `isSilent` false so an installer failure is visible; `isForceRunAfter`
      // true because the promise to the user was that it comes back.
      quitAndInstall: () => autoUpdater.quitAndInstall(false, true),
      openExternal: (url) => void shell.openExternal(url),
      revealLog: () => shell.showItemInFolder(logPath),
      note,
      later: (fn, ms) => void setTimeout(fn, ms)
    })
  )

  // Failures are silent on purpose: being offline, or behind a proxy that
  // blocks GitHub, is not something to interrupt someone about. It is logged
  // so it can still be diagnosed.
  autoUpdater.on('error', (error) => {
    note(`check failed: ${error.message}`)
  })

  autoUpdater.on('update-available', (info) => note(`update available: ${info.version}`))
  autoUpdater.on('update-not-available', () => note('no update available'))
  autoUpdater.on('download-progress', (p) => note(`downloading ${Math.round(p.percent)}%`))

  let lastCheck = 0
  const check = (): void => {
    if (isRecording()) return
    const now = Date.now()
    if (now - lastCheck < MIN_GAP) return
    lastCheck = now
    autoUpdater.checkForUpdates().catch(() => undefined)
  }

  setTimeout(check, FIRST_CHECK_DELAY)
  setInterval(check, RECHECK_INTERVAL)
  // Coming back to the app is the moment someone is most likely to be about to
  // use it, and the cheapest opportunity to notice a release published while
  // they were elsewhere. Rate limited, since focus changes constantly.
  //
  // On the app rather than one window, so a window made later from the Dock
  // counts too.
  app.on('browser-window-focus', check)
}

/** Menu-driven check, which does report when there is nothing to report. */
export async function checkForUpdatesNow(window: BrowserWindow): Promise<void> {
  if (!app.isPackaged) {
    await dialog.showMessageBox(window, {
      type: 'info',
      message: 'Running from source',
      detail: 'Updates only apply to an installed copy of DemoDog.',
      buttons: ['OK']
    })
    return
  }
  try {
    const result = await autoUpdater.checkForUpdates()
    // `updateInfo.version` matches the running version when there is nothing
    // newer; electron-updater reports a result either way.
    if (!result || result.updateInfo.version === app.getVersion()) {
      await dialog.showMessageBox(window, {
        type: 'info',
        message: 'DemoDog is up to date',
        detail: `You are running ${app.getVersion()}.`,
        buttons: ['OK']
      })
    }
    // A newer version downloads in the background and announces itself through
    // the `update-downloaded` handler above.
  } catch (error) {
    await dialog.showMessageBox(window, {
      type: 'warning',
      message: 'Could not check for updates',
      detail: error instanceof Error ? error.message : String(error),
      buttons: ['OK']
    })
  }
}
