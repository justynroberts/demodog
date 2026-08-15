// MIT License - Copyright (c) fintonlabs.com
import {
  createFile,
  DataStream,
  Endianness,
  MP4BoxBuffer,
  type ISOFile,
  type Movie,
  type Sample
} from 'mp4box'

/**
 * Supplies the frame of a video at a given time during export.
 *
 * Two implementations, because the two jobs are different:
 *
 *  - `DecodingFrameSource` walks the file forwards through a WebCodecs decoder.
 *    Export renders strictly in time order, so decoding sequentially is far
 *    cheaper than seeking — a seek throws the decoder back to a keyframe and
 *    re-decodes the whole group of pictures for every single output frame.
 *  - `SeekingFrameSource` sets `video.currentTime` and waits. Slow, but it works
 *    on anything the browser can play, so it is both the fallback and the path
 *    used for the WebM camera track.
 */
export interface FrameSource {
  /** Which implementation this is, for diagnostics. */
  readonly kind: 'decode' | 'seek'
  readonly width: number
  readonly height: number
  /** A drawable showing the video at `t` seconds, or null past the end. */
  frameAt(t: number): Promise<CanvasImageSource | null>
  close(): void
}

/** Above this the file is not worth holding in memory; fall back to seeking. */
const MAX_IN_MEMORY_BYTES = 800 * 1024 * 1024

/** Chunks allowed in flight; must exceed the codec's reorder depth. */
const IN_FLIGHT_CHUNKS = 96

/** Decoded frames held before feeding pauses. */
const MAX_QUEUED_FRAMES = 48

// ---------------------------------------------------------------------------
// Sequential decode
// ---------------------------------------------------------------------------

/**
 * A decoded frame and the time it starts being shown.
 *
 * There is deliberately no end time: `VideoFrame.duration` is frequently null,
 * and a frame is shown until the next one starts anyway — so coverage is
 * decided by looking at the following frame, never at a duration.
 */
interface QueuedFrame {
  frame: VideoFrame
  start: number
}

class DecodingFrameSource implements FrameSource {
  readonly kind = 'decode' as const
  readonly width: number
  readonly height: number

  private decoder: VideoDecoder
  private samples: Sample[]
  private next = 0
  private queue: QueuedFrame[] = []
  private current: QueuedFrame | null = null
  private flushed = false
  private decoded = 0
  private baseTime = 0
  private failure: unknown = null
  private wake: (() => void) | null = null

  private constructor(
    samples: Sample[],
    config: VideoDecoderConfig,
    width: number,
    height: number
  ) {
    this.samples = samples
    this.width = width
    this.height = height

    this.decoder = new VideoDecoder({
      output: (frame) => {
        this.decoded++
        this.queue.push({ frame, start: frame.timestamp / 1e6 - this.baseTime })
        this.wake?.()
      },
      error: (error) => {
        this.failure = error
        this.wake?.()
      }
    })
    this.decoder.configure(config)
  }

