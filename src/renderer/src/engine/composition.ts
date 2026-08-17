// MIT License - Copyright (c) fintonlabs.com
import { CameraSolver } from './camera'
import { drawCaption } from './captions'
import { drawTitleCard, introProgress, outroProgress } from './titles'
import { CursorTrack } from './cursorTrack'
import { drawClickRing, drawCursor, resolveShape } from './cursorArt'
import { generateSegments } from './autozoom'
import type { FadeSettings, Project, Recording, Rect, ZoomSegment } from './types'

export type Drawable = CanvasImageSource

export interface FrameSources {
  screen: Drawable | null
  camera?: Drawable | null
  /** Intrinsic camera dimensions, needed to crop the bubble correctly. */
  cameraSize?: { width: number; height: number }
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

/**
 * Owns everything derived from a recording plus its settings, and draws single
 * frames from it.
 *
 * The same `render()` runs for the on-screen preview and for the exporter, and
 * it is a pure function of `t` — no accumulated state, no frame counters. That
 * is what guarantees the exported file matches what was previewed rather than
 * drifting a few frames apart.
 */
/**
 * How black the frame should be at `t`, for a fade over `range`.
 *
 * Shared with the editor so preview audio can duck by the same amount the
 * picture darkens — a faded ending that is still audible sounds like a cut.
 */
export function fadeAlphaAt(
  t: number,
  range: { start: number; end: number },
  fade: FadeSettings
): number {
  let alpha = 0
  if (fade.in > 0) {
    const into = t - range.start
    if (into < fade.in) alpha = Math.max(alpha, 1 - into / fade.in)
  }
  if (fade.out > 0) {
    const left = range.end - t
    if (left < fade.out) alpha = Math.max(alpha, 1 - left / fade.out)
  }
  return Math.min(1, Math.max(0, alpha))
}

export class Composition {
  recording: Recording
  project: Project
  /**
   * The span being played or exported. Fades are relative to this rather than
   * to the whole recording, so trimming moves them with it.
   */
  range: { start: number; end: number }
  cursorTrack: CursorTrack
  camera!: CameraSolver
  content!: Rect
  private noise: CanvasPattern | null = null
  private backdropCache: CanvasImageSource | null = null
  private backdropSignature = ''

  constructor(recording: Recording, project: Project) {
    this.recording = recording
    this.project = project
    this.range = { start: 0, end: recording.duration }
    this.cursorTrack = new CursorTrack(recording.input, recording.duration, project.cursor)
    this.rebuildLayout()
  }

  /** Regenerates the automatic zoom segments, preserving user-made ones. */
  regenerateZoom(): void {
    const manual = this.project.segments.filter((s) => !s.auto)
    const auto = generateSegments(
      this.recording.input,
      this.project.zoom,
      this.recording.source,
      this.recording.duration
    )
    this.project.segments = [...auto, ...manual].sort((a, b) => a.start - b.start)
    this.rebuildLayout()
  }

  rebuildCursor(): void {
    this.cursorTrack = new CursorTrack(
      this.recording.input,
      this.recording.duration,
      this.project.cursor
    )
    this.rebuildLayout()
  }

  /** Recomputes the content rect and the camera; cheap enough to call on edit. */
  rebuildLayout(): void {
    const { output, frame } = this.project
    const pad = frame.padding * Math.min(output.width, output.height)
    const avail: Rect = {
      x: pad,
      y: pad,
      w: Math.max(16, output.width - pad * 2),
      h: Math.max(16, output.height - pad * 2)
    }

    if (frame.fitMode === 'cover') {
      this.content = avail
    } else {
      const sourceAspect = this.recording.source.width / this.recording.source.height
      const availAspect = avail.w / avail.h
      if (sourceAspect > availAspect) {
        const h = avail.w / sourceAspect
        this.content = { x: avail.x, y: avail.y + (avail.h - h) / 2, w: avail.w, h }
      } else {
        const w = avail.h * sourceAspect
        this.content = { x: avail.x + (avail.w - w) / 2, y: avail.y, w, h: avail.h }
      }
    }

    this.camera = new CameraSolver(
      this.project.segments,
      this.project.zoom,
      this.cursorTrack,
      this.recording.source,
      this.content.w / this.content.h
    )
  }

