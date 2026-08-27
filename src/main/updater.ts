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

let busy = false

export function setupUpdates(window: BrowserWindow, isRecording: () => boolean): void {
  // A build running from source has no version to compare against a release,
  // and would offer to "update" a dev tree to the last published dmg.
  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  // The restart is the user's call, so never install behind their back.
  autoUpdater.autoInstallOnAppQuit = false

  autoUpdater.on('update-downloaded', (info) => {
    if (busy) return
    busy = true
    // Brought forward first. The dialog is attached to the window, so if the
    // app is behind something else it is invisible — and an update that has
    // downloaded and is waiting on an answer nobody can see is indistinguishable
    // from an update that failed. That is exactly how this was reported.
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
    void dialog
      .showMessageBox(window, {
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
      .then((result) => {
        busy = false
        if (result.response === 0) {
          note('user chose to restart; calling quitAndInstall')
          try {
            // `isSilent` false so any installer failure is visible, and
            // `isForceRunAfter` true because the whole promise to the user was
            // that it comes back.
            // Nothing is torn down first, deliberately.
            //
            // This used to destroy every window before calling quitAndInstall,
            // added to fix a Restart button that "did nothing" — which turned
            // out to be a dialog hidden behind the app window, an unrelated
            // problem since fixed properly. What the teardown may have done
            // instead is end the process before Squirrel's install had begun:
            // on a machine where updates never installed, the log stops right
            // after the handover, the app exits, and ShipIt is never launched
            // at all — not refused, never attempted.
            //
            // quitAndInstall asks the app to quit by itself, which gives
            // Squirrel the moment it needs. Failure is caught by the warning
            // below rather than pre-empted by force.
            autoUpdater.quitAndInstall(false, true)
          } catch (error) {
            note(`quitAndInstall threw: ${String(error)}`)
          }
          // If the app is still here a moment later, the install did not take
          // and saying so beats a button that silently did nothing.
          // Long enough to be a real failure. Installing genuinely takes
          // around ten seconds, and warning inside that window would call a
          // working update broken.
          setTimeout(() => {
            note('still running after quitAndInstall')
            void dialog
              .showMessageBox(window, {
                type: 'warning',
                message: 'The update could not be installed',
                detail:
                  `DemoDog is still running ${info.version} rather than restarting, so ` +
                  'the update did not take effect.\n\nDownloading it by hand always ' +
                  'works, and takes about a minute.',
                // A way out, not a diagnosis. Telling someone to read a log file
                // is telling them to give up politely; the point of this dialog
                // is that they end up on the new version either way.
                buttons: ['Download it manually', 'Show me the log', 'Not now'],
                defaultId: 0,
                cancelId: 2
              })
              .then((choice) => {
                if (choice.response === 0) {
                  void shell.openExternal(
                    'https://github.com/justynroberts/demodog/releases/latest'
                  )
                } else if (choice.response === 1) {
                  shell.showItemInFolder(logPath)
                }
              })
          }, 25000)
        } else if (result.response === 2) {
          void shell.openExternal(
            `https://github.com/justynroberts/demodog/releases/tag/v${info.version}`
          )
        }
      })
  })

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
  window.on('focus', check)
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