  static async create(url: string): Promise<DecodingFrameSource> {
    const response = await fetch(url)
    const buffer = await response.arrayBuffer()
    if (buffer.byteLength > MAX_IN_MEMORY_BYTES) {
      throw new Error(`file too large for in-memory demux (${buffer.byteLength} bytes)`)
    }

    // `keepMdatData` matters: extraction options can only be set once the moov
    // has been parsed, and without this the sample payloads are released before
    // we get the chance, yielding a file that parses fine but returns nothing.
    const file = createFile(true)
    const samples: Sample[] = []

    const info = await new Promise<Movie>((resolve, reject) => {
      file.onReady = resolve
      file.onError = (_module: string, message: string) => reject(new Error(message))
      file.appendBuffer(MP4BoxBuffer.fromArrayBuffer(buffer, 0))
    })

    const track = info.videoTracks?.[0]
    if (!track?.video) throw new Error('no video track')

    // Extraction can legitimately yield fewer samples than `nb_samples`
    // advertises, so completion cannot be detected by counting alone. Settle on
    // the count when it is reached, otherwise once the sample callbacks go
    // quiet, and give up entirely after a hard timeout — a stalled demux must
    // fall back to seeking, not hang the export.
    await new Promise<void>((resolve, reject) => {
      let idle: ReturnType<typeof setTimeout> | undefined
      const finish = (): void => {
        clearTimeout(idle)
        clearTimeout(guard)
        resolve()
      }
      const bumpIdle = (): void => {
        clearTimeout(idle)
        idle = setTimeout(finish, 300)
      }
      const guard = setTimeout(() => {
        clearTimeout(idle)
        reject(new Error('timed out extracting samples'))
      }, 15_000)

      file.onSamples = (_id, _user, batch: Sample[]) => {
        samples.push(...batch)
        if (samples.length >= track.nb_samples) finish()
        else bumpIdle()
      }
      file.onError = (_module: string, message: string) => {
        clearTimeout(idle)
        clearTimeout(guard)
        reject(new Error(message))
      }

      // Order matters: configure extraction, start, and only then flush the
      // remaining buffered data through.
      file.setExtractionOptions(track.id, undefined, { nbSamples: track.nb_samples })
      file.start()
      file.flush()

      if (samples.length >= track.nb_samples) finish()
      else bumpIdle()
    })

    if (samples.length === 0) throw new Error('no samples extracted')

    const config: VideoDecoderConfig = {
      codec: track.codec,
      codedWidth: track.video.width,
      codedHeight: track.video.height,
      description: codecDescription(file, track.id)
    }
    const support = await VideoDecoder.isConfigSupported(config)
    if (!support.supported) throw new Error(`unsupported codec ${track.codec}`)

    return new DecodingFrameSource(samples, config, track.video.width, track.video.height)
  }

  /**
   * Keeps the decoder fed without letting decoded frames pile up.
   *
   * Backpressure is measured as chunks fed minus frames received, *not* as
   * `decodeQueueSize`: that counter is still zero while this synchronous loop
   * runs, so gating on it feeds the entire file in one burst, and WebCodecs
   * stalls once hundreds of VideoFrames are outstanding and unclosed.
   *
   * The window must also stay comfortably larger than the codec's reorder
   * buffer. H.264 High profile can hold 16 frames in its DPB and emits nothing
   * until it has enough input to resolve presentation order, so a window that
   * small deadlocks: the decoder waits for chunks, and we wait for frames.
   */
  private pump(): void {
    while (
      this.next < this.samples.length &&
      this.next - this.decoded < IN_FLIGHT_CHUNKS &&
      this.queue.length < MAX_QUEUED_FRAMES
    ) {
      const sample = this.samples[this.next++]
      if (!sample.data) continue
      this.decoder.decode(
        new EncodedVideoChunk({
          type: sample.is_sync ? 'key' : 'delta',
          timestamp: (sample.cts / sample.timescale) * 1e6,
          duration: (sample.duration / sample.timescale) * 1e6,
          data: sample.data
        })
      )
    }
  }

  private adopt(): CanvasImageSource {
    this.current?.frame.close()
    this.current = this.queue.shift()!
    return this.current.frame
  }

  async frameAt(t: number): Promise<CanvasImageSource | null> {
    if (this.failure) throw this.failure

    for (;;) {
      if (this.failure) throw this.failure
      this.pump()

      // Advance past any frame that the following one has already superseded.
      while (this.queue.length >= 2 && this.queue[1].start <= t) this.adopt()

      // With a successor in hand we know where the head frame stops being
      // current, so the decision can be made without waiting for more.
      if (this.queue.length >= 2) {
        if (this.queue[0].start <= t) return this.adopt()
        return this.current?.frame ?? this.adopt()
      }

      const drained = this.next >= this.samples.length && this.next - this.decoded <= 0
      if (drained) {
        if (!this.flushed) {
          this.flushed = true
          await this.decoder.flush().catch(() => undefined)
          continue
        }
        if (this.queue.length === 1) return this.adopt()
        return this.current?.frame ?? null
      }

      await new Promise<void>((resolve) => {
        const done = (): void => {
          this.wake = null
          resolve()
        }
        this.wake = done
        // The decoder may already be idle with nothing left to emit.
        setTimeout(() => this.wake && done(), 2)
      })
    }
  }

