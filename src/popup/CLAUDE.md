# src/popup/ — React Triage Inbox

React 18 app rendered in Chrome popup (400px wide) and side panel (wider).

## Files
- `App.tsx` — Main layout: sticky header, filters, card list, empty state, toast
- `components/` — CommitmentCard, ActionButton, FilterBar, LearnedPatterns, StatBar, Toast
- `hooks/useCommitments.ts` — Dexie `useLiveQuery` for reactive data
- `hooks/useActions.ts` — Action handlers (calendar, dismiss, done, snooze, reminder, slack)
- `hooks/useSettings.ts` — Settings read/write

## Rules
- **Inline styles only** — use `OS` tokens from `@shared/tokens`, no CSS files
- **Match UI_REFERENCE.jsx** — that file is the pixel-perfect design spec
- Cards sorted: urgency (high→low), then confidence (desc)
- `useLiveQuery` from `dexie-react-hooks` for reactive IndexedDB reads
- Side panel (`src/sidepanel/`) imports and renders this same App component
- Changes here **hot-reload automatically** — no manual reload needed
