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
