# src/background/ — Service Worker Layer

Runs as Chrome MV3 service worker. No DOM access. No `window`. Can go idle at any time.

## Files
- `service-worker.ts` — Orchestrator: alarms, message routing, badge, notifications
- `batcher.ts` — Buffers Slack messages, pre-filters with regex, debounce-flushes to extractor
- `extractor.ts` — Builds Claude prompt (with dynamic dismissals), calls API, stores results
- `granola-local.ts` — Reads Granola cache via Chrome Native Messaging (replaced granola-mcp.ts)
- `granola-poller.ts` — Polls Granola on alarm schedule, imports from granola-local
- `dedup.ts` — SHA-256 hashing for commitment deduplication

## Rules
- **No `window`, no DOM** — this is a service worker, use `self` if needed
- **All state in IndexedDB** — never keep important state in memory (worker can die anytime)
- Anthropic API via **direct fetch()** to `https://api.anthropic.com/v1/messages` — SDK doesn't work in service workers
- API key read from `chrome.storage.local` key `"anthropicApiKey"`
- Avoid circular imports — extractor updates badge directly via `getNewCommitmentCount()`, not by importing service-worker
- After changes: user must **reload extension** in chrome://extensions
