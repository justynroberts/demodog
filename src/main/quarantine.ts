// MIT License - Copyright (c) fintonlabs.com
import { app } from 'electron'
import { execFile, execFileSync } from 'node:child_process'
import { dirname } from 'node:path'

/**
 * Removes the quarantine flag macOS puts on anything downloaded from a browser.
 *
 * Gatekeeper clears the way for the *app* once someone opens it, but the flag
 * stays on the bundle and is inherited by everything nested inside — including
 * `ShipIt`, the small program Squirrel launches through launchd to swap the app
 * during an update. A quarantined ShipIt is refused, silently: the app quits as
 * asked, nothing installs, nothing relaunches, and no log is written because
 * the thing that writes it never ran.
 *
 * That is not a hypothetical. It is what happened on a machine that downloaded
 * the dmg with Chrome, and it will happen to anyone who does, because everyone
 * downloads with a browser. Notarisation does not prevent it — the build was
 * notarised and its signature verified on that machine.
 *
 * Clearing the attribute is safe: extended attributes are not part of the code
 * signature, so the app is exactly as signed and as notarised afterwards. It
 * only ever touches DemoDog's own bundle.
 */
export function clearQuarantine(): void {
  if (process.platform !== 'darwin' || !app.isPackaged) return

  // .../DemoDog.app/Contents/MacOS/DemoDog -> .../DemoDog.app
  const bundle = dirname(dirname(dirname(app.getPath('exe'))))
  if (!bundle.endsWith('.app')) return

  try {
    // Cheap check first: the attribute is absent on most launches, and this
    // avoids spawning anything at all in the common case.
    execFileSync('xattr', ['-p', 'com.apple.quarantine', bundle], { stdio: 'ignore' })
  } catch {
    return
  }

  // Recursive, because the flag on the nested binaries is the part that blocks
  // the update; the one on the bundle root is merely how it got there.
  execFile('xattr', ['-dr', 'com.apple.quarantine', bundle], (error) => {
    console.log(
      error
        ? `[quarantine] could not clear it: ${error.message}`
        : '[quarantine] cleared; updates can install'
    )
  })
}
