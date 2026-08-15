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

# main.swift must come last: top-level code is only permitted in that file, and
# swiftc resolves the entry point by filename, not by order — but keeping the
# order explicit makes the intent obvious.
swiftc \
  -swift-version 5 \
  -O \
  -target arm64-apple-macosx14.0 \
  -framework ScreenCaptureKit \
  -framework AVFoundation \
  -framework AppKit \
  -framework CoreMedia \
  -framework CoreGraphics \
  -o "$OUT" \
  "$HERE/Sources/Support.swift" \
  "$HERE/Sources/Globals.swift" \
  "$HERE/Sources/Sources.swift" \
  "$HERE/Sources/InputTracker.swift" \
  "$HERE/Sources/CaptureSession.swift" \
  "$HERE/Sources/main.swift"

chmod +x "$OUT"
echo "built $OUT"
