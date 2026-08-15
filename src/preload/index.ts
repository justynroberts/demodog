// MIT License - Copyright (c) fintonlabs.com
import { contextBridge, ipcRenderer } from 'electron'
import type { Permissions, RecordOptions, RecordingResult, Sources } from '../shared/types'

export interface CameraInfo {
  path: string
  startWallClock: number
  mimeType: string
}

export type CompleteRecording = RecordingResult & { camera: CameraInfo | null }

const api = {
  listSources: (): Promise<Sources> => ipcRenderer.invoke('sources:list'),
  checkPermissions: (): Promise<Permissions> => ipcRenderer.invoke('permissions:check'),
  requestPermissions: (): Promise<Permissions> => ipcRenderer.invoke('permissions:request'),
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
  benchConfig: (): Promise<{ dir: string; out: string; seconds: number } | null> =>
    ipcRenderer.invoke('bench:config'),
  benchFinish: (path: string, data: ArrayBuffer): Promise<void> =>
    ipcRenderer.invoke('bench:finish', path, data),
  benchFail: (message: string): Promise<void> => ipcRenderer.invoke('bench:fail', message),

  openCameraFile: (info: { startWallClock: number; mimeType: string }): Promise<string> =>
    ipcRenderer.invoke('camera:open', info),
  writeCameraChunk: (chunk: ArrayBuffer): void => ipcRenderer.send('camera:chunk', chunk),

  saveDialog: (options: {
    defaultPath: string
    filters?: { name: string; extensions: string[] }[]
  }): Promise<string | null> => ipcRenderer.invoke('dialog:save', options),
  writeFile: (path: string, data: ArrayBuffer): Promise<string> =>
    ipcRenderer.invoke('file:write', path, data),
  reveal: (path: string): Promise<void> => ipcRenderer.invoke('shell:reveal', path),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:open-external', url),

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