  setSegments(segments: ZoomSegment[]): void {
    this.project.segments = [...segments].sort((a, b) => a.start - b.start)
    this.rebuildLayout()
  }

  // -------------------------------------------------------------------------
  // Drawing
  // -------------------------------------------------------------------------

  render(ctx: Ctx, t: number, sources: FrameSources): void {
    const { output, frame } = this.project
    ctx.save()
    ctx.clearRect(0, 0, output.width, output.height)

    // Outside the recording entirely: a title card is the whole frame, so
    // nothing else is drawn and nothing else needs to know it happened.
    const opening = introProgress(t, this.project.intro)
    if (opening !== null) {
      drawTitleCard(ctx, this.project.intro, opening, output, this.project.captionStyle.fontFamily)
      ctx.restore()
      return
    }
    const closing = outroProgress(t, this.range.end, this.project.outro)
    if (closing !== null) {
      drawTitleCard(ctx, this.project.outro, closing, output, this.project.captionStyle.fontFamily)
      ctx.restore()
      return
    }

    // The background, its grain and the frame's drop shadow are identical on
    // every frame, and the shadow in particular is expensive — a large
    // `shadowBlur` dominated export time before this was cached. Draw them once
    // and blit.
    const backdrop = this.backdrop(sources)
    if (backdrop) ctx.drawImage(backdrop, 0, 0)
    else this.drawBackdrop(ctx, sources)

    const cam = this.camera.at(t)
    const content = this.content

    ctx.save()
    if (frame.rotate) {
      ctx.translate(content.x + content.w / 2, content.y + content.h / 2)
      ctx.rotate((frame.rotate * Math.PI) / 180)
      ctx.translate(-(content.x + content.w / 2), -(content.y + content.h / 2))
    }

    const radius = this.scaledRadius()

    ctx.save()
    ctx.beginPath()
    ctx.roundRect(content.x, content.y, content.w, content.h, radius)
    ctx.clip()

    if (sources.screen) {
      // Source-rect crop is the zoom: no transform stack, no resampling twice.
      ctx.drawImage(
        sources.screen,
        cam.viewport.x,
        cam.viewport.y,
        cam.viewport.w,
        cam.viewport.h,
        content.x,
        content.y,
        content.w,
        content.h
      )
    } else {
      ctx.fillStyle = '#111214'
      ctx.fillRect(content.x, content.y, content.w, content.h)
    }

    const toOutput = (px: number, py: number): { x: number; y: number } => ({
      x: content.x + ((px - cam.viewport.x) / cam.viewport.w) * content.w,
      y: content.y + ((py - cam.viewport.y) / cam.viewport.h) * content.h
    })

    const cursor = this.cursorTrack.at(t)
    const cursorOut = toOutput(cursor.x, cursor.y)

    this.drawSpotlight(ctx, cursorOut, content)
    this.drawClicks(ctx, t, toOutput)
    this.drawPointer(ctx, t, cursor, cursorOut)

    ctx.restore()

    this.drawFrameBorder(ctx, content, radius)
    ctx.restore()

    this.drawPip(ctx, sources, cursorOut)
    this.drawKeystrokes(ctx, t)

    // Over everything the recording contains, but under the fade — a caption
    // that stayed bright while the picture faded out would be the last thing
    // left on screen.
    drawCaption(ctx, t, this.project.captions, this.project.captionStyle, output)

    // Last, so it covers everything: background, frame, cursor and camera.
    const fade = fadeAlphaAt(t, this.range, this.project.fade)
    if (fade > 0.001) {
      ctx.fillStyle = `rgba(0, 0, 0, ${fade})`
      ctx.fillRect(0, 0, output.width, output.height)
    }

    ctx.restore()
  }

  private scaledRadius(): number {
    // Radius is authored against 1080p so the look holds at any export size.
    return (this.project.frame.radius * this.project.output.height) / 1080
  }

