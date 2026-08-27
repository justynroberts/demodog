// MIT License - Copyright (c) fintonlabs.com
//
// Submits the signed app to Apple for notarisation, if credentials are
// available.
//
// Notarisation is what removes the Gatekeeper warning on other people's
// machines. It needs an Apple ID and an app-specific password, so this is
// deliberately opt-in rather than required: without credentials the build still
// produces a properly signed app, it just carries the "unidentified developer"
// prompt.
//
// Provide credentials either way:
//
//   xcrun notarytool store-credentials "notarytool" \
//     --apple-id <apple-id> --team-id <team-id>
//
// or by exporting APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD and APPLE_TEAM_ID.

const { notarize } = require('@electron/notarize')
const { execFileSync } = require('node:child_process')
const { join } = require('node:path')

const KEYCHAIN_PROFILE = process.env.NOTARYTOOL_PROFILE ?? 'notarytool'

/** True when `notarytool` already has a stored credential profile. */
function hasKeychainProfile() {
  try {
    execFileSync('xcrun', ['notarytool', 'history', '--keychain-profile', KEYCHAIN_PROFILE], {
      stdio: 'ignore'
    })
    return true
  } catch {
    return false
  }
}

exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return

  // Nothing to notarise if the bundle was only ad-hoc signed.
  const identity = context.packager.platformSpecificBuildOptions.identity ?? process.env.CSC_NAME
  if (!identity) {
    console.log('  • skipping notarisation: the app is not signed with a Developer ID')
    return
  }

  const appName = context.packager.appInfo.productFilename
  const appPath = join(context.appOutDir, `${appName}.app`)
  const appBundleId = context.packager.appInfo.id

  const env = process.env
  const useEnv = Boolean(env.APPLE_ID && env.APPLE_APP_SPECIFIC_PASSWORD && env.APPLE_TEAM_ID)
  const useProfile = !useEnv && hasKeychainProfile()

  if (!useEnv && !useProfile) {
    console.log(
      '  • skipping notarisation: no credentials.\n' +
        `    Run: xcrun notarytool store-credentials "${KEYCHAIN_PROFILE}" --apple-id <id> --team-id <team>`
    )
    return
  }

  console.log(`  • notarising ${appName}.app — this takes a few minutes`)
  await notarize({
    appPath,
    appBundleId,
    ...(useEnv
      ? {
          appleId: env.APPLE_ID,
          appleIdPassword: env.APPLE_APP_SPECIFIC_PASSWORD,
          teamId: env.APPLE_TEAM_ID
        }
      : { keychainProfile: KEYCHAIN_PROFILE })
  })
  console.log('  • notarised and stapled')
}
