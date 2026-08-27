# Developing DemoDog

For changing DemoDog. If you only want to *use* it, the [README](README.md) is
the whole story and this file is not.

## Getting it running

```bash
git clone https://github.com/justynroberts/demodog.git
cd demodog
npm install          # also compiles the Swift capture helper
npm run dev          # electron-vite dev; rebuilds the helper first
```

Node 20+ and the Xcode command line tools (`xcode-select --install`) — the
capture helper is Swift, compiled with plain `swiftc`, no Xcode project.

| Command | What it does |
|---|---|
| `npm run dev` | Run it, with hot reload in the renderer |
| `npm run build` | Helper + main + preload + renderer |
| `npm run typecheck` | Both tsconfig projects — run before calling anything done |
| `npm run native` | Rebuild only the Swift helper |
| `npm run icon` | Rebuild the app icon and in-app mark from `resources/` |
| `npm run dist` | A signed, notarised `.dmg` in `release/`, published nowhere |

## Testing without a webcam or a real recording

```bash
npm run fixture      # writes a synthetic take to ~/Movies/DemoDog/fixture
npm run verify       # 87 checks: the engine, then a real export of that take
```

The fixture is a video with numbered targets at *known* coordinates, an event
stream that visits and clicks each one, and a stand-in camera track. `verify`
then asserts the engine framed each target, centred it, kept camera motion free
of jump cuts, removed tremor, and landed the pointer on its click targets.

That is the fastest way to know whether a change broke anything. A screenshot
can only show that *something* moved; this shows it moved to the right place.

```bash
DEMODOG_OPEN=~/Movies/DemoDog/fixture npm run dev   # boot straight into the editor
npm run verify:engine        # just the numerical zoom/cursor checks
npm run verify:export        # just the end-to-end export check
npm run zoom-report -- <take dir>   # what the auto-zoom does to real material
```

`verify:export` covers what the engine checks cannot: it exports the fixture for
real and decodes the result to confirm the frames actually differ. A frozen
export shipped in 0.1.0 with every engine check passing, because the fault was
in the reader that turns a time into a source frame and nothing downstream of it
was covered.

## The one design decision everything follows from

> **The recorded video contains no cursor.** `SCStreamConfiguration.showsCursor`
> is `false`, and the pointer is re-drawn at render time from a separately
> captured input event stream.

That is what makes cursor smoothing, resizing, click animation and auto-zoom
possible at all. If the cursor were burned into the pixels you could not smooth
it, resize it or hide it — you would have two cursors. Do not "simplify" this by
turning `showsCursor` on.

## Shape of the thing

```
Swift helper (bin/demodog-recorder)   ← all ScreenCaptureKit + global input
        │ JSON lines on stdout, "stop" on stdin
Electron main (src/main)              ← process lifecycle, IPC, file I/O
        │ contextBridge (src/preload)
Renderer (src/renderer)               ← all UI, the render engine, export
```

`Composition.render(ctx, t, sources)` is a pure function of `t` — no frame
counters, no accumulated state. The preview and the exporter call the same
method, which is the only reason the exported file matches what you previewed.

[`ARCHITECTURE.md`](ARCHITECTURE.md) is the long version: the timebase, the
auto-zoom design and why segments are trimmed rather than merged, the coordinate
spaces, the decode pipeline, and a list of the things that will bite you. Read it
before touching the engine.

## The other documents

| File | For |
|---|---|
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Why the engine works the way it does |
| [`DESIGN.md`](DESIGN.md) | The visual system — archetype and axis picks |
| [`RELEASING.md`](RELEASING.md) | Clean tree to a downloadable, self-updating build |
| [`MCP.md`](MCP.md) | Authoring walkthroughs from a script, or over MCP |
| [`resources/README.md`](resources/README.md) | The logo, and how the icon is built |
| [`CHANGELOG.md`](CHANGELOG.md) | What changed, and why |

## Releasing

**This is production software that updates itself.** The updater reads the
latest GitHub release, so commits and pushes to `main` are inert — only
`npm run release -- <version>` makes anything visible, and `npm run dist` builds
locally and publishes nothing. Finished work waits in `CHANGELOG.md` under
*Unreleased*.

[`RELEASING.md`](RELEASING.md) has the full path, including the parts that are
not obvious: the dmg needs its own signature and its own notarisation ticket,
`latest-mac.yml` has to be re-hashed after stapling because stapling rewrites
the file it describes, and macOS applies updates from the zip rather than the
dmg.

## Licence

MIT — © [FintonLabs](https://www.fintonlabs.com)
