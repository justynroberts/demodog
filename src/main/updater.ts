// MIT License - Copyright (c) fintonlabs.com
import { app, dialog, shell } from 'electron'
import type { BrowserWindow } from 'electron'
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

/** How long after launch to look, so it never competes with starting up. */
const FIRST_CHECK_DELAY = 8_000
/** And then daily, for a session left running for days. */
const RECHECK_INTERVAL = 24 * 60 * 60 * 1000

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
    void dialog
      .showMessageBox(window, {
        type: 'info',
        message: `DemoDog ${info.version} is ready to install`,
        detail:
          'The update has already been downloaded. DemoDog will restart to ' +
          'finish installing it.\n\nAnything you have recorded is saved and ' +
          'will still be there afterwards.',
        buttons: ['Restart now', 'Later', "What's new"],
        defaultId: 0,
        cancelId: 1
      })
      .then((result) => {
        busy = false
        if (result.response === 0) {
          autoUpdater.quitAndInstall()
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
    console.warn(`[update] check failed: ${error.message}`)
  })

  const check = (): void => {
    if (isRecording()) return
    autoUpdater.checkForUpdates().catch(() => undefined)
  }

  setTimeout(check, FIRST_CHECK_DELAY)
  setInterval(check, RECHECK_INTERVAL)
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
