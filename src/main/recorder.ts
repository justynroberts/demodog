// MIT License - Copyright (c) fintonlabs.com
import { spawn, spawnSync, ChildProcessWithoutNullStreams } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import { existsSync } from 'node:fs'
import type {
  CaptureMeta,
  Permissions,
  RawEvent,
  RecordOptions,
  RecordingResult,
  Sources,
  Cue
} from '../shared/types'

/**
 * Thin wrapper around the `demodog-recorder` Swift helper.
 *
 * The helper speaks one JSON object per line on stdout and accepts `stop` on
 * stdin. Everything screen-capture related lives on that side of the boundary;
 * this file only marshals.
 */

function helperPath(): string {
  // Packaged builds ship the binary in Resources; dev runs it from the repo.
  const packaged = join(process.resourcesPath ?? '', 'bin', 'demodog-recorder')
  if (app.isPackaged && existsSync(packaged)) return packaged
  return join(app.getAppPath(), 'bin', 'demodog-recorder')
}

/**
 * Kills helper processes left behind by a crash or a hard reload.
 *
 * This matters more than it looks: a stranded helper keeps its ScreenCaptureKit
 * connection open, and once one is stuck every subsequent `SCStream` dies
 * immediately with `failedApplicationConnectionInterrupted` (-3805). The app
 * then appears to be broken when the only real problem is a zombie.
 */
export function reapStrayHelpers(): void {
  try {
    // Synchronous on purpose: an async pkill races the next helper spawn and
    // kills the process it was meant to protect.
    spawnSync('pkill', ['-f', helperPath()], { stdio: 'ignore' })
  } catch {
    /* best effort */
  }
}

/** Turns the helper's error codes into something a person can act on. */
function describeError(message: string, code?: unknown, errorCode?: unknown): string {
  if (errorCode === -3805 || code === 'stream-stopped') {
    return (
      'Screen capture was interrupted by macOS. This usually means another ' +
      'recorder is holding the screen, or a previous capture did not shut down ' +
      'cleanly. Quit other screen recorders and try again.'
    )
  }
  if (code === 'no-permission') {
    return 'Screen Recording permission has not been granted to DemoDog.'
  }
  if (code === 'timeout') {
    return 'macOS did not respond to the capture request in time. Try again.'
  }
  return message
}

/**
 * Concurrent ScreenCaptureKit queries interfere with each other — two helpers
 * asking for shareable content at the same time can leave both hanging until
 * their watchdogs fire. React's StrictMode double-invokes effects in
 * development, so the renderer asks twice by default; single-flighting here
 * fixes it for every caller rather than papering over it in one component.
 */
const inFlight = new Map<string, Promise<Record<string, unknown>>>()

function runOnceShared(args: string[]): Promise<Record<string, unknown>> {
  const key = args.join(' ')
  const existing = inFlight.get(key)
  if (existing) return existing
  const promise = runOnce(args).finally(() => inFlight.delete(key))
  inFlight.set(key, promise)
  return promise
}

/** Runs a one-shot helper command and resolves with its final JSON line. */
function runOnce(args: string[]): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const child = spawn(helperPath(), args)
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.on('error', reject)
    child.on('close', () => {
      const lines = out.trim().split('\n').filter(Boolean)
      const last = lines[lines.length - 1]
      if (!last) return reject(new Error(err || 'recorder helper produced no output'))
      try {
        resolve(JSON.parse(last))
      } catch {
        reject(new Error(`unparseable helper output: ${last}`))
      }
    })
  })
}

/**
 * Raises a window by activating the app that owns it.
 *
 * Never throws: this is a convenience before recording, and failing to raise a
 * window is not a reason to refuse to record it.
 */
export async function focusWindow(windowId: number): Promise<boolean> {
  try {
    const result = await runOnce(['focus', '--window', String(windowId)])
    return result.event === 'focused' && result.raised === true
  } catch {
    return false
  }
}

export interface AudioProbe {
  path: string
  hasAudio: boolean
  duration?: number
  peakDb?: number
}

/** What a file's audio actually contains. Never throws; unknown reads as none. */
export async function probeAudio(path: string): Promise<AudioProbe> {
  try {
    const result = await runOnce(['probe', '--audio', path])
    return {
      path,
      hasAudio: result.hasAudio === true,
      duration: typeof result.duration === 'number' ? result.duration : undefined,
      peakDb: typeof result.peakDb === 'number' ? result.peakDb : undefined
    }
  } catch {
    return { path, hasAudio: false }
  }
}