  close(): void {
    this.current?.frame.close()
    for (const queued of this.queue) queued.frame.close()
    this.queue = []
    this.current = null
    if (this.decoder.state !== 'closed') this.decoder.close()
  }
}

/** Extracts the raw codec configuration box the decoder needs. */
function codecDescription(file: ISOFile, trackId: number): Uint8Array | undefined {
  const trak = file.getTrackById(trackId)
  const entries = (trak?.mdia?.minf?.stbl?.stsd?.entries ?? []) as unknown as Record<
    string,
    { write(stream: DataStream): void } | undefined
  >[]
  for (const entry of entries) {
    const box = entry.avcC ?? entry.hvcC ?? entry.vpcC ?? entry.av1C
    if (!box) continue
    const stream = new DataStream(undefined, 0, Endianness.BIG_ENDIAN)
    box.write(stream)
    // Strip the 8-byte box header; the decoder wants only the payload.
    return new Uint8Array(stream.buffer.slice(8))
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Seeking fallback
// ---------------------------------------------------------------------------

class SeekingFrameSource implements FrameSource {
  readonly kind = 'seek' as const

  private constructor(
    private video: HTMLVideoElement,
    /**
     * Requests closer together than this reuse the frame already decoded.
     *
     * A 30fps camera against a 60fps output is asked for a new time every
     * output frame, but half of those land inside the same source frame — and
     * each needless seek costs a full decode. Measured at ~23% of export time
     * before this.
     */
    private frameTolerance = 0
  ) {}

  get width(): number {
    return this.video.videoWidth
  }

  get height(): number {
    return this.video.videoHeight
  }

  static create(url: string, frameTolerance = 0): Promise<SeekingFrameSource> {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video')
      video.src = url
      video.muted = true
      video.preload = 'auto'
      video.onloadedmetadata = () => resolve(new SeekingFrameSource(video, frameTolerance))
      video.onerror = () => reject(new Error(`could not load ${url}`))
    })
  }

  async frameAt(t: number): Promise<CanvasImageSource | null> {
    const video = this.video
    if (t < 0) return null

    // A WebM written by MediaRecorder is a *streaming* file: it carries no
    // duration in its header, so `video.duration` is Infinity or NaN. Treating
    // that as "no video" silently dropped the camera from every export, so an
    // unknown duration simply means "unbounded" here.
    const duration = video.duration
    const bounded = Number.isFinite(duration) && duration > 0
    if (bounded && t >= duration) return video.readyState >= 2 ? video : null

    const target = bounded ? Math.min(t, duration - 1e-3) : t
    // `currentTime` after a seek is the *actual* decoded frame's time, so this
    // compares against real frame boundaries rather than requested ones.
    const near = Math.max(1e-4, this.frameTolerance)
    if (Math.abs(video.currentTime - target) < near && video.readyState >= 2) return video

    await new Promise<void>((resolve) => {
      let settled = false
      const done = (): void => {
        if (settled) return
        settled = true
        clearTimeout(guard)
        video.removeEventListener('seeked', done)
        resolve()
      }
      // Seeking past the end of an unbounded file may never fire 'seeked';
      // an export must not hang waiting for it.
      const guard = setTimeout(done, 2000)
      video.addEventListener('seeked', done)
      video.currentTime = target
    })

    return video.readyState >= 2 ? video : null
  }

  close(): void {
    this.video.removeAttribute('src')
    this.video.load()
    this.video.remove()
  }
}

// ---------------------------------------------------------------------------

/**
 * Prefers sequential decoding and quietly falls back to seeking — an unusual
 * container or an oversized file should make the export slow, not broken.
 */
export async function openFrameSource(
  url: string,
  prefer: 'decode' | 'seek' = 'decode',
  frameTolerance = 0
): Promise<FrameSource> {
  if (prefer === 'decode' && typeof VideoDecoder !== 'undefined') {
    try {
      return await DecodingFrameSource.create(url)
    } catch (error) {
      console.warn('[export] sequential decode unavailable, seeking instead:', error)
    }
  }
  return SeekingFrameSource.create(url, frameTolerance)
}
