<div align="center">

<img src="docs/splash.png" width="360" alt="DemoDog">

# DemoDog

**Polish your demo until it's best in show.**

A screen recorder for macOS that edits itself.

Record, and it comes back with the zooms already placed, the cursor smoothed,
and your camera in the corner.

![Made by FintonLabs](https://img.shields.io/badge/Made%20by-FintonLabs-D6F534?style=flat-square)
![macOS 14+](https://img.shields.io/badge/macOS-14%2B-black?style=flat-square)

</div>

---

## Getting started

### 1. Install

Download the latest **`DemoDog-<version>-universal.dmg`** from
[Releases](../../releases), open it, and drag DemoDog to Applications.

The app is signed with an Apple Developer ID and notarised by Apple, so it opens
with a normal double-click — no right-click, no `xattr`, no security warning.

Intel or Apple silicon, macOS 14 (Sonoma) or later — the build is universal.
There is nothing else to install: no Python, no runtime, no command line tools.
Everything is inside the app.

DemoDog keeps itself up to date. It looks for a newer build shortly after
launch, downloads it in the background and asks before restarting to install —
never while you are recording.

### 2. Grant Screen Recording

The first time you record, macOS asks for **Screen Recording**. DemoDog cannot
capture anything until you allow it.

> System Settings → Privacy & Security → Screen Recording → enable **DemoDog**

Then quit and reopen DemoDog. Camera and microphone are only requested if you
choose to use them, and **Accessibility** is optional — it is used solely for
the keyboard-shortcut overlay.

### 3. Record something

![The recorder](docs/recorder.png)

1. Pick a **display** or a **window**. Live thumbnails show what each one is.
2. Optionally choose a **camera** and a **microphone** in the tabs on the right.
3. Check the summary above the button, then press **Start recording**.
4. A **3-2-1 countdown** appears over your screen, then recording begins.
5. Press <kbd>⌘</kbd><kbd>⇧</kbd><kbd>2</kbd> to stop — from anywhere, without
   hunting for the window.

Recordings are saved to `~/Movies/DemoDog/`.

> **Tip — save a preset.** Once your source, camera and microphone are set the
> way you like, type a name in the **Preset** box, press **Save**, then press
> **★**. Next launch it loads automatically, so recording is one click.

### 4. It edits itself

![The editor](docs/editor.png)

The editor opens as soon as you stop, already edited:

- **Zooms are placed for you**, from where you clicked, scrolled and switched
  apps. Each is a block on the timeline you can drag, resize, re-level or delete
  (**✕** on the block, or select it and press <kbd>Delete</kbd>).
- **The cursor is redrawn**, smooth and crisp, with a click effect. It is not
  the recorded pointer — the recording contains no cursor at all — so its size,
  style and shape are all changeable afterwards.
- **Your camera** appears as a bubble that moves aside when the pointer nears it.

Click anywhere on the timeline to move the playhead. <kbd>Space</kbd> plays,
the arrow keys step a frame at a time (hold <kbd>⇧</kbd> for a second),
<kbd>Delete</kbd> removes the selected zoom.

> **Tip — frame a shot by hand.** Press **Choose the area on the preview** in
> the Zoom tab and drag a box around what should fill the frame. The
> magnification is worked out from the box, so you never type a number. With a
> shot selected it reframes that one; with nothing selected it makes a new one
> at the playhead.

### 5. Make it yours

The icons above the panel on the right cover everything — hover one and the
line underneath says what it is:

| Tab | What is in it |
|---|---|
| **Style** | Background, padding, corner radius, shadow, fade in/out, output size, and **profiles** |
| **Zoom** | How often it zooms, how long shots hold, how much of the take is zoomed |
| **Cursor** | Size, smoothing, style, shape, click effects, spotlight |
| **Camera** | Bubble shape, position, size, framing, audio levels |
| **Captions** | Transcribe the narration, edit the lines, and style them |
| **Titles** | Intro and outro cards either side of the recording |

> **Tip — save a look.** In **Style → Profile**, name your settings, press
> **Save**, then **★**. Every new recording then opens with that look already
> applied.

### 6. Captions, without uploading anything

In **Captions**, press **Transcribe**. The narration is recognised **on this
Mac** — nothing is sent anywhere — and becomes timed lines on the timeline.
Click a line to jump to it and edit the words in place, so a misheard name is
fixed rather than re-transcribed.

Font, size, weight, colour, position, alignment, outline, shadow, a backing
plate and a fade at each end are all adjustable, and the styling travels with a
profile.

### 7. Intro and outro cards

In **Titles**, give the recording an opening and a closing card — a title, a
subtitle and an optional logo, held for as long as you like.

They are extra time either side of the take rather than separate clips, so they
scrub, preview, fade and export exactly like the recording. Turn one on and it
appears on the timeline as its own lane.

### 8. Export

**Export MP4**, or <kbd>⌘</kbd><kbd>E</kbd>. Use **Set in** and **Set out**
first if you only want part of the take. You choose the name and the folder
before rendering starts.

A 26 second take exports in under eight seconds; most of that is the encoder
finishing rather than anything DemoDog is doing.

When it is done, **Publish → YouTube** writes the captions beside the video as
an SRT file, puts the title and chapter marks on the clipboard, opens YouTube
Studio and reveals the file ready to drag in. It is a handoff rather than an
upload, deliberately: uploading through YouTube's API needs a verified app, and
until one is verified every video it uploads is locked to private with no
appeal.

---

## Common questions

**Where are my recordings?** `~/Movies/DemoDog/take_<timestamp>.demodog`. Each
take is a package holding the video, the input log and a little metadata —
double-click it to reopen, or use **Open take…**.

**Why are there no zooms on my recording?** DemoDog zooms in on things you *do* —
clicks, scrolling, switching apps. A take where you only moved the mouse has
nothing to zoom in on. The Zoom tab says what it found, and you can always
double-click the zoom lane to add one by hand.

**Why does it start zoomed out?** Deliberately. A recording that opens already
zoomed never shows the viewer what they are looking at. Adjust it with
**Opening wide shot** in the Zoom tab.

**Can I record system audio?** Yes, it is on by default, and needs no extra
driver or virtual audio device.

**Does it record my keystrokes?** Only modifier combinations such as ⌘K, and
only if you switch on the shortcut overlay. Plain typing is never recorded.

**Is my narration sent anywhere to be transcribed?** No. Recognition runs on
this Mac, offline, using the speech model macOS already ships. DemoDog makes no
network requests at all except to check GitHub for a newer version.

**The update said it restarted but I am still on the old version.** Fixed in
1.0.6. Older copies need one manual update from
[Releases](../../releases/latest); after that the automatic path works.

---

## Building from source

Only needed if you want to change it.

```bash
git clone https://github.com/justynroberts/demodog.git
cd demodog
npm install          # also compiles the Swift capture helper
npm run dev          # run it
npm run dist         # build a .dmg into release/
```

Node 20+ and Xcode command line tools (`xcode-select --install`) are required —
the capture helper is compiled from Swift.

For the architecture and the reasoning behind the engine, see
[`CLAUDE.md`](CLAUDE.md). For the visual system, see [`DESIGN.md`](DESIGN.md).

---

## Licence

MIT — © [FintonLabs](https://fintonlabs.com)
