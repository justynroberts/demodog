# Releasing DemoDog

The whole path from a clean tree to a downloadable, self-updating build. Every
step here exists because skipping it broke a release once.

## Prerequisites, one time only

**Developer ID certificate** in the login keychain:

```bash
security find-identity -v -p codesigning | grep "Developer ID Application"
```

`package.json` → `build.mac.identity` holds the **bare** name
(`Justyn Roberts (2H574B6N62)`). electron-builder rejects the
`Developer ID Application:` prefix; `codesign` needs it, so `scripts/after-pack.js`
adds it back. Do not "fix" either one to match the other.

**Notarytool credentials**, stored by the user, never by an assistant:

```bash
xcrun notarytool store-credentials "notarytool" \
  --apple-id <apple-id> --team-id 2H574B6N62
```

This fails with **HTTP 403, "a required agreement is missing or has expired"**
until the Apple Developer Program License Agreement is accepted at
developer.apple.com/account — by the **Account Holder**, not an Admin. The 403 is
about the account, never about the app.

## Nothing ships by accident

DemoDog updates itself from the latest GitHub **release**, so that — not `main`,
not a tag on its own — is what reaches people. Commit and push as often as you
like; none of it is visible until a release exists.

- `npm run dist` builds, signs, notarises and staples **locally**. It carries
  `--publish never`, because electron-builder will otherwise publish on its own
  when a provider is configured, the commit is tagged and a token is in the
  environment.
- `npm run release -- <version>` is the only thing that publishes.

Finished work waits in `CHANGELOG.md` under **Unreleased** until then.

## Release

```bash
npm run release -- 1.0.0 --dry-run   # build and verify, publish nothing
npm run release -- 1.0.0             # the real thing
```

The script refuses rather than guesses: a dirty tree, a version that already has
a tag, a failing check, a manifest that disagrees with its artifacts, or a disk
image Gatekeeper will not accept all stop it before anything becomes visible.
Release notes come from `release/NOTES.md` if it exists.

Doing it by hand, which is what the script automates:

```bash
npm run typecheck            # both tsconfig projects
npm run verify               # engine checks, then a real export of the fixture
npm version 1.0.0 --no-git-tag-version
npm run dist                 # universal, signed, notarised, stapled
```

`npm run dist` runs, in order:

1. `DEMODOG_UNIVERSAL=1 npm run build` — Swift helper for **both** architectures
   (lipo'd), then main, preload, renderer.
2. `scripts/after-pack.js` — signs the nested Swift helper. A hardened parent
   cannot spawn an unsigned nested Mach-O, so without this the app installs and
   then records nothing.
3. `scripts/notarize.js` (afterSign) — notarises the **app**.
4. `scripts/staple-dmg.js` (afterAllArtifactBuild) — signs, notarises and
   staples the **dmg**, then rewrites `latest-mac.yml`.

Then publish:

```bash
export GH_TOKEN=$(gh auth token)
git add -A && git commit -m "Release 0.9.0" && git push origin main
git tag -a v0.9.0 -m "DemoDog 0.9.0" && git push origin v0.9.0
gh release create v0.9.0 \
  release/DemoDog-0.9.0-universal.dmg \
  release/DemoDog-0.9.0-universal-mac.zip \
  release/latest-mac.yml \
  --title "DemoDog 0.9.0" --notes-file <notes>
```

## Verify before announcing

```bash
lipo -archs release/mac-universal/DemoDog.app/Contents/MacOS/DemoDog          # x86_64 arm64
lipo -archs release/mac-universal/DemoDog.app/Contents/Resources/bin/demodog-recorder
xcrun stapler validate release/DemoDog-<v>-universal.dmg
```

Then the only check that reflects what a user gets — quarantine it the way a
download is quarantined, and ask Gatekeeper:

```bash
cp release/DemoDog-<v>-universal.dmg /tmp/dl.dmg
xattr -w com.apple.quarantine "0083;00000000;Safari;" /tmp/dl.dmg
spctl -a -vvv -t open --context context:primary-signature /tmp/dl.dmg   # accepted
MNT=$(hdiutil attach -nobrowse -readonly /tmp/dl.dmg | grep Volumes | awk -F'\t' '{print $NF}')
spctl -a -vvv -t install "$MNT/DemoDog.app"                            # accepted
hdiutil detach "$MNT"
```

Both must say `source=Notarized Developer ID`.

## Things that cost hours, once each

**Sign the dmg, not only the app.** They are separate artifacts with separate
signatures and separate tickets, and the dmg does not inherit the app's. An
unsigned-but-notarised dmg passes on a machine that can reach Apple and fails on
one that cannot. Order matters: **sign → notarise → staple**. Stapling after
signing is fine; signing after stapling destroys the ticket.

**Re-hash after stapling.** electron-builder writes `latest-mac.yml` when it
builds the dmg; stapling then rewrites the file. Publishing the original hash
advertises a checksum the download cannot match and every auto-update fails
verification. `scripts/staple-dmg.js` regenerates it.

**Ship the zip.** macOS applies updates from the zip, never the dmg. With dmg as
the only target the updater finds a release it cannot install and silently does
nothing.

**Notary uploads drop.** `Connection reset by peer` and `The network connection
was lost` on a 185 MB upload are routine. Re-run; it is not a build problem. To
resume by hand:

```bash
xcrun notarytool submit release/<file> --keychain-profile notarytool --wait
xcrun stapler staple release/<file>
```

**Never install with `cp -R`.** It breaks the bundle signature
(`code has no resources but signature indicates they must be present`), and a
broken signature means TCC will never grant screen recording. Use `ditto`.

**The screen-recording grant is per signature.** A new signing identity is a new
app as far as macOS is concerned, so the permission has to be granted again. To
test the first-run path from scratch:

```bash
tccutil reset ScreenCapture com.fintonlabs.demodog
```

Only a *request* registers the app in the Screen Recording list; a preflight
check just reports that it is absent. If DemoDog does not appear in that list,
the app is not asking — see `SetupScreen.refresh`.

**Dev never exercises any of this.** In development the app runs under Electron's
own binary and inherits permissions granted to Electron long ago. Packaging is
the only way to test permissions, the nested helper, and update metadata.
