# Changelog

Work lands on `main` continuously. Nothing reaches anyone until a release is
cut — the updater reads the latest GitHub release, not the branch — so this file
is where finished work waits.

## Unreleased

- Two doors led out of the app to the operating system and only one of them was
  locked. Opening a link from the page checked that it was a web address; a
  `window.open` did not, and handed whatever scheme it was given straight to
  macOS. Both now go through the same check.
- Transcribing a take no longer grants the editor permission to stream files
  from that folder. It never needed it — the audio is read outside the editor
  and only text comes back — and it was the one place that boundary could be
  widened without the user having picked anything.
- **Frame a zoom by dragging on the preview.** Draw a box around what should
  fill the frame and the shot is made from it — magnification worked out from
  the box rather than typed in as a number. With a shot selected it reframes
  that one; with nothing selected it makes a new one at the playhead.
- The selected shot now has its own controls: start, end, magnification and the
  two eases, with **Start here** and **End here** to pin either edge to the
  playhead.
- **Clicking the timeline could not move the playhead.** The preview was never
  seekable at all — the media protocol returned whole files with a 200, and a
  video given that concludes it cannot seek. Playing forwards worked, which is
  why it looked like a timeline fault.
- Scrubbing works anywhere on the timeline, including the gaps between lanes.
- Inspector tabs are icons with a caption line naming the open one, since six
  words never fitted the rail.
- A title card next to the recording no longer fades through black twice.

## 1.0.6 — 2026-08-17

- **Updates that quit the app and never came back.** launchd showed what was
  happening: Squirrel submits the installer as a job, launchd takes it as a
  pending spawn, and then removes the service before it runs because the session
  is already winding down. The installer was never refused — it was never
  started, which is why no installer log ever existed on the affected machine.
  The cause was this app destroying its own windows immediately before handing
  over, which ended the process faster than launchd could spawn anything. That
  teardown has been removed.

## 1.0.5 — 2026-08-17

- Attempted a fix for updates failing on browser-downloaded copies, by having
  the app clear its own quarantine flag at startup. **It does not work**: macOS
  refuses the change on the files inside the bundle, which are the ones that
  block the installer. The claim reached the release notes before it had been
  tested against a real dmg install. Left in place because it is harmless and
  logs what it could not do; the cause is still open.
- **Intro and outro cards**: a title, a subtitle and an optional logo either
  side of the recording, as extra time rather than separate clips, so they
  scrub, preview, fade and export like everything else.

## 1.0.4 — 2026-08-17

Updating explains itself, and can no longer be mistaken for failing.

- The window is brought forward before the update dialog is shown. It is
  attached to that window, so with the app behind something else there was
  nothing to see — a downloaded update waiting on an answer looked exactly like
  one that had failed.
- The dialog says the app will close for about ten seconds and that the gap is
  the installer working. Measured: quits at five seconds, swapped by ten,
  running again by fifteen.
- Checks run every two hours and whenever the app is focused, rather than once
  a day. A release published while the app was open went unnoticed until the
  next day, which is indistinguishable from a broken updater.
- A failed install offers to open the releases page instead of pointing at a log
  file. It also waited four seconds before declaring failure — inside the time a
  successful install takes — and now waits twenty-five.

- **Intro and outro cards.** A title, a subtitle and an optional logo, held for
  as long as you like before the recording starts and after it ends. They are
  extra time either side of the take rather than separate clips, so they scrub,
  preview, fade and export exactly like everything else — no second encode, no
  stitching, and no intro whose colour or frame rate is subtly not the
  recording's. They travel with a profile, so every take can open the same way.

## 1.0.3 — 2026-08-17

- **Moving the camera sync offset stopped playback permanently.** Seeking past a
  track's duration clamps silently, so the position asked for was never reached
  and the loop asked again every frame — a seek per frame, which stops the
  element playing at all. Reachable at the end of any take, since the camera
  track is shorter than the screen track; the offset just made it immediate.
- **The app has a menu.** There wasn't one, and on macOS the standard editing
  shortcuts come from the Edit menu — so there was no Cmd-C or Cmd-V in the
  caption editor or the preset name field. It also adds Check for Updates,
  About (which shows the running version), and shortcuts to both update logs.
- **Settings carry into the next take.** The recorder already remembered its
  setup; the editor now remembers the look too, so New recording no longer
  resets the background, padding, zoom feel and caption styling.

## 1.0.2 — 2026-08-17

