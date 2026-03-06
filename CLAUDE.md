# Clyde — Chrome Extension

Chrome extension (MV3) that watches Slack + Granola meeting notes, uses Claude to extract commitments, presents a triage inbox. Say "Clyde" in a message to explicitly flag a commitment. All data local (IndexedDB).

## Dev Commands
```bash
npm run dev          # Vite + CRXJS hot reload
npm run build        # tsc --noEmit + vite build
npm run typecheck    # TypeScript only
```
Load `dist/` as unpacked extension in chrome://extensions (Developer mode).

## Directory Map
- `src/shared/` — Types, tokens, constants, Dexie DB (everything imports from here)
- `src/background/` — Service worker, batcher, extractor, granola poller
- `src/content/` — Slack DOM observer (runs in page context)
- `src/popup/` — React 18 triage inbox
- `src/sidepanel/` — Reuses popup App component
- `src/options/` — Settings page
- `CLAUDE_CODE_SPEC.md` — Full product spec (source of truth for requirements)
- `UI_REFERENCE.jsx` — Pixel-perfect UI reference (source of truth for design)

## Critical Rules
- `npx tsc --noEmit` must pass before every commit
- Never commit to master — branch first: `git checkout -b agent/<feature>`
- Import shared code via `@shared/` alias (background, popup, options, sidepanel) or `../shared/` (content scripts)
- UI uses **inline styles only** with OS tokens from `@shared/tokens` — no CSS files, no Tailwind
- Anthropic API is called via **direct fetch()**, not the SDK (service worker compat)
- Content scripts can't use `@shared/` alias — must use relative `../shared/` paths

## After Making Changes — ALWAYS Do This
1. Run `npm run build` to rebuild the extension into `dist/`
2. Then tell the user what to do in Chrome:
   - Popup/options/sidepanel files → "Reload the extension in chrome://extensions (click ↻)"
   - Background or content script files → "Reload the extension in chrome://extensions (click ↻)"
   - Manifest permissions/host_permissions → "Remove and re-load the extension as unpacked"
