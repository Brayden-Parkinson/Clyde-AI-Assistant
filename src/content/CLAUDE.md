# src/content/ — Slack Content Script

Injected into app.slack.com. Reads DOM only — never modifies it.

## Files
- `selectors.ts` — Slack DOM selectors (data-qa primary, class fallback), health check
- `slack.ts` — MutationObserver, message capture, buffering, send to background

## Rules
- **Cannot use `@shared/` alias** — must use relative paths (`../shared/types`)
- **Read-only** — never modify Slack's DOM, never scroll, never paginate
- **Resilient** — if a selector breaks, log a warning and skip, don't crash
- Selectors use `data-qa` attributes first (stable across Slack updates), class names as fallback
- Messages buffered and sent to background every ~2.5 min via `chrome.runtime.sendMessage()`
- After changes: user must **reload extension** in chrome://extensions
