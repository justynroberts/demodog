// MIT License - Copyright (c) fintonlabs.com
import { useEffect, useState, type ReactNode } from 'react'
import { api, type CompleteRecording } from './api'
import SetupScreen from './recorder/SetupScreen'
import Editor from './editor/Editor'
import { InfoButton, ThemeToggle } from './ui/controls'
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

  useEffect(() => {
    return api.on('recording:complete', (payload) => {
      const result = payload as CompleteRecording
      setRecording(toRecording(result, result.camera))
      setMode('editor')
    })
  }, [])

  // Dev shortcut: FINSCREEN_OPEN=<take dir> boots straight into the editor.
  useEffect(() => {
    void api.autoloadRecording().then((result) => {
      if (!result) return
      setRecording(toRecording(result, result.camera))
      setMode('editor')
    })
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
        <div className="brand">
          <span className="dot" />
          FinScreen
        </div>
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
        <Editor recording={recording} />
      ) : (
        <SetupScreen onRecording={() => setMode('recording')} />
      )}
    </div>
  )
}
