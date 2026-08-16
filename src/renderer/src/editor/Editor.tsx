// MIT License - Copyright (c) fintonlabs.com
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api } from '../api'
import { Composition } from '../engine/composition'
import { generateSegments } from '../engine/autozoom'
import { defaultProject, mergeSettings } from '../engine/defaults'
import { exportMP4 } from '../engine/export'
import type { Project, Recording, ZoomSegment } from '../engine/types'
import { fadeAlphaAt } from '../engine/composition'
import { fadeOutAndPause, isRamping, rampVolume } from './mediaFade'
import { formatTime } from '../ui/controls'
import Timeline from './Timeline'
import Inspector from './Inspector'
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
  bench?: { out: string; seconds: number; plain?: boolean } | null
}): ReactNode {
  const [project, setProject] = useState<Project>(() => {
    const base = defaultProject(recording.source, Boolean(recording.cameraURL))
    // Applied here rather than in an effect, because the export closure
    // captures the project it was created with — updating the state later left
    // the overlays on and the check they exist to isolate meaningless.
    if (!bench?.plain) return base
    return {
      ...base,
      zoom: { ...base.zoom, enabled: false },
      // `visible`, not `enabled` — the cursor has its own key, and setting the
      // wrong one left the pointer drawn and moving, which is enough on its own
      // to make every exported frame differ.
      cursor: { ...base.cursor, visible: false },
      pip: { ...base.pip, enabled: false },
      // Fades brighten the picture across the opening and closing second, which
      // changes it every frame regardless of the recording underneath.
      fade: { in: 0, out: 0 }
    }
  })
  const [segments, setSegments] = useState<ZoomSegment[]>([])
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [cameraSync, setCameraSync] = useState(0)
  const [trim, setTrim] = useState<{ start: number; end: number }>({
    start: 0,
    end: recording.duration
  })
  const [exporting, setExporting] = useState<{
    fraction: number
    stage: string
    /** Seconds remaining, once enough of the run has happened to say. */
    remaining: number | null
  } | null>(null)
  const [askingExport, setAskingExport] = useState(false)
  // Held here rather than in the inspector: the inspector's tabs unmount, and a
  // profile must not be re-applied over the user's edits when they come back.
  const [profileId, setProfileId] = useState('')

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
      if (!preferred) return
      setProject((current) => mergeSettings(current, preferred.settings))
      // Select it too, so saving updates this profile instead of making a copy.
      setProfileId(preferred.id)
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
      const clamped = Math.min(Math.max(t, 0), recording.duration)
      timeRef.current = clamped
      setTime(clamped)
      const screen = screenRef.current
      if (screen) screen.currentTime = clamped
      const camera = cameraRef.current
      if (camera) {
        const ct = clamped - recording.cameraOffset - cameraSync
        if (ct >= 0) camera.currentTime = ct
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
      // The camera is started by the draw loop rather than here: its track
      // begins slightly after the screen's, so at t=0 it is not due yet.
      setPlaying(true)
    }
  }, [playing, seek, trim, recording, cameraSync])

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
    screenRef.current?.pause()
    const camera = cameraRef.current
    if (camera && !camera.paused) fadeOutAndPause(camera)
    if (camera) camera.playbackRate = 1
  }, [playing])

  // The screen element can reach its own end before the trim does.
  useEffect(() => {
    const screen = screenRef.current
    if (!screen) return
    const onEnded = (): void => setPlaying(false)
    screen.addEventListener('ended', onEnded)
    return () => screen.removeEventListener('ended', onEnded)
  }, [recording])

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
        timeRef.current = screen.currentTime
        setTime(screen.currentTime)
        if (screen.currentTime >= trim.end - 0.01) {
          screen.pause()
          cameraRef.current?.pause()
          setPlaying(false)
        }
        // The camera track starts after the screen track, so it has to be
        // started when its own timeline begins — not when playback does.
        // Waiting for `ct >= 0` at press time meant it never started at all.
        const camera = cameraRef.current
        if (camera) {
          const want = screen.currentTime - recording.cameraOffset - cameraSync
          if (want < 0) {
            // Not due yet; hold it at its first frame.
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
            if (Math.abs(drift) > 0.5) {
              camera.currentTime = want
              camera.playbackRate = 1
            } else if (Math.abs(drift) > 0.04) {
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
        if (want >= 0 && Math.abs(camera.currentTime - want) > 0.05) {
          camera.currentTime = want
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
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [composition, playing, trim.end, recording, cameraSync, exporting])

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
      if (target.tagName === 'INPUT' || target.tagName === 'SELECT') return
      if (event.code === 'Space') {
        event.preventDefault()
        togglePlay()
      } else if (event.code === 'ArrowLeft') {
        seek(timeRef.current - (event.shiftKey ? 1 : 1 / project.output.fps))
      } else if (event.code === 'ArrowRight') {
        seek(timeRef.current + (event.shiftKey ? 1 : 1 / project.output.fps))
      } else if (event.code === 'Backspace' || event.code === 'Delete') {
        if (!selectedRef.current) return
        event.preventDefault()
        setSegments((current) => current.filter((s) => s.id !== selectedRef.current))
        setSelected(null)
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

    // The chosen size and rate are the project's from here on, so the preview
    // and the exported file cannot disagree about framing.
    const project2 = {
      ...project,
      output: { ...project.output, width: choice.width, height: choice.height, fps: choice.fps },
      frame: { ...project.frame, fitMode: choice.fitMode }
    }
    setProject(project2)
    composition.project = project2
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
        cameraURL: project.pip.enabled ? recording.cameraURL : undefined,
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
        />
        {recording.cameraURL && (
          <video
            ref={cameraRef}
            src={recording.cameraURL}
            style={{ display: 'none' }}
            preload="auto"
          />
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

        {exporting && (
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
        profileId={profileId}
        onProfileId={setProfileId}
      />
    </div>
  )
}
