// MIT License - Copyright (c) fintonlabs.com
/**
 * Edits kept with a take: what comes back from disk is what was saved, and
 * nothing a damaged or foreign file holds can break the editor.
 */
import { editsFromDisk, zoomKeyOf, type TakeEdits } from '../src/renderer/src/engine/edits'
import { annotationDefaults } from '../src/renderer/src/engine/annotations'
import { defaultProject } from '../src/renderer/src/engine/defaults'

let failures = 0
function check(ok: boolean, label: string, detail = ''): void {
  console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${label}${detail ? `  \x1b[2m${detail}\x1b[0m` : ''}`)
  if (!ok) failures++
}

const project = defaultProject({ width: 1920, height: 1080 })
const saved: TakeEdits = {
  version: 1,
  captions: [
    { id: 'c1', start: 1, end: 2.5, text: 'Open settings.', confidence: 0.9, words: [{ start: 1, end: 1.4, text: 'Open' }, { start: 1.5, end: 2.5, text: 'settings.' }] },
    { id: 'c2', start: 3, end: 4, text: 'Done.' }
  ],
  annotations: [{ id: 'a1', kind: 'blur', start: 2, end: 5, x: 10, y: 20, w: 300, h: 100, ...annotationDefaults('blur') }],
  segments: [{ id: 's1', start: 1, end: 4, scale: 2, x: 0.4, y: 0.5, auto: false } as never],
  zoomKey: zoomKeyOf(project.zoom),
  trim: { start: 0.5, end: 9 },
  cameraSync: 0.2
}

console.log('\nEdits')

{
  const back = editsFromDisk(JSON.parse(JSON.stringify(saved)), 10)
  check(JSON.stringify(back) === JSON.stringify(saved), 'what is saved is exactly what comes back')
  check(zoomKeyOf(JSON.parse(JSON.stringify(project.zoom))) === saved.zoomKey, 'unchanged zoom settings are recognised after a round trip, so shots are not regenerated')
}

{
  check(editsFromDisk(null, 10) === null && editsFromDisk('junk', 10) === null && editsFromDisk([], 10) === null, 'a file that is not edits is ignored')
  check(editsFromDisk({ ...saved, version: 2 }, 10) === null, 'a version it does not know is ignored rather than misread')
}

{
  const damaged = {
    ...saved,
    captions: [saved.captions[0], { id: 'x', start: 'soon', end: 2, text: 'bad' }, null, { id: 'y', start: 1, end: 2 }],
    annotations: [saved.annotations[0], { ...saved.annotations[0], id: 'odd', kind: 'sparkles' }, { id: 'z', kind: 'box', start: 1 }],
    segments: [{ id: 's', start: 1, end: 2 }, 7]
  }
  const back = editsFromDisk(damaged, 10)!
  check(back.captions.length === 1 && back.captions[0].id === 'c1', 'a damaged caption is dropped, the good ones kept')
  check(back.annotations.length === 1 && back.annotations[0].id === 'a1', 'so is a mark of unknown kind or missing its place')
  check(back.segments.length === 0, 'and a zoom shot missing its scale or position')
}

{
  const back = editsFromDisk({ ...saved, trim: { start: 0.5, end: 60 }, cameraSync: 99 }, 6)!
  check(back.captions.length === 2 && back.annotations[0].end === 5, 'everything inside a shorter take is kept')
  check(back.trim.end === 6, 'a trim past the end is pulled back to the end of the take', `${back.trim.start}–${back.trim.end}`)
  check(back.cameraSync === 5, 'an absurd camera sync is limited')
  const past = editsFromDisk({ ...saved, captions: [{ id: 'late', start: 20, end: 22, text: 'Gone.' }] }, 6)!
  check(past.captions.length === 0, 'a caption wholly past the end of the take is dropped')
  const bad = editsFromDisk({ ...saved, trim: { start: 5, end: 2 } }, 6)!
  check(bad.trim.start === 0 && bad.trim.end === 6, 'a backwards trim falls back to the whole take')
}

{
  const shuffled = editsFromDisk({ ...saved, captions: [saved.captions[1], saved.captions[0]] }, 10)!
  check(shuffled.captions[0].id === 'c1', 'captions come back in time order')
}

console.log(failures ? `\n\x1b[31m${failures} edit check(s) failed.\x1b[0m\n` : '\n\x1b[32mEdit checks passed.\x1b[0m\n')
process.exit(failures ? 1 : 0)
