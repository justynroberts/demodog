#!/usr/bin/env bash
# MIT License - Copyright (c) fintonlabs.com
#
# Builds the macOS app icon and the in-app logo.
#
#   resources/icon-source.png  (square, 1024x1024 or larger)
#     -> resources/icon.icns          app bundle icon, used by electron-builder
#   resources/logo-source.png  (optional; falls back to icon-source.png)
#     -> src/renderer/public/logo.png in-app brand mark
#
# Two sources because the two want opposite things. The Dock expects the macOS
# tile -- a rounded rectangle inset in the canvas, transparent outside -- and a
# full-bleed square there reads as a sticker. The in-app mark sits in a small
# hard-edged square chip, where those same transparent corners would show the
# chip through them.
#
# Both are traced from resources/logo.svg, which is the artwork itself.
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
WORK="$ROOT/resources/.icon-square.png"
rm -rf "$ICONSET"
mkdir -p "$ICONSET" "$ROOT/src/renderer/public"

# Square the source by centre-cropping to its shorter edge. Forcing a
# non-square image into a square icon would stretch it instead.
W=$(sips -g pixelWidth "$SRC" | awk '/pixelWidth/{print $2}')
H=$(sips -g pixelHeight "$SRC" | awk '/pixelHeight/{print $2}')
SIDE=$((W < H ? W : H))
sips -c $SIDE $SIDE "$SRC" --out "$WORK" >/dev/null

if [[ $SIDE -lt 512 ]]; then
  echo "note: source is only ${SIDE}px square; icons will be soft." >&2
  echo "      supply 1024x1024 artwork for a crisp result." >&2
fi

# The sizes macOS expects in an iconset, each at 1x and 2x.
for size in 16 32 128 256 512; do
  sips -z $size $size "$WORK" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  sips -z $((size * 2)) $((size * 2)) "$WORK" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done

iconutil -c icns "$ICONSET" -o "$ROOT/resources/icon.icns"
rm -rf "$ICONSET"

# The renderer loads the logo from the Vite public directory.
LOGO="$ROOT/resources/logo-source.png"
[[ -f "$LOGO" ]] || LOGO="$WORK"
sips -z 512 512 "$LOGO" --out "$ROOT/src/renderer/public/logo.png" >/dev/null
rm -f "$WORK"

echo "built resources/icon.icns and src/renderer/public/logo.png"
