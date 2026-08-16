// MIT License - Copyright (c) fintonlabs.com
import { useEffect, useState, type ReactNode } from 'react'
import { api, type CompleteRecording } from './api'
import SetupScreen from './recorder/SetupScreen'
import Editor from './editor/Editor'
import { Brand, InfoButton, ThemeToggle } from './ui/controls'
import { parseInput } from './engine/input'
import type { Recording } from './engine/types'
import type { RecordingResult } from '../../shared/types'

type Mode = 'setup' | 'recording' | 'editor'

/**
 * Converts what the main process hands back into the shape the engine wants,
 * including the camera's offset against the screen track.
 */
function toRecording(
  result: RecordingResult,
  camera?: { path: string; startWallClock: number } | null
): Recording {
  const meta = result.meta

  // The screen timeline is zeroed on the first *video frame*, which lands a
  // little after the helper starts. Convert the camera's wall-clock start onto
  // that same zero.
  const wallClockAtFirstFrame = meta.startWallClock + (meta.firstFrameHost - meta.startHost)
  const cameraOffset = camera ? camera.startWallClock - wallClockAtFirstFrame : 0

  return {
    dir: result.dir,
    meta,
    raw: result.events,
    input: parseInput(result.events, meta),
    screenURL: api.mediaURL(result.screenPath),
    cameraURL: camera ? api.mediaURL(camera.path) : undefined,
    cameraOffset,
    duration: meta.duration,
    source: { width: meta.capture.width, height: meta.capture.height }
  }
}

export default function StudioApp(): ReactNode {
  const [mode, setMode] = useState<Mode>('setup')
  const [recording, setRecording] = useState<Recording | null>(null)
  const [bench, setBench] = useState<{ out: string; seconds: number } | null>(null)

  // Opened from Finder, rather than from inside the app.
  useEffect(() => {
    return api.on('recording:opened', (payload) => {
      const result = payload as RecordingResult
      setRecording(toRecording(result, result.camera))
      setMode('editor')
    })
  }, [])

  useEffect(() => {
    return api.on('recording:complete', (payload) => {
      const result = payload as CompleteRecording
      setRecording(toRecording(result, result.camera))
      setMode('editor')
    })
  }, [])

  // Dev shortcut: DEMODOG_OPEN=<take dir> boots straight into the editor.
  // DEMODOG_BENCH does the same but exports immediately and quits.
  useEffect(() => {
    void (async () => {
      const bench = await api.benchConfig()
      const result = await api.autoloadRecording()
      if (!result) return
      setRecording(toRecording(result, result.camera))
      if (bench) setBench({ out: bench.out, seconds: bench.seconds })
      setMode('editor')
    })()
  }, [])

  const open = async (): Promise<void> => {
    const result = await api.openRecording()
    if (!result) return
    setRecording(toRecording(result, result.camera))
    setMode('editor')
  }

  return (
    <div className="app">
      <header className="topbar">
        <Brand />
        <span className="chip">{mode === 'editor' ? 'EDITOR' : 'RECORDER'}</span>

        <div className="spacer" />

        {mode === 'editor' && (
          <button
            className="btn"
            onClick={() => {
              setMode('setup')
              setRecording(null)
            }}
          >
            New recording
          </button>
        )}
        {mode !== 'editor' && (
          <button className="btn" onClick={() => void open()}>
            Open take…
          </button>
        )}
        <ThemeToggle />
        <InfoButton />
      </header>

      {mode === 'editor' && recording ? (
        <Editor recording={recording} bench={bench} />
      ) : (
        <SetupScreen onRecording={() => setMode('recording')} />
      )}
    </div>
  )
}
