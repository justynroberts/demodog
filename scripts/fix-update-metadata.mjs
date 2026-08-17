// MIT License - Copyright (c) fintonlabs.com
//
// Rewrites latest-mac.yml so every hash matches the artifact as it now stands.
//
// Stapling a notarisation ticket rewrites the disk image, and electron-builder
// hashes the image before that happens — it writes latest-mac.yml *after* the
// afterAllArtifactBuild hook returns, so a hook cannot fix it either. The result
// is a manifest advertising a checksum the download cannot match, and
// electron-updater refuses anything that fails verification. Silently: the app
// finds an update, downloads it, discards it, and reports nothing.
//
// So this runs last, from the `dist` script, once every artifact is final. It
// reads the manifest, and for each file it names, recomputes size and sha512
// from the bytes actually on disk.

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const manifestPath = process.argv[2] ?? 'release/latest-mac.yml'

if (!existsSync(manifestPath)) {
  console.log(`[update-metadata] no ${manifestPath}; nothing to do`)
  process.exit(0)
}

const dir = dirname(manifestPath)
const text = readFileSync(manifestPath, 'utf8')
const lines = text.split('\n')

/** sha512, base64, as electron-updater expects it. */
function digest(file) {
  return createHash('sha512').update(readFileSync(file)).digest('base64')
}

// The manifest lists each artifact as a `- url:` entry followed by its own
// sha512 and size, and then repeats the primary one at the top level. Matching
// per entry rather than replacing every hash in the file is the point: a blanket
// replace gives the zip the disk image's checksum, which is the same bug wearing
// a different hat.
let current = null
let changed = 0
const out = lines.map((line) => {
  const url = line.match(/^\s*-\s*url:\s*(.+)\s*$/)
  if (url) {
    const candidate = join(dir, url[1].trim())
    current = existsSync(candidate) ? candidate : null
    return line
  }
  if (!current) return line

  const sha = line.match(/^(\s*)sha512:\s*(.+)\s*$/)
  if (sha) {
    const fresh = digest(current)
    if (fresh !== sha[2].trim()) changed++
    return `${sha[1]}sha512: ${fresh}`
  }
  const size = line.match(/^(\s*)size:\s*(\d+)\s*$/)
  if (size) {
    const fresh = readFileSync(current).byteLength
    if (String(fresh) !== size[2]) changed++
    return `${size[1]}size: ${fresh}`
  }
  return line
})

// The top-level `path` / `sha512` pair repeats whichever artifact the updater
// should prefer, and has to agree with the entry above it.
const pathLine = out.find((l) => /^path:\s*/.test(l))
if (pathLine) {
  const primary = join(dir, pathLine.replace(/^path:\s*/, '').trim())
  if (existsSync(primary)) {
    const fresh = digest(primary)
    for (let i = 0; i < out.length; i++) {
      if (/^sha512:\s*/.test(out[i])) {
        if (out[i] !== `sha512: ${fresh}`) changed++
        out[i] = `sha512: ${fresh}`
      }
    }
  }
}

writeFileSync(manifestPath, out.join('\n'))
console.log(
  changed > 0
    ? `[update-metadata] corrected ${changed} value(s) in ${manifestPath}`
    : `[update-metadata] ${manifestPath} already matched the artifacts`
)
