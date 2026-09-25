// MIT License - Copyright (c) fintonlabs.com
/**
 * Undo and redo for everything an edit can change.
 *
 * The editor had none. Every other shortcut existed — space, arrows, delete —
 * and ⌘Z did nothing outside a text field, so deleting the wrong zoom shot or
 * dragging a slider off a setting you liked meant putting it back by hand.
 *
 * What is remembered is the whole editable state rather than a list of
 * operations. Snapshots are cheap next to the video they describe, and an
 * operation log has to be right for every action ever added; a snapshot cannot
 * miss one. Runs of changes that arrive together — a slider being dragged, a
 * shot being resized — settle into a single step, so one ⌘Z undoes the drag
 * rather than one frame of it.
 */

/** Everything an edit can change, and nothing that is merely where you are. */
export interface EditState<P = unknown, S = unknown> {
  project: P
  segments: S[]
  trim: { start: number; end: number }
  cameraSync: number
}

export interface History<P = unknown, S = unknown> {
  /** The state each undo returns to, oldest first. */
  past: EditState<P, S>[]
  /** What redo puts back, most recently undone last. */
  future: EditState<P, S>[]
  /** The last settled state: what the next step will be measured against. */
  present: EditState<P, S>
}

/**
 * How many steps back it is possible to go.
 *
 * Deep enough to cover a working session, bounded so a long one cannot grow
 * without limit. Each snapshot is a few kilobytes of settings and timings —
 * never any video.
 */
export const HISTORY_LIMIT = 200

export function emptyHistory<P, S>(present: EditState<P, S>): History<P, S> {
  return { past: [], future: [], present }
}

/** Two states are the same step if nothing a person could see differs. */
export function sameState<P, S>(a: EditState<P, S>, b: EditState<P, S>): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Records a change, if it is one.
 *
 * Redo is dropped: once a different edit is made, the branch that was undone is
 * no longer somewhere this state can lead.
 */
export function commit<P, S>(history: History<P, S>, next: EditState<P, S>): History<P, S> {
  if (sameState(history.present, next)) return history
  const past = [...history.past, history.present]
  return {
    past: past.length > HISTORY_LIMIT ? past.slice(past.length - HISTORY_LIMIT) : past,
    future: [],
    present: next
  }
}

export function canUndo(history: History): boolean {
  return history.past.length > 0
}

export function canRedo(history: History): boolean {
  return history.future.length > 0
}

/**
 * Steps back one change.
 *
 * `live` is the state as it is right now, which is not always `present`: a
 * change may have arrived since the last one settled, and pressing ⌘Z in the
 * middle of it should undo that change rather than throw it away.
 */
export function undo<P, S>(
  history: History<P, S>,
  live: EditState<P, S>
): { history: History<P, S>; state: EditState<P, S> } | null {
  const pending = !sameState(history.present, live)
  if (pending) {
    // The unsettled change becomes the step being undone.
    return {
      history: { past: history.past, future: [...history.future, live], present: history.present },
      state: history.present
    }
  }
  if (history.past.length === 0) return null
  const state = history.past[history.past.length - 1]
  return {
    history: {
      past: history.past.slice(0, -1),
      future: [...history.future, history.present],
      present: state
    },
    state
  }
}

export function redo<P, S>(
  history: History<P, S>
): { history: History<P, S>; state: EditState<P, S> } | null {
  if (history.future.length === 0) return null
  const state = history.future[history.future.length - 1]
  return {
    history: {
      past: [...history.past, history.present],
      future: history.future.slice(0, -1),
      present: state
    },
    state
  }
}