/** What the speech recogniser can do here. Never throws. */
export async function speechCheck(locale: string): Promise<Record<string, unknown>> {
  try {
    return await runOnce(['speech-check', '--locale', locale])
  } catch (error) {
    return { event: 'speech', error: String(error) }
  }
}

export async function listSources(): Promise<Sources> {
  const result = await runOnceShared(['list'])
  if (result.event === 'error') {
    throw Object.assign(
      new Error(describeError(String(result.message), result.code, result.errorCode)),
      { code: result.code }
    )
  }
  return { displays: result.displays as never, windows: result.windows as never }
}

export async function checkPermissions(request = false): Promise<Permissions> {
  const args = request ? ['permissions', '--request'] : ['permissions']
  const result = await runOnceShared(args)
  return {
    screenRecording: Boolean(result.screenRecording),
    accessibility: Boolean(result.accessibility)
  }
}

/** Opens the exact System Settings pane for a grant the user needs to give. */
export function openPrivacySettings(
  kind: 'screen' | 'accessibility' | 'camera' | 'microphone'
): void {
  const panes = {
    screen: 'Privacy_ScreenCapture',
    accessibility: 'Privacy_Accessibility',
    camera: 'Privacy_Camera',
    microphone: 'Privacy_Microphone'
  }
  spawn('open', [`x-apple.systempreferences:com.apple.preference.security?${panes[kind]}`])
}

export class RecorderProcess {
  private child: ChildProcessWithoutNullStreams | null = null
  private dir: string
  private startedAt: { wallClock: number; host: number } | null = null
  private stopPromise: Promise<RecordingResult> | null = null

  constructor(dir: string) {
    this.dir = dir
  }

  get outputDir(): string {
    return this.dir
  }

  /** Resolves once the helper confirms the first frame is flowing. */
  start(
    options: RecordOptions
  ): Promise<{ width: number; height: number; startWallClock: number }> {
    const args = ['record', '--out', this.dir, '--fps', String(options.fps)]
    if (options.displayId !== undefined) args.push('--display', String(options.displayId))
    if (options.windowId !== undefined) args.push('--window', String(options.windowId))
    // The app the window belonged to when it was picked, so the helper can
    // refuse if that id has since come to mean something else.
    if (options.windowApp) args.push('--expect-app', options.windowApp)
    args.push('--audio', options.systemAudio ? '1' : '0')
    args.push('--keys', options.trackKeystrokes ? '1' : '0')
    args.push('--cursor', '0')
    // Our own windows — the control bar and camera bubble — must not appear in
    // the recording.
    args.push('--exclude-pids', String(process.pid))
    // Capped unless asked otherwise.
    //
    // Nothing set this, so a 5K display was captured at 5120x2880 and the
    // encoder asked for about 80 Mbit/s of H.264 at 60fps — which it cannot
    // sustain, so it silently refused frames. A report showed 437 arriving and
    // 273 written: 27fps from a capture asked for at 60, with nothing to say
    // so. 3840 is above every export size the app offers and leaves room to
    // zoom into, and displays narrower than it are untouched.
    args.push('--max-width', String(options.maxWidth ?? 3840))

    const child = spawn(helperPath(), args)
    this.child = child

    return new Promise((resolve, reject) => {
      let buffer = ''
      const onData = (chunk: Buffer): void => {
        buffer += chunk.toString()
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim()) continue
          let msg: Record<string, unknown>
          try {
            msg = JSON.parse(line)
          } catch {
            continue
          }
          if (msg.event === 'started') {
            this.startedAt = {
              wallClock: Number(msg.startWallClock),
              host: Number(msg.startHost)
            }
            resolve({
              width: Number(msg.width),
              height: Number(msg.height),
              startWallClock: Number(msg.startWallClock)
            })
          } else if (msg.event === 'error') {
            const text = describeError(String(msg.message), msg.code, msg.errorCode)
            // Errors arriving after a successful start belong to teardown, not
            // to this promise — reporting them as a start failure is misleading.
            if (this.startedAt) console.error('[recorder]', text)
            else reject(new Error(text))
          }
        }
      }
      child.stdout.on('data', onData)
      child.on('error', reject)
      child.on('close', (code) => {
        if (!this.startedAt) reject(new Error(`recorder exited with code ${code}`))
      })
    })
  }

  /**
   * Asks the helper to finalise. The movie header is only written during
   * teardown, so this must complete before the files are read.
   */
  stop(): Promise<RecordingResult> {
    if (this.stopPromise) return this.stopPromise
    const child = this.child
    if (!child) return Promise.reject(new Error('recorder is not running'))

    this.stopPromise = new Promise<RecordingResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill('SIGTERM')
      }, 10_000)

      child.on('close', async () => {
        clearTimeout(timeout)
        try {
          resolve(await this.collect())
        } catch (error) {
          reject(error)
        }
      })

      child.stdin.write('stop\n')
    })
    return this.stopPromise
  }

  /** Reads the finalised artefacts off disk into a single object. */
  private async collect(): Promise<RecordingResult> {
    const meta = JSON.parse(await readFile(join(this.dir, 'meta.json'), 'utf8')) as CaptureMeta
    const raw = await readFile(join(this.dir, 'events.jsonl'), 'utf8')
    const events: RawEvent[] = raw
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l))

    return {
      dir: this.dir,
      meta,
      events,
      screenPath: join(this.dir, 'screen.mp4'),
      duration: meta.duration
    }
  }
}

