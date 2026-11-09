// MIT License - Copyright (c) fintonlabs.com
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { api } from '../api'
import { pickMimeType, startCameraRecording } from './cameraRecorder'

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
  /** Stops the camera *and* waits for its last chunks to reach the file. */
  const stopCameraRef = useRef<(() => Promise<void>) | null>(null)
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

      const constraints: MediaStreamConstraints = {
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
      }

      // Asked for more than once, because the usual failure is a race rather
      // than a fault. The setup screen holds the camera for its preview and
      // releases it as the take begins; the handover is a fixed pause, and a
      // pause is a guess. Losing that race costs the whole take's camera and
      // leaves the bar showing nothing, so the first refusal is not taken as
      // the answer. The device is normally free by the second attempt.
      const acquire = async (attempt = 0): Promise<MediaStream> => {
        try {
          return await navigator.mediaDevices.getUserMedia(constraints)
        } catch (error) {
          if (attempt >= 3) throw error
          console.warn(`[bar] capture device busy, retrying (${attempt + 1})`)
          await new Promise((resolve) => setTimeout(resolve, 250 + attempt * 250))
          return acquire(attempt + 1)
        }
      }

      try {
        const stream = await acquire()
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
        // Said out loud: a take recorded without the camera someone chose is
        // worth knowing about while it is still being recorded.
        console.error('[bar] camera/mic unavailable after retries', error)
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

      const mimeType = pickMimeType()
      if (!mimeType) return

      // Where the camera lands against the screen for the whole take — see
      // cameraRecorder for why the stamp is taken there rather than from the
      // recorder's `start` event, and what it cost when it was not.
      const { recorder, startedAt, stop } = await startCameraRecording(stream, {
        mimeType,
        openFile: (info) => api.openCameraFile(info),
        onChunk: (chunk) => api.writeCameraChunk(chunk)
      })
      void api.cameraStarted(startedAt)
      recorderRef.current = recorder
      stopCameraRef.current = stop
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

    // Every chunk has to be written before the main process closes the file,
    // and the last of them is still in flight when the recorder says it has
    // stopped — see cameraRecorder.
    await stopCameraRef.current?.()
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    recorderRef.current = null
    stopCameraRef.current = null

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

  // Ready and recording are two faces of one bar, rendered from one tree.
  //
  // They were two separate returns, and the camera paid for it: the element the
  // stream attaches to only existed in the recording branch, so a stream handed
  // over while the bar was still showing Start found no element to attach to
  // and the camera never appeared for the whole take. The video stays mounted
  // in both states; only the controls around it change.
  const ready = Boolean(stage) && !running

  return (
    <div className="bar-root">
      <div className={ready ? 'bar bar-ready' : 'bar'}>
        <span className="rec-dot" aria-hidden />
        {ready ? (
          <span className="bar-ready-text">Arrange your screen, then start.</span>
        ) : (
          <span className="bar-time">
            {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
          </span>
        )}

        <video
          ref={videoRef}
          className="bar-cam"
          muted
          playsInline
          title="Your camera as it is being recorded"
          style={{ display: hasCamera ? 'block' : 'none' }}
        />
        {cameraWanted && !hasCamera && !ready && <span className="bar-nocam">camera failed</span>}

        {ready ? (
          <>
            <button className="btn primary" onClick={() => api.sendReadyAction('start')}>
              Start
            </button>
            <button className="btn ghost" onClick={() => api.sendReadyAction('back')}>
              Back
            </button>
          </>
        ) : (
          <>
            <button className="btn primary" onClick={() => void stop()} disabled={stopping}>
              {stopping ? 'Finishing…' : 'Stop'}
            </button>
            <button className="btn ghost" onClick={() => void cancel()} title="Discard this take">
              Discard
            </button>
            <span className="bar-hint">⌘⇧2</span>
          </>
        )}
      </div>
    </div>
  )
}
