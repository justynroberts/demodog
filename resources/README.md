# Artwork

`icon-source.png` is the single source for both the macOS app icon and the
in-app brand mark. Save the DemoDog artwork here as a square PNG (1024×1024 or
larger), then run:

```bash
npm run icon
```

That generates:

- `resources/icon.icns` — the app bundle icon, used by electron-builder
- `src/renderer/public/logo.png` — the mark shown in the app's title bar

Both are build outputs and are not tracked; only `icon-source.png` is.
