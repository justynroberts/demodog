// MIT License - Copyright (c) fintonlabs.com
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { api } from '../api'
import {
  BACKGROUND_PRESETS,
  OUTPUT_PRESETS,
  defaultProject,
  lookOf,
  mergeSettings
} from '../engine/defaults'
import { Group, Segmented, Slider, Toggle, formatTime } from '../ui/controls'
import {
  CAPTION_FONTS,
  captionsFromCues,
  mergeCaptions,
  shortenCaptions,
  splitCaptionAtWord,
  wordIndexAtCursor
} from '../engine/captions'
import type { Caption } from '../engine/captions'
import {
  ANNOTATION_COLORS,
  ANNOTATION_LABELS,
  type Annotation,
  type AnnotationKind
} from '../engine/annotations'
import { DEFAULT_INTRO } from '../engine/titles'
import type { CursorSettings, Project, Recording, ZoomSegment } from '../engine/types'

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
  /** Armed from the Annotate tab: the next drag on the preview places this kind of mark. */
  annotating: { kind: AnnotationKind; replace?: string } | null
  onAnnotate: (armed: { kind: AnnotationKind; replace?: string } | null) => void
  /** The mark selected on the timeline or in the list, if any. */
  selectedNote: string | null
  onSelectNote: (id: string | null) => void
  /** The caption clicked on the timeline, if any. */
  selectedCaption: string | null
  onSelectCaption: (id: string | null) => void
}

type Tab = 'style' | 'zoom' | 'cursor' | 'camera' | 'audio' | 'text' | 'annotate' | 'titles'

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
    id: 'audio',
    name: 'Audio',
    hint: 'Levels for the recording and the microphone, and a music bed under it all.',
    icon: (
      <>
        <path d="M9 18V6l10-2v12" />
        <circle cx="6.5" cy="18" r="2.5" />
        <circle cx="16.5" cy="16" r="2.5" />
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
    id: 'annotate',
    name: 'Annotate',
    hint: 'Arrows, boxes and highlights — and blur or pixelate to hide something.',
    icon: (
      <>
        <rect x="3" y="4" width="12" height="10" rx="1.5" />
        <path d="M13 12l7.5 7.5M20.5 19.5h-4.5M20.5 19.5V15" />
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
  const bodyRef = useRef<HTMLDivElement>(null)
  // A new tab starts at its top. Carrying the last one's scroll position into
  // it lands you in the middle of settings you have not seen.
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 })
  }, [tab])
  /** Whichever tab the pointer is over, so the caption can preview it. */
  const [hovered, setHovered] = useState<Tab | null>(null)

  // Shallow-merge helpers keep the call sites readable while preserving the
  // immutable update React needs to see.
  const set = <K extends keyof Project>(key: K, value: Project[K]): void =>
    onChange({ ...project, [key]: value })

  const patch = <K extends keyof Project>(key: K, value: Partial<Project[K]>): void =>
    onChange({ ...project, [key]: { ...(project[key] as object), ...value } as Project[K] })

  const described = TABS.find((t) => t.id === (hovered ?? tab)) ?? TABS[0]

  // A mark picked on the timeline opens the tab that edits it.
  useEffect(() => {
    if (props.selectedNote) setTab('annotate')
  }, [props.selectedNote])

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

      <div className="insp-body" ref={bodyRef}>
        {tab === 'style' && (
          <StyleTab
            project={project}
            set={set}
            patch={patch}
            // Applied in one update; setting each key in turn would read stale
            // state and only the last change would survive.
            apply={(settings) => onChange(mergeSettings(project, settings))}
            recording={props.recording}
          />
        )}
        {tab === 'zoom' && <ZoomTab {...props} patch={patch} />}
        {tab === 'cursor' && <CursorTab project={project} patch={patch} />}
        {tab === 'camera' && <CameraTab {...props} patch={patch} />}
        {tab === 'audio' && <AudioTab project={project} patch={patch} />}
        {tab === 'text' && <CaptionsTab {...props} set={set} patch={patch} />}
        {tab === 'annotate' && <AnnotateTab {...props} set={set} />}
        {tab === 'titles' && <TitlesTab project={project} patch={patch} />}
      </div>
    </aside>
  )
}

// ---------------------------------------------------------------------------

type Setter = <K extends keyof Project>(key: K, value: Project[K]) => void

