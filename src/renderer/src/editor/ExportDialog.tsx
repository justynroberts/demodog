// MIT License - Copyright (c) fintonlabs.com
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { EXPORT_TARGETS, OUTPUT_PRESETS } from '../engine/defaults'
import { Segmented } from '../ui/controls'

export interface ExportChoice {
  width: number
  height: number
  fps: number
  quality: 'good' | 'high' | 'max'
  /** 'cover' crops the recording to the target shape instead of letterboxing. */
  fitMode: 'contain' | 'cover'
}

/**
 * Remembered export throughput, in output frames per second.
 *
 * Export speed depends on the machine and on the source resolution, so a fixed
 * constant would give a confidently wrong estimate. The first run uses a
 * conservative default and every run since refines it.
 */
const RATE_KEY = 'demodog-export-rate'

export function rememberedRate(): number {
  const stored = Number(localStorage.getItem(RATE_KEY))
  return Number.isFinite(stored) && stored > 0.2 ? stored : 3.4
}

export function rememberRate(framesPerSecond: number): void {
  if (!Number.isFinite(framesPerSecond) || framesPerSecond <= 0.2) return
  // Blend with the previous figure so one unusual run does not dominate.
  const blended = rememberedRate() * 0.4 + framesPerSecond * 0.6
  localStorage.setItem(RATE_KEY, String(blended))
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—'
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))}s`
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds % 60)
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`
}

/** Matches the exporter's own choice, so the size shown is the size written. */
function bitrateFor(width: number, height: number, fps: number, quality: string): number {
  const factor = quality === 'max' ? 0.19 : quality === 'high' ? 0.13 : 0.08
  return Math.min(Math.max(width * height * fps * factor, 4_000_000), 90_000_000)
}

export default function ExportDialog({
  initial,
  duration,
  sourceAspect,
  onCancel,
  onStart
}: {
  initial: ExportChoice
  /** Length of the range about to be exported, in seconds. */
  duration: number
  /** Width over height of the recording, used to warn about reshaping. */
  sourceAspect: number
  onCancel: () => void
  onStart: (choice: ExportChoice) => void
}): ReactNode {
  const [choice, setChoice] = useState<ExportChoice>(initial)

  const target = EXPORT_TARGETS.find(
    (t) =>
      t.width === choice.width &&
      t.height === choice.height &&
      t.fps === choice.fps &&
      t.quality === choice.quality
  )

  const applyTarget = (id: string): void => {
    const next = EXPORT_TARGETS.find((t) => t.id === id)
    if (!next) return
    // A target far from the recording's shape has to crop, or the frame ends up
    // mostly background with a letterboxed strip in the middle.
    const reshapes = Math.abs(next.width / next.height - sourceAspect) > sourceAspect * 0.15
    setChoice({
      width: next.width,
      height: next.height,
      fps: next.fps,
      quality: next.quality,
      fitMode: reshapes ? 'cover' : 'contain'
    })
  }

  const targetAspect = choice.width / choice.height
  const reshaping = Math.abs(targetAspect - sourceAspect) > sourceAspect * 0.15

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCancel()
      if (event.key === 'Enter') onStart(choice)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [choice, onCancel, onStart])

  const estimate = useMemo(() => {
    const frames = Math.max(1, Math.round(duration * choice.fps))
    // Cost scales with the pixels actually drawn per frame.
    const pixelFactor = (choice.width * choice.height) / (1728 * 1080)
    const rate = rememberedRate() / Math.max(0.35, pixelFactor)
    const bytes =
      (bitrateFor(choice.width, choice.height, choice.fps, choice.quality) / 8) * duration
    return {
      frames,
      seconds: frames / rate,
      megabytes: bytes / 1_000_000
    }
  }, [choice, duration])

  const sizeValue = `${choice.width}x${choice.height}`
  const known = OUTPUT_PRESETS.some((p) => `${p.width}x${p.height}` === sizeValue)

  return (
    <div className="progress-wrap" onClick={onCancel}>
      <div className="export-card" onClick={(e) => e.stopPropagation()}>
        <h2>Export</h2>

        <span className="label">For</span>
        <select value={target?.id ?? ''} onChange={(e) => applyTarget(e.target.value)}>
          {!target && <option value="">Custom</option>}
          {EXPORT_TARGETS.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <p className="hint" style={{ margin: '6px 0 0' }}>
          {target?.hint ?? 'Your own combination of size, frame rate and quality.'}
        </p>

        <div style={{ height: 14 }} />
        <span className="label">Size</span>
        <select
          value={sizeValue}
          onChange={(e) => {
            const preset = OUTPUT_PRESETS.find((p) => `${p.width}x${p.height}` === e.target.value)
            if (preset) setChoice({ ...choice, width: preset.width, height: preset.height })
          }}
        >
          {!known && <option value={sizeValue}>Current · {sizeValue}</option>}
          {OUTPUT_PRESETS.map((preset) => (
            <option key={preset.id} value={`${preset.width}x${preset.height}`}>
              {preset.name}
            </option>
          ))}
        </select>

        <div style={{ height: 14 }} />
        <span className="label">Frame rate</span>
        <Segmented
          value={String(choice.fps)}
          options={[
            { value: '24', label: '24' },
            { value: '30', label: '30' },
            { value: '60', label: '60' }
          ]}
          onChange={(v) => setChoice({ ...choice, fps: Number(v) })}
        />

        <div style={{ height: 14 }} />
        <span className="label">Quality</span>
        <Segmented
          value={choice.quality}
          options={[
            { value: 'good', label: 'Good' },
            { value: 'high', label: 'High' },
            { value: 'max', label: 'Max' }
          ]}
          onChange={(v) => setChoice({ ...choice, quality: v })}
        />

        <div style={{ height: 14 }} />
        <span className="label">Fit</span>
        <Segmented
          value={choice.fitMode}
          options={[
            { value: 'contain', label: 'Fit whole screen' },
            { value: 'cover', label: 'Crop to shape' }
          ]}
          onChange={(v) => setChoice({ ...choice, fitMode: v })}
        />
        {reshaping && choice.fitMode === 'contain' && (
          <p className="hint" style={{ color: 'var(--danger)', margin: '8px 0 0' }}>
            This shape is a long way from your recording, so fitting the whole screen will leave
            large bands of background. Crop usually looks better.
          </p>
        )}

        <div className="export-estimate">
          <div>
            <span>Length</span>
            <strong className="mono">{formatDuration(duration)}</strong>
          </div>
          <div>
            <span>Frames</span>
            <strong className="mono">{estimate.frames}</strong>
          </div>
          <div>
            <span>Approx. size</span>
            <strong className="mono">{estimate.megabytes.toFixed(0)} MB</strong>
          </div>
          <div>
            <span>Approx. time</span>
            <strong className="mono">{formatDuration(estimate.seconds)}</strong>
          </div>
        </div>

        <p className="hint" style={{ marginTop: 4 }}>
          The time is estimated from how fast your last export ran, so it gets more accurate with
          use.
        </p>

        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button
            className="btn violet"
            style={{ flex: 1, justifyContent: 'center' }}
            onClick={() => onStart(choice)}
          >
            Export
          </button>
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
