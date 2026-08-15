// MIT License - Copyright (c) fintonlabs.com
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Recording, ZoomSegment } from '../engine/types'

interface Props {
  recording: Recording
  segments: ZoomSegment[]
  selected: string | null
  time: number
  trim: { start: number; end: number }
  onSeek: (t: number) => void
  onSelect: (id: string | null) => void
  onChange: (segments: ZoomSegment[]) => void
}

type DragMode = 'move' | 'start' | 'end'

/**
 * Two tracks: the generated zoom segments, which are directly editable, and a
 * read-only view of the input that produced them. Seeing the clicks under the
 * blocks is what makes the automatic behaviour legible instead of magic.
 */
export default function Timeline(props: Props): ReactNode {
  const { recording, segments, selected, time, trim, onSeek, onSelect, onChange } = props
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(1000)
  const duration = Math.max(recording.duration, 0.001)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(element)
    setWidth(element.clientWidth)
    return () => observer.disconnect()
  }, [])

  const toX = useCallback((t: number) => (t / duration) * width, [duration, width])
  const toTime = useCallback(
    (clientX: number) => {
      const rect = ref.current?.getBoundingClientRect()
      if (!rect) return 0
      return Math.min(Math.max(((clientX - rect.left) / rect.width) * duration, 0), duration)
    },
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
    const t = toTime(event.clientX)
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
    <div className="track-stack" ref={ref}>
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
            onPointerDown={(e) => beginDrag(e, segment, 'move')}
          >
            <span
              className="zl"
              style={{ color: segment.auto ? 'var(--violet-ink)' : 'var(--lime-ink)' }}
            >
              {segment.scale.toFixed(1)}×
            </span>
            <span className="handle l" onPointerDown={(e) => beginDrag(e, segment, 'start')} />
            <span className="handle r" onPointerDown={(e) => beginDrag(e, segment, 'end')} />
          </div>
        ))}
      </div>

      <div className="track" onPointerDown={scrub}>
        <span className="track-label">Input</span>
        {markers}
        {/* Trimmed regions are dimmed rather than removed, so they stay recoverable. */}
        {trim.start > 0 && (
          <div
            style={{
              position: 'absolute',
              inset: `0 auto 0 0`,
              width: toX(trim.start),
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
              right: 0,
              background: 'rgba(0,0,0,0.55)',
              pointerEvents: 'none'
            }}
          />
        )}
      </div>

      <div className="playhead" style={{ left: toX(time) }} />
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