const TOOL_ICONS: Record<AnnotationKind, ReactNode> = {
  arrow: <path d="M5 19L18 6M18 6h-7M18 6v7" />,
  box: <rect x="4" y="6" width="16" height="12" rx="2" />,
  highlight: (
    <>
      <rect x="4" y="8" width="16" height="8" rx="1.5" />
      <path d="M7 12h10" />
    </>
  ),
  focus: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="12" cy="12" r="4" />
    </>
  ),
  blur: (
    <>
      <circle cx="8" cy="9" r="2.5" />
      <circle cx="15.5" cy="8" r="2" />
      <circle cx="12" cy="15.5" r="3" />
    </>
  ),
  pixelate: (
    <>
      <rect x="4" y="4" width="7" height="7" />
      <rect x="13" y="13" width="7" height="7" />
      <path d="M13 4h7v7M4 13h7v7" />
    </>
  )
}

const ANNOTATION_KINDS: AnnotationKind[] = ['arrow', 'box', 'highlight', 'focus', 'blur', 'pixelate']

/**
 * Marks placed on the recording after the fact.
 *
 * Choosing a kind arms the preview: the next drag there places it, starting at
 * the playhead. Timing is adjusted on the Marks lane or here; the region is
 * redrawn rather than dragged, which is one precise gesture instead of eight
 * fiddly handles.
 */
function AnnotateTab({
  project,
  set,
  time,
  recording,
  annotating,
  onAnnotate,
  selectedNote,
  onSelectNote
}: Props & { set: Setter }): ReactNode {
  const notes = project.annotations ?? []
  const current = notes.find((note) => note.id === selectedNote) ?? null
  const update = (id: string, changes: Partial<Annotation>): void =>
    set(
      'annotations',
      notes.map((note) => (note.id === id ? { ...note, ...changes } : note))
    )
  const armedLabel = annotating ? ANNOTATION_LABELS[annotating.kind].toLowerCase() : ''

  return (
    <>
      <Group title="Add a mark" span>
        <div className="annotate-tools">
          {ANNOTATION_KINDS.map((kind) => {
            const armed = annotating?.kind === kind && !annotating.replace
            return (
              <button
                key={kind}
                className={`btn tool${armed ? ' armed' : ''}`}
                aria-pressed={armed}
                onClick={() => onAnnotate(armed ? null : { kind })}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  {TOOL_ICONS[kind]}
                </svg>
                <span>{ANNOTATION_LABELS[kind]}</span>
              </button>
            )
          })}
        </div>
        <p className="hint">
          {annotating
            ? annotating.replace
              ? `Drag on the preview to redraw the ${armedLabel}. Esc to cancel.`
              : `Drag on the preview to place the ${armedLabel}. Esc to cancel.`
            : 'Choose one, then drag on the preview. It starts at the playhead and lasts three seconds — drag its ends on the Marks lane to change that.'}
        </p>
        <p className="hint">
          Blur and pixelate never fade in or out, so what they hide is covered from their first
          frame to their last.
        </p>
      </Group>

      {notes.length > 0 && (
        <Group title={`${notes.length} ${notes.length === 1 ? 'mark' : 'marks'}`} span>
          <div className="note-list">
            {notes.map((note) => (
              <button
                key={note.id}
                className={`note-row${note.id === selectedNote ? ' selected' : ''}`}
                onClick={() => onSelectNote(note.id)}
              >
                <span>{ANNOTATION_LABELS[note.kind]}</span>
                <span className="mono">
                  {note.start.toFixed(1)}–{note.end.toFixed(1)}s
                </span>
              </button>
            ))}
          </div>
        </Group>
      )}

      {current && (
        <Group title={`Selected ${ANNOTATION_LABELS[current.kind].toLowerCase()}`} span>
          <Slider
            label="Starts"
            min={0}
            max={Math.max(0.1, current.end - 0.2)}
            step={0.05}
            value={current.start}
            onChange={(v) => update(current.id, { start: v })}
            format={(v) => `${v.toFixed(2)}s`}
          />
          <Slider
            label="Ends"
            min={current.start + 0.2}
            max={recording.duration}
            step={0.05}
            value={current.end}
            onChange={(v) => update(current.id, { end: v })}
            format={(v) => `${v.toFixed(2)}s`}
          />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              className="btn small"
              onClick={() =>
                update(current.id, { start: Math.max(0, Math.min(time, current.end - 0.2)) })
              }
            >
              Start at playhead
            </button>
            <button
              className="btn small"
              onClick={() =>
                update(current.id, {
                  end: Math.min(recording.duration, Math.max(time, current.start + 0.2))
                })
              }
            >
              End at playhead
            </button>
          </div>

          {(current.kind === 'arrow' || current.kind === 'box' || current.kind === 'highlight') && (
            <>
              <span className="label">Colour</span>
              <div className="swatch-row">
                {ANNOTATION_COLORS.map((color) => (
                  <button
                    key={color}
                    aria-label={color}
                    aria-pressed={current.color.toLowerCase() === color}
                    style={{ background: color }}
                    onClick={() => update(current.id, { color })}
                  />
                ))}
              </div>
            </>
          )}
          {(current.kind === 'arrow' || current.kind === 'box') && (
            <Slider
              label="Thickness"
              min={2}
              max={20}
              step={1}
              value={current.width}
              onChange={(v) => update(current.id, { width: Math.round(v) })}
              format={(v) => `${Math.round(v)}px`}
            />
          )}
          {current.kind === 'focus' && (
            <Slider
              label="Dim the rest"
              min={0.2}
              max={0.85}
              step={0.05}
              value={current.amount}
              onChange={(v) => update(current.id, { amount: v })}
              format={(v) => `${Math.round(v * 100)}%`}
            />
          )}
          {(current.kind === 'blur' || current.kind === 'pixelate') && (
            <Slider
              label={current.kind === 'blur' ? 'Blur' : 'Block size'}
              min={4}
              max={40}
              step={1}
              value={current.amount}
              onChange={(v) => update(current.id, { amount: Math.round(v) })}
              format={(v) => `${Math.round(v)}px`}
            />
          )}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              className="btn small"
              onClick={() => onAnnotate({ kind: current.kind, replace: current.id })}
            >
              Redraw on preview
            </button>
            <button
              className="btn small"
              onClick={() => {
                set(
                  'annotations',
                  notes.filter((note) => note.id !== current.id)
                )
                onSelectNote(null)
              }}
            >
              Delete
            </button>
          </div>
        </Group>
      )}
    </>
  )
}
type Patcher = <K extends keyof Project>(key: K, value: Partial<Project[K]>) => void

