// MIT License - Copyright (c) fintonlabs.com
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Recording, ZoomSegment } from '../engine/types'
import type { Caption } from '../engine/captions'
import type { TitleCard } from '../engine/titles'

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
  const { captions, selectedCaption, onSelectCaption, intro, outro } = props
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

  const toX = useCallback((t: number) => ((t + leadIn) / span) * width, [leadIn, span, width])
  const toTime = useCallback(
    (clientX: number) => {
      const rect = ref.current?.getBoundingClientRect()
      if (!rect) return 0
      const t = ((clientX - rect.left) / rect.width) * span - leadIn
      return Math.min(Math.max(t, -leadIn), duration + leadOut)
    },
    [span, leadIn, leadOut, duration]
  )
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
          const span = original.end - original.start
          const start = Math.min(Math.max(original.start + delta, 0), duration - span)
          return { ...s, start, end: start + span, auto: false }
        }
        if (mode === 'start') {
          return {
            ...s,
            start: Math.min(Math.max(original.start + delta, 0), s.end - 0.3),
            auto: false
          }
        }
        return {
          ...s,
          end: Math.max(Math.min(original.end + delta, duration), s.start + 0.3),
          auto: false
        }
      })
      onChange(next)
    }
    const up = (): void => {
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

  const seconds = useMemo(() => {
    const step = duration > 120 ? 30 : duration > 40 ? 10 : duration > 12 ? 5 : 1
    const out: ReactNode[] = []
    for (let t = step; t < duration; t += step) {
      out.push(<span key={t} className="tick" style={{ left: toX(t) }} />)
    }
    return out
  }, [duration, toX])

  return (
    // Scrubbing belongs to the whole stack, not to each lane. The lanes have
    // gaps between them and the stack has margins, and a click landing in one of
    // those did nothing at all — which reads as the timeline ignoring you rather
    // than as having missed a five pixel target.
    <div className="track-stack" ref={ref} onPointerDown={scrub}>
      <div
        className="track zooms"
        onPointerDown={scrub}
        onDoubleClick={addSegment}
        title="Double-click to add a zoom"
      >
        <span className="track-label">Zoom</span>
        {seconds}
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

      {/* Nudged off the very edge so it is still visible at t=0. */}
      <div className="playhead" style={{ left: Math.max(1, toX(time)) }}>
        <span className="playhead-time mono">{time.toFixed(2)}s</span>
      </div>
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
