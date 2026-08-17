#!/usr/bin/env bash
# MIT License - Copyright (c) fintonlabs.com
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$HERE")"
OUT="$ROOT/bin/demodog-recorder"

if ! command -v swiftc >/dev/null 2>&1; then
  echo "error: swiftc not found. Install Xcode command line tools: xcode-select --install" >&2
  exit 1
fi

mkdir -p "$ROOT/bin"

SOURCES=(
  # main.swift must come last: top-level code is only permitted in that file, and
  # swiftc resolves the entry point by filename, not by order — but keeping the
  # order explicit makes the intent obvious.
  "$HERE/Sources/Support.swift"
  "$HERE/Sources/Globals.swift"
  "$HERE/Sources/Sources.swift"
  "$HERE/Sources/InputTracker.swift"
  "$HERE/Sources/CaptureSession.swift"
  "$HERE/Sources/Transcriber.swift"
  "$HERE/Sources/main.swift"
)

build_one() {
  swiftc \
    -swift-version 5 \
    -O \
    -target "$1-apple-macosx14.0" \
    -framework ScreenCaptureKit \
    -framework AVFoundation \
    -framework AppKit \
    -framework CoreMedia \
    -framework CoreGraphics \
    -framework Speech \
    -o "$2" \
    "${SOURCES[@]}"
}

# A universal app needs a universal helper. Electron ships both slices, but the
# helper is an extra resource that electron-builder copies verbatim — so an
# arm64-only binary inside a universal bundle leaves the app installable on an
# Intel Mac and unable to record anything on one, which is the worst way to find
# out. Off by default because building both slices is twice the work and the
# second is useless on the machine doing the building.
if [ "${DEMODOG_UNIVERSAL:-0}" = "1" ]; then
  build_one arm64 "$OUT.arm64"
  build_one x86_64 "$OUT.x86_64"
  lipo -create "$OUT.arm64" "$OUT.x86_64" -output "$OUT"
  rm -f "$OUT.arm64" "$OUT.x86_64"
else
  build_one arm64 "$OUT"
fi

chmod +x "$OUT"
echo "built $OUT ($(lipo -archs "$OUT"))"
