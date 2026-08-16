// MIT License - Copyright (c) fintonlabs.com

/**
 * Short volume ramps around starting and stopping a media element.
 *
 * Cutting audio in or out at full level produces an audible click, which is
 * very noticeable when scrubbing or pausing repeatedly. A few frames of ramp
 * is enough to remove it entirely.
 */
const RAMP_MS = 90

/**
 * Elements currently being ramped.
 *
 * Anything else that writes `volume` — the fade-following loop, for instance —
 * has to leave these alone, or it overwrites the ramp mid-flight and the click
 * comes straight back.
 */
const ramping = new WeakSet<HTMLMediaElement>()

export function isRamping(el: HTMLMediaElement): boolean {
  return ramping.has(el)
}

function ramp(el: HTMLMediaElement, from: number, to: number, done?: () => void): void {
  const start = performance.now()
  ramping.add(el)
  const step = (): void => {
    const f = Math.min(1, (performance.now() - start) / RAMP_MS)
    el.volume = Math.min(1, Math.max(0, from + (to - from) * f))
    if (f < 1) {
      requestAnimationFrame(step)
    } else {
      ramping.delete(el)
      done?.()
    }
  }
  step()
}

/** Brings an element up to `to` from silence. */
export function rampVolume(el: HTMLMediaElement, to: number): void {
  ramp(el, 0, to)
}

/** Fades out, then pauses — so a pause never clicks. */
export function fadeOutAndPause(el: HTMLMediaElement): void {
  const from = el.volume
  ramp(el, from, 0, () => {
    el.pause()
    el.volume = from
  })
}