  /**
   * Returns a cached canvas holding everything behind the video, rebuilding it
   * only when a setting that affects it changes.
   *
   * Skipped entirely when the background is a blurred copy of the recording,
   * since that changes with every frame.
   */
  private backdrop(sources: FrameSources): CanvasImageSource | null {
    const { background, frame, output } = this.project
    if (background.useWallpaperBlur) return null

    const image =
      background.kind === 'image' && background.imageSrc
        ? getBackgroundImage(background.imageSrc)
        : null
    const signature = JSON.stringify([
      output.width,
      output.height,
      background,
      // Rebuild once the image arrives, or the fallback colour would stick.
      image?.complete && image.naturalWidth > 0,
      frame.padding,
      frame.radius,
      frame.shadow,
      frame.rotate,
      frame.fitMode
    ])
    if (this.backdropCache && this.backdropSignature === signature) return this.backdropCache

    const canvas =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(output.width, output.height)
        : Object.assign(document.createElement('canvas'), {
            width: output.width,
            height: output.height
          })
    const bctx = (canvas as OffscreenCanvas).getContext('2d') as Ctx | null
    if (!bctx) return null

    this.drawBackdrop(bctx, sources)

    this.backdropCache = canvas as unknown as CanvasImageSource
    this.backdropSignature = signature
    return this.backdropCache
  }

  /** Background + grain + the frame's drop shadow, in output space. */
  private drawBackdrop(ctx: Ctx, sources: FrameSources): void {
    const { frame } = this.project
    const content = this.content
    this.drawBackground(ctx, sources)

    ctx.save()
    if (frame.rotate) {
      ctx.translate(content.x + content.w / 2, content.y + content.h / 2)
      ctx.rotate((frame.rotate * Math.PI) / 180)
      ctx.translate(-(content.x + content.w / 2), -(content.y + content.h / 2))
    }
    this.drawFrameShadow(ctx, content, this.scaledRadius())
    ctx.restore()
  }

  // -------------------------------------------------------------------------

  private drawBackground(ctx: Ctx, sources: FrameSources): void {
    const { background, output } = this.project
    const { width: w, height: h } = output

    if (background.kind === 'none') {
      ctx.clearRect(0, 0, w, h)
      return
    }

    if (background.useWallpaperBlur && sources.screen) {
      // A blurred, over-scaled copy of the recording itself — the frame reads
      // as floating above its own content.
      ctx.save()
      ctx.filter = `blur(${Math.round(h * 0.055)}px) saturate(1.5) brightness(0.72)`
      // Over-scale so the blur kernel never reaches past the edges and leaves
      // a pale border.
      const scale = 1.3
      ctx.drawImage(
        sources.screen,
        (-w * (scale - 1)) / 2,
        (-h * (scale - 1)) / 2,
        w * scale,
        h * scale
      )
      ctx.restore()
    } else if (background.kind === 'image' && background.imageSrc) {
      const image = getBackgroundImage(background.imageSrc)
      if (image?.complete && image.naturalWidth > 0) {
        // Cover-fit: fill the frame, crop the overflow, never distort.
        const scale = Math.max(w / image.naturalWidth, h / image.naturalHeight)
        const iw = image.naturalWidth * scale
        const ih = image.naturalHeight * scale
        ctx.drawImage(image, (w - iw) / 2, (h - ih) / 2, iw, ih)
      } else {
        // Still loading — paint the fallback colour rather than flashing white.
        ctx.fillStyle = background.colors[0] ?? '#111'
        ctx.fillRect(0, 0, w, h)
      }
    } else if (background.kind === 'solid') {
      ctx.fillStyle = background.colors[0] ?? '#111'
      ctx.fillRect(0, 0, w, h)
    } else if (background.kind === 'mesh') {
      ctx.fillStyle = background.colors[0] ?? '#111'
      ctx.fillRect(0, 0, w, h)
      const spots: [number, number][] = [
        [0.18, 0.2],
        [0.82, 0.26],
        [0.5, 0.86]
      ]
      background.colors.slice(1).forEach((color, i) => {
        const [fx, fy] = spots[i % spots.length]
        const g = ctx.createRadialGradient(w * fx, h * fy, 0, w * fx, h * fy, Math.max(w, h) * 0.62)
        g.addColorStop(0, color)
        g.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.fillStyle = g
        ctx.fillRect(0, 0, w, h)
      })
    } else {
      const rad = (background.angle * Math.PI) / 180
      const cx = w / 2
      const cy = h / 2
      const len = Math.abs(w * Math.cos(rad)) + Math.abs(h * Math.sin(rad))
      const g = ctx.createLinearGradient(
        cx - (Math.cos(rad) * len) / 2,
        cy - (Math.sin(rad) * len) / 2,
        cx + (Math.cos(rad) * len) / 2,
        cy + (Math.sin(rad) * len) / 2
      )
      const colors = background.colors.length ? background.colors : ['#1c1d22', '#0b0b0d']
      colors.forEach((color, i) => g.addColorStop(i / Math.max(1, colors.length - 1), color))
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, h)
    }

