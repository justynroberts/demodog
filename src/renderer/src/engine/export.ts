// MIT License - Copyright (c) fintonlabs.com
import { Muxer, ArrayBufferTarget } from 'mp4-muxer'
import { openFrameSource } from './frameSource'
import type { Composition } from './composition'

export interface ExportOptions {
  composition: Composition
  screenURL: string
  cameraURL?: string
  cameraOffset: number
  /** Extra nudge applied to the camera track, in seconds. */
  cameraSync: number
  start: number
  end: number
  quality: 'good' | 'high' | 'max'
  onProgress: (fraction: number, stage: string) => void
  signal?: AbortSignal
}

export interface ExportResult {
  buffer: ArrayBuffer
  frames: number
}

/**
 * Opt-in: decode the screen track sequentially instead of seeking it.
 *
 * Sequential decoding is the right shape for an exporter that renders strictly
 * forwards, and should be much faster than forcing the decoder back to a
 * keyframe for every output frame. It is off by default only because it has not
 * yet been confirmed to produce a correct file end to end; the seeking path has.
 * Flip this to `true` and compare exported frames against the preview before
 * making it the default.
 */
const SEQUENTIAL_DECODE = false

/**
 * Renders the composition to an MP4.
 *
 * Source frames come from a `FrameSource` and are drawn through the *same*
 * `Composition.render` the preview uses, so what was previewed is what gets
 * encoded. Encoding goes through WebCodecs, which hands off to VideoToolbox on
 * Apple silicon.
 */
export async function exportMP4(options: ExportOptions): Promise<ExportResult> {
  const { composition, onProgress, signal } = options
  const { output } = composition.project
  const fps = output.fps
  const duration = Math.max(0.05, options.end - options.start)
  const frameCount = Math.max(1, Math.round(duration * fps))

  onProgress(0, 'Preparing video')

  // Seeking is the default because it is the path whose output has been
  // verified frame-for-frame against the preview. `SEQUENTIAL_DECODE` switches
  // the screen track to a WebCodecs decoder, which should be considerably
  // faster but is not yet proven end to end — see the export notes in
  // CLAUDE.md. The camera is WebM, which the MP4 demuxer cannot read at all.
  const screen = await openFrameSource(options.screenURL, SEQUENTIAL_DECODE ? 'decode' : 'seek')
  const camera = options.cameraURL
    ? await openFrameSource(options.cameraURL, 'seek').catch(() => null)
    : null

  const canvas = new OffscreenCanvas(output.width, output.height)
  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) throw new Error('could not create a 2D context for export')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  // Level has to cover the resolution or the encoder refuses the config.
  const codec = pickAvcCodec(output.width, output.height)
  const bitrate = pickBitrate(output.width, output.height, fps, options.quality)

  const audio = await buildAudio(options).catch((error) => {
    console.warn('audio export failed, continuing without it', error)
    return null
  })

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width: output.width, height: output.height },
    ...(audio
      ? {
          audio: {
            codec: 'aac',
            sampleRate: audio.sampleRate,
            numberOfChannels: 2
          }
        }
      : {}),
    fastStart: 'in-memory'
  })

  let encoderError: unknown = null
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (error) => (encoderError = error)
  })
  encoder.configure({
    codec,
    width: output.width,
    height: output.height,
    bitrate,
    framerate: fps,
    latencyMode: 'quality'
  })

  try {
    const microsPerFrame = 1_000_000 / fps

    // Coarse timing, reported once at the end. Export throughput is easy to
    // guess wrong about, so measure it rather than assume.
    const spent = { screen: 0, camera: 0, render: 0, encode: 0, drain: 0 }
    const startedAt = performance.now()

    for (let i = 0; i < frameCount; i++) {
      if (signal?.aborted) {
        encoder.close()
        throw new Error('Export cancelled')
      }
      if (encoderError) throw encoderError

      const t = options.start + i / fps
      // Sample at the middle of the frame's interval — landing exactly on a
      // boundary makes the choice of source frame ambiguous.
      const sampleTime = t + 0.5 / fps

      let mark = performance.now()
      const screenFrame = await screen.frameAt(sampleTime)
      spent.screen += performance.now() - mark

      mark = performance.now()
      const cameraFrame = camera
        ? await camera.frameAt(sampleTime - options.cameraOffset - options.cameraSync)
        : null
      spent.camera += performance.now() - mark

      mark = performance.now()
      composition.render(ctx, t, {
        screen: screenFrame,
        camera: cameraFrame,
        cameraSize: cameraFrame ? { width: camera!.width, height: camera!.height } : undefined
      })
      spent.render += performance.now() - mark

      mark = performance.now()
      const frame = new VideoFrame(canvas, {
        timestamp: Math.round(i * microsPerFrame),
        duration: Math.round(microsPerFrame)
      })
      // A keyframe every two seconds keeps seeking responsive in players.
      encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 })
      frame.close()
      spent.encode += performance.now() - mark

      // Let the encoder drain so its queue does not grow without bound.
      mark = performance.now()
      if (encoder.encodeQueueSize > 12) {
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
      spent.drain += performance.now() - mark
      if (i % 3 === 0)
        onProgress((i / frameCount) * 0.94, `Encoding frame ${i + 1} of ${frameCount}`)
    }

    const total = performance.now() - startedAt
    console.log(
      `[export] ${frameCount} frames in ${(total / 1000).toFixed(1)}s ` +
        `(${(frameCount / (total / 1000)).toFixed(1)} fps) — ` +
        Object.entries(spent)
          .map(([k, v]) => `${k} ${(v / 1000).toFixed(1)}s`)
          .join(', ')
    )

    onProgress(0.95, 'Finishing video')
    await encoder.flush()
    encoder.close()

    if (audio) {
      onProgress(0.97, 'Encoding audio')
      await encodeAudio(audio, muxer, signal)
    }

    muxer.finalize()
    onProgress(1, 'Done')

    return { buffer: muxer.target.buffer, frames: frameCount }
  } finally {
    // Decoded frames hold GPU memory; a cancelled or failed export must not
    // strand them. Chromium warns loudly when a VideoFrame is collected
    // without being closed, and it stalls the decoder.
    screen.close()
    camera?.close()
  }
}

