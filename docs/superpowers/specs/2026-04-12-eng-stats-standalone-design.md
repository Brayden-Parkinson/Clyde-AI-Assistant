# Eng Stats Standalone App — Design Spec

**Date:** 2026-04-12
**Status:** Approved
**Author:** Brayden Parkinson

## Problem

The Eng Stats feature currently lives inside the Clyde Chrome extension — a personal tool that only Brayden can use. Engineering leadership (managers, directors, VP, CTO) needs access to these metrics without installing a Chrome extension or configuring personal API tokens. The data should be centralized, pre-computed, and instantly available.

## Goal

Extract Eng Stats into a standalone web application that:
- Is accessible to all eng leadership via a URL
- Syncs data centrally (one org-level token, not per-user)
- Lives in its own repo so others can contribute
- Deploys without ongoing DevOps support
- Keeps all data within OpenSpace's AWS

## Non-Goals

- Modifying the Clyde Chrome extension (it stays untouched)
- Mobile responsiveness (eng leadership uses laptops)
- Demo mode (real internal tool, no fake data)
- Slack/Granola/Calendar features (those stay in Clyde)
- Custom alerting or notifications
- CSV/data export (can add later)

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                     Consumers                        │
│          (Eng managers, directors, VPs, CTO)         │
└──────────────────────┬──────────────────────────────┘
                       │ HTTPS
                       ▼
┌─────────────────────────────────────────────────────┐
│              Vercel (Next.js App)                     │
│  ┌──────────┐  ┌───────────┐  ┌──────────────────┐  │
│  │ Dashboard │  │ GitHub    │  │ Server-side      │  │
│  │ UI (React)│  │ OAuth     │  │ API routes       │  │
│  └──────────┘  └───────────┘  │ (proxy to AWS)   │  │
│                                └────────┬─────────┘  │
└─────────────────────────────────────────┼────────────┘
                                          │ HTTPS
                                          ▼
┌─────────────────────────── AWS VPC ─────────────────┐
│  ┌──────────────────────────────────────────────┐   │
│  │         API Gateway (public endpoint)         │   │
│  │         + API key / JWT validation            │   │
│  └──────────────────────┬───────────────────────┘   │
│                         ▼                            │
│  ┌──────────────────────────────────────────────┐   │
│  │      Lambda Functions (in VPC)                │   │
│  │  ┌─────────────┐    ┌──────────────────────┐ │   │
│  │  │ API handler  │    │ Sync job (scheduled) │ │   │
│  │  │ (read-only   │    │ GitHub API → RDS     │ │   │
│  │  │  queries)    │    │ Jira API → RDS       │ │   │
│  │  └──────┬──────┘    │ Copilot API → RDS    │ │   │
│  │         │            └──────────┬───────────┘ │   │
│  └─────────┼───────────────────────┼─────────────┘   │
│            ▼                       ▼                  │
│  ┌──────────────────────────────────────────────┐   │
│  │         RDS PostgreSQL (db.t4g.micro)         │   │
│  │   pr_metrics | copilot_metrics | jira_tickets │   │
│  │   ai_review_comments | pr_reviews | teams     │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

### Component Responsibilities

**Vercel (Next.js App)**
- Serves the dashboard UI (React, SSR where beneficial)
- Handles GitHub OAuth login + org membership verification
- API routes proxy authenticated requests to AWS API Gateway
- Push-to-deploy from GitHub, preview URLs on PRs

**API Gateway + Lambda (API handler)**
- Public HTTPS endpoint, secured with API key + JWT validation
- Read-only queries against RDS
- Returns JSON payloads for dashboard consumption
- Stateless — all data comes from the DB

