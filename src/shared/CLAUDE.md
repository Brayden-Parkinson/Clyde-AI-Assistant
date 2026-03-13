# src/shared/ — Shared Foundation

Everything in the extension imports from here. Changes here affect all layers.

## Key Files
- `types.ts` — All TypeScript interfaces. Phase 2 adds: ActionProposal, DraftMessage, FollowUpRule, ExternalIntegration, ExternalTaskLink
- `tokens.ts` — OS design tokens (colors, fonts). Never hardcode hex — use `OS.red`, `OS.blue` etc.
- `constants.ts` — COMMITMENT_REGEX, ALARMS, TTLs, CLAUDE_MODEL, DEFAULTS, GOOGLE_OAUTH
- `db.ts` — Dexie v16, 15 tables. Current tables: commitments, raw_messages, dismissals, action_log, settings, decision_log, kanban_columns, kanban_assignments, completion_suggestions, dismissed_completions, briefs, tags, calendar_cache, people, chat_sessions, chat_messages, daily_reviews, memories, work_patterns, weekly_digests, okrs, commitment_okr_links, sync_outbox, action_proposals, drafts, follow_up_rules, integrations, external_task_links
- `demo-data.ts` — DEMO_* fixtures for all data types used in demo mode

## Rules
- New DB table → bump `db.version()`, add migration, add EntityTable declaration, add TTL cleanup in service-worker's `runCleanup()`
- All colors via `OS` tokens — no hardcoded hex anywhere
- `COMMITMENT_REGEX` is the pre-filter gate — new sources must pass through it
- Types are the contract between all layers — fix all consumers when a type changes
