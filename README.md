# MG Sprite Customiser V2

A browser-based tool for composing, customising, and exporting Magic Garden sprites with overlays, text, cards, and animation support.

**[Use it here →](https://mg-tokyo.github.io/MG-Sprite-Customiser-V2/)**

## Features

- **Sprite browser** - browse all in-game sprites (pets, plants, crops, seeds, eggs, tools, decor)
- **Multi-layer composition** - layer multiple sprites on a shared canvas with per-layer transform controls (position, scale, rotation, flip)
- **Mutations & tinting** - apply game mutation filters and custom colour tint with adjustable opacity
- **Overlays** - built-in SVG overlay library (arrows, shapes, bubbles, frames, connectors, patterns, and more)
- **Text layers** - add text using MG fonts, curated Google Fonts, or Unicode styles
- **Card renderer** - generate full game-style info cards for pets, plants, crops, seeds, eggs, tools, and decor, complete with stats, abilities, diet, and bar displays
- **Blobling avatar** - render animated blobling avatars with cosmetic layers via the game's Rive file
- **Import custom images** - drag-and-drop PNG, JPEG, or GIF files onto the canvas
- **Export** - download compositions as PNG or animated GIF
- **Scene management** - save, load, and export/import scenes as JSON; all data stored in browser localStorage
- **Undo / redo** - full history support
- **Dark / light theme**

## Development

### Local Development

1. Install dependencies:
```bash
npm ci
```
2. Start dev server:
```bash
npm run dev
```

### Production Build Requirements

`VITE_CORS_PROXY` is required for production builds and must point to your dedicated Cloudflare Worker proxy prefix.

Example:
```bash
VITE_CORS_PROXY=https://<worker>.<account>.workers.dev/?url= npm run build
```

Optional:
- `VITE_ENABLE_PROXY_DEBUG=false` (default)
  Enables local debug-only runtime `?proxy=` override when set to `true`.

### Cloudflare Worker Hardening

Worker config supports:
- `ALLOWED_ORIGINS` (comma-separated)
- `ALLOWED_HOSTS` (comma-separated)
- `ALLOWED_PATH_PREFIXES` (`host:/prefix1,/prefix2;host2:/prefix`)
- `RATE_LIMIT_ENABLED` (`true`/`false`)
- `RATE_LIMIT_RPM` (requests/minute per client IP)
- `PROXY_TIMEOUT_MS`

### Privacy Notes

- This app does not require account login.
- Scene data is saved in browser `localStorage`.
- Proxy requests relay remote asset/API responses; the app itself does not persist user scene content server-side.
- Imported custom images may be converted to in-browser data URLs for saved scenes.
