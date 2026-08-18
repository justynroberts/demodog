// MIT License - Copyright (c) fintonlabs.com
import {
  app,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  protocol,
  net,
  dialog,
  session,
  shell,
  screen,
  clipboard,
  globalShortcut
} from 'electron'
import { dirname, join, resolve as resolvePath, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { setupUpdates } from './updater'
import { installMenu } from './menu'
import { clearQuarantine } from './quarantine'
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises'
import { createReadStream, createWriteStream, existsSync, WriteStream } from 'node:fs'
import { Readable } from 'node:stream'
import {
  RecorderProcess,
  listSources,
  checkPermissions,
  openPrivacySettings,
  reapStrayHelpers,
  transcribe
} from './recorder'
import type {
  RecordOptions,
  RecordingResult,
  CaptureMeta,
  RawEvent,
  Profile,
  CapturePreset
} from '../shared/types'

// `rec:` streams recording artefacts into the renderer. A privileged scheme is
// required so <video> can issue range requests against it for seeking.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'rec',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true
    }
  }
])

let splashWindow: BrowserWindow | null = null
let splashShownAt = 0
let studioWindow: BrowserWindow | null = null

/** Minimum time the splash stays up, so a fast launch does not flash it. */
const SPLASH_MIN_MS = 2600
let barWindow: BrowserWindow | null = null
let recorder: RecorderProcess | null = null
let cameraStream: WriteStream | null = null
let cameraMeta: { path: string; startWallClock: number; mimeType: string } | null = null

/**
 * Resolves once the control bar's renderer has loaded and registered its IPC
 * listeners.
 *
 * Without this, `webContents.send` fires into a window that has not finished
 * loading and the message is simply dropped — which silently cost the camera
 * track on the first recording of every app launch.
 */
let barReady: Promise<void> = Promise.resolve()
let markBarReady: () => void = () => {}

const isDev = !app.isPackaged

/**
 * Directories the `rec:` scheme is allowed to serve from.
 *
 * The scheme exists to stream a take's own media into the renderer. Without a
 * boundary it will serve *any* path the user can read, which turns any script
 * running in the renderer — an injected string, a compromised font host — into
 * an arbitrary file read. Seeded with the recordings folder and extended only
 * by paths the user has explicitly chosen through a dialog.
 */
const mediaRoots = new Set<string>()

function allowMediaPath(target: string): void {
  mediaRoots.add(resolvePath(target))
}

function isMediaPathAllowed(target: string): boolean {
  const candidate = resolvePath(target)
  for (const root of mediaRoots) {
    if (candidate === root || candidate.startsWith(root + sep)) return true
  }
  return false
}

/**
 * Paths the user picked in our own save dialog.
 *
 * `file:write` takes a path from the renderer, so without this it is an
 * arbitrary file write. Membership is consumed on use.
 */
const permittedWrites = new Set<string>()
/**
 * Folders the user picked a save location in.
 *
 * A sidecar — subtitles beside the video — is written after the export has
 * already consumed its one-shot permission, and reopening a save dialog to
 * place a file the user did not ask to be asked about is worse than useless.
 * Kept separate from `permittedWrites` so it can only ever authorise a sidecar
 * next to something already saved, never an arbitrary path.
 */
const permittedFolders = new Set<string>()

/**
 * The single door out to the OS.
 *
 * `shell.openExternal` will hand *any* scheme to macOS — `file:`, `smb:`,
 * `x-apple-…`, anything a helper app has registered — and several of those do
 * something on receipt rather than merely opening a window. So every route out
 * of the app funnels through here and nothing but the web gets through.
 *
 * There were two routes and only one check: the IPC handler validated, and the
 * window-open handler did not, which meant a `window.open` with any scheme at
 * all went straight past it.
 */
function openExternally(url: string): { action: 'deny' } {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { action: 'deny' }
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    console.warn(`[shell] refused to open ${parsed.protocol} URL`)
    return { action: 'deny' }
  }
  void shell.openExternal(parsed.toString())
  return { action: 'deny' }
}

