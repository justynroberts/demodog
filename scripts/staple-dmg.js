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
//
// Stapling rewrites the file, and electron-builder has already hashed it by
// then to produce latest-mac.yml. Publishing that unchanged would advertise a
// checksum the downloaded file cannot match, and every auto-update would fail
// verification — so the update metadata is regenerated from the stapled bytes.

const { execFileSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const { existsSync, readFileSync, writeFileSync } = require('node:fs')
const { basename, dirname, join } = require('node:path')

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

/** The identity codesign needs, with the prefix electron-builder strips. */
function developerIdentity(context) {
  const explicit = process.env.DEMODOG_SIGN_IDENTITY
  if (explicit) return explicit
  const configured =
    context.packager?.config?.mac?.identity ??
    context.configuration?.mac?.identity ??
    process.env.CSC_NAME
  if (!configured) return null
  return configured.includes(':') ? configured : `Developer ID Application: ${configured}`
}

exports.default = async function afterAllArtifactBuild(context) {
  const images = (context.artifactPaths ?? []).filter((path) => path.endsWith('.dmg'))
  if (images.length === 0) return []

  if (!hasKeychainProfile()) {
    console.log('  • skipping dmg notarisation: no notarytool credentials')
    return []
  }

  const identity = developerIdentity(context)

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

    // Sign before submitting, and only in that order: stapling attaches the
    // ticket to the file, so signing afterwards would invalidate it. An
    // unsigned disk image can still be notarised, but Gatekeeper assesses it as
    // having no usable signature, which is a warning on the way in for
    // something that is otherwise perfectly trusted.
    if (identity) {
      execFileSync('codesign', ['--force', '--timestamp', '--sign', identity, image], {
        stdio: 'inherit'
      })
      console.log('  • signed the disk image')
    }

    console.log(`  • notarising ${image}`)
    execFileSync(
      'xcrun',
      ['notarytool', 'submit', image, '--keychain-profile', KEYCHAIN_PROFILE, '--wait'],
      { stdio: 'inherit' }
    )
    execFileSync('xcrun', ['stapler', 'staple', image], { stdio: 'inherit' })
    console.log('  • dmg notarised and stapled')
    refreshUpdateMetadata(image)
  }

  return []
}

/**
 * Rewrites latest-mac.yml to match the file as it now stands on disk.
 *
 * electron-updater verifies the download against the sha512 in this file and
 * refuses anything that does not match. Since stapling changes the dmg after
 * that hash was taken, the recorded one is stale the moment the ticket is
 * attached.
 */
function refreshUpdateMetadata(image) {
  const manifest = join(dirname(image), 'latest-mac.yml')
  if (!existsSync(manifest)) return

  const data = readFileSync(image)
  const sha512 = createHash('sha512').update(data).digest('base64')
  const name = basename(image)

  let text = readFileSync(manifest, 'utf8')
  // Only the entries describing this image; a build may emit several.
  let replacements = 0
  text = text.replace(/sha512: .*/g, () => {
    replacements++
    return `sha512: ${sha512}`
  })
  text = text.replace(/size: \d+/g, `size: ${data.byteLength}`)

  writeFileSync(manifest, text)
  console.log(`  • update metadata refreshed for ${name} (${replacements} hashes)`)
}
