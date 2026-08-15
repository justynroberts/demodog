# DemoDog

A macOS screen recorder that edits itself. Record, and it comes back with the
zooms already placed, the cursor smoothed, and your camera in the corner.

Built as a working clone of the Screen Studio experience.

![Made by FintonLabs](https://img.shields.io/badge/Made%20by-FintonLabs-D6F534?style=flat-square)

## What it does

**Automatic zoom.** It watches what you actually did — clicks, scroll bursts,
app switches, and the moment your pointer arrives somewhere and stops — clusters
those moments, and fits a shot around each cluster. Every zoom lands on the
timeline as a block you can drag, resize, re-level or delete.

**A cursor that was never recorded.** The capture contains no pointer at all.
It is re-drawn as vector art from a 120 Hz input log, which means it can be
smoothed, resized after the fact, faded out when idle, and animated on click —
none of which is possible once a cursor is burned into the pixels.

The smoothing is a 1€ filter run forward *and backward*, so the tremor goes
without the pointer lagging behind its own clicks. Measured on the test fixture:
**76% less jitter, still landing within 1.1px of every click target.**

**Camera picture-in-picture.** Circle, rounded or square; any corner; mirrored;
framed with its own zoom and offset. It shrinks out of the way when your pointer
gets close to it.

**Everything else you'd expect.** Gradient / mesh / solid / blurred-from-source
backgrounds, padding, corner radius, shadow, rotation, system audio, microphone,
keyboard-shortcut overlay, trim, light and dark themes, and MP4 export up to 4K.

## Requirements

- macOS 14 or later (ScreenCaptureKit), Apple silicon or Intel
- Xcode command line tools — `xcode-select --install` — to build the helper
- Node 20+
- `ffmpeg` on PATH, only for regenerating the test fixture

## Getting started

```bash
npm install     # compiles the Swift capture helper too
npm run dev
```

macOS will ask for **Screen Recording** permission on first capture. Camera and
microphone are asked for only if you select them. **Accessibility** is optional
and only used for the keyboard-shortcut overlay — and only modifier
combinations are ever logged, never plain typing.

Recordings are written to `~/Movies/DemoDog/take_<timestamp>/`.

Press <kbd>⌘⇧2</kbd> to stop a recording from anywhere.

## Trying it without recording anything

```bash
npm run fixture   # synthetic take with targets at known coordinates
npm run verify    # asserts the engine framed every one of them
DEMODOG_OPEN=~/Movies/DemoDog/fixture npm run dev
```

## How it fits together

```
Swift helper  ── ScreenCaptureKit capture + global input tracking
     │           screen.mp4 (no cursor) · events.jsonl · meta.json
Electron main ── process lifecycle, IPC, files
     │
Renderer      ── UI, render engine, WebCodecs export
```

The render engine is a pure function of time: the preview and the exporter call
the same `render(ctx, t)`, so the file you get is the thing you watched.

See `CLAUDE.md` for the architecture in detail and `DESIGN.md` for the visual
system.

## Known limitations

- **Export is slow** — correct, but roughly 2.5–3 output frames per second,
  because it seeks the source video once per frame. A faster sequential-decode
  path is written and sits behind a flag, but it is not working yet: the decoder
  emits one frame and stalls. See the export notes in `CLAUDE.md`.
- Cursor *shape* detection (arrow vs I-beam vs hand) is best-effort; Apple has
  deprecated the only API that reports it, and unknown shapes fall back to the
  arrow.
- No multi-display capture in a single take, no iOS device capture, no GIF
  export yet.

## Licence

MIT — © [FintonLabs](https://fintonlabs.com)
