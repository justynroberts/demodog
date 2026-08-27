// MIT License - Copyright (c) fintonlabs.com
import type { CaptureMeta, RawEvent } from '../../../shared/types'
import type { ParsedInput } from './types'

/**
 * Turns the helper's raw event log into typed tracks on the recording
 * timeline. Every `h` value is a monotonic host-clock reading; subtracting
 * `firstFrameHost` puts it on the same zero as the video.
 */
export function parseInput(raw: RawEvent[], meta: CaptureMeta): ParsedInput {
  const zero = meta.firstFrameHost
  const input: ParsedInput = {
    moves: [],
    clicks: [],
    presses: [],
    scrolls: [],
    keys: [],
    apps: [],
    shapes: []
  }

  for (const event of raw) {
    const t = event.h - zero
    switch (event.k) {
      case 'm':
        input.moves.push({ t, x: event.x, y: event.y })
        break
      case 'down':
      case 'up':
        input.presses.push({ t, down: event.k === 'down', button: event.b })
        break
      case 'click':
        input.clicks.push({ t, x: event.x, y: event.y, button: event.b, count: event.count })
        break
      case 'scroll':
        input.scrolls.push({ t, x: event.x, y: event.y, dx: event.dx, dy: event.dy })
        break
      case 'key':
        input.keys.push({ t, chars: event.chars, mods: event.mods })
        break
      case 'cursor':
        input.shapes.push({ t, name: event.name })
        break
      case 'app':
        input.apps.push({
          t,
          app: event.app,
          rect:
            event.x !== undefined && event.y !== undefined && event.w && event.h_px
              ? { x: event.x, y: event.y, w: event.w, h: event.h_px }
              : undefined
        })
        break
    }
  }

  const byTime = <T extends { t: number }>(a: T, b: T): number => a.t - b.t
  input.moves.sort(byTime)
  input.clicks.sort(byTime)
  input.presses.sort(byTime)
  input.scrolls.sort(byTime)
  input.keys.sort(byTime)
  input.apps.sort(byTime)
  input.shapes.sort(byTime)

  // The physical button poll is the reliable click source; the global monitor
  // adds click counts but can miss events when another app grabs the input.
  // Fill in any press-downs that never produced a monitor click.
  for (const press of input.presses) {
    if (!press.down) continue
    const near = input.clicks.find(
      (c) => Math.abs(c.t - press.t) < 0.08 && c.button === press.button
    )
    if (!near) {
      const pos = positionAt(input.moves, press.t)
      if (pos) input.clicks.push({ t: press.t, x: pos.x, y: pos.y, button: press.button, count: 1 })
    }
  }
  input.clicks.sort(byTime)

  return input
}

/** Linear interpolation into the raw move track. */
export function positionAt(
  moves: { t: number; x: number; y: number }[],
  t: number
): { x: number; y: number } | null {
  if (moves.length === 0) return null
  if (t <= moves[0].t) return { x: moves[0].x, y: moves[0].y }
  const last = moves[moves.length - 1]
  if (t >= last.t) return { x: last.x, y: last.y }

  let lo = 0
  let hi = moves.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (moves[mid].t <= t) lo = mid
    else hi = mid
  }
  const a = moves[lo]
  const b = moves[hi]
  const span = b.t - a.t
  const f = span > 0 ? (t - a.t) / span : 0
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }
}