function rendererURL(hash: string): string {
  const devServer = process.env['ELECTRON_RENDERER_URL']
  if (isDev && devServer) return `${devServer}#${hash}`
  return `${pathToFileURL(join(__dirname, '../renderer/index.html')).toString()}#${hash}`
}

/**
 * Brand splash shown while the studio window loads.
 *
 * Frameless and transparent so it reads as a card rather than a window, and
 * deliberately not focusable — it should never take a keystroke meant for
 * whatever the user was already doing.
 */
function createSplashWindow(): void {
  splashWindow = new BrowserWindow({
    width: 460,
    height: 320,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    center: true,
    skipTaskbar: true,
    focusable: false,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  splashWindow.once('ready-to-show', () => {
    splashShownAt = Date.now()
    splashWindow?.showInactive()
  })
  splashWindow.on('closed', () => (splashWindow = null))
  splashWindow.loadURL(rendererURL('/splash'))
}

/** Closes the splash once it has been up long enough to be read. */
function dismissSplash(): Promise<void> {
  if (!splashWindow) return Promise.resolve()
  const elapsed = Date.now() - (splashShownAt || Date.now())
  const wait = Math.max(0, SPLASH_MIN_MS - elapsed)
  return new Promise((resolve) => {
    setTimeout(() => {
      if (splashWindow && !splashWindow.isDestroyed()) splashWindow.destroy()
      splashWindow = null
      resolve()
    }, wait)
  })
}

function createStudioWindow(): void {
  studioWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    backgroundColor: '#0d0d0f',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 22 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // The preload only uses contextBridge and ipcRenderer, both of which
      // work in a sandboxed renderer.
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // An export is minutes of work that must survive the user switching
      // away. Chromium clamps timers in a hidden window to about one a second,
      // and both the decode read loop and the encoder's backpressure yield are
      // built on short timers — so throttling does not slow an export down, it
      // stops it. This is also why the headless benchmark could not measure
      // anything real.
      backgroundThrottling: false
    }
  })

  // Benchmark runs are headless on purpose: they must not steal focus from
  // whatever else is on screen, including a real editing session.
  const headless = Boolean(process.env['DEMODOG_BENCH'])

  // Hold the studio back until the splash has had its moment, then swap.
  const reveal = async (): Promise<void> => {
    if (headless) return
    await dismissSplash()
    studioWindow?.show()
  }

  studioWindow.on('ready-to-show', () => void reveal())
  studioWindow.webContents.once('did-finish-load', () => {
    if (pendingOpen) {
      const path = pendingOpen
      pendingOpen = null
      void deliverTake(path)
    }
  })
  // If the renderer fails before first paint, `ready-to-show` never fires and
  // the app looks like it silently did nothing. Show it anyway.
  studioWindow.webContents.on('did-finish-load', () => void reveal())
  studioWindow.webContents.on('did-fail-load', (_e, code, description, url) => {
    console.error(`[renderer] failed to load ${url}: ${description} (${code})`)
    void dismissSplash().then(() => studioWindow?.show())
  })
  studioWindow.webContents.on('console-message', (_e, level, message, line, source) => {
    console.log(`[renderer:${level}] ${message} (${source}:${line})`)
  })
  studioWindow.webContents.on('render-process-gone', (_e, details) =>
    console.error('[renderer] gone', details)
  )
  studioWindow.on('closed', () => (studioWindow = null))
  studioWindow.webContents.setWindowOpenHandler(({ url }) => openExternally(url))
  studioWindow.loadURL(rendererURL('/studio'))
}

/**
 * The floating control bar shown while recording. It also owns the camera and
 * microphone capture, because it is the one renderer guaranteed to be alive for
 * the whole take.
 */
