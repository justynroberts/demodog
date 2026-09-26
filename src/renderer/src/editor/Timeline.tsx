// MIT License - Copyright (c) fintonlabs.com
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Recording, ZoomSegment } from '../engine/types'
import type { Caption } from '../engine/captions'
import type { TitleCard } from '../engine/titles'
import type { MusicTrack } from '../engine/types'
import { ANNOTATION_LABELS, isObscuring, type Annotation } from '../engine/annotations'
import {
  centreOn,
  clamp,
  fit,
  follow,
  isFitted,
  panBy,
  snap,
  span as spanOf,
  ticks,
  timeLabel,
  zoomAt,
  type SnapTarget,
  type View
} from './timelineView'

interface Props {
  recording: Recording
  segments: ZoomSegment[]
  selected: string | null
  time: number
  trim: { start: number; end: number }
  onSeek: (t: number) => void
  onSelect: (id: string | null) => void
  onChange: (segments: ZoomSegment[]) => void
  captions: Caption[]
  selectedCaption: string | null
  onSelectCaption: (id: string | null) => void
  intro: TitleCard
  outro: TitleCard
  music: MusicTrack
  /** Arrows, boxes and blurs placed after recording. */
  annotations?: Annotation[]
  selectedNote?: string | null
  onSelectNote?: (id: string | null) => void
  onAnnotationsChange?: (annotations: Annotation[]) => void
  /** Whether the timeline has the window to itself, and how to change that. */
  expanded?: boolean
  onExpanded?: (expanded: boolean) => void
  playing?: boolean
}

type DragMode = 'move' | 'start' | 'end'

/** Matches .track-label in the stylesheet. */
const LABEL_WIDTH = 52

/**
 * Two tracks: the generated zoom segments, which are directly editable, and a
 * read-only view of the input that produced them. Seeing the clicks under the
 * blocks is what makes the automatic behaviour legible instead of magic.
 */
