// MIT License - Copyright (c) fintonlabs.com
import type { Caption } from './captions'

/**
 * Captions as a subtitle file.
 *
 * Worth having even though YouTube will transcribe a video on its own: these
 * cues have already been read and corrected, and YouTube's have not. Uploading
 * them means the captions people see are the ones checked here rather than a
 * second, worse transcription of the same audio.
 *
 * Times are relative to the exported file, not the take, so trimming the start
 * has to be accounted for by the caller.
 */

function pad(value: number, width = 2): string {
  return String(Math.floor(value)).padStart(width, '0')
}

/** `00:01:23,456` for SRT, `00:01:23.456` for WebVTT. */
function stamp(seconds: number, millisSeparator: ',' | '.'): string {
  const clamped = Math.max(0, seconds)
  const hours = Math.floor(clamped / 3600)
  const minutes = Math.floor((clamped % 3600) / 60)
  const secs = Math.floor(clamped % 60)
  const millis = Math.round((clamped - Math.floor(clamped)) * 1000)
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)}${millisSeparator}${pad(millis, 3)}`
}

/**
 * Cues that fall inside the exported range, shifted to start at zero.
 *
 * A caption exported against the take's timeline would drift by exactly the
 * length of whatever was trimmed off the front — correct in the file, wrong
 * against the video anyone plays.
 */
function within(captions: Caption[], start: number, end: number): Caption[] {
  return captions
    .filter((caption) => caption.end > start && caption.start < end && caption.text.trim())
    .map((caption) => ({
      ...caption,
      start: Math.max(0, caption.start - start),
      end: Math.min(end, caption.end) - start
    }))
    .sort((a, b) => a.start - b.start)
}

export function toSRT(captions: Caption[], start = 0, end = Infinity): string {
  return (
    within(captions, start, end)
      .map(
        (caption, index) =>
          `${index + 1}\n` +
          `${stamp(caption.start, ',')} --> ${stamp(caption.end, ',')}\n` +
          `${caption.text.trim()}\n`
      )
      .join('\n') + '\n'
  )
}

export function toVTT(captions: Caption[], start = 0, end = Infinity): string {
  return (
    'WEBVTT\n\n' +
    within(captions, start, end)
      .map(
        (caption) =>
          `${stamp(caption.start, '.')} --> ${stamp(caption.end, '.')}\n` +
          `${caption.text.trim()}\n`
      )
      .join('\n')
  )
}

/**
 * A description built from the transcript, with chapter marks.
 *
 * YouTube turns `0:00 Something` lines into chapters, which is the one piece of
 * upload metadata that is tedious by hand and that a transcript already knows.
 * It needs a mark at zero and at least three of them, or YouTube ignores the
 * lot — so this returns nothing rather than something that silently will not
 * work.
 */
export function toChapters(captions: Caption[], start = 0, end = Infinity, every = 45): string {
  const cues = within(captions, start, end)
  if (cues.length === 0) return ''

  const marks: string[] = []
  let next = 0
  for (const cue of cues) {
    if (cue.start < next) continue
    const minutes = Math.floor(cue.start / 60)
    const seconds = Math.floor(cue.start % 60)
    // First few words, which is usually enough to recognise the moment.
    const label = cue.text
      .trim()
      .split(/\s+/)
      .slice(0, 6)
      .join(' ')
      .replace(/[.,;:!?]$/, '')
    marks.push(`${minutes}:${pad(seconds)} ${label}`)
    next = cue.start + every
  }
  if (marks.length < 3) return ''
  // YouTube requires the first chapter to be at zero.
  marks[0] = marks[0].replace(/^\d+:\d+/, '0:00')
  return marks.join('\n')
}
