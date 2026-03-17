# src/popup/ — React 18 UI

React 18 app rendered in Chrome popup and side panel. Wide-screen mode adds a left sidebar nav.

## Key Files
- `App.tsx` — Main layout, view routing, all state, LeftNav, renderCard
- `components/CommitmentCard.tsx` — Expandable card with actions, meta-edit, Phase 2 buttons
- `components/ActionQueue.tsx` — Pending action proposals with approve/dismiss flow
- `components/DraftComposer.tsx` — Message editor with tone selector, regenerate, send bar
- `components/PeoplePanel.tsx` — Contact list with open-commitment counts, follow-up drafting
- `components/ClydeChat.tsx` — AI chat with tool use (create, search, draft, follow-up, Linear)
- `components/DailyPlanner.tsx` — Morning brief + daily planning view
- `hooks/useActions.ts` — Commitment action handlers (done, snooze, calendar, slack, etc.)

## ViewMode
`"list" | "board" | "brief" | "devlog" | "settings" | "chat" | "people" | "memory" | "insights" | "okrs" | "queue" | "draft"`

## Rules
- **Inline styles only** — `OS` tokens from `@shared/tokens`, no CSS files, no hardcoded hex
- **Match UI_REFERENCE.jsx** — that file is the pixel-perfect design spec
- `useLiveQuery` from `dexie-react-hooks` for all reactive IndexedDB reads
- Changes hot-reload automatically in dev mode

## Demo Mode
- `demoMode` boolean from `chrome.storage.local`, held in App.tsx state
- All data sources: `demoMode ? DEMO_X : liveData` — new features MUST follow this
- Writes to DB/storage: `if (demoMode) return` (show a toast instead)
- Add `DEMO_*` fixtures to `src/shared/demo-data.ts` for any new data type
