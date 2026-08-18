// MIT License - Copyright (c) fintonlabs.com
/**
 * What the timeline actually draws, checked by rendering it.
 *
 * The timeline maps a time to a position, and every way of looking at that by
 * eye is unreliable: a block in roughly the right place looks correct whether
 * or not the arithmetic behind it is. Title cards made this worse, because they
 * live at negative time — the playhead sat pinned at the left edge for the
 * whole intro, which is exactly what a stuck playhead looks like.
 *
 * So the component is rendered to markup and the positions are read out of it.
 * Before the ResizeObserver fires the lane is 1000px wide, which conveniently
 * makes every pixel one thousandth of the span.
 */
import { renderToStaticMarkup } from 'react-dom/server'
import Timeline from '../src/renderer/src/editor/Timeline'

const recording = {
  duration: 10,
  source: { width: 2880, height: 1800 },
  input: { moves: [], clicks: [{ t: 5 }], scrolls: [] }
} as never

const card = (enabled: boolean, seconds: number, title: string): never =>
  ({
    enabled,
    seconds,
    title,
    subtitle: '',
    titleSize: 88,
    subtitleSize: 34,
    color: '#ffffff',
    background: '#000000',
    imageSrc: null,
    imageHeight: 180,
    fade: 0.4
  }) as never

const common = {
  recording,
  segments: [],
  selected: null,
  trim: { start: 0, end: 10 },
  onSeek: () => {},
  onSelect: () => {},
  onChange: () => {},
  captions: [],
  selectedCaption: null,
  onSelectCaption: () => {}
}

const withCards = renderToStaticMarkup(
  <Timeline {...common} time={-2} intro={card(true, 2, 'Hello')} outro={card(true, 3, 'Bye')} />
)
const noCards = renderToStaticMarkup(
  <Timeline {...common} time={0} intro={card(false, 2, '')} outro={card(false, 3, '')} />
)

/** The left/width of the nth `.card-block`, in pixels of a 1000px lane. */
function cardBlock(markup: string, nth: number): { left: number; width: number } | null {
  const blocks = [...markup.matchAll(/class="card-block" style="([^"]*)"/g)]
  const style = blocks[nth]?.[1]
  if (!style) return null
  const value = (name: string): number =>
    Number(new RegExp(`${name}:(-?[\\d.]+)`).exec(style)?.[1] ?? NaN)
  return { left: value('left'), width: value('width') }
}

/** Positions are floating point, so compare to the pixel rather than the bit. */
const near = (a: number, b: number): boolean => Math.abs(a - b) < 0.5

let failed = 0
function check(condition: boolean, label: string): void {
  console.log(`  ${condition ? '[32m✓[0m' : '[31m✗[0m'} ${label}`)
  if (!condition) failed++
}

console.log('\nTimeline')

// A 10s take with a 2s intro and a 3s outro spans 15s, so one second is 66.67px.
check(withCards.includes('track cards'), 'a lane appears when a card is enabled')
check(withCards.includes('Hello'), 'the intro is labelled with its title')
check(withCards.includes('Bye'), 'the outro is labelled with its title')
const intro = cardBlock(withCards, 0)
const outro = cardBlock(withCards, 1)
check(!!intro && near(intro.left, 0), 'the intro starts at the left edge')
check(!!intro && near(intro.width, 1000 * (2 / 15)), 'the intro is 2s of a 15s span (133px)')
check(
  !!outro && near(outro.left, 1000 * (12 / 15)),
  'the outro starts where the recording ends (800px)'
)
check(!!outro && near(outro.width, 1000 * (3 / 15)), 'the outro is 3s of a 15s span (200px)')
check(
  withCards.includes('class="playhead" style="left:1px"'),
  'the playhead at -2s sits at the start rather than off the lane'
)

// The common case must be untouched: with no cards the mapping is what it was.
check(!noCards.includes('track cards'), 'no lane when both cards are off')
check(noCards.includes('left:500px'), 'a click at 5s of 10s still lands mid-lane')

if (failed > 0) {
  console.error(`\n[31m${failed} timeline check(s) failed.[0m\n`)
  process.exit(1)
}
console.log('\n[32mTimeline checks passed.[0m\n')
