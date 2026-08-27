# DESIGN.md — DemoDog

House-style record for this project, so a later session can vary away from it
rather than repeating it.

## Archetype: **Brutalist**

Heavy borders, flat fills, hard offset shadows with zero blur, a visible grid,
0px radii.

Chosen because the three most recent siblings in `~/work/` are all in the
opposite register: `dontforget` and `newsfin` both shipped **Editorial**
(hairline rules, no cards, warm paper) on the same day, and `steprail` /
`mpcee` are both soft dark card grids with one accent hue and blurred
elevation. A fourth pass at either would be exactly the failure the house style
warns about.

Brutalist also suits the content. This is an instrument — a capture device with
a transport, a timeline and a scrub head. Hard edges, mechanical shadows and
visible structure read as *tool*, where soft translucency reads as *consumer
app*. The one deliberate exception is the preview stage, which stays neutral
and unstyled: you cannot judge a video against a decorated backdrop.

## Axis picks

| Axis | Pick | Why |
|---|---|---|
| **Layout** | Three-zone studio: top transport bar, fixed 300px right inspector rail, centre stage, full-width bottom timeline | The canonical editor skeleton. Distinct from the left-rail + measure of `dontforget` and the single column of `newsfin`. |
| **Type scale** | Moderate, 1.29 ratio — 11 / 12.5 / 14 / 18 / 23 / 30 | A dense tool needs a compressed scale. Dramatic scales belong on reading surfaces. |
| **Surface** | Flat fills, 2px solid borders, **offset hard shadows** (`4px 4px 0`), no blur anywhere in the chrome | The single strongest departure from every recent project, all of which used soft ambient elevation. |
| **Radius** | 0px structural, 2px on chips and swatches | Nothing rounded except the things you press. |
| **Accent** | **Duotone** — acid lime `#D6F534` + deep violet `#4B2FE3` | Two accents with distinct jobs: lime = record/active/armed, violet = selection and zoom segments. Recent projects were all single-accent (indigo, red, green, ochre). |
| **Motion signature** | **snap-slide** — `translate` with a fast overshoot curve `cubic-bezier(.2,1.5,.4,1)`, staggered 40ms | Mechanical and abrupt, matching the archetype. Unlike the soft rise-and-fade used elsewhere. |
| **Ground texture** | Dot grid, 22px pitch, low contrast | Visible structure is part of the brutalist vocabulary and doubles as a scale reference behind the stage. |

## Type

- Display / UI: **Bricolage Grotesque** (variable, `wght` 300–800, `wdth` 75–100)
- Mono: **Spline Sans Mono** — timecodes, dimensions, numeric readouts.
  Deliberately not Berkeley Mono (`steprail`) or JetBrains.

Numeric readouts are mono and tabular so scrubbing does not make the timecode
jitter.

## Palette

Light is the default; dark is a full re-theme, not an inversion.

| Token | Light | Dark |
|---|---|---|
| `--bg` | `#EDEDE8` | `#0C0C0E` |
| `--surface` | `#FFFFFF` | `#151518` |
| `--surface-2` | `#F5F5F0` | `#1D1D21` |
| `--text` | `#0A0A0B` | `#F2F2EE` |
| `--muted` | `#5E5E58` | `#9A9A95` |
| `--line` | `#0A0A0B` | `#3A3A40` |
| `--lime` | `#C4E020` | `#D6F534` |
| `--violet` | `#4B2FE3` | `#7C63FF` |

The lime is darkened in light mode so black text on it clears WCAG AA; the
violet is lightened in dark mode for the same reason on the other side.

## Non-negotiables checklist

- Light + dark + system, `data-theme` on `<html>`, no flash on boot
- Motion on entry, hover and press; nothing loops on a persistent control
- `prefers-reduced-motion` honoured
- "Made by FintonLabs" info button, bottom-left of the transport bar

---

# Landing page — `docs/index.html`