    if (background.grain > 0) this.drawGrain(ctx, background.grain)
  }

  private drawGrain(ctx: Ctx, amount: number): void {
    if (!this.noise) this.noise = buildNoise(ctx)
    if (!this.noise) return
    ctx.save()
    ctx.globalAlpha = amount * 0.5
    ctx.fillStyle = this.noise
    ctx.fillRect(0, 0, this.project.output.width, this.project.output.height)
    ctx.restore()
  }

  private drawFrameShadow(ctx: Ctx, content: Rect, radius: number): void {
    const shadow = this.project.frame.shadow
    if (shadow.opacity <= 0) return
    const k = this.project.output.height / 1080
    ctx.save()
    ctx.shadowColor = `rgba(0,0,0,${shadow.opacity})`
    ctx.shadowBlur = shadow.blur * k
    ctx.shadowOffsetY = shadow.y * k
    ctx.fillStyle = '#000'
    const spread = shadow.spread * k
    ctx.beginPath()
    ctx.roundRect(
      content.x - spread,
      content.y - spread,
      content.w + spread * 2,
      content.h + spread * 2,
      radius + spread
    )
    ctx.fill()
    ctx.restore()
  }

  private drawFrameBorder(ctx: Ctx, content: Rect, radius: number): void {
    const border = this.project.frame.border
    if (border.width <= 0) return
    const k = this.project.output.height / 1080
    ctx.save()
    ctx.beginPath()
    ctx.roundRect(content.x, content.y, content.w, content.h, radius)
    ctx.strokeStyle = border.color
    ctx.lineWidth = border.width * k
    ctx.stroke()
    ctx.restore()
  }

  private drawSpotlight(ctx: Ctx, cursor: { x: number; y: number }, content: Rect): void {
    const spot = this.project.cursor.spotlight
    if (!spot.enabled || spot.dim <= 0) return
    const r = spot.radius * this.project.output.height
    const g = ctx.createRadialGradient(cursor.x, cursor.y, r * 0.35, cursor.x, cursor.y, r)
    g.addColorStop(0, 'rgba(0,0,0,0)')
    g.addColorStop(1, `rgba(0,0,0,${spot.dim})`)
    ctx.save()
    ctx.fillStyle = g
    ctx.fillRect(content.x, content.y, content.w, content.h)
    ctx.restore()
  }

  private drawClicks(
    ctx: Ctx,
    t: number,
    toOutput: (x: number, y: number) => { x: number; y: number }
  ): void {
    const settings = this.project.cursor.clicks
    if (!settings.enabled || !settings.ring) return
    const maxRadius = settings.radius * this.project.output.height * 0.06

    for (const click of this.recording.input.clicks) {
      const age = t - click.t
      if (age < 0 || age > settings.duration) continue
      const p = toOutput(click.x, click.y)
      drawClickRing(ctx, p.x, p.y, age, settings.duration, maxRadius, settings.color)
    }
  }

