# AI Code Review — Setup & Usage Guide

Clyde uses Claude Code for automated code review — both locally as slash commands and on every pull request via GitHub Actions.

## How it works

Reviews run as a **5-pass multi-agent analysis**:

| Pass | What it checks |
|------|----------------|
| CLAUDE.md Compliance | Import paths, inline styles, demo mode guards, service worker rules |
| Bug Detection | Async bugs, Dexie gotchas, React issues, null handling, SW state leakage |
| Security Scan | Prompt injection, API key exposure, XSS, manifest permissions, native host |
| Historical Context | Git blame patterns, recently fixed bugs, conflicting changes |
| Test Coverage | New logic paths in tested files, test regressions |

Each finding gets a **confidence score 0–100**:
- `50` = real but possibly a nitpick
- `75` = confirmed significant, double-checked
- `100` = absolute certainty with direct evidence

Only findings at or above the threshold are surfaced (default: **80** for code review, **75** for security review).

---

## Local Usage

### Prerequisites
- Claude Code CLI installed (`npm install -g @anthropic-ai/claude-code` or via Anthropic)
- Working on a branch (not `main`/`master` directly)

### `/review` — Full code review

Run from the repo root:
```
/review
```

This runs all 5 passes against your current branch vs. `main`. Output is a structured markdown report grouped by severity.

**Override threshold:**
```bash
REVIEW_THRESHOLD=70 /review   # surface lower-confidence findings too
REVIEW_THRESHOLD=95 /review   # only absolute certainties
```

### `/security-review` — Security-focused review

```
/security-review
```

Runs 8 security-specific checks:
1. Prompt injection via Slack content → Claude API
2. API key exposure (logging, serialization, content script access)
3. XSS via rendered user content
4. Manifest permission changes
5. Sensitive data in logs or error messages
6. Native messaging security
7. Dependency audit (`npm audit`)
8. chrome.storage.local access control

Security threshold is **75** — lower than the general review because security issues warrant earlier surfacing.

---

## GitHub Actions

Two workflows run automatically on PRs to `main`/`master`:

### `claude-code-review.yml` — General review

**Triggers:** All PRs to main/master (opened, synchronize, reopened)

**Skips automatically:**
- Draft PRs
- Bot PRs (dependabot, renovate, github-actions)
- PRs with the `skip-ai-review` label
- PRs under 5 lines changed (configurable via `MIN_REVIEW_LINES` env)
- Docs/CI-only changes (only `.md`, `.txt`, `docs/`, `.github/workflows/`)

**Override skip:** Add the `force-ai-review` label to force review regardless of skip rules.

**Phases:**
1. **Triage** (fast): Haiku-class check, evaluates skip conditions
2. **Build & Test**: `npm run typecheck` + `npm run build` + `npm run test` — must pass before review runs
3. **AI Review**: Full 5-pass review, posts inline PR comments + summary

**Review outcome:**
- `REQUEST_CHANGES` if any finding ≥ 90 confidence
- `COMMENT` (non-blocking) if findings 80–89
- `APPROVE` if no findings above threshold

### `claude-security-review.yml` — Security review

**Triggers:** PRs that touch security-sensitive paths:
```
src/background/extractor.ts
src/background/service-worker.ts
src/background/granola-local.ts
src/content/**
src/shared/db.ts
src/popup/components/ClydeChat.tsx
src/options/Options.tsx
manifest.json
native-host/**
package.json / package-lock.json
```

**Review outcome:**
- `REQUEST_CHANGES` if **any** finding ≥ 75 (lower bar than general review)
- `APPROVE` if no findings above 75

---

## Setup

### 1. Add the GitHub secret

```
GitHub repo → Settings → Secrets and variables → Actions → New repository secret
Name: ANTHROPIC_API_KEY
Value: sk-ant-...
```

### 2. Verify workflows are enabled

```
GitHub repo → Actions → Enable workflows (if prompted)
```

### 3. Test locally

```bash
git checkout -b test/review-check
echo "// test" >> src/shared/constants.ts
/review
```

---

## Tuning

### Change the confidence threshold

**Local (per-session):**
```bash
REVIEW_THRESHOLD=70 /review
```

**GitHub Actions:** Edit the `REVIEW_THRESHOLD` in `claude-code-review.yml`:
```yaml
prompt: |
  REVIEW_THRESHOLD=75
```

### Add new security-sensitive paths

Edit the `paths:` section in `.github/workflows/claude-security-review.yml`:
```yaml
paths:
  - 'src/background/new-risky-file.ts'
```

### Update review rules when conventions change

1. Update the relevant `CLAUDE.md` (root or subdirectory)
2. Update the checklist in Pass 1 of `.claude/commands/review.md` if the new rule needs an explicit check

### Add a new review pass

1. Open `.claude/commands/review.md`
2. Add a new `### Pass 6: <Name>` section following the same format
3. Add the pass to the output structure in the GitHub Actions prompt

---

## Cost estimates

| Review type | Model | Typical tokens | Estimated cost |
|-------------|-------|---------------|----------------|
| Triage only | Haiku | ~2K | ~$0.001 |
| Full build + review | Sonnet | ~15–40K | ~$0.05–$0.15 |
| Security review | Sonnet | ~10–20K | ~$0.03–$0.08 |

PRs that get skipped by triage cost < $0.01. Full reviews on typical PRs (< 300 lines) cost under $0.20.

---

## Troubleshooting

**"Review skipped — PR too small"**
Add the `force-ai-review` label to the PR.

**"No API key configured"**
Check that `ANTHROPIC_API_KEY` is set in GitHub Secrets (not variables).

**Review posts but with no findings**
The diff may not have triggered the security paths for security-review, or all findings were below threshold. Run `/review` locally for more verbose output.

**Build fails before review runs**
Fix the TypeScript error or failing test first — review won't run on a broken build.
