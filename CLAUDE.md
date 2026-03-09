# Clyde — Chrome Extension

Chrome extension (MV3) that watches Slack + Granola meeting notes, uses Claude to extract commitments, presents a triage inbox. Say "Clyde" in a message to explicitly flag a commitment. All data local (IndexedDB).

## Dev Commands
```bash
npm run dev          # Vite + CRXJS hot reload → dist/
npm run build        # tsc --noEmit + vite build (MUST pass before commit)
npm run typecheck    # TypeScript only, no emit
npm run test         # Vitest single run
npm run test:watch   # Vitest watch mode
```
Load `dist/` as unpacked extension in chrome://extensions (Developer mode).

## Architecture
```
content/slack.ts        MutationObserver → chrome.runtime.sendMessage()
                                         ↓
background/batcher.ts   COMMITMENT_REGEX pre-filter → debounce 5min
background/extractor.ts fetch() to Anthropic API → dedup SHA-256 → IndexedDB
                                         ↓
shared/db.ts            Dexie (12 tables, 9 migrations, all local)
                                         ↓
popup/App.tsx           React 18, useLiveQuery, inline styles, demo mode
```

## Directory Map
- `src/shared/` — Types, tokens, constants, Dexie DB — see `src/shared/CLAUDE.md`
- `src/background/` — Service worker, batcher, extractor, granola poller — see `src/background/CLAUDE.md`
- `src/content/` — Slack DOM observer — see `src/content/CLAUDE.md`
- `src/popup/` — React 18 triage inbox — see `src/popup/CLAUDE.md`
- `src/sidepanel/` — Reuses popup App component
- `src/options/` — Settings page
- `native-host/` — Python bridge for Granola native messaging
- `CLAUDE_CODE_SPEC.md` — Full product spec (source of truth for requirements)
- `UI_REFERENCE.jsx` — Pixel-perfect UI reference (source of truth for design)

## Critical Rules
- `npx tsc --noEmit` must pass before every commit
- Never commit to master — branch first: `git checkout -b agent/<feature>`
- Import shared code via `@shared/` alias (background, popup, options, sidepanel) or `../shared/` (content scripts only)
- UI uses **inline styles only** with OS tokens from `@shared/tokens` — no CSS files, no Tailwind, no hardcoded hex
- Anthropic API is called via **direct fetch()**, not the SDK (service worker compat)
- Content scripts can't use `@shared/` alias — must use relative `../shared/` paths

## After Making Changes — ALWAYS Do This
1. Run `npm run build` to rebuild the extension into `dist/`
2. Tell the user what to reload in Chrome:
   - Popup/options/sidepanel → "Reload the extension in chrome://extensions (click ↻)"
   - Background or content script → "Reload the extension in chrome://extensions (click ↻)"
   - Manifest permissions/host_permissions → "Remove and re-load the extension as unpacked"

## Demo Mode — ALWAYS Check After Changes
- New data-dependent features read from `DEMO_*` exports in `src/shared/demo-data.ts` when `demoMode=true`
- App.tsx switches data sources: `demoMode ? DEMO_X : realX` — new features must follow this pattern
- Actions/mutations that write to IndexedDB or chrome.storage must be guarded by `if (demoMode) return`
- The Settings page is intentionally accessible in demo mode — settings writes are allowed
- `SetupWizard.tsx` skips all storage reads/writes when `demoMode=true`
- The demo mode banner ("DEMO MODE — Showing sample data") must remain visible in App.tsx

## Review Checklist
Before merging any change, verify:

1. **Build**: `npm run build` passes with zero TypeScript errors
2. **Tests**: `npm run test` passes — extractor, dedup, regex tests all green
3. **Import paths**: `@shared/` alias used in background/popup/options; `../shared/` in content scripts only
4. **No CSS**: Zero CSS files added, no Tailwind, no hardcoded hex colors — OS tokens only
5. **API key safety**: Never logged, never hardcoded, always read from `chrome.storage.local.anthropicApiKey`
6. **DB schema changes**: New Dexie version added with migration, no destructive schema ops without migration
7. **Demo mode**: New data-dependent UI reads from `DEMO_*` when `demoMode=true`; writes guarded with `if (demoMode) return`
8. **Service worker compat**: No `window`, no DOM APIs in `src/background/` — service workers have no DOM
9. **Content script safety**: `src/content/` never modifies Slack DOM, never uses `@shared/` alias
10. **Sensitive data**: Claude responses may tag `sensitive=true` — verify sensitive commitments are not exposed in UI without the privacy flag
11. **API response validation**: Any new Claude call must validate the JSON response shape before writing to DB
12. **TTL coverage**: New DB tables/records must have a cleanup case in the service worker's `CLEANUP_ALARM` handler
13. **Reload instruction**: PR description includes which Chrome reload action is needed
14. **Commit message**: Describes "why", not just "what" — matches pattern of recent commits

## Common Pitfalls
- **Forgetting `if (demoMode) return`** in action handlers — causes demo data to get persisted to real DB
- **Using `window` in service worker** — crashes the SW silently; use `self` or chrome APIs
- **Direct `../shared/` import in popup** — should be `@shared/`; breaks in prod build with alias mismatch
- **Adding a new DB table without a migration** — Dexie throws on schema mismatch for existing installs
- **Hardcoding colors** — use `OS.red`, `OS.green` etc.; hardcoded hex bypasses the design system
- **New Claude call without validation** — Claude may return malformed JSON; always wrap in try/catch with fallback
- **Forgetting COMMITMENT_REGEX pre-filter** — new source types bypass the regex gate and send everything to Claude (expensive)
- **Slack selector changes** — if updating `selectors.ts`, run `runDiagnostics()` manually in Slack to verify
