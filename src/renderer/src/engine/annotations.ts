// MIT License - Copyright (c) fintonlabs.com

/**
 * Marks drawn onto a recording after the fact: arrows, boxes, highlights, a
 * focus that dims everything else, and blur or pixelation to hide something.
 *
 * Every annotation lives in *source* pixels — the recording's own coordinates —
 * not in output pixels. That is what keeps a box around a button around that
 * button while the camera zooms in on it; drawn in output pixels it would stay
 * put on screen and the button would slide out from under it.
 *
 * Drawing is split in two because the two halves sit at different depths.
 * Hiding something has to happen to the screen pixels themselves, immediately
 * after they are drawn; the marks go over the top. Both come before the cursor,
 * so the pointer is never hidden by the thing it is pointing at.
 */

/** Either canvas context; the exporter renders offscreen. */
type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

export type AnnotationKind = 'arrow' | 'box' | 'highlight' | 'focus' | 'blur' | 'pixelate'

export interface Annotation {
  id: string
  kind: AnnotationKind
  /** Seconds on the recording's timeline. */
  start: number
  end: number
  /**
   * Source pixels. For every kind but the arrow this is a rectangle. For an
   * arrow it runs from the tail at (x, y) to the head at (x + w, y + h), so w and
   * h may be negative — one shape for both keeps dragging and storing simple.
   */
  x: number
  y: number
  w: number
  h: number
  color: string
  /** Line thickness at a 1080-high frame, for arrows and boxes. */
  width: number
  /** Blur radius, or pixel block size, in source pixels. */
  amount: number
  /** Seconds to fade in and out. Never applied to blur or pixelate. */
  fade: number
}

/** Where the camera is looking and where that lands on the frame. */
export interface AnnotationView {
  viewport: { x: number; y: number; w: number; h: number }
  content: { x: number; y: number; w: number; h: number }
  /** Output height, for scaling line thickness. */
  outputHeight: number
}

export const ANNOTATION_COLORS = ['#ff3b5c', '#ffcc00', '#34d399', '#4b9bff', '#ffffff', '#0a0a0b']

/** Sensible starting values for each kind of mark. */
export function annotationDefaults(kind: AnnotationKind): Omit<Annotation, 'id' | 'start' | 'end' | 'x' | 'y' | 'w' | 'h'> {
  switch (kind) {
    case 'arrow':
      return { kind, color: '#ff3b5c', width: 8, amount: 0, fade: 0.2 }
    case 'box':
      return { kind, color: '#ff3b5c', width: 6, amount: 0, fade: 0.2 }
    case 'highlight':
      return { kind, color: '#ffcc00', width: 0, amount: 0, fade: 0.2 }
    case 'focus':
      return { kind, color: '#000000', width: 0, amount: 0.6, fade: 0.3 }
    case 'blur':
      return { kind, color: '#000000', width: 0, amount: 14, fade: 0 }
    case 'pixelate':
      return { kind, color: '#000000', width: 0, amount: 14, fade: 0 }
  }
}

export const ANNOTATION_LABELS: Record<AnnotationKind, string> = {
  arrow: 'Arrow',
  box: 'Box',
  highlight: 'Highlight',
  focus: 'Focus',
  blur: 'Blur',
  pixelate: 'Pixelate'
}

/** Hides what is underneath, rather than pointing at it. */
export const isObscuring = (kind: AnnotationKind): boolean => kind === 'blur' || kind === 'pixelate'

/**
 * An annotation with anything missing filled in from its kind's defaults.
 *
 * Scripted walkthroughs pass annotations straight from a spec, and a blur that
 * arrives without an `amount` would set `blur(NaNpx)` — a filter the canvas
 * quietly ignores, so the region is drawn perfectly sharp. A mark meant to hide
 * a password must not fail open like that.
 */
export function complete(a: Annotation): Annotation {
  const d = annotationDefaults(a.kind)
  const number = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return {
    ...a,
    color: typeof a.color === 'string' && a.color ? a.color : d.color,
    width: number(a.width, d.width),
    amount: number(a.amount, d.amount),
    fade: isObscuring(a.kind) ? 0 : number(a.fade, d.fade)
  }
}

/** Annotations showing at `t`, in the order they were added. */
export function activeAnnotations(list: readonly Annotation[] | undefined, t: number): Annotation[] {
  if (!list) return []
  return list
    .filter((a) => a && ANNOTATION_LABELS[a.kind] !== undefined && t >= a.start && t < a.end)
    .map(complete)
}

