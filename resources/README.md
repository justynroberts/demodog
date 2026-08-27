# Artwork

`logo.svg` is the artwork: the DemoDog mark, flat black, on transparency.
`logo-lockup.svg` is the same mark above the *demodog* wordmark. Both are
vector and are the thing to edit or hand to anyone who asks for the logo.

The two PNGs beside them are what the build actually consumes, and they differ
on purpose:

| File | What it is | Why |
|---|---|---|
| `icon-source.png` | 1024², the macOS tile — an 824px rounded rectangle inset in the canvas, transparent outside | The Dock expects that shape. A full-bleed square reads as a sticker. |
| `logo-source.png` | 1024², full-bleed light square | The in-app mark sits in a small hard-edged square chip, where the tile's transparent corners would show the chip through them. |

Ink is `#212122` on a `#F4F4F4` ground, which the CSS behind the in-app chips
matches.

Regenerate the build outputs with:

```bash
npm run icon
```

That reads the two PNGs and writes:

- `resources/icon.icns` — the app bundle icon, used by electron-builder
- `src/renderer/public/logo.png` — the mark shown in the title bar, the setup
  screen's credit, and the splash card

Both are build outputs and are not tracked; the SVGs and the two source PNGs
are.
