// MIT License - Copyright (c) fintonlabs.com

/**
 * Timed text drawn over the composition.
 *
 * Captions are authored against a 1080-high frame and scaled to whatever the
 * export actually is, exactly like the frame radius. Anything authored in raw
 * output pixels looks correct in the preview and then wrong at a different
 * export size, which is the kind of bug nobody finds until the file is already
 * uploaded.
 */

/** Either canvas context; the exporter renders offscreen. */
type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

/** One spoken word and when it was said, as the recogniser heard it. */
export interface CaptionWord {
  start: number
  end: number
  text: string
}

export interface Caption {
  id: string
  start: number
  end: number
  text: string
  /** From the recogniser. Low values are worth a read-through before export. */
  confidence?: number
  /**
   * When each word was said, where the recogniser reported it.
   *
   * Only trusted while it still matches `text` — see `wordsFor`. Editing a
   * line's wording does not clear it; the mismatch is noticed when it is next
   * needed, and timing then falls back to an estimate.
   */
  words?: CaptionWord[]
  /**
   * What this line said before it was translated.
   *
   * Only set on a translated line, and it is what going back to the spoken
   * language restores — translating a translation is not the same text.
   */
  original?: string
}

export interface CaptionStyle {
  enabled: boolean
  fontFamily: string
  /** Points against a 1080-high frame. */
  fontSize: number
  weight: number
  color: string
  /** Where the block sits, as a fraction of the frame. */
  x: number
  y: number
  align: 'left' | 'center' | 'right'
  /** Fraction of the frame width the text may fill before wrapping. */
  maxWidth: number
  lineHeight: number
  uppercase: boolean

  outlineWidth: number
  outlineColor: string
  shadowBlur: number
  shadowColor: string
  shadowOffset: number

  /** A plate behind the text, for busy footage. 0 hides it. */
  boxOpacity: number
  boxColor: string
  boxPadding: number
  boxRadius: number

  /** Seconds of fade at each end of a cue. */
  fade: number

  /**
   * Longest a line may be, in characters, before it is broken into shorter
   * lines. 0 leaves lines as the recogniser grouped them.
   *
   * A transcript grouped into whole sentences reads well as a transcript and
   * badly as captions: two dense lines of text over a screen recording are a
   * paragraph to read, not a caption to glance at, and that was the complaint.
   */
  maxChars: number
}

export const DEFAULT_CAPTION_STYLE: CaptionStyle = {
  enabled: true,
  fontFamily: 'Bricolage Grotesque',
  fontSize: 44,
  weight: 700,
  color: '#ffffff',
  x: 0.5,
  y: 0.86,
  align: 'center',
  maxWidth: 0.8,
  lineHeight: 1.22,
  uppercase: false,

  // An outline rather than a box by default: it stays legible over anything
  // without covering the recording, which is the whole reason to caption a
  // screen recording rather than a talking head.
  outlineWidth: 6,
  outlineColor: '#000000',
  shadowBlur: 18,
  shadowColor: 'rgba(0,0,0,0.55)',
  shadowOffset: 2,

  boxOpacity: 0,
  boxColor: '#000000',
  boxPadding: 18,
  boxRadius: 10,

  fade: 0.12,

  // About one line at the default size and width. Short enough to take in at a
  // glance while watching what the screen is doing.
  maxChars: 42
}

export const CAPTION_FONTS = [
  'Bricolage Grotesque',
  'SF Pro Display',
  'Helvetica Neue',
  'Avenir Next',
  'Georgia',
  'Spline Sans Mono'
]

/**
 * How briefly a caption may appear.
 *
 * The recogniser times a word to the sound of it, and a quick "View" lasts a
 * fifth of a second — long enough to be a flicker and not long enough to read,
 * which looks like a fault rather than like speech.
 */
const MIN_CAPTION_SECONDS = 0.9

/** The cue showing at `t`, or null. */
export function captionAt(captions: Caption[], t: number): Caption | null {
  for (const caption of captions) {
    if (t >= caption.start && t < caption.end) return caption
  }
  return null
}

/** 0–1 opacity, easing a cue in and out so lines do not snap on. */
function alphaFor(caption: Caption, t: number, fade: number): number {
  if (fade <= 0) return 1
  // Never fade for longer than a third of the cue: a short line would spend
  // its whole life fading and never reach full strength.
  const ramp = Math.min(fade, (caption.end - caption.start) / 3)
  if (ramp <= 0) return 1
  const inAlpha = Math.min(1, (t - caption.start) / ramp)
  const outAlpha = Math.min(1, (caption.end - t) / ramp)
  return Math.max(0, Math.min(inAlpha, outAlpha))
}