  private drawPointer(
    ctx: Ctx,
    t: number,
    cursor: { opacity: number; shape: string; pressed: boolean },
    out: { x: number; y: number }
  ): void {
    const settings = this.project.cursor
    if (!settings.visible || cursor.opacity <= 0.01) return

    // Squash on press, with a short spring back out — the pointer acknowledges
    // the click even when the ring effect is switched off.
    let press = 1
    if (settings.clicks.press) {
      let nearest = Infinity
      for (const click of this.recording.input.clicks) {
        const age = t - click.t
        if (age >= 0 && age < nearest) nearest = age
      }
      if (nearest < 0.26) {
        const f = nearest / 0.26
        press = 1 - 0.18 * Math.exp(-f * 5) * Math.cos(f * 9)
      }
    }

    // 'auto' trusts what the recorder detected; anything else forces a shape,
    // which matters because that detection is unreliable on current macOS.
    const shape = settings.shape === 'auto' ? resolveShape(cursor.shape) : settings.shape
    const palette =
      settings.style === 'light'
        ? { fill: '#ffffff', stroke: '#0a0a0a' }
        : settings.style === 'accent'
          ? { fill: settings.clicks.color, stroke: '#0a0a0a' }
          : { fill: '#0a0a0a', stroke: '#ffffff' }

    drawCursor(ctx, {
      x: out.x,
      y: out.y,
      height: settings.size * this.project.output.height * 0.034,
      shape,
      opacity: cursor.opacity,
      press,
      ...palette
    })
  }

  private drawPip(ctx: Ctx, sources: FrameSources, cursor: { x: number; y: number }): void {
    const pip = this.project.pip
    if (!pip.enabled || !sources.camera || !sources.cameraSize) return

    const { width: outW, height: outH } = this.project.output
    let size = pip.size * outH
    const margin = pip.margin * outH

    let cx: number
    let cy: number
    switch (pip.position) {
      case 'top-left':
        cx = margin + size / 2
        cy = margin + size / 2
        break
      case 'top-right':
        cx = outW - margin - size / 2
        cy = margin + size / 2
        break
      case 'bottom-right':
        cx = outW - margin - size / 2
        cy = outH - margin - size / 2
        break
      case 'custom':
        cx = pip.customX * outW
        cy = pip.customY * outH
        break
      default:
        cx = margin + size / 2
        cy = outH - margin - size / 2
    }

    // Shrink out of the way when the pointer comes close, rather than letting
    // the bubble sit on top of whatever is being demonstrated.
    let alpha = 1
    if (pip.avoidCursor) {
      const d = Math.hypot(cursor.x - cx, cursor.y - cy)
      const near = size * 0.95
      const far = size * 1.5
      const proximity = 1 - smoothstep(near, far, d)
      size *= 1 - 0.42 * proximity
      alpha = 1 - 0.25 * proximity
    }

    const half = size / 2
    const k = outH / 1080

    ctx.save()
    ctx.globalAlpha *= alpha

    if (pip.shadow.opacity > 0) {
      ctx.save()
      ctx.shadowColor = `rgba(0,0,0,${pip.shadow.opacity})`
      ctx.shadowBlur = pip.shadow.blur * k
      ctx.shadowOffsetY = pip.shadow.y * k
      ctx.fillStyle = '#000'
      pipPath(ctx, cx, cy, size, pip.shape, pip.radius * k)
      ctx.fill()
      ctx.restore()
    }

    ctx.save()
    pipPath(ctx, cx, cy, size, pip.shape, pip.radius * k)
    ctx.clip()

    // Centre-crop the camera to a square, then apply the framing zoom.
    const cam = sources.cameraSize
    const side = Math.min(cam.width, cam.height) / pip.zoom
    const sx = (cam.width - side) / 2 + pip.offsetX * side
    const sy = (cam.height - side) / 2 + pip.offsetY * side

    if (pip.mirror) {
      ctx.translate(cx, 0)
      ctx.scale(-1, 1)
      ctx.translate(-cx, 0)
    }
    ctx.drawImage(sources.camera, sx, sy, side, side, cx - half, cy - half, size, size)
    ctx.restore()

    if (pip.border.width > 0) {
      pipPath(ctx, cx, cy, size, pip.shape, pip.radius * k)
      ctx.strokeStyle = pip.border.color
      ctx.lineWidth = pip.border.width * k
      ctx.stroke()
    }
    ctx.restore()
  }

