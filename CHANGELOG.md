# Changelog

Work lands on `main` continuously. Nothing reaches anyone until a release is
cut — the updater reads the latest GitHub release, not the branch — so this file
is where finished work waits.

## Unreleased

- **The update prompt could crash instead of appearing.** The updater was handed
  the studio window once, at launch, and kept it. Close that window and reopen
  DemoDog from the Dock — ordinary use for an app left running for days — and it
  was holding a destroyed window. When the next update finished downloading it
  called `isMinimized()` on it, threw "Object has been destroyed", and never
  showed the restart prompt; worse, it had already marked itself busy, so it
  would not try again for the rest of that session. The check that runs when you
  switch back to DemoDog was attached to the same dead window, so that had
  quietly stopped too. The updater now asks for the current window each time,
  shows a free-standing prompt if there is none, and listens for focus on the
  app rather than on one window.

  Copies already running 1.6.2 or earlier still carry the old code, so the fix
  takes effect from the next update onwards. If the prompt does not appear,
  quitting DemoDog and opening it again always gets it — a fresh launch has a
  fresh window.

## 1.6.2 — 2026-09-13

- **Better hands.** The pointing hand was a blob, the open hand a mitten, and
  the grabbing hand a rounded square — silhouettes with nothing inside them,
  which is why none of them read as a hand at the size a cursor is actually
  seen. All three are redrawn with separate fingers: the pointing hand has its
  middle, ring and little finger curled at stepped heights beneath a raised
  index, the open hand spreads four fingers and a thumb, and the grabbing hand
  is a row of knuckles. The gaps between fingers are drawn in the keyline
  colour over the fill, so they survive both the dark and light pointer styles.
  The arrow's tail is a little shorter and broader, closer to the macOS one.
- **More shapes to choose from.** Open hand, grabbing hand and vertical resize
  were drawn but could not be picked — only the recorder could ever select them,
  and it rarely can. They are now in **Cursor → Shape**.

## 1.6.1 — 2026-08-26

**The first public release.**

DemoDog records your screen and hands back an edited video. Not footage to edit
— an edit. The zooms are already placed, the cursor is already smoothed, and
your camera is already in the corner.

### What it does

- **Zooms itself.** Shots are placed from what you actually did — clicked,
  scrolled, switched apps — and each is a block on the timeline you can drag,
  resize, re-level or delete. Overlapping shots are trimmed rather than merged,
  and short gaps between them are bridged rather than released, because pulling
  out to 1× for a moment and punching straight back in is what "zooming in and
  out too much" actually is.
- **Redraws the cursor.** The recording contains no pointer at all: capture runs
  with the cursor switched off, and the input stream is recorded separately on
  the same clock. The pointer you see is drawn at render time, which is the only
  reason it can be smoothed, resized, restyled or hidden afterwards. Its
  smoothing runs forwards *and* backwards, so it never lags its own clicks.
- **Camera picture-in-picture.** A bubble that moves aside when the pointer
  nears it. Shape, size, position and framing all change after the take.
- **Captions, on this Mac.** Narration is transcribed offline with the speech
  model macOS already ships — nothing is uploaded — and the lines are editable
  in place, so a misheard name is fixed rather than re-transcribed.
- **Intro and outro cards.** A title, a subtitle and a logo either side of the
  take. Extra time rather than separate clips, so they scrub, fade and export
  exactly like the recording does.
- **A music bed.** MP3, WAV or M4A, with optional ducking that steps the music
  back under your narration and brings it up again after.
- **A window or a whole display.** A window is captured on its own, wherever it
  sits and whatever happens to be in front of it.
- **System audio and microphone**, with no extra driver and no virtual audio
  device to install first.
- **Sticky settings.** However you left the look is how the next recording
  opens. Nothing to name, save or star.
- **Scripted walkthroughs.** A take is only a video, an input stream on a shared
  clock, and some geometry — so a browser driven by Playwright, plus a list of
  what it clicked and when, becomes a take and gets the zoom, the cursor, the
  click animation and the captions for free. `npm run mcp` serves the same thing
  to a local model over MCP, on the loopback interface only.
- **Fast export.** A 26-second take is an MP4 in under eight seconds, most of
  which is the encoder finishing rather than anything DemoDog is doing.

### What matters about it

- **Nothing leaves your Mac.** No account, no telemetry, no uploads. The only
  network request DemoDog makes is checking GitHub for a newer version.
- **Signed by Apple and notarised**, so it opens with a normal double-click —
  no right-click, no `xattr`, no security warning.
- **Universal.** Intel and Apple silicon, macOS 14 (Sonoma) or later.
- **It updates itself**, downloading in the background and asking before it
  restarts — never while you are recording.
- **MIT licensed**, and free.