function createBarWindow(): BrowserWindow {
  const display = screen.getPrimaryDisplay()
  const width = 520
  const height = 132
  barReady = new Promise<void>((resolve) => {
    markBarReady = resolve
  })

  const bar = new BrowserWindow({
    width,
    height,
    x: Math.round(display.workArea.x + (display.workArea.width - width) / 2),
    y: Math.round(display.workArea.y + display.workArea.height - height - 28),
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: true,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // The preload only uses contextBridge and ipcRenderer, both of which
      // work in a sandboxed renderer.
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // Sit above full-screen apps and follow the user across spaces, so the stop
  // control is always reachable mid-take.
  bar.setAlwaysOnTop(true, 'screen-saver')
  bar.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  bar.loadURL(rendererURL('/bar'))
  bar.on('closed', () => {
    barWindow = null
    barReady = Promise.resolve()
  })
  return bar
}

/**
 * Full-screen 3-2-1 countdown shown on the display about to be recorded.
 *
 * It lives in its own transparent, click-through window so it floats over
 * whatever the user is about to demonstrate. Capture only starts once this has
 * finished, so it can never appear in the recording.
 */
async function runCountdown(seconds: number, displayId?: number): Promise<void> {
  if (seconds <= 0) return

  const target =
    (displayId !== undefined ? screen.getAllDisplays().find((d) => d.id === displayId) : null) ??
    screen.getPrimaryDisplay()
  const bounds = target.bounds

  const win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    focusable: false,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // Never intercept clicks — the user may want to arrange things while it runs.
  win.setIgnoreMouseEvents(true)
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.loadURL(rendererURL(`/countdown?n=${seconds}`))
  win.once('ready-to-show', () => win.showInactive())

  // A little tail so the final "1" is not cut off mid-animation.
  await new Promise((resolve) => setTimeout(resolve, seconds * 1000 + 250))
  if (!win.isDestroyed()) win.destroy()
}

/**
 * Takes are directories, but macOS can present a directory with a registered
 * extension as a single document — a package. That gives them an icon, one
 * double-clickable item in Finder, and something the open dialog can filter on,
 * without changing the fact that a take is several files.
 */
const TAKE_EXTENSION = 'demodog'

function recordingDir(): string {
  // Local time, not toISOString — a take recorded at 19:18 BST should not be
  // filed under 18:18.
  const now = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  const stamp =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`
  return join(app.getPath('videos'), 'DemoDog', `take_${stamp}.${TAKE_EXTENSION}`)
}

app.whenReady().then(() => {
  // Everything DemoDog records lives here, so this is the default boundary.
  allowMediaPath(join(app.getPath('videos'), 'DemoDog'))

  protocol.handle('rec', async (request) => {
    // rec://local/<absolute path> — served off disk, from an allowed root only.
    //
    // Byte ranges are served here rather than delegated. Handing the file to
    // `net.fetch` returns the whole thing with a 200, and a <video> given a 200
    // decides the stream is not seekable: `seekable.end(0)` stays at zero,
    // every assignment to `currentTime` is refused, and the element sits at the
    // first frame forever. Playback still works, because playing forwards is
    // just reading — which is why this looked like a scrubbing bug rather than
    // a transport one, and why clicking the timeline appeared to rewind.
    const url = new URL(request.url)
    const filePath = decodeURIComponent(url.pathname)
    if (!isMediaPathAllowed(filePath)) {
      console.warn(`[rec] refused ${filePath}: outside the permitted media roots`)
      return new Response('Forbidden', { status: 403 })
    }

    let size: number
    try {
      size = (await stat(filePath)).size
    } catch {
      return new Response('Not found', { status: 404 })
    }

    const type = filePath.endsWith('.webm')
      ? 'video/webm'
      : filePath.endsWith('.mp4')
        ? 'video/mp4'
        : 'application/octet-stream'

    const asStream = (start: number, end: number): ReadableStream =>
      Readable.toWeb(createReadStream(filePath, { start, end })) as ReadableStream

    const range = request.headers.get('Range')
    const match = range?.match(/bytes=(\d*)-(\d*)/)
    if (!match) {
      return new Response(asStream(0, size - 1), {
        status: 200,
        headers: {
          'Content-Type': type,
          'Content-Length': String(size),
          // Says the file can be seeked at all; without it the element does
          // not even ask for a range.
          'Accept-Ranges': 'bytes'
        }
      })
    }

    const start = match[1] ? Number(match[1]) : 0
    const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1
    if (!Number.isFinite(start) || start >= size || end < start) {
      return new Response('Range not satisfiable', {
        status: 416,
        headers: { 'Content-Range': `bytes */${size}` }
      })
    }

    return new Response(asStream(start, end), {
      status: 206,
      headers: {
        'Content-Type': type,
        'Content-Length': String(end - start + 1),
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Accept-Ranges': 'bytes'
      }
    })
  })

  // Lock the packaged renderer down. This is not applied in development
  // because Vite's dev server needs inline scripts and a websocket.
  if (app.isPackaged) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            [
              "default-src 'self'",
              "script-src 'self'",
              // React and this app both set style attributes directly.
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' https://fonts.gstatic.com",
              "img-src 'self' data: blob: rec:",
              "media-src 'self' blob: rec:",
              "connect-src 'self' data: blob: rec:",
              "object-src 'none'",
              "base-uri 'none'",
              "frame-src 'none'"
            ].join('; ')
          ]
        }
      })
    })
  }

  // A helper stranded by a crash or a dev reload will break every later
  // capture, so clear them out before the first recording can be started.
  reapStrayHelpers()

  console.log(`[demodog] ready. DEMODOG_OPEN=${process.env['DEMODOG_OPEN'] ?? '(unset)'}`)

  if (!process.env['DEMODOG_BENCH']) createSplashWindow()
  createStudioWindow()

  // Before anything tries to update: a quarantined bundle cannot launch the
  // installer, and the failure is invisible from inside the app.
  clearQuarantine()

  installMenu(() => studioWindow)

  // Never while a take is in progress: an update dialog stealing focus would be
  // captured into the recording.
  if (studioWindow) setupUpdates(studioWindow, () => Boolean(recorder))

  globalShortcut.register('CommandOrControl+Shift+2', () => {
    if (recorder) barWindow?.webContents.send('bar:request-stop')
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createStudioWindow()
  })
})

/**
 * Opening a take from Finder. The event can arrive before the window exists, so
 * the path is held until the studio is ready to receive it.
 */
let pendingOpen: string | null = null

async function deliverTake(path: string): Promise<void> {
  try {
    const take = await loadTake(path)
    studioWindow?.webContents.send('recording:opened', take)
    studioWindow?.show()
    studioWindow?.focus()
  } catch (error) {
    console.error('[open-file]', error)
    dialog.showErrorBox('Could not open take', `${path} does not look like a DemoDog take.`)
  }
}

app.on('open-file', (event, path) => {
  event.preventDefault()
  if (studioWindow && !studioWindow.webContents.isLoading()) void deliverTake(path)
  else pendingOpen = path
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  // Never leave a capture running after the app is gone.
  reapStrayHelpers()
})

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

ipcMain.handle('sources:list', () => listSources())
/**
 * Preview images for the source picker.
 *
 * These come from Electron's desktopCapturer rather than our Swift helper,
 * which has no one-shot screenshot mode. The ids differ between the two, so
 * they are matched back: screen sources carry `display_id`, and a macOS window
 * source id is `window:<CGWindowID>:0`.
 */
ipcMain.handle('sources:thumbnails', async () => {
  const displays: Record<string, string> = {}
  const windows: Record<string, string> = {}
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 480, height: 300 },
      fetchWindowIcons: false
    })
    for (const source of sources) {
      if (source.thumbnail.isEmpty()) continue
      const dataURL = source.thumbnail.toDataURL()
      if (source.id.startsWith('screen:')) {
        if (source.display_id) displays[source.display_id] = dataURL
      } else {
        const id = source.id.split(':')[1]
        if (id) windows[id] = dataURL
      }
    }
  } catch (error) {
    console.error('[thumbnails]', error)
  }
  return { displays, windows }
})

ipcMain.handle('permissions:check', () => checkPermissions(false))
ipcMain.handle('permissions:request', () => checkPermissions(true))
ipcMain.handle('permissions:open', (_e, kind) => openPrivacySettings(kind))

/**
 * Transcribes a take. The narration is in the camera track, because the mic and
 * camera share one recorder; system audio is in the screen track and is the
 * fallback when nobody spoke into a microphone.
 */
ipcMain.handle('transcribe:run', async (event, dir: string, locale: string) => {
  const spoken = ['camera.mp4', 'camera.webm', 'screen.mp4']
    .map((name) => join(dir, name))
    .find((candidate) => existsSync(candidate))
  if (!spoken) throw new Error('That take has no audio to transcribe.')

  // Deliberately does *not* widen the `rec:` roots. Transcribing reads the
  // audio here in the main process and returns text; the renderer never streams
  // anything as a result of it. Allowing the directory was granting a read
  // permission for a read that never happens — and the directory comes from the
  // renderer, so it was the one place the media boundary could be pushed
  // outwards without the user having chosen anything in a dialog.
  const cues = await transcribe(spoken, locale, (fraction) => {
    event.sender.send('transcribe:progress', fraction)
  })
  // Which track the words came from decides what the times mean. Narration
  // lives in the camera recording, which starts after the screen track, so its
  // timestamps are ahead of the editor's timeline by exactly that much — the
  // captions were landing early by the camera offset on every take.
  return { cues, source: spoken.includes('camera.') ? 'camera' : 'screen' }
})

// macOS reads an app's screen-recording grant when it starts, so a permission
// granted while DemoDog is running does not take effect until it restarts.
// Telling someone to quit and reopen is a poor substitute for doing it.
ipcMain.handle('app:relaunch', () => {
  app.relaunch()
  app.exit(0)
})

ipcMain.handle(
  'recording:start',
  async (
    _e,
    options: RecordOptions & { cameraDeviceId: string | null; micDeviceId: string | null }
  ) => {
    if (recorder) throw new Error('a recording is already running')

    const dir = recordingDir()
    await mkdir(dir, { recursive: true })

    recorder = new RecorderProcess(dir)

    barWindow ??= createBarWindow()
    barWindow.showInactive()

    // Wait for the bar to be listening before talking to it. The timeout is a
    // backstop: a recording without a camera preview beats no recording.
    await Promise.race([barReady, new Promise((r) => setTimeout(r, 5000))])

    // The bar window owns camera and microphone capture, so it needs to know
    // which devices the user picked before the screen stream starts.
    barWindow.webContents.send('bar:prepare', {
      cameraDeviceId: options.cameraDeviceId,
      micDeviceId: options.micDeviceId
    })

    studioWindow?.hide()

    // Count down *after* the camera has been acquired, so the device is warm
    // and the take starts the instant the counter hits zero.
    await runCountdown(options.countdown ?? 0, options.displayId)

    try {
      const info = await recorder.start(options)
      barWindow.webContents.send('bar:started', info)
      return info
    } catch (error) {
      recorder = null
      barWindow?.hide()
      studioWindow?.show()
      throw error
    }
  }
)

ipcMain.handle(
  'recording:stop',
  async (): Promise<RecordingResult & { camera: typeof cameraMeta }> => {
    if (!recorder) throw new Error('no recording is running')
    const active = recorder
    recorder = null

    const result = await active.stop()

    // Flush the camera file before the editor tries to open it.
    if (cameraStream) {
      await new Promise<void>((resolve) => cameraStream!.end(resolve))
      cameraStream = null
    }

    barWindow?.hide()
    studioWindow?.show()
    studioWindow?.focus()

    const payload = { ...result, camera: cameraMeta }
    cameraMeta = null
    studioWindow?.webContents.send('recording:complete', payload)
    return payload
  }
)

ipcMain.handle('recording:cancel', async () => {
  if (!recorder) return
  const active = recorder
  recorder = null
  await active.stop().catch(() => undefined)
  if (cameraStream) {
    await new Promise<void>((resolve) => cameraStream!.end(resolve))
    cameraStream = null
  }
  cameraMeta = null
  barWindow?.hide()
  studioWindow?.show()
})

// Camera arrives as MediaRecorder chunks and is appended as it goes, so a long
// take never has to be held in memory.
ipcMain.handle('camera:open', async (_e, info: { startWallClock: number; mimeType: string }) => {
  if (!recorder) throw new Error('no recording is running')
  const extension = info.mimeType.startsWith('video/mp4') ? 'mp4' : 'webm'
  const path = join(recorder.outputDir, `camera.${extension}`)
  cameraStream = createWriteStream(path)
  cameraMeta = { path, startWallClock: info.startWallClock, mimeType: info.mimeType }
  // Persist the sync point so the take survives being reopened later.
  await writeFile(join(recorder.outputDir, 'camera.json'), JSON.stringify(cameraMeta, null, 2))
  return path
})

/**
 * Corrects the camera's sync point once recording has actually begun.
 *
 * `camera:open` has to be stamped before the file exists, which puts an IPC
 * round trip, a file creation and the construction of a MediaRecorder between
 * the timestamp and the first frame it captures. Every one of those makes the
 * camera look earlier than it really is, and the error shows up as lip sync
 * being out by a fixed amount for the whole take. MediaRecorder's `start` event
 * fires when capture is genuinely under way, which is far closer to the truth.
 */
ipcMain.handle('camera:started', async (_e, startWallClock: number) => {
  if (!recorder || !cameraMeta) return
  cameraMeta = { ...cameraMeta, startWallClock }
  await writeFile(join(recorder.outputDir, 'camera.json'), JSON.stringify(cameraMeta, null, 2))
})

ipcMain.on('camera:chunk', (_e, chunk: ArrayBuffer) => {
  cameraStream?.write(Buffer.from(chunk))
})

ipcMain.handle(
  'dialog:save',
  async (_e, options: { defaultPath: string; filters?: Electron.FileFilter[] }) => {
    const result = await dialog.showSaveDialog(studioWindow!, {
      defaultPath: options.defaultPath,
      filters: options.filters
    })
    if (result.canceled || !result.filePath) return null
    permittedWrites.add(resolvePath(result.filePath))
    // The chosen folder, so a subtitle file can be written next to the video
    // later without reopening a dialog. Files only, and only in this folder.
    permittedFolders.add(dirname(resolvePath(result.filePath)))
    return result.filePath
  }
)

ipcMain.handle('file:write', async (_e, path: string, data: ArrayBuffer) => {
  // Only ever write somewhere the user chose in our own save dialog.
  const target = resolvePath(path)
  if (!permittedWrites.has(target)) {
    throw new Error('refusing to write to a path the user did not choose')
  }
  permittedWrites.delete(target)
  await writeFile(target, Buffer.from(data))
  return target
})

ipcMain.handle('app:version', () => app.getVersion())
ipcMain.handle('shell:reveal', (_e, path: string) => shell.showItemInFolder(path))

/**
 * Hands a finished export to YouTube.
 *
 * Deliberately a handoff rather than an upload. Uploading through the API needs
 * a verified OAuth project, and until one is verified every video it uploads is
 * locked to private with no appeal — a feature that appears to work and
 * quietly ruins the result is worse than no feature. So: write the subtitles
 * next to the video, put the title on the clipboard, open the upload page, and
 * show the file in Finder ready to drag.
 */
ipcMain.handle(
  'publish:youtube',
  async (
    _e,
    payload: { videoPath: string; title: string; description: string; subtitles: string }
  ) => {
    const written: string[] = []

    if (payload.subtitles.trim()) {
      // Beside the video and named after it, which is what every uploader
      // expects and what makes the pair obvious in Finder.
      const srt = resolvePath(payload.videoPath.replace(/\.mp4$/i, '') + '.srt')
      // Not being able to write the subtitles must not stop the handoff. The
      // video is the point; the captions are an improvement on it, and failing
      // the whole action over them would leave a button that appears dead.
      if (permittedFolders.has(dirname(srt))) {
        try {
          await writeFile(srt, payload.subtitles, 'utf8')
          written.push(srt)
        } catch (error) {
          console.warn(`[publish] could not write subtitles: ${String(error)}`)
        }
      }
    }

    // The upload page cannot be pre-filled from a URL, so the title goes to the
    // clipboard instead — one paste rather than retyping it.
    clipboard.writeText(
      payload.description.trim() ? `${payload.title}\n\n${payload.description}` : payload.title
    )

    await shell.openExternal('https://studio.youtube.com/channel/upload')
    shell.showItemInFolder(payload.videoPath)
    return written
  }
)
ipcMain.handle('shell:open-external', (_e, url: string) => {
  openExternally(url)
})

/** Loads a take directory from disk into the shape the editor expects. */
async function loadTake(dir: string): Promise<RecordingResult> {
  // Opened deliberately by the user, so its media may be streamed.
  allowMediaPath(dir)
  const meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8')) as CaptureMeta
  // A recording that was stopped before the first frame leaves a take with no
  // geometry and no duration. It is not editable, and opening one used to throw
  // inside the editor, which surfaced as the app simply doing nothing.
  if (!meta.capture?.width || !meta.duration) {
    throw new Error('That take has no recorded video — it was stopped before capture started.')
  }
  const events: RawEvent[] = (await readFile(join(dir, 'events.jsonl'), 'utf8'))
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l))

  // The camera sidecar carries the wall-clock start the editor needs to line
  // the two tracks up; without it a reopened take would lose its camera.
  // Older takes recorded WebM; newer ones record MP4.
  let camera: RecordingResult['camera'] = null
  const cameraPath = ['camera.mp4', 'camera.webm']
    .map((name) => join(dir, name))
    .find((candidate) => existsSync(candidate))
  if (cameraPath) {
    try {
      const sidecar = JSON.parse(await readFile(join(dir, 'camera.json'), 'utf8'))
      camera = { ...sidecar, path: cameraPath }
    } catch {
      // No sidecar: assume it starts with the screen track.
      camera = { path: cameraPath, startWallClock: meta.startWallClock, mimeType: 'video/mp4' }
    }
  }

  return {
    dir,
    meta,
    events,
    screenPath: join(dir, 'screen.mp4'),
    duration: meta.duration,
    camera
  }
}

/** Re-opens a take from disk so the editor can be reloaded on a later launch. */
ipcMain.handle('recording:open', async (): Promise<RecordingResult | null> => {
  const result = await dialog.showOpenDialog(studioWindow!, {
    // Both, deliberately: new takes are packages and behave like files, while
    // takes recorded before the extension existed are plain directories.
    properties: ['openFile', 'openDirectory'],
    filters: [{ name: 'DemoDog take', extensions: [TAKE_EXTENSION] }],
    defaultPath: join(app.getPath('videos'), 'DemoDog'),
    title: 'Open a DemoDog take'
  })
  if (result.canceled || !result.filePaths[0]) return null
  try {
    return await loadTake(result.filePaths[0])
  } catch (error) {
    // Reported here rather than thrown across IPC: an unhandled rejection in
    // the renderer is invisible, and the user is left looking at a dialog that
    // closed and did nothing.
    await dialog.showMessageBox(studioWindow!, {
      type: 'warning',
      message: 'That take could not be opened',
      detail: error instanceof Error ? error.message : String(error),
      buttons: ['OK']
    })
    return null
  }
})

/**
 * Jumps straight into the editor with a given take. Set DEMODOG_OPEN to a
 * take directory to skip the recorder while working on the editor — the
 * fixture in scripts/make-fixture.mjs is what this is for.
 */
/**
 * Headless export benchmark. Set DEMODOG_BENCH to a take directory and
 * DEMODOG_BENCH_OUT to a file path; the app exports it without showing a
 * window or a save dialog, prints the timing breakdown, and quits.
 *
 * This exists because timing an export by driving the real UI is unreliable —
 * it competes for focus with whatever the user is actually doing.
 */
ipcMain.handle('bench:config', () => {
  const dir = process.env['DEMODOG_BENCH']
  if (!dir) return null
  return {
    dir,
    out: process.env['DEMODOG_BENCH_OUT'] ?? join(dir, 'bench.mp4'),
    // Cap the exported duration so a benchmark can report a rate quickly.
    seconds: Number(process.env['DEMODOG_BENCH_SECONDS'] ?? '0') || 0,
    // Export with no zoom, cursor or picture-in-picture, so the only thing that
    // can change between frames is the recording itself.
    plain: process.env['DEMODOG_BENCH_PLAIN'] === '1'
  }
})

ipcMain.handle('bench:finish', async (_e, path: string, data: ArrayBuffer) => {
  await writeFile(path, Buffer.from(data))
  console.log(`[bench] wrote ${path} (${data.byteLength} bytes)`)
  app.quit()
})

ipcMain.handle('bench:fail', (_e, message: string) => {
  console.error(`[bench] failed: ${message}`)
  app.exit(1)
})

ipcMain.handle('recording:autoload', async (): Promise<RecordingResult | null> => {
  const dir = process.env['DEMODOG_BENCH'] ?? process.env['DEMODOG_OPEN']
  if (!dir) return null
  return loadTake(dir).catch((error) => {
    console.error('[autoload]', error)
    return null
  })
})

ipcMain.on('bar:ready', () => markBarReady())

/** Lets the user pick a still image to use as a video background. */
ipcMain.handle('dialog:image', async (): Promise<string | null> => {
  const result = await dialog.showOpenDialog(studioWindow!, {
    properties: ['openFile'],
    title: 'Choose a background image',
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'heic', 'gif'] }]
  })
  if (result.canceled || !result.filePaths[0]) return null
  // Picked deliberately by the user, so it may be loaded as a background.
  allowMediaPath(result.filePaths[0])
  return result.filePaths[0]
})

// --- Profiles: named look-and-feel presets, stored beside the app's data ----

function profilesPath(): string {
  return join(app.getPath('userData'), 'profiles.json')
}

async function readProfiles(): Promise<Profile[]> {
  try {
    return JSON.parse(await readFile(profilesPath(), 'utf8')) as Profile[]
  } catch {
    return []
  }
}

ipcMain.handle('profiles:list', () => readProfiles())

// --- Capture presets: the recording setup, saved for next time ---------------

function presetsPath(): string {
  return join(app.getPath('userData'), 'capture-presets.json')
}

async function readPresets(): Promise<CapturePreset[]> {
  try {
    return JSON.parse(await readFile(presetsPath(), 'utf8')) as CapturePreset[]
  } catch {
    return []
  }
}

ipcMain.handle('presets:list', () => readPresets())

ipcMain.handle('presets:save', async (_e, preset: CapturePreset): Promise<CapturePreset[]> => {
  const presets = await readPresets()
  const index = presets.findIndex((p) => p.id === preset.id)
  const next = preset.isDefault ? presets.map((p) => ({ ...p, isDefault: false })) : [...presets]
  if (index >= 0) next[index] = preset
  else next.push(preset)
  await writeFile(presetsPath(), JSON.stringify(next, null, 2))
  return next
})

ipcMain.handle('presets:delete', async (_e, id: string): Promise<CapturePreset[]> => {
  const next = (await readPresets()).filter((p) => p.id !== id)
  await writeFile(presetsPath(), JSON.stringify(next, null, 2))
  return next
})

ipcMain.handle('profiles:save', async (_e, profile: Profile): Promise<Profile[]> => {
  const profiles = await readProfiles()
  const index = profiles.findIndex((p) => p.id === profile.id)
  // Only one default at a time, or applying them becomes ambiguous.
  const next = profile.isDefault ? profiles.map((p) => ({ ...p, isDefault: false })) : [...profiles]
  if (index >= 0) next[index] = profile
  else next.push(profile)
  await writeFile(profilesPath(), JSON.stringify(next, null, 2))
  return next
})

ipcMain.handle('profiles:delete', async (_e, id: string): Promise<Profile[]> => {
  const next = (await readProfiles()).filter((p) => p.id !== id)
  await writeFile(profilesPath(), JSON.stringify(next, null, 2))
  return next
})

ipcMain.handle('bar:set-size', (event, height: number) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return
  const [w] = win.getSize()
  win.setSize(w, Math.round(height))
})
