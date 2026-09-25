// MIT License - Copyright (c) fintonlabs.com
/**
 * Subtitles in another language: translated as sentences, shown as lines.
 *
 * The translator is Apple's and is not exercised here. What is checked is the
 * part that decides what to send it and where the answer goes — because a
 * translator handed half a clause returns nonsense, and an answer put back in
 * the wrong place is a subtitle under the wrong moment.
 */
import { shortenCaption, type Caption } from '../src/renderer/src/engine/captions'
import {
  sentencesFrom,
  shareOut,
  withTranslation,
  withoutTranslation
} from '../src/renderer/src/engine/translate'

let failures = 0
function check(ok: boolean, label: string, detail = ''): void {
  console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${label}${detail ? `  \x1b[2m${detail}\x1b[0m` : ''}`)
  if (!ok) failures++
}

let n = 0
const newId = (base: string): string => `${base}~${++n}`
const line = (id: string, start: number, end: number, text: string): Caption => ({ id, start, end, text })

console.log('\nSubtitles')

// ---- what gets sent to the translator --------------------------------------
{
  const long: Caption = {
    id: 'c0',
    start: 2,
    end: 9,
    text: 'First, open the settings panel from the menu in the top right corner.',
    words: undefined
  }
  const pieces = shortenCaption(long, 42, newId)
  check(pieces.length > 1, 'a transcribed line is on screen as several short ones', `${pieces.length} lines`)
  const sentences = sentencesFrom(pieces)
  check(sentences.length === 1, 'but it is translated as one sentence, not as fragments')
  check(sentences[0].text === long.text, 'and the sentence sent is the words as spoken')
}
{
  const captions = [
    line('a', 1, 3, 'Open the settings panel.'),
    line('b', 3, 5, 'Choose the tab called invoices.'),
    line('c', 9, 11, 'Each row shows the customer')
  ]
  const sentences = sentencesFrom(captions)
  check(sentences.length === 3, 'finished sentences are kept apart', `${sentences.length}`)
  const gapped = sentencesFrom([line('a', 1, 3, 'Each row shows the customer'), line('b', 8, 10, 'and the date it was paid.')])
  check(gapped.length === 2, 'a long silence between two lines breaks the sentence even without a full stop')
  check(sentencesFrom([]).length === 0 && sentencesFrom([line('a', 1, 2, '  ')]).length === 0, 'empty lines are not sent at all')
}

// ---- where the answer goes --------------------------------------------------
{
  const spoken = [
    line('a', 1, 3, 'First, open the settings panel'),
    line('b', 3, 5.5, 'from the menu in the top right corner.')
  ]
  const sentences = sentencesFrom(spoken)
  const dutch = 'Open eerst het instellingenpaneel vanuit het menu in de rechterbovenhoek.'
  const out = withTranslation(spoken, sentences, [dutch])
  check(out.length === 2, 'the same number of lines comes back')
  check(out.every((c, i) => c.start === spoken[i].start && c.end === spoken[i].end), 'each keeps its own timing exactly')
  check(out.map((c) => c.text).join(' ') === dutch, 'and together they say the whole translated sentence')
  check(out.every((c) => c.text.trim().length > 0), 'no line is left empty')
  check(out[0].text.split(' ').length >= 2 && !dutch.startsWith(out[1].text), 'the break falls between words, not inside one')
  check(out.every((c, i) => c.original === spoken[i].text), 'the spoken wording is kept on every line')
  check(out.every((c) => c.words === undefined), 'word times are dropped: they belong to the words that were heard')

  const back = withoutTranslation(out)
  check(back.every((c, i) => c.text === spoken[i].text && c.original === undefined), 'going back gives the spoken wording, exactly')
  const twice = withoutTranslation(withTranslation(out, sentencesFrom(out), ['Ganz anderer Text hier drin.']))
  check(twice.every((c, i) => c.text === spoken[i].text), 'even after translating a translation, going back reaches the original')
}

// ---- proportions ------------------------------------------------------------
{
  const pieces = shareOut('een twee drie vier vijf zes zeven acht', [10, 30])
  check(pieces.length === 2 && pieces.join(' ').split(' ').length === 8, 'every word is dealt out, none lost or repeated')
  check(pieces[1].split(' ').length > pieces[0].split(' ').length, 'the line that held more of the original holds more of the translation')
  const tiny = shareOut('twee woorden', [10, 10, 10])
  check(tiny.filter((p) => p).length >= 1 && tiny.join(' ').trim() === 'twee woorden', 'a translation shorter than the lines it fills loses nothing')
  const one = shareOut('een zin', [5])
  check(one.length === 1 && one[0] === 'een zin', 'a single line takes the whole sentence')
}

// ---- a translation that fails halfway ---------------------------------------
{
  const spoken = [line('a', 1, 3, 'Open the settings panel.'), line('b', 3, 5, 'Choose invoices.')]
  const out = withTranslation(spoken, sentencesFrom(spoken), ['Open het instellingenpaneel.', ''])
  check(out[0].text === 'Open het instellingenpaneel.' && out[1].text === 'Choose invoices.', 'a sentence that came back empty is left in the spoken language rather than blanked')
  check(out[1].original === undefined, 'and is not marked as translated, so going back does not undo the wrong line')
}

console.log(failures ? `\n\x1b[31m${failures} subtitle check(s) failed.\x1b[0m\n` : '\n\x1b[32mSubtitle checks passed.\x1b[0m\n')
process.exit(failures ? 1 : 0)
