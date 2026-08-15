// MIT License - Copyright (c) fintonlabs.com
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { api } from '../api'
import { Segmented, Toggle } from '../ui/controls'
import type { Permissions, Sources } from '../../../shared/types'

/**
 * Pre-flight: pick what to record, what to record it with, and confirm macOS
 * has actually granted the capture permission before the user commits to a
 * take.
 */
export default function SetupScreen({ onRecording }: { onRecording: () => void }): ReactNode {
  const [sources, setSources] = useState<Sources | null>(null)
  const [permissions, setPermissions] = useState<Permissions | null>(null)
  const [tab, setTab] = useState<'display' | 'window'>('display')
  const [selected, setSelected] = useState<{ kind: 'display' | 'window'; id: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)

  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([])
  const [mics, setMics] = useState<MediaDeviceInfo[]>([])
  const [cameraId, setCameraId] = useState<string>('')
  const [micId, setMicId] = useState<string>('')

  const [fps, setFps] = useState(60)
  const [systemAudio, setSystemAudio] = useState(true)
  const [keystrokes, setKeystrokes] = useState(false)

  const previewRef = useRef<HTMLVideoElement>(null)
  const previewStream = useRef<MediaStream | null>(null)

  // ---- load sources and permissions --------------------------------------

  const refresh = async (): Promise<void> => {
    try {
      const perms = await api.checkPermissions()
      setPermissions(perms)
      if (!perms.screenRecording) {
        setSources(null)
        return
      }
      const list = await api.listSources()
      setSources(list)
      setError(null)
      setSelected((current) => {
        if (current) return current
        const primary = list.displays.find((d) => d.isPrimary) ?? list.displays[0]
        return primary ? { kind: 'display', id: primary.id } : null
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  // ---- enumerate camera and microphone -----------------------------------

  useEffect(() => {
    const load = async (): Promise<void> => {
      try {
        // Labels stay blank until a capture permission has been granted once.
        const probe = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
        probe.getTracks().forEach((t) => t.stop())
      } catch {
        /* user may decline; the lists still populate without labels */
      }
      const devices = await navigator.mediaDevices.enumerateDevices()
      setCameras(devices.filter((d) => d.kind === 'videoinput'))
      setMics(devices.filter((d) => d.kind === 'audioinput'))
    }
    void load()
  }, [])

  // ---- camera preview ----------------------------------------------------

  useEffect(() => {
    const stop = (): void => {
      previewStream.current?.getTracks().forEach((t) => t.stop())
      previewStream.current = null
    }
    if (!cameraId) {
      stop()
      if (previewRef.current) previewRef.current.srcObject = null
      return
    }
    let cancelled = false
    navigator.mediaDevices
      .getUserMedia({ video: { deviceId: { exact: cameraId }, width: 640, height: 640 } })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        stop()
        previewStream.current = stream
        if (previewRef.current) {
          previewRef.current.srcObject = stream
          void previewRef.current.play().catch(() => undefined)
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
      stop()
    }
  }, [cameraId])

  // ---- start -------------------------------------------------------------

  const start = async (): Promise<void> => {
    if (!selected) return
    setStarting(true)
    setError(null)
    try {
      await api.startRecording({
        displayId: selected.kind === 'display' ? selected.id : undefined,
        windowId: selected.kind === 'window' ? selected.id : undefined,
        fps,
        systemAudio,
        trackKeystrokes: keystrokes,
        cameraDeviceId: cameraId || null,
        micDeviceId: micId || null
      })
      onRecording()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setStarting(false)
    }
  }

  // ---- render ------------------------------------------------------------

  if (permissions && !permissions.screenRecording) {
    return (
      <div className="setup" style={{ gridTemplateColumns: '1fr' }}>
        <div className="setup-main">
          <div className="notice snap">
            <strong>Screen Recording permission is required.</strong>
            <p style={{ margin: '8px 0 12px' }}>
              macOS must grant DemoDog access before it can capture anything. Enable it, then come
              back and press Re-check.
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn primary" onClick={() => api.openPrivacySettings('screen')}>
                Open System Settings
              </button>
              <button className="btn" onClick={() => void refresh()}>
                Re-check
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const items =
    tab === 'display'
      ? (sources?.displays ?? []).map((d) => ({
          id: d.id,
          title: d.name,
          subtitle: `${d.pixelWidth}×${d.pixelHeight} · ${d.scale}x`
        }))
      : (sources?.windows ?? []).map((w) => ({
          id: w.id,
          title: w.title || w.app,
          subtitle: `${w.app} · ${Math.round(w.width)}×${Math.round(w.height)}`
        }))

  return (
    <div className="setup">
      <div className="setup-main">
        <div>
          <div className="section-head">
            <h2>What to record</h2>
            <div className="spacer" />
            <button className="btn ghost" onClick={() => void refresh()}>
              Refresh
            </button>
          </div>
          <div className="source-tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'display'} onClick={() => setTab('display')}>
              Displays
            </button>
            <button role="tab" aria-selected={tab === 'window'} onClick={() => setTab('window')}>
              Windows
            </button>
          </div>
        </div>

        <div className="source-grid">
          {items.map((item, i) => (
            <button
              key={item.id}
              className="source-card"
              style={{ animationDelay: `${Math.min(i, 12) * 40}ms` }}
              aria-pressed={selected?.kind === tab && selected.id === item.id}
              onClick={() => setSelected({ kind: tab, id: item.id })}
            >
              <div className="thumb">{tab === 'display' ? 'DISPLAY' : 'WINDOW'}</div>
              <div className="meta">
                <strong>{item.title}</strong>
                <span>{item.subtitle}</span>
              </div>
            </button>
          ))}
          {items.length === 0 && (
            <div className="empty">
              <span>No {tab === 'display' ? 'displays' : 'windows'} found.</span>
            </div>
          )}
        </div>

        {error && <div className="notice">{error}</div>}
      </div>

      <aside className="setup-side">
        <div className="card">
          <h3>Camera</h3>
          <div className="field">
            <select value={cameraId} onChange={(e) => setCameraId(e.target.value)}>
              <option value="">No camera</option>
              {cameras.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || 'Camera'}
                </option>
              ))}
            </select>
          </div>
          {cameraId && <video ref={previewRef} className="cam-preview" muted playsInline />}
        </div>

        <div className="card">
          <h3>Audio</h3>
          <div className="field">
            <span className="label">Microphone</span>
            <select value={micId} onChange={(e) => setMicId(e.target.value)}>
              <option value="">No microphone</option>
              {mics.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || 'Microphone'}
                </option>
              ))}
            </select>
          </div>
          <Toggle label="System audio" checked={systemAudio} onChange={setSystemAudio} />
        </div>

        <div className="card">
          <h3>Capture</h3>
          <div className="field">
            <span className="label">Frame rate</span>
            <Segmented
              value={String(fps)}
              options={[
                { value: '30', label: '30 fps' },
                { value: '60', label: '60 fps' }
              ]}
              onChange={(v) => setFps(Number(v))}
            />
          </div>
          <Toggle label="Show keyboard shortcuts" checked={keystrokes} onChange={setKeystrokes} />
          {keystrokes && permissions && !permissions.accessibility && (
            <p style={{ fontSize: 12, color: 'var(--muted)', margin: '8px 0 0', lineHeight: 1.5 }}>
              Needs Accessibility access.{' '}
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault()
                  api.openPrivacySettings('accessibility')
                }}
                style={{ color: 'var(--violet)' }}
              >
                Grant it
              </a>
              . Only modifier combinations are recorded, never plain typing.
            </p>
          )}
        </div>

        <button
          className="record-cta"
          onClick={() => void start()}
          disabled={!selected || starting}
        >
          <span className="rec-dot" />
          {starting ? 'Starting…' : 'Start recording'}
        </button>
      </aside>
    </div>
  )
}
