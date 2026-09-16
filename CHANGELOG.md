# Changelog

Work lands on `main` continuously. Nothing reaches anyone until a release is
cut — the updater reads the latest GitHub release, not the branch — so this file
is where finished work waits.

## Unreleased

- **Smoother exports.** Recordings came back jerky, and the cause was not the
  capture but the clock. ScreenCaptureKit can only hand over a frame on a
  display refresh, so a 30fps take on a 60Hz screen arrives with gaps of 16.7,
  33.3 and 50ms instead of a steady 33.3 — and the exporter chose frames by
  those raw times, so the picture advanced unevenly: on real takes about one
  frame in twenty exported at 60fps, and one in three exported at 30. Each
  frame is now put back on the beat it was captured to before it is chosen. It
  moves at most half a frame, so it stays in sync with the sound; a frame that
  genuinely never arrived is not covered up. On the same real takes the uneven
  share fell from 32–38% to about 2% at 30fps, which is what the frames missing
  from the capture itself allow. A 60fps take exported at 30 advanced 1, 3, 2
  source frames at a time where it should have advanced 2 — floating point was
  deciding which side of a frame boundary the sample fell on — and now advances
  exactly 2.
- **Fewer frames lost at capture.** The capture's minimum frame interval was
  exactly one frame, and a refresh landing a fraction of a millisecond early
  was refused, so the frame came one refresh late. It now has 3% of slack,
  which is less than a refresh at any rate, so it never lets a frame through
  sooner than asked — it only stops on-time frames being turned away. Not yet
  measured on a real capture.
- **Captions short enough to read.** Transcribed lines were whole sentences —
  up to 90 characters, two dense lines over the recording. With **Keep lines
  short** on (the default), a transcript arrives in captions of at most 42
  characters, broken after a comma or full stop where one is close, never
  ending on a word like "the" and never leaving a word on its own. The breaks
  fall in the real pause between two words: the recogniser times every word,
  and building lines used to throw those times away. A transcript you already
  have can be shortened with one button.
- **Split and merge lines by hand.** Put the cursor where a line should break
  and press ⌘↩, or **Split at cursor**; the rest of the line is selected next,
  so a long line breaks up one keystroke at a time. **Merge with next** is the
  exact inverse. Split lines touch, so the text never blinks off between them
  and music ducking does not swell up in a gap that is not really a pause.
- **Annotate a recording.** A new **Annotate** tab draws arrows, boxes,
  highlights and a focus that dims everything else — and blurs or pixelates to
  hide a password, an API key or an email address. Drag on the preview to
  place one; it starts at the playhead and shows on a new **Marks** lane, where
  its ends drag. Marks live on the recording itself, so they follow the zoom,
  and they sit under the cursor so they never cover what it points at. Blur and
  pixelate never fade, so nothing they hide shows through at either end.
  Overlapping marks get rows of their own on the lane.
- **Edits are kept with the recording.** Captions, marks, zoom shots, the trim
  and the camera sync lived only in the editor, so opening a take again — or
  quitting — lost all of it and started over from the automatic edit. They are
  now saved inside the take as you work and are back when it opens. A zoom shot
  deleted by hand stays deleted; the automatic shots are only rebuilt if the
  zoom settings are changed. A take that has only been looked at is left
  untouched.
- **Transcripts no longer repeat themselves.** Speech is recognised in
  overlapping windows so a sentence crossing a boundary is heard whole, and the
  overlap was removed by comparing text — which missed repeats that did not
  open a line exactly, so phrases like "open the full invoice" appeared twice.
  Repeats are now removed by when each word was said. On a 43-second test
  narration, words that were never spoken fell from 39 to 6 (the rest are
  mishearings) and repeated phrases from 22 to none, with the same share of the
  script heard as before. The last word each window hears has its end
  stretched to the window's edge; that word is judged by its start, so the word
  after it is not mistaken for a repeat.
- **Annotations over MCP.** `create_walkthrough` and `update_walkthrough` take
  an `annotations` list in video pixels, so a scripted demo can point at things
  and hide things too. Anything a mark leaves out takes its kind's default, so a
  blur given no strength still blurs rather than failing open.

## 1.6.3 — 2026-09-13

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
- **The update prompt is now tested before every release.** Nothing in the
  checks went near the updater, which is how that crash reached people: it only
  happens days into a session, after a window has been closed and reopened, at
  the moment an update lands. `npm run verify:updater` stages exactly that in
  real Electron with real windows — closed and reopened, a dead reference, no
  window at all, a prompt that fails to open, a restart that does not take — and
  the release script will not publish unless it passes. It was checked against
  the original bug put back in, and fails on it.
- **Crashes are written down instead of shown.** Anything the app fails to
  catch used to put up a raw "Uncaught Exception" stack that meant nothing to
  the person looking at it and never reached anyone who could fix it. It now
  goes to `main-errors.log`, and **Report a bug** attaches that log alongside the
  updater's.

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
