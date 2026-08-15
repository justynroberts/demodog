# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

DemoDog is a macOS screen recorder in the Screen Studio mould: it records the
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

`npm run fixture` writes a synthetic take to `~/Movies/DemoDog/fixture`: a
video with numbered targets at *known* coordinates, an event stream that visits
and clicks each one, and a stand-in camera track.

```bash
npm run fixture
npm run verify                                   # asserts the engine framed each target
DEMODOG_OPEN=~/Movies/DemoDog/fixture npm run dev   # boots straight into the editor
```

`npm run verify` is the fastest way to know whether an engine change broke
anything — it checks segment count, that each known target is framed and
centred, that camera motion has no jump cuts, that tremor is removed, and that
the pointer still lands on its click targets. Screenshots can only show that
*something* moved; this shows it moved to the right place.

## Architecture

Three processes, and the boundaries matter:

```
Swift helper (bin/demodog-recorder)   ← all ScreenCaptureKit + global input
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
`demodog-recorder` keeps its capture connection open, and every later
`SCStream` then dies instantly with `failedApplicationConnectionInterrupted`
(-3805) — which looks like a broken app but is a zombie. `reapStrayHelpers()`
clears them at startup and quit, and the one-shot commands carry watchdogs.
If capture starts failing during development, check `pgrep -f demodog-recorder`
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

A sequential WebCodecs decode path exists in `frameSource.ts` behind
`SEQUENTIAL_DECODE` in `export.ts`, currently `false`. **It does not work yet.**
Three bugs in it have been found and fixed, and the remaining one is not solved:

- *Fixed:* `setExtractionOptions` must be called *after* `onReady` and *before*
  `flush()`, and the file must be created with `keepMdatData`. Otherwise mp4box
  parses happily and hands back zero samples.
- *Fixed:* `VideoFrame.duration` is frequently null, so a frame's coverage has to
  be derived from the *next* frame's timestamp. Relying on the duration made the
  exporter grind through every sample in the file to produce frame 1.
- *Fixed:* the first sample's PTS is not zero (`cts0=512` at timescale 15360 on
  the fixture, i.e. 33ms). `video.currentTime` is normalised against the track
  start but raw decoder timestamps are not, so the decode path needs the base
  subtracted or it sits a frame off.
- **Open:** the decoder emits exactly *one* frame and then stalls, whatever the
  in-flight window is (tried 16 and 96 chunks, frame queues of 12 and 48). The
  config reports supported, `is_sync` is true on the first sample, the avcC
  description is 48 bytes, and no decoder error fires. Next things to try:
  compare the description bytes against a known-good avcC, feed chunks with no
  backpressure cap at all to see whether output resumes, and test against an
  MP4 written by our own recorder rather than by ffmpeg.

Use `DEMODOG_BENCH` for this — it exports headlessly, without stealing focus:

```bash
DEMODOG_BENCH=~/Movies/DemoDog/fixture \
DEMODOG_BENCH_OUT=/tmp/bench.mp4 \
DEMODOG_BENCH_SECONDS=2 npx electron .
```

Driving the real UI to time an export is unreliable — synthetic clicks and
keystrokes land in whatever app happens to be frontmost.

## Style

Follows the `house-style` skill. The archetype and axis picks are recorded in
`DESIGN.md` — read it before touching CSS, and vary *away* from it on the next
project rather than repeating it. Stylesheets and entry HTML carry
`/* MIT License - Copyright (c) fintonlabs.com */`.
