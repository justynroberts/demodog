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

export interface Caption {
  id: string
  start: number
  end: number
  text: string
  /** From the recogniser. Low values are worth a read-through before export. */
  confidence?: number
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

  fade: 0.12
}

export const CAPTION_FONTS = [
  'Bricolage Grotesque',
  'SF Pro Display',
  'Helvetica Neue',
  'Avenir Next',
  'Georgia',
  'Spline Sans Mono'
]

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
  cues: { start: number; end: number; text: string; confidence: number }[]
): Caption[] {
  const sorted = [...cues].sort((a, b) => a.start - b.start)
  return sorted.map((cue, index) => {
    const next = sorted[index + 1]
    const gap = next ? next.start - cue.end : Infinity
    return {
      id: `cue-${index}-${Math.round(cue.start * 1000)}`,
      start: cue.start,
      end: gap > 0 && gap < 0.35 ? next.start : cue.end,
      text: cue.text.trim(),
      confidence: cue.confidence
    }
  })
}
