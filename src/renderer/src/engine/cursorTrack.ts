// MIT License - Copyright (c) fintonlabs.com
import { positionAt } from './input'
import type { CursorSettings, ParsedInput } from './types'

const RATE = 240

/**
 * Turns a jittery recorded pointer path into the smooth glide that makes a
 * recording look deliberate.
 *
 * The filter is a **1€ filter** — a low-pass whose cutoff rises with speed, so
 * slow movement is stabilised hard (killing hand tremor) while fast flicks stay
 * responsive instead of turning to syrup.
 *
 * It is then run a second time *backwards* over its own output. A causal filter
 * always lags, and a pointer that trails behind its clicks looks broken; the
 * reverse pass cancels that phase shift exactly, which is only possible because
 * this is post-processing and the whole path is already known.
 */
class OneEuro {
  private xHat = 0
  private dxHat = 0
  private started = false

  constructor(
    private minCutoff: number,
    private beta: number,
    private dCutoff = 1
  ) {}

  private static alpha(cutoff: number, dt: number): number {
    const tau = 1 / (2 * Math.PI * cutoff)
    return 1 / (1 + tau / dt)
  }

  filter(x: number, dt: number): number {
    if (!this.started) {
      this.started = true
      this.xHat = x
      this.dxHat = 0
      return x
    }
    const dx = (x - this.xHat) / dt
    this.dxHat += OneEuro.alpha(this.dCutoff, dt) * (dx - this.dxHat)
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dxHat)
    this.xHat += OneEuro.alpha(cutoff, dt) * (x - this.xHat)
    return this.xHat
  }
}

export interface CursorState {
  x: number
  y: number
  /** Source pixels per second. */
  speed: number
  /** 0..1, drives the idle fade. */
  opacity: number
  pressed: boolean
  shape: string
}

export class CursorTrack {
  private xs: Float64Array
  private ys: Float64Array
  private speeds: Float64Array
  private opacity: Float64Array
  private count: number
  private duration: number
  private input: ParsedInput

  constructor(input: ParsedInput, duration: number, settings: CursorSettings) {
    this.input = input
    this.duration = Math.max(duration, 0.001)
    this.count = Math.max(2, Math.ceil(this.duration * RATE) + 1)

    const raw = new Float64Array(this.count * 2)
    const moves = input.moves

    // Uniform resampling first: an evenly spaced signal is what the filter
    // assumes, and the raw poll only emits on change.
    for (let i = 0; i < this.count; i++) {
      const t = i / RATE
      const p = positionAt(moves, t)
      raw[i * 2] = p?.x ?? 0
      raw[i * 2 + 1] = p?.y ?? 0
    }

    // smoothing 0 leaves the path essentially untouched; 1 is a long glide.
    const s = clamp01(settings.smoothing)
    const minCutoff = 120 * Math.pow(0.005, s)
    const beta = 0.02 * (1 - 0.7 * s)

    const xs = new Float64Array(this.count)
    const ys = new Float64Array(this.count)
    const dt = 1 / RATE

    const fx = new OneEuro(minCutoff, beta)
    const fy = new OneEuro(minCutoff, beta)
    for (let i = 0; i < this.count; i++) {
      xs[i] = fx.filter(raw[i * 2], dt)
      ys[i] = fy.filter(raw[i * 2 + 1], dt)
    }

    // Reverse pass — cancels the lag the forward pass introduced.
    const bx = new OneEuro(minCutoff, beta)
    const by = new OneEuro(minCutoff, beta)
    for (let i = this.count - 1; i >= 0; i--) {
      xs[i] = bx.filter(xs[i], dt)
      ys[i] = by.filter(ys[i], dt)
    }

    this.xs = xs
    this.ys = ys

    if (settings.clickAnchoring) this.anchorClicks(raw)
    if (settings.returnToStart) this.returnToStart()

    this.speeds = new Float64Array(this.count)
    for (let i = 1; i < this.count; i++) {
      const dx = xs[i] - xs[i - 1]
      const dy = ys[i] - ys[i - 1]
      this.speeds[i] = Math.hypot(dx, dy) * RATE
    }
    if (this.count > 1) this.speeds[0] = this.speeds[1]

    this.opacity = this.buildOpacity(raw, settings)
  }

