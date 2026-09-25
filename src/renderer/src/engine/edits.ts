// MIT License - Copyright (c) fintonlabs.com
import type { Annotation, AnnotationKind } from './annotations'
import type { Caption } from './captions'
import type { ZoomSegment } from './types'

/**
 * What belongs to one recording and is kept with it.
 *
 * Captions, zoom shots, annotations, the trim and the camera sync used to live
 * only in the editor's memory: open the take again and all of it was gone,
 * back to a fresh transcript-less, auto-zoomed recording. They are now written
 * beside the recording as `edits.json`, and read back when it opens.
 *
 * The look — background, cursor, captions' style and the rest — is not here.
 * That follows the person from recording to recording rather than staying with
 * one, and is remembered separately.
 */
export interface TakeEdits {
  version: 1
  captions: Caption[]
  annotations: Annotation[]
  /**
   * Every zoom shot, automatic and hand-made, exactly as left.
   *
   * All of them rather than only the hand-made ones, so a shot deleted by hand
   * stays deleted. Automatic shots are regenerated only when the zoom settings
   * change, which is what `zoomKey` records.
   */
  segments: ZoomSegment[]
  /** The zoom settings the shots were generated from, as a comparable key. */
  zoomKey: string
  trim: { start: number; end: number }
  cameraSync: number
}

const KINDS: AnnotationKind[] = ['arrow', 'box', 'highlight', 'focus', 'blur', 'pixelate']

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** A timed thing that sits inside the recording, with a positive length. */
function inTake<T extends { start: number; end: number }>(item: T, duration: number): T | null {
  const start = Math.max(0, Math.min(item.start, duration))
  const end = Math.max(0, Math.min(item.end, duration))
  return end > start ? { ...item, start, end } : null
}

/**
 * Reads `edits.json` as found on disk, keeping only what can be trusted.
 *
 * The file is written by this app, but it sits in a folder anyone can edit and
 * may come from an older or newer version. Anything malformed is dropped item
 * by item rather than rejecting the whole file — losing one caption beats
 * losing a transcript — and every time is clamped into the recording, so a take
 * trimmed or re-recorded under the same name cannot produce shots past its end.
 */
export function editsFromDisk(raw: unknown, duration: number): TakeEdits | null {
  if (!isObject(raw) || raw.version !== 1) return null

  const captions: Caption[] = []
  for (const c of Array.isArray(raw.captions) ? raw.captions : []) {
    if (!isObject(c) || typeof c.id !== 'string' || typeof c.text !== 'string') continue
    if (!isNumber(c.start) || !isNumber(c.end)) continue
    const words = Array.isArray(c.words)
      ? c.words.filter(
          (w): w is { start: number; end: number; text: string } =>
            isObject(w) && isNumber(w.start) && isNumber(w.end) && typeof w.text === 'string'
        )
      : undefined
    const caption = inTake(
      {
        id: c.id,
        start: c.start,
        end: c.end,
        text: c.text,
        ...(isNumber(c.confidence) ? { confidence: c.confidence } : {}),
        ...(typeof c.original === 'string' ? { original: c.original } : {}),
        ...(words && words.length ? { words } : {})
      },
      duration
    )
    if (caption) captions.push(caption)
  }

  const annotations: Annotation[] = []
  for (const a of Array.isArray(raw.annotations) ? raw.annotations : []) {
    if (!isObject(a) || typeof a.id !== 'string' || !KINDS.includes(a.kind as AnnotationKind)) continue
    if (![a.start, a.end, a.x, a.y, a.w, a.h].every(isNumber)) continue
    const note = inTake(a as unknown as Annotation, duration)
    if (note) annotations.push(note)
  }

  const segments: ZoomSegment[] = []
  for (const s of Array.isArray(raw.segments) ? raw.segments : []) {
    if (!isObject(s) || typeof s.id !== 'string') continue
    if (![s.start, s.end, s.scale, s.x, s.y].every(isNumber)) continue
    const segment = inTake(s as unknown as ZoomSegment, duration)
    if (segment) segments.push(segment)
  }

  const trimRaw = isObject(raw.trim) ? raw.trim : {}
  const trim =
    isNumber(trimRaw.start) && isNumber(trimRaw.end) && trimRaw.end > trimRaw.start
      ? {
          start: Math.max(0, Math.min(trimRaw.start, duration)),
          end: Math.max(0, Math.min(trimRaw.end, duration))
        }
      : { start: 0, end: duration }

  return {
    version: 1,
    captions: captions.sort((a, b) => a.start - b.start),
    annotations,
    segments: segments.sort((a, b) => a.start - b.start),
    zoomKey: typeof raw.zoomKey === 'string' ? raw.zoomKey : '',
    trim: trim.end > trim.start ? trim : { start: 0, end: duration },
    cameraSync: isNumber(raw.cameraSync) ? Math.max(-5, Math.min(5, raw.cameraSync)) : 0
  }
}

/** A comparable key for zoom settings, so equal settings are recognised as equal. */
export function zoomKeyOf(zoom: unknown): string {
  return JSON.stringify(zoom)
}
