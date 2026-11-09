// MIT License - Copyright (c) fintonlabs.com
/**
 * Recording the camera, and knowing exactly when it started.
 *
 * The second half is the hard part, and it is what lip sync is made of. The
 * camera is a separate file with a timeline of its own, and the only thing
 * tying it to the screen recording is one wall-clock stamp: what moment does
 * the camera file's zero correspond to? Every millisecond of error in that
 * stamp moves the narration and the camera bubble against what is on screen,
 * for the whole take.
 *
 * It used to be stamped from `MediaRecorder`'s `start` event, on the reasoning
 * that the event fires once capture is genuinely under way. It does not: the
 * event is a task, and capture begins inside `start()`. The two are the same
 * thing only when nothing else wants the main thread — and recording begins at
 * the exact moment the app is starting a screen capture, which is one of the
 * busiest instants in its life. Measured with a canvas whose frames carry
 * known times (`npm run verify:camera-sync`): with the thread free the event is
 * ~30ms late, and with it loaded for 600ms the event is 614ms late while the
 * recording's own first frame still lands within 1ms of `start()`. Real takes
 * on this machine carried errors from 90ms to 2.9s.
 *
 * So the stamp is taken immediately before `start()` and nothing is allowed
 * between the two.
 */

/** Containers worth trying, best first. */
const TYPES = [
  // A fragmented MP4 can be demuxed and decoded sequentially at export time,
  // where a MediaRecorder WebM can only be seeked — and seeking the camera once
  // per output frame was the single largest cost in the exporter.
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm'
]

export function pickMimeType(supported: (type: string) => boolean = MediaRecorder.isTypeSupported): string | null {
  return TYPES.find((type) => supported(type)) ?? null
}

export interface CameraRecording {
  recorder: MediaRecorder
  /** Seconds since the epoch at the instant capture began. */
  startedAt: number
  /**
   * Stops, and does not return until every chunk has been handed over.
   *
   * Chunks reach the file through a promise — `Blob.arrayBuffer()` — and the
   * last one is still in flight when `MediaRecorder` fires `stop`. Waiting only
   * for that event and then closing the file dropped whatever had not resolved:
   * measured at the end of a six second recording, the last 2.6 seconds of
   * camera were missing from the file. The take then ended with a frozen
   * bubble and no voice.
   */
  stop: () => Promise<void>
}

/**
 * Monotonic within this process, unlike `Date.now()`.
 *
 * A clock that can be stepped by the system — which `Date.now()` is — can move
 * between the stamp here and the screen recorder's own stamp, and the
 * difference between those two *is* the camera's offset.
 */
function epochSeconds(): number {
  return (performance.timeOrigin + performance.now()) / 1000
}

/**
 * Starts recording, and returns the moment it started.
 *
 * `openFile` is awaited first because a chunk cannot be written before the file
 * exists. Everything slow therefore happens before the stamp, and the stamp and
 * `start()` are adjacent with nothing between them — no await, no IPC, no
 * allocation. That adjacency is the whole point of this function, and the
 * reason it is not written inline in the component.
 */
export async function startCameraRecording(
  stream: MediaStream,
  options: {
    mimeType: string
    openFile: (info: { startWallClock: number; mimeType: string }) => Promise<unknown>
    onChunk: (chunk: ArrayBuffer) => void
    timeslice?: number
    videoBitsPerSecond?: number
    audioBitsPerSecond?: number
  }
): Promise<CameraRecording> {
  // A provisional stamp: the file has to exist before any chunk can be written,
  // and opening it costs an IPC round trip and a file creation. Corrected by
  // the caller with `startedAt` as soon as this returns.
  await options.openFile({ startWallClock: epochSeconds(), mimeType: options.mimeType })

  const recorder = new MediaRecorder(stream, {
    mimeType: options.mimeType,
    videoBitsPerSecond: options.videoBitsPerSecond ?? 4_000_000,
    audioBitsPerSecond: options.audioBitsPerSecond ?? 128_000
  })
  /** Chunks on their way to the file, so the end of a take cannot be lost. */
  const inFlight = new Set<Promise<unknown>>()
  recorder.ondataavailable = (event) => {
    if (event.data.size === 0) return
    const handed = event.data
      .arrayBuffer()
      .then((buffer) => options.onChunk(buffer))
      .catch(() => undefined)
    inFlight.add(handed)
    void handed.finally(() => inFlight.delete(handed))
  }

  // ---- nothing between these two lines ------------------------------------
  const startedAt = epochSeconds()
  recorder.start(options.timeslice ?? 1000)
  // -------------------------------------------------------------------------

  const stop = async (): Promise<void> => {
    if (recorder.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        recorder.addEventListener('stop', () => resolve(), { once: true })
        recorder.stop()
      })
    }
    // The final `dataavailable` is dispatched before `stop`, so its promise is
    // already in the set by the time we get here.
    await Promise.allSettled([...inFlight])
  }

  return { recorder, startedAt, stop }
}
