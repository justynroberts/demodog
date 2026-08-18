// MIT License - Copyright (c) fintonlabs.com
import { contextBridge, ipcRenderer } from 'electron'
import type {
  CapturePreset,
  Cue,
  Permissions,
  Profile,
  RecordOptions,
  RecordingResult,
  Sources
} from '../shared/types'

export interface CameraInfo {
  path: string
  startWallClock: number
  mimeType: string
}

export type CompleteRecording = RecordingResult & { camera: CameraInfo | null }

const api = {
  listSources: (): Promise<Sources> => ipcRenderer.invoke('sources:list'),
  /** Live preview images for the source picker, keyed to the ids above. */
  sourceThumbnails: (): Promise<{
    displays: Record<string, string>
    windows: Record<string, string>
  }> => ipcRenderer.invoke('sources:thumbnails'),
  checkPermissions: (): Promise<Permissions> => ipcRenderer.invoke('permissions:check'),
  requestPermissions: (): Promise<Permissions> => ipcRenderer.invoke('permissions:request'),
  /** Transcribes a take's narration on this Mac. Never uploads anything. */
  transcribe: (
    dir: string,
    locale: string
  ): Promise<{ cues: Cue[]; source: 'camera' | 'screen' }> =>
    ipcRenderer.invoke('transcribe:run', dir, locale),
  onTranscribeProgress: (handler: (fraction: number) => void): (() => void) => {
    const listener = (_e: unknown, fraction: number): void => handler(fraction)
    ipcRenderer.on('transcribe:progress', listener)
    return () => ipcRenderer.removeListener('transcribe:progress', listener)
  },

  /** Restart, so macOS re-reads a permission granted while we were running. */
  relaunch: (): Promise<void> => ipcRenderer.invoke('app:relaunch'),
  openPrivacySettings: (
    kind: 'screen' | 'accessibility' | 'camera' | 'microphone'
  ): Promise<void> => ipcRenderer.invoke('permissions:open', kind),

  startRecording: (
    options: RecordOptions & { cameraDeviceId: string | null; micDeviceId: string | null }
  ): Promise<{ width: number; height: number; startWallClock: number }> =>
    ipcRenderer.invoke('recording:start', options),
  stopRecording: (): Promise<CompleteRecording> => ipcRenderer.invoke('recording:stop'),
  cancelRecording: (): Promise<void> => ipcRenderer.invoke('recording:cancel'),
  openRecording: (): Promise<RecordingResult | null> => ipcRenderer.invoke('recording:open'),
  autoloadRecording: (): Promise<RecordingResult | null> =>
    ipcRenderer.invoke('recording:autoload'),

  /** Headless export benchmark; null unless DEMODOG_BENCH is set. */
  benchConfig: (): Promise<{
    dir: string
    out: string
    seconds: number
    plain: boolean
  } | null> => ipcRenderer.invoke('bench:config'),
  benchFinish: (path: string, data: ArrayBuffer): Promise<void> =>
    ipcRenderer.invoke('bench:finish', path, data),
  benchFail: (message: string): Promise<void> => ipcRenderer.invoke('bench:fail', message),

  openCameraFile: (info: { startWallClock: number; mimeType: string }): Promise<string> =>
    ipcRenderer.invoke('camera:open', info),
  /** The moment capture actually began, which `camera:open` cannot know. */
  cameraStarted: (startWallClock: number): Promise<void> =>
    ipcRenderer.invoke('camera:started', startWallClock),
  writeCameraChunk: (chunk: ArrayBuffer): void => ipcRenderer.send('camera:chunk', chunk),

  saveDialog: (options: {
    defaultPath: string
    filters?: { name: string; extensions: string[] }[]
  }): Promise<string | null> => ipcRenderer.invoke('dialog:save', options),
  writeFile: (path: string, data: ArrayBuffer): Promise<string> =>
    ipcRenderer.invoke('file:write', path, data),
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),
  reveal: (path: string): Promise<void> => ipcRenderer.invoke('shell:reveal', path),

  /** Writes subtitles beside the video, copies the title, opens YouTube. */
  publishToYouTube: (payload: {
    videoPath: string
    title: string
    description: string
    subtitles: string
  }): Promise<string[]> => ipcRenderer.invoke('publish:youtube', payload),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:open-external', url),

  /** Brings the window about to be recorded to the front. */
  focusWindow: (windowId: number): Promise<boolean> =>
    ipcRenderer.invoke('source:focus', windowId),

  pickImage: (): Promise<string | null> => ipcRenderer.invoke('dialog:image'),

  /**
   * A named event, with numeric parameters only.
   *
   * Nothing the user typed or chose goes through here — no paths, no titles,
   * no caption text. The main process rejects anything that is not a finite
   * number, so widening this by accident is not a one-line mistake.
   */
  track: (name: string, params?: Record<string, number>): Promise<void> =>
    ipcRenderer.invoke('analytics:event', name, params),
  /** Builds a diagnostics zip, reveals it, and opens a pre-filled mail. */
  reportBug: (note: string): Promise<string> => ipcRenderer.invoke('report:bug', note),

  analyticsEnabled: (): Promise<boolean> => ipcRenderer.invoke('analytics:enabled'),
  setAnalyticsEnabled: (enabled: boolean): Promise<boolean> =>
    ipcRenderer.invoke('analytics:set-enabled', enabled),

  listPresets: (): Promise<CapturePreset[]> => ipcRenderer.invoke('presets:list'),
  savePreset: (preset: CapturePreset): Promise<CapturePreset[]> =>
    ipcRenderer.invoke('presets:save', preset),
  deletePreset: (id: string): Promise<CapturePreset[]> => ipcRenderer.invoke('presets:delete', id),

  listProfiles: (): Promise<Profile[]> => ipcRenderer.invoke('profiles:list'),
  saveProfile: (profile: Profile): Promise<Profile[]> =>
    ipcRenderer.invoke('profiles:save', profile),
  deleteProfile: (id: string): Promise<Profile[]> => ipcRenderer.invoke('profiles:delete', id),

  /** Told to the main process once the bar's listeners are registered. */
  announceBarReady: (): void => ipcRenderer.send('bar:ready'),

  setBarHeight: (height: number): Promise<void> => ipcRenderer.invoke('bar:set-size', height),

  /** Turns an absolute path into a URL the renderer can load media from. */
  mediaURL: (path: string): string => `rec://local${encodeURI(path)}`,

  on: (channel: string, listener: (...args: unknown[]) => void): (() => void) => {
    const wrapped = (_e: unknown, ...args: unknown[]): void => listener(...args)
    ipcRenderer.on(channel, wrapped as never)
    return () => ipcRenderer.off(channel, wrapped as never)
  }
}

contextBridge.exposeInMainWorld('demodog', api)

export type DemoDogAPI = typeof api
