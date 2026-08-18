// MIT License - Copyright (c) fintonlabs.com
import { useEffect, useState, type ReactNode } from 'react'
import { api } from '../api'

/**
 * The floating panel between choosing a source and recording it.
 *
 * Lives in a window of its own because this step raises another application —
 * which puts the studio window behind it, and would take the start button with
 * it. Everything it knows arrives over IPC from the studio, which owns the
 * capture settings; the panel only reports which button was pressed.
 */
export default function ReadyPanel(): ReactNode {
  const [detail, setDetail] = useState<{ title: string; hint: string }>({
    title: 'Ready',
    hint: ''
  })
  const [starting, setStarting] = useState(false)

  useEffect(() => api.onReadyDetail(setDetail), [])

  return (
    <div className="ready-panel">
      <span className="label">Ready to record</span>
      <h2>{detail.title}</h2>
      {detail.hint && <p className="hint">{detail.hint}</p>}
      <div className="ready-actions">
        <button
          className="btn ghost"
          disabled={starting}
          onClick={() => api.sendReadyAction('back')}
        >
          Back
        </button>
        <button
          className="record-cta"
          disabled={starting}
          onClick={() => {
            setStarting(true)
            api.sendReadyAction('start')
          }}
        >
          <span className="rec-dot" />
          {starting ? 'Starting…' : 'Start recording'}
        </button>
      </div>
    </div>
  )
}