/** Greedy wrap against a measured width. */
function wrap(ctx: Ctx, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  const lines: string[] = []
  let line = words[0]
  for (const word of words.slice(1)) {
    const candidate = `${line} ${word}`
    if (ctx.measureText(candidate).width <= maxWidth) line = candidate
    else {
      lines.push(line)
      line = word
    }
  }
  lines.push(line)
  return lines
}

/**
 * Draws the caption for `t`, if there is one.
 *
 * A pure function of `t` like everything else in the composition, so the
 * preview and the exported file cannot disagree.
 */
export function drawCaption(
  ctx: Ctx,
  t: number,
  captions: Caption[],
  style: CaptionStyle,
  output: { width: number; height: number }
): void {
  if (!style.enabled || captions.length === 0) return
  const caption = captionAt(captions, t)
  if (!caption || !caption.text.trim()) return

  const alpha = alphaFor(caption, t, style.fade)
  if (alpha <= 0.001) return

  // Authored against 1080 so a 4K export is not captioned in tiny text.
  const scale = output.height / 1080
  const size = style.fontSize * scale
  const pad = style.boxPadding * scale

  ctx.save()
  ctx.globalAlpha = alpha
  ctx.font = `${style.weight} ${size}px "${style.fontFamily}", system-ui, sans-serif`
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = style.align

  const text = style.uppercase ? caption.text.toUpperCase() : caption.text
  const lines = wrap(ctx, text, output.width * style.maxWidth)
  const lineHeight = size * style.lineHeight

  const anchorX = output.width * style.x
  // `y` positions the *bottom* of the block, so moving the caption down never
  // pushes earlier lines off the top as the text grows.
  const bottom = output.height * style.y
  const top = bottom - lineHeight * (lines.length - 1)

  if (style.boxOpacity > 0.001) {
    const widest = Math.max(...lines.map((line) => ctx.measureText(line).width))
    const boxW = widest + pad * 2
    const boxH = lineHeight * lines.length + pad * 2
    const boxX =
      style.align === 'center'
        ? anchorX - boxW / 2
        : style.align === 'right'
          ? anchorX - boxW
          : anchorX
    ctx.save()
    ctx.globalAlpha = alpha * style.boxOpacity
    ctx.fillStyle = style.boxColor
    ctx.beginPath()
    ctx.roundRect(boxX, top - size - pad + size * 0.22, boxW, boxH, style.boxRadius * scale)
    ctx.fill()
    ctx.restore()
  }

  lines.forEach((line, index) => {
    const y = top + index * lineHeight

    // Shadow belongs to the outline pass, not the fill: applied to both it
    // doubles up and turns a crisp edge into a smear.
    if (style.shadowBlur > 0 || style.shadowOffset > 0) {
      ctx.shadowColor = style.shadowColor
      ctx.shadowBlur = style.shadowBlur * scale
      ctx.shadowOffsetY = style.shadowOffset * scale
    }
    if (style.outlineWidth > 0) {
      ctx.lineWidth = style.outlineWidth * scale
      ctx.strokeStyle = style.outlineColor
      ctx.lineJoin = 'round'
      ctx.miterLimit = 2
      ctx.strokeText(line, anchorX, y)
    }
    ctx.shadowColor = 'transparent'
    ctx.shadowBlur = 0
    ctx.shadowOffsetY = 0

    ctx.fillStyle = style.color
    ctx.fillText(line, anchorX, y)
  })

  ctx.restore()
}

/**
 * Turns recogniser cues into captions, closing the small gaps between them.
 *
 * A cue that ends the instant the next begins reads as continuous speech, but
 * a 90ms hole between two lines is a visible flicker. Anything longer than that
 * is a real pause and is left alone.
 */
export function captionsFromCues(
  cues: {
    start: number
    end: number
    text: string
    confidence: number
    words?: CaptionWord[]
  }[],
  options: { maxChars?: number } = {}
): Caption[] {
  const sorted = [...cues].sort((a, b) => a.start - b.start)
  const whole = sorted.map((cue, index): Caption => {
    const next = sorted[index + 1]
    const gap = next ? next.start - cue.end : Infinity

    // A word said quickly is still a word, and deleting it because it was brief
    // would be throwing away speech that was correctly heard. It is held on
    // screen long enough to read instead — but never into the next line, which
    // has its own moment to occupy.
    const readable = Math.max(cue.end, cue.start + MIN_CAPTION_SECONDS)
    const bridged = gap > 0 && gap < 0.35 ? next.start : cue.end
    const end = next
      ? Math.min(Math.max(bridged, readable), next.start)
      : Math.max(bridged, readable)

    return {
      id: `cue-${index}-${Math.round(cue.start * 1000)}`,
      start: cue.start,
      end,
      text: cue.text.trim(),
      confidence: cue.confidence,
      ...(cue.words && cue.words.length ? { words: cue.words } : {})
    }
  })
  return shortenCaptions(whole, options.maxChars ?? 0)
}