// ---------------------------------------------------------------------------
// Transcription
// ---------------------------------------------------------------------------

/**
 * Transcribes a take's narration, reporting progress as it goes.
 *
 * Deliberately not `runOnceShared`: this is minutes of work, not a query, and
 * it carries no watchdog. The first run for a locale waits on macOS to fetch an
 * on-device model, and killing it halfway leaves nothing to show for the wait.
 */
export function transcribe(
  audioPath: string,
  locale: string,
  onProgress: (fraction: number) => void
): Promise<Cue[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(helperPath(), ['transcribe', '--audio', audioPath, '--locale', locale])
    // Kept so a helper that dies can say why. Without it a crash in the helper
    // surfaced as an empty result and no explanation at all.
    let diagnostics = ''
    child.stderr.on('data', (chunk: Buffer) => {
      diagnostics += chunk.toString()
      if (diagnostics.length > 4000) diagnostics = diagnostics.slice(-4000)
    })
    const cues: Cue[] = []
    let buffered = ''
    let failure: Error | null = null

    child.stdout.on('data', (chunk: Buffer) => {
      buffered += chunk.toString()
      const lines = buffered.split('\n')
      buffered = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        let message: Record<string, unknown>
        try {
          message = JSON.parse(line)
        } catch {
          continue
        }
        if (message.event === 'cue') {
          cues.push({
            start: Number(message.start),
            end: Number(message.end),
            text: String(message.text),
            confidence: Number(message.confidence)
          })
        } else if (message.event === 'progress') {
          const of = Number(message.of)
          if (of > 0) onProgress(Math.min(1, Number(message.seconds) / of))
        } else if (message.event === 'installing') {
          // The first transcription in a language on macOS 26 downloads its
          // model, which is a real wait. Silence here reads as a hang.
          const percent = Number(message.fraction ?? 0) * 100
          console.log(`[transcribe] installing the language model (${percent.toFixed(0)}%)`)
        } else if (message.event === 'error') {
          failure = new Error(
            describeTranscribeError(String(message.code), String(message.message))
          )
        }
      }
    })

    child.on('error', reject)
    child.on('close', (code, signal) => {
      if (failure) {
        reject(failure)
      } else if (cues.length === 0 && (signal || (code !== 0 && code !== null))) {
        // Distinguish "heard nothing" from "died trying", which look identical
        // from the outside and need completely different responses.
        console.error(`[transcribe] helper exited ${signal ?? code}: ${diagnostics.trim()}`)
        reject(
          new Error(
            `Transcription stopped unexpectedly (${signal ?? `exit ${code}`}). ` +
              (diagnostics.trim() || 'No further detail was reported.')
          )
        )
      } else {
        resolve(cues)
      }
    })
  })
}

/** Turns a helper error code into something worth showing a person. */
function describeTranscribeError(code: string, message: string): string {
  switch (code) {
    case 'denied':
      return (
        'macOS has not granted DemoDog permission to recognise speech. ' +
        'Enable DemoDog under Privacy & Security → Speech Recognition.'
      )
    case 'no-on-device':
      return (
        'This Mac has no on-device speech model for that language. ' +
        'Add the language under System Settings → General → Language & Region, ' +
        'then try again. Transcription never uploads your recording.'
      )
    case 'unreadable':
      return (
        'No audio could be read from this take. The narration is recorded with ' +
        'the camera, so a take made without a microphone has nothing to transcribe.'
      )
    case 'missing':
      return 'That take has no audio to transcribe.'
    case 'empty':
      return 'The audio in that take is empty.'
    default:
      return message
  }
}
