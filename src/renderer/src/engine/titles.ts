// MIT License - Copyright (c) fintonlabs.com

/**
 * Title cards shown before and after the recording.
 *
 * Deliberately not separate video files stitched on at the end. Concatenating
 * clips means a second encode, a muxing step, and an intro whose colour and
 * frame rate are subtly not the recording's — and it breaks the one rule this
 * renderer is built on, that `render(ctx, t)` is a pure function of `t`.
 *
 * So a card is simply what the composition draws when `t` falls outside the
 * recording: before zero for the intro, past the end for the outro. Everything
 * downstream — preview, scrubbing, export, the fade at each end — works on it
 * without knowing it is special.
 */

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

export interface TitleCard {
  enabled: boolean
  /** How long it holds, in seconds. */
  seconds: number
  title: string
  subtitle: string
  /** Points against a 1080-high frame, like the captions. */
  titleSize: number
  subtitleSize: number
  color: string
  /** The face the card is set in. Its own, rather than the captions'. */
  fontFamily: string
  /** Drawn behind the text; the recording's own background is used when null. */
  background: string
  /**
   * A full-bleed image behind the text.
   *
   * Drawn over `background` rather than instead of it, so a picture that does
   * not match the frame's aspect has something deliberate behind it rather
   * than whatever the canvas last held.
   */
  backgroundSrc: string | null
  /** How the background image fills the frame. */
  backgroundFit: 'cover' | 'contain'
  /**
   * A wash of `background` over the image, 0–1.
   *
   * A photograph is rarely quiet enough to set type over, and the alternative
   * is asking the user to pick a text colour that works against every part of
   * their own picture.
   */
  backgroundDim: number
  /** A logo or image above the text. */
  imageSrc: string | null
  imageHeight: number
  /** Seconds of fade at the outer edge, so it does not appear from nothing. */
  fade: number
}

export const DEFAULT_INTRO: TitleCard = {
  enabled: false,
  seconds: 2.5,
  title: '',
  subtitle: '',
  titleSize: 88,
  subtitleSize: 34,
  color: '#ffffff',
  fontFamily: 'Bricolage Grotesque',
  background: '#0d0d12',
  backgroundSrc: null,
  backgroundFit: 'cover',
  backgroundDim: 0.45,
  imageSrc: null,
  imageHeight: 180,
  fade: 0.45
}

export const DEFAULT_OUTRO: TitleCard = {
  ...DEFAULT_INTRO,
  titleSize: 66,
  subtitle: ''
}

/**
 * Cached decode, so a card does not re-decode its logo on every frame.
 *
 * Exported so the checks can seed it with a stand-in image: the drawing code
 * is where a background gets stretched or mis-cropped, and that is not
 * something a screenshot review reliably catches.
 */
export const titleImages = new Map<string, HTMLImageElement>()
const images = titleImages

export function titleImage(src: string): HTMLImageElement | null {
  const existing = images.get(src)
  if (existing) return existing.complete && existing.naturalWidth > 0 ? existing : null
  const image = new Image()
  image.src = src
  images.set(src, image)
  return null
}

/** Which part of the piece a time falls in. */
export type Phase = 'intro' | 'recording' | 'outro' | 'ended'

/**
 * Where `t` sits relative to the recording and its cards.
 *
 * Named rather than left as an inline comparison because the answer decides
 * whether the recording's *audio* is running, and getting that wrong is not
 * subtle: the take played underneath the intro card, so by the time the card
 * lifted the recording was already several seconds in and then jumped back.
 */
export function phaseAt(
  t: number,
  range: { start: number; end: number },
  leadIn: number,
  leadOut: number
): Phase {
  if (t < range.start) return leadIn > 0 ? 'intro' : 'recording'
  if (t < range.end) return 'recording'
  if (t < range.end + leadOut) return 'outro'
  return 'ended'
}

/**
 * The playhead position once the recording has run out, or null if it has not.
 *
 * Returns the end of the range rather than wherever the element's own clock
 * stopped, and that is the entire point. The element cannot report a time past
 * the end of its file, and the file ends at — or a few milliseconds before —
 * the trim. So a loop that reads the playhead back off the element, notices it
 * has arrived, and pauses, freezes the clock just *below* the boundary it is
 * waiting to cross: the outro is never entered, `ended` never fires because the
 * element was paused before it got there, and playback wedges at the last frame
 * of the recording while still claiming to be playing.
 *
 * Crossing the boundary explicitly is what stops that.
 */
export function recordingEnded(
  elementTime: number,
  range: { start: number; end: number },
  /** The video element's own duration, if known. NaN before metadata loads. */
  elementDuration = Infinity,
  epsilon = 0.01
): number | null {
  if (elementTime >= range.end - epsilon) return range.end
  // The file ran out before the trim did — which is ordinary, since the trim
  // defaults to the recording's stated duration and a container's real last
  // frame often lands slightly before it. There is no more recording to play,
  // so the piece moves on rather than waiting for a time that will never come.
  if (Number.isFinite(elementDuration) && elementTime >= elementDuration - epsilon) {
    return range.end
  }
  return null
}

/** The recording plays during its own part of the piece and nowhere else. */
export function recordingRuns(phase: Phase): boolean {
  return phase === 'recording'
}