/**
 * Where the look comes from, and how to abandon it.
 *
 * There is no profile to pick or save. Every change here is written to
 * `rememberLook` as it is made and merged into the next take, so how the app was
 * left *is* the setting — which is what people expected of the starred profile
 * anyway, and it cannot go stale because there is only one copy of it.
 *
 * The one thing that removes is a way back, hence this button: the sticky look
 * is only worth having if it is cheap to abandon.
 */
function Look({ onReset }: { onReset: () => void }): ReactNode {
  return (
    <Group title="Look" span>
      <p style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.5, margin: 0 }}>
        Background, frame, zoom, cursor, camera, audio, titles and music carry over to your next
        recording automatically. Nothing to save.
      </p>
      <div style={{ height: 10 }} />
      <button
        className="btn"
        style={{ width: '100%', justifyContent: 'center' }}
        onClick={onReset}
        title="Put every look setting back to how the app shipped"
      >
        Reset to defaults
      </button>
    </Group>
  )
}

function StyleTab({
  project,
  set,
  patch,
  apply,
  recording
}: {
  project: Project
  set: Setter
  patch: Patcher
  apply: (settings: Partial<Project>) => void
  recording: Recording
}): ReactNode {
  const { frame, background, output } = project

  return (
    <>
      <Look
        onReset={() =>
          // Only the look. `defaultProject` also carries empty `segments` and
          // `captions`, and merging those in would throw away the zoom edits and
          // the transcript along with the colours.
          apply(
            lookOf(defaultProject(recording.source, Boolean(recording.cameraURL))) as Partial<Project>
          )
        }
      />

      <Group title="Background" span>
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
        <Group span title={active.auto ? 'Selected shot (automatic)' : 'Selected shot'}>
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
          <option value="openHand">Open hand</option>
          <option value="closedHand">Grabbing hand</option>
          <option value="iBeam">Text I-beam</option>
          <option value="crosshair">Crosshair</option>
          <option value="resizeLeftRight">Resize ↔</option>
          <option value="resizeUpDown">Resize ↕</option>
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

    </>
  )
}

/**
 * Everything you can hear, in one place.
 *
 * These lived at the bottom of the Camera tab, below the bubble's shape and
 * position — so the music controls were two scrolls past anything about music,
 * and were found by accident if at all. A panel wide enough to show two
 * columns of settings is what makes a seventh tab affordable.
 */
