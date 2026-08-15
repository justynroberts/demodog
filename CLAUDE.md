# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

FinScreen is a macOS screen recorder in the Screen Studio mould: it records the
screen, then *reconstructs* the presentation afterwards — automatic zoom that
follows what you did, a smoothed cursor drawn from scratch, and a camera
picture-in-picture.

The single design decision everything else follows from:

> **The recorded video contains no cursor.** `SCStreamConfiguration.showsCursor`
> is `false`, and the pointer is re-drawn at render time from a separately
> captured input event stream.

That is what makes cursor smoothing, cursor resizing, click animation and
auto-zoom possible at all. If the cursor were burned into the pixels you could
not smooth it, resize it, or hide it — you would just have two cursors. Do not
"simplify" this by turning `showsCursor` on.

## Commands

```bash
npm install          # also compiles the Swift helper via postinstall
npm run dev          # electron-vite dev; rebuilds the helper first
npm run build        # helper + main + preload + renderer
npm run typecheck    # both tsconfig projects; run this before calling anything done
npm run native       # rebuild only the Swift helper
npm run dist         # packaged .dmg via electron-builder

npm run fixture      # regenerate the synthetic test take (needs ffmpeg)
npm run verify       # numerical check of the zoom/cursor engines against it
```

### Testing without a webcam or a real recording

`npm run fixture` writes a synthetic take to `~/Movies/FinScreen/fixture`: a
video with numbered targets at *known* coordinates, an event stream that visits
and clicks each one, and a stand-in camera track.

```bash
npm run fixture
npm run verify                                   # asserts the engine framed each target
FINSCREEN_OPEN=~/Movies/FinScreen/fixture npm run dev   # boots straight into the editor
```

`npm run verify` is the fastest way to know whether an engine change broke
anything — it checks segment count, that each known target is framed and
centred, that camera motion has no jump cuts, that tremor is removed, and that
the pointer still lands on its click targets. Screenshots can only show that
*something* moved; this shows it moved to the right place.

## Architecture

Three processes, and the boundaries matter:

```
Swift helper (bin/finscreen-recorder)   ← all ScreenCaptureKit + global input
        │ JSON lines on stdout, "stop" on stdin
Electron main (src/main)                ← process lifecycle, IPC, file I/O
        │ contextBridge (src/preload)
Renderer (src/renderer)                 ← all UI, the render engine, export
```

### The native helper — `native/Sources/`

Built by `native/build.sh` with plain `swiftc` (no Xcode project). Subcommands:
`list`, `permissions`, `record`. It writes three files per take:

| File | Contents |
|---|---|
| `screen.mp4` | H.264 + AAC system audio, cursor-free |
| `events.jsonl` | cursor samples, clicks, scrolls, app switches, shortcuts |
| `meta.json` | geometry, frame rate, and the clock offsets |

**Timebase.** Every event carries `h`, a reading of the monotonic host clock
(`CMClockGetHostTimeClock`). `meta.firstFrameHost` is the same clock at the
first video frame. The renderer converts with `t = h - firstFrameHost`. Never
use wall-clock time for anything except lining up the camera track.

`InputTracker` deliberately runs two mechanisms at once: a 120 Hz poll of
`CGEvent.location` and the physical button state (needs no permissions, never
misses a sample, evenly spaced — which is what the filter downstream wants),
plus `NSEvent` global monitors for the things a poll cannot infer (scroll
deltas, click counts, modifiers).

### The render engine — `src/renderer/src/engine/`

| File | Role |
|---|---|
| `input.ts` | raw events → typed tracks |
| `cursorTrack.ts` | 1€ filter, run forward **and backward** for zero lag |
| `autozoom.ts` | input → *moments* → clusters → zoom segments |
| `camera.ts` | segments → a viewport rect for any `t` |
| `composition.ts` | draws one frame: background, frame, zoom, cursor, PiP |
| `export.ts` | WebCodecs encode of frames rendered by `composition` |

**`Composition.render(ctx, t, sources)` is a pure function of `t`.** No frame
counters, no accumulated state. The preview and the exporter call the same
method, which is the only reason the exported file matches what you previewed.
Anything that makes rendering stateful will silently desynchronise them.

Two non-obvious pieces of the design, both learned by getting them wrong:

- **Overlapping zoom segments are trimmed, never merged.** Averaging two anchors
  half a screen apart yields a wide shot centred on nothing, and because each
  fusion extends the segment it cascades until the whole recording is one static
  zoom. See `resolveOverlaps`.
- **The cursor filter runs in both directions.** A causal filter always lags, and
  a pointer that trails behind its own clicks looks broken. The reverse pass
  cancels the phase shift exactly — only possible because this is
  post-processing.

### Coordinate spaces

- **source** — capture pixels (e.g. 2880×1800). All input events live here.
- **output** — export pixels (e.g. 1728×1080).
- **content** — the rect inside `output` the video occupies after padding.

The camera maps a *viewport* rect in source space onto the content rect. Zoom is
implemented as a source-rect crop in `drawImage`, not a canvas transform.

## Things that will bite you

**Stray helper processes wedge ScreenCaptureKit.** One stranded
`finscreen-recorder` keeps its capture connection open, and every later
`SCStream` then dies instantly with `failedApplicationConnectionInterrupted`
(-3805) — which looks like a broken app but is a zombie. `reapStrayHelpers()`
clears them at startup and quit, and the one-shot commands carry watchdogs.
If capture starts failing during development, check `pgrep -f finscreen-recorder`
first.

**Concurrent ScreenCaptureKit queries interfere.** Two helpers asking for
shareable content simultaneously can leave both hanging. React StrictMode
double-invokes effects in dev, so the renderer asks twice by default — hence the
single-flight in `runOnceShared`.

**Camera and microphone capture live in the control-bar window**
(`src/renderer/src/recorder/ControlBar.tsx`), not the studio window. It is the
only renderer guaranteed to stay alive and unthrottled for the whole take;
Chromium throttles hidden windows, which would stall a `MediaRecorder`.

**The app's own windows must be excluded from capture.** The helper is a child
process, so its own pid is not the one that matters — Electron passes
`--exclude-pids` with its pid.

**Export is correct but slow** — roughly 2.5–3 output frames per second. It seeks
the source video once per output frame, which forces the decoder back to a
keyframe every time.

A sequential WebCodecs decode path already exists in `frameSource.ts` and is
wired up behind `SEQUENTIAL_DECODE` in `export.ts`, currently `false`. It is not
the default because it has **not been confirmed to produce a correct file end to
end** — only the seeking path has. Two real bugs were already found and fixed in
it, and both are the kind worth knowing about:

- `setExtractionOptions` must be called *after* `onReady` and *before* `flush()`,
  and the file must be created with `keepMdatData`. Otherwise mp4box parses
  happily and hands back zero samples.
- `VideoFrame.duration` is frequently null, so a frame's coverage has to be
  derived from the *next* frame's timestamp. Relying on the duration made the
  exporter grind through every sample in the file to produce frame 1.

To finish it: flip the flag, export the fixture, and diff exported frames against
the preview at the known target times before making it the default.

## Style

Follows the `house-style` skill. The archetype and axis picks are recorded in
`DESIGN.md` — read it before touching CSS, and vary *away* from it on the next
project rather than repeating it. Stylesheets and entry HTML carry
`/* MIT License - Copyright (c) fintonlabs.com */`.
