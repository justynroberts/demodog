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
  Sources
} from '../shared/types'

/**
 * Thin wrapper around the `finscreen-recorder` Swift helper.
 *
 * The helper speaks one JSON object per line on stdout and accepts `stop` on
 * stdin. Everything screen-capture related lives on that side of the boundary;
 * this file only marshals.
 */

function helperPath(): string {
  // Packaged builds ship the binary in Resources; dev runs it from the repo.
  const packaged = join(process.resourcesPath ?? '', 'bin', 'finscreen-recorder')
  if (app.isPackaged && existsSync(packaged)) return packaged
  return join(app.getAppPath(), 'bin', 'finscreen-recorder')
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
    return 'Screen Recording permission has not been granted to FinScreen.'
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
    args.push('--audio', options.systemAudio ? '1' : '0')
    args.push('--keys', options.trackKeystrokes ? '1' : '0')
    args.push('--cursor', '0')
    // Our own windows — the control bar and camera bubble — must not appear in
    // the recording.
    args.push('--exclude-pids', String(process.pid))
    if (options.maxWidth) args.push('--max-width', String(options.maxWidth))

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