/**
 * Waits for every image a set of cards needs.
 *
 * `titleImage` returns null until a decode finishes, which is the right answer
 * for a preview — the next frame is 16ms away and will have it. The exporter
 * gets one attempt at each frame, so a picture chosen a moment before pressing
 * Export would simply be absent from the file, with nothing to say so.
 */
export async function ensureTitleImages(cards: TitleCard[]): Promise<void> {
  const sources = cards
    .filter((card) => card.enabled)
    .flatMap((card) => [card.imageSrc, card.backgroundSrc])
    .filter((src): src is string => !!src)

  await Promise.all(
    sources.map(
      (src) =>
        new Promise<void>((resolve) => {
          if (titleImage(src)) return resolve()
          const image = images.get(src)
          if (!image) return resolve()
          // Resolve either way: a picture that cannot be decoded should not
          // stop the export, it should simply not be in it.
          image.addEventListener('load', () => resolve(), { once: true })
          image.addEventListener('error', () => resolve(), { once: true })
        })
    )
  )
}

/**
 * How far through the card `t` is, or null when it is not showing.
 *
 * The intro runs from `-seconds` up to zero, so it ends exactly as the
 * recording begins; the outro starts the instant the recording ends.
 */
export function introProgress(t: number, card: TitleCard): number | null {
  if (!card.enabled || card.seconds <= 0) return null
  if (t >= 0 || t < -card.seconds) return null
  return (t + card.seconds) / card.seconds
}

export function outroProgress(t: number, end: number, card: TitleCard): number | null {
  if (!card.enabled || card.seconds <= 0) return null
  if (t < end || t > end + card.seconds) return null
  return (t - end) / card.seconds
}

/** Fades in at the start of a card and out at its end. */
function alphaFor(progress: number, card: TitleCard): number {
  if (card.fade <= 0) return 1
  const ramp = Math.min(card.fade / card.seconds, 0.45)
  if (ramp <= 0) return 1
  const rising = Math.min(1, progress / ramp)
  const falling = Math.min(1, (1 - progress) / ramp)
  return Math.max(0, Math.min(rising, falling))
}

/**
 * Fills the frame with an image without distorting it.
 *
 * `cover` crops the overflowing axis; `contain` fits the whole picture and
 * leaves the card's background colour showing either side. Scaling it to the
 * frame instead — the obvious one-liner — stretches faces, which is the single
 * most obvious way for a title card to look amateurish.
 */
function drawCover(
  ctx: Ctx,
  image: HTMLImageElement,
  output: { width: number; height: number },
  fit: 'cover' | 'contain'
): void {
  const ratio = image.naturalWidth / image.naturalHeight
  const frame = output.width / output.height
  const wide = fit === 'cover' ? ratio > frame : ratio < frame
  const width = wide ? output.height * ratio : output.width
  const height = wide ? output.height : output.width / ratio
  ctx.drawImage(image, (output.width - width) / 2, (output.height - height) / 2, width, height)
}

export function drawTitleCard(
  ctx: Ctx,
  card: TitleCard,
  progress: number,
  output: { width: number; height: number },
  /** Used only when the card has no face of its own — older projects. */
  fallbackFont: string
): void {
  const alpha = alphaFor(progress, card)
  const fontFamily = card.fontFamily || fallbackFont

  ctx.save()
  ctx.fillStyle = card.background
  ctx.fillRect(0, 0, output.width, output.height)

  const backdrop = card.backgroundSrc ? titleImage(card.backgroundSrc) : null
  if (backdrop) {
    drawCover(ctx, backdrop, output, card.backgroundFit)
    // The wash is part of the background, not of the text, so it is painted at
    // full strength and the card fades as one thing. Dimming it along with the
    // type would make the picture flash to full brightness on the way in.
    if (card.backgroundDim > 0.001) {
      ctx.save()
      ctx.globalAlpha = Math.min(1, card.backgroundDim)
      ctx.fillStyle = card.background
      ctx.fillRect(0, 0, output.width, output.height)
      ctx.restore()
    }
  }

  ctx.globalAlpha = alpha
  // Authored against 1080 so a card looks the same at any export size.
  const scale = output.height / 1080
  const centreX = output.width / 2

  const image = card.imageSrc ? titleImage(card.imageSrc) : null
  const imageHeight = image ? card.imageHeight * scale : 0
  const titleSize = card.titleSize * scale
  const subtitleSize = card.subtitleSize * scale

  // Laid out as one block and centred as a whole, so adding a subtitle does
  // not shunt the title off centre.
  const gap = 22 * scale
  const blockHeight =
    imageHeight +
    (image ? gap : 0) +
    (card.title ? titleSize : 0) +
    (card.subtitle ? subtitleSize + gap * 0.5 : 0)
  let y = output.height / 2 - blockHeight / 2

  if (image) {
    const ratio = image.naturalWidth / image.naturalHeight
    const width = imageHeight * ratio
    ctx.drawImage(image, centreX - width / 2, y, width, imageHeight)
    y += imageHeight + gap
  }

  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillStyle = card.color

  if (card.title) {
    ctx.font = `700 ${titleSize}px "${fontFamily}", system-ui, sans-serif`
    ctx.fillText(card.title, centreX, y)
    y += titleSize + gap * 0.5
  }
  if (card.subtitle) {
    ctx.font = `400 ${subtitleSize}px "${fontFamily}", system-ui, sans-serif`
    ctx.globalAlpha = alpha * 0.75
    ctx.fillText(card.subtitle, centreX, y)
  }

  ctx.restore()
}
