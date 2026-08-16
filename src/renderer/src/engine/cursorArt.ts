// MIT License - Copyright (c) fintonlabs.com

/**
 * Vector replacements for the system cursors.
 *
 * The recording deliberately contains no pointer, so it is drawn here instead.
 * Being vector rather than a captured bitmap is the whole point: the pointer
 * stays crisp when the camera zooms to 3x, and its size is a setting rather
 * than a property of the original screen.
 *
 * Paths are authored in a 32-unit-tall space with the hotspot at the origin,
 * so a shape can be swapped without touching the positioning code.
 */

export type CursorShape =
  | 'arrow'
  | 'pointingHand'
  | 'iBeam'
  | 'resizeLeftRight'
  | 'resizeUpDown'
  | 'crosshair'
  | 'openHand'
  | 'closedHand'

/** Height of each shape in the 32-unit authoring space. */
const UNIT = 32

interface ShapeDef {
  /** Draws the outline; the caller handles fill and stroke. */
  path: (ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D) => void
  /** Hotspot offset from the drawing origin, in authoring units. */
  hotspot: { x: number; y: number }
  /** Filled black with a white keyline (true) or stroked only (false). */
  solid: boolean
}

function poly(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  points: [number, number][]
): void {
  ctx.beginPath()
  ctx.moveTo(points[0][0], points[0][1])
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1])
  ctx.closePath()
}

const SHAPES: Record<CursorShape, ShapeDef> = {
  arrow: {
    hotspot: { x: 0, y: 0 },
    solid: true,
    path: (ctx) =>
      poly(ctx, [
        [0, 0],
        [0, 23.2],
        [5.6, 17.8],
        [9.0, 25.7],
        [12.7, 24.1],
        [9.2, 16.4],
        [15.7, 16.4]
      ])
  },

  pointingHand: {
    hotspot: { x: 5.5, y: 0 },
    solid: true,
    path: (ctx) => {
      // Index finger raised over a closed fist.
      ctx.beginPath()
      ctx.moveTo(4.2, 14.0)
      ctx.lineTo(4.2, 3.4)
      ctx.quadraticCurveTo(4.2, 0.6, 6.8, 0.6)
      ctx.quadraticCurveTo(9.3, 0.6, 9.3, 3.4)
      ctx.lineTo(9.3, 12.2)
      ctx.lineTo(9.3, 10.4)
      ctx.quadraticCurveTo(9.3, 8.6, 11.3, 8.6)
      ctx.quadraticCurveTo(13.2, 8.6, 13.2, 10.4)
      ctx.lineTo(13.2, 12.0)
      ctx.quadraticCurveTo(13.2, 10.2, 15.1, 10.2)
      ctx.quadraticCurveTo(17.0, 10.2, 17.0, 12.0)
      ctx.lineTo(17.0, 13.4)
      ctx.quadraticCurveTo(17.0, 11.8, 18.7, 11.8)
      ctx.quadraticCurveTo(20.4, 11.8, 20.4, 13.6)
      ctx.lineTo(20.4, 21.4)
      ctx.quadraticCurveTo(20.4, 28.6, 13.6, 28.6)
      ctx.lineTo(10.6, 28.6)
      ctx.quadraticCurveTo(5.2, 28.6, 3.4, 23.4)
      ctx.lineTo(0.9, 18.2)
      ctx.quadraticCurveTo(0.2, 16.4, 1.9, 15.5)
      ctx.quadraticCurveTo(3.4, 14.8, 4.2, 16.4)
      ctx.closePath()
    }
  },

  iBeam: {
    hotspot: { x: 4, y: 11 },
    solid: true,
    path: (ctx) => {
      ctx.beginPath()
      // Vertical bar with serifs top and bottom.
      ctx.rect(3.1, 1.6, 1.8, 18.8)
      ctx.rect(0.6, 0.4, 6.8, 1.6)
      ctx.rect(0.6, 20.0, 6.8, 1.6)
    }
  },

  resizeLeftRight: {
    hotspot: { x: 11, y: 8 },
    solid: true,
    path: (ctx) =>
      poly(ctx, [
        [0, 8.0],
        [5.4, 3.2],
        [5.4, 6.2],
        [16.6, 6.2],
        [16.6, 3.2],
        [22.0, 8.0],
        [16.6, 12.8],
        [16.6, 9.8],
        [5.4, 9.8],
        [5.4, 12.8]
      ])
  },

  resizeUpDown: {
    hotspot: { x: 8, y: 11 },
    solid: true,
    path: (ctx) =>
      poly(ctx, [
        [8.0, 0],
        [12.8, 5.4],
        [9.8, 5.4],
        [9.8, 16.6],
        [12.8, 16.6],
        [8.0, 22.0],
        [3.2, 16.6],
        [6.2, 16.6],
        [6.2, 5.4],
        [3.2, 5.4]
      ])
  },

  crosshair: {
    hotspot: { x: 11, y: 11 },
    solid: true,
    path: (ctx) => {
      ctx.beginPath()
      ctx.rect(10.1, 0, 1.8, 8.2)
      ctx.rect(10.1, 13.8, 1.8, 8.2)
      ctx.rect(0, 10.1, 8.2, 1.8)
      ctx.rect(13.8, 10.1, 8.2, 1.8)
    }
  },

  openHand: {
    hotspot: { x: 11, y: 11 },
    solid: true,
    path: (ctx) => {
      ctx.beginPath()
      ctx.moveTo(2.6, 14.4)
      ctx.quadraticCurveTo(2.6, 11.4, 5.4, 11.4)
      ctx.lineTo(5.4, 5.2)
      ctx.quadraticCurveTo(5.4, 2.6, 7.8, 2.6)
      ctx.quadraticCurveTo(10.2, 2.6, 10.2, 5.2)
      ctx.lineTo(10.2, 3.2)
      ctx.quadraticCurveTo(10.2, 0.6, 12.6, 0.6)
      ctx.quadraticCurveTo(15.0, 0.6, 15.0, 3.2)
      ctx.lineTo(15.0, 5.4)
      ctx.quadraticCurveTo(15.0, 2.8, 17.3, 2.8)
      ctx.quadraticCurveTo(19.6, 2.8, 19.6, 5.4)
      ctx.lineTo(19.6, 8.0)
      ctx.quadraticCurveTo(19.6, 5.8, 21.7, 5.8)
      ctx.quadraticCurveTo(23.8, 5.8, 23.8, 8.2)
      ctx.lineTo(23.8, 19.0)
      ctx.quadraticCurveTo(23.8, 28.4, 15.2, 28.4)
      ctx.lineTo(12.6, 28.4)
      ctx.quadraticCurveTo(7.4, 28.4, 5.6, 23.6)
      ctx.closePath()
    }
  },

  closedHand: {
    hotspot: { x: 11, y: 11 },
    solid: true,
    path: (ctx) => {
      ctx.beginPath()
      ctx.moveTo(3.4, 13.6)
      ctx.quadraticCurveTo(3.4, 9.4, 7.6, 9.4)
      ctx.lineTo(18.4, 9.4)
      ctx.quadraticCurveTo(22.6, 9.4, 22.6, 13.6)
      ctx.lineTo(22.6, 18.8)
      ctx.quadraticCurveTo(22.6, 27.0, 14.6, 27.0)
      ctx.lineTo(12.2, 27.0)
      ctx.quadraticCurveTo(6.4, 27.0, 4.8, 21.8)
      ctx.closePath()
    }
  }
}

