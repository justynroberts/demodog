// MIT License - Copyright (c) fintonlabs.com
import { captionAt, type Caption } from '../engine/captions'
import type { MusicTrack } from '../engine/types'

/**
 * The music bed's level at a moment, as the preview needs it.
 *
 * The exporter schedules this as automation on a Web Audio graph, which the
 * preview has no equivalent of — it plays an `<audio>` element and can only set
 * a volume. So the same shape is computed directly here.
 *
 * Both have to agree. Anything that changes one belongs in the other, and the
 * checks compare them at the same instants for exactly that reason.
 */
export function musicLevelAt(
  t: number,
  music: MusicTrack,
  captions: Caption[],
  range: { start: number; end: number },
  leadIn: number,
  leadOut: number
): number {
  const total = leadIn + (range.end - range.start) + leadOut
  // Position along the piece, where 0 is the first instant of the intro card.
  const at = t - range.start + leadIn
  if (at < 0 || at > total) return 0

  let level = music.gain
  if (music.fadeIn > 0 && at < music.fadeIn) level *= at / music.fadeIn
  if (music.fadeOut > 0 && at > total - music.fadeOut) {
    level *= Math.max(0, (total - at) / music.fadeOut)
  }

  if (music.duckDb > 0) {
    const under = Math.pow(10, -Math.abs(music.duckDb) / 20)
    const attack = Math.max(0.02, music.duckAttack)
    const release = Math.max(0.02, music.duckRelease)
    // Linear through the attack and release, so the preview hears the same
    // ramp shape the exporter writes rather than a step.
    const speaking = captionAt(captions, t)
    if (speaking) level *= under
    else {
      const soon = captions.find((c) => c.start > t && c.start - t < attack)
      const just = captions.find((c) => c.end <= t && t - c.end < release)
      if (soon) level *= 1 - (1 - under) * (1 - (soon.start - t) / attack)
      else if (just) level *= under + (1 - under) * ((t - just.end) / release)
    }
  }

  return Math.max(0, Math.min(1, level))
}

/**
 * Where in the music file a given moment of the piece falls.
 *
 * Returns null when the bed has run out and is not looping, which is the
 * difference between "play silence" and "stop the element".
 */
export function musicTimeAt(
  t: number,
  music: MusicTrack,
  duration: number,
  range: { start: number; end: number },
  leadIn: number
): number | null {
  const at = t - range.start + leadIn
  if (at < 0) return null
  // An offset that does not exist in this track is ignored rather than clamped.
  //
  // Clamping to the end leaves the bed parked on its own last sample, which
  // plays as silence with nothing to say why. Falling back to the beginning is
  // both audible and obviously wrong if it is wrong — and a track can be
  // swapped for a shorter one at any time, which is how this arises.
  const from = music.startAt > 0 && music.startAt < duration - 0.05 ? music.startAt : 0
  const playable = Math.max(0.01, duration - from)
  if (!music.loop) return at < playable ? from + at : null
  return from + (at % playable)
}
