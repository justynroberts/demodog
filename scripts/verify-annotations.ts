// MIT License - Copyright (c) fintonlabs.com
/**
 * Annotations: drawn where they belong, when they belong, and hiding what they hide.
 *
 * Checked against a recording context — every call the drawing makes is
 * captured — rather than pixels, which Node cannot produce. The pixel-level
 * proof, that a blurred region of a real export really is different, lives in
 * verify-export.
 */
import {
  activeAnnotations,
  annotationAlpha,
  annotationDefaults,
  drawMarks,
  drawObscured,
  outputRect,
  sourceToOutput,
  type Annotation,
  type AnnotationKind,
  type AnnotationView
} from '../src/renderer/src/engine/annotations'
import { defaultProject } from '../src/renderer/src/engine/defaults'

let failures = 0
function check(ok: boolean, label: string, detail = ''): void {
  console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${label}${detail ? `  \x1b[2m${detail}\x1b[0m` : ''}`)
  if (!ok) failures++
}
const near = (a: number, b: number, tolerance = 1e-6): boolean => Math.abs(a - b) <= tolerance

interface Call {
  name: string
  args: unknown[]
  state: { filter: string; smoothing: boolean; alpha: number; stroke: unknown; fill: unknown; lineWidth: number }
}

/** A 2D context that remembers what was asked of it. */
function recorder(): { ctx: any; calls: Call[] } {
  const calls: Call[] = []
  const state = { filter: 'none', imageSmoothingEnabled: true, globalAlpha: 1, strokeStyle: '#000', fillStyle: '#000', lineWidth: 1 }
  const stack: (typeof state)[] = []
  const ctx: any = new Proxy(state, {
    get(target: any, prop: string) {
      if (prop in target) return target[prop]
      return (...args: unknown[]) => {
        if (prop === 'save') stack.push({ ...target })
        if (prop === 'restore') Object.assign(target, stack.pop())
        calls.push({
          name: prop,
          args,
          state: {
            filter: target.filter,
            smoothing: target.imageSmoothingEnabled,
            alpha: target.globalAlpha,
            stroke: target.strokeStyle,
            fill: target.fillStyle,
            lineWidth: target.lineWidth
          }
        })
      }
    },
    set(target: any, prop: string, value: unknown) {
      target[prop] = value
      return true
    }
  })
  return { ctx, calls }
}

const fakeCanvas = (w: number, h: number) => {
  const { ctx } = recorder()
  return { width: w, height: h, getContext: () => ctx }
}

let serial = 0
function make(kind: AnnotationKind, overrides: Partial<Annotation> = {}): Annotation {
  return { id: `a${++serial}`, start: 2, end: 5, x: 400, y: 300, w: 200, h: 100, ...annotationDefaults(kind), ...overrides }
}

/** The whole recording on screen, as at the start of a take. */
const wide: AnnotationView = {
  viewport: { x: 0, y: 0, w: 1920, h: 1080 },
  content: { x: 60, y: 40, w: 1800, h: 1012.5 },
  outputHeight: 1080
}
/** Zoomed 2× into the top-left quarter. */
const zoomed: AnnotationView = {
  viewport: { x: 300, y: 200, w: 960, h: 540 },
  content: { x: 60, y: 40, w: 1800, h: 1012.5 },
  outputHeight: 1080
}
const fakeScreen = { width: 1920, height: 1080 } as unknown as CanvasImageSource

console.log('\nAnnotations')

// ---- belongs to the take, not the look ------------------------------------
{
  const project = defaultProject({ width: 1920, height: 1080 })
  check(Array.isArray(project.annotations) && project.annotations.length === 0, 'a new project starts with no annotations')
}

// ---- when ------------------------------------------------------------------
{
  const box = make('box')
  check(activeAnnotations([box], 1.99).length === 0 && activeAnnotations([box], 2).length === 1, 'shown from its start…')
  check(activeAnnotations([box], 4.99).length === 1 && activeAnnotations([box], 5).length === 0, '…until its end, and not after')
  check(annotationAlpha(box, 2) === 0 && near(annotationAlpha(box, 3.5), 1), 'a box fades in rather than snapping on')
  const blur = make('blur')
  check(annotationAlpha(blur, 2) === 1 && annotationAlpha(blur, 4.999) === 1, 'blur is fully on from its first frame to its last — never half-hiding')
}

// ---- where, and it rides the zoom ------------------------------------------
{
  const box = make('box')
  const at = outputRect(wide, box)
  const scale = 1800 / 1920
  check(near(at.x, 60 + 400 * scale) && near(at.w, 200 * scale), 'a box lands on the frame where it was drawn on the recording')
  const inZoom = outputRect(zoomed, box)
  check(near(inZoom.x, 60 + (400 - 300) * (1800 / 960)) && near(inZoom.w, 200 * (1800 / 960)), 'and zoomed in, it grows and moves with the recording underneath it')
  const back = sourceToOutput(zoomed, 400, 300)
  check(near(back.x, inZoom.x) && near(back.y, inZoom.y), 'its corner stays pinned to the same point of the recording')
  const flipped = outputRect(wide, make('box', { x: 600, y: 400, w: -200, h: -100 }))
  check(near(flipped.x, at.x) && near(flipped.w, at.w), 'a box dragged from bottom-right to top-left is the same box')
}

// ---- drawing the marks ------------------------------------------------------
{
  const { ctx, calls } = recorder()
  drawMarks(ctx, 3.5, [make('box', { color: '#ff3b5c', width: 6 })], wide)
  const strokes = calls.filter((c) => c.name === 'stroke')
  check(strokes.length === 2, 'a box is drawn as an outline over a dark keyline', `${strokes.length} strokes`)
  check(strokes[strokes.length - 1].state.stroke === '#ff3b5c', 'in the colour chosen, on top')
  const rect = calls.find((c) => c.name === 'roundRect')!.args as number[]
  const expected = outputRect(wide, make('box'))
  check(near(rect[0], expected.x) && near(rect[2], expected.w), 'at the mapped position')
}
{
  const { ctx, calls } = recorder()
  drawMarks(ctx, 3.5, [make('arrow', { x: 100, y: 100, w: 500, h: 300 })], wide)
  const tips = calls.filter((c) => c.name === 'moveTo')
  const head = sourceToOutput(wide, 600, 400)
  check(tips.some((c) => near(c.args[0] as number, head.x) && near(c.args[1] as number, head.y)), 'an arrow’s point is exactly where it was aimed')
  check(calls.filter((c) => c.name === 'fill').length >= 1, 'with a filled head')
}
{
  const { ctx, calls } = recorder()
  drawMarks(ctx, 3.5, [make('focus')], wide)
  const fill = calls.find((c) => c.name === 'fill')
  check(Boolean(fill && fill.args[0] === 'evenodd'), 'focus dims everything except the region, cut out with an even-odd fill')
}
{
  const { ctx, calls } = recorder()
  drawMarks(ctx, 3.5, [make('arrow'), make('focus'), make('box')], wide)
  const firstEvenOdd = calls.findIndex((c) => c.name === 'fill' && c.args[0] === 'evenodd')
  const firstStroke = calls.findIndex((c) => c.name === 'stroke')
  check(firstEvenOdd >= 0 && firstEvenOdd < firstStroke, 'focus is drawn before boxes and arrows, so it never dims them')
}
{
  const { ctx, calls } = recorder()
  drawMarks(ctx, 1, [make('box'), make('arrow')], wide)
  check(calls.length === 0, 'outside their time, nothing is drawn at all')
}

// ---- hiding -----------------------------------------------------------------
{
  const { ctx, calls } = recorder()
  drawObscured(ctx, 3, [make('blur', { amount: 12 })], fakeScreen, zoomed, fakeCanvas)
  const draw = calls.find((c) => c.name === 'drawImage')
  check(Boolean(draw && /blur\(\d+(\.\d+)?px\)/.test(draw.state.filter)), 'blur redraws the screen through a blur filter', draw?.state.filter)
  check(calls.some((c) => c.name === 'clip'), 'clipped to the region, so nothing else is blurred')
  const radius = parseFloat((draw?.state.filter ?? '').replace(/[^\d.]/g, ''))
  check(near(radius, 12 * (1800 / 960), 1e-6), 'the blur scales with the zoom, so it hides as well zoomed in as out', `${radius.toFixed(1)}px`)
  const src = draw!.args as number[]
  check(src[1] < 400 && src[3] > 200, 'and samples past the region’s edge, so no sharp band is left inside the border')
  check(ctx.filter === 'none', 'and the filter is off again afterwards, so nothing drawn next is blurred', `filter is ${ctx.filter}`)
}
{
  const { ctx, calls } = recorder()
  drawObscured(ctx, 3, [make('pixelate', { amount: 16 })], fakeScreen, wide, fakeCanvas)
  const draws = calls.filter((c) => c.name === 'drawImage')
  check(draws.length === 1 && draws[0].state.smoothing === false, 'pixelate enlarges a tiny copy with smoothing off, which is what makes the blocks')
  check(ctx.imageSmoothingEnabled === true, 'and smoothing is back on afterwards for everything else')
  // drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh): the source size is the block grid.
  const [, , , cols, rows] = draws[0].args as number[]
  check(cols === Math.ceil(200 / 16) && rows === Math.ceil(100 / 16), 'blocks are measured on the recording, so they stay put as the camera moves', `${cols}×${rows} blocks`)
}
{
  const { ctx, calls } = recorder()
  drawObscured(ctx, 3, [make('blur')], null, wide, fakeCanvas)
  check(calls.length === 0, 'with no screen frame (a title card) nothing is attempted')
  const { ctx: c2, calls: k2 } = recorder()
  drawObscured(c2, 3, [make('box'), make('arrow')], fakeScreen, wide, fakeCanvas)
  check(k2.length === 0, 'boxes and arrows are not treated as hiding anything')
  const { ctx: c3, calls: k3 } = recorder()
  drawMarks(c3, 3, [make('blur'), make('pixelate')], wide)
  check(k3.length === 0, 'and blur is not drawn a second time as a mark')
}

// ---- a scripted mark missing its settings must still hide ------------------
{
  const bare = { id: 'bare', kind: 'blur', start: 2, end: 5, x: 400, y: 300, w: 200, h: 100 } as unknown as Annotation
  const { ctx, calls } = recorder()
  drawObscured(ctx, 3, [bare], fakeScreen, wide, fakeCanvas)
  const draw = calls.find((c) => c.name === 'drawImage')
  check(Boolean(draw && /^blur\(\d+(\.\d+)?px\)$/.test(draw.state.filter)), 'a blur given no strength still blurs, rather than silently drawing the region sharp', draw?.state.filter)
  const odd = { ...bare, kind: 'sparkles' } as unknown as Annotation
  const { ctx: c2, calls: k2 } = recorder()
  drawObscured(c2, 3, [odd], fakeScreen, wide, fakeCanvas)
  drawMarks(c2, 3, [odd], wide)
  check(k2.length === 0, 'a kind it does not know is skipped rather than crashing the render')
}

console.log(failures ? `\n\x1b[31m${failures} annotation check(s) failed.\x1b[0m\n` : '\n\x1b[32mAnnotation checks passed.\x1b[0m\n')
process.exit(failures ? 1 : 0)