export default function Timeline(props: Props): ReactNode {
  const { recording, segments, selected, time, trim, onSeek, onSelect, onChange } = props
  const { captions, selectedCaption, onSelectCaption, intro, outro, music } = props
  const { annotations = [], selectedNote = null, onSelectNote, onAnnotationsChange } = props
  const { expanded = false, onExpanded, playing = false } = props
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(1000)
  const duration = Math.max(recording.duration, 0.001)

  /**
   * The timeline covers the whole composition, not just the recording.
   *
   * Title cards are extra time either side of the take — the intro runs from
   * `-seconds` up to zero — so a timeline that started at zero could not
   * represent them. Playback went through the intro correctly and the playhead
   * sat pinned at the left edge throughout, which looked like a stuck playhead;
   * and there was no way to scrub back into a card to see it at all.
   */
  const leadIn = intro.enabled ? intro.seconds : 0
  const leadOut = outro.enabled ? outro.seconds : 0
  const span = leadIn + duration + leadOut

  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(element)
    setWidth(element.clientWidth)
    return () => observer.disconnect()
  }, [])

  // ---- what part of it is on screen --------------------------------------
  const bounds = useMemo(() => ({ start: -leadIn, end: duration + leadOut }), [leadIn, duration, leadOut])
  const [view, setView] = useState<View>(() => fit(bounds))
  // A different take, or a card added or removed, changes what there is to
  // show. The window is kept where it is if it still fits inside it.
  useEffect(() => setView((current) => clamp(current, bounds)), [bounds])
  const visible = spanOf(view)
  const perPixel = visible / Math.max(width, 1)

  const toX = useCallback(
    (t: number) => ((t - view.start) / (view.end - view.start)) * width,
    [view, width]
  )
  const toTime = useCallback(
    (clientX: number) => {
      const rect = ref.current?.getBoundingClientRect()
      if (!rect) return 0
      const t = view.start + ((clientX - rect.left) / rect.width) * (view.end - view.start)
      return Math.min(Math.max(t, -leadIn), duration + leadOut)
    },
    [view, leadIn, duration, leadOut]
  )

  /** Zoom and pan: the trackpad, the keyboard, and the strip underneath. */
  const zoomBy = useCallback(
    (factor: number, atFraction = 0.5) => setView((v) => zoomAt(v, bounds, factor, atFraction)),
    [bounds]
  )
  const wheel = useCallback(
    (event: React.WheelEvent) => {
      const rect = ref.current?.getBoundingClientRect()
      if (!rect) return
      // Pinch arrives as a wheel event with ctrlKey set; ⌥ is the mouse
      // equivalent. Everything else scrolls the view sideways.
      if (event.ctrlKey || event.altKey || event.metaKey) {
        const at = (event.clientX - rect.left) / rect.width
        setView((v) => zoomAt(v, bounds, Math.exp(-event.deltaY / 180), at))
        return
      }
      const sideways = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
      if (!sideways) return
      setView((v) => panBy(v, bounds, (sideways / rect.width) * spanOf(v)))
    },
    [bounds]
  )
  // Not through React's onWheel: it attaches passively, so the page scrolls
  // and zooms the whole window as well as the timeline.
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault()
      wheel(event as unknown as React.WheelEvent)
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [wheel])

  // The playhead stays on screen while it plays, without the view sliding
  // continuously under it.
  useEffect(() => {
    if (!playing) return
    setView((v) => follow(v, bounds, time))
  }, [playing, time, bounds])
  /** Clamped into the recording itself, for anything that edits the take. */
  const inTake = useCallback(
    (t: number) => Math.min(Math.max(t, 0), duration),
    [duration]
  )

  // ---- scrubbing ---------------------------------------------------------

  const scrub = (event: React.PointerEvent): void => {
    if (event.button !== 0) return
    onSeek(toTime(event.clientX))
    const move = (e: PointerEvent): void => onSeek(toTime(e.clientX))
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // ---- snapping ------------------------------------------------------------
  //
  // What an edge would rather land on: the playhead, the ends of the take and
  // its trim, the cards, and every other block's edges. Clicks are in there
  // too — ending a zoom exactly on the click that caused it is the commonest
  // thing anyone wants and the hardest to hit by eye.
  const [guide, setGuide] = useState<{ t: number; what: string } | null>(null)
  const snapTargets = useCallback(
    (exclude: string): SnapTarget[] => {
      const out: SnapTarget[] = [
        { t: time, what: 'playhead' },
        { t: 0, what: 'start' },
        { t: duration, what: 'end' }
      ]
      if (trim.start > 0) out.push({ t: trim.start, what: 'trim in' })
      if (trim.end < duration) out.push({ t: trim.end, what: 'trim out' })
      for (const segment of segments) {
        if (segment.id === exclude) continue
        out.push({ t: segment.start, what: 'zoom' }, { t: segment.end, what: 'zoom' })
      }
      for (const note of annotations) {
        if (note.id === exclude) continue
        out.push({ t: note.start, what: 'mark' }, { t: note.end, what: 'mark' })
      }
      for (const caption of captions) {
        out.push({ t: caption.start, what: 'line' }, { t: caption.end, what: 'line' })
      }
      // Only the clicks worth catching: every sample would snap to everything.
      for (const click of recording.input.clicks) out.push({ t: click.t, what: 'click' })
      return out
    },
    [time, duration, trim, segments, annotations, captions, recording]
  )
  /** ⌘ or ⌥ while dragging turns snapping off, as everywhere else that snaps. */
  const snapped = useCallback(
    (t: number, exclude: string, event: PointerEvent): number => {
      if (event.metaKey || event.altKey) {
        setGuide(null)
        return t
      }
      const result = snap(t, snapTargets(exclude), perPixel)
      setGuide(result.target ? { t: result.t, what: result.target.what } : null)
      return result.t
    },
    [snapTargets, perPixel]
  )

  // ---- segment dragging --------------------------------------------------

  const beginDrag = (event: React.PointerEvent, segment: ZoomSegment, mode: DragMode): void => {
    event.stopPropagation()
    if (event.button !== 0) return
    onSelect(segment.id)

    const startTime = toTime(event.clientX)
    const original = { ...segment }

    const move = (e: PointerEvent): void => {
      const delta = toTime(e.clientX) - startTime
      const next = segments.map((s) => {
        if (s.id !== segment.id) return s
        if (mode === 'move') {
          const length = original.end - original.start
          // Both ends are offered to the snap, and the closer one wins, so a
          // block can be dropped against the thing on either side of it.
          const wanted = original.start + delta
          const atStart = snapped(wanted, segment.id, e)
          const atEnd = snapped(wanted + length, segment.id, e) - length
          const start = Math.abs(atStart - wanted) <= Math.abs(atEnd - wanted) ? atStart : atEnd
          const held = Math.min(Math.max(start, 0), duration - length)
          return { ...s, start: held, end: held + length, auto: false }
        }
        if (mode === 'start') {
          return {
            ...s,
            start: Math.min(Math.max(snapped(original.start + delta, segment.id, e), 0), s.end - 0.3),
            auto: false
          }
        }
        return {
          ...s,
          end: Math.max(Math.min(snapped(original.end + delta, segment.id, e), duration), s.start + 0.3),
          auto: false
        }
      })
      onChange(next)
    }
    const up = (): void => {
      setGuide(null)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  /**
   * Marks that overlap in time are given rows of their own.
   *
   * A blur and an arrow at the same moment is ordinary, and on a single row
   * the second block sat exactly over the first: it could not be seen, and
   * grabbing its handle grabbed the block on top instead.
   */
  const noteRows = useMemo(() => {
    const rows: number[] = []
    const rowEnds: number[] = []
    const byStart = [...annotations].sort((a, b) => a.start - b.start)
    const rowOf = new Map<string, number>()
    for (const note of byStart) {
      let row = rowEnds.findIndex((end) => end <= note.start + 1e-6)
      if (row === -1) {
        row = rowEnds.length
        rowEnds.push(note.end)
      } else rowEnds[row] = note.end
      rowOf.set(note.id, row)
      rows.push(row)
    }
    return { rowOf, count: Math.max(1, rowEnds.length) }
  }, [annotations])
  const NOTE_ROW = 20

  // ---- annotation dragging ----------------------------------------------

  /** The same move and trim as a zoom block, for a mark's time on screen. */
  const beginNoteDrag = (event: React.PointerEvent, note: Annotation, mode: DragMode): void => {
    event.stopPropagation()
    if (event.button !== 0) return
    onSelectNote?.(note.id)

    const startTime = toTime(event.clientX)
    const original = { ...note }

    const move = (e: PointerEvent): void => {
      const delta = toTime(e.clientX) - startTime
      const next = annotations.map((n) => {
        if (n.id !== note.id) return n
        if (mode === 'move') {
          const length = original.end - original.start
          const wanted = original.start + delta
          const atStart = snapped(wanted, note.id, e)
          const atEnd = snapped(wanted + length, note.id, e) - length
          const start = Math.abs(atStart - wanted) <= Math.abs(atEnd - wanted) ? atStart : atEnd
          const held = Math.min(Math.max(start, 0), duration - length)
          return { ...n, start: held, end: held + length }
        }
        if (mode === 'start') {
          return { ...n, start: Math.min(Math.max(snapped(original.start + delta, note.id, e), 0), n.end - 0.2) }
        }
        return { ...n, end: Math.max(Math.min(snapped(original.end + delta, note.id, e), duration), n.start + 0.2) }
      })
      onAnnotationsChange?.(next)
    }
    const up = (): void => {
      setGuide(null)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const addSegment = (event: React.MouseEvent): void => {
    // A zoom belongs to the recording, so a double-click over a title card
    // makes one at the nearest end of the take rather than at negative time.
    const t = inTake(toTime(event.clientX))
    const cursor = recording.input.moves.length
      ? nearestPosition(recording, t)
      : { x: recording.source.width / 2, y: recording.source.height / 2 }
    const segment: ZoomSegment = {
      id: `manual-${Date.now()}`,
      start: Math.max(0, t - 0.4),
      end: Math.min(duration, t + 1.8),
      easeIn: 0.7,
      easeOut: 0.8,
      scale: 1.9,
      x: cursor.x,
      y: cursor.y,
      auto: false,
      follow: 0.4
    }
    onChange([...segments, segment].sort((a, b) => a.start - b.start))
    onSelect(segment.id)
  }

  // ---- static markers ----------------------------------------------------

  const markers = useMemo(() => {
    const clicks = recording.input.clicks.map((c, i) => (
      <span key={`c${i}`} className="click-marker" style={{ left: toX(c.t) }} />
    ))
    const scrolls: ReactNode[] = []
    let last = -Infinity
    for (const scroll of recording.input.scrolls) {
      if (scroll.t - last > 0.4) {
        scrolls.push(
          <span
            key={`s${scroll.t}`}
            className="tick"
            style={{ left: toX(scroll.t), background: 'var(--violet)', opacity: 0.7 }}
          />
        )
        last = scroll.t
      }
    }
    return [...scrolls, ...clicks]
  }, [recording, toX])

  /** Lines down the lanes at the ruler's marks, so an edge can be read across. */
  const marks = useMemo(() => ticks(view, width), [view, width])
  const gridlines = useMemo(
    () =>
      marks
        .filter((mark) => mark.major && mark.t > bounds.start && mark.t < bounds.end)
        .map((mark) => <span key={mark.t} className="tick" style={{ left: toX(mark.t) }} />),
    [marks, toX, bounds]
  )

  // ---- the keyboard --------------------------------------------------------
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable ||
        event.metaKey ||
        event.ctrlKey
      ) {
        return
      }
      // Zoom about the playhead rather than the middle of the view: it is
      // where the work is, and it is where the eye already is.
      const at = (time - view.start) / Math.max(spanOf(view), 1e-6)
      if (event.key === '=' || event.key === '+') {
        event.preventDefault()
        zoomBy(1.6, Math.min(Math.max(at, 0), 1))
      } else if (event.key === '-' || event.key === '_') {
        event.preventDefault()
        zoomBy(1 / 1.6, Math.min(Math.max(at, 0), 1))
      } else if (event.key === '0') {
        event.preventDefault()
        setView(fit(bounds))
      } else if (event.key === 't' || event.key === 'T') {
        event.preventDefault()
        onExpanded?.(!expanded)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zoomBy, bounds, view, time, expanded, onExpanded])

  // ---- the strip underneath -------------------------------------------------
  //
  // The whole take at a glance with the visible window drawn on it: somewhere
  // to see where you are when zoomed in, and to drag or redraw the window
  // without learning a modifier.
  const overview = (event: React.PointerEvent): void => {
    if (event.button !== 0) return
    event.stopPropagation()
    const rail = event.currentTarget as HTMLElement
    const rect = rail.getBoundingClientRect()
    const whole = bounds.end - bounds.start
    const timeAt = (clientX: number): number =>
      bounds.start + ((clientX - rect.left) / rect.width) * whole
    const grabbed = timeAt(event.clientX)
    const inside = grabbed >= view.start && grabbed <= view.end
    const offset = grabbed - view.start
    const move = (e: PointerEvent): void => {
      const t = timeAt(e.clientX)
      setView((v) =>
        inside
          ? clamp({ start: t - offset, end: t - offset + spanOf(v) }, bounds)
          : centreOn(v, bounds, t)
      )
    }
    if (!inside) setView((v) => centreOn(v, bounds, grabbed))
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    // Scrubbing belongs to the whole stack, not to each lane. The lanes have
    // gaps between them and the stack has margins, and a click landing in one of
    // those did nothing at all — which reads as the timeline ignoring you rather
    // than as having missed a five pixel target.
    <div
      className={`track-stack${expanded ? ' expanded' : ''}`}
      ref={ref}
      onPointerDown={scrub}
    >
      <div
        className="ruler"
        onPointerDown={scrub}
        onDoubleClick={() => onExpanded?.(!expanded)}
        title="Scrub · double-click to give the timeline the window · ⌥-scroll to zoom"
      >
        {marks.map((mark) => (
          <span
            key={mark.t}
            className={`rule${mark.major ? ' major' : ''}`}
            style={{ left: toX(mark.t) }}
          >
            {mark.major && <i className="mono">{mark.label}</i>}
          </span>
        ))}
        <div className="ruler-tools" onPointerDown={(e) => e.stopPropagation()}>
          <button className="tl-btn" title="Zoom out (−)" onClick={() => zoomBy(1 / 1.6)}>
            −
          </button>
          <button className="tl-btn" title="Zoom in (+)" onClick={() => zoomBy(1.6)}>
            +
          </button>
          <button
            className="tl-btn"
            title="Whole take (0)"
            disabled={isFitted(view, bounds)}
            onClick={() => setView(fit(bounds))}
          >
            Fit
          </button>
          <button
            className="tl-btn"
            title={expanded ? 'Back to the preview (T)' : 'Give the timeline the window (T)'}
            onClick={() => onExpanded?.(!expanded)}
          >
            {expanded ? '▾' : '▴'}
          </button>
        </div>
      </div>
      <div
        className="track zooms"
        onPointerDown={scrub}
        onDoubleClick={addSegment}
        title="Double-click to add a zoom"
      >
        <span className="track-label">Zoom</span>
        {gridlines}
        {segments.map((segment) => (
          <div
            key={segment.id}
            className={`zoom-block${selected === segment.id ? ' selected' : ''}`}
            style={{
              left: toX(segment.start),
              width: Math.max(14, toX(segment.end) - toX(segment.start)),
              background: segment.auto ? 'var(--violet)' : 'var(--lime)'
            }}
            onPointerDown={(e) => {
              // Move the playhead to where the click landed as well as
              // selecting: judging a shot means seeing the frame it is on.
              // Stopped here so the stack does not start a scrub drag as well
              // and fight this one for the pointer.
              e.stopPropagation()
              onSeek(toTime(e.clientX))
              beginDrag(e, segment, 'move')
            }}
          >
            <span
              className="zl"
              style={{ color: segment.auto ? 'var(--violet-ink)' : 'var(--lime-ink)' }}
            >
              {segment.scale.toFixed(1)}×
            </span>
            <span
              className="handle l"
              onPointerDown={(e) => {
                e.stopPropagation()
                beginDrag(e, segment, 'start')
              }}
            />
            <span
              className="handle r"
              onPointerDown={(e) => {
                e.stopPropagation()
                beginDrag(e, segment, 'end')
              }}
            />
          </div>
        ))}
      </div>

      {annotations.length > 0 && (
        <div
          className="track notes"
          style={{ height: noteRows.count * NOTE_ROW + 10 }}
          onPointerDown={scrub}
        >
          <span className="track-label">Marks</span>
          {annotations.map((note) => (
            <div
              key={note.id}
              className={`note-block${isObscuring(note.kind) ? ' obscure' : ''}${
                selectedNote === note.id ? ' selected' : ''
              }`}
              style={{
                left: toX(note.start),
                width: Math.max(14, toX(note.end) - toX(note.start)),
                top: 5 + (noteRows.rowOf.get(note.id) ?? 0) * NOTE_ROW,
                height: NOTE_ROW - 3
              }}
              title={`${ANNOTATION_LABELS[note.kind]} · ${note.start.toFixed(1)}–${note.end.toFixed(1)}s`}
              onPointerDown={(e) => {
                e.stopPropagation()
                onSeek(toTime(e.clientX))
                beginNoteDrag(e, note, 'move')
              }}
            >
              <span className="zl">{ANNOTATION_LABELS[note.kind]}</span>
              <span
                className="handle l"
                onPointerDown={(e) => {
                  e.stopPropagation()
                  beginNoteDrag(e, note, 'start')
                }}
              />
              <span
                className="handle r"
                onPointerDown={(e) => {
                  e.stopPropagation()
                  beginNoteDrag(e, note, 'end')
                }}
              />
            </div>
          ))}
        </div>
      )}

      {(leadIn > 0 || leadOut > 0) && (
        <div className="track cards" onPointerDown={scrub}>
          <span className="track-label">Cards</span>
          {leadIn > 0 && (
            <div
              className="card-block"
              style={{ left: toX(-leadIn), width: toX(0) - toX(-leadIn) }}
            >
              <span style={{ paddingLeft: Math.max(0, LABEL_WIDTH + 4 - toX(-leadIn)) }}>
                {intro.title || 'Intro'}
              </span>
            </div>
          )}
          {leadOut > 0 && (
            <div
              className="card-block"
              style={{ left: toX(duration), width: toX(duration + leadOut) - toX(duration) }}
            >
              <span>{outro.title || 'Outro'}</span>
            </div>
          )}
        </div>
      )}

      {music.src && (
        <div className="track music" onPointerDown={scrub}>
          <span className="track-label">Music</span>
          {/* The bed runs under the whole piece, cards included, so it spans
              the lane end to end. The notches are where it ducks for speech —
              worth seeing, because ducking you cannot see is indistinguishable
              from a level that is simply wrong. */}
          <div className="music-bed" style={{ left: 0, right: 0 }}>
            <span style={{ paddingLeft: LABEL_WIDTH + 6 }}>
              {music.src.split('/').pop()}
            </span>
          </div>
          {music.duckDb > 0 &&
            captions.map((caption) => {
              const left = toX(caption.start)
              return (
                <span
                  key={`duck-${caption.id}`}
                  className="music-duck"
                  style={{ left, width: Math.max(2, toX(caption.end) - left) }}
                />
              )
            })}
        </div>
      )}

      {captions.length > 0 && (
        <div className="track captions" onPointerDown={scrub}>
          <span className="track-label">Text</span>
          {captions.map((caption) => {
            const left = toX(caption.start)
            const width = Math.max(6, toX(caption.end) - left)
            // Nudge the words clear of the label chip when a line starts at the
            // very beginning of the recording; the block itself still passes
            // behind it, so the timing it shows stays honest.
            const inset = Math.max(0, LABEL_WIDTH + 4 - left)
            return (
              <button
                key={caption.id}
                className={`caption-block${selectedCaption === caption.id ? ' selected' : ''}`}
                style={{ left, width }}
                title={caption.text}
                onPointerDown={(e) => {
                  // Seek to where the click landed rather than to the start of
                  // the line: within a long caption, the interesting frame is
                  // usually the one under the pointer.
                  e.stopPropagation()
                  onSeek(toTime(e.clientX))
                  onSelectCaption(caption.id)
                }}
              >
                <span style={{ paddingLeft: inset }}>{caption.text}</span>
              </button>
            )
          })}
        </div>
      )}

      <div className="track" onPointerDown={scrub}>
        <span className="track-label">Input</span>
        {markers}
        {/* Trimmed regions are dimmed rather than removed, so they stay recoverable. */}
        {trim.start > 0 && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              // From the start of the recording, not the start of the lane —
              // with an intro card those are no longer the same place, and
              // dimming from the lane edge would mark the card as trimmed.
              left: toX(0),
              width: toX(trim.start) - toX(0),
              background: 'rgba(0,0,0,0.55)',
              pointerEvents: 'none'
            }}
          />
        )}
        {trim.end < duration && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: toX(trim.end),
              width: toX(duration) - toX(trim.end),
              background: 'rgba(0,0,0,0.55)',
              pointerEvents: 'none'
            }}
          />
        )}
      </div>

      {/* What a dragged edge has caught on, named so it is not a mystery line. */}
      {guide && (
        <div className="snap-guide" style={{ left: toX(guide.t) }}>
          <span className="mono">{guide.what}</span>
        </div>
      )}

      {/* Nudged off the very edge so it is still visible at t=0. */}
      <div className="playhead" style={{ left: Math.max(1, toX(time)) }}>
        <span className="playhead-time mono">{timeLabel(time, 0.1)}</span>
      </div>

      {!isFitted(view, bounds) && (
        <div className="overview" onPointerDown={overview} title="Drag to move the view">
          {segments.map((segment) => (
            <span
              key={segment.id}
              className="ov-block"
              style={{
                left: `${((segment.start - bounds.start) / (bounds.end - bounds.start)) * 100}%`,
                width: `${Math.max(0.4, ((segment.end - segment.start) / (bounds.end - bounds.start)) * 100)}%`
              }}
            />
          ))}
          <span
            className="ov-playhead"
            style={{ left: `${((time - bounds.start) / (bounds.end - bounds.start)) * 100}%` }}
          />
          <span
            className="ov-window"
            style={{
              left: `${((view.start - bounds.start) / (bounds.end - bounds.start)) * 100}%`,
              width: `${(spanOf(view) / (bounds.end - bounds.start)) * 100}%`
            }}
          />
        </div>
      )}
    </div>
  )
}

function nearestPosition(recording: Recording, t: number): { x: number; y: number } {
  const moves = recording.input.moves
  let best = moves[0]
  for (const move of moves) {
    if (Math.abs(move.t - t) < Math.abs(best.t - t)) best = move
  }
  return { x: best.x, y: best.y }
}
