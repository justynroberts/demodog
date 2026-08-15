// MIT License - Copyright (c) fintonlabs.com
import type { FinScreenAPI } from '../../preload'

declare global {
  interface Window {
    finscreen: FinScreenAPI
  }
}

export const api = window.finscreen
export type { CameraInfo, CompleteRecording } from '../../preload'
