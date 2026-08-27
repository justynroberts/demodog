// MIT License - Copyright (c) fintonlabs.com
import { useEffect, type ReactNode } from 'react'

/**
 * A short walk through the three things worth setting before a first take.
 *
 * It drives the panel it is describing rather than pointing at it: each step
 * selects its own tab, so the thing being talked about is on screen while it is
 * being talked about. Anchored coach marks were the alternative and they break
 * the moment anything moves.
 */

export interface TourStep {
  /** Which options tab this step is about. */
  tab: 'camera' | 'audio' | 'capture'
  title: string
  body: string
}

export const TOUR_STEPS: TourStep[] = [
  {
    tab: 'camera',
    title: 'Your camera, in the corner',
    body:
      'Pick a camera to record yourself alongside the screen. It becomes a ' +
      'picture-in-picture you can move, resize or reshape afterwards — nothing ' +
      'is fixed at record time. For a blurred background, macOS applies that ' +
      'itself from Control Centre.'
  },
  {
    tab: 'audio',
    title: 'What gets heard',
    body:
      'Choose a microphone for narration, and turn on system audio to capture ' +
      'what the machine is playing. Both are recorded separately from the ' +
      'picture, so either can be dropped later.'
  },
  {
    tab: 'capture',
    title: 'How it records',
    body:
      'Frame rate, a countdown before recording starts, and an on-screen ' +
      'readout of the keys you press. The countdown overlays the screen rather ' +
      'than covering it, so you can line things up while it runs.'
  }
]

const SEEN_KEY = 'demodog-toured'

/** Whether the tour has already been shown on this machine. */
export function tourSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1'
  } catch {
    return true
  }
}

export function markTourSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, '1')
  } catch {
    // A tour that cannot remember it ran is still better than no tour.
  }
}

export default function Tour({
  step,
  onStep,
  onClose
}: {
  step: number
  onStep: (next: number) => void
  onClose: () => void
}): ReactNode {
  const current = TOUR_STEPS[step]
  const last = step === TOUR_STEPS.length - 1

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
      if (event.key === 'ArrowRight' || event.key === 'Enter') {
        if (last) onClose()
        else onStep(step + 1)
      }
      if (event.key === 'ArrowLeft' && step > 0) onStep(step - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [step, last, onStep, onClose])

  if (!current) return null

  return (
    <div className="tour-layer">
      <div className="tour-card snap" role="dialog" aria-label="Getting started">
        <span className="tour-count mono">
          {step + 1} / {TOUR_STEPS.length}
        </span>
        <h3>{current.title}</h3>
        <p>{current.body}</p>

        <div className="tour-dots" aria-hidden="true">
          {TOUR_STEPS.map((s, i) => (
            <span key={s.tab} className={i === step ? 'on' : ''} />
          ))}
        </div>

        <div className="tour-actions">
          <button className="btn ghost small" onClick={onClose}>
            Skip
          </button>
          <div style={{ flex: 1 }} />
          {step > 0 && (
            <button className="btn small" onClick={() => onStep(step - 1)}>
              Back
            </button>
          )}
          <button
            className="btn primary small"
            onClick={() => (last ? onClose() : onStep(step + 1))}
          >
            {last ? 'Start recording' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  )
}
