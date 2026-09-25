// MIT License - Copyright (c) fintonlabs.com
/**
 * Undo and redo: every edit, and nothing lost on the way back.
 *
 * The editor keeps snapshots of everything editable rather than a list of
 * operations, so what is checked here is that stepping through them is exact —
 * an undo that returns *nearly* the previous state is worse than none.
 */
import {
  HISTORY_LIMIT,
  commit,
  canRedo,
  canUndo,
  emptyHistory,
  redo,
  sameState,
  undo,
  type EditState
} from '../src/renderer/src/engine/history'

let failures = 0
function check(ok: boolean, label: string, detail = ''): void {
  console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${label}${detail ? `  \x1b[2m${detail}\x1b[0m` : ''}`)
  if (!ok) failures++
}

interface Look {
  zoom: { maxScale: number }
  captions: { id: string; text: string }[]
  annotations: { id: string }[]
}
type State = EditState<Look, { id: string; auto: boolean }>
const at = (scale: number, extra: Partial<State> = {}): State => ({
  project: { zoom: { maxScale: scale }, captions: [], annotations: [] },
  segments: [{ id: 'a', auto: true }],
  trim: { start: 0, end: 10 },
  cameraSync: 0,
  ...extra
})

console.log('\nUndo and redo')

// ---- one step at a time -----------------------------------------------------
{
  let h = emptyHistory<Look, State['segments'][number]>(at(1))
  check(!canUndo(h) && !canRedo(h), 'a freshly opened take has nothing to undo')
  h = commit(h, at(2))
  h = commit(h, at(3))
  check(canUndo(h) && !canRedo(h), 'after two changes there are steps back and none forward')
  const back = undo(h, at(3))!
  check(back.state.project.zoom.maxScale === 2, 'undo returns the state before the last change')
  const back2 = undo(back.history, back.state)!
  check(back2.state.project.zoom.maxScale === 1, 'and again, the one before that')
  check(undo(back2.history, back2.state) === null, 'at the beginning there is nothing further back')
  const forward = redo(back2.history)!
  check(forward.state.project.zoom.maxScale === 2, 'redo puts the undone change back')
  const forward2 = redo(forward.history)!
  check(forward2.state.project.zoom.maxScale === 3, 'all the way to where it started')
  check(redo(forward2.history) === null, 'and stops there')
}

// ---- everything editable, not just settings ---------------------------------
{
  const edited = at(1, {
    project: {
      zoom: { maxScale: 1 },
      captions: [{ id: 'c1', text: 'Hallo daar' }],
      annotations: [{ id: 'n1' }]
    },
    segments: [{ id: 'a', auto: true }, { id: 'b', auto: false }],
    trim: { start: 1.5, end: 8 },
    cameraSync: -0.4
  })
  let h = emptyHistory<Look, State['segments'][number]>(at(1))
  h = commit(h, edited)
  const back = undo(h, edited)!
  check(back.state.project.captions.length === 0, 'a caption is undone')
  check(back.state.project.annotations.length === 0, 'so is a mark')
  check(back.state.segments.length === 1, 'so is a zoom shot')
  check(back.state.trim.start === 0 && back.state.trim.end === 10, 'so is a trim')
  check(back.state.cameraSync === 0, 'so is the camera sync')
  const again = redo(back.history)!
  check(sameState(again.state, edited), 'and redo gives back every one of them exactly')
}

// ---- a change still under the mouse -----------------------------------------
{
  let h = emptyHistory<Look, State['segments'][number]>(at(1))
  h = commit(h, at(2))
  // The slider has moved but has not settled into a step yet.
  const step = undo(h, at(2.7))!
  check(step.state.project.zoom.maxScale === 2, 'undoing mid-drag goes back to before the drag, not before the change under it')
  check(redo(step.history)!.state.project.zoom.maxScale === 2.7, 'and redo returns to where the drag had got to')
}

// ---- a new edit after undoing -----------------------------------------------
{
  let h = emptyHistory<Look, State['segments'][number]>(at(1))
  h = commit(h, at(2))
  const back = undo(h, at(2))!
  h = commit(back.history, at(5))
  check(!canRedo(h), 'editing after an undo drops the branch that was undone')
  check(undo(h, at(5))!.state.project.zoom.maxScale === 1, 'and the step back is still the right one')
}

// ---- noise is not a step ----------------------------------------------------
{
  let h = emptyHistory<Look, State['segments'][number]>(at(1))
  const same = commit(h, at(1))
  check(same === h && !canUndo(same), 'a change that changes nothing is not remembered')
}

// ---- a long session ---------------------------------------------------------
{
  let h = emptyHistory<Look, State['segments'][number]>(at(0))
  for (let i = 1; i <= HISTORY_LIMIT + 50; i++) h = commit(h, at(i))
  check(h.past.length === HISTORY_LIMIT, 'history stops growing after a long session', `${h.past.length} steps`)
  let state = h.present
  let current = h
  for (let i = 0; i < HISTORY_LIMIT; i++) {
    const step = undo(current, state)!
    current = step.history
    state = step.state
  }
  check(state.project.zoom.maxScale === HISTORY_LIMIT + 50 - HISTORY_LIMIT, 'the oldest steps are the ones dropped, and the rest still walk back cleanly')
}

console.log(failures ? `\n\x1b[31m${failures} history check(s) failed.\x1b[0m\n` : '\n\x1b[32mHistory checks passed.\x1b[0m\n')
process.exit(failures ? 1 : 0)