A second surface, and a deliberate exception to "vary away from the last
project": it sells the app it links to, so the *vocabulary* is kept — 2px
borders, hard offset shadows, 0px radii, the same lime/violet duotone, Bricolage
and Spline Sans Mono. Varying that would read as a different product.

What is varied is the skeleton and the scale, which is where the house style
says the variation actually has to live.

## Archetype: **Poster**

One oversized statement, full-bleed colour fields, minimal chrome. Distinct from
the app's three-zone studio, and from the Editorial and soft-card siblings.

## Axis picks

| Axis | App | Page | Why the change |
|---|---|---|---|
| **Layout** | Three-zone studio: transport bar, right rail, timeline | Full-bleed stacked sections, one wide measure (1180px), no sidebar | A page is read top to bottom; a tool is operated from its edges. |
| **Type** | Bricolage throughout | **Anton** for headlines, Bricolage for UI and body, Spline Sans Mono unchanged | The house display face is kept where it works and handed the headlines to a condensed poster face, which is what the archetype is actually for. Anton has one weight and no variable axes, so headings are `font-weight: 400` — asking for 800 only synthesises a fake bold. |
| **Type scale** | Compressed 1.29 — 11/12.5/14/18/23/30 | Dramatic ~1.5 — 12/14/17/25/38/57, hero to `clamp(52px, 10.4vw, 132px)` | The single biggest departure. A dense tool needs a flat scale; a reading surface wants the opposite. Anton sets narrower, so the same impact takes more size. |
| **Surface** | Flat fills, 2px borders, `4px 4px 0` | Same, one step heavier: 3px borders, `6px 6px 0`, `14px 14px 0` on the screenshot frames | Poster scale needs poster weight. |
| **Radius** | 0px structural, 2px on chips | 0px everywhere, including the chips | Nothing on a page is pressed except the buttons, and those are hard-edged. |
| **Accent** | Duotone lime + violet | Same, but as **full-bleed fields** rather than as controls: a violet band for the idea, a lime band for the download | The app uses accent to mean *state*; the page uses it to mean *section*. |
| **Motion signature** | snap-slide, `cubic-bezier(.2,1.5,.4,1)` | The same curve, on scroll entry — staggered 55ms *within a section*, not across the page | The gesture is the brand; only the trigger differs. Staggering per section stops a long scroll accumulating delay. |
| **Ground texture** | Dot grid, 22px pitch | 56px line grid in the hero only, masked to fade out, over a slow two-radial wash | Coarser and confined to one section, so it frames the statement rather than backing the whole page. |

## Notes worth keeping

- Fixed-colour bands (`.band`, `.down`) must not contain theme-flipping tokens.
  A `--surface` button inside the lime band renders dark-on-lime in dark mode
  and reads as a hole; those are pinned to literal values.
- The specs strip and the feature grid share their cell borders rather than
  floating as cards — the brutalist reading of a grid — which means the
  interior rules are drawn per-cell and suppressed on the first row and column.
- The hero headline is deliberately *not* `text-wrap: balance`. Left to wrap it
  falls into a descending staircase that ends on "edited." alone, which is the
  word the headline exists for; balancing evens the lines and buries it in the
  middle of the last one. The section headings *are* balanced.
- The screenshots are a real take, not the test fixture — a face in the camera
  bubble is most of what the picture-in-picture is selling. Choosing which take
  is a judgement about what is on screen, not a technical one.
- The terminal panel in the automation section keeps one ground in both themes.
  A terminal that flips to paper stops reading as one, so its colours are
  literals rather than tokens — the same rule as the fixed-colour bands.
- A grid item's default minimum is its content's min-content width, so
  `overflow-x: auto` on the `<pre>` was not enough on its own: without
  `min-width: 0` on the grid children it pushed the whole page wider than the
  viewport instead of scrolling inside its own box.
- Verified in Chrome at 1440 / 1024 / 940 / 768 / 430 / 390 / 320: no horizontal
  overflow at any width, and all 25 measured text/background pairs clear WCAG AA
  in both themes.