/**
 * 0–1 opacity at `t`.
 *
 * Blur and pixelate are always fully on while they are on. A fade would show
 * the very thing being hidden, half-strength, for a moment either side — which
 * is exactly the moment someone pauses on.
 */
export function annotationAlpha(a: Annotation, t: number): number {
  if (t < a.start || t >= a.end) return 0
  if (isObscuring(a.kind) || a.fade <= 0) return 1
  const ramp = Math.min(a.fade, (a.end - a.start) / 3)
  if (ramp <= 0) return 1
  return Math.max(0, Math.min(1, (t - a.start) / ramp, (a.end - t) / ramp))
}

/** A source point on the output frame, under the camera as it is at this moment. */
export function sourceToOutput(view: AnnotationView, px: number, py: number): { x: number; y: number } {
  const { viewport: vp, content } = view
  return {
    x: content.x + ((px - vp.x) / vp.w) * content.w,
    y: content.y + ((py - vp.y) / vp.h) * content.h
  }
}

/** The annotation's rectangle in source pixels, with a positive width and height. */
export function normalisedRect(a: Pick<Annotation, 'x' | 'y' | 'w' | 'h'>): { x: number; y: number; w: number; h: number } {
  return {
    x: Math.min(a.x, a.x + a.w),
    y: Math.min(a.y, a.y + a.h),
    w: Math.abs(a.w),
    h: Math.abs(a.h)
  }
}

/** The annotation's rectangle on the output frame. */
export function outputRect(view: AnnotationView, a: Annotation): { x: number; y: number; w: number; h: number } {
  const r = normalisedRect(a)
  const tl = sourceToOutput(view, r.x, r.y)
  const br = sourceToOutput(view, r.x + r.w, r.y + r.h)
  return { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y }
}

/** Source pixels to output pixels, at the current zoom. */
const zoomOf = (view: AnnotationView): number => view.content.w / view.viewport.w

export type CanvasFactory = (w: number, h: number) => { getContext(type: '2d'): Ctx | null; width: number; height: number }

let mosaic: ReturnType<CanvasFactory> | null = null
const defaultFactory: CanvasFactory = (w, h) => new OffscreenCanvas(w, h) as unknown as ReturnType<CanvasFactory>

/**
 * Blur and pixelation, applied to the screen pixels just drawn.
 *
 * Called while the frame's clip is still in place, so nothing spills onto the
 * background.
 */
export function drawObscured(
  ctx: Ctx,
  t: number,
  list: readonly Annotation[] | undefined,
  screen: CanvasImageSource | null,
  view: AnnotationView,
  makeCanvas: CanvasFactory = defaultFactory
): void {
  if (!screen) return
  for (const a of activeAnnotations(list, t)) {
    if (!isObscuring(a.kind)) continue
    const src = normalisedRect(a)
    if (src.w < 1 || src.h < 1) continue
    const out = outputRect(view, a)

    ctx.save()
    ctx.beginPath()
    ctx.rect(out.x, out.y, out.w, out.h)
    ctx.clip()

    if (a.kind === 'blur') {
      const radius = Math.max(1, a.amount)
      const blurOut = radius * zoomOf(view)
      // The crop reaches past the region by twice the radius, so the blur at
      // the edge is made of real neighbouring pixels rather than fading in the
      // transparent nothing beyond the crop — which would leave a sharp,
      // readable band just inside the border.
      const m = radius * 2
      const mo = m * zoomOf(view)
      ctx.filter = `blur(${blurOut}px)`
      ctx.drawImage(screen, src.x - m, src.y - m, src.w + 2 * m, src.h + 2 * m, out.x - mo, out.y - mo, out.w + 2 * mo, out.h + 2 * mo)
      ctx.filter = 'none'
    } else {
      // Blocks are measured in source pixels, so they stay locked to the
      // content under zoom instead of reshuffling as the camera moves — a
      // shimmering mosaic draws the eye to exactly what it is hiding.
      const block = Math.max(2, a.amount)
      const cols = Math.max(1, Math.ceil(src.w / block))
      const rows = Math.max(1, Math.ceil(src.h / block))
      if (!mosaic || mosaic.width < cols || mosaic.height < rows) {
        mosaic = makeCanvas(Math.max(cols, mosaic?.width ?? 0), Math.max(rows, mosaic?.height ?? 0))
      }
      const small = mosaic.getContext('2d')
      if (small) {
        small.imageSmoothingEnabled = true
        small.imageSmoothingQuality = 'high'
        small.clearRect(0, 0, cols, rows)
        small.drawImage(screen, src.x, src.y, cols * block, rows * block, 0, 0, cols, rows)
        ctx.imageSmoothingEnabled = false
        ctx.drawImage(
          mosaic as unknown as CanvasImageSource,
          0,
          0,
          cols,
          rows,
          out.x,
          out.y,
          cols * block * zoomOf(view),
          rows * block * zoomOf(view)
        )
      }
    }
    ctx.restore()
  }
}

