// MIT License - Copyright (c) fintonlabs.com
import { useEffect, useState, type ReactNode } from 'react'
import { api } from '../api'
import { BACKGROUND_PRESETS, OUTPUT_PRESETS, mergeSettings } from '../engine/defaults'
import { Group, Segmented, Slider, Toggle, formatTime } from '../ui/controls'
import { CAPTION_FONTS, captionsFromCues } from '../engine/captions'
import type { Caption } from '../engine/captions'
import { DEFAULT_INTRO } from '../engine/titles'
import type { CursorSettings, Project, Recording, ZoomSegment } from '../engine/types'
import type { Profile } from '../../../shared/types'

/** The parts of a Project that belong to a look, not to one recording. */
const PROFILE_KEYS = [
  'background',
  'frame',
  'zoom',
  'cursor',
  'pip',
  'keystrokes',
  'fade',
  'audio',
  'output',
  // The look of the captions travels with a profile; the captions themselves
  // belong to one recording and never do.
  'captionStyle'
] as const

function extractProfileSettings(project: Project): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of PROFILE_KEYS) out[key] = project[key]
  return out
}

interface Props {
  project: Project
  onChange: (project: Project) => void
  segments: ZoomSegment[]
  onSegmentsChange: (segments: ZoomSegment[]) => void
  selected: string | null
  onSelect: (id: string | null) => void
  recording: Recording
  cameraSync: number
  onCameraSync: (v: number) => void
  /** Where the playhead is, so a new line lands where it is being watched. */
  time: number
  /** True while a drag on the preview will choose a zoom area. */
  picking: boolean
  onPick: () => void
  /** The caption clicked on the timeline, if any. */
  selectedCaption: string | null
  onSelectCaption: (id: string | null) => void
  /** Which look profile is currently applied, owned by the editor. */
  profileId: string
  onProfileId: (id: string) => void
}

type Tab = 'style' | 'zoom' | 'cursor' | 'camera' | 'text' | 'titles'

/**
 * The inspector's tabs.
 *
 * Six words did not fit the rail — they wrapped, squashed and abbreviated
 * themselves into something harder to read than nothing. Icons fit, and carry
 * the name and a line of explanation on hover for anyone who does not already
 * know what a given glyph means here.
 */
const TABS: { id: Tab; name: string; hint: string; icon: ReactNode }[] = [
  {
    id: 'style',
    name: 'Style',
    hint: 'Background, padding, corners and shadow — how the recording is framed.',
    icon: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="3" />
        <path d="M8 15l3-4 2.5 3L16 11l3 4" />
      </>
    )
  },
  {
    id: 'zoom',
    name: 'Zoom',
    hint: 'How closely the camera follows what you did, and how often it moves.',
    icon: (
      <>
        <circle cx="11" cy="11" r="6" />
        <path d="M20 20l-4.5-4.5M9 11h4M11 9v4" />
      </>
    )
  },
  {
    id: 'cursor',
    name: 'Cursor',
    hint: 'The pointer drawn back in: its size, style, smoothing and clicks.',
    icon: <path d="M5 3l6 17 2.5-6.5L20 11z" />
  },
  {
    id: 'camera',
    name: 'Camera',
    hint: 'Your picture-in-picture — shape, size, position and sync.',
    icon: (
      <>
        <rect x="2" y="6" width="13" height="12" rx="2.5" />
        <path d="M15 11l6-3.5v9L15 13z" />
      </>
    )
  },
  {
    id: 'text',
    name: 'Captions',
    hint: 'Transcribe what you said, then edit the lines and style them.',
    icon: (
      <>
        <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
        <path d="M7 11h4M7 14.5h8M14 11h3" />
      </>
    )
  },
  {
    id: 'titles',
    name: 'Titles',
    hint: 'Intro and outro cards, shown before and after the recording.',
    icon: (
      <>
        <rect x="2.5" y="4.5" width="19" height="15" rx="2.5" />
        <path d="M7 10h10M9.5 14h5" />
      </>
    )
  }
]

export default function Inspector(props: Props): ReactNode {
  const { project, onChange } = props
  const [tab, setTab] = useState<Tab>('style')
  /** Whichever tab the pointer is over, so the caption can preview it. */
  const [hovered, setHovered] = useState<Tab | null>(null)

  // Shallow-merge helpers keep the call sites readable while preserving the
  // immutable update React needs to see.
  const set = <K extends keyof Project>(key: K, value: Project[K]): void =>
    onChange({ ...project, [key]: value })

  const patch = <K extends keyof Project>(key: K, value: Partial<Project[K]>): void =>
    onChange({ ...project, [key]: { ...(project[key] as object), ...value } as Project[K] })

  const described = TABS.find((t) => t.id === (hovered ?? tab)) ?? TABS[0]

  return (
    <aside className="inspector">
      <div className="insp-tabs" role="tablist">
        {TABS.map(({ id, name, hint, icon }) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            aria-label={`${name} — ${hint}`}
            onClick={() => setTab(id)}
            onPointerEnter={() => setHovered(id)}
            onPointerLeave={() => setHovered(null)}
            onFocus={() => setHovered(id)}
            onBlur={() => setHovered(null)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              {icon}
            </svg>
          </button>
        ))}
      </div>

      {/* One caption line rather than a floating tooltip. A box hovering over
          the panel covered the controls underneath it, had to be kept inside
          the rail, and needed its own stacking order — three problems a line
          that is always there does not have. It names the open tab, and
          previews whichever one is under the pointer. */}
      <div className="insp-caption">
        <strong>{described.name}</strong>
        <span>{described.hint}</span>
      </div>

      <div className="insp-body">
        {tab === 'style' && (
          <StyleTab
            project={project}
            set={set}
            patch={patch}
            // Applied in one update; setting each key in turn would read stale
            // state and only the last change would survive.
            applyProfile={(settings) => onChange(mergeSettings(project, settings))}
            profileId={props.profileId}
            onProfileId={props.onProfileId}
          />
        )}
        {tab === 'zoom' && <ZoomTab {...props} patch={patch} />}
        {tab === 'cursor' && <CursorTab project={project} patch={patch} />}
        {tab === 'camera' && <CameraTab {...props} patch={patch} />}
        {tab === 'text' && <CaptionsTab {...props} set={set} patch={patch} />}
        {tab === 'titles' && <TitlesTab project={project} patch={patch} />}
      </div>
    </aside>
  )
}

