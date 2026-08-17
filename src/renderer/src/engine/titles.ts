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
  /** Drawn behind the text; the recording's own background is used when null. */
  background: string
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
  background: '#0d0d12',
  imageSrc: null,
  imageHeight: 180,
  fade: 0.45
}

export const DEFAULT_OUTRO: TitleCard = {
  ...DEFAULT_INTRO,
  titleSize: 66,
  subtitle: ''
}

/** Cached decode, so a card does not re-decode its logo on every frame. */
const images = new Map<string, HTMLImageElement>()

export function titleImage(src: string): HTMLImageElement | null {
  const existing = images.get(src)
  if (existing) return existing.complete && existing.naturalWidth > 0 ? existing : null
  const image = new Image()
  image.src = src
  images.set(src, image)
  return null
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

export function drawTitleCard(
  ctx: Ctx,
  card: TitleCard,
  progress: number,
  output: { width: number; height: number },
  fontFamily: string
): void {
  const alpha = alphaFor(progress, card)

  ctx.save()
  ctx.fillStyle = card.background
  ctx.fillRect(0, 0, output.width, output.height)

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
