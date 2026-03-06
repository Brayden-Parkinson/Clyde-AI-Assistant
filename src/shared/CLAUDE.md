# src/shared/ — Shared Foundation

Everything in the extension imports from here. Changes here affect all layers.

## Files
- `types.ts` — All TypeScript interfaces (Commitment, RawMessage, Dismissal, etc.)
- `tokens.ts` — OpenSpace brand colors/fonts (`OS` object) + urgency/confidence helpers
- `constants.ts` — COMMITMENT_REGEX, alarm names, TTLs, CLAUDE_MODEL, defaults
- `db.ts` — Dexie.js database with 5 tables + helper query functions

## Rules
- Adding a new DB table? Bump `db.version()` and add migration
- All colors must come from `OS` tokens — never hardcode hex in components
- `COMMITMENT_REGEX` is the pre-filter gate — update it to catch new commitment patterns
- Types are the contract between layers — change a type here, fix all consumers
