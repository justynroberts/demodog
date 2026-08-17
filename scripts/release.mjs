// MIT License - Copyright (c) fintonlabs.com
//
// The only thing in this repository that ships anything.
//
// Building and publishing were the same habit for a while, which is fine until
// people are running the app: every merged change became a release, and every
// release reached everyone automatically, because the updater reads whatever
// the latest GitHub release is. Ordinary commits are now inert — `npm run dist`
// builds and stops — and shipping takes this command, a version, and a reason
// to run it.
//
//   npm run release -- 1.0.0
//   npm run release -- 1.0.0 --dry-run     # everything except tag and publish
//
// It refuses rather than guesses: a dirty tree, a version that already exists,
// a failing check, or an unnotarised artifact all stop it before anything
// becomes visible.

import { execFileSync, execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const version = args.find((a) => /^\d+\.\d+\.\d+$/.test(a))

const red = (s) => `\x1b[31m${s}\x1b[0m`
const green = (s) => `\x1b[32m${s}\x1b[0m`
const dim = (s) => `\x1b[2m${s}\x1b[0m`

function die(message, detail) {
  console.error(`\n${red('✗')} ${message}`)
  if (detail) console.error(dim(`  ${detail}`))
  process.exit(1)
}

function step(message) {
  console.log(`\n${green('▸')} ${message}`)
}

function sh(command, options = {}) {
  return execSync(command, { stdio: 'inherit', ...options })
}

function capture(command) {
  return execSync(command, { encoding: 'utf8' }).trim()
}

if (!version) {
  die(
    'a version is required',
    'npm run release -- 1.0.0        (or add --dry-run to rehearse it)'
  )
}

// ---- refuse early, before anything is built --------------------------------

step('Checking the tree is clean')
if (capture('git status --porcelain') !== '') {
  die(
    'the working tree has uncommitted changes',
    'a release must correspond to a commit, or nobody can tell what shipped'
  )
}

const branch = capture('git rev-parse --abbrev-ref HEAD')
if (branch !== 'main') {
  console.log(dim(`  on ${branch}, not main — continuing, but this is unusual`))
}

step('Checking the version is new')
const tags = capture('git tag --list')
  .split('\n')
  .map((t) => t.trim())
if (tags.includes(`v${version}`)) {
  die(`v${version} already exists as a tag`, 'pick a later version')
}

// ---- prove it works before making it visible -------------------------------

step('Type checking')
sh('npm run typecheck')

step('Running the engine and export checks')
sh('npm run verify')

step(`Setting the version to ${version}`)
sh(`npm version ${version} --no-git-tag-version`)

step('Building, signing, notarising and stapling')
sh('npm run dist')

// ---- verify the artifacts, not the intention -------------------------------

const dmg = join('release', `DemoDog-${version}-universal.dmg`)
const zip = join('release', `DemoDog-${version}-universal.zip`)
const manifest = join('release', 'latest-mac.yml')

step('Verifying the artifacts')
for (const file of [dmg, zip, manifest]) {
  if (!existsSync(file)) die(`${file} was not produced`)
}

for (const file of [dmg, zip]) {
  // The manifest is what the updater trusts; a stale hash means every update
  // downloads and is silently discarded.
  const data = readFileSync(file)
  const sha = createHash('sha512').update(data).digest('base64')
  const text = readFileSync(manifest, 'utf8')
  if (!text.includes(sha) || !text.includes(String(data.byteLength))) {
    die(
      `${file} does not match latest-mac.yml`,
      'stapling rewrites the file after electron-builder hashes it'
    )
  }
}
console.log('  update manifest matches both artifacts')

execFileSync('xcrun', ['stapler', 'validate', dmg], { stdio: 'ignore' })
console.log('  disk image carries its notarisation ticket')

const assessment = execSync(
  `spctl -a -vvv -t open --context context:primary-signature ${dmg} 2>&1 || true`,
  { encoding: 'utf8' }
)
if (!assessment.includes('Notarized Developer ID')) {
  die('Gatekeeper does not accept the disk image', assessment.trim())
}
console.log('  Gatekeeper accepts it as a notarised Developer ID build')

if (dryRun) {
  console.log(
    `\n${green('✓')} ${version} is built and verified. Nothing was tagged or published.` +
      `\n  ${dim(`artifacts in release/, version bumped in package.json`)}\n`
  )
  process.exit(0)
}

// ---- only now does any of it become visible --------------------------------

step('Committing, tagging and publishing')
sh(`git add -A && git commit -m "Release ${version}"`)
sh('git push origin main')
sh(`git tag -a v${version} -m "DemoDog ${version}"`)
sh(`git push origin v${version}`)

const notes = join('release', 'NOTES.md')
const notesArg = existsSync(notes) ? `--notes-file ${notes}` : '--generate-notes'
sh(
  `gh release create v${version} ${dmg} ${zip} ${manifest} ` +
    `--title "DemoDog ${version}" ${notesArg}`
)

console.log(
  `\n${green('✓')} DemoDog ${version} published.` +
    `\n  Everyone on an older build will be offered it automatically.\n`
)
