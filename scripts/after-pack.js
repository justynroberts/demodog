// MIT License - Copyright (c) fintonlabs.com
//
// Ad-hoc signs the packaged app with its own bundle identifier.
//
// Without this the bundle keeps the signature it inherited from the Electron
// binary, whose identifier is literally "Electron". macOS files privacy grants
// against the code identity, so a screen-recording permission granted to the
// app would be recorded under a generic name — and could collide with any other
// unsigned Electron app, including this project's own dev build.
//
// This is not a substitute for a Developer ID: the app is still unsigned as far
// as Gatekeeper is concerned, and the grant will be invalidated whenever the
// binary changes. It just makes the identity correct and stable within a build.

const { execFileSync } = require('node:child_process')
const { join } = require('node:path')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return

  const appName = context.packager.appInfo.productFilename
  const appPath = join(context.appOutDir, `${appName}.app`)
  const identifier = context.packager.appInfo.id

  try {
    execFileSync(
      'codesign',
      ['--force', '--deep', '--sign', '-', '--identifier', identifier, appPath],
      { stdio: 'inherit' }
    )
    console.log(`  • ad-hoc signed as ${identifier}`)
  } catch (error) {
    // Not fatal: the app still runs, it just has a generic identity.
    console.warn(`  • ad-hoc signing failed: ${error.message}`)
  }
}
