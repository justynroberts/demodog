// MIT License - Copyright (c) fintonlabs.com
//
// Notarises and staples the finished .dmg.
//
// The afterSign hook notarises the *app*, which is what Gatekeeper checks once
// the app has been dragged to Applications. The disk image it arrives in is a
// separate artifact with its own signature and its own ticket, and it does not
// inherit the app's. An unstapled dmg still passes on a machine that can reach
// Apple to check, and fails on one that cannot — which is the worst kind of
// bug, because it never reproduces where it was built.
//
// This runs after every artifact is built, so it needs to pick the dmg out and
// ignore the blockmap and anything else alongside it.

const { execFileSync } = require('node:child_process')

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

exports.default = async function afterAllArtifactBuild(context) {
  const images = (context.artifactPaths ?? []).filter((path) => path.endsWith('.dmg'))
  if (images.length === 0) return []

  if (!hasKeychainProfile()) {
    console.log('  • skipping dmg notarisation: no notarytool credentials')
    return []
  }

  for (const image of images) {
    // Already stapled: the app inside was notarised, so this submission is
    // usually quick, but there is no point repeating it.
    try {
      execFileSync('xcrun', ['stapler', 'validate', image], { stdio: 'ignore' })
      console.log(`  • ${image} is already stapled`)
      continue
    } catch {
      // Not stapled yet, which is the normal case.
    }

    console.log(`  • notarising ${image}`)
    execFileSync(
      'xcrun',
      ['notarytool', 'submit', image, '--keychain-profile', KEYCHAIN_PROFILE, '--wait'],
      { stdio: 'inherit' }
    )
    execFileSync('xcrun', ['stapler', 'staple', image], { stdio: 'inherit' })
    console.log('  • dmg notarised and stapled')
  }

  return []
}