// ---------------------------------------------------------------------------

type Setter = <K extends keyof Project>(key: K, value: Project[K]) => void
type Patcher = <K extends keyof Project>(key: K, value: Partial<Project[K]>) => void

/**
 * Named look presets. Everything except the recording-specific bits (zoom
 * segments, trim) is saved, so a profile can be applied to any take.
 */
function Profiles({
  project,
  onApply,
  selected,
  onSelected
}: {
  project: Project
  onApply: (settings: Partial<Project>) => void
  selected: string
  onSelected: (id: string) => void
}): ReactNode {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [name, setName] = useState('')

  useEffect(() => {
    void api.listProfiles().then(setProfiles)
  }, [])

  // The editor may have applied the default before this tab was ever opened,
  // so adopt its name rather than showing an empty field over a live profile.
  useEffect(() => {
    const active = profiles.find((p) => p.id === selected)
    if (active) setName(active.name)
  }, [profiles, selected])

  const current = profiles.find((p) => p.id === selected) ?? null

  /**
   * Creates or updates a profile.
   *
   * The name comes from a real input rather than `window.prompt`, which Electron
   * does not implement — it returns null without showing anything, so naming a
   * profile silently did nothing.
   */
  const save = async (): Promise<void> => {
    const trimmed = name.trim()
    if (!trimmed) return
    const profile: Profile = {
      // Keeping the id when one is selected makes this a rename.
      id: current?.id ?? `p-${Date.now()}`,
      name: trimmed,
      isDefault: current?.isDefault ?? false,
      settings: extractProfileSettings(project)
    }
    setProfiles(await api.saveProfile(profile))
    onSelected(profile.id)
  }

  const apply = (id: string): void => {
    onSelected(id)
    const profile = profiles.find((p) => p.id === id)
    setName(profile?.name ?? '')
    if (profile) onApply(profile.settings as Partial<Project>)
  }

  const makeDefault = async (): Promise<void> => {
    if (!current) return
    setProfiles(await api.saveProfile({ ...current, isDefault: !current.isDefault }))
  }

  const remove = async (): Promise<void> => {
    if (!current) return
    setProfiles(await api.deleteProfile(current.id))
    onSelected('')
    setName('')
  }

  const isRename = Boolean(current) && current!.name !== name.trim()

  return (
    <Group title="Profile">
      <select value={selected} onChange={(e) => apply(e.target.value)}>
        <option value="">Custom (unsaved)</option>
        {profiles.map((profile) => (
          <option key={profile.id} value={profile.id}>
            {profile.name}
            {profile.isDefault ? ' · default' : ''}
          </option>
        ))}
      </select>

      <input
        className="text-input"
        placeholder="Profile name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void save()
        }}
      />

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          className="btn"
          style={{ flex: 1, justifyContent: 'center' }}
          onClick={() => void save()}
          disabled={!name.trim()}
          title={isRename ? 'Rename and update this profile' : 'Save these settings'}
        >
          {current ? (isRename ? 'Rename' : 'Update') : 'Save'}
        </button>
        <button
          className="btn"
          onClick={() => void makeDefault()}
          disabled={!current}
          title="Use this profile for new recordings"
          style={
            current?.isDefault ? { background: 'var(--lime)', color: 'var(--lime-ink)' } : undefined
          }
        >
          ★
        </button>
        <button className="btn" onClick={() => void remove()} disabled={!current} title="Delete">
          ✕
        </button>
      </div>

      <p style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.5, margin: '10px 0 0' }}>
        Saves background, frame, zoom, cursor, camera and output settings. The starred profile is
        applied to every new recording.
      </p>
    </Group>
  )
}

function StyleTab({
  project,
  set,
  patch,
  applyProfile,
  profileId,
  onProfileId
}: {
  project: Project
  set: Setter
  patch: Patcher
  applyProfile: (settings: Partial<Project>) => void
  profileId: string
  onProfileId: (id: string) => void
}): ReactNode {
  const { frame, background, output } = project

  return (
    <>
      <Profiles
        project={project}
        onApply={applyProfile}
        selected={profileId}
        onSelected={onProfileId}
      />

      <Group title="Background">
        <div className="swatches">
          {BACKGROUND_PRESETS.map((preset) => (
            <button
              key={preset.id}
              className="swatch"
              title={preset.name}
              aria-pressed={JSON.stringify(background) === JSON.stringify(preset.background)}
              style={{ background: swatchCSS(preset.background.colors, preset.background.angle) }}
              onClick={() => set('background', { ...preset.background })}
            />
          ))}
        </div>
        <div style={{ height: 10 }} />
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn"
            style={{ flex: 1, justifyContent: 'center' }}
            onClick={async () => {
              const path = await api.pickImage()
              if (!path) return
              set('background', {
                ...background,
                kind: 'image',
                imageSrc: api.mediaURL(path),
                useWallpaperBlur: false
              })
            }}
          >
            Custom image…
          </button>
          {background.kind === 'image' && (
            <button
              className="btn"
              title="Remove the custom image"
              onClick={() => set('background', { ...BACKGROUND_PRESETS[0].background })}
            >
              ✕
            </button>
          )}
        </div>

        <div style={{ height: 12 }} />
        <Slider
          label="Grain"
          value={background.grain}
          min={0}
          max={1}
          onChange={(v) => patch('background', { grain: v })}
          format={(v) => `${Math.round(v * 100)}%`}
        />
      </Group>

      <Group title="Frame">
        <Slider
          label="Padding"
          value={frame.padding}
          min={0}
          max={0.24}
          onChange={(v) => patch('frame', { padding: v })}
          format={(v) => `${Math.round(v * 100)}%`}
        />
        <Slider
          label="Corner radius"
          value={frame.radius}
          min={0}
          max={64}
          step={1}
          onChange={(v) => patch('frame', { radius: v })}
          format={(v) => `${v}px`}
        />
        <Slider
          label="Shadow"
          value={frame.shadow.opacity}
          min={0}
          max={0.9}
          onChange={(v) => patch('frame', { shadow: { ...frame.shadow, opacity: v } })}
          format={(v) => `${Math.round(v * 100)}%`}
        />
        <Slider
          label="Shadow size"
          value={frame.shadow.blur}
          min={0}
          max={200}
          step={2}
          onChange={(v) => patch('frame', { shadow: { ...frame.shadow, blur: v } })}
          format={(v) => `${v}px`}
        />
        <Slider
          label="Rotation"
          value={frame.rotate}
          min={-6}
          max={6}
          step={0.1}
          onChange={(v) => patch('frame', { rotate: v })}
          format={(v) => `${v.toFixed(1)}°`}
        />
        <div style={{ marginTop: 10 }}>
          <span className="label">Fit</span>
          <Segmented
            value={frame.fitMode}
            options={[
              { value: 'contain', label: 'Contain' },
              { value: 'cover', label: 'Crop' }
            ]}
            onChange={(v) => patch('frame', { fitMode: v })}
          />
        </div>
      </Group>

      <Group title="Fade">
        <Slider
          label="Fade in"
          value={project.fade.in}
          min={0}
          max={3}
          step={0.05}
          onChange={(v) => patch('fade', { in: v })}
          format={(v) => (v === 0 ? 'off' : `${v.toFixed(2)}s`)}
        />
        <Slider
          label="Fade out"
          value={project.fade.out}
          min={0}
          max={3}
          step={0.05}
          onChange={(v) => patch('fade', { out: v })}
          format={(v) => (v === 0 ? 'off' : `${v.toFixed(2)}s`)}
        />
        <p style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.5, margin: '4px 0 0' }}>
          Measured from the trimmed in and out points, and applied to the audio as well as the
          picture.
        </p>
      </Group>

      <Group title="Output">
        <select
          value={`${output.width}x${output.height}`}
          onChange={(e) => {
            const preset = OUTPUT_PRESETS.find((p) => `${p.width}x${p.height}` === e.target.value)
            if (preset) patch('output', { width: preset.width, height: preset.height })
          }}
        >
          {OUTPUT_PRESETS.map((preset) => (
            <option key={preset.id} value={`${preset.width}x${preset.height}`}>
              {preset.name}
            </option>
          ))}
          <option value={`${output.width}x${output.height}`}>
            Current · {output.width}×{output.height}
          </option>
        </select>
        <div style={{ height: 12 }} />
        <span className="label">Frame rate</span>
        <Segmented
          value={String(output.fps)}
          options={[
            { value: '30', label: '30' },
            { value: '60', label: '60' }
          ]}
          onChange={(v) => patch('output', { fps: Number(v) })}
        />
      </Group>
    </>
  )
}

