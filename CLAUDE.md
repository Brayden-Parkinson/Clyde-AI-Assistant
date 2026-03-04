# Commitment Tracker — Chrome Extension

Chrome extension that watches Slack messages + Granola meeting notes, uses Claude to extract commitments, presents them in a triage inbox. All data local.

## Dev Commands
```bash
npm install          # Install deps
npm run dev          # Vite dev server + CRXJS hot reload
npm run build        # Type check + production build
npm run typecheck    # TypeScript check only
```

## Load in Chrome
1. `npm run dev` or `npm run build`
2. Go to `chrome://extensions` → Developer mode → Load unpacked → select `dist/`

## Directory Map
- `src/shared/` — Types, design tokens, constants, Dexie DB
- `src/background/` — Service worker, batcher, Claude extractor, Granola poller
- `src/content/` — Slack DOM observer + selectors
- `src/popup/` — React triage inbox UI
- `src/sidepanel/` — Side panel (reuses popup App)
- `src/options/` — Settings page

## Git Rules
- Branch first: `git checkout -b agent/<feature>`
- `npx tsc --noEmit` must pass before every commit
- Import shared code via `@shared/` alias or `../shared/`