  /**
   * Smoothing can drift the pointer a few pixels off the thing it actually
   * clicked, which reads as a miss. Pull the path back onto the true position
   * in a short window around every click.
   */
  private anchorClicks(raw: Float64Array): void {
    const window = 0.14
    for (const click of this.input.clicks) {
      const centre = Math.round(click.t * RATE)
      const span = Math.round(window * RATE)
      for (let i = centre - span; i <= centre + span; i++) {
        if (i < 0 || i >= this.count) continue
        const distance = Math.abs(i - centre) / span
        // Cosine window: full correction at the click, none at the edges.
        const w = 0.5 * (1 + Math.cos(Math.PI * distance))
        this.xs[i] += (raw[i * 2] - this.xs[i]) * w
        this.ys[i] += (raw[i * 2 + 1] - this.ys[i]) * w
      }
    }
  }

  /** Eases the pointer back to where it started, so loops cut cleanly. */
  private returnToStart(): void {
    const tail = Math.min(Math.round(0.9 * RATE), Math.floor(this.count / 3))
    if (tail < 4) return
    const startX = this.xs[0]
    const startY = this.ys[0]
    const from = this.count - tail
    for (let i = from; i < this.count; i++) {
      const f = (i - from) / (tail - 1)
      const e = f * f * (3 - 2 * f)
      this.xs[i] += (startX - this.xs[i]) * e
      this.ys[i] += (startY - this.ys[i]) * e
    }
  }

  /**
   * Fades the pointer out once it has been parked for a while — the same trick
   * that stops a static arrow sitting in the middle of an otherwise clean shot.
   */
  private buildOpacity(raw: Float64Array, settings: CursorSettings): Float64Array {
    const out = new Float64Array(this.count).fill(1)
    if (settings.idleHide <= 0) return out

    const fade = 0.4
    const idleFrames = Math.round(settings.idleHide * RATE)
    const fadeFrames = Math.max(1, Math.round(fade * RATE))

    // Clicks count as activity, exactly like movement does. Treating them as a
    // separate "stay awake" window instead would re-arm the timer for a full
    // idleHide *after* the fade should already have started.
    const clickFrames = new Set<number>()
    for (const click of this.input.clicks) {
      clickFrames.add(Math.round(click.t * RATE))
    }

    let still = 0
    for (let i = 1; i < this.count; i++) {
      const moved = Math.hypot(raw[i * 2] - raw[(i - 1) * 2], raw[i * 2 + 1] - raw[(i - 1) * 2 + 1])
      const active = moved >= 0.4 || clickFrames.has(i)
      still = active ? 0 : still + 1
      if (still > idleFrames) {
        out[i] = Math.max(0, 1 - (still - idleFrames) / fadeFrames)
      }
    }
    return out
  }

  at(t: number): CursorState {
    const f = Math.min(Math.max(t, 0), this.duration) * RATE
    const i = Math.min(this.count - 1, Math.max(0, Math.floor(f)))
    const j = Math.min(this.count - 1, i + 1)
    const frac = f - i

    return {
      x: this.xs[i] + (this.xs[j] - this.xs[i]) * frac,
      y: this.ys[i] + (this.ys[j] - this.ys[i]) * frac,
      speed: this.speeds[i],
      opacity: this.opacity[i] + (this.opacity[j] - this.opacity[i]) * frac,
      pressed: this.isPressed(t),
      shape: this.shapeAt(t)
    }
  }

  private isPressed(t: number): boolean {
    let pressed = false
    for (const press of this.input.presses) {
      if (press.t > t) break
      if (press.button === 0) pressed = press.down
    }
    return pressed
  }

  private shapeAt(t: number): string {
    let shape = 'arrow'
    for (const event of this.input.shapes) {
      if (event.t > t) break
      shape = event.name
    }
    return shape
  }
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v))
}