// ---------------------------------------------------------------------------

function ZoomTab({
  project,
  patch,
  segments,
  onSegmentsChange,
  selected,
  onSelect,
  recording,
  picking,
  onPick,
  time
}: Props & { patch: Patcher }): ReactNode {
  const { zoom } = project
  const active = segments.find((s) => s.id === selected) ?? null

  const updateSelected = (changes: Partial<ZoomSegment>): void => {
    if (!active) return
    onSegmentsChange(
      segments.map((s) => (s.id === active.id ? { ...s, ...changes, auto: false } : s))
    )
  }

  const autoCount = segments.filter((s) => s.auto).length
  const { clicks, scrolls } = recording.input

  // Union of the shots, so overlapping ones are not double counted. This is
  // the number that answers "is it zoomed the whole time?" — a question the
  // settings alone cannot.
  const covered = [...segments]
    .sort((a, b) => a.start - b.start)
    .reduce<{ total: number; until: number }>(
      (acc, seg) => {
        const from = Math.max(seg.start, acc.until)
        return {
          total: acc.total + Math.max(0, seg.end - from),
          until: Math.max(acc.until, seg.end)
        }
      },
      { total: 0, until: 0 }
    ).total
  const zoomedPercent = recording.duration ? Math.round((covered / recording.duration) * 100) : 0

  return (
    <>
      {/* The shot being edited comes first: it is what the timeline selection
          refers to, and hunting for it under the automatic settings makes the
          two feel unrelated when one overrides the other. */}
      {active ? (
        <Group title={active.auto ? 'Selected shot (automatic)' : 'Selected shot'}>
          <button
            className={picking ? 'btn violet' : 'btn'}
            onClick={onPick}
            style={{ justifyContent: 'center' }}
          >
            {picking ? 'Now drag on the preview…' : 'Choose the area on the preview'}
          </button>
          <p className="hint">
            Drag a box around what should fill the frame. The zoom is worked out from the box, so
            you are choosing what to look at rather than a number.
          </p>

          <Slider
            label="Starts"
            min={0}
            max={Math.max(0.1, active.end - 0.2)}
            step={0.05}
            value={active.start}
            onChange={(v) => updateSelected({ start: v })}
            format={(v) => `${v.toFixed(2)}s`}
          />
          <Slider
            label="Ends"
            min={active.start + 0.2}
            max={recording.duration}
            step={0.05}
            value={active.end}
            onChange={(v) => updateSelected({ end: v })}
            format={(v) => `${v.toFixed(2)}s`}
          />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn small" onClick={() => updateSelected({ start: time })}>
              Start here
            </button>
            <button className="btn small" onClick={() => updateSelected({ end: time })}>
              End here
            </button>
          </div>

          <Slider
            label="Magnification"
            min={1.05}
            max={6}
            step={0.05}
            value={active.scale}
            onChange={(v) => updateSelected({ scale: v })}
            format={(v) => `${v.toFixed(2)}×`}
          />
          <Slider
            label="Ease in"
            min={0}
            max={2}
            step={0.05}
            value={active.easeIn}
            onChange={(v) => updateSelected({ easeIn: v })}
            format={(v) => `${v.toFixed(2)}s`}
          />
          <Slider
            label="Ease out"
            min={0}
            max={2}
            step={0.05}
            value={active.easeOut}
            onChange={(v) => updateSelected({ easeOut: v })}
            format={(v) => `${v.toFixed(2)}s`}
          />
          <button
            className="btn small"
            onClick={() => {
              onSegmentsChange(segments.filter((seg) => seg.id !== active.id))
              onSelect(null)
            }}
          >
            Delete this shot
          </button>
        </Group>
      ) : (
        <p className="hint">
          Click a shot on the zoom lane to edit it, or double-click the lane to add one. A shot can
          also be framed by dragging a box on the preview.
        </p>
      )}

      {zoom.enabled && autoCount === 0 && (
        <div className="notice" style={{ borderLeftColor: 'var(--violet)' }}>
          <strong>No automatic zooms in this take.</strong>
          <p style={{ margin: '6px 0 0', fontSize: 12, lineHeight: 1.55 }}>
            {clicks.length === 0 && scrolls.length === 0
              ? 'Nothing was clicked or scrolled while recording, so there is no action to zoom in on.'
              : `Found ${clicks.length} click${clicks.length === 1 ? '' : 's'} and ` +
                `${scrolls.length} scroll${scrolls.length === 1 ? '' : 's'}, but none produced a ` +
                'shot long enough to be worth making.'}{' '}
            Add one by double-clicking the zoom lane, or loosen the settings below.
          </p>
        </div>
      )}

      <Group title="Automatic zoom">
        <div className="stat-row">
          <span>
            <strong>{autoCount + segments.filter((s) => !s.auto).length}</strong> shots
          </span>
          <span>
            zoomed <strong>{zoomedPercent}%</strong> of the take
          </span>
        </div>
        <Toggle
          label="Enabled"
          checked={zoom.enabled}
          onChange={(v) => patch('zoom', { enabled: v })}
        />
        <div style={{ height: 8 }} />
        <Slider
          label="Maximum zoom"
          value={zoom.maxScale}
          min={1.2}
          max={4}
          step={0.05}
          onChange={(v) => patch('zoom', { maxScale: v })}
          format={(v) => `${v.toFixed(2)}×`}
        />
        <Slider
          label="Lead in"
          value={zoom.lead}
          min={0}
          max={1.5}
          onChange={(v) => patch('zoom', { lead: v })}
          format={(v) => `${v.toFixed(2)}s`}
        />
        <Slider
          label="Hold after"
          value={zoom.hold}
          min={0.3}
          max={4}
          onChange={(v) => patch('zoom', { hold: v })}
          format={(v) => `${v.toFixed(2)}s`}
        />
        <Slider
          label="Merge gap"
          value={zoom.mergeGap}
          min={0.2}
          max={4}
          onChange={(v) => patch('zoom', { mergeGap: v })}
          format={(v) => `${v.toFixed(2)}s`}
        />
        <Slider
          label="Opening wide shot"
          value={zoom.openingHold}
          min={0}
          max={5}
          step={0.1}
          onChange={(v) => patch('zoom', { openingHold: v })}
          format={(v) => (v === 0 ? 'off' : `${v.toFixed(1)}s`)}
        />
        <Slider
          label="Longest shot"
          value={zoom.maxShot}
          min={2}
          max={20}
          step={0.5}
          onChange={(v) => patch('zoom', { maxShot: v })}
          format={(v) => `${v.toFixed(1)}s`}
        />
        <Slider
          label="Stay zoomed between"
          value={zoom.bridgeGap}
          min={0}
          max={6}
          onChange={(v) => patch('zoom', { bridgeGap: v })}
          format={(v) => (v === 0 ? 'off' : `${v.toFixed(1)}s`)}
        />
        <Slider
          label="Ease in"
          value={zoom.easeIn}
          min={0.1}
          max={2}
          onChange={(v) => patch('zoom', { easeIn: v })}
          format={(v) => `${v.toFixed(2)}s`}
        />
        <Slider
          label="Ease out"
          value={zoom.easeOut}
          min={0.1}
          max={2}
          onChange={(v) => patch('zoom', { easeOut: v })}
          format={(v) => `${v.toFixed(2)}s`}
        />
        <Slider
          label="Follow cursor"
          value={zoom.follow}
          min={0}
          max={1}
          onChange={(v) => patch('zoom', { follow: v })}
          format={(v) => `${Math.round(v * 100)}%`}
        />
        <Slider
          label="Camera smoothing"
          value={zoom.smoothing}
          min={0}
          max={0.6}
          onChange={(v) => patch('zoom', { smoothing: v })}
          format={(v) => `${Math.round(v * 1000)}ms`}
        />
      </Group>

      <Group title="Triggers">
        {(
          [
            ['clicks', 'Clicks'],
            ['scrolls', 'Scrolling'],
            ['appSwitches', 'App switches'],
            ['dwell', 'Pointer arrives'],
            ['keys', 'Shortcuts']
          ] as const
        ).map(([key, label]) => (
          <Toggle
            key={key}
            label={label}
            checked={zoom.triggers[key]}
            onChange={(v) => patch('zoom', { triggers: { ...zoom.triggers, [key]: v } })}
          />
        ))}
      </Group>

      <Group title={active ? 'Selected zoom' : 'No zoom selected'}>
        {active ? (
          <>
            <Slider
              label="Zoom level"
              value={active.scale}
              min={1}
              max={5}
              step={0.05}
              onChange={(v) => updateSelected({ scale: v })}
              format={(v) => `${v.toFixed(2)}×`}
            />
            <Slider
              label="Ease in"
              value={active.easeIn}
              min={0.05}
              max={2}
              onChange={(v) => updateSelected({ easeIn: v })}
              format={(v) => `${v.toFixed(2)}s`}
            />
            <Slider
              label="Ease out"
              value={active.easeOut}
              min={0.05}
              max={2}
              onChange={(v) => updateSelected({ easeOut: v })}
              format={(v) => `${v.toFixed(2)}s`}
            />
            <Slider
              label="Follow cursor"
              value={active.follow}
              min={0}
              max={1}
              onChange={(v) => updateSelected({ follow: v })}
              format={(v) => `${Math.round(v * 100)}%`}
            />
            <button
              className="btn"
              style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}
              onClick={() => {
                onSegmentsChange(segments.filter((s) => s.id !== active.id))
                onSelect(null)
              }}
            >
              Delete zoom
            </button>
          </>
        ) : (
          <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6, margin: 0 }}>
            Click a block on the zoom track to adjust it, or double-click the empty track to add
            one. Editing a generated zoom converts it to a manual one so it survives regeneration.
          </p>
        )}
      </Group>
    </>
  )
}

