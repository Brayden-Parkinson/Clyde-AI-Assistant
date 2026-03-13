# src/background/ — Service Worker Layer

Chrome MV3 service worker. No DOM, no `window`. Can go idle — all state must live in IndexedDB.

## Key Files
- `service-worker.ts` — Alarms, message routing, badge, cleanup, lifecycle
- `batcher.ts` — Buffers Slack/Gmail messages, regex pre-filter, debounce-flush to extractor
- `extractor.ts` — Claude prompt builder, API caller, dedup, commitment storage
- `action-executor.ts` — Executes approved ActionProposals (send message, block time, Linear)
- `draft-generator.ts` — Claude-powered message draft generation (standalone fetch, no extractor dep)
- `slack-sender.ts` — Slack chat.postMessage via Bot Token (only called by approved proposals)
- `gmail-sender.ts` — Gmail draft creation only — NEVER sends (user reviews in Gmail)
- `follow-up-engine.ts` — Detects stale commitments, creates follow-up ActionProposals
- `calendar-writer.ts` — Google Calendar event/time-block creation via OAuth
- `google-auth.ts` — Google OAuth token management (`getValidAccessToken()`)
- `people-extractor.ts` — Upserts People table from commitment senders + calendar attendees
- `integrations/linear.ts` — Linear GraphQL API (createLinearTask, getLinearTeams)

## Rules
- **No `window`, no DOM** — use `self` or chrome APIs only
- All external actions (Slack send, Gmail, Calendar, Linear) MUST go through an approved ActionProposal — never auto-execute
- API tokens read from `chrome.storage.local`, never logged
- Circular import risk: action-executor.ts must NOT import service-worker.ts
- Dynamic `import()` inside message handlers avoids unused-import linting issues
- After changes: user must **reload extension** in chrome://extensions
