# Clyde — Chrome Extension

Chrome extension (MV3) that watches Slack + Granola meeting notes, extracts commitments via Claude, and presents an action inbox. All data local (IndexedDB). Say "Clyde" in any message to explicitly flag a commitment.

## Dev Commands
```bash
npm run dev          # Vite + CRXJS hot reload → dist/
npm run build        # tsc --noEmit + vite build (MUST pass before commit)
npm run test         # Vitest single run
```
Load `dist/` as unpacked extension in chrome://extensions (Developer mode).

## Architecture
```
content/slack.ts    MutationObserver → chrome.runtime.sendMessage()
                                     ↓
background/         batcher (regex pre-filter) → extractor (Claude API) → IndexedDB
                                     ↓
shared/db.ts        Dexie v16 (15 tables, all local)
                                     ↓
popup/App.tsx       React 18, useLiveQuery, inline styles, demo mode
```

## Directory Map
- `src/shared/`    — Types, tokens, constants, Dexie DB — see `src/shared/CLAUDE.md`
- `src/background/` — Service worker, all background logic — see `src/background/CLAUDE.md`
- `src/content/`  — Slack DOM observer (read-only) — see `src/content/CLAUDE.md`
- `src/popup/`    — React 18 UI — see `src/popup/CLAUDE.md`
- `src/options/`  — Settings page (shares `SettingsPanel` with popup)
- `src/sidepanel/` — Renders popup App component in side panel mode
- `native-host/`  — Python bridge for Granola native messaging
- `CLAUDE_CODE_SPEC.md` — Full product spec (source of truth for requirements)
- `UI_REFERENCE.jsx` — Pixel-perfect UI reference (source of truth for design)

## Cross-Cutting Rules
- `npx tsc --noEmit` must pass before every commit
- Never commit to master — `git checkout -b agent/<feature>`
- `npm run build` after every change; tell user what to reload in Chrome
- `@shared/` alias for background/popup/options; `../shared/` for content scripts only
- Inline styles only — OS tokens from `@shared/tokens`, no CSS, no hardcoded hex
- All new DB tables need a version bump + migration in `src/shared/db.ts`
- Anthropic API via direct `fetch()` — never the SDK (service worker incompatible)