// ---------------------------------------------------------------------------
// Video helpers
// ---------------------------------------------------------------------------

function pickAvcCodec(width: number, height: number): string {
  const pixels = width * height
  // High profile; level chosen to cover the frame size.
  if (pixels > 2_100_000) return 'avc1.640033' // 5.1 — 4K
  if (pixels > 1_000_000) return 'avc1.640029' // 4.1 — 1440p
  return 'avc1.640028' // 4.0 — 1080p
}

function pickBitrate(
  width: number,
  height: number,
  fps: number,
  quality: 'good' | 'high' | 'max'
): number {
  const factor = quality === 'max' ? 0.19 : quality === 'high' ? 0.13 : 0.08
  return Math.round(Math.min(Math.max(width * height * fps * factor, 4_000_000), 90_000_000))
}

// ---------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------

interface MixedAudio {
  buffer: AudioBuffer
  sampleRate: number
}

/**
 * Mixes system audio (muxed into screen.mp4) with the microphone track from the
 * camera file, trimmed to the export range and offset-corrected.
 */
async function buildAudio(options: ExportOptions): Promise<MixedAudio | null> {
  const sampleRate = 48_000
  const duration = options.end - options.start
  const context = new AudioContext({ sampleRate })

  const decode = async (url: string): Promise<AudioBuffer | null> => {
    try {
      const response = await fetch(url)
      const data = await response.arrayBuffer()
      return await context.decodeAudioData(data)
    } catch {
      return null
    }
  }

  const system = await decode(options.screenURL)
  const mic = options.cameraURL ? await decode(options.cameraURL) : null
  await context.close()

  if (!system && !mic) return null

  const offline = new OfflineAudioContext(2, Math.ceil(duration * sampleRate), sampleRate)
  const gains = options.composition.project.audio

  if (system && gains.systemGain > 0) {
    const node = offline.createBufferSource()
    node.buffer = system
    const gain = offline.createGain()
    gain.gain.value = gains.systemGain
    node.connect(gain).connect(offline.destination)
    node.start(0, options.start, duration)
  }

  if (mic && gains.micGain > 0) {
    const node = offline.createBufferSource()
    node.buffer = mic
    const gain = offline.createGain()
    gain.gain.value = gains.micGain
    node.connect(gain).connect(offline.destination)
    // The camera file starts later than the screen track; skip into it by the
    // difference so speech lines up with what is on screen.
    const into = options.start - options.cameraOffset - options.cameraSync
    if (into >= 0) node.start(0, into, duration)
    else node.start(-into, 0, duration + into)
  }

  return { buffer: await offline.startRendering(), sampleRate }
}

async function encodeAudio(
  audio: MixedAudio,
  muxer: Muxer<ArrayBufferTarget>,
  signal?: AbortSignal
): Promise<void> {
  const { buffer, sampleRate } = audio
  const channels = 2

  const encoder = new AudioEncoder({
    output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
    error: (error) => console.error('audio encoder', error)
  })
  encoder.configure({
    codec: 'mp4a.40.2',
    sampleRate,
    numberOfChannels: channels,
    bitrate: 192_000
  })

  // Interleave into the layout AudioData expects.
  const left = buffer.getChannelData(0)
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left
  const chunkFrames = 4096

  for (let offset = 0; offset < buffer.length; offset += chunkFrames) {
    if (signal?.aborted) break
    const count = Math.min(chunkFrames, buffer.length - offset)
    const interleaved = new Float32Array(count * channels)
    for (let i = 0; i < count; i++) {
      interleaved[i * 2] = left[offset + i]
      interleaved[i * 2 + 1] = right[offset + i]
    }
    const data = new AudioData({
      format: 'f32',
      sampleRate,
      numberOfFrames: count,
      numberOfChannels: channels,
      timestamp: Math.round((offset / sampleRate) * 1_000_000),
      data: interleaved
    })
    encoder.encode(data)
    data.close()
    if (encoder.encodeQueueSize > 20) await new Promise((r) => setTimeout(r, 0))
  }

  await encoder.flush()
  encoder.close()
}