  private drawKeystrokes(ctx: Ctx, t: number): void {
    const settings = this.project.keystrokes
    if (!settings.enabled) return

    const active = this.recording.input.keys.filter(
      (k) => t - k.t >= 0 && t - k.t < settings.duration
    )
    if (active.length === 0) return

    const key = active[active.length - 1]
    const age = t - key.t
    const appear = Math.min(1, age / 0.14)
    const fade = Math.min(1, (settings.duration - age) / 0.3)
    const alpha = Math.min(appear, fade)

    const { width: outW, height: outH } = this.project.output
    const fontSize = outH * 0.042
    const label = formatShortcut(key)

    ctx.save()
    ctx.globalAlpha *= alpha
    ctx.font = `600 ${fontSize}px "Bricolage Grotesque", system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    const padX = fontSize * 0.7
    const padY = fontSize * 0.42
    const textWidth = ctx.measureText(label).width
    const boxW = textWidth + padX * 2
    const boxH = fontSize + padY * 2
    const x = outW / 2
    const y = settings.position === 'top' ? outH * 0.09 : outH * 0.9
    // Rise slightly into place instead of appearing flat.
    const rise = (1 - appear) * fontSize * 0.5

    ctx.translate(0, rise)
    ctx.beginPath()
    ctx.roundRect(x - boxW / 2, y - boxH / 2, boxW, boxH, boxH * 0.34)
    ctx.fillStyle = 'rgba(12,12,14,0.82)'
    ctx.fill()
    ctx.strokeStyle = 'rgba(255,255,255,0.16)'
    ctx.lineWidth = Math.max(1, outH / 1080)
    ctx.stroke()

    ctx.fillStyle = '#f5f5f7'
    ctx.fillText(label, x, y + fontSize * 0.04)
    ctx.restore()
  }
}

// ---------------------------------------------------------------------------

function pipPath(
  ctx: Ctx,
  cx: number,
  cy: number,
  size: number,
  shape: 'circle' | 'rounded' | 'square',
  radius: number
): void {
  const half = size / 2
  ctx.beginPath()
  if (shape === 'circle') ctx.arc(cx, cy, half, 0, Math.PI * 2)
  else if (shape === 'square') ctx.rect(cx - half, cy - half, size, size)
  else ctx.roundRect(cx - half, cy - half, size, size, Math.min(radius, half))
}

function formatShortcut(key: { chars: string; mods: string[] }): string {
  const symbols: Record<string, string> = { cmd: '⌘', alt: '⌥', ctrl: '⌃', shift: '⇧' }
  const order = ['ctrl', 'alt', 'shift', 'cmd']
  const prefix = order
    .filter((m) => key.mods.includes(m))
    .map((m) => symbols[m])
    .join('')
  return prefix + (key.chars || '')
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/**
 * Background images are decoded once and reused. `render` is synchronous, so it
 * draws whatever is ready and the frame is rebuilt when loading completes.
 */
const backgroundImages = new Map<string, HTMLImageElement>()

/**
 * Backgrounds may only come from a take's own media or an inline data URI.
 *
 * Profiles are JSON on disk and are spread straight into the project, so an
 * edited one could otherwise set the background to a remote URL and have every
 * render quietly phone home.
 */
function isPermittedImageSource(src: string): boolean {
  return src.startsWith('rec://') || src.startsWith('data:image/')
}

function getBackgroundImage(src: string): HTMLImageElement | null {
  if (typeof Image === 'undefined') return null
  if (!isPermittedImageSource(src)) return null
  let image = backgroundImages.get(src)
  if (!image) {
    image = new Image()
    image.src = src
    backgroundImages.set(src, image)
  }
  return image
}

let noiseCanvas: HTMLCanvasElement | OffscreenCanvas | null = null

function buildNoise(ctx: Ctx): CanvasPattern | null {
  if (!noiseCanvas) {
    const size = 128
    const canvas =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(size, size)
        : Object.assign(document.createElement('canvas'), { width: size, height: size })
    const nctx = (canvas as HTMLCanvasElement).getContext('2d') as CanvasRenderingContext2D | null
    if (!nctx) return null
    const image = nctx.createImageData(size, size)
    for (let i = 0; i < image.data.length; i += 4) {
      const v = 128 + (Math.random() - 0.5) * 255
      image.data[i] = v
      image.data[i + 1] = v
      image.data[i + 2] = v
      image.data[i + 3] = 26
    }
    nctx.putImageData(image, 0, 0)
    noiseCanvas = canvas
  }
  return ctx.createPattern(noiseCanvas as CanvasImageSource, 'repeat')
}