// ---------------------------------------------------------------------------

function CursorTab({ project, patch }: { project: Project; patch: Patcher }): ReactNode {
  const { cursor } = project

  return (
    <>
      <Group title="Pointer">
        <Toggle
          label="Show cursor"
          checked={cursor.visible}
          onChange={(v) => patch('cursor', { visible: v })}
        />
        <div style={{ height: 10 }} />
        <span className="label">Style</span>
        <Segmented
          value={cursor.style}
          options={[
            { value: 'dark', label: 'Dark' },
            { value: 'light', label: 'Light' },
            { value: 'accent', label: 'Accent' }
          ]}
          onChange={(v) => patch('cursor', { style: v })}
        />
        <div style={{ height: 12 }} />
        <span className="label">Shape</span>
        <select
          value={cursor.shape}
          onChange={(e) => patch('cursor', { shape: e.target.value as CursorSettings['shape'] })}
        >
          <option value="auto">Auto (as recorded)</option>
          <option value="arrow">Arrow</option>
          <option value="pointingHand">Pointing hand</option>
          <option value="iBeam">Text I-beam</option>
          <option value="crosshair">Crosshair</option>
          <option value="resizeLeftRight">Resize</option>
        </select>
        <div style={{ height: 12 }} />
        <Slider
          label="Size"
          value={cursor.size}
          min={0.4}
          max={3}
          onChange={(v) => patch('cursor', { size: v })}
          format={(v) => `${v.toFixed(2)}×`}
        />
        <Slider
          label="Smoothing"
          value={cursor.smoothing}
          min={0}
          max={1}
          onChange={(v) => patch('cursor', { smoothing: v })}
          format={(v) => `${Math.round(v * 100)}%`}
        />
        <Toggle
          label="Snap to clicks"
          checked={cursor.clickAnchoring}
          onChange={(v) => patch('cursor', { clickAnchoring: v })}
        />
        <Toggle
          label="Return to start at end"
          checked={cursor.returnToStart}
          onChange={(v) => patch('cursor', { returnToStart: v })}
        />
        <div style={{ height: 8 }} />
        <Slider
          label="Hide when idle"
          value={cursor.idleHide}
          min={0}
          max={10}
          step={0.5}
          onChange={(v) => patch('cursor', { idleHide: v })}
          format={(v) => (v === 0 ? 'never' : `${v.toFixed(1)}s`)}
        />
      </Group>

      <Group title="Clicks">
        <Toggle
          label="Click effect"
          checked={cursor.clicks.enabled}
          onChange={(v) => patch('cursor', { clicks: { ...cursor.clicks, enabled: v } })}
        />
        <Toggle
          label="Press animation"
          checked={cursor.clicks.press}
          onChange={(v) => patch('cursor', { clicks: { ...cursor.clicks, press: v } })}
        />
        <div style={{ height: 8 }} />
        <Slider
          label="Ring size"
          value={cursor.clicks.radius}
          min={0.3}
          max={3}
          onChange={(v) => patch('cursor', { clicks: { ...cursor.clicks, radius: v } })}
          format={(v) => `${v.toFixed(2)}×`}
        />
        <Slider
          label="Ring duration"
          value={cursor.clicks.duration}
          min={0.15}
          max={1.5}
          onChange={(v) => patch('cursor', { clicks: { ...cursor.clicks, duration: v } })}
          format={(v) => `${v.toFixed(2)}s`}
        />
      </Group>

      <Group title="Spotlight">
        <Toggle
          label="Dim around pointer"
          checked={cursor.spotlight.enabled}
          onChange={(v) => patch('cursor', { spotlight: { ...cursor.spotlight, enabled: v } })}
        />
        {cursor.spotlight.enabled && (
          <>
            <div style={{ height: 8 }} />
            <Slider
              label="Radius"
              value={cursor.spotlight.radius}
              min={0.1}
              max={0.7}
              onChange={(v) => patch('cursor', { spotlight: { ...cursor.spotlight, radius: v } })}
              format={(v) => `${Math.round(v * 100)}%`}
            />
            <Slider
              label="Dimming"
              value={cursor.spotlight.dim}
              min={0.1}
              max={0.9}
              onChange={(v) => patch('cursor', { spotlight: { ...cursor.spotlight, dim: v } })}
              format={(v) => `${Math.round(v * 100)}%`}
            />
          </>
        )}
      </Group>
    </>
  )
}