/** Maps the name the helper reports onto a shape we can draw. */
export function resolveShape(name: string): CursorShape {
  if (name in SHAPES) return name as CursorShape
  switch (name) {
    case 'iBeamCursorForVerticalLayout':
      return 'iBeam'
    case 'dragCopy':
    case 'contextualMenu':
    case 'disappearingItem':
    case 'operationNotAllowed':
      return 'arrow'
    default:
      return 'arrow'
  }
}

export interface DrawCursorOptions {
  x: number
  y: number
  /** Rendered height of the pointer in output pixels. */
  height: number
  shape: CursorShape
  opacity: number
  /** Extra scale applied about the hotspot, for the press squash. */
  press: number
  rotation?: number
  /** Body colour. */
  fill?: string
  /** Keyline colour, which is what keeps it legible over busy content. */
  stroke?: string
}

export function drawCursor(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  options: DrawCursorOptions
): void {
  const def = SHAPES[options.shape] ?? SHAPES.arrow
  const scale = (options.height / UNIT) * options.press

  ctx.save()
  ctx.globalAlpha *= options.opacity
  ctx.translate(options.x, options.y)
  if (options.rotation) ctx.rotate(options.rotation)
  ctx.scale(scale, scale)
  ctx.translate(-def.hotspot.x, -def.hotspot.y)

  // A soft contact shadow is what separates the pointer from a busy UI
  // underneath; without it the white keyline alone reads as a sticker.
  ctx.shadowColor = 'rgba(0,0,0,0.42)'
  ctx.shadowBlur = 5.5
  ctx.shadowOffsetY = 1.8

  def.path(ctx)
  const fill = options.fill ?? '#0a0a0a'
  const stroke = options.stroke ?? '#ffffff'
  ctx.fillStyle = stroke
  ctx.strokeStyle = stroke
  ctx.lineWidth = 3.4
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.stroke()

  ctx.shadowColor = 'transparent'
  ctx.shadowBlur = 0
  ctx.shadowOffsetY = 0

  ctx.fillStyle = fill
  ctx.fill()

  ctx.restore()
}

/** Expanding ring drawn at a click, `age` in seconds since the press. */
export function drawClickRing(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  age: number,
  duration: number,
  maxRadius: number,
  color: string
): void {
  const f = age / duration
  if (f < 0 || f > 1) return

  // Fast out, slow settle — matches how a real tap feels.
  const eased = 1 - Math.pow(1 - f, 2.4)
  const radius = maxRadius * eased
  const alpha = Math.pow(1 - f, 1.6)

  ctx.save()
  ctx.globalAlpha *= alpha
  ctx.beginPath()
  ctx.arc(x, y, radius, 0, Math.PI * 2)
  ctx.strokeStyle = color
  ctx.lineWidth = Math.max(1.5, maxRadius * 0.11 * (1 - f))
  ctx.stroke()

  // A brief filled flash sells the moment of contact.
  if (f < 0.35) {
    ctx.globalAlpha *= (0.35 - f) / 0.35
    ctx.beginPath()
    ctx.arc(x, y, maxRadius * 0.42, 0, Math.PI * 2)
    ctx.fillStyle = color
    ctx.fill()
  }
  ctx.restore()
}
