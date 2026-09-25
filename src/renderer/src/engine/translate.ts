// MIT License - Copyright (c) fintonlabs.com
/**
 * Subtitles in a language the narration was not spoken in.
 *
 * The recogniser is not involved: it still hears English (or whatever was
 * spoken) and times every word. This takes those finished lines and swaps the
 * text for a translation, keeping each line exactly where it was.
 *
 * The catch is that captions are short — forty-odd characters, half a clause —
 * and a translator given half a clause returns nonsense with confident grammar.
 * So the lines are put back into whole sentences, the sentences are translated,
 * and the result is dealt back out across the same lines in the same
 * proportions. The English is kept on each line, so switching back is exact
 * rather than another trip through the translator.
 */
import type { Caption } from './captions'

/** What the languages are called, in their own language and in English. */
export const SUBTITLE_LANGUAGES: { tag: string; label: string }[] = [
  { tag: 'nl', label: 'Dutch — Nederlands' },
  { tag: 'fr', label: 'French — Français' },
  { tag: 'pt-BR', label: 'Portuguese — Português (Brasil)' },
  { tag: 'es', label: 'Spanish — Español' },
  { tag: 'de', label: 'German — Deutsch' }
]

/** A run of caption lines that make up one sentence. */
export interface Sentence {
  /** Indices into the captions given, in order. */
  at: number[]
  text: string
}

/** Ends a sentence: a full stop, question or exclamation, closing quotes aside. */
const ENDS = /[.!?…]["'”’)\]]*$/
/** A pause this long between lines is a sentence break even without punctuation. */
const PAUSE = 0.7
/** Long enough that a translator would lose the thread anyway. */
const LONGEST = 400

/**
 * Groups caption lines back into the sentences they were split from.
 *
 * Lines that were split by `shortenCaption` touch exactly and carry no closing
 * punctuation, which is what makes them recognisable as one sentence.
 */
export function sentencesFrom(captions: Caption[]): Sentence[] {
  const out: Sentence[] = []
  let current: Sentence | null = null
  captions.forEach((caption, index) => {
    const text = caption.text.trim()
    if (!text) return
    const previous = current && captions[current.at[current.at.length - 1]]
    const broken =
      !current ||
      !previous ||
      ENDS.test(previous.text.trim()) ||
      caption.start - previous.end > PAUSE ||
      (current as Sentence).text.length + text.length > LONGEST
    if (broken) {
      current = { at: [index], text }
      out.push(current)
    } else {
      const sentence = current as Sentence
      sentence.at.push(index)
      sentence.text = `${sentence.text} ${text}`
    }
  })
  return out
}

/**
 * Splits one translated sentence back across the lines it came from.
 *
 * In the proportions the original lines had, so a line that held a third of the
 * English holds about a third of the Dutch and stays on screen for as long as
 * it takes to read. Breaks fall between words; a share that lands mid-word
 * takes the whole word.
 */
export function shareOut(translated: string, shares: number[]): string[] {
  const words = translated.trim().split(/\s+/).filter(Boolean)
  const pieces: string[] = []
  if (shares.length <= 1 || words.length === 0) {
    return shares.map((_, i) => (i === 0 ? translated.trim() : ''))
  }
  const total = shares.reduce((sum, s) => sum + s, 0) || shares.length
  let taken = 0
  let used = 0
  for (let i = 0; i < shares.length; i++) {
    const last = i === shares.length - 1
    if (last) {
      pieces.push(words.slice(taken).join(' '))
      break
    }
    used += shares[i] / total
    // Always leave one word for each line still to come, so no line is empty.
    const target = Math.round(used * words.length)
    const most = words.length - (shares.length - 1 - i)
    const upTo = Math.min(Math.max(target, taken + 1), most)
    pieces.push(words.slice(taken, upTo).join(' '))
    taken = upTo
  }
  return pieces
}

/**
 * The captions as they should be once a translation comes back.
 *
 * `translations` is one string per sentence, in the order `sentencesFrom` gave
 * them. A sentence that came back empty is left in the language it was in
 * rather than blanking the line.
 */
export function withTranslation(
  captions: Caption[],
  sentences: Sentence[],
  translations: string[]
): Caption[] {
  const next = captions.slice()
  sentences.forEach((sentence, index) => {
    const translated = (translations[index] ?? '').trim()
    if (!translated) return
    const shares = sentence.at.map((at) => captions[at].text.trim().length || 1)
    const pieces = shareOut(translated, shares)
    sentence.at.forEach((at, piece) => {
      const text = pieces[piece] ?? ''
      if (!text) return
      const caption = captions[at]
      next[at] = {
        ...caption,
        text,
        // Kept so going back to the spoken language is the original wording,
        // not a translation of a translation.
        original: caption.original ?? caption.text,
        // The recogniser's word times belong to the words it heard. They do not
        // survive translation, and a split would otherwise trust them.
        words: undefined
      }
    })
  })
  return next
}

/** The captions as they were before any translation. */
export function withoutTranslation(captions: Caption[]): Caption[] {
  return captions.map((caption) =>
    caption.original === undefined
      ? caption
      : { ...caption, text: caption.original, original: undefined }
  )
}
