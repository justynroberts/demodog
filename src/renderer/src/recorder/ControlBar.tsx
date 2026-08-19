// MIT License - Copyright (c) fintonlabs.com
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { api } from '../api'

/**
 * The floating transport shown while recording, in its own always-on-top
 * window.
 *
 * It also owns camera and microphone capture. That lives here rather than in
 * the studio window for one reason: this is the only renderer guaranteed to
 * stay alive and unthrottled for the whole take. Chromium aggressively throttles
 * hidden windows, which would stall a MediaRecorder running in the background.
 */
export default function ControlBar(): ReactNode {
  const [elapsed, setElapsed] = useState(0)
  const [running, setRunning] = useState(false)
  const [stopping, setStopping] = useState(false)

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const startRef = useRef(0)
  const [hasCamera, setHasCamera] = useState(false)
  /**
   * Set while the user is arranging their screen, before a take begins.
   *
   * The same bar carries both jobs. It floats above every other window and is
   * already where the user looks for the recording controls, so putting Start
   * anywhere else means two floating panels and a button that disappears
   * behind the very window it just brought forward.
   */
  const [stage, setStage] = useState<{ title: string; hint: string } | null>(null)
  // Distinguishes 'no camera chosen' from 'camera chosen but unavailable'.
  const [cameraWanted, setCameraWanted] = useState(false)

  // ---- device setup ------------------------------------------------------

  useEffect(() => {
    return api.on('bar:prepare', async (payload) => {
      const { cameraDeviceId, micDeviceId } = payload as {
        cameraDeviceId: string | null
        micDeviceId: string | null
      }
      if (!cameraDeviceId && !micDeviceId) return
      setCameraWanted(Boolean(cameraDeviceId))

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: cameraDeviceId
            ? {
                deviceId: { exact: cameraDeviceId },
                width: { ideal: 1280 },
                height: { ideal: 720 },
                frameRate: { ideal: 30 }
              }
            : false,
          audio: micDeviceId
            ? {
                deviceId: { exact: micDeviceId },
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
              }
            : false
        })
        streamRef.current = stream
        setHasCamera(Boolean(cameraDeviceId))
        console.log(
          `[bar] capture ready — camera=${stream.getVideoTracks().length > 0}, ` +
            `mic=${stream.getAudioTracks().length > 0}`
        )
        if (videoRef.current && cameraDeviceId) {
          videoRef.current.srcObject = stream
          await videoRef.current.play().catch(() => undefined)
        }
      } catch (error) {
        // Most often the device is still held by the setup screen's preview.
        console.error('[bar] camera/mic unavailable', error)
        setHasCamera(false)
      }
    })
  }, [])

  // ---- start on the screen recorder's signal -----------------------------

  useEffect(() => {
    return api.on('bar:started', async () => {
      startRef.current = performance.now()
      setRunning(true)

      const stream = streamRef.current
      if (!stream) {
        console.warn('[bar] recording started with no camera or microphone stream')
        return
      }

      // MP4 first: a fragmented MP4 can be demuxed and decoded sequentially at
      // export time, where a MediaRecorder WebM can only be seeked — and
      // seeking the camera once per output frame was the single largest cost
      // in the exporter. WebM stays as the fallback.
      const mimeType = [
        'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
        'video/mp4',
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm'
      ].find((type) => MediaRecorder.isTypeSupported(type))
      if (!mimeType) return

      // A provisional sync point: the file has to exist before any chunk can be
      // written, and opening it costs an IPC round trip and a file creation.
      await api.openCameraFile({ startWallClock: Date.now() / 1000, mimeType })

      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: 4_000_000,
        audioBitsPerSecond: 128_000
      })
      // The real one. Everything between the provisional stamp and here — the
      // round trip, the file, constructing the recorder — made the camera look
      // earlier than it was, and that error is a fixed lip-sync offset across
      // the whole take. `start` fires once capture is genuinely under way.
      recorder.onstart = () => void api.cameraStarted(Date.now() / 1000)
      recorder.ondataavailable = async (event) => {
        if (event.data.size > 0) api.writeCameraChunk(await event.data.arrayBuffer())
      }
      // Chunked writes keep a long take off the heap.
      recorder.start(1000)
      recorderRef.current = recorder
    })
  }, [])

  // Effects run in order, so by the time this one fires the prepare/started
  // listeners above are registered and it is safe to be sent messages.
  useEffect(() => {
    api.announceBarReady()
  }, [])

  // ---- timer -------------------------------------------------------------

  useEffect(() => {
    if (!running) return
    const id = setInterval(() => setElapsed((performance.now() - startRef.current) / 1000), 100)
    return () => clearInterval(id)
  }, [running])

  // ---- stop --------------------------------------------------------------

  const stop = useCallback(async () => {
    if (stopping) return
    setStopping(true)

    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      // Flush the tail chunk before the main process closes the file.
      await new Promise<void>((resolve) => {
        recorder.addEventListener('stop', () => resolve(), { once: true })
        recorder.stop()
      })
    }
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    recorderRef.current = null

    await api.stopRecording().catch((error) => console.error(error))
    setRunning(false)
    setStopping(false)
    setElapsed(0)
  }, [stopping])

  useEffect(() => api.on('bar:request-stop', () => void stop()), [stop])

  const cancel = async (): Promise<void> => {
    recorderRef.current?.stop()
    streamRef.current?.getTracks().forEach((track) => track.stop())
    await api.cancelRecording()
    setRunning(false)
    setElapsed(0)
  }

  useEffect(() => api.on('bar:stage', (detail) => setStage(detail as never)), [])

  const minutes = Math.floor(elapsed / 60)
  const seconds = Math.floor(elapsed % 60)

  if (stage && !running) {
    return (
      <div className="bar-root">
        <div className="bar bar-ready">
          <span className="rec-dot" aria-hidden />
          {/* No source name. You just chose it, and it is the window now in
              front of you — repeating it back is a label nobody reads. */}
          <span className="bar-ready-text">Arrange your screen, then start.</span>
          <button className="btn primary" onClick={() => api.sendReadyAction('start')}>
            Start
          </button>
          <button className="btn ghost" onClick={() => api.sendReadyAction('back')}>
            Back
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="bar-root">
      <div className="bar">
        <span className="rec-dot" aria-hidden />
        <span className="bar-time">
          {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
        </span>

        <video
          ref={videoRef}
          className="bar-cam"
          muted
          playsInline
          title="Your camera as it is being recorded"
          style={{ display: hasCamera ? 'block' : 'none' }}
        />
        {cameraWanted && !hasCamera && <span className="bar-nocam">camera failed</span>}

        <button className="btn primary" onClick={() => void stop()} disabled={stopping}>
          {stopping ? 'Finishing…' : 'Stop'}
        </button>
        <button className="btn ghost" onClick={() => void cancel()} title="Discard this take">
          Discard
        </button>
        <span className="bar-hint">⌘⇧2</span>
      </div>
    </div>
  )
}