// ---------------------------------------------------------------------------
// Splitting and merging lines

/** Whitespace-separated words, as the caption would be read. */
function tokensOf(text: string): string[] {
  return text.split(/\s+/).filter(Boolean)
}

const normalise = (text: string): string => tokensOf(text).join(' ').toLowerCase()

/**
 * When each word of a caption falls.
 *
 * The recogniser's own word times when it gave them and the text still says
 * what it heard. Otherwise an estimate: the caption's span shared out in
 * proportion to each word's length, since longer words take longer to say.
 * That is close enough for a break inside one line; the recogniser's times are
 * better, and are used whenever they are there.
 */
export function wordsFor(caption: Caption): { words: CaptionWord[]; heard: boolean } {
  const tokens = tokensOf(caption.text)
  if (
    caption.words &&
    caption.words.length === tokens.length &&
    normalise(caption.words.map((w) => w.text).join(' ')) === normalise(caption.text)
  ) {
    return { words: caption.words, heard: true }
  }
  const weights = tokens.map((token) => token.length + 1)
  const total = weights.reduce((a, b) => a + b, 0) || 1
  const span = caption.end - caption.start
  let at = caption.start
  const words = tokens.map((text, i) => {
    const start = at
    at += (span * weights[i]) / total
    return { start, end: at, text }
  })
  return { words, heard: false }
}

/** Where a break between two words belongs in time: in the gap between them. */
function boundaryBetween(before: CaptionWord, after: CaptionWord, caption: Caption): number {
  const mid = (before.end + after.start) / 2
  return Math.min(caption.end, Math.max(caption.start, mid))
}

let splitCounter = 0
/** A fresh id derived from the one being split, unique for the session. */
function pieceId(base: string): string {
  splitCounter += 1
  return `${base.split('~')[0]}~${Date.now().toString(36)}${splitCounter.toString(36)}`
}

/** The piece of a caption covering words [from, to). */
function piece(
  caption: Caption,
  words: CaptionWord[],
  heard: boolean,
  from: number,
  to: number,
  start: number,
  end: number,
  id: string
): Caption {
  const slice = words.slice(from, to)
  const next: Caption = {
    id,
    start,
    end,
    text: slice.map((w) => w.text).join(' ')
  }
  if (caption.confidence !== undefined) next.confidence = caption.confidence
  if (heard) next.words = slice
  return next
}

/**
 * Splits a caption before word `index`, returning the two halves.
 *
 * The halves touch — the first ends exactly where the second begins — so the
 * text never blinks off between them and the music never swells up in a gap
 * that is not really a pause. The first half keeps the original id, so a
 * selection on the timeline survives.
 */
export function splitCaptionAtWord(
  caption: Caption,
  index: number,
  newId: (base: string) => string = pieceId
): [Caption, Caption] | null {
  const { words, heard } = wordsFor(caption)
  if (index <= 0 || index >= words.length) return null
  const at = boundaryBetween(words[index - 1], words[index], caption)
  return [
    piece(caption, words, heard, 0, index, caption.start, at, caption.id),
    piece(caption, words, heard, index, words.length, at, caption.end, newId(caption.id))
  ]
}

/**
 * The word a text cursor sits in front of, for "split here".
 *
 * A cursor in the middle of a word goes to the nearer end of it, so splitting
 * never cuts a word in half. Returns the index of the first word of the second
 * half, or null when the cursor is before the first word or after the last.
 */
export function wordIndexAtCursor(text: string, cursor: number): number | null {
  const spans: { start: number; end: number }[] = []
  const pattern = /\S+/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text))) spans.push({ start: match.index, end: match.index + match[0].length })
  if (spans.length < 2) return null
  for (let i = 0; i < spans.length; i++) {
    const { start, end } = spans[i]
    if (cursor <= start) return i === 0 ? null : i
    if (cursor < end) {
      const index = cursor - start < end - cursor ? i : i + 1
      return index <= 0 || index >= spans.length ? null : index
    }
  }
  return null
}

