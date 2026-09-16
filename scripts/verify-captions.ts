// MIT License - Copyright (c) fintonlabs.com
/**
 * Captions: short, readable lines, split and merged without losing the timing.
 *
 * The complaint was captions that read like paragraphs. These check that a
 * long transcribed line breaks into lines no longer than asked, at sensible
 * places, still in time with the words — and that splitting by hand and
 * merging back are exact inverses, so editing never quietly damages a line.
 */
import {
  captionsFromCues,
  mergeCaptions,
  shortenCaption,
  shortenCaptions,
  splitCaptionAtWord,
  wordIndexAtCursor,
  wordsFor,
  type Caption,
  type CaptionWord
} from '../src/renderer/src/engine/captions'
import { musicLevelAt } from '../src/renderer/src/editor/music'
import { defaultProject } from '../src/renderer/src/engine/defaults'

let failures = 0
function check(ok: boolean, label: string, detail = ''): void {
  console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${label}${detail ? `  \x1b[2m${detail}\x1b[0m` : ''}`)
  if (!ok) failures++
}

let n = 0
const newId = (base: string): string => `${base}~${++n}`

/** Words said at a steady pace with a short pause after each comma or stop. */
function spoken(text: string, start: number, perChar = 0.06): CaptionWord[] {
  const words: CaptionWord[] = []
  let at = start
  for (const word of text.split(' ')) {
    const end = at + word.length * perChar
    words.push({ start: at, end, text: word })
    at = end + (/[,.]$/.test(word) ? 0.25 : 0.08)
  }
  return words
}

const long =
  'So the first thing we are going to do is open the settings panel, and then we will turn on the automatic zoom for this recording.'
const heardWords = spoken(long, 2)
const heard: Caption = {
  id: 'cue-0',
  start: heardWords[0].start,
  end: heardWords[heardWords.length - 1].end,
  text: long,
  confidence: 0.9,
  words: heardWords
}

const joined = (list: Caption[]): string => list.map((c) => c.text).join(' ')
const touching = (list: Caption[]): boolean =>
  list.every((c, i) => i === 0 || Math.abs(c.start - list[i - 1].end) < 1e-9)

console.log('\nCaptions')

// ---- shortening a long transcribed line -----------------------------------
{
  const pieces = shortenCaption(heard, 42, newId)
  check(pieces.length >= 3, 'a long line is broken into several', `${pieces.length} lines`)
  check(pieces.every((p) => p.text.length <= 42), 'no line is longer than asked', pieces.map((p) => p.text.length).join(', '))
  check(joined(pieces) === long, 'every word is kept, in order')
  check(pieces[0].start === heard.start && pieces[pieces.length - 1].end === heard.end, 'together they span exactly the original line')
  check(touching(pieces), 'each line starts exactly where the last one ends')
  check(new Set(pieces.map((p) => p.id)).size === pieces.length, 'every line has its own id')
  check(pieces[0].id === heard.id, 'the first line keeps the original id')
  check(pieces.every((p) => p.text.split(' ').length >= 2), 'no line is a single stranded word')

  // Breaks sit between the words that were actually spoken either side of them.
  const inGaps = pieces.slice(1).every((p) => {
    const before = heardWords.find((w, i) => heardWords[i + 1] && heardWords[i + 1].start >= p.start - 1e-9 && w.end <= p.start + 1e-9)
    const firstWord = p.words?.[0]
    return Boolean(before && firstWord && p.start >= before.end - 1e-9 && p.start <= firstWord.start + 1e-9)
  })
  check(inGaps, 'each break falls in the pause between the words either side of it')
  check(pieces.every((p) => p.words && wordsFor(p).heard), 'the recogniser’s word times travel with each line')

  const leaning = /\b(the|a|an|to|of|and|on|for)$/i
  check(pieces.slice(0, -1).every((p) => !leaning.test(p.text)), 'no line ends on a word that leans on the next', pieces.map((p) => `“${p.text}”`).join(' / '))
  const atComma = pieces.findIndex((p) => p.text.endsWith('panel,'))
  check(atComma >= 0, 'a line breaks after the comma, where a reader pauses anyway', pieces.map((p) => `“${p.text}”`).join(' / '))
}

// ---- a short line is left alone -------------------------------------------
{
  const short: Caption = { id: 's', start: 1, end: 2, text: 'Open settings.' }
  const out = shortenCaption(short, 42, newId)
  check(out.length === 1 && out[0] === short, 'a line that already fits is untouched')
  check(shortenCaptions([heard], 0, newId)[0] === heard, 'with shortening off, nothing changes')
}

// ---- no word times: an estimate, still sensible ---------------------------
{
  const guessed: Caption = { id: 'g', start: 10, end: 16, text: long }
  const pieces = shortenCaption(guessed, 42, newId)
  check(pieces.every((p) => p.text.length <= 42) && joined(pieces) === long, 'without word times it still splits cleanly')
  check(touching(pieces) && pieces[pieces.length - 1].end === 16, 'and the estimated times still fill the line exactly')
  const lengths = pieces.map((p) => p.text.length)
  const durations = pieces.map((p) => p.end - p.start)
  const perChar = durations.map((d, i) => d / lengths[i])
  const spread = Math.max(...perChar) / Math.min(...perChar)
  check(spread < 1.35, 'longer lines are given proportionally longer on screen', `pace varies ${spread.toFixed(2)}×`)
}

// ---- edited text is not trusted to the old word times ---------------------
{
  const edited: Caption = { ...heard, text: long.replace('automatic zoom', 'auto zoom') }
  check(!wordsFor(edited).heard, 'once the wording is edited, the old word times are not used')
  const pieces = shortenCaption(edited, 42, newId)
  check(joined(pieces) === edited.text && pieces.every((p) => !p.words), 'it splits the edited text, with estimated times')
}

// ---- split at the cursor, merge back --------------------------------------
{
  const text = 'Open the settings panel and turn on zoom'
  check(wordIndexAtCursor(text, text.indexOf('and')) === 4, 'a cursor before a word splits in front of it')
  check(wordIndexAtCursor(text, text.indexOf('and') - 1) === 4, 'a cursor in the space before it does too')
  check(wordIndexAtCursor(text, text.indexOf('settings') + 2) === 2, 'a cursor near the start of a word goes before it')
  check(wordIndexAtCursor(text, text.indexOf('settings') + 7) === 3, 'near the end of a word, after it — never mid-word')
  check(wordIndexAtCursor(text, 0) === null && wordIndexAtCursor(text, text.length) === null, 'no split at the very start or end')

  const [a, b] = splitCaptionAtWord(heard, 12, newId)!
  check(a.text.split(' ').length === 12 && joined([a, b]) === long, 'splitting by hand keeps every word')
  check(a.end === b.start && a.start === heard.start && b.end === heard.end, 'and the halves touch, spanning the original')
  check(a.end >= heardWords[11].end - 1e-9 && a.end <= heardWords[12].start + 1e-9, 'the break sits in the pause between those two words')

  const back = mergeCaptions(a, b)
  check(
    back.text === heard.text && back.start === heard.start && back.end === heard.end && back.id === heard.id,
    'merging the halves gives back the original line'
  )
  check(JSON.stringify(back.words) === JSON.stringify(heard.words), 'including its word times')
  check(splitCaptionAtWord(heard, 0, newId) === null && splitCaptionAtWord(heard, heardWords.length, newId) === null, 'a split at either end is refused')
}

// ---- straight from the recogniser -----------------------------------------
{
  const cues = [
    { start: heard.start, end: heard.end, text: long, confidence: 0.9, words: heardWords },
    { start: heard.end + 2, end: heard.end + 3, text: 'Done.', confidence: 0.9 }
  ]
  const shortened = captionsFromCues(cues, { maxChars: 42 })
  check(shortened.length > 2 && shortened.every((c) => c.text.length <= 42), 'a new transcript arrives already in short lines')
  check(captionsFromCues(cues).length === 2, 'and unchanged when shortening is off')
  const ordered = shortened.every((c, i) => i === 0 || c.start >= shortened[i - 1].end - 1e-9)
  check(ordered, 'the lines never overlap, so none hides another')
}

// ---- the music bed does not pump between split lines ----------------------
{
  const project = defaultProject({ width: 1920, height: 1080 })
  const music = { ...project.music, src: 'bed.mp3', duckDb: 12, gain: 0.5 }
  const pieces = shortenCaption(heard, 42, newId)
  const range = { start: 0, end: 30 }
  const ducked = musicLevelAt(pieces[0].start + 0.5, music, pieces, range, 0, 0)
  const atBreaks = pieces.slice(1).map((p) => [
    musicLevelAt(p.start - 1e-3, music, pieces, range, 0, 0),
    musicLevelAt(p.start + 1e-3, music, pieces, range, 0, 0)
  ])
  const steady = atBreaks.every(([x, y]) => Math.abs(x - ducked) < 1e-9 && Math.abs(y - ducked) < 1e-9)
  check(steady, 'the music stays ducked straight through the breaks between lines', `ducked to ${ducked.toFixed(3)}`)
}

console.log(failures ? `\n\x1b[31m${failures} caption check(s) failed.\x1b[0m\n` : '\n\x1b[32mCaption checks passed.\x1b[0m\n')
process.exit(failures ? 1 : 0)