// ---------------------------------------------------------------------------

function CameraTab({
  project,
  patch,
  recording,
  cameraSync,
  onCameraSync
}: Props & { patch: Patcher }): ReactNode {
  const { pip, keystrokes } = project
  const hasCamera = Boolean(recording.cameraURL)

  return (
    <>
      <Group title="Picture in picture">
        {!hasCamera && (
          <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6, marginTop: 0 }}>
            This take has no camera track. Pick a camera on the setup screen before recording.
          </p>
        )}
        <Toggle
          label="Show camera"
          checked={pip.enabled}
          onChange={(v) => patch('pip', { enabled: v })}
        />
        {pip.enabled && (
          <>
            <div style={{ height: 10 }} />
            <span className="label">Shape</span>
            <Segmented
              value={pip.shape}
              options={[
                { value: 'circle', label: 'Circle' },
                { value: 'rounded', label: 'Rounded' },
                { value: 'square', label: 'Square' }
              ]}
              onChange={(v) => patch('pip', { shape: v })}
            />
            <div style={{ height: 12 }} />
            <span className="label">Position</span>
            <Segmented
              value={pip.position}
              options={[
                { value: 'bottom-left', label: '◱' },
                { value: 'bottom-right', label: '◲' },
                { value: 'top-left', label: '◰' },
                { value: 'top-right', label: '◳' }
              ]}
              onChange={(v) => patch('pip', { position: v })}
            />
            <div style={{ height: 12 }} />
            <Slider
              label="Size"
              value={pip.size}
              min={0.1}
              max={0.55}
              onChange={(v) => patch('pip', { size: v })}
              format={(v) => `${Math.round(v * 100)}%`}
            />
            <Slider
              label="Margin"
              value={pip.margin}
              min={0}
              max={0.15}
              onChange={(v) => patch('pip', { margin: v })}
              format={(v) => `${Math.round(v * 100)}%`}
            />
            <Slider
              label="Face zoom"
              value={pip.zoom}
              min={1}
              max={2.5}
              onChange={(v) => patch('pip', { zoom: v })}
              format={(v) => `${v.toFixed(2)}×`}
            />
            <Slider
              label="Frame X"
              value={pip.offsetX}
              min={-0.4}
              max={0.4}
              onChange={(v) => patch('pip', { offsetX: v })}
              format={(v) => v.toFixed(2)}
            />
            <Slider
              label="Frame Y"
              value={pip.offsetY}
              min={-0.4}
              max={0.4}
              onChange={(v) => patch('pip', { offsetY: v })}
              format={(v) => v.toFixed(2)}
            />
            <Toggle
              label="Mirror"
              checked={pip.mirror}
              onChange={(v) => patch('pip', { mirror: v })}
            />
            <Toggle
              label="Move aside for pointer"
              checked={pip.avoidCursor}
              onChange={(v) => patch('pip', { avoidCursor: v })}
            />
            <p className="hint">
              For a blurred background behind you, turn on <strong>Portrait</strong> in the macOS
              menu bar: Control Centre → Video Effects, while recording. It applies to the camera
              itself, so it is baked into the take.
            </p>
            <div style={{ height: 10 }} />
            <Slider
              label="Sync offset"
              value={cameraSync}
              min={-2}
              max={2}
              step={0.01}
              onChange={onCameraSync}
              format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(2)}s`}
            />
          </>
        )}
      </Group>

      <Group title="Keyboard shortcuts">
        <Toggle
          label="Show shortcuts"
          checked={keystrokes.enabled}
          onChange={(v) => patch('keystrokes', { enabled: v })}
        />
        {recording.input.keys.length === 0 && (
          <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6, marginBottom: 0 }}>
            No shortcuts were captured in this take.
          </p>
        )}
        {keystrokes.enabled && (
          <>
            <div style={{ height: 8 }} />
            <span className="label">Position</span>
            <Segmented
              value={keystrokes.position}
              options={[
                { value: 'bottom', label: 'Bottom' },
                { value: 'top', label: 'Top' }
              ]}
              onChange={(v) => patch('keystrokes', { position: v })}
            />
          </>
        )}
      </Group>

      <Group title="Audio">
        <Slider
          label="System audio"
          value={project.audio.systemGain}
          min={0}
          max={2}
          onChange={(v) => patch('audio', { systemGain: v })}
          format={(v) => `${Math.round(v * 100)}%`}
        />
        <Slider
          label="Microphone"
          value={project.audio.micGain}
          min={0}
          max={2}
          onChange={(v) => patch('audio', { micGain: v })}
          format={(v) => `${Math.round(v * 100)}%`}
        />
      </Group>

      <Group title="Music">
        <p className="hint" style={{ marginTop: 0 }}>
          Plays under the whole piece, title cards included, and gets out of the
          way whenever there is a caption.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <button
            className="btn small"
            onClick={() => {
              void api.pickAudio().then((src) => {
                if (src) patch('music', { src })
              })
            }}
          >
            {project.music.src ? 'Change track…' : 'Add music…'}
          </button>
          {project.music.src && (
            <button className="btn small ghost" onClick={() => patch('music', { src: null })}>
              Remove
            </button>
          )}
        </div>
        {project.music.src && (
          <>
            <p className="hint mono" style={{ marginTop: 0 }}>
              {project.music.src.split('/').pop()}
            </p>
            <Slider
              label="Level"
              value={project.music.gain}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) => patch('music', { gain: v })}
              format={(v) => `${Math.round(v * 100)}%`}
            />
            <Slider
              label="Duck under speech"
              value={project.music.duckDb}
              min={0}
              max={30}
              step={1}
              onChange={(v) => patch('music', { duckDb: v })}
              format={(v) => (v === 0 ? 'Off' : `−${Math.round(v)} dB`)}
            />
            <Slider
              label="Fade in"
              value={project.music.fadeIn}
              min={0}
              max={8}
              step={0.1}
              onChange={(v) => patch('music', { fadeIn: v })}
              format={(v) => (v === 0 ? 'Cut' : `${v.toFixed(1)}s`)}
            />
            <Slider
              label="Fade out"
              value={project.music.fadeOut}
              min={0}
              max={8}
              step={0.1}
              onChange={(v) => patch('music', { fadeOut: v })}
              format={(v) => (v === 0 ? 'Cut' : `${v.toFixed(1)}s`)}
            />
            <Slider
              label="Start at"
              value={project.music.startAt}
              min={0}
              max={120}
              step={1}
              onChange={(v) => patch('music', { startAt: v })}
              format={(v) => (v === 0 ? 'Beginning' : formatTime(v))}
            />
            <Toggle
              label="Repeat if it runs out"
              checked={project.music.loop}
              onChange={(v) => patch('music', { loop: v })}
            />
          </>
        )}
      </Group>
    </>
  )
}

function swatchCSS(colors: string[], angle: number): string {
  if (colors.length === 1) return colors[0]
  return `linear-gradient(${angle + 90}deg, ${colors.join(', ')})`
}

// ---------------------------------------------------------------------------

/**
 * Transcription and caption styling.
 *
 * The transcript is the recording's, not a separate asset: cues become
 * captions, and captions are just timed text the composition draws. Editing one
 * is editing the project, so a corrected word survives an export without
 * re-transcribing anything.
 */
function CaptionsTab({
  project,
  recording,
  set,
  patch,
  time,
  selectedCaption,
  onSelectCaption
}: Props & { set: Setter; patch: Patcher }): ReactNode {
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const style = project.captionStyle
  const captions = project.captions

  useEffect(() => api.onTranscribeProgress(setProgress), [])

  const transcribe = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    setProgress(0)
    try {
      const { cues, source } = await api.transcribe(recording.dir, navigator.language || 'en-GB')
      if (cues.length === 0) {
        setError(
          // "Nothing was found" is true and useless. The usual cause is that
          // the microphone was not part of the take at all, and the fix is a
          // setting on the *next* recording rather than anything to try here.
          'No speech was heard. The narration comes from the microphone track, ' +
            'so check a microphone was selected when this was recorded — system ' +
            'audio alone is not transcribed.'
        )
      } else {
        // The camera track begins after the screen track, so words timed
        // against it are early against the editor's clock by that difference.
        const shift = source === 'camera' ? recording.cameraOffset : 0
        set(
          'captions',
          captionsFromCues(
            cues.map((cue) => ({ ...cue, start: cue.start + shift, end: cue.end + shift }))
          )
        )
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  const updateCaption = (id: string, changes: Partial<Caption>): void =>
    set(
      'captions',
      captions.map((caption) => (caption.id === id ? { ...caption, ...changes } : caption))
    )

  const current = captions.find((caption) => caption.id === selectedCaption) ?? null

  /** A new line at the playhead, ready to type into. */
  const addLine = (): void => {
    const start = Math.max(0, Math.min(time, recording.duration - 0.5))
    // Stops where the next line begins, so a new caption never overlaps one
    // that is already there.
    const next = captions.find((caption) => caption.start > start)
    const end = Math.min(next ? next.start : start + 2.5, recording.duration)
    const line: Caption = { id: `manual-${Math.round(start * 1000)}`, start, end, text: 'New line' }
    set(
      'captions',
      [...captions, line].sort((a, b) => a.start - b.start)
    )
    onSelectCaption(line.id)
  }

  return (
    <>
      <Group title="Transcript">
        {captions.length === 0 ? (
          <>
            <p className="hint">
              Transcribes the narration on this Mac. Nothing is uploaded, and the first run for a
              language may pause while macOS fetches its speech model.
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn primary" disabled={busy} onClick={() => void transcribe()}>
                {busy ? `Transcribing… ${Math.round(progress * 100)}%` : 'Transcribe narration'}
              </button>
              <button className="btn" onClick={addLine}>
                Add a line
              </button>
            </div>
          </>
        ) : (
          <>
            <span className="label">
              {captions.length} lines · click one on the timeline to edit it
            </span>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn small primary" onClick={addLine}>
                Add a line
              </button>
              <button className="btn small" disabled={busy} onClick={() => void transcribe()}>
                {busy ? `${Math.round(progress * 100)}%` : 'Redo'}
              </button>
              <button
                className="btn small"
                onClick={() => {
                  set('captions', [])
                  onSelectCaption(null)
                }}
              >
                Clear
              </button>
            </div>
          </>
        )}
        {error && (
          <p className="hint" style={{ color: 'var(--danger)' }}>
            {error}
          </p>
        )}
      </Group>

      {current && (
        <Group title="Selected line">
          <textarea
            className="caption-text"
            value={current.text}
            rows={3}
            onChange={(e) => updateCaption(current.id, { text: e.target.value })}
          />
          <span className="label">
            {current.start.toFixed(2)}s → {current.end.toFixed(2)}s
          </span>
          <Slider
            label="Starts"
            min={0}
            max={Math.max(0.1, current.end - 0.15)}
            step={0.05}
            value={current.start}
            onChange={(v) => updateCaption(current.id, { start: v })}
            format={(v) => `${v.toFixed(2)}s`}
          />
          <Slider
            label="Ends"
            min={current.start + 0.15}
            max={recording.duration}
            step={0.05}
            value={current.end}
            onChange={(v) => updateCaption(current.id, { end: v })}
            format={(v) => `${v.toFixed(2)}s`}
          />
          <button
            className="btn small"
            onClick={() => {
              set(
                'captions',
                captions.filter((caption) => caption.id !== current.id)
              )
              onSelectCaption(null)
            }}
          >
            Delete line
          </button>
        </Group>
      )}

      <Group title="Type">
        <Toggle
          label="Show captions"
          checked={style.enabled}
          onChange={(v) => patch('captionStyle', { enabled: v })}
        />
        <span className="label">Font</span>
        <select
          value={style.fontFamily}
          onChange={(e) => patch('captionStyle', { fontFamily: e.target.value })}
        >
          {CAPTION_FONTS.map((font) => (
            <option key={font} value={font}>
              {font}
            </option>
          ))}
        </select>
        <Slider
          label="Size"
          min={18}
          max={110}
          step={1}
          value={style.fontSize}
          onChange={(v) => patch('captionStyle', { fontSize: v })}
          format={(v) => `${Math.round(v)}pt`}
        />
        <Slider
          label="Weight"
          min={300}
          max={800}
          step={100}
          value={style.weight}
          onChange={(v) => patch('captionStyle', { weight: v })}
          format={(v) => String(Math.round(v))}
        />
        <div className="row-between">
          <span className="label">Colour</span>
          <input
            type="color"
            value={style.color}
            onChange={(e) => patch('captionStyle', { color: e.target.value })}
          />
        </div>
        <Toggle
          label="Upper case"
          checked={style.uppercase}
          onChange={(v) => patch('captionStyle', { uppercase: v })}
        />
      </Group>

      <Group title="Position">
        <span className="label">Align</span>
        <Segmented
          value={style.align}
          options={[
            { value: 'left', label: 'Left' },
            { value: 'center', label: 'Centre' },
            { value: 'right', label: 'Right' }
          ]}
          onChange={(v) => patch('captionStyle', { align: v as 'left' | 'center' | 'right' })}
        />
        <Slider
          label="Across"
          min={0.05}
          max={0.95}
          step={0.01}
          value={style.x}
          onChange={(v) => patch('captionStyle', { x: v })}
          format={(v) => `${Math.round(v * 100)}%`}
        />
        <Slider
          label="Down"
          min={0.1}
          max={0.97}
          step={0.01}
          value={style.y}
          onChange={(v) => patch('captionStyle', { y: v })}
          format={(v) => `${Math.round(v * 100)}%`}
        />
        <Slider
          label="Line width"
          min={0.3}
          max={0.98}
          step={0.02}
          value={style.maxWidth}
          onChange={(v) => patch('captionStyle', { maxWidth: v })}
          format={(v) => `${Math.round(v * 100)}%`}
        />
        <Slider
          label="Line spacing"
          min={1}
          max={1.8}
          step={0.02}
          value={style.lineHeight}
          onChange={(v) => patch('captionStyle', { lineHeight: v })}
          format={(v) => v.toFixed(2)}
        />
      </Group>

      <Group title="Legibility">
        <Slider
          label="Outline"
          min={0}
          max={16}
          step={0.5}
          value={style.outlineWidth}
          onChange={(v) => patch('captionStyle', { outlineWidth: v })}
          format={(v) => (v === 0 ? 'None' : `${v}px`)}
        />
        <div className="row-between">
          <span className="label">Outline colour</span>
          <input
            type="color"
            value={style.outlineColor}
            onChange={(e) => patch('captionStyle', { outlineColor: e.target.value })}
          />
        </div>
        <Slider
          label="Shadow"
          min={0}
          max={48}
          step={1}
          value={style.shadowBlur}
          onChange={(v) => patch('captionStyle', { shadowBlur: v })}
          format={(v) => (v === 0 ? 'None' : `${Math.round(v)}px`)}
        />
        <Slider
          label="Shadow drop"
          min={0}
          max={16}
          step={1}
          value={style.shadowOffset}
          onChange={(v) => patch('captionStyle', { shadowOffset: v })}
          format={(v) => `${Math.round(v)}px`}
        />
        <Slider
          label="Backing plate"
          min={0}
          max={1}
          step={0.05}
          value={style.boxOpacity}
          onChange={(v) => patch('captionStyle', { boxOpacity: v })}
          format={(v) => (v === 0 ? 'Off' : `${Math.round(v * 100)}%`)}
        />
        {style.boxOpacity > 0 && (
          <div className="row-between">
            <span className="label">Plate colour</span>
            <input
              type="color"
              value={style.boxColor}
              onChange={(e) => patch('captionStyle', { boxColor: e.target.value })}
            />
          </div>
        )}
        <Slider
          label="Fade"
          min={0}
          max={0.5}
          step={0.02}
          value={style.fade}
          onChange={(v) => patch('captionStyle', { fade: v })}
          format={(v) => (v === 0 ? 'Cut' : `${v.toFixed(2)}s`)}
        />
      </Group>
    </>
  )
}

// ---------------------------------------------------------------------------

/**
 * Intro and outro cards.
 *
 * They are time either side of the recording rather than separate clips, so the
 * only things to decide are how long, what it says, and what it looks like.
 */
function TitlesTab({ project, patch }: { project: Project; patch: Patcher }): ReactNode {
  const card = (which: 'intro' | 'outro'): ReactNode => {
    const value = project[which]
    const set = (changes: Partial<typeof value>): void => patch(which, changes)
    return (
      <Group title={which === 'intro' ? 'Intro' : 'Outro'}>
        <Toggle
          label={which === 'intro' ? 'Show before the recording' : 'Show after the recording'}
          checked={value.enabled}
          onChange={(v) => set({ enabled: v })}
        />
        {value.enabled && (
          <>
            <span className="label">Title</span>
            <input
              className="text-input"
              value={value.title}
              placeholder={which === 'intro' ? 'What this shows' : 'Thanks for watching'}
              onChange={(e) => set({ title: e.target.value })}
            />
            <span className="label">Subtitle</span>
            <input
              className="text-input"
              value={value.subtitle}
              placeholder={which === 'intro' ? 'Your name, or the date' : 'Where to find you'}
              onChange={(e) => set({ subtitle: e.target.value })}
            />
            <Slider
              label="Holds for"
              min={0.5}
              max={8}
              step={0.1}
              value={value.seconds}
              onChange={(v) => set({ seconds: v })}
              format={(v) => `${v.toFixed(1)}s`}
            />
            <span className="label">Font</span>
            <select
              value={value.fontFamily ?? DEFAULT_INTRO.fontFamily}
              onChange={(e) => set({ fontFamily: e.target.value })}
            >
              {CAPTION_FONTS.map((font) => (
                <option key={font} value={font}>
                  {font}
                </option>
              ))}
            </select>
            <Slider
              label="Title size"
              min={28}
              max={160}
              step={2}
              value={value.titleSize}
              onChange={(v) => set({ titleSize: v })}
              format={(v) => `${Math.round(v)}pt`}
            />
            <Slider
              label="Subtitle size"
              min={14}
              max={90}
              step={1}
              value={value.subtitleSize}
              onChange={(v) => set({ subtitleSize: v })}
              format={(v) => `${Math.round(v)}pt`}
            />
            <div className="row-between">
              <span className="label">Text</span>
              <input
                type="color"
                value={value.color}
                onChange={(e) => set({ color: e.target.value })}
              />
            </div>
            <div className="row-between">
              <span className="label">Background</span>
              <input
                type="color"
                value={value.background}
                onChange={(e) => set({ background: e.target.value })}
              />
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                className="btn small"
                onClick={() => {
                  void api.pickImage().then((src) => {
                    if (src) set({ backgroundSrc: src })
                  })
                }}
              >
                {value.backgroundSrc ? 'Change picture…' : 'Background picture…'}
              </button>
              {value.backgroundSrc && (
                <button className="btn small ghost" onClick={() => set({ backgroundSrc: null })}>
                  Remove
                </button>
              )}
            </div>
            {value.backgroundSrc && (
              <>
                <span className="label">Fit</span>
                <select
                  value={value.backgroundFit ?? 'cover'}
                  onChange={(e) => set({ backgroundFit: e.target.value as 'cover' | 'contain' })}
                >
                  <option value="cover">Fill the frame (crops)</option>
                  <option value="contain">Fit the whole picture</option>
                </select>
                <Slider
                  label="Dim"
                  min={0}
                  max={0.9}
                  step={0.05}
                  value={value.backgroundDim ?? 0.45}
                  onChange={(v) => set({ backgroundDim: v })}
                  format={(v) => (v < 0.01 ? 'None' : `${Math.round(v * 100)}%`)}
                />
              </>
            )}
            <Slider
              label="Fade"
              min={0}
              max={1.5}
              step={0.05}
              value={value.fade}
              onChange={(v) => set({ fade: v })}
              format={(v) => (v === 0 ? 'Cut' : `${v.toFixed(2)}s`)}
            />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                className="btn small"
                onClick={() => {
                  void api.pickImage().then((src) => {
                    if (src) set({ imageSrc: src })
                  })
                }}
              >
                {value.imageSrc ? 'Change logo…' : 'Add a logo…'}
              </button>
              {value.imageSrc && (
                <button className="btn small ghost" onClick={() => set({ imageSrc: null })}>
                  Remove
                </button>
              )}
            </div>
            {value.imageSrc && (
              <Slider
                label="Logo height"
                min={60}
                max={420}
                step={5}
                value={value.imageHeight}
                onChange={(v) => set({ imageHeight: v })}
                format={(v) => `${Math.round(v)}px`}
              />
            )}
          </>
        )}
      </Group>
    )
  }

  return (
    <>
      <p className="hint">
        Cards are extra time either side of the recording, not separate clips — so they scrub,
        preview and export exactly like the rest of it.
      </p>
      {card('intro')}
      {card('outro')}
    </>
  )
}
