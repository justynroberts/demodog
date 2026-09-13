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

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

interface ShapeDef {
  /** Draws the outline; the caller handles fill and stroke. */
  path: (ctx: Ctx) => void
  /**
   * Interior linework drawn in the keyline colour over the fill — the gaps
   * between fingers. A hand is only readable as a hand at 20px because of
   * these; as a bare silhouette it is a mitten, or a blob.
   */
  detail?: (ctx: Ctx) => void
  /** Hotspot offset from the drawing origin, in authoring units. */
  hotspot: { x: number; y: number }
}

function poly(ctx: Ctx, points: [number, number][]): void {
  ctx.beginPath()
  ctx.moveTo(points[0][0], points[0][1])
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1])
  ctx.closePath()
}

const SHAPES: Record<CursorShape, ShapeDef> = {
  arrow: {
    hotspot: { x: 0, y: 0 },
    path: (ctx) =>
      poly(ctx, [
        [0, 0],
        [0, 22.6],
        [5.4, 17.5],
        [8.8, 25.2],
        [12.6, 23.6],
        [9.2, 16.1],
        [16.2, 16.1]
      ])
  },

  pointingHand: {
    // Hotspot on the fingertip, where the click actually lands.
    hotspot: { x: 8.0, y: 1.0 },
    path: (ctx) => {
      // Index finger raised; middle, ring and little finger curled beneath
      // it at stepped heights; thumb tucked against the palm on the left.
      ctx.beginPath()
      ctx.moveTo(6.0, 14.8)
      ctx.lineTo(6.0, 2.8)
      ctx.quadraticCurveTo(6.0, 0.8, 8.0, 0.8)
      ctx.quadraticCurveTo(10.0, 0.8, 10.0, 2.8)
      ctx.lineTo(10.0, 10.9)
      ctx.quadraticCurveTo(10.0, 9.0, 11.9, 9.0)
      ctx.quadraticCurveTo(13.8, 9.0, 13.8, 10.9)
      ctx.lineTo(13.8, 12.0)
      ctx.quadraticCurveTo(13.8, 10.2, 15.6, 10.2)
      ctx.quadraticCurveTo(17.4, 10.2, 17.4, 12.0)
      ctx.lineTo(17.4, 13.6)
      ctx.quadraticCurveTo(17.4, 11.9, 19.0, 11.9)
      ctx.quadraticCurveTo(20.6, 11.9, 20.6, 13.6)
      ctx.lineTo(20.6, 21.5)
      ctx.bezierCurveTo(20.6, 26.8, 17.4, 29.6, 13.0, 29.6)
      ctx.lineTo(11.4, 29.6)
      ctx.bezierCurveTo(8.2, 29.6, 6.6, 28.2, 5.3, 25.8)
      ctx.lineTo(1.6, 19.0)
      ctx.quadraticCurveTo(0.6, 17.0, 2.2, 16.0)
      ctx.quadraticCurveTo(3.9, 15.1, 5.2, 16.6)
      ctx.lineTo(6.0, 17.6)
      ctx.closePath()
    },
    detail: (ctx) => {
      ctx.moveTo(10.0, 11.4)
      ctx.lineTo(10.0, 15.6)
      ctx.moveTo(13.8, 12.4)
      ctx.lineTo(13.8, 15.8)
      ctx.moveTo(17.4, 14.0)
      ctx.lineTo(17.4, 16.0)
    }
  },

  iBeam: {
    hotspot: { x: 4, y: 11 },
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
    path: (ctx) => {
      ctx.beginPath()
      ctx.rect(10.1, 0, 1.8, 8.2)
      ctx.rect(10.1, 13.8, 1.8, 8.2)
      ctx.rect(0, 10.1, 8.2, 1.8)
      ctx.rect(13.8, 10.1, 8.2, 1.8)
    }
  },

  openHand: {
    hotspot: { x: 13, y: 15 },
    path: (ctx) => {
      // Four fingers up at natural stepped heights, thumb angled out left.
      ctx.beginPath()
      ctx.moveTo(7.2, 13.4)
      ctx.lineTo(7.2, 5.0)
      ctx.quadraticCurveTo(7.2, 3.2, 8.9, 3.2)
      ctx.quadraticCurveTo(10.6, 3.2, 10.6, 5.0)
      ctx.lineTo(10.6, 2.8)
      ctx.quadraticCurveTo(10.6, 1.0, 12.4, 1.0)
      ctx.quadraticCurveTo(14.2, 1.0, 14.2, 2.8)
      ctx.lineTo(14.2, 4.0)
      ctx.quadraticCurveTo(14.2, 2.2, 15.9, 2.2)
      ctx.quadraticCurveTo(17.6, 2.2, 17.6, 4.0)
      ctx.lineTo(17.6, 7.0)
      ctx.quadraticCurveTo(17.6, 5.2, 19.2, 5.2)
      ctx.quadraticCurveTo(20.8, 5.2, 20.8, 7.0)
      ctx.lineTo(20.8, 19.6)
      ctx.bezierCurveTo(20.8, 25.4, 17.6, 28.6, 13.2, 28.6)
      ctx.lineTo(11.8, 28.6)
      ctx.bezierCurveTo(8.6, 28.6, 6.9, 27.0, 5.6, 24.6)
      ctx.lineTo(1.4, 16.4)
      ctx.quadraticCurveTo(0.6, 14.6, 2.2, 13.8)
      ctx.quadraticCurveTo(3.8, 13.1, 5.0, 14.6)
      ctx.lineTo(7.2, 17.2)
      ctx.closePath()
    },
    detail: (ctx) => {
      ctx.moveTo(10.6, 5.6)
      ctx.lineTo(10.6, 12.6)
      ctx.moveTo(14.2, 4.6)
      ctx.lineTo(14.2, 12.4)
      ctx.moveTo(17.6, 7.6)
      ctx.lineTo(17.6, 12.6)
    }
  },

  closedHand: {
    hotspot: { x: 13, y: 16 },
    path: (ctx) => {
      // A fist seen from above: a row of four knuckles, thumb folded in.
      ctx.beginPath()
      ctx.moveTo(5.6, 11.0)
      ctx.quadraticCurveTo(5.6, 8.4, 7.5, 8.4)
      ctx.quadraticCurveTo(9.4, 8.4, 9.4, 10.2)
      ctx.quadraticCurveTo(9.4, 7.4, 11.3, 7.4)
      ctx.quadraticCurveTo(13.2, 7.4, 13.2, 9.6)
      ctx.quadraticCurveTo(13.2, 7.2, 15.1, 7.2)
      ctx.quadraticCurveTo(17.0, 7.2, 17.0, 9.6)
      ctx.quadraticCurveTo(17.0, 8.0, 18.9, 8.0)
      ctx.quadraticCurveTo(20.8, 8.0, 20.8, 10.6)
      ctx.lineTo(20.8, 19.8)
      ctx.bezierCurveTo(20.8, 24.8, 17.8, 27.6, 13.4, 27.6)
      ctx.lineTo(12.0, 27.6)
      ctx.bezierCurveTo(8.6, 27.6, 6.9, 26.2, 5.6, 23.8)
      ctx.lineTo(3.0, 18.8)
      ctx.quadraticCurveTo(2.2, 16.9, 3.8, 16.1)
      ctx.quadraticCurveTo(5.1, 15.5, 5.6, 16.6)
      ctx.closePath()
    },
    detail: (ctx) => {
      ctx.moveTo(9.4, 10.6)
      ctx.lineTo(9.4, 13.4)
      ctx.moveTo(13.2, 10.0)
      ctx.lineTo(13.2, 13.0)
      ctx.moveTo(17.0, 10.0)
      ctx.lineTo(17.0, 13.0)
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

  if (def.detail) {
    ctx.beginPath()
    def.detail(ctx)
    ctx.strokeStyle = stroke
    ctx.lineWidth = 1.2
    ctx.stroke()
  }

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
