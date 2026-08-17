# Changelog

Work lands on `main` continuously. Nothing reaches anyone until a release is
cut — the updater reads the latest GitHub release, not the branch — so this file
is where finished work waits.

## Unreleased

_Nothing yet._

## 0.9.1 — 2026-08-17

- Exports rendered with no zoom at all. The shot list was replaced with an empty
  one immediately before the exporter read it, while the preview kept its own
  and looked correct.
- The export summary reports its shot count, and the build fails if a test
  export comes back with none.

## 0.9.0 — 2026-08-17

- The app asks for screen recording rather than only checking for it. It
  previously sent the user to a System Settings list that did not contain
  DemoDog, because nothing had ever requested it.
- A three-step first-run tour of the camera, audio and capture settings.
- The camera tab explains where background blur comes from — macOS applies it at
  the camera, from Control Centre.
- Light theme by default; dark and system still a click away.
- Dark-theme contrast fixes, including genuinely black-on-black text on the
  selected source tab.
- The permission notice is a card rather than a banner.

## 0.1.2 — 2026-08-16

- Universal build: Intel as well as Apple silicon, capture helper included.
- Automatic updates, with the restart left to the user and never during a take.
- An export is checked for being frozen before any build ships.
- The disk image is signed as well as notarised.

## 0.1.1 — 2026-08-16

- Fixed frozen exports: the fast decode path never advanced past its first
  frame, and three further faults sat behind that one.
- Takes are `.demodog` packages.
- The export destination is chosen before rendering rather than after.

## 0.1.0 — 2026-08-16

First packaged build.
