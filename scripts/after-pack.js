// MIT License - Copyright (c) fintonlabs.com
//
// Signs the Swift capture helper, before electron-builder seals the app around
// it.
//
// The helper is an extra resource rather than part of the Electron app, and
// under the hardened runtime an unsigned nested Mach-O binary will not launch —
// the app would install cleanly and then fail to record anything. Signing has to
// happen here because afterPack runs after the bundle is assembled but before
// the outer signature is applied.
//
// When there is no Developer ID to sign with, the whole bundle is ad-hoc signed
// instead. That is not a substitute: it satisfies nothing in Gatekeeper, and
// because the identity changes with every build macOS forgets the Screen
// Recording grant each time. It exists so a machine without a certificate can
// still produce something runnable.

const { execFileSync } = require('node:child_process')
const { existsSync } = require('node:fs')
const { join } = require('node:path')

/**
 * The identity to hand to `codesign` for the nested helper.
 *
 * electron-builder is configured with a bare name because it rejects the
 * "Developer ID Application:" prefix and picks the certificate itself. codesign
 * has no such logic: a bare name matches every certificate issued to the same
 * person — Apple Development, Apple Distribution and Developer ID alike — and
 * it refuses an ambiguous match. So the prefix goes back on here.
 */
function developerIdentity(context) {
  const explicit = process.env.DEMODOG_SIGN_IDENTITY
  if (explicit) return explicit
  const configured = context.packager.platformSpecificBuildOptions.identity ?? process.env.CSC_NAME
  if (!configured) return null
  return configured.includes(':') ? configured : `Developer ID Application: ${configured}`
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return

  const appName = context.packager.appInfo.productFilename
  const appPath = join(context.appOutDir, `${appName}.app`)
  const identifier = context.packager.appInfo.id
  const identity = developerIdentity(context)
  const helper = join(appPath, 'Contents', 'Resources', 'bin', 'demodog-recorder')
  const entitlements = join(context.packager.projectDir, 'build', 'entitlements.mac.plist')

  if (identity) {
    if (!existsSync(helper)) {
      console.warn('  • capture helper missing from the bundle; not signing it')
      return
    }
    // Runtime hardening on the helper too, or the hardened parent cannot spawn it.
    execFileSync(
      'codesign',
      [
        '--force',
        '--timestamp',
        '--options', 'runtime',
        '--entitlements', entitlements,
        '--sign', identity,
        helper
      ],
      { stdio: 'inherit' }
    )
    console.log('  • signed the capture helper with the Developer ID')
    return
  }

  try {
    execFileSync(
      'codesign',
      ['--force', '--deep', '--sign', '-', '--identifier', identifier, appPath],
      { stdio: 'inherit' }
    )
    console.log(`  • no Developer ID found; ad-hoc signed as ${identifier}`)
  } catch (error) {
    console.warn(`  • ad-hoc signing failed: ${error.message}`)
  }
}
