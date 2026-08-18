// MIT License - Copyright (c) fintonlabs.com
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api } from '../api'
import Tour, { TOUR_STEPS, markTourSeen, tourSeen } from './Tour'
import { MadeByFintonLabs, Segmented, Toggle } from '../ui/controls'
import type { CapturePreset, Permissions, Sources } from '../../../shared/types'

type SourceTab = 'display' | 'window'
type OptionTab = 'camera' | 'audio' | 'capture'

interface Selection {
  kind: SourceTab
  id: number
}

/**
 * Pre-flight: pick what to record, what to record it with, and confirm macOS
 * has granted the capture permission before the user commits to a take.
 *
 * The options are tabbed rather than stacked because the three groups rarely
 * change together — most sessions touch one — and a preset bar sits above them
 * so a repeat session is a single click.
 */
export default function SetupScreen({ onRecording }: { onRecording: () => void }): ReactNode {
  const [sources, setSources] = useState<Sources | null>(null)
  const [permissions, setPermissions] = useState<Permissions | null>(null)
  // macOS shows the screen-recording prompt once and never again, so asking
  // repeatedly achieves nothing except spawning helpers.
  const requested = useRef(false)
  const [tab, setTab] = useState<SourceTab>('display')
  const [optionTab, setOptionTab] = useState<OptionTab>('camera')
  // Shown once, and only when there is something to show it against — running
  // it over the permission notice would explain settings the user cannot reach.
  const [tourStep, setTourStep] = useState<number | null>(null)

  const showTourStep = (next: number): void => {
    setTourStep(next)
    const step = TOUR_STEPS[next]
    if (step) setOptionTab(step.tab)
  }

  const endTour = (): void => {
    markTourSeen()
    setTourStep(null)
  }
  const [selected, setSelected] = useState<Selection | null>(null)
  /**
   * The pause between choosing what to record and recording it.
   *
   * Everything up to here is configuration; from here the user is arranging
   * their actual screen. Those are different jobs, and putting the button that
   * starts a take at the end of a settings panel meant the first seconds of
   * every recording were spent moving windows into place.
   */
  const [staged, setStaged] = useState(false)
  const [filter, setFilter] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  // Bumped to re-acquire the preview after it has been handed to the recorder.
  const [previewNonce, setPreviewNonce] = useState(0)
  const [thumbs, setThumbs] = useState<{
    displays: Record<string, string>
    windows: Record<string, string>
  }>({ displays: {}, windows: {} })

  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([])
  const [mics, setMics] = useState<MediaDeviceInfo[]>([])
  const [cameraId, setCameraId] = useState('')
  const [micId, setMicId] = useState('')

  const [fps, setFps] = useState(60)
  const [systemAudio, setSystemAudio] = useState(true)
  const [keystrokes, setKeystrokes] = useState(false)
  const [countdown, setCountdown] = useState(3)

  // Device enumeration needs a getUserMedia probe and finishes well after the
  // source list. Applying a preset before it lands resolves the saved camera
  // and microphone to nothing at all.
  const [devicesReady, setDevicesReady] = useState(false)
  const [presets, setPresets] = useState<CapturePreset[]>([])
  const [presetId, setPresetId] = useState('')
  const [presetName, setPresetName] = useState('')
  const appliedDefault = useRef(false)

  const previewRef = useRef<HTMLVideoElement>(null)
  const previewStream = useRef<MediaStream | null>(null)

  // ---- sources -----------------------------------------------------------

  const refresh = async (): Promise<void> => {
    try {
      let perms = await api.checkPermissions()
      // Asking is what puts DemoDog in the Screen Recording list. Only a
      // *request* registers an app with the system; a preflight check just
      // reports, silently, that it is not there. Without this the app told the
      // user to grant permission in System Settings, where DemoDog did not
      // appear at all and could not be switched on — a dead end with no way out
      // of it from inside the app.
      if (!perms.screenRecording && !requested.current) {
        requested.current = true
        perms = await api.requestPermissions()
      }
      setPermissions(perms)
      if (!perms.screenRecording) {
        setSources(null)
        return
      }
      const list = await api.listSources()
      setSources(list)
      // Only once the picker is actually usable: a tour of settings the user
      // cannot reach yet is just another thing in the way.
      if (!tourSeen()) setTourStep(0)
      setError(null)
      // Thumbnails are best-effort; the picker still works without them.
      void api
        .sourceThumbnails()
        .then(setThumbs)
        .catch(() => undefined)
      setSelected((current) => {
        // Keep the selection across a refresh when it still exists.
        if (current) {
          const alive =
            current.kind === 'display'
              ? list.displays.some((d) => d.id === current.id)
              : list.windows.some((w) => w.id === current.id)
          if (alive) return current
        }
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

  // ---- devices -----------------------------------------------------------

  useEffect(() => {
    const load = async (): Promise<void> => {
      try {
        // Labels stay blank until a capture permission has been granted once.
        const probe = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
        probe.getTracks().forEach((t) => t.stop())
      } catch {
        /* the user may decline; the lists still populate without labels */
      }
      const devices = await navigator.mediaDevices.enumerateDevices()
      setCameras(devices.filter((d) => d.kind === 'videoinput'))
      setMics(devices.filter((d) => d.kind === 'audioinput'))
      setDevicesReady(true)
    }
    void load()
  }, [])

  // ---- presets -----------------------------------------------------------

  useEffect(() => {
    void api.listPresets().then(setPresets)
  }, [])

  /** Resolves a saved device back to a live one: by id, else by label. */
  const resolveDevice = (
    saved: { deviceId: string; label: string } | null,
    available: MediaDeviceInfo[]
  ): string => {
    if (!saved) return ''
    if (available.some((d) => d.deviceId === saved.deviceId)) return saved.deviceId
    return available.find((d) => d.label === saved.label)?.deviceId ?? ''
  }

  const applyPreset = (preset: CapturePreset): void => {
    setPresetId(preset.id)
    setPresetName(preset.name)
    setFps(preset.fps)
    setSystemAudio(preset.systemAudio)
    setKeystrokes(preset.keystrokes)
    setCountdown(preset.countdown)
    const camera = resolveDevice(preset.camera, cameras)
    const mic = resolveDevice(preset.mic, mics)
    setCameraId(camera)
    setMicId(mic)

    const missing: string[] = []
    if (preset.camera && !camera) missing.push(`camera “${preset.camera.label || 'saved'}”`)
    if (preset.mic && !mic) missing.push(`microphone “${preset.mic.label || 'saved'}”`)
    setError(
      missing.length
        ? `Preset “${preset.name}” refers to a ${missing.join(' and a ')} that is not connected.`
        : null
    )

    if (!sources) return
    if (preset.source.kind === 'display') {
      const match = sources.displays.find((d) => d.id === preset.source.id)
      if (match) {
        setTab('display')
        setSelected({ kind: 'display', id: match.id })
      }
    } else {
      // Window ids do not survive a session, so re-match on app and title.
      const match =
        sources.windows.find((w) => w.id === preset.source.id) ??
        sources.windows.find(
          (w) => w.app === preset.source.app && w.title === preset.source.label
        ) ??
        sources.windows.find((w) => w.app === preset.source.app)
      if (match) {
        setTab('window')
        setSelected({ kind: 'window', id: match.id })
      }
    }
  }

  /** How the setup was left last time, so a second take starts where the first did. */
  const LAST_USED = 'demodog-last-capture'

  // Restore the previous setup, falling back to the starred preset on a machine
  // that has never recorded. Last used wins because it is the more recent
  // statement of intent: applying a preset makes it the last used, so nothing
  // is lost by preferring it.
  useEffect(() => {
    if (appliedDefault.current) return
    if (!sources || !devicesReady) return

    let remembered: CapturePreset | null = null
    try {
      const stored = localStorage.getItem(LAST_USED)
      if (stored) remembered = JSON.parse(stored) as CapturePreset
    } catch {
      remembered = null
    }

    const preferred = remembered ?? presets.find((p) => p.isDefault) ?? null
    if (!preferred) return
    appliedDefault.current = true
    applyPreset(preferred)
    // A remembered setup is not a saved preset, so it must not look like one.
    if (remembered) {
      setPresetId('')
      setPresetName('')
    }
  }, [sources, devicesReady, presets, cameras, mics])

  // Remembered whenever anything changes, rather than only on record, so a take
  // that is set up and then abandoned still leaves the settings behind.
  useEffect(() => {
    if (!appliedDefault.current || !selected) return
    const display = sources?.displays.find((d) => d.id === selected.id)
    const window = sources?.windows.find((w) => w.id === selected.id)
    const snapshot: CapturePreset = {
      id: 'last-used',
      name: 'Last used',
      isDefault: false,
      source: {
        kind: selected.kind,
        id: selected.id,
        label:
          selected.kind === 'display' ? (display?.name ?? 'Display') : (window?.title ?? 'Window'),
        app: selected.kind === 'window' ? window?.app : undefined
      },
      camera: cameraId
        ? { deviceId: cameraId, label: cameras.find((d) => d.deviceId === cameraId)?.label ?? '' }
        : null,
      mic: micId
        ? { deviceId: micId, label: mics.find((d) => d.deviceId === micId)?.label ?? '' }
        : null,
      fps,
      systemAudio,
      keystrokes,
      countdown
    }
    try {
      localStorage.setItem(LAST_USED, JSON.stringify(snapshot))
    } catch {
      // Not being able to remember is not worth interrupting a recording over.
    }
  }, [selected, cameraId, micId, fps, systemAudio, keystrokes, countdown, sources, cameras, mics])

  const currentPreset = presets.find((p) => p.id === presetId) ?? null

  const savePreset = async (): Promise<void> => {
    const name = presetName.trim()
    if (!name || !selected) return
    const display = sources?.displays.find((d) => d.id === selected.id)
    const window = sources?.windows.find((w) => w.id === selected.id)
    const label =
      selected.kind === 'display' ? (display?.name ?? 'Display') : (window?.title ?? 'Window')

    const preset: CapturePreset = {
      id: currentPreset?.id ?? `c-${Date.now()}`,
      name,
      isDefault: currentPreset?.isDefault ?? false,
      source: {
        kind: selected.kind,
        id: selected.id,
        label,
        app: selected.kind === 'window' ? window?.app : undefined
      },
      camera: cameraId
        ? { deviceId: cameraId, label: cameras.find((d) => d.deviceId === cameraId)?.label ?? '' }
        : null,
      mic: micId
        ? { deviceId: micId, label: mics.find((d) => d.deviceId === micId)?.label ?? '' }
        : null,
      fps,
      systemAudio,
      keystrokes,
      countdown
    }
    setPresets(await api.savePreset(preset))
    setPresetId(preset.id)
  }

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
  }, [cameraId, previewNonce, optionTab])

  // The floating panel has the only start button that survives another app
  // being raised, so its presses are what actually begin a take.
  useEffect(() => {
    return api.onReadyAction((action) => {
      if (action === 'back') {
        void api.hideReady()
        setStaged(false)
      } else {
        void start()
      }
    })
    // `start` is redefined every render; the listener is re-registered with it
    // so it always closes over the current settings.
  })

  // ---- start -------------------------------------------------------------

  /**
   * Moves to the ready screen, bringing the chosen window forward with it.
   *
   * A window picked from a list is usually behind the recorder, and one left
   * behind something else is also the one that records almost nothing, since
   * the capture only produces frames when its content changes.
   */
  const stage = async (): Promise<void> => {
    if (!selected) return
    setStaged(true)
    await api.showReady({
      title: selectedLabel(),
      hint:
        selected.kind === 'window'
          ? 'That window is at the front. Arrange anything else, then start — the countdown gives you three more seconds.'
          : 'Arrange your windows, then start — the countdown gives you three more seconds.'
    })
    // Raised after the panel is up, so the panel is never the thing that gets
    // covered by the window it just brought forward.
    if (selected.kind === 'window') await api.focusWindow(selected.id)
  }

  const start = async (): Promise<void> => {
    if (!selected) return
    setStarting(true)
    setError(null)

    // Hand the camera over before the control bar asks for it. Two consumers on
    // the same physical device is a common getUserMedia failure, and it fails
    // silently — you get a recording with no camera track and no warning.
    previewStream.current?.getTracks().forEach((track) => track.stop())
    previewStream.current = null
    if (previewRef.current) previewRef.current.srcObject = null
    if (cameraId) await new Promise((resolve) => setTimeout(resolve, 200))

    try {
      await api.startRecording({
        displayId: selected.kind === 'display' ? selected.id : undefined,
        windowId: selected.kind === 'window' ? selected.id : undefined,
        fps,
        systemAudio,
        trackKeystrokes: keystrokes,
        countdown,
        cameraDeviceId: cameraId || null,
        micDeviceId: micId || null
      })
      void api.hideReady()
      setStaged(false)
      onRecording()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      // Recording never began, so take the camera back for the preview.
      setPreviewNonce((n) => n + 1)
    } finally {
      setStarting(false)
    }
  }

  // ---- source list -------------------------------------------------------

  const items = useMemo(() => {
    if (!sources) return []
    if (tab === 'display') {
      return sources.displays.map((d) => ({
        id: d.id,
        title: d.name,
        subtitle: `${d.pixelWidth}×${d.pixelHeight} · ${d.scale}x`,
        thumb: thumbs.displays[String(d.id)]
      }))
    }
    const needle = filter.trim().toLowerCase()
    return sources.windows
      .filter(
        (w) =>
          !needle || w.title.toLowerCase().includes(needle) || w.app.toLowerCase().includes(needle)
      )
      .map((w) => ({
        id: w.id,
        title: w.title || w.app,
        subtitle: `${w.app} · ${Math.round(w.width)}×${Math.round(w.height)}`,
        thumb: thumbs.windows[String(w.id)]
      }))
  }, [sources, tab, filter, thumbs])

  const selectedLabel = (): string => {
    if (!selected || !sources) return 'Nothing selected'
    if (selected.kind === 'display') {
      return sources.displays.find((d) => d.id === selected.id)?.name ?? 'Display'
    }
    const w = sources.windows.find((x) => x.id === selected.id)
    return w ? `${w.app} — ${w.title || 'Untitled'}` : 'Window'
  }

  // ---- render ------------------------------------------------------------

  if (permissions && !permissions.screenRecording) {
    return (
      <div className="permission-stage">
        <div className="permission-card snap">
          <div className="permission-mark" aria-hidden="true">
            <span />
          </div>
          <h2>Screen Recording is off</h2>
          <p>
            macOS has to let DemoDog see the screen before it can record anything. Switch{' '}
            <strong>DemoDog</strong> on under Screen &amp; System Audio Recording.
          </p>
          <p className="permission-note">
            macOS only reads the setting when an app starts, so DemoDog has to be reopened
            afterwards.
          </p>
          <div className="permission-actions">
            <button className="btn primary" onClick={() => api.openPrivacySettings('screen')}>
              Open System Settings
            </button>
            <button className="btn" onClick={() => void api.relaunch()}>
              Quit and reopen
            </button>
            <button className="btn ghost" onClick={() => void refresh()}>
              Re-check
            </button>
          </div>
        </div>
      </div>
    )
  }

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

          <div className="source-bar">
            <div className="source-tabs" role="tablist">
              <button
                role="tab"
                aria-selected={tab === 'display'}
                onClick={() => setTab('display')}
              >
                Displays <span className="count">{sources?.displays.length ?? 0}</span>
              </button>
              <button role="tab" aria-selected={tab === 'window'} onClick={() => setTab('window')}>
                Windows <span className="count">{sources?.windows.length ?? 0}</span>
              </button>
            </div>
            {tab === 'window' && (
              <input
                className="text-input inline"
                placeholder="Filter windows…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            )}
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
              <div className="thumb">
                {item.thumb ? <img src={item.thumb} alt="" /> : <span>{tab.toUpperCase()}</span>}
              </div>
              <div className="meta">
                <strong>{item.title}</strong>
                <span>{item.subtitle}</span>
              </div>
            </button>
          ))}
          {items.length === 0 && (
            <div className="empty">
              <span>
                {filter
                  ? `No windows match “${filter}”.`
                  : `No ${tab === 'display' ? 'displays' : 'windows'} found.`}
              </span>
            </div>
          )}
        </div>

        {error && <div className="notice">{error}</div>}

        <MadeByFintonLabs />
      </div>

      <aside className="setup-side">
        <div className="card">
          <h3>Preset</h3>
          <select
            value={presetId}
            onChange={(e) => {
              const preset = presets.find((p) => p.id === e.target.value)
              if (preset) applyPreset(preset)
              else {
                setPresetId('')
                setPresetName('')
              }
            }}
          >
            <option value="">Not saved</option>
            {presets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
                {preset.isDefault ? ' · default' : ''}
              </option>
            ))}
          </select>
          <input
            className="text-input"
            placeholder="Preset name"
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void savePreset()
            }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="btn"
              style={{ flex: 1, justifyContent: 'center' }}
              onClick={() => void savePreset()}
              disabled={!presetName.trim() || !selected}
            >
              {currentPreset ? 'Update' : 'Save'}
            </button>
            <button
              className="btn"
              title="Load this setup automatically next time"
              disabled={!currentPreset}
              style={
                currentPreset?.isDefault
                  ? { background: 'var(--lime)', color: 'var(--lime-ink)' }
                  : undefined
              }
              onClick={async () => {
                if (!currentPreset) return
                setPresets(
                  await api.savePreset({ ...currentPreset, isDefault: !currentPreset.isDefault })
                )
              }}
            >
              ★
            </button>
            <button
              className="btn"
              title="Delete"
              disabled={!currentPreset}
              onClick={async () => {
                if (!currentPreset) return
                setPresets(await api.deletePreset(currentPreset.id))
                setPresetId('')
                setPresetName('')
              }}
            >
              ✕
            </button>
          </div>
        </div>

        <div className={`card options-card${tourStep !== null ? ' tour-focus' : ''}`}>
          <div className="opt-tabs" role="tablist">
            {(['camera', 'audio', 'capture'] as OptionTab[]).map((id) => (
              <button
                key={id}
                role="tab"
                aria-selected={optionTab === id}
                onClick={() => setOptionTab(id)}
              >
                {id}
                {id === 'camera' && cameraId ? <span className="dot-on" /> : null}
                {id === 'audio' && (micId || systemAudio) ? <span className="dot-on" /> : null}
              </button>
            ))}
          </div>

          <div className="opt-body">
            {optionTab === 'camera' && (
              <>
                <select value={cameraId} onChange={(e) => setCameraId(e.target.value)}>
                  <option value="">No camera</option>
                  {cameras.map((device) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label || 'Camera'}
                    </option>
                  ))}
                </select>
                {cameraId ? (
                  <video ref={previewRef} className="cam-preview" muted playsInline />
                ) : (
                  <p className="hint">
                    Pick a camera to record a picture-in-picture alongside the screen. It is turned
                    on automatically in the editor.
                  </p>
                )}
                {/* Blur is macOS's to apply, not DemoDog's: it happens at the
                    camera, before any app sees a frame, so it is baked into the
                    recording rather than added at render time. */}
                <div className="effects-note">
                  <span className="label">Background blur</span>
                  <p className="hint">
                    macOS blurs it for you. With DemoDog recording, open{' '}
                    <strong>Control Centre</strong> in the menu bar → <strong>Video Effects</strong>{' '}
                    → <strong>Portrait</strong>.
                  </p>
                  <button
                    className="btn ghost small"
                    onClick={() =>
                      void api.openExternal(
                        'https://support.apple.com/guide/mac-help/use-video-effects-mchlf6d98f4e/mac'
                      )
                    }
                  >
                    How this works ↗
                  </button>
                </div>
              </>
            )}

            {optionTab === 'audio' && (
              <>
                <span className="label">Microphone</span>
                <select value={micId} onChange={(e) => setMicId(e.target.value)}>
                  <option value="">No microphone</option>
                  {mics.map((device) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label || 'Microphone'}
                    </option>
                  ))}
                </select>
                <div style={{ height: 6 }} />
                <Toggle label="System audio" checked={systemAudio} onChange={setSystemAudio} />
              </>
            )}

            {optionTab === 'capture' && (
              <>
                <span className="label">Frame rate</span>
                <Segmented
                  value={String(fps)}
                  options={[
                    { value: '30', label: '30 fps' },
                    { value: '60', label: '60 fps' }
                  ]}
                  onChange={(v) => setFps(Number(v))}
                />
                <div style={{ height: 12 }} />
                <span className="label">Countdown</span>
                <Segmented
                  value={String(countdown)}
                  options={[
                    { value: '0', label: 'Off' },
                    { value: '3', label: '3s' },
                    { value: '5', label: '5s' },
                    { value: '10', label: '10s' }
                  ]}
                  onChange={(v) => setCountdown(Number(v))}
                />
                <div style={{ height: 6 }} />
                <Toggle
                  label="Show keyboard shortcuts"
                  checked={keystrokes}
                  onChange={setKeystrokes}
                />
                {keystrokes && permissions && !permissions.accessibility && (
                  <p className="hint">
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
              </>
            )}
          </div>
        </div>

        <div className="ready">
          <span className="label">Ready</span>
          <strong className="ready-source">{selectedLabel()}</strong>
          <span className="ready-summary mono">
            {fps}fps · {cameraId ? 'camera' : 'no camera'} · {micId ? 'mic' : 'no mic'} ·{' '}
            {systemAudio ? 'system audio' : 'muted'} ·{' '}
            {countdown ? `${countdown}s` : 'no countdown'}
          </span>
        </div>

        <button
          className="record-cta"
          onClick={() => void stage()}
          disabled={!selected || starting}
        >
          <span className="rec-dot" />
          Let&rsquo;s Start
        </button>
      </aside>

      {tourStep !== null && <Tour step={tourStep} onStep={showTourStep} onClose={endTour} />}
    </div>
  )
}
