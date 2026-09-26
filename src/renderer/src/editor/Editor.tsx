// MIT License - Copyright (c) fintonlabs.com
import { editsFromDisk, zoomKeyOf, type TakeEdits } from '../engine/edits'
import {
  commit,
  emptyHistory,
  redo as redoStep,
  sameState,
  undo as undoStep,
  type EditState,
  type History
} from '../engine/history'
import {
  annotationDefaults,
  outputRect,
  sourceToOutput,
  type Annotation,
  type AnnotationKind
} from '../engine/annotations'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../api'
import { ensureTitleImages, phaseAt, recordingEnded, recordingRuns } from '../engine/titles'
import { Composition } from '../engine/composition'
import { baseViewport } from '../engine/camera'
import { generateSegments } from '../engine/autozoom'
import {
  defaultProject,
  mergeSettings,
  rememberLook,
  rememberedLook,
} from '../engine/defaults'
import { exportMP4 } from '../engine/export'
import type { Project, Recording, ZoomSegment } from '../engine/types'
import { fadeAlphaAt } from '../engine/composition'
import { fadeOutAndPause, isRamping, rampVolume } from './mediaFade'
import { musicLevelAt, musicTimeAt } from './music'
import { formatTime } from '../ui/controls'
import Timeline from './Timeline'

/**
 * How wide the settings panel is when it is there at all.
 *
 * There are two states, and they are shown and hidden — not two widths. The
 * panel is either being used, in which case it wants room, or it is not, in
 * which case the picture should have the whole window. Anything between those
 * serves neither.
 *
 * Wide enough for the settings to sit in two columns, which is the point of
 * the width: the same panel that was one long scroll at 300px shows most of a
 * tab at once here.
 */
const RAIL_WIDTH = 560
import Inspector from './Inspector'
import ExportedPanel from './ExportedPanel'
import ExportDialog, { formatDuration, rememberRate, type ExportChoice } from './ExportDialog'

/** Names the export after the take it came from, rather than a bare timestamp. */
function suggestedExportName(takeDir: string): string {
  const base = (takeDir.split('/').pop() ?? 'demodog')
    .replace(/\.demodog$/, '')
    .replace(/^take_/, '')
  return `DemoDog ${base.replace(/_/g, ' ')}.mp4`
}

