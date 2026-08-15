// MIT License - Copyright (c) fintonlabs.com
import {
  app,
  BrowserWindow,
  ipcMain,
  protocol,
  net,
  dialog,
  shell,
  screen,
  globalShortcut
} from 'electron'
import { join, dirname } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { mkdir, writeFile, appendFile, readFile } from 'node:fs/promises'
import { createWriteStream, existsSync, WriteStream } from 'node:fs'
import {
  RecorderProcess,
  listSources,
  checkPermissions,
  openPrivacySettings,
  reapStrayHelpers
} from './recorder'
import type { RecordOptions, RecordingResult, CaptureMeta, RawEvent } from '../shared/types'

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

let studioWindow: BrowserWindow | null = null
let barWindow: BrowserWindow | null = null
let recorder: RecorderProcess | null = null
let cameraStream: WriteStream | null = null
let cameraMeta: { path: string; startWallClock: number; mimeType: string } | null = null

const isDev = !app.isPackaged

function rendererURL(hash: string): string {
  const devServer = process.env['ELECTRON_RENDERER_URL']
  if (isDev && devServer) return `${devServer}#${hash}`
  return `${pathToFileURL(join(__dirname, '../renderer/index.html')).toString()}#${hash}`
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
      sandbox: false
    }
  })

  // Benchmark runs are headless on purpose: they must not steal focus from
  // whatever else is on screen, including a real editing session.
  const headless = Boolean(process.env['DEMODOG_BENCH'])

  studioWindow.on('ready-to-show', () => {
    if (!headless) studioWindow?.show()
  })
  // If the renderer fails before first paint, `ready-to-show` never fires and
  // the app looks like it silently did nothing. Show it anyway.
  studioWindow.webContents.on('did-finish-load', () => {
    if (!headless) studioWindow?.show()
  })
  studioWindow.webContents.on('did-fail-load', (_e, code, description, url) => {
    console.error(`[renderer] failed to load ${url}: ${description} (${code})`)
    studioWindow?.show()
  })
  studioWindow.webContents.on('console-message', (_e, level, message, line, source) => {
    console.log(`[renderer:${level}] ${message} (${source}:${line})`)
  })
  studioWindow.webContents.on('render-process-gone', (_e, details) =>
    console.error('[renderer] gone', details)
  )
  studioWindow.on('closed', () => (studioWindow = null))
  studioWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
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
      sandbox: false
    }
  })

  // Sit above full-screen apps and follow the user across spaces, so the stop
  // control is always reachable mid-take.
  bar.setAlwaysOnTop(true, 'screen-saver')
  bar.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  bar.loadURL(rendererURL('/bar'))
  bar.on('closed', () => (barWindow = null))
  return bar
}

function recordingDir(): string {
  // Local time, not toISOString — a take recorded at 19:18 BST should not be
  // filed under 18:18.
  const now = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  const stamp =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`
  return join(app.getPath('videos'), 'DemoDog', `take_${stamp}`)
}

app.whenReady().then(() => {
  protocol.handle('rec', (request) => {
    // rec://local/<absolute path> — serve straight off disk, with the range
    // support that net.fetch gives us for free.
    const url = new URL(request.url)
    const filePath = decodeURIComponent(url.pathname)
    return net.fetch(pathToFileURL(filePath).toString(), {
      headers: request.headers,
      method: request.method
    })
  })

  // A helper stranded by a crash or a dev reload will break every later
  // capture, so clear them out before the first recording can be started.
  reapStrayHelpers()

  console.log(`[demodog] ready. DEMODOG_OPEN=${process.env['DEMODOG_OPEN'] ?? '(unset)'}`)

  createStudioWindow()

  globalShortcut.register('CommandOrControl+Shift+2', () => {
    if (recorder) barWindow?.webContents.send('bar:request-stop')
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createStudioWindow()
  })
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
ipcMain.handle('permissions:check', () => checkPermissions(false))
ipcMain.handle('permissions:request', () => checkPermissions(true))
ipcMain.handle('permissions:open', (_e, kind) => openPrivacySettings(kind))

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
    // The bar window owns camera and microphone capture, so it needs to know
    // which devices the user picked before the screen stream starts.
    barWindow.webContents.send('bar:prepare', {
      cameraDeviceId: options.cameraDeviceId,
      micDeviceId: options.micDeviceId
    })

    studioWindow?.hide()

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
  const path = join(recorder.outputDir, 'camera.webm')
  cameraStream = createWriteStream(path)
  cameraMeta = { path, startWallClock: info.startWallClock, mimeType: info.mimeType }
  // Persist the sync point so the take survives being reopened later.
  await writeFile(join(recorder.outputDir, 'camera.json'), JSON.stringify(cameraMeta, null, 2))
  return path
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
    return result.canceled ? null : result.filePath
  }
)

ipcMain.handle('file:write', async (_e, path: string, data: ArrayBuffer) => {
  await writeFile(path, Buffer.from(data))
  return path
})

ipcMain.handle('shell:reveal', (_e, path: string) => shell.showItemInFolder(path))
ipcMain.handle('shell:open-external', (_e, url: string) => shell.openExternal(url))

/** Loads a take directory from disk into the shape the editor expects. */
async function loadTake(dir: string): Promise<RecordingResult> {
  const meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8')) as CaptureMeta
  const events: RawEvent[] = (await readFile(join(dir, 'events.jsonl'), 'utf8'))
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l))

  // The camera sidecar carries the wall-clock start the editor needs to line
  // the two tracks up; without it a reopened take would lose its camera.
  let camera: RecordingResult['camera'] = null
  const cameraPath = join(dir, 'camera.webm')
  if (existsSync(cameraPath)) {
    try {
      const sidecar = JSON.parse(await readFile(join(dir, 'camera.json'), 'utf8'))
      camera = { ...sidecar, path: cameraPath }
    } catch {
      // No sidecar: assume it starts with the screen track.
      camera = { path: cameraPath, startWallClock: meta.startWallClock, mimeType: 'video/webm' }
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
    properties: ['openDirectory'],
    defaultPath: join(app.getPath('videos'), 'DemoDog'),
    title: 'Open a DemoDog take'
  })
  if (result.canceled || !result.filePaths[0]) return null
  return loadTake(result.filePaths[0])
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
    seconds: Number(process.env['DEMODOG_BENCH_SECONDS'] ?? '0') || 0
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

ipcMain.handle('bar:set-size', (event, height: number) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return
  const [w] = win.getSize()
  win.setSize(w, Math.round(height))
})
