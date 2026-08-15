#!/usr/bin/env bash
# MIT License - Copyright (c) fintonlabs.com
#
# Builds the macOS app icon and the in-app logo from a single source image.
#
#   resources/icon-source.png  (square, 1024x1024 or larger)
#     -> resources/icon.icns          app bundle icon, used by electron-builder
#     -> src/renderer/public/logo.png in-app brand mark
#
# Uses only sips and iconutil, both shipped with macOS.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$HERE")"
SRC="$ROOT/resources/icon-source.png"

if [[ ! -f "$SRC" ]]; then
  echo "error: $SRC not found." >&2
  echo "Save the DemoDog artwork there as a square PNG, then re-run." >&2
  exit 1
fi

ICONSET="$ROOT/resources/DemoDog.iconset"
rm -rf "$ICONSET"
mkdir -p "$ICONSET" "$ROOT/src/renderer/public"

# The sizes macOS expects in an iconset, each at 1x and 2x.
for size in 16 32 128 256 512; do
  sips -z $size $size "$SRC" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  sips -z $((size * 2)) $((size * 2)) "$SRC" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done

iconutil -c icns "$ICONSET" -o "$ROOT/resources/icon.icns"
rm -rf "$ICONSET"

# The renderer loads the logo from the Vite public directory.
sips -z 512 512 "$SRC" --out "$ROOT/src/renderer/public/logo.png" >/dev/null

echo "built resources/icon.icns and src/renderer/public/logo.png"
