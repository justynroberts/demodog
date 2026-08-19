# Changelog

Work lands on `main` continuously. Nothing reaches anyone until a release is
cut — the updater reads the latest GitHub release, not the branch — so this file
is where finished work waits.

## Unreleased

- **Background music.** A bed under the whole piece, title cards included, with
  its own level, fades, a start offset and looping when the track is shorter
  than the take. It appears as a lane on the timeline rather than only in a
  panel.
- **It ducks under the narration by itself.** The transcript already states
  where words are, so ducking is scheduled from the caption cues rather than
  detected from the audio: exact, free, and still correct after a line is
  retimed or deleted. Adjacent cues are merged first, since a bed that pumps
  between sentences is more distracting than one that never moves. Measured in
  a real export at 18.1 dB down against the 18 asked for.
- A headless export can be handed project settings — captions, cards, music,
  the zoom feel — through `DEMODOG_BENCH_PROJECT`. It could previously only
  render whatever the app happened to remember, which made anything about the
  project impossible to render deliberately or to check.

## 1.4.5 — 2026-08-19

- Transcription now names the case it actually found. 1.4.4 stopped it claiming
  "no speech was heard" when there was no audio, but it still blamed the
  microphone for a take that never had one — telling someone to check a device
  that was not involved. There are three separate answers now: recorded without
  a microphone, a camera track carrying no audio, and a microphone that was
  recorded but captured nothing.
- Bug reports carry the real permission state rather than whether the privacy
  subsystem had logged anything recently, which was the same answer for every
  service whether granted or not. Each recent take also says what it
  contributed, so a take whose recording never started reads as that rather
  than as a report that collected less than it claimed.

## 1.4.4 — 2026-08-19

- **"No speech was heard" was often not true.** Transcription chose its source
  by which file *existed* rather than which had anything in it, so a take
  recorded with a camera but no microphone handed the recogniser a video-only
  file. Every window then failed to extract, those failures were emitted as
  warnings nobody surfaced, and the count that would have caught it was only
  incremented further down — past the point the failures happened. The result
  was no words, no errors and a message that sent people to check a microphone
  level when the microphone was never in the take. The screen track, which may
  well have carried the sound, was never even considered.
- The source is now chosen by what it contains, and the three causes are told
  apart: no audio track at all, a track that is digital silence, and audio the
  recogniser genuinely could not make out. The silent case reports the peak
  level it measured.
- Bug reports include what each track of the last few takes contains — length
  and peak level — because those three cases are indistinguishable from a
  description.

## 1.4.3 — 2026-08-19

- **The camera vanished from the recording bar.** The bar shows Start before a
  take and Stop during one, and those were two separate pieces of markup — so
  the element the camera stream attaches to only existed in the second. The
  stream was handed over while the bar still showed Start, found nothing to
  attach to, and the camera was missing for the whole take. One bar now, with
  the video kept mounted through both states.
- **The countdown appeared on the wrong screen.** A window capture carries no
  display id, so 3-2-1 fell back to the primary display — counting down on a
  screen you were not watching while the one being recorded showed nothing. It
  now goes on the display the chosen window sits on.
- **Editing a caption could not type a space.** Every editor shortcut is a plain
  key, and the guard that keeps them out of text fields listed inputs and
  selects but not text areas — which is what the caption editor is. So Space
  toggled playback, Backspace deleted the selected zoom shot and the arrows
  scrubbed the playhead, all while typing.

## 1.4.2 — 2026-08-19

- **The app got in its own way between choosing a source and recording it.** The
  studio window was hidden when the *recording* started, not when *Let's Start*
  was pressed — so it stayed on screen for the whole arranging step, sitting
  behind the window it had just raised. Worse, pressing Start on the bar
  activates the app, and macOS raises an app's windows when it is activated: the
  studio jumped to the front at the exact moment it was meant to disappear.
  It now goes away as soon as Let's Start is pressed, leaving the floating bar
  and your own windows; **Back** brings it straight back.
