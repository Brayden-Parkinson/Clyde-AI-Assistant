# /review — Multi-Agent Code Review

Run a structured multi-agent review of the current branch against main/master. Surfaces only high-confidence findings (≥80 by default, override with `REVIEW_THRESHOLD` env var).

## Instructions

You are a senior reviewer running a 5-pass code review on a Chrome MV3 extension (TypeScript + React 18 + Dexie + CRXJS/Vite). The codebase has strict rules documented in CLAUDE.md and subdirectory CLAUDE.md files.

**Step 1 — Get the diff**

```bash
git diff $(git merge-base HEAD main)..HEAD --stat
git diff $(git merge-base HEAD main)..HEAD
```

If `main` doesn't exist, try `master`. Record the list of changed files and total lines changed.

**Step 2 — Skip check**

If the diff only touches:
- `*.md`, `*.txt`, `docs/**`, `CHANGELOG*`
- `.github/**` CI configs only
- Files under 5 total lines changed

Output: "No substantive changes to review." and stop.

**Step 3 — Run all 5 review passes**

Run each pass as a focused sub-analysis. For each finding, assign a confidence score 0–100:
- 50 = real issue but possibly a nitpick or style preference
- 75 = confirmed significant issue, double-checked against context
- 100 = absolute certainty with direct evidence (e.g. `window` in service worker)

Only include findings with confidence ≥ `$REVIEW_THRESHOLD` (default: 80).

---

### Pass 1: CLAUDE.md Compliance

Check the diff against every rule in CLAUDE.md and subdirectory CLAUDE.md files:

- [ ] `npx tsc --noEmit` — does this change introduce any TypeScript errors? (Run it)
- [ ] Import paths: `@shared/` in background/popup/options; `../shared/` in content scripts only
- [ ] No CSS files added, no Tailwind, no hardcoded hex colors (must use `OS.*` tokens from `@shared/tokens`)
- [ ] No `window` or DOM APIs in `src/background/` files
- [ ] Content scripts (`src/content/`) must not import from `@shared/` and must not modify the DOM
- [ ] API key never logged, hardcoded, or committed — always from `chrome.storage.local.anthropicApiKey`
- [ ] New DB tables/columns have a Dexie migration (bumped version, schema entry in `shared/db.ts`)
- [ ] New DB records have a TTL cleanup case in service-worker.ts `CLEANUP_ALARM` handler
- [ ] Demo mode: new data sources switch via `demoMode ? DEMO_X : realX`; write actions guarded by `if (demoMode) return`
- [ ] New Claude calls validate the JSON response before writing to DB
- [ ] Direct `fetch()` used for Anthropic API (not SDK)
- [ ] No new CSS file was created anywhere in `src/`

**Report format:**
```
[CLAUDE.md] <rule violated> — <file>:<line> — confidence: <N>
```

---

### Pass 2: Bug Detection

Scan all changed files for:

- **Async bugs**: missing `await`, unhandled Promise rejections, race conditions between alarm callbacks and DB writes
- **Service worker lifecycle**: any state stored in module-level variables in `src/background/` (SW can be killed and restarted — state must go in IndexedDB or chrome.storage)
- **Dexie gotchas**: `db.table.add()` without catching unique constraint violations (hash field is unique — re-adding same hash throws), iterating live query results during modification
- **React issues**: missing deps in `useEffect`/`useCallback` dependency arrays, stale closures capturing old `messages` state in ClydeChat, `useLiveQuery` called conditionally
- **Null/undefined**: optional chaining missing on `c.id` before DB operations (many Dexie records have `id?: number`), `chrome.storage.local.get()` results cast without guards
- **Off-by-one / date math**: deadline comparison uses ISO string comparison (works only if format is consistent), TTL calculations in cleanup handler
- **Content script fragility**: hardcoded class names in `src/content/selectors.ts` that can break on Slack updates; missing null checks after `querySelector`

**Report format:**
```
[BUG] <description> — <file>:<line> — confidence: <N>
Reproduction: <how to trigger>
Fix: <suggested fix>
```

---

### Pass 3: Security Scan

Check for vulnerabilities specific to a Chrome extension that handles user workspace data and calls the Anthropic API:

- **API key exposure**: Is `anthropicApiKey` logged anywhere? Is it included in error messages? Is it accessible from content scripts?
- **XSS via Slack content**: Slack message text is inserted into the DOM — verify it goes through React (safe) not `innerHTML`/`dangerouslySetInnerHTML`
- **Content script injection**: Does `src/content/slack.ts` ever evaluate or execute content from the page?
- **Prompt injection**: Does Slack message text get directly interpolated into Claude system prompts without sanitization? Could a malicious Slack message manipulate Claude's response?
- **chrome.storage.local exposure**: All extension scripts can read `chrome.storage.local` — ensure no other sensitive credentials beyond the API key are stored there
- **Native messaging**: `native-host/` Python bridge — does it accept arbitrary commands from the extension? Is the host limited to read-only operations?
- **Manifest permissions**: Any new `host_permissions` or `permissions` added should be minimal and justified
- **Sensitive data logging**: Are any `original_quote` values or user profile data written to `console.log`?
- **Dependency supply chain**: Check `package.json` for any new dependencies added in this diff — are they from trusted sources?

**Report format:**
```
[SECURITY] <vulnerability class> — <file>:<line> — confidence: <N>
Impact: <what an attacker could do>
Fix: <suggested fix>
```

---

### Pass 4: Historical Context

Run git blame and log on the changed files:

```bash
git log --oneline -10 -- <each changed file>
git blame -L <start>,<end> <file>  # for complex changed sections
```

Check:
- Does this change conflict with a pattern recently established in the file?
- Was this code recently fixed for a specific bug that this change might reintroduce?
- Are there `// TODO` or `// FIXME` comments in the changed area that become more urgent?
- Does the commit message accurately describe what actually changed?

**Report format:**
```
[HISTORY] <concern> — <file> — confidence: <N>
Context: <relevant git history>
```

---

### Pass 5: Test Coverage

- Does the diff add new logic paths in `src/background/extractor.ts`, `src/background/batcher.ts`, `src/shared/constants.ts`, or `src/background/dedup.ts`? These files have existing tests — new branches should be tested.
- Were any existing test files modified in a way that weakens coverage?
- Run `npm run test` — report if any tests fail.
- For React component changes: note that there are no component tests (this is a known gap) — flag any particularly complex new component logic that is untested.
- For new Dexie migrations: the migration path from previous version is untested — flag this as a manual test requirement.

**Report format:**
```
[TEST] <untested path> — <file>:<line> — confidence: <N>
Recommendation: <what test to add>
```

---

**Step 4 — Compile final report**

Output a markdown report structured as:

```markdown
## Code Review Report — <branch name>

**Changed:** <N files>, <N lines> (+added / -removed)
**Threshold:** <REVIEW_THRESHOLD> (findings below this score omitted)

---

### 🔴 Critical (confidence ≥ 90)
<findings>

### 🟠 Significant (confidence 80–89)
<findings>

### ℹ️ Notes (confidence 50–79, informational only)
<findings — only include if explicitly requested>

---

### Summary
- Build: PASS / FAIL
- Tests: PASS / FAIL / NOT RUN
- Blocking issues: <N>
- Recommendation: APPROVE / REQUEST_CHANGES / NEEDS_DISCUSSION
```

If there are zero findings ≥ threshold, output:
```
✅ No issues found above confidence threshold <N>. Recommend APPROVE.
```