export default function Editor({
  recording,
  bench = null
}: {
  recording: Recording
  /** Headless benchmark: export straight to this path, then quit. */
  bench?: { out: string; seconds: number; plain?: boolean; project?: unknown } | null
}): ReactNode {
  /**
   * What was done to this take last time it was open, if anything.
   *
   * Never for a headless export: those render exactly what they are handed,
   * and a stray edits file must not change a scripted result.
   */
  const [saved] = useState<TakeEdits | null>(() =>
    bench ? null : editsFromDisk(recording.edits, recording.duration)
  )
  const [project, setProject] = useState<Project>(() => {
    const base = defaultProject(recording.source, Boolean(recording.cameraURL))
    // Applied here rather than in an effect, because the export closure
    // captures the project it was created with — updating the state later left
    // the overlays on and the check they exist to isolate meaningless.
    // Settings handed in from outside take precedence over the defaults, and
    // over anything the app remembers — a scripted export has to be able to say
    // exactly what it wants rendered.
    const fromOutside = bench?.project ? mergeSettings(base, bench.project) : base
    const given = saved
      ? { ...fromOutside, captions: saved.captions, annotations: saved.annotations }
      : fromOutside
    if (!bench?.plain) return given
    return {
      ...given,
      zoom: { ...given.zoom, enabled: false },
      // `visible`, not `enabled` — the cursor has its own key, and setting the
      // wrong one left the pointer drawn and moving, which is enough on its own
      // to make every exported frame differ.
      cursor: { ...given.cursor, visible: false },
      pip: { ...given.pip, enabled: false },
      // Fades brighten the picture across the opening and closing second, which
      // changes it every frame regardless of the recording underneath.
      fade: { in: 0, out: 0 }
    }
  })
  // Generated here rather than by the effect below, so the editor never
  // passes through a moment with no shots — which would look like every
  // automatic zoom had been deleted, and be saved as such.
  const [segments, setSegments] = useState<ZoomSegment[]>(
    () =>
      saved?.segments ??
      generateSegments(recording.input, project.zoom, recording.source, recording.duration)
  )
  // Read at call time, not closure time. The headless export runs from a timer
  // set when the editor mounted, which is before auto-zoom has produced
  // anything — so the shots it captured were the empty list.
  const segmentsRef = useRef<ZoomSegment[]>([])
  segmentsRef.current = segments
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [selectedCaption, setSelectedCaption] = useState<string | null>(null)
  /** Armed by the inspector: the next drag on the preview chooses a zoom area. */
  /**
   * How wide the settings rail is, and whether it is there at all.
   *
   * A fixed 300px meant six tabs in a single scrolling column, so anything past
   * the first panel was below the fold and Music sat buried inside Camera.
   * Widening it buys tab room; collapsing it gives the whole window back to the
   * picture, which is what you want while judging a shot rather than changing
   * one. Remembered, because it is a working preference rather than a decision
   * to be made again every launch.
   */
  /**
   * Whether the rail is expanded, remembered between sessions.
   *
   * A working preference rather than a decision to make again every launch.
   */
  const [railOpen, setRailOpen] = useState(
    () => localStorage.getItem('demodog-rail-open') !== 'false'
  )
  useEffect(() => {
    localStorage.setItem('demodog-rail-open', String(railOpen))
  }, [railOpen])

  const [picking, setPicking] = useState(false)
  /**
   * Armed from the Annotate tab: the next drag on the preview places a mark of
   * this kind — or redraws the one named in `replace`.
   */
  const [annotating, setAnnotating] = useState<{ kind: AnnotationKind; replace?: string } | null>(
    null
  )
  const annotatingRef = useRef(annotating)
  annotatingRef.current = annotating
  /** The mark being dragged out, in output pixels. Preview only. */
  const drawingRef = useRef<{
    kind: AnnotationKind
    x0: number
    y0: number
    x1: number
    y1: number
  } | null>(null)
  const [selectedNote, setSelectedNote] = useState<string | null>(null)
  const selectedNoteRef = useRef<string | null>(null)
  selectedNoteRef.current = selectedNote
  const pickRef = useRef<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const [exported, setExported] = useState<{ path: string; captions: number } | null>(null)
  const [cameraSync, setCameraSync] = useState(() => saved?.cameraSync ?? 0)
  const [trim, setTrim] = useState<{ start: number; end: number }>(
    () => saved?.trim ?? { start: 0, end: recording.duration }
  )
  const [exporting, setExporting] = useState<{
    fraction: number
    stage: string
    /** Seconds remaining, once enough of the run has happened to say. */
    remaining: number | null
  } | null>(null)
  const [askingExport, setAskingExport] = useState(false)
  const screenRef = useRef<HTMLVideoElement>(null)
  const cameraRef = useRef<HTMLVideoElement>(null)
  const musicRef = useRef<HTMLAudioElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const timeRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  const lastBenchLog = useRef(0)
  /** Wall clock while a title card is showing and the video is not running. */
  const cardClock = useRef(0)

  const leadIn = project.intro.enabled ? project.intro.seconds : 0
  const leadOut = project.outro.enabled ? project.outro.seconds : 0

  const composition = useMemo(
    () => new Composition(recording, { ...project, segments }),
    [recording, project, segments]
  )

  /**
   * Settings carry into the next take on their own.
   *
   * There is no profile to pick, star or save: how the app was left *is* the
   * setting. Profiles were a second place for the same information to live, and
   * every bug in this area came from the two disagreeing — a look restored
   * correctly while the picker that named it went blank, and a Save that made a
   * copy because nothing pointed at the original any more.
   */
  useEffect(() => {
    // Settings handed to a headless export are the whole point of that export,
    // so nothing remembered may override them.
    if (bench?.project) return
    const remembered = rememberedLook()
    if (remembered) setProject((current) => mergeSettings(current, remembered))
  }, [recording, bench])

  // Remembered on every change, so a look tuned and then abandoned is still
  // there for the next take. The transcript and the shots are deliberately not
  // included: those belong to one recording and nothing else.
  useEffect(() => {
    rememberLook(project)
  }, [project])


  // Regenerate the automatic zooms whenever their settings change, keeping any
  // segment the user added or edited by hand.
  //
  // Only when they actually change. A take reopened with the settings its shots
  // were saved under keeps those shots exactly — including an automatic one
  // deleted by hand, which regenerating would quietly bring back.
  const zoomKeyRef = useRef<string>(saved ? saved.zoomKey : zoomKeyOf(project.zoom))
  /** How many automatic shots the settings produce, to notice one being deleted. */
  const autoCountRef = useRef<number>(segments.filter((s) => s.auto).length)
  useEffect(() => {
    const key = zoomKeyOf(project.zoom)
    if (key === zoomKeyRef.current) return
    zoomKeyRef.current = key
    const auto = generateSegments(
      recording.input,
      project.zoom,
      recording.source,
      recording.duration
    )
    autoCountRef.current = auto.length
    setSegments((prev) =>
      [...auto, ...prev.filter((s) => !s.auto)].sort((a, b) => a.start - b.start)
    )
  }, [recording, project.zoom])

  // ---- undo and redo -------------------------------------------------------
  //
  // Everything editable is snapshotted: settings, captions, marks, zoom shots,
  // the trim and the camera sync. A run of changes that arrive together — a
  // slider under the thumb, a shot being dragged — settles into one step after
  // a short pause, so ⌘Z undoes the drag rather than a frame of it.
  const live: EditState<Project, ZoomSegment> = { project, segments, trim, cameraSync }
  const liveRef = useRef(live)
  liveRef.current = live
  const history = useRef<History<Project, ZoomSegment>>(emptyHistory(live))
  /** Set while an undo is being applied, so it is not recorded as a change. */
  const applying = useRef(false)
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null)

  const apply = useCallback((state: EditState<Project, ZoomSegment>): void => {
    applying.current = true
    if (settle.current) clearTimeout(settle.current)
    settle.current = null
    // The shots in a snapshot are the truth, including any deleted by hand.
    // Without this, undoing a change to the zoom settings would regenerate the
    // automatic shots from those settings and quietly overwrite them.
    zoomKeyRef.current = zoomKeyOf(state.project.zoom)
    autoCountRef.current = state.segments.filter((s) => s.auto).length
    setProject(state.project)
    setSegments(state.segments)
    setTrim(state.trim)
    setCameraSync(state.cameraSync)
    // A shot or mark that no longer exists cannot stay selected.
    setSelected((id) => (state.segments.some((s) => s.id === id) ? id : null))
    setSelectedNote((id) => ((state.project.annotations ?? []).some((n) => n.id === id) ? id : null))
    setSelectedCaption((id) => (state.project.captions.some((c) => c.id === id) ? id : null))
  }, [])

  useEffect(() => {
    if (applying.current) {
      applying.current = false
      history.current = { ...history.current, present: liveRef.current }
      return
    }
    if (sameState(history.current.present, live)) return
    if (settle.current) clearTimeout(settle.current)
    settle.current = setTimeout(() => {
      settle.current = null
      history.current = commit(history.current, liveRef.current)
    }, 450)
  }, [project, segments, trim, cameraSync])

  const undo = useCallback((): void => {
    if (settle.current) {
      clearTimeout(settle.current)
      settle.current = null
    }
    const step = undoStep(history.current, liveRef.current)
    if (!step) return
    history.current = step.history
    apply(step.state)
  }, [apply])
  const redo = useCallback((): void => {
    const step = redoStep(history.current)
    if (!step) return
    history.current = step.history
    apply(step.state)
  }, [apply])
  // Kept current for the key handler and the menu, both registered once.
  const undoRef = useRef(undo)
  undoRef.current = undo
  const redoRef = useRef(redo)
  redoRef.current = redo
  useEffect(
    () =>
      api.onMenuEdit((what) => {
        // Including while a caption is being typed into.
        //
        // The obvious thing — leave a focused text field to the browser's own
        // undo — does not work here: every field in the editor is a controlled
        // React input, whose value comes from the project on the next render,
        // so the browser's undo is immediately overwritten and ⌘Z appears to do
        // nothing. The editor's history holds the caption text anyway, and a
        // burst of typing settles into one step.
        if (what === 'undo') undoRef.current()
        else redoRef.current()
      }),
    []
  )

  // ---- keeping edits with the take ---------------------------------------
  //
  // Written beside the recording a moment after each change, and flushed when
  // the editor closes. A take that has only been looked at gets no file: there
  // is nothing of the user's in it to keep.
  const lastSaved = useRef<string>(saved ? JSON.stringify(saved) : '')
  /**
   * Whether this take has an edits file at all.
   *
   * Once it has one it is always kept up to date, even when the edits are
   * undone back to nothing. Skipping the write in that case left the file
   * saying what had just been undone, and reopening the take brought it back.
   */
  const written = useRef(saved !== null)
  const latest = useRef<{ text: string; edits: TakeEdits } | null>(null)
  useEffect(() => {
    if (bench) return
    const edits: TakeEdits = {
      version: 1,
      captions: project.captions,
      annotations: project.annotations ?? [],
      segments,
      zoomKey: zoomKeyRef.current,
      trim,
      cameraSync
    }
    const edited =
      written.current ||
      edits.captions.length > 0 ||
      edits.annotations.length > 0 ||
      cameraSync !== 0 ||
      trim.start > 0 ||
      trim.end < recording.duration ||
      segments.some((s) => !s.auto) ||
      segments.filter((s) => s.auto).length !== autoCountRef.current
    if (!edited) {
      latest.current = null
      return
    }
    const text = JSON.stringify(edits)
    if (text === lastSaved.current) return
    latest.current = { text, edits }
    const timer = setTimeout(() => {
      lastSaved.current = text
      written.current = true
      api.saveEdits(recording.dir, edits)
    }, 400)
    return () => clearTimeout(timer)
  }, [project.captions, project.annotations, segments, trim, cameraSync, recording, bench, saved])

  // The last change is never lost to the delay: saved on the way out.
  useEffect(() => {
    const flush = (): void => {
      const pending = latest.current
      if (pending && pending.text !== lastSaved.current) {
        lastSaved.current = pending.text
        written.current = true
        api.saveEdits(recording.dir, pending.edits)
      }
    }
    window.addEventListener('beforeunload', flush)
    return () => {
      window.removeEventListener('beforeunload', flush)
      flush()
    }
  }, [recording])

  // Open just past the fade-in. At t=0 the frame is legitimately black, which
  // reads as a broken preview rather than as a fade — and it puts the playhead
  // hard against the left edge where it is easy to miss.
  const openedAt = useRef(false)
  useEffect(() => {
    openedAt.current = false
  }, [recording])

  // ---- transport ---------------------------------------------------------

  const seek = useCallback(
    (t: number) => {
      const clamped = Math.min(Math.max(t, -leadIn), recording.duration + leadOut)
      timeRef.current = clamped
      setTime(clamped)
      const screen = screenRef.current
      // The element cannot go before its own start, so during the intro it
      // simply waits on the first frame. Nothing of it is visible anyway.
      if (screen) screen.currentTime = Math.max(0, Math.min(clamped, recording.duration))
      const camera = cameraRef.current
      if (camera) {
        const ct = clamped - recording.cameraOffset - cameraSync
        if (ct >= 0) camera.currentTime = ct
      }
    },
    [recording, cameraSync, leadIn, leadOut]
  )

  const togglePlay = useCallback(() => {
    const screen = screenRef.current
    if (!screen) return
    if (playing) {
      screen.pause()
      cameraRef.current?.pause()
      setPlaying(false)
    } else {
      // Start again only from the very end; otherwise start from wherever the
      // playhead is. The element can disagree with the playhead — a seek that
      // was still in flight when playback stopped, for one — so the position is
      // re-asserted rather than assumed, which is what made pressing play after
      // clicking the timeline begin from the beginning.
      if (timeRef.current >= trim.end + leadOut - 0.02) {
        seek(trim.start - leadIn)
      } else {
        const want = Math.max(0, Math.min(timeRef.current, recording.duration))
        if (Math.abs(screen.currentTime - want) > 0.05) screen.currentTime = want
      }
      cardClock.current = performance.now()
      // Not while a card is showing. The recording is not on screen yet, and
      // starting it here meant its audio played underneath the intro and the
      // picture advanced behind the card — so the take was already several
      // seconds in by the time the card lifted, and then snapped back. The
      // draw loop starts it at the moment the card ends.
      if (recordingRuns(phaseAt(timeRef.current, trim, leadIn, leadOut))) void screen.play()
      else screen.pause()
      // The camera is started by the draw loop rather than here: its track
      // begins slightly after the screen's, so at t=0 it is not due yet.
      setPlaying(true)
    }
  }, [playing, seek, trim, recording, cameraSync, leadIn, leadOut])

  /**
   * How far into the camera track it is possible to seek.
   *
   * Unknown until the metadata loads, and asking for a position beyond it is
   * not an error — it is silently clamped, which is worse, because the caller
   * cannot tell the difference between arriving and being refused.
   */
  const cameraLimit = (camera: HTMLVideoElement): number =>
    Number.isFinite(camera.duration) && camera.duration > 0 ? camera.duration : Infinity

  /**
   * Keeps the music bed in step with the playhead.
   *
   * The exporter renders the bed as Web Audio automation; the preview has an
   * `<audio>` element and a volume, so the same shape is computed and applied
   * frame by frame. Position is only corrected when it has drifted past a
   * threshold — assigning `currentTime` every frame restarts the decoder and
   * the result stutters rather than plays.
   */
  const driveMusic = useCallback(
    (t: number, playing: boolean) => {
      const bed = musicRef.current
      const music = project.music
      if (!bed || !music.src) return

      if (!playing) {
        if (!bed.paused) bed.pause()
        return
      }

      const want = musicTimeAt(t, music, bed.duration || 0, trim, leadIn)
      if (want === null) {
        // The bed has run out and is not looping. Silence rather than a stop,
        // so a later seek backwards picks it up again without a reload.
        bed.volume = 0
        if (!bed.paused) bed.pause()
        return
      }

      bed.volume = musicLevelAt(t, music, project.captions, trim, leadIn, leadOut)
      if (Number.isFinite(bed.duration) && Math.abs(bed.currentTime - want) > 0.25) {
        bed.currentTime = want
      }
      if (bed.paused) void bed.play().catch(() => undefined)
    },
    [project.music, project.captions, trim, leadIn, leadOut]
  )

  /**
   * Turns a drag on the preview into a zoom shot framed on what was dragged.
   *
   * The preview may itself be zoomed at this moment, so a point on screen is
   * not a point in the recording: it is read back through the viewport the
   * camera is using at this instant, which is the same mapping the compositor
   * used to draw it.
   */
  const beginPick = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    if (!picking || event.button !== 0) return
    const canvas = canvasRef.current
    if (!canvas) return
    event.preventDefault()

    const toCanvas = (clientX: number, clientY: number): { x: number; y: number } => {
      const box = canvas.getBoundingClientRect()
      return {
        x: ((clientX - box.left) / box.width) * project.output.width,
        y: ((clientY - box.top) / box.height) * project.output.height
      }
    }

    const from = toCanvas(event.clientX, event.clientY)
    pickRef.current = { x0: from.x, y0: from.y, x1: from.x, y1: from.y }

    const move = (e: PointerEvent): void => {
      const to = toCanvas(e.clientX, e.clientY)
      if (pickRef.current) pickRef.current = { ...pickRef.current, x1: to.x, y1: to.y }
    }

    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      const box = pickRef.current
      pickRef.current = null
      setPicking(false)
      if (!box) return

      const w = Math.abs(box.x1 - box.x0)
      const h = Math.abs(box.y1 - box.y0)
      // A click rather than a drag; nothing was chosen.
      if (w < 24 || h < 24) return

      const cam = composition.camera.at(timeRef.current)
      const content = composition.content
      const toSource = (x: number, y: number): { x: number; y: number } => ({
        x: cam.viewport.x + ((x - content.x) / content.w) * cam.viewport.w,
        y: cam.viewport.y + ((y - content.y) / content.h) * cam.viewport.h
      })
      const a = toSource(Math.min(box.x0, box.x1), Math.min(box.y0, box.y1))
      const b = toSource(Math.max(box.x0, box.x1), Math.max(box.y0, box.y1))

      const base = baseViewport(recording.source, content.w / content.h)
      // Whichever side needs the least magnification, so everything chosen
      // stays in frame rather than being cropped to fit.
      const scale = Math.min(base.w / Math.max(1, b.x - a.x), base.h / Math.max(1, b.y - a.y))
      const clamped = Math.min(6, Math.max(1.05, scale))
      const centre = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }

      if (selected) {
        setSegments((current) =>
          current.map((seg) =>
            seg.id === selected
              ? { ...seg, x: centre.x, y: centre.y, scale: clamped, auto: false }
              : seg
          )
        )
        return
      }
      // Nothing selected: the drag makes a shot at the playhead.
      const at = timeRef.current
      const segment: ZoomSegment = {
        id: `manual-${Date.now()}`,
        start: Math.max(0, at - 0.3),
        end: Math.min(recording.duration, at + 2.2),
        easeIn: 0.7,
        easeOut: 0.8,
        scale: clamped,
        x: centre.x,
        y: centre.y,
        auto: false,
        follow: 0.4
      }
      setSegments((current) => [...current, segment].sort((a2, b2) => a2.start - b2.start))
      setSelected(segment.id)
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  /**
   * Places a mark by dragging on the preview.
   *
   * Converted to recording coordinates through the camera as it is at this
   * instant, exactly as a zoom area is — so a box drawn around a button while
   * zoomed in still sits around that button when the camera pulls back out.
   */
  const beginAnnotate = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const armed = annotatingRef.current
    if (!armed || event.button !== 0) return
    const canvas = canvasRef.current
    if (!canvas) return
    event.preventDefault()
    // Placing a mark on a moving picture would put it on the wrong frame.
    setPlaying(false)

    const toCanvas = (clientX: number, clientY: number): { x: number; y: number } => {
      const box = canvas.getBoundingClientRect()
      return {
        x: ((clientX - box.left) / box.width) * project.output.width,
        y: ((clientY - box.top) / box.height) * project.output.height
      }
    }

    const from = toCanvas(event.clientX, event.clientY)
    drawingRef.current = { kind: armed.kind, x0: from.x, y0: from.y, x1: from.x, y1: from.y }

    const move = (e: PointerEvent): void => {
      const to = toCanvas(e.clientX, e.clientY)
      if (drawingRef.current) drawingRef.current = { ...drawingRef.current, x1: to.x, y1: to.y }
    }

    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      const drag = drawingRef.current
      drawingRef.current = null
      setAnnotating(null)
      if (!drag) return

      const dx = drag.x1 - drag.x0
      const dy = drag.y1 - drag.y0
      // A click, not a drag: nothing to place.
      const tooSmall =
        drag.kind === 'arrow' ? Math.hypot(dx, dy) < 16 : Math.abs(dx) < 10 || Math.abs(dy) < 10
      if (tooSmall) return

      const cam = composition.camera.at(timeRef.current)
      const content = composition.content
      const toSource = (x: number, y: number): { x: number; y: number } => ({
        x: cam.viewport.x + ((x - content.x) / content.w) * cam.viewport.w,
        y: cam.viewport.y + ((y - content.y) / content.h) * cam.viewport.h
      })
      const a = toSource(drag.x0, drag.y0)
      const b = toSource(drag.x1, drag.y1)
      const region =
        drag.kind === 'arrow'
          ? { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y }
          : { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) }

      if (armed.replace) {
        const id = armed.replace
        setProject((p) => ({
          ...p,
          annotations: (p.annotations ?? []).map((n) => (n.id === id ? { ...n, ...region } : n))
        }))
        setSelectedNote(id)
        return
      }

      const playhead = Math.max(0, Math.min(timeRef.current, recording.duration - 0.2))
      const defaults = annotationDefaults(drag.kind)
      // Started a fade's length early, so the mark is fully on screen at the
      // very frame it was drawn on. Starting at the playhead meant fading in
      // from nothing there — an arrow placed and apparently not placed.
      const start = Math.max(0, playhead - defaults.fade)
      const note: Annotation = {
        id: `note-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
        ...defaults,
        start,
        end: Math.min(recording.duration, playhead + 3),
        ...region
      }
      setProject((p) => ({ ...p, annotations: [...(p.annotations ?? []), note] }))
      setSelectedNote(note.id)
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // One selection at a time, so Delete removes the thing last clicked rather
  // than whichever of a zoom and a mark happened to be checked first.
  useEffect(() => {
    if (selected) setSelectedNote(null)
  }, [selected])
  useEffect(() => {
    if (selectedNote) setSelected(null)
  }, [selectedNote])

  /** Current target level for the camera element. */
  const cameraVolume = useCallback(
    () => Math.min(1, Math.max(0, project.audio.micGain)),
    [project.audio.micGain]
  )

  // Whatever stopped playback — the end of the trim, the end of the file, or
  // the user — nothing should still be running. Without this the camera and its
  // audio carried on after the screen had finished, because the end-of-range
  // check never fired when the file was a hair shorter than the trim.
  useEffect(() => {
    if (playing) return
    musicRef.current?.pause()
    screenRef.current?.pause()
    const camera = cameraRef.current
    if (camera && !camera.paused) fadeOutAndPause(camera)
    if (camera) camera.playbackRate = 1
  }, [playing])

  // The screen element can reach its own end before the trim does.
  useEffect(() => {
    const screen = screenRef.current
    if (!screen) return
    const onEnded = (): void => {
      // Reaching the end of the file is not the end of the piece when there is
      // an outro still to come. Stopping here is what stopped the outro from
      // ever being shown on a take whose video is a hair shorter than its trim
      // — which is most of them, since the trim defaults to the full duration.
      // The clock is handed to the card instead.
      if (leadOut > 0 && timeRef.current < trim.end + leadOut - 0.02) {
        timeRef.current = Math.max(timeRef.current, trim.end)
        cardClock.current = performance.now()
        return
      }
      setPlaying(false)
    }
    screen.addEventListener('ended', onEnded)
    return () => screen.removeEventListener('ended', onEnded)
  }, [recording, trim, leadOut])

  useEffect(() => {
    const screen = screenRef.current
    if (!screen) return
    const settle = (): void => {
      if (openedAt.current) return
      openedAt.current = true
      // Far enough in to show real content, but still near the start.
      seek(Math.min(project.fade.in + 0.05, recording.duration * 0.1))
    }
    if (screen.readyState >= 1) settle()
    screen.addEventListener('loadedmetadata', settle)
    return () => screen.removeEventListener('loadedmetadata', settle)
  }, [recording, seek, project.fade.in])

  // ---- draw loop ---------------------------------------------------------

  useEffect(() => {
    // Nothing to draw while exporting, and drawing anyway would have the
    // preview competing with the exporter for the same thread and GPU.
    if (exporting) return

    let raf = 0
    const draw = (): void => {
      raf = requestAnimationFrame(draw)
      const canvas = canvasRef.current
      const screen = screenRef.current
      if (!canvas || !screen) return

      const ctx = canvas.getContext('2d', { alpha: false })
      if (!ctx) return

      if (playing) {
        // While a card is showing the recording is paused, so the clock has to
        // come from elsewhere: real time, advanced by hand.
        if (timeRef.current < trim.start || timeRef.current >= trim.end) {
          // A card is the whole frame, so nothing of the recording should be
          // running underneath it — not the picture and, more obviously, not
          // the sound. Anything still playing here is stopped rather than left
          // to be inaudible-but-advancing.
          if (!screen.paused) screen.pause()
          const camera = cameraRef.current
          if (camera && !camera.paused) camera.pause()

          const now = performance.now()
          const step = Math.min(0.25, (now - cardClock.current) / 1000)
          cardClock.current = now
          const next = timeRef.current + step
          timeRef.current = next
          setTime(next)
          if (next >= trim.start && next < trim.end) {
            screen.currentTime = next
            void screen.play().catch(() => undefined)
          } else if (next >= trim.end + leadOut) {
            setPlaying(false)
          }
          composition.range = trim
          driveMusic(timeRef.current, true)
          composition.render(ctx, timeRef.current, { screen: null, camera: null })
          return
        }
        cardClock.current = performance.now()
        // Not while a seek is in flight. Setting currentTime on a playing
        // element does not take effect at once — it keeps reporting where it
        // was until the seek lands — so reading it back every frame overwrote
        // the position just asked for and dragged the playhead back to it.
        if (!screen.seeking) timeRef.current = screen.currentTime
        setTime(timeRef.current)
        const finished = recordingEnded(timeRef.current, trim, screen.duration)
        if (finished !== null) {
          screen.pause()
          cameraRef.current?.pause()
          // Moved *to* the end rather than left near it. The playhead was being
          // read back off the element, which cannot report a time past the end
          // of its own file — so pausing here left it a few milliseconds short
          // of the boundary it needed to cross, the outro was never entered,
          // and `ended` never fired either because the element was stopped
          // before it got there. Playback simply wedged on the last frame.
          timeRef.current = finished
          setTime(finished)
          // The outro is part of the piece, so playback continues into it.
          if (leadOut <= 0) setPlaying(false)
          else cardClock.current = performance.now()
        }
        driveMusic(timeRef.current, true)

        // The camera track starts after the screen track, so it has to be
        // started when its own timeline begins — not when playback does.
        // Waiting for `ct >= 0` at press time meant it never started at all.
        const camera = cameraRef.current
        if (camera) {
          const want = timeRef.current - recording.cameraOffset - cameraSync
          // Past the end counts as "not due" just as much as before the start.
          // Seeking beyond a track's duration silently clamps, so the position
          // asked for is never reached, the error never closes, and the loop
          // asks again on every frame — a seek per frame, which stops the
          // element playing at all. The camera track is shorter than the screen
          // track, so this was reachable at the end of any take; nudging the
          // sync offset just made it immediate.
          if (want < 0 || want >= cameraLimit(camera)) {
            // Not due; hold it where it is.
            if (!camera.paused) fadeOutAndPause(camera)
          } else if (camera.paused) {
            camera.currentTime = want
            camera.playbackRate = 1
            // Starting mid-stream at full level pops; come up over a few frames.
            void camera
              .play()
              .then(() => rampVolume(camera, cameraVolume()))
              .catch(() => undefined)
          } else {
            // Chase-lock rather than seek. Seeking a playing element restarts
            // its audio, and doing that every time the tracks drift a little is
            // exactly the clicking you hear — so only a large error is worth a
            // seek, and small ones are corrected by easing the rate.
            const drift = camera.currentTime - want
            const size = Math.abs(drift)
            if (size > 0.35) {
              // Far enough out that easing back would take longer than anyone
              // will tolerate looking at it.
              camera.currentTime = want
              camera.playbackRate = 1
            } else if (size > 0.15) {
              // A 3% nudge takes ten seconds to absorb 300ms, which is not a
              // correction so much as a slow reveal of the error. 6% clears
              // that in under three, and only runs while visibly out.
              camera.playbackRate = drift > 0 ? 0.94 : 1.06
            } else if (size > 0.04) {
              camera.playbackRate = drift > 0 ? 0.97 : 1.03
            } else {
              camera.playbackRate = 1
            }
          }
        }
      }

      const camera = cameraRef.current

      // Keep the camera on the right frame while paused too. Editing a setting
      // re-renders, and if the element has drifted or has not been positioned
      // since load it shows nothing — which looked like the camera vanishing
      // until the playhead was dragged back.
      if (!playing && camera) {
        const want = timeRef.current - recording.cameraOffset - cameraSync
        if (want >= 0 && want < cameraLimit(camera)) {
          if (Math.abs(camera.currentTime - want) > 0.05) camera.currentTime = want
        }
      }

      // Fades are relative to the trimmed range, not the raw recording.
      composition.range = trim
      composition.render(ctx, timeRef.current, {
        screen,
        camera: camera && camera.videoWidth > 0 ? camera : null,
        cameraSize:
          camera && camera.videoWidth
            ? { width: camera.videoWidth, height: camera.videoHeight }
            : undefined
      })

      // The area being chosen, drawn over the frame it is being chosen from.
      const marquee = pickRef.current
      if (marquee) {
        const x = Math.min(marquee.x0, marquee.x1)
        const y = Math.min(marquee.y0, marquee.y1)
        const w = Math.abs(marquee.x1 - marquee.x0)
        const h = Math.abs(marquee.y1 - marquee.y0)
        ctx.save()
        // Dimmed around the selection rather than over it and cut back out:
        // clearing a region does not restore what was underneath, it erases it.
        const W = project.output.width
        const H = project.output.height
        ctx.fillStyle = 'rgba(0, 0, 0, 0.42)'
        ctx.fillRect(0, 0, W, y)
        ctx.fillRect(0, y + h, W, H - (y + h))
        ctx.fillRect(0, y, x, h)
        ctx.fillRect(x + w, y, W - (x + w), h)
        ctx.strokeStyle = '#7c63ff'
        ctx.lineWidth = Math.max(2, project.output.width / 480)
        ctx.strokeRect(x, y, w, h)
        ctx.restore()
      }

      // A mark being dragged out, and the selected mark's outline. Both are
      // drawn here, after the composition, so neither can reach an export.
      const guide = Math.max(2, project.output.width / 640)
      const drawing = drawingRef.current
      if (drawing) {
        ctx.save()
        ctx.strokeStyle = '#7c63ff'
        ctx.fillStyle = 'rgba(124, 99, 255, 0.16)'
        ctx.lineWidth = guide * 1.5
        ctx.setLineDash([guide * 4, guide * 3])
        if (drawing.kind === 'arrow') {
          ctx.beginPath()
          ctx.moveTo(drawing.x0, drawing.y0)
          ctx.lineTo(drawing.x1, drawing.y1)
          ctx.stroke()
          ctx.setLineDash([])
          ctx.beginPath()
          ctx.arc(drawing.x1, drawing.y1, guide * 4, 0, Math.PI * 2)
          ctx.fillStyle = '#7c63ff'
          ctx.fill()
        } else {
          const x = Math.min(drawing.x0, drawing.x1)
          const y = Math.min(drawing.y0, drawing.y1)
          const w = Math.abs(drawing.x1 - drawing.x0)
          const h = Math.abs(drawing.y1 - drawing.y0)
          ctx.fillRect(x, y, w, h)
          ctx.strokeRect(x, y, w, h)
        }
        ctx.restore()
      }
      const selectedId = selectedNoteRef.current
      const note = selectedId ? composition.project.annotations?.find((n) => n.id === selectedId) : null
      // Only while the mark is on screen, and never during playback. Outside
      // its time the outline was left behind at half strength, and over the
      // recording it read as the mark itself refusing to go away.
      const showing = note ? timeRef.current >= note.start && timeRef.current < note.end : false
      if (note && !drawing && showing && !playing) {
        const cam = composition.camera.at(timeRef.current)
        const view = {
          viewport: cam.viewport,
          content: composition.content,
          outputHeight: project.output.height
        }
        ctx.save()
        ctx.strokeStyle = '#7c63ff'
        ctx.lineWidth = guide
        ctx.setLineDash([guide * 4, guide * 3])
        if (note.kind === 'arrow') {
          const tail = sourceToOutput(view, note.x, note.y)
          const head = sourceToOutput(view, note.x + note.w, note.y + note.h)
          ctx.beginPath()
          ctx.moveTo(tail.x, tail.y)
          ctx.lineTo(head.x, head.y)
          ctx.stroke()
          ctx.setLineDash([])
          ctx.fillStyle = '#7c63ff'
          for (const p of [tail, head]) {
            ctx.beginPath()
            ctx.arc(p.x, p.y, guide * 3, 0, Math.PI * 2)
            ctx.fill()
          }
        } else {
          const r = outputRect(view, note)
          const pad = guide * 3
          ctx.strokeRect(r.x - pad, r.y - pad, r.w + pad * 2, r.h + pad * 2)
        }
        ctx.restore()
      }
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [composition, playing, trim, recording, cameraSync, exporting, leadIn, leadOut])

  // Preview volume follows the mixer. Element volume is 0..1 while the gains
  // go to 2, so boosts above unity only apply to the export, which mixes
  // through Web Audio.
  useEffect(() => {
    const clamp = (v: number): number => Math.min(1, Math.max(0, v))
    if (screenRef.current) screenRef.current.volume = clamp(project.audio.systemGain)
    if (cameraRef.current) cameraRef.current.volume = clamp(project.audio.micGain)
  }, [project.audio.systemGain, project.audio.micGain, recording])

  // Audio follows the visual fade during playback, so a faded-out ending is
  // silent rather than cut off.
  useEffect(() => {
    if (!playing) return
    const clamp = (v: number): number => Math.min(1, Math.max(0, v))
    const id = setInterval(() => {
      const level = 1 - fadeAlphaAt(timeRef.current, trim, project.fade)
      const screen = screenRef.current
      if (screen && !isRamping(screen)) {
        screen.volume = clamp(project.audio.systemGain) * level
      }
      // Never fight an in-flight ramp; that is what makes pausing click.
      const camera = cameraRef.current
      if (camera && !isRamping(camera)) camera.volume = clamp(project.audio.micGain) * level
    }, 50)
    return () => clearInterval(id)
  }, [playing, trim, project.fade, project.audio.systemGain, project.audio.micGain])

  // ---- keyboard ----------------------------------------------------------
  // Declared after runExport below; hoisted via the ref so the handler always
  // calls the current one.
  const exportRef = useRef<() => void>(() => {})
  // Read inside the key handler, which is registered once.
  const selectedRef = useRef<string | null>(null)
  selectedRef.current = selected

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement
      // Anything the user can type into keeps its keys.
      //
      // TEXTAREA was missing, and the caption editor is one — so editing a
      // transcript line meant Space toggled playback instead of typing a
      // space, Backspace deleted the selected zoom shot, and the arrow keys
      // scrubbed the playhead. Every shortcut below is a plain key, which is
      // exactly the set a text field needs back.
      // Undo is the exception to the rule below: it means the same thing
      // wherever the cursor is, because the fields are controlled by the
      // project it restores.
      if (event.code === 'KeyZ' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        if (event.shiftKey) redoRef.current()
        else undoRef.current()
        return
      }
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'SELECT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return
      }
      if (event.code === 'Space') {
        event.preventDefault()
        togglePlay()
      } else if (event.code === 'ArrowLeft') {
        seek(timeRef.current - (event.shiftKey ? 1 : 1 / project.output.fps))
      } else if (event.code === 'ArrowRight') {
        seek(timeRef.current + (event.shiftKey ? 1 : 1 / project.output.fps))
      } else if (event.code === 'Backspace' || event.code === 'Delete') {
        const noteId = selectedNoteRef.current
        if (noteId) {
          event.preventDefault()
          setProject((p) => ({ ...p, annotations: (p.annotations ?? []).filter((n) => n.id !== noteId) }))
          setSelectedNote(null)
          return
        }
        if (!selectedRef.current) return
        event.preventDefault()
        setSegments((current) => current.filter((s) => s.id !== selectedRef.current))
        setSelected(null)
      } else if (event.code === 'Escape') {
        // Placing a mark is the first thing Escape abandons.
        if (annotatingRef.current) {
          setAnnotating(null)
          return
        }
        // Somewhere to go when the panel is in the way and the mouse is not.
        setRailOpen(false)
      } else if (event.code === 'KeyM' && !event.metaKey && !event.ctrlKey) {
        setRailOpen((v) => !v)
      } else if (event.code === 'KeyE' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        exportRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePlay, seek, project.output.fps])

  // ---- export ------------------------------------------------------------

  const runExport = async (choice: ExportChoice): Promise<void> => {
    if (exporting) return
    setAskingExport(false)

    // Counted here rather than on the dialog opening, so it measures exports
    // people actually asked for rather than dialogs they thought better of.
    void api.track('export_started', {
      width: choice.width,
      height: choice.height,
      fps: choice.fps
    })

    // A card's logo and background have to be decoded before the first frame
    // is drawn. The preview can afford to miss one and pick it up next frame;
    // the exporter draws each frame once, so a picture chosen a moment ago
    // would be silently missing from the file.
    await ensureTitleImages([project.intro, project.outro])

    // The chosen size and rate are the project's from here on, so the preview
    // and the exported file cannot disagree about framing.
    const project2 = {
      ...project,
      output: { ...project.output, width: choice.width, height: choice.height, fps: choice.fps },
      frame: { ...project.frame, fitMode: choice.fitMode }
    }
    setProject(project2)
    // `segments` explicitly, and this is the whole reason exports had no zoom:
    // the shots live in their own state, and the composition is built from
    // `{ ...project, segments }`. Assigning a project spread from `project`
    // alone therefore replaced the live shot list with the empty one that
    // `defaultProject` starts with — wiping every zoom a moment before the
    // export read it, while the preview it was compared against kept its own.
    composition.project = { ...project2, segments: segmentsRef.current }
    composition.rebuildLayout()

    screenRef.current?.pause()
    cameraRef.current?.pause()
    setPlaying(false)

    const controller = new AbortController()
    abortRef.current = controller
    const startedAt = performance.now()
    setExporting({ fraction: 0, stage: 'Starting', remaining: null })

    try {
      composition.range = trim
      const result = await exportMP4({
        composition,
        screenURL: recording.screenURL,
        // Always passed, because the microphone is in this file. Gating it on
        // the picture-in-picture meant switching the bubble off also removed
        // the narration from the exported video — silently, and with nothing
        // in the preview to show it, since the preview plays the camera
        // element's audio regardless of whether the bubble is drawn.
        cameraURL: recording.cameraURL,
        cameraVideo: project.pip.enabled,
        cameraOffset: recording.cameraOffset,
        cameraSync,
        start: trim.start,
        end: trim.end,
        quality: choice.quality,
        signal: controller.signal,
        onProgress: (fraction, stage) => {
          // Estimate from the run in progress rather than the stored rate, so
          // the number converges on the truth instead of restating a guess.
          const elapsed = (performance.now() - startedAt) / 1000
          const remaining = fraction > 0.03 ? Math.max(0, elapsed / fraction - elapsed) : null
          setExporting({ fraction, stage, remaining })
          // A headless run has no UI, so the rate has to reach the log.
          if (bench && stage.startsWith('Encoding frame')) {
            const now = performance.now()
            if (now - lastBenchLog.current > 5000) {
              lastBenchLog.current = now
              console.log(`[bench] ${stage} (${(fraction * 100).toFixed(1)}%)`)
            }
          }
        }
      })

      // Feed the measured rate back, so the next estimate is better.
      rememberRate(result.frames / Math.max(0.001, (performance.now() - startedAt) / 1000))

      if (bench) {
        await api.benchFinish(bench.out, result.buffer)
        return
      }

      // The destination was chosen before rendering started, so there is no
      // dialog waiting at the end of a long export.
      const path =
        choice.destination ??
        (await api.saveDialog({
          defaultPath: suggestedExportName(recording.dir),
          filters: [{ name: 'MP4 video', extensions: ['mp4'] }]
        }))
      if (path) {
        await api.writeFile(path, result.buffer)
        // Offer what to do with it rather than revealing and walking away —
        // the transcript makes uploading it materially better than dragging
        // the file in by hand, and that is only worth saying at this moment.
        setExported({ path, captions: project.captions.length })
      }
    } catch (error) {
      if (bench) {
        await api.benchFail(error instanceof Error ? error.message : String(error))
        return
      }
      if (!controller.signal.aborted) {
        console.error(error)
        window.alert(`Export failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    } finally {
      setExporting(null)
      abortRef.current = null
    }
  }

  exportRef.current = (): void => setAskingExport(true)

  // Headless benchmark: start as soon as the media is ready.
  useEffect(() => {
    if (!bench) return
    if (bench.seconds > 0) setTrim({ start: 0, end: Math.min(bench.seconds, recording.duration) })
    // Headless runs skip the dialog and use the project's own settings.
    const id = setTimeout(
      () =>
        void runExport({
          width: project.output.width,
          height: project.output.height,
          fps: project.output.fps,
          quality: 'high',
          fitMode: project.frame.fitMode,
          destination: null
        }),
      1800
    )
    return () => clearTimeout(id)
  }, [bench, recording.duration])

  // ---- render ------------------------------------------------------------

  const autoCount = segments.filter((s) => s.auto).length

  return (
    <div
      className={railOpen ? 'editor' : 'editor rail-hidden'}
      style={{ ['--rail' as string]: `${railOpen ? RAIL_WIDTH : 0}px` }}
    >
      <div className="stage">
        <canvas
          ref={canvasRef}
          className={picking || annotating ? 'picking' : undefined}
          width={project.output.width}
          height={project.output.height}
          onPointerDown={(e) => (annotatingRef.current ? beginAnnotate(e) : beginPick(e))}
        />

        <div className="stage-badge">
          <span className="chip mono">
            {project.output.width}×{project.output.height}
          </span>
          <span className="chip mono">{project.output.fps}fps</span>
          <span className="chip mono">{autoCount} zooms</span>
        </div>

        {/* Decoders, never displayed — the canvas is the only visible surface. */}
        <video
          ref={screenRef}
          src={recording.screenURL}
          style={{ display: 'none' }}
          preload="auto"
        />
        {recording.cameraURL && (
          <video
            ref={cameraRef}
            src={recording.cameraURL}
            style={{ display: 'none' }}
            preload="auto"
          />
        )}
        {project.music.src && (
          <audio ref={musicRef} src={api.mediaURL(project.music.src)} preload="auto" loop={false} />
        )}

        {askingExport && !exporting && (
          <ExportDialog
            initial={{
              width: project.output.width,
              height: project.output.height,
              fps: project.output.fps,
              quality: 'high',
              fitMode: project.frame.fitMode,
              destination: null
            }}
            duration={Math.max(0.05, trim.end - trim.start)}
            sourceAspect={recording.source.width / recording.source.height}
            suggestedName={suggestedExportName(recording.dir)}
            onCancel={() => setAskingExport(false)}
            onStart={(choice) => void runExport(choice)}
          />
        )}

        {exporting &&
          createPortal(
            <div className="progress-wrap">
              <div className="progress-card">
                <strong style={{ fontSize: 18 }}>Exporting</strong>
                <div className="progress-bar">
                  <div style={{ width: `${Math.round(exporting.fraction * 100)}%` }} />
                </div>
                <div className="export-progress-meta mono">
                  <span>{exporting.stage}</span>
                  <span>
                    {exporting.remaining === null
                      ? 'estimating…'
                      : `${formatDuration(exporting.remaining)} left`}
                  </span>
                </div>
                <button
                  className="btn"
                  style={{ marginTop: 14 }}
                  onClick={() => abortRef.current?.abort()}
                >
                  Cancel
                </button>
              </div>
            </div>,
            document.body
          )}
      </div>

      <div className="timeline">
        <div className="transport">
          <button className="btn primary" onClick={togglePlay} style={{ minWidth: 92 }}>
            {playing ? '❚❚ Pause' : '▶ Play'}
          </button>
          <span className="timecode">{formatTime(time)}</span>
          <span className="timecode" style={{ color: 'var(--muted)' }}>
            {formatTime(recording.duration)}
          </span>

          <div className="spacer" />

          <button
            className="btn"
            onClick={() => setTrim((t) => ({ ...t, start: timeRef.current }))}
            title="Trim the start to the playhead"
          >
            Set in
          </button>
          <button
            className="btn"
            onClick={() => setTrim((t) => ({ ...t, end: timeRef.current }))}
            title="Trim the end to the playhead"
          >
            Set out
          </button>
          <button
            className="btn"
            onClick={() => setTrim({ start: 0, end: recording.duration })}
            title="Clear the trim"
          >
            Reset
          </button>
          <button
            className="btn violet"
            onClick={() => setAskingExport(true)}
            disabled={!!exporting}
          >
            Export MP4
          </button>
        </div>

        <Timeline
          recording={recording}
          segments={segments}
          captions={project.captions}
          selectedCaption={selectedCaption}
          onSelectCaption={setSelectedCaption}
          selected={selected}
          time={time}
          trim={trim}
          onSeek={seek}
          onSelect={setSelected}
          onChange={setSegments}
          intro={project.intro}
          outro={project.outro}
          music={project.music}
          annotations={project.annotations}
          selectedNote={selectedNote}
          onSelectNote={setSelectedNote}
          onAnnotationsChange={(annotations) => setProject((p) => ({ ...p, annotations }))}
        />
      </div>

      {exported && (
        <ExportedPanel
          path={exported.path}
          captions={project.captions}
          trim={trim}
          hasCaptions={exported.captions > 0}
          onClose={() => setExported(null)}
        />
      )}

      {/* One control, on the edge of the panel it belongs to. It expands to
          make room for the tab names and a second column of settings, and
          contracts to give the picture the space back. */}
      <button
        className="rail-tab"
        onClick={() => setRailOpen((v) => !v)}
        aria-expanded={railOpen}
        aria-label={railOpen ? 'Hide the settings' : 'Show the settings'}
        title={railOpen ? 'Hide the settings' : 'Show the settings'}
      >
        Menu
      </button>

      <Inspector
        project={project}
        onChange={setProject}
        segments={segments}
        onSegmentsChange={setSegments}
        time={time}
        selectedCaption={selectedCaption}
        onSelectCaption={setSelectedCaption}
        picking={picking}
        onPick={() => setPicking((on) => !on)}
        selected={selected}
        onSelect={setSelected}
        recording={recording}
        cameraSync={cameraSync}
        onCameraSync={setCameraSync}
        annotating={annotating}
        onAnnotate={setAnnotating}
        selectedNote={selectedNote}
        onSelectNote={setSelectedNote}
      />
    </div>
  )
}