**Lambda (Sync job)**
- Triggered by EventBridge schedule (every 6 hours)
- Pulls data from GitHub API, Jira API, GitHub Copilot API
- Uses org-level tokens stored in AWS Secrets Manager
- Incremental sync — tracks last cursor per repo/source in `sync_state` table
- Non-fatal error handling per-PR (same resilience as Clyde's `githubSync.ts`)

**RDS PostgreSQL**
- `db.t4g.micro` — sufficient for ~50 engineers' worth of metrics
- ~$15/month estimated cost
- Private subnet, accessible only from Lambda within VPC

---

## Data Model

### Tables

| Table | Key Columns | Source |
|-------|-------------|--------|
| `pr_metrics` | repo, pr_number, author, title, branch, created_at, merged_at, cycle_time_hrs, first_review_hrs, review_rounds, additions, deletions, ai_tools (text[]), ai_reviewers (text[]), is_revert | GitHub API |
| `pr_reviews` | repo, pr_number, reviewer, state, submitted_at, pr_author | GitHub API |
| `ai_review_comments` | repo, pr_number, tool, category, severity, body (max 2000 chars), file_path, created_at | GitHub API |
| `copilot_metrics` | date, total_active_users, total_engaged_users, total_chats, total_suggestions, total_acceptances, total_lines_suggested, total_lines_accepted, total_seats | GitHub Copilot API |
| `anthropic_usage` | date, user_id, user_email, model, input_tokens, output_tokens, total_tokens, cost_usd, tool_calls, sessions, metadata_json | Anthropic Analytics API (Enterprise) — **placeholder, sync stubbed until API access granted** |
| `jira_tickets` | key, summary, status, issue_type, component, priority, epic_key, assignee, resolved_at | Jira REST API |
| `pr_jira_links` | pr_metric_id, jira_ticket_key, source (title or branch) | Extracted during GitHub sync |
| `teams` | name, members (text[]) | Derived from Jira components (configurable) |
| `sync_state` | source, repo, last_synced_at, cursor | Internal bookkeeping |

### Indexes

- `pr_metrics`: unique on `(repo, pr_number)`, indexed on `repo`, `merged_at`, `author`
- `copilot_metrics`: unique on `date`
- `ai_review_comments`: indexed on `(repo, pr_number)`, `tool`, `category`, `created_at`
- `pr_reviews`: unique on `(repo, pr_number, reviewer, submitted_at)`
- `jira_tickets`: primary key on `key`
- `pr_jira_links`: indexed on `pr_metric_id`, `jira_ticket_key`
- `anthropic_usage`: indexed on `date`, `user_id`

### Sync Strategy

- Incremental — `sync_state` tracks the last sync timestamp per (source, repo)
- Fresh install backfills 360 days of history
- Dedup: upsert on `(repo, pr_number)` for PRs, upsert on `date` for Copilot metrics
- AI review comment classification runs in Lambda (regex-based, same logic as Clyde's `classifyReviewComment`)
- Errors are non-fatal per-PR — a single failed PR enrichment doesn't block the rest
- Rate limit handling: on 429/403, stop enrichment for that repo, resume next sync cycle

---

## Frontend

### Tech Stack

- Next.js 15 (App Router)
- React 18, TypeScript
- Tailwind CSS
- Recharts (chart library — same as Clyde)
- React Query (data fetching + caching)
- next-auth (GitHub OAuth provider)

### Pages

| Route | Content | Ported From |
|-------|---------|-------------|
| `/` | KPI cards, cycle time trend, AI adoption trend, PR size distribution, backlog projection | `SummaryTab.tsx` |
| `/cycle-time` | Weekly averages, LOC stats, AI impact, component breakdown, developer insights, productivity matrix | `CycleTimeTab.tsx` + `cycle-time/*` |
| `/ai-adoption` | Adoption score (0-100), author/team tiers, Copilot metrics, tool matrix, action items | `AIAdoptionTab.tsx` |
| `/ai-reviews` | Comments by tool/category/severity, per-author/team analysis, weekly trends | `AIReviewsTab.tsx` |
| `/teams` | Sortable team table, expandable rows with cycle time details + PR size distribution | `TeamsTab.tsx` |
| `/settings` | Repo configuration, team mappings, sync status + manual trigger | New |

### Directly Portable Code (Pure Functions)

These modules have zero Chrome extension dependencies and port as-is:

- `shared.ts` — computation helpers, color maps, type definitions
- `aiAdoptionScore.ts` — 3-pillar scoring algorithm (utilization, impact, quality)
- `productivityScore.ts` — 4-dimension scoring (velocity, quality, impact, collaboration)
- `charts.tsx` — chart components (CycleTimeChart, AIAdoptionChart, PRSizeChart, PRFlowChart, ScoreGauge)
- All tab rendering logic — components already receive data as `TabProps`

### What Changes

| Clyde (Chrome Extension) | Eng Stats (Standalone) |
|--------------------------|----------------------|
| `useLiveQuery()` (Dexie reactive) | React Query hooks fetching from API |
| `chrome.storage.local` config | Server-side config via `/settings` page |
| Chrome extension tab bar | Next.js sidebar with route links |
| Popup-width constrained layout | Full-page responsive layout |
| Inline styles (OS tokens) | Tailwind CSS |
| Filters in component state | URL search params (shareable links) |

### Auth Flow

1. User visits the app → redirected to GitHub OAuth consent screen
2. GitHub returns with auth code → Next.js API route exchanges for token
3. Server verifies user is a member of `openspacelabs` GitHub org
4. Session stored as secure HTTP-only cookie via next-auth
5. All API requests include session; Lambda validates before returning data
6. Non-org members see a "Request access" message

---

## Repository Structure

New repo: `openspacelabs/eng-stats`

```
eng-stats/
├── src/
│   ├── app/                  # Next.js App Router pages
│   │   ├── layout.tsx        # Root layout (sidebar, header, auth gate)
│   │   ├── page.tsx          # Dashboard (Summary)
│   │   ├── cycle-time/
│   │   ├── ai-adoption/
│   │   ├── ai-reviews/
│   │   ├── teams/
│   │   └── settings/
│   ├── components/           # React components (ported from Clyde eng-stats/)
│   │   ├── charts/           # Recharts wrappers
│   │   ├── kpi-cards/
│   │   └── tables/
│   ├── lib/
│   │   ├── scoring/          # aiAdoptionScore.ts, productivityScore.ts
│   │   ├── api/              # React Query hooks + typed API client
│   │   ├── auth/             # next-auth GitHub provider config
│   │   └── shared/           # Types, constants, helpers (from Clyde shared.ts)
│   └── styles/               # Tailwind config + globals
├── lambda/
│   ├── api/                  # API handler Lambda source
│   ├── sync/                 # Sync job Lambda source
│   └── shared/               # DB client (pg), types, Secrets Manager helpers
├── infra/                    # Terraform for one-time AWS setup
│   ├── main.tf               # RDS, Lambda, API Gateway, Secrets Manager
│   ├── variables.tf
│   └── outputs.tf
├── .github/
│   └── workflows/
│       ├── ci.yml            # Lint + type-check on PR
│       └── deploy-lambda.yml # Zip + deploy Lambdas on merge to main
├── vercel.json
├── package.json
├── tsconfig.json
└── README.md
```

---

## Deployment

### Frontend (Vercel)

- Connect `openspacelabs/eng-stats` repo to Vercel
- Push to `main` → auto-deploys to production
- PR branches get preview URLs (great for reviewing UI changes)
- Env vars in Vercel dashboard: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `NEXTAUTH_SECRET`, `AWS_API_GATEWAY_URL`, `AWS_API_KEY`

### Lambdas (GitHub Actions)

- On merge to `main`, a GitHub Action:
  1. Bundles `lambda/api/` and `lambda/sync/` into zip files
  2. Deploys to AWS Lambda via AWS CLI
  3. Uses OIDC federation for auth (no long-lived AWS keys in GitHub secrets)
- ~20 line workflow file

### Infrastructure (One-Time DevOps Ask)

The `infra/` directory contains Terraform to create:
- RDS PostgreSQL instance (`db.t4g.micro`, private subnet)
- Two Lambda functions (API handler + sync job)
- API Gateway (public endpoint, API key auth)
- EventBridge rule (triggers sync Lambda every 6 hours)
- Secrets Manager entries (GitHub PAT, Jira API token)
- IAM roles for Lambda execution + VPC access
- Security groups (Lambda → RDS only)

**The ask to DevOps:**
> "I need these resources provisioned in the tooling AWS account. Here's the Terraform — can you review and apply, or grant me access to apply it in the tooling account?"

After initial provisioning, no further DevOps involvement is needed.

---

## Migration Path

1. **Build the app** — new repo, port components, implement Lambda sync
2. **Provision AWS infra** — one-time DevOps ask with prepared Terraform
3. **Backfill data** — run sync Lambda with 360-day lookback
4. **Deploy to Vercel** — connect repo, configure env vars
5. **Share URL with eng leadership** — announce in Slack
6. **Optionally sunset Clyde Eng Stats** — separate decision, separate PR, no rush

---

## Cost Estimate

| Resource | Monthly Cost |
|----------|-------------|
| RDS `db.t4g.micro` (Postgres) | ~$15 |
| Lambda (API + sync, minimal invocations) | ~$1 |
| API Gateway (low traffic) | ~$1 |
| Secrets Manager (2 secrets) | ~$1 |
| Vercel (Pro plan, likely already have one) | $0 incremental |
| **Total** | **~$18/month** |

---

## Open Questions (Resolved)

| Question | Decision |
|----------|----------|
| Where to host frontend? | Vercel (already vendor-approved) |
| Where to store data? | AWS RDS PostgreSQL (data stays in AWS) |
| Auth mechanism? | GitHub OAuth, gated to `openspacelabs` org |
| Who are the users? | Eng leadership with GitHub access |
| Client-side or server-side sync? | Server-side (Lambda on schedule) |
| Change Clyde? | No — new repo, new app, Clyde untouched |
| Anthropic analytics? | Placeholder table + stubbed sync for future Enterprise API |