- The bar no longer names the window it just brought forward. You chose it a
  second ago and it is the window now in front of you; repeating it back is a
  label nobody reads.
- Raising the chosen window no longer raises every other window that
  application owns. Rearranging someone's desktop around a choice they made
  about one window is not what they asked for.

## 1.4.1 — 2026-08-18

- **A recording now refuses rather than capturing the wrong window.** Windows
  are identified by an id, and macOS reuses those ids. That was academic while
  recording began moments after choosing; it is not now that there is a step in
  between where the user is deliberately opening and closing things. If the id
  no longer belongs to the application it belonged to when it was picked, the
  take stops with a message naming what it found. A recording of the wrong
  window has nothing in it to reveal the mistake — it simply contains the wrong
  application.

## 1.4.0 — 2026-08-18

- **Choosing a window now brings it to the front**, and there is a step between
  choosing what to record and recording it. The first button says *Let's Start*
  and puts the floating control bar up in a *ready* state — the same bar that
  carries Stop during a take, wearing its other hat. It floats above every
  window including the one just raised, which the studio window does not: the
  first attempt drew the button inside the studio, where being pushed behind the
  raised window took it out of reach.
  Everything before that point is configuration, everything after it is
  arranging your actual screen, and having the start button at the end of a
  settings panel meant the first seconds of every take were spent moving
  windows into place. Raising the chosen window matters for more than
  convenience: a window left behind something else is also the one that records
  almost nothing, since capture only produces frames when its content changes.

- **A window capture recorded almost no frames, and its audio drifted.** Both
  were the same fault. ScreenCaptureKit produces pixels only when the content
  changes, and an idle frame was discarded as having nothing in it. A whole
  display always changes, so this never showed; one window that is largely
  still does not. A nine-second capture of a terminal recorded **13 frames**
  against 523 idle ones — which plays as a frozen picture, and leaves the video
  track running 12.6s against 9.2s of audio, because a track assembled from
  sparse samples does not end where the sound does. That divergence is the
  lip-sync fault, and it is why it only ever appeared on window captures. An
  idle frame now repeats the last real one at the current time; identical
  frames cost a few bytes each to encode.

- **Turning the camera bubble off removed your narration from the export.** The
  microphone is recorded into the camera file, and one flag decided both
  whether the bubble was drawn *and* whether that file was read at all — so
  switching off the picture-in-picture, which people do when they would rather
  not be in the corner of their own demo, silently exported the video without
  their voice. Nothing in the preview showed it, because the preview plays the
  camera element's audio whether or not the bubble is drawn. Found by writing
  the sync check below, not by anyone noticing.
- Exports are now checked for audio/video sync before any build ships. The
  fixture's camera track carries a 1 kHz pip every two seconds, and the check
  measures where those land in the exported file: it fails if any mark is more
  than 60ms out, and separately if the marks have moved by *different* amounts,
  which is drift rather than an offset and needs a different fix. Every check
  that existed passed happily on a file whose audio was a second adrift.

- **Capturing a single window could produce a take with no video.**
  ScreenCaptureKit marks the first frame of a stream `.started` rather than
  `.complete`, and only `.complete` was being kept. A whole display is never
  still — something always moves within a frame or two — so a `.complete` frame
  always followed and the omission never showed. One window that is not moving
  emits `.started` once and `.idle` thereafter, so the writer session was never
  begun, every audio buffer was dropped waiting for it, and the recording came
  back empty.
- That is also the most likely cause of **audio running ahead of the picture in
  an exported window capture**: the session starting late means the sound
  recorded before it is discarded. Reported as fixed with less confidence than
  the above, since it has not been reproduced here.
- **Transcription that never ran looked exactly like a recording with no
  speech.** Each window is recognised in a child process, and a child that was
  refused permission exited silently and was counted as having heard nothing.
  When every window fails, that is now reported as the failure it is — with the
  Speech Recognition permission named. A genuinely silent take says so too, and
  points at the microphone rather than leaving "no speech was found" to be
  interpreted.
