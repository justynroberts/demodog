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
npm run zoom-report -- <take dir>   # what the auto-zoom does to real material
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

Four non-obvious pieces of the design, all learned by getting them wrong:

- **Overlapping zoom segments are trimmed, never merged.** Averaging two anchors
  half a screen apart yields a wide shot centred on nothing, and because each
  fusion extends the segment it cascades until the whole recording is one static
  zoom. See `stitchSegments`.
- **Moments cluster in space as well as time.** Clustering on time alone lets two
  clicks a second apart on opposite corners share a shot, whose bounding box is
  then too wide to zoom into — so the segment falls below `minScale` and is
  discarded. A larger merge gap could therefore silently remove *every* zoom.
- **Short gaps between shots are bridged, not released.** Pulling out to 1x for a
  moment and punching straight back in is what "zooming in and out too much"
  actually is; holding the zoom and panning reads as deliberate. `bridgeGap`
  is the main control over how busy a result feels.

- **The cursor filter runs in both directions.** A causal filter always lags, and
  a pointer that trails behind its own clicks looks broken. The reverse pass
  cancels the phase shift exactly — only possible because this is
  post-processing.

Tune with real material, not by feel: `npm run zoom-report -- <take dir>`
reports segment count, how often the camera returns to 1x, and the fraction of
the take spent zoomed.

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

**Export is correct but slow** — about 3.6 output frames per second, so a ten
minute recording takes roughly three hours. Measured breakdown, from a real take:

    180 frames in 50.4s — screen seek 38.8s, camera seek 11.4s,
                          render 0.1s, encode 0.0s

Rendering and encoding are free. It is entirely `SeekingFrameSource`: setting
`currentTime` per output frame forces the decoder back to the previous keyframe
and re-decodes the whole group of pictures, roughly sixty frames of 2880x1800
for every frame written.

Measured alternatives, on the same take, so these do not need re-testing:

| Change | Speed | Cost |
|---|---|---|
| Keyframes every 12 frames | 11.6 fps | recording grows 25 → 214 MB/min |
| All intra | 16.7 fps | 177 MB for 26 seconds |

Both were rejected: screen content compresses to almost nothing between
keyframes, so buying speed with keyframes costs an unreasonable amount of disk,
and neither helps the camera track, which is now a comparable share of the time.

**The real fix is `DecodingFrameSource`** — sequential WebCodecs decoding, which
makes keyframe spacing irrelevant for both tracks. It is behind
`SEQUENTIAL_DECODE` in `export.ts` and **still does not work**. Bugs found and
fixed so far, all real:

- `setExtractionOptions` must be called after `onReady` and before `flush()`,
  with the file created `keepMdatData`, or mp4box returns zero samples.
- `VideoFrame.duration` is frequently null, so a frame's coverage must come from
  the *next* frame's timestamp.
- The first sample's PTS is not zero; `video.currentTime` is normalised against
  the track start but raw decoder timestamps are not.
- `sample.data` is a view into a buffer mp4box recycles, so chunks must copy it.
- The in-flight chunk window must exceed the codec's reorder depth (16 for H.264
  High) or the decoder waits for input while we wait for frames, but the decoded
  *frame* queue must stay small — a few dozen 2880x1800 surfaces is hundreds of
  megabytes of GPU memory and stalls the pipeline.

**What remains.** With a 32-chunk window and an 8-frame queue the decoder is
healthy — `fed 33, decoded 24, queued 24, decoderQueue 0, state configured` —
but `frameAt` is entered exactly once, spins while the queue is empty, and never
returns once frames arrive. The fault is in the read loop, not the decoder. Add
tracing inside `frameAt` around the queue-length branches and watch what it does
on the iteration where `queue.length` first reaches two.

An alternative worth considering instead: drive export from `video.play()` plus
`requestVideoFrameCallback`, rendering each presented frame at its own
`mediaTime`. That never seeks, so a ten minute take exports in about ten
minutes, and it needs no demuxer. It makes the output variable-frame-rate and
depends on the window staying visible, since presentation throttles when hidden.

Use `DEMODOG_BENCH` to measure any of this — it exports headlessly, without
stealing focus:

```bash
DEMODOG_BENCH=~/Movies/DemoDog/<take> \
DEMODOG_BENCH_OUT=/tmp/bench.mp4 \
DEMODOG_BENCH_SECONDS=4 npx electron .
```

Driving the real UI to time an export is unreliable — synthetic clicks and
keystrokes land in whatever app happens to be frontmost.

## Style

Follows the `house-style` skill. The archetype and axis picks are recorded in
`DESIGN.md` — read it before touching CSS, and vary *away* from it on the next
project rather than repeating it. Stylesheets and entry HTML carry
`/* MIT License - Copyright (c) fintonlabs.com */`.