/** Arrows, boxes, highlights and focus, over the screen but under the cursor. */
export function drawMarks(ctx: Ctx, t: number, list: readonly Annotation[] | undefined, view: AnnotationView): void {
  const active = activeAnnotations(list, t).filter((a) => !isObscuring(a.kind))
  if (active.length === 0) return
  const unit = view.outputHeight / 1080

  // Focus first: it dims the frame, and a box or arrow drawn before it would be
  // dimmed along with everything else.
  const ordered = [
    ...active.filter((a) => a.kind === 'focus'),
    ...active.filter((a) => a.kind === 'highlight'),
    ...active.filter((a) => a.kind === 'box'),
    ...active.filter((a) => a.kind === 'arrow')
  ]

  for (const a of ordered) {
    const alpha = annotationAlpha(a, t)
    if (alpha <= 0) continue
    ctx.save()
    ctx.globalAlpha *= alpha

    if (a.kind === 'focus') {
      const r = outputRect(view, a)
      const { content } = view
      ctx.beginPath()
      ctx.rect(content.x, content.y, content.w, content.h)
      ctx.roundRect(r.x, r.y, r.w, r.h, 12 * unit)
      ctx.fillStyle = `rgba(0,0,0,${Math.max(0, Math.min(0.9, a.amount))})`
      ctx.fill('evenodd')
    } else if (a.kind === 'highlight') {
      const r = outputRect(view, a)
      ctx.globalAlpha *= 0.32
      ctx.fillStyle = a.color
      ctx.beginPath()
      ctx.roundRect(r.x, r.y, r.w, r.h, 6 * unit)
      ctx.fill()
    } else if (a.kind === 'box') {
      const r = outputRect(view, a)
      const w = Math.max(1, a.width * unit)
      ctx.lineJoin = 'round'
      // A dark keyline under the colour, so a red box stays visible on a red UI.
      ctx.strokeStyle = 'rgba(0,0,0,0.45)'
      ctx.lineWidth = w + 4 * unit
      ctx.beginPath()
      ctx.roundRect(r.x, r.y, r.w, r.h, 10 * unit)
      ctx.stroke()
      ctx.strokeStyle = a.color
      ctx.lineWidth = w
      ctx.stroke()
    } else if (a.kind === 'arrow') {
      drawArrow(ctx, view, a, unit)
    }
    ctx.restore()
  }
}

function drawArrow(ctx: Ctx, view: AnnotationView, a: Annotation, unit: number): void {
  const tail = sourceToOutput(view, a.x, a.y)
  const head = sourceToOutput(view, a.x + a.w, a.y + a.h)
  const dx = head.x - tail.x
  const dy = head.y - tail.y
  const length = Math.hypot(dx, dy)
  if (length < 2) return

  const w = Math.max(1, a.width * unit)
  const headLength = Math.min(length * 0.6, Math.max(w * 3.6, 22 * unit))
  const headHalf = headLength * 0.62
  const ux = dx / length
  const uy = dy / length
  // The shaft stops inside the head, so its square end never pokes past the tip.
  const neck = { x: head.x - ux * headLength * 0.8, y: head.y - uy * headLength * 0.8 }
  const base = { x: head.x - ux * headLength, y: head.y - uy * headLength }
  const left = { x: base.x - uy * headHalf, y: base.y + ux * headHalf }
  const right = { x: base.x + uy * headHalf, y: base.y - ux * headHalf }

  const shape = (): void => {
    ctx.beginPath()
    ctx.moveTo(tail.x, tail.y)
    ctx.lineTo(neck.x, neck.y)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(head.x, head.y)
    ctx.lineTo(left.x, left.y)
    ctx.lineTo(right.x, right.y)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
  }

  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  // Keyline first, then the colour on top of it.
  ctx.strokeStyle = 'rgba(0,0,0,0.45)'
  ctx.fillStyle = 'rgba(0,0,0,0.45)'
  ctx.lineWidth = w + 4 * unit
  shape()
  ctx.strokeStyle = a.color
  ctx.fillStyle = a.color
  ctx.lineWidth = w
  shape()
}