/** Joins a caption with the one after it. The inverse of a split. */
export function mergeCaptions(first: Caption, second: Caption): Caption {
  const a = wordsFor(first)
  const b = wordsFor(second)
  const merged: Caption = {
    id: first.id,
    start: Math.min(first.start, second.start),
    end: Math.max(first.end, second.end),
    text: `${first.text.trim()} ${second.text.trim()}`.trim()
  }
  if (first.confidence !== undefined || second.confidence !== undefined) {
    merged.confidence = ((first.confidence ?? 1) + (second.confidence ?? 1)) / 2
  }
  if (a.heard && b.heard) merged.words = [...a.words, ...b.words]
  return merged
}

/** A word ending a clause, which is where a line would naturally break. */
const CLAUSE = /[,;:.!?…—–-]$/

/**
 * Words that lean on the next one. A line ending "turn on the" leaves the
 * reader holding a word that means nothing until the next caption arrives.
 */
const LEANING = new Set([
  'a', 'an', 'the', 'to', 'of', 'in', 'on', 'at', 'for', 'with', 'from', 'by', 'and', 'or',
  'but', 'so', 'if', 'that', 'this', 'these', 'those', 'your', 'my', 'our', 'their', 'its',
  'is', 'are', 'was', 'be', 'will', 'can', 'we', 'you', 'i', 'it', 'as', 'into', 'onto'
])

/**
 * Breaks one caption into lines no longer than `maxChars`.
 *
 * Not by filling each line and spilling the rest, which leaves a sentence's
 * last word alone on screen for a moment — "dog." as a caption of its own,
 * reading like a transcript with words missing. The number of lines is decided
 * first, and the words are then shared between them as evenly as the breaks
 * allow, preferring to break after a comma or full stop, where a reader pauses
 * anyway.
 */
export function shortenCaption(
  caption: Caption,
  maxChars: number,
  newId: (base: string) => string = pieceId
): Caption[] {
  if (maxChars <= 0 || caption.text.trim().length <= maxChars) return [caption]
  const { words, heard } = wordsFor(caption)
  const n = words.length
  if (n < 2) return [caption]

  const lengths = words.map((w) => w.text.length)
  /** Characters in words [from, to), with the spaces between them. */
  const span = (from: number, to: number): number => {
    let total = to - from - 1
    for (let i = from; i < to; i++) total += lengths[i]
    return total
  }

  const totalChars = span(0, n)
  const parts = Math.min(n, Math.max(2, Math.ceil(totalChars / maxChars)))
  const target = totalChars / parts

  // Best way to put words [0, i) into k lines: cost[k][i].
  const INF = Number.POSITIVE_INFINITY
  const cost: number[][] = Array.from({ length: parts + 1 }, () => new Array(n + 1).fill(INF))
  const from: number[][] = Array.from({ length: parts + 1 }, () => new Array(n + 1).fill(-1))
  cost[0][0] = 0
  for (let k = 1; k <= parts; k++) {
    for (let i = k; i <= n; i++) {
      for (let j = k - 1; j < i; j++) {
        if (cost[k - 1][j] === INF) continue
        const length = span(j, i)
        let c = cost[k - 1][j] + (length - target) ** 2
        // A line longer than allowed is only acceptable when a single word is.
        if (length > maxChars && i - j > 1) c += 1e6
        // A clause break is worth being a little uneven for.
        if (i < n && CLAUSE.test(words[i - 1].text)) c -= target * target * 0.25
        // And a line should not end on a word that needs the next line to mean anything.
        if (i < n && LEANING.has(words[i - 1].text.toLowerCase())) c += target * target * 0.2
        // One word on its own is the fragment this exists to avoid.
        if (i - j === 1 && n > 2) c += target * target
        if (c < cost[k][i]) {
          cost[k][i] = c
          from[k][i] = j
        }
      }
    }
  }

  const breaks: number[] = []
  for (let k = parts, i = n; k > 0; k--) {
    const j = from[k][i]
    if (j < 0) return [caption]
    if (j > 0) breaks.unshift(j)
    i = j
  }

  const pieces: Caption[] = []
  let startWord = 0
  let startTime = caption.start
  for (let b = 0; b <= breaks.length; b++) {
    const endWord = b < breaks.length ? breaks[b] : n
    const endTime =
      b < breaks.length ? boundaryBetween(words[endWord - 1], words[endWord], caption) : caption.end
    const id = b === 0 ? caption.id : newId(caption.id)
    pieces.push(piece(caption, words, heard, startWord, endWord, startTime, endTime, id))
    startWord = endWord
    startTime = endTime
  }
  return pieces
}

/** Shortens every caption that runs past `maxChars`, leaving the rest alone. */
export function shortenCaptions(
  captions: Caption[],
  maxChars: number,
  newId: (base: string) => string = pieceId
): Caption[] {
  if (maxChars <= 0) return captions
  return captions.flatMap((caption) => shortenCaption(caption, maxChars, newId))
}
