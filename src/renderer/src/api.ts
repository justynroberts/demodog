// MIT License - Copyright (c) fintonlabs.com
import type { DemoDogAPI } from '../../preload'

declare global {
  interface Window {
    demodog: DemoDogAPI
  }
}

export const api = window.demodog
export type { CameraInfo, CompleteRecording } from '../../preload'
