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
npm run verify       # engine checks, then a real export of the fixture
npm run verify:engine   # just the numerical zoom/cursor checks
npm run verify:export   # just the end-to-end export check
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

`npm run verify` is the fastest way to know whether a change broke anything — it checks segment count, that each known target is framed and
centred, that camera motion has no jump cuts, that tremor is removed, and that
the pointer still lands on its click targets. Screenshots can only show that
*something* moved; this shows it moved to the right place.

`verify:export` covers what the engine checks cannot. It runs the real exporter
over the fixture and then decodes the result with ffmpeg to confirm the frames
actually differ — a frozen export shipped in 0.1.0 with every engine check
passing, because the fault was in the reader that turns a time into a source
frame and nothing downstream of it was covered.

It exports with `DEMODOG_BENCH_PLAIN=1`, which turns off zoom, the drawn cursor,
the picture-in-picture and the fades. That is the whole trick: with any of them
on, the picture changes every frame whether or not the recording underneath it
does, and the check passes on a completely frozen export. It did exactly that
until the overlays were removed. For the same reason the fixture's screen video
carries a patch of per-frame animation — an earlier "moving element" was a
drawbox with a time expression that silently never moved.

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

**Export decodes sequentially.** Export renders strictly forwards, so seeking
the source once per output frame was pure waste: each seek threw the decoder
back to the previous keyframe and re-decoded the whole group of pictures, about
sixty frames of 2880x1800 for every frame written. Measured on one take:

| | before | after |
|---|---|---|
| throughput | 3.6 fps | **203 fps** |
| screen decode | 38.8s | 0.1s |
| camera decode | 11.4s | 0.0s |

A 26 second take now exports in under eight seconds. What remains is encoder
drain, which is the encoder doing its job.

Getting `DecodingFrameSource` working took several wrong turns, all of which are
easy to repeat:

- `setExtractionOptions` must be called after `onReady` and before `flush()`,
  with the file created `keepMdatData`, or mp4box returns zero samples.
- `VideoFrame.duration` is frequently null.
- The first sample's PTS is not zero; `video.currentTime` is normalised against
  the track start but raw decoder timestamps are not.
- `sample.data` is a view into a buffer mp4box recycles, so chunks must copy it.
- The in-flight *chunk* window must exceed the codec's reorder depth — H.264
  High holds 16 frames in its DPB and emits nothing until it can resolve
  presentation order — while the decoded *frame* queue must stay small, because
  a few dozen 2880x1800 surfaces is hundreds of megabytes of GPU memory.

**The one that actually mattered**, and the reason it stalled for so long: the
reader tried to work out which frame belonged at time `t` by peeking at the
*next* decoded frame. That needs two frames in hand to decide anything, which
deadlocks against the very queue cap that stops frames piling up. The sample
table already carries every frame's presentation time, so `indexAt` resolves the
wanted frame from `t` directly and the reader simply pulls until it has that
many. No lookahead, no deadlock.

**The camera is recorded as MP4** for the same reason. A MediaRecorder WebM can
only be seeked, and seeking it once per output frame was the largest single cost
once the screen was fixed. Older WebM takes still work — `openFrameSource` falls
back to seeking for any container the demuxer cannot read.

Use `DEMODOG_BENCH` to measure any of this — it exports headlessly, without
stealing focus:

```bash
DEMODOG_BENCH=~/Movies/DemoDog/<take> \
DEMODOG_BENCH_OUT=/tmp/bench.mp4 \
DEMODOG_BENCH_SECONDS=4 npx electron .
```

Driving the real UI to time an export is unreliable — synthetic clicks and
keystrokes land in whatever app happens to be frontmost.

## Releasing

**This is production software that updates itself.** Never build a release, tag,
or publish unless asked to in that message. The updater reads the latest GitHub
release, so commits and pushes to `main` are inert — only `npm run release --
<version>` makes anything visible. `npm run dist` builds locally and publishes
nothing. Finished work waits in `CHANGELOG.md` under *Unreleased*.

`RELEASING.md` is the full path from a clean tree to a downloadable,
self-updating build, including the parts that are not obvious: the dmg needs its
own signature and its own notarisation ticket, `latest-mac.yml` has to be
re-hashed after stapling because stapling rewrites the file it describes, and
macOS applies updates from the zip rather than the dmg. Read it before cutting a
release rather than working it out again.

## Style

Follows the `house-style` skill. The archetype and axis picks are recorded in
`DESIGN.md` — read it before touching CSS, and vary *away* from it on the next
project rather than repeating it. Stylesheets and entry HTML carry
`/* MIT License - Copyright (c) fintonlabs.com */`.