- **Transcription was losing words.** Windows are now short clips overlapped
  heavily — six seconds every two — so every moment of audio is heard three
  times and never only at a clip's opening, which is the part the recogniser
  does not hear. Across three real takes, uncaptioned speech falls from 3.5s to
  1.0s. Four minutes of audio takes 71 seconds rather than 26.
- Hearing everything three times means saying it three times, so repeats are
  trimmed loosely (a quarter of the words may differ), may start a few words in,
  and are compared against the line being assembled rather than the fragment
  that arrived last.
- A brief caption is held on screen long enough to read — a word timed to its
  own sound can last a fifth of a second, which reads as a fault.
- The export dialog appeared behind the timeline, hiding the Export button. It
  was a fixed overlay, which is not enough: any ancestor with a transform
  contains it, and the editor has several. Every modal is now portalled into the
  document body. The dialog's buttons are also pinned to the bottom of the card,
  since one taller than the window put them below the fold.

## 1.0.1 — 2026-08-17

- Captions were early by the camera offset. The narration is in the camera
  recording, which starts after the screen track, so times taken from it landed
  ahead of the editor's clock by a small constant amount — enough to read as
  text that is not quite in time.
- The updater logs to `~/Library/Logs/DemoDog/updater.log`, destroys windows
  before installing, and says so plainly if the app is still running four
  seconds after being told to restart. Anything holding a window open left the
  installer waiting for a quit that never came, which presented as a Restart
  button that did nothing.
- A transcription helper that dies now reports its exit status and output
  instead of returning an empty transcript, since "heard nothing" and "died
  trying" looked identical from the outside.
- Recognition accuracy: windows are resampled to 16 kHz mono and re-encoded
  before recognition, which measurably changes what the recogniser hears.
- Clicking anywhere on the timeline moves the playhead, lines can be added by
  hand, and the capture setup is remembered between takes.

## 1.0.0 — 2026-08-17

- **Transcription and captions.** Narration is transcribed on this Mac — on
  device, never uploaded — and becomes timed text drawn over the recording. The
  lines appear on the timeline; clicking one selects it, jumps the playhead to
  it, and opens it for editing, so a misheard word is fixed in place rather than
  by re-transcribing.
- Transcript lines are whole sentences. Filling each line to a character limit
  and starting a new one on overflow left the tail of a sentence stranded on
  screen — a caption reading "dog." for a third of a second — which looks
  exactly like a transcript with words missing. Long sentences are now split
  into even parts instead.
- Captions are styled per project: font, size, weight, colour, upper case,
  position and alignment, line width and spacing, outline, shadow, a backing
  plate for busy footage, and a fade at each end. The style travels with a
  profile; the transcript belongs to its own recording.
- **Publish to YouTube** after an export: the corrected captions are written
  beside the video as an SRT file, the title and chapter marks go on the
  clipboard, YouTube Studio opens and the file is revealed ready to drag. A
  handoff rather than an upload, deliberately — uploading through YouTube's API
  requires a verified app, and until one is verified every video it uploads is
  locked to private with no appeal.
- The camera's sync point is stamped when capture actually begins rather than
  before the file is opened, removing a fixed lip-sync offset.
- Building and shipping are now separate. `npm run dist` builds and stops;
  `npm run release -- <version>` is the only thing that publishes.

## 0.9.1 — 2026-08-17

- Exports rendered with no zoom at all. The shot list was replaced with an empty
  one immediately before the exporter read it, while the preview kept its own
  and looked correct.
- The export summary reports its shot count, and the build fails if a test
  export comes back with none.

## 0.9.0 — 2026-08-17

- The app asks for screen recording rather than only checking for it. It
  previously sent the user to a System Settings list that did not contain
  DemoDog, because nothing had ever requested it.
- A three-step first-run tour of the camera, audio and capture settings.
- The camera tab explains where background blur comes from — macOS applies it at
  the camera, from Control Centre.
- Light theme by default; dark and system still a click away.
- Dark-theme contrast fixes, including genuinely black-on-black text on the
  selected source tab.
- The permission notice is a card rather than a banner.

## 0.1.2 — 2026-08-16

- Universal build: Intel as well as Apple silicon, capture helper included.
- Automatic updates, with the restart left to the user and never during a take.
- An export is checked for being frozen before any build ships.
- The disk image is signed as well as notarised.

## 0.1.1 — 2026-08-16

- Fixed frozen exports: the fast decode path never advanced past its first
  frame, and three further faults sat behind that one.
- Takes are `.demodog` packages.
- The export destination is chosen before rendering rather than after.

## 0.1.0 — 2026-08-16

First packaged build.