- Takes record what the capture stream actually delivered, counted by frame
  status, so a recording that comes back empty can say why rather than leaving
  nothing behind to look at.
- **Report a bug** in the info panel: collects the version, this Mac's details
  and the app's logs into a file, reveals it, and opens a pre-filled message.
  Never a recording, its audio or its transcript.


- **A tip jar on the export card.** A quiet *Thanks* opens a note asking, once
  and without insisting, whether the app was worth a coffee. Ko-fi publish a
  drop-in widget script, which cannot be used here — the renderer runs under
  `script-src 'self'` and loading a third-party script to draw a button would
  mean reopening that. The widget only ever renders a link to the same page, so
  this is that link, in Ko-fi's own blue, opened in the real browser where
  someone is already signed in.
- Groundwork for product analytics, **dormant**. GA4's Measurement Protocol
  from the main process rather than a tag script in the renderer, for the same
  content-policy reason, and because a tag script in an app window reports
  half-populated page views. It is off by default *and* carries no credentials,
  so nothing is sent: the app still makes no third-party requests beyond the
  update check. Turning it on is a deliberate two-part act, and the reasoning
  for leaving it off is recorded next to the code so it does not read as an
  oversight later.

## 1.3.1 — 2026-08-18

- **Playback still stopped at the end of the recording rather than the end of
  the outro.** 1.3.0 fixed the wrong half of this. The playhead is read back off
  the video element, which cannot report a time past the end of its own file —
  so pausing at the trim left it a few milliseconds *below* the boundary it was
  waiting to cross. The outro was never entered, and the `ended` event never
  arrived either, because the element had been stopped before it got there. The
  crossing is now explicit, and a file that runs out before the trim does — the
  ordinary case, since the trim defaults to the recording's stated duration —
  moves the piece on rather than waiting for a time that will never come.

## 1.3.0 — 2026-08-18

- **The recording played underneath the intro card.** Pressing play started the
  video immediately, and the card branch of the draw loop never paused it — so
  the take's audio ran while the title was on screen and the picture advanced
  behind it, then snapped back when the card lifted. Nothing of the recording
  runs while a card is showing now.
- **The outro was often never shown.** A take's video file can end a hair before
  its trim does, and reaching the end of the file stopped playback outright.
  With an outro still to come that is not the end of the piece, so the clock is
  handed to the card instead of stopping.
- **Title cards can carry a picture.** A full-bleed background image, set to
  fill the frame or fit inside it, with an adjustable wash of the background
  colour over it so text stays readable over a photograph.
- Cards choose their own font and their own subtitle size, rather than
  borrowing the caption face.
- Card artwork is decoded before an export begins. The preview can miss an
  image and pick it up on the next frame; the exporter draws each frame once, so
  a picture chosen just before pressing Export was silently absent from the file.

## 1.2.0 — 2026-08-18

- **Title cards are on the timeline.** They were playable but not scrubbable:
  the timeline started at the beginning of the recording, and a card is time
  *before* that, so the playhead sat pinned at the left edge for the whole intro
  and there was no way to scrub back into a card to see it. The timeline now
  covers the whole composition, with the cards shown as their own lane.
- Typefaces are bundled in the app rather than fetched from Google on launch.
  Offline — an aeroplane, a captive-portal conference wifi — the interface
  silently fell back to the system font. It also means the app now makes no
  third-party requests at all; the only thing it contacts is GitHub, to check
  for a newer version.
- Two doors led out of the app to the operating system and only one of them was
  locked. Opening a link from the page checked that it was a web address; a
  `window.open` did not, and handed whatever scheme it was given straight to
  macOS. Both now go through the same check.
- Transcribing a take no longer grants the editor permission to stream files
  from that folder. It never needed it — the audio is read outside the editor
  and only text comes back — and it was the one place that boundary could be
  widened without the user having picked anything.

## 1.1.0 — 2026-08-17

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