function AudioTab({ project, patch }: { project: Project; patch: Patcher }): ReactNode {
  return (
    <>
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
            <Toggle
              label="Duck under speech"
              checked={project.music.duckDb > 0}
              onChange={(v) => patch('music', { duckDb: v ? 12 : 0 })}
            />
            {project.music.duckDb > 0 && (
              <>
                <Slider
                  label="How far it drops"
                  value={project.music.duckDb}
                  min={3}
                  max={30}
                  step={1}
                  onChange={(v) => patch('music', { duckDb: v })}
                  format={(v) => `−${Math.round(v)} dB`}
                />
                <p className="hint" style={{ marginTop: -4 }}>
                  Follows the transcript, so it needs captions to duck against.
                </p>
              </>
            )}
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

/**
 * English, in this Mac's region where that exists.
 *
 * Deliberately not the interface language. A Dutch speaker narrating in English
 * is ordinary, and taking the system language meant asking the recogniser for
 * Dutch and getting an empty transcript back — a wrong answer that looks like a
 * broken feature. Guessing English and being wrong costs one dropdown.
 */
function defaultSpokenLocale(): string {
  const region = new Intl.Locale(navigator.language || 'en-GB').region
  return region ? `en-${region}` : 'en-GB'
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

  /**
   * The language being spoken, which is not the language the Mac is set to.
   *
   * This was `navigator.language`, so a Dutch machine asked for Dutch however
   * plainly the person was speaking English — and got nothing back, which
   * looks exactly like a broken recogniser. Remembered, because someone who
   * narrates in English on a Dutch Mac will do it every time.
   */
  const [locales, setLocales] = useState<string[]>([])
  const [locale, setLocale] = useState<string>(
    // English by default rather than the system language. Narration is in
    // English far more often than a Mac is set to English, and being wrong in
    // that direction costs a dropdown; being wrong the other way returns an
    // empty transcript with nothing to explain it.
    () => localStorage.getItem('demodog-speech-locale') || defaultSpokenLocale()
  )
  useEffect(() => {
    void api.speechLocales().then((list) => {
      setLocales(list)
      // Keep the remembered choice if this Mac still offers it; otherwise the
      // interface language, then anything in the same language, then English.
      setLocale((current) => {
        if (list.includes(current)) return current
        // This region's English if it exists — but named fallbacks after that,
        // not simply the first English in the list. On a Dutch Mac "en-NL" does
        // not exist and the first English happens to be en-AE, which is a
        // stranger answer than either of the two everyone means.
        for (const wanted of [defaultSpokenLocale(), 'en-GB', 'en-US']) {
          const match = list.find((l) => l === wanted)
          if (match) return match
        }
        return list.find((l) => l.startsWith('en')) ?? current
      })
    })
  }, [])
  useEffect(() => {
    localStorage.setItem('demodog-speech-locale', locale)
  }, [locale])

  /** "en-GB" as "English (United Kingdom)", where the platform can say so. */
  const localeName = (tag: string): string => {
    try {
      return new Intl.DisplayNames([navigator.language], { type: 'language' }).of(tag) ?? tag
    } catch {
      return tag
    }
  }

  const transcribe = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    setProgress(0)
    try {
      const { cues, source } = await api.transcribe(recording.dir, locale)
      if (cues.length === 0) {
        setError(
          // "Nothing was found" is true and useless. The usual cause is that
          // the microphone was not part of the take at all, and the fix is a
          // setting on the *next* recording rather than anything to try here.
          `No speech was heard in ${localeName(locale)}. If the narration is in ` +
            'another language, choose it above and try again. Otherwise check a ' +
            'microphone was selected when this was recorded, since system audio ' +
            'on its own is not transcribed.'
        )
      } else {
        // The camera track begins after the screen track, so words timed
        // against it are early against the editor's clock by that difference.
        const shift = source === 'camera' ? recording.cameraOffset : 0
        set(
          'captions',
          captionsFromCues(
            cues.map((cue) => ({
              ...cue,
              start: cue.start + shift,
              end: cue.end + shift,
              words: cue.words?.map((w) => ({ ...w, start: w.start + shift, end: w.end + shift }))
            })),
            { maxChars: style.maxChars }
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
  const currentIndex = current ? captions.indexOf(current) : -1
  const following = currentIndex >= 0 ? (captions[currentIndex + 1] ?? null) : null

  /**
   * Where the text cursor is in the selected line, kept as state so the Split
   * button can say whether a split there is possible before it is pressed.
   */
  const textRef = useRef<HTMLTextAreaElement>(null)
  const [caret, setCaret] = useState(0)
  const splitIndex = current ? wordIndexAtCursor(current.text, caret) : null

  /** Splits the selected line at the cursor and moves on to the second half. */
  const splitAtCursor = (): void => {
    if (!current) return
    // Read from the field itself at the moment of splitting. State follows the
    // cursor through selection events, but the field is the authority.
    const at = textRef.current?.selectionStart ?? caret
    const index = wordIndexAtCursor(current.text, at)
    if (index === null) return
    const halves = splitCaptionAtWord(current, index)
    if (!halves) return
    set(
      'captions',
      captions.flatMap((caption) => (caption.id === current.id ? halves : [caption]))
    )
    // The rest of the line is what is left to break up, so that is where the
    // cursor goes next: splitting a long line becomes one keystroke per break.
    onSelectCaption(halves[1].id)
    setCaret(0)
    requestAnimationFrame(() => {
      textRef.current?.focus()
      textRef.current?.setSelectionRange(0, 0)
    })
  }

  /** Joins the selected line with the one after it. */
  const mergeWithNext = (): void => {
    if (!current || !following) return
    const merged = mergeCaptions(current, following)
    set(
      'captions',
      captions
        .filter((caption) => caption.id !== following.id)
        .map((caption) => (caption.id === current.id ? merged : caption))
    )
  }

  /** A new line at the playhead, ready to type into. */
  const addLine = (): void => {
    const start = Math.max(0, Math.min(time, recording.duration - 0.5))
    // Stops where the next line begins, so a new caption never overlaps one
    // that is already there.
    const next = captions.find((caption) => caption.start > start)
    const end = Math.min(next ? next.start : start + 2.5, recording.duration)
    // Unique even when two lines are added at the same playhead, which the
    // start time alone was not — and the music lane keys its notches by id.
    const line: Caption = {
      id: `manual-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      start,
      end,
      text: 'New line'
    }
    set(
      'captions',
      [...captions, line].sort((a, b) => a.start - b.start)
    )
    onSelectCaption(line.id)
  }

  return (
    <>
      <Group title="Transcript" span>
        <span className="label">Spoken language</span>
        <select
          value={locale}
          disabled={busy || locales.length === 0}
          onChange={(e) => setLocale(e.target.value)}
        >
          {(locales.length ? locales : [locale]).map((tag) => (
            <option key={tag} value={tag}>
              {localeName(tag)} — {tag}
            </option>
          ))}
        </select>
        <p className="hint" style={{ marginTop: -4 }}>
          The language being spoken, which is not necessarily the one this Mac is
          set to. It used to be taken from the system, so narration in English on
          a Dutch Mac was transcribed as Dutch and came back empty.
        </p>
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
        <div style={{ height: 6 }} />
        <Toggle
          label="Keep lines short"
          checked={style.maxChars > 0}
          onChange={(v) => patch('captionStyle', { maxChars: v ? 42 : 0 })}
        />
        {style.maxChars > 0 && (
          <>
            <Slider
              label="Longest line"
              min={16}
              max={90}
              step={1}
              value={style.maxChars}
              onChange={(v) => patch('captionStyle', { maxChars: Math.round(v) })}
              format={(v) => `${Math.round(v)} characters`}
            />
            {captions.some((caption) => caption.text.length > style.maxChars) && (
              <button
                className="btn small"
                onClick={() => {
                  set('captions', shortenCaptions(captions, style.maxChars))
                  onSelectCaption(null)
                }}
              >
                {(() => {
                  const long = captions.filter((caption) => caption.text.length > style.maxChars).length
                  return `Shorten ${long} long ${long === 1 ? 'line' : 'lines'} now`
                })()}
              </button>
            )}
            <p className="hint">
              New transcripts arrive in lines this short. Breaks go after a comma or full stop
              where one is close, and never leave a word on its own.
            </p>
          </>
        )}
        {error && (
          <p className="hint" style={{ color: 'var(--danger)' }}>
            {error}
          </p>
        )}
      </Group>

      {current && (
        <Group title="Selected line" span>
          <textarea
            ref={textRef}
            className="caption-text"
            value={current.text}
            rows={3}
            onChange={(e) => {
              setCaret(e.target.selectionStart)
              updateCaption(current.id, { text: e.target.value })
            }}
            onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
            onKeyUp={(e) => setCaret(e.currentTarget.selectionStart)}
            onMouseUp={(e) => setCaret(e.currentTarget.selectionStart)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                splitAtCursor()
              }
            }}
          />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              className="btn small"
              disabled={splitIndex === null}
              title="Split this line where the text cursor is (⌘↩)"
              onClick={splitAtCursor}
            >
              Split at cursor
            </button>
            <button
              className="btn small"
              disabled={!following}
              title="Join this line with the one after it"
              onClick={mergeWithNext}
            >
              Merge with next
            </button>
          </div>
          <p className="hint" style={{ marginTop: 0 }}>
            Put the cursor where the line should break and press ⌘↩. The rest of the line is
            selected next, so a long line breaks up one keystroke at a time.
          </p>
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
      <Group span title={which === 'intro' ? 'Intro' : 'Outro'}>
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
