// MIT License - Copyright (c) fintonlabs.com
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api } from '../api'
import { Composition } from '../engine/composition'
import { generateSegments } from '../engine/autozoom'
import { defaultProject } from '../engine/defaults'
import { exportMP4 } from '../engine/export'
import type { Project, Recording, ZoomSegment } from '../engine/types'
import { formatTime } from '../ui/controls'
import Timeline from './Timeline'
import Inspector from './Inspector'

export default function Editor({
  recording,
  bench = null
}: {
  recording: Recording
  /** Headless benchmark: export straight to this path, then quit. */
  bench?: { out: string; seconds: number } | null
}): ReactNode {
  const [project, setProject] = useState<Project>(() =>
    defaultProject(recording.source, Boolean(recording.cameraURL))
  )
  const [segments, setSegments] = useState<ZoomSegment[]>([])
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [cameraSync, setCameraSync] = useState(0)
  const [trim, setTrim] = useState<{ start: number; end: number }>({
    start: 0,
    end: recording.duration
  })
  const [exporting, setExporting] = useState<{ fraction: number; stage: string } | null>(null)

  const screenRef = useRef<HTMLVideoElement>(null)
  const cameraRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const timeRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  const lastBenchLog = useRef(0)

  const composition = useMemo(
    () => new Composition(recording, { ...project, segments }),
    [recording, project, segments]
  )

  // A profile marked as default is the user's house style; apply it before they
  // touch anything, so every take opens looking the way they want.
  useEffect(() => {
    void api.listProfiles().then((profiles) => {
      const preferred = profiles.find((p) => p.isDefault)
      if (preferred) setProject((current) => ({ ...current, ...(preferred.settings as object) }))
    })
  }, [recording])

  // Regenerate the automatic zooms whenever their settings change, keeping any
  // segment the user added or edited by hand.
  useEffect(() => {
    const auto = generateSegments(
      recording.input,
      project.zoom,
      recording.source,
      recording.duration
    )
    setSegments((prev) =>
      [...auto, ...prev.filter((s) => !s.auto)].sort((a, b) => a.start - b.start)
    )
  }, [recording, project.zoom])

  // ---- transport ---------------------------------------------------------

  const seek = useCallback(
    (t: number) => {
      const clamped = Math.min(Math.max(t, 0), recording.duration)
      timeRef.current = clamped
      setTime(clamped)
      const screen = screenRef.current
      if (screen) screen.currentTime = clamped
      const camera = cameraRef.current
      if (camera) {
        const ct = clamped - recording.cameraOffset - cameraSync
        if (ct >= 0 && ct <= camera.duration) camera.currentTime = ct
      }
    },
    [recording, cameraSync]
  )

  const togglePlay = useCallback(() => {
    const screen = screenRef.current
    if (!screen) return
    if (playing) {
      screen.pause()
      cameraRef.current?.pause()
      setPlaying(false)
    } else {
      if (timeRef.current >= trim.end - 0.02) seek(trim.start)
      void screen.play()
      const camera = cameraRef.current
      if (camera) {
        const ct = timeRef.current - recording.cameraOffset - cameraSync
        if (ct >= 0 && ct <= camera.duration) {
          camera.currentTime = ct
          void camera.play()
        }
      }
      setPlaying(true)
    }
  }, [playing, seek, trim, recording, cameraSync])

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
        timeRef.current = screen.currentTime
        setTime(screen.currentTime)
        if (screen.currentTime >= trim.end - 0.01) {
          screen.pause()
          cameraRef.current?.pause()
          setPlaying(false)
        }
        // Nudge the camera back into sync if it has drifted audibly.
        const camera = cameraRef.current
        if (camera && !camera.paused) {
          const want = screen.currentTime - recording.cameraOffset - cameraSync
          if (want >= 0 && want < camera.duration && Math.abs(camera.currentTime - want) > 0.12) {
            camera.currentTime = want
          }
        }
      }

      const camera = cameraRef.current
      composition.render(ctx, timeRef.current, {
        screen,
        camera: camera && camera.readyState >= 2 ? camera : null,
        cameraSize:
          camera && camera.videoWidth
            ? { width: camera.videoWidth, height: camera.videoHeight }
            : undefined
      })
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [composition, playing, trim.end, recording, cameraSync, exporting])

  // ---- keyboard ----------------------------------------------------------
  // Declared after runExport below; hoisted via the ref so the handler always
  // calls the current one.
  const exportRef = useRef<() => Promise<void>>(async () => {})

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'SELECT') return
      if (event.code === 'Space') {
        event.preventDefault()
        togglePlay()
      } else if (event.code === 'ArrowLeft') {
        seek(timeRef.current - (event.shiftKey ? 1 : 1 / project.output.fps))
      } else if (event.code === 'ArrowRight') {
        seek(timeRef.current + (event.shiftKey ? 1 : 1 / project.output.fps))
      } else if (event.code === 'KeyE' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        void exportRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePlay, seek, project.output.fps])

  // ---- export ------------------------------------------------------------

  const runExport = async (): Promise<void> => {
    if (exporting) return
    screenRef.current?.pause()
    cameraRef.current?.pause()
    setPlaying(false)

    const controller = new AbortController()
    abortRef.current = controller
    setExporting({ fraction: 0, stage: 'Starting' })

    try {
      const result = await exportMP4({
        composition,
        screenURL: recording.screenURL,
        cameraURL: project.pip.enabled ? recording.cameraURL : undefined,
        cameraOffset: recording.cameraOffset,
        cameraSync,
        start: trim.start,
        end: trim.end,
        quality: 'high',
        signal: controller.signal,
        onProgress: (fraction, stage) => {
          setExporting({ fraction, stage })
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

      if (bench) {
        await api.benchFinish(bench.out, result.buffer)
        return
      }

      const path = await api.saveDialog({
        defaultPath: `demodog-${Date.now()}.mp4`,
        filters: [{ name: 'MP4 video', extensions: ['mp4'] }]
      })
      if (path) {
        await api.writeFile(path, result.buffer)
        await api.reveal(path)
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

  exportRef.current = runExport

  // Headless benchmark: start as soon as the media is ready.
  useEffect(() => {
    if (!bench) return
    if (bench.seconds > 0) setTrim({ start: 0, end: Math.min(bench.seconds, recording.duration) })
    const id = setTimeout(() => void exportRef.current(), 1800)
    return () => clearTimeout(id)
  }, [bench, recording.duration])

  // ---- render ------------------------------------------------------------

  const autoCount = segments.filter((s) => s.auto).length

  return (
    <div className="editor">
      <div className="stage">
        <canvas ref={canvasRef} width={project.output.width} height={project.output.height} />

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
          muted
        />
        {recording.cameraURL && (
          <video
            ref={cameraRef}
            src={recording.cameraURL}
            style={{ display: 'none' }}
            preload="auto"
            muted
          />
        )}

        {exporting && (
          <div className="progress-wrap">
            <div className="progress-card">
              <strong style={{ fontSize: 18 }}>Exporting</strong>
              <div className="progress-bar">
                <div style={{ width: `${Math.round(exporting.fraction * 100)}%` }} />
              </div>
              <div className="mono" style={{ fontSize: 12, color: 'var(--muted)' }}>
                {exporting.stage}
              </div>
              <button
                className="btn"
                style={{ marginTop: 14 }}
                onClick={() => abortRef.current?.abort()}
              >
                Cancel
              </button>
            </div>
          </div>
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
          <button className="btn violet" onClick={() => void runExport()} disabled={!!exporting}>
            Export MP4
          </button>
        </div>

        <Timeline
          recording={recording}
          segments={segments}
          selected={selected}
          time={time}
          trim={trim}
          onSeek={seek}
          onSelect={setSelected}
          onChange={setSegments}
        />
      </div>

      <Inspector
        project={project}
        onChange={setProject}
        segments={segments}
        onSegmentsChange={setSegments}
        selected={selected}
        onSelect={setSelected}
        recording={recording}
        cameraSync={cameraSync}
        onCameraSync={setCameraSync}
      />
    </div>
  )
}
