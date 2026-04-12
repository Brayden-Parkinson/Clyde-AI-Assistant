# Eng Stats Standalone App — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the Eng Stats feature from the Clyde Chrome extension into a standalone Next.js web app with a server-side sync backend on AWS Lambda + RDS PostgreSQL.

**Architecture:** Vercel hosts a Next.js frontend with GitHub OAuth. API Gateway + Lambda in AWS VPC serves read-only queries from RDS PostgreSQL. A scheduled Lambda syncs data from GitHub/Jira APIs every 6 hours. Pure computation functions (scoring, aggregation) are ported directly from the Clyde codebase.

**Tech Stack:** Next.js 15 (App Router), React 18, TypeScript, Tailwind CSS, Recharts, React Query, next-auth, AWS Lambda, API Gateway, RDS PostgreSQL, Terraform

**Source Codebase (read-only reference):** `/Users/braydenparkinson/Clyde-AI-Assistant/` — the Clyde Chrome extension. Many modules are ported from here. When a task says "port from `<path>`", read that file and adapt as described.

---

## File Structure

```
eng-stats/
├── src/
│   ├── app/
│   │   ├── layout.tsx                 # Root layout: sidebar, header, auth gate
│   │   ├── page.tsx                   # Summary dashboard (/)
│   │   ├── cycle-time/page.tsx        # Cycle time analysis
│   │   ├── ai-adoption/page.tsx       # AI adoption dashboard
│   │   ├── ai-reviews/page.tsx        # AI review comments
│   │   ├── teams/page.tsx             # Team metrics table
│   │   ├── settings/page.tsx          # Config + sync controls
│   │   └── api/auth/[...nextauth]/route.ts  # next-auth handler
│   ├── components/
│   │   ├── Sidebar.tsx                # Nav sidebar with route links
│   │   ├── Header.tsx                 # Time range + repo filter bar
│   │   ├── KPICard.tsx                # Metric card component
│   │   ├── charts/
│   │   │   ├── CycleTimeChart.tsx
│   │   │   ├── AIAdoptionChart.tsx
│   │   │   ├── PRSizeChart.tsx
│   │   │   ├── PRFlowChart.tsx
│   │   │   ├── ScoreGauge.tsx
│   │   │   └── InfoTip.tsx
│   │   ├── cycle-time/
│   │   │   ├── LOCStats.tsx
│   │   │   ├── AIImpactSection.tsx
│   │   │   ├── ComponentBreakdown.tsx
│   │   │   ├── PersonInsights.tsx
│   │   │   └── ProductivityMatrix.tsx
│   │   └── tables/
│   │       └── SortableTable.tsx       # Reusable sortable table
│   ├── lib/
│   │   ├── types.ts                   # All shared TypeScript interfaces
│   │   ├── constants.ts               # Bot lists, known tools, config defaults
│   │   ├── scoring/
│   │   │   ├── aiAdoptionScore.ts     # AI adoption 0-100 scoring
│   │   │   └── productivityScore.ts   # 4-dimension developer scoring
│   │   ├── compute/
│   │   │   ├── shared.ts              # weekBuckets, personRows, teamRows, etc.
│   │   │   └── helpers.ts             # median, fmtHours, linearRegression, etc.
│   │   ├── api/
│   │   │   ├── client.ts              # Typed fetch wrapper for AWS API Gateway
│   │   │   └── hooks.ts              # React Query hooks for each endpoint
│   │   └── auth/
│   │       └── auth.ts                # next-auth config (GitHub provider)
│   └── styles/
│       └── globals.css                # Tailwind directives
├── lambda/
│   ├── api/
│   │   ├── handler.ts                 # API Gateway Lambda handler (read queries)
│   │   ├── routes.ts                  # Route dispatch
│   │   └── queries.ts                 # SQL query functions
│   ├── sync/
│   │   ├── handler.ts                 # EventBridge-triggered sync Lambda
│   │   ├── githubClient.ts            # GitHub API wrapper (ported)
│   │   ├── githubSync.ts              # Sync orchestration (ported)
│   │   ├── jiraClient.ts              # Jira API wrapper (ported)
│   │   ├── jiraSync.ts                # Jira sync orchestration (ported)
│   │   └── classify.ts                # AI review comment classification
│   └── shared/
│       ├── db.ts                      # pg Pool + query helpers
│       ├── secrets.ts                 # AWS Secrets Manager client
│       └── types.ts                   # Shared DB row types
├── migrations/
│   └── 001_initial.sql                # Full schema DDL
├── infra/
│   ├── main.tf
│   ├── variables.tf
│   └── outputs.tf
├── .github/
│   └── workflows/
│       ├── ci.yml
│       └── deploy-lambda.yml
├── vercel.json
├── package.json
├── tsconfig.json
├── tsconfig.lambda.json
├── tailwind.config.ts
├── next.config.ts
└── README.md
```

---

## Task 1: Project Scaffold

**Files:**
- Create: `eng-stats/package.json`
- Create: `eng-stats/tsconfig.json`
- Create: `eng-stats/tsconfig.lambda.json`
- Create: `eng-stats/tailwind.config.ts`
- Create: `eng-stats/next.config.ts`
- Create: `eng-stats/src/styles/globals.css`
- Create: `eng-stats/src/app/layout.tsx`
- Create: `eng-stats/src/app/page.tsx`

**Important:** This new project is created in a **separate directory** from the Clyde codebase. Create it at `~/eng-stats/` (or wherever the user prefers). Do NOT modify anything in the Clyde repo.

- [ ] **Step 1: Initialize the project**

```bash
cd ~
npx create-next-app@latest eng-stats \
  --typescript \
  --tailwind \
  --eslint \
  --app \
  --src-dir \
  --import-alias "@/*" \
  --no-turbopack
cd eng-stats
```

- [ ] **Step 2: Install dependencies**

```bash
npm install recharts @tanstack/react-query next-auth@beta @auth/core
npm install -D @types/node
```

- [ ] **Step 3: Install Lambda dependencies**

```bash
npm install pg @aws-sdk/client-secrets-manager
npm install -D @types/pg esbuild
```

- [ ] **Step 4: Configure TypeScript for Lambda**

Create `tsconfig.lambda.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "./lambda/dist",
    "rootDir": "./lambda",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": false,
    "sourceMap": true
  },
  "include": ["lambda/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 5: Add build scripts to package.json**

Add to `scripts` in `package.json`:

```json
{
  "build:lambda:api": "esbuild lambda/api/handler.ts --bundle --platform=node --target=node20 --outfile=lambda/dist/api/handler.js --external:pg-native",
  "build:lambda:sync": "esbuild lambda/sync/handler.ts --bundle --platform=node --target=node20 --outfile=lambda/dist/sync/handler.js --external:pg-native",
  "build:lambda": "npm run build:lambda:api && npm run build:lambda:sync",
  "typecheck": "tsc --noEmit && tsc --noEmit -p tsconfig.lambda.json"
}
```

- [ ] **Step 6: Create minimal layout with Tailwind**

Replace `src/app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Eng Stats — OpenSpace",
  description: "Engineering metrics dashboard",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-gray-50 text-gray-900 antialiased">{children}</body>
    </html>
  );
}
```

- [ ] **Step 7: Create placeholder home page**

Replace `src/app/page.tsx`:

```tsx
export default function Home() {
  return (
    <main className="flex items-center justify-center min-h-screen">
      <h1 className="text-2xl font-semibold">Eng Stats</h1>
    </main>
  );
}
```

- [ ] **Step 8: Verify the scaffold builds**

```bash
npm run build
```

Expected: Build succeeds, no errors.

- [ ] **Step 9: Initialize git and commit**

```bash
git init
git add -A
git commit -m "feat: scaffold Next.js project with Tailwind, Recharts, React Query"
```

---

## Task 2: Shared Types & Constants

**Files:**
- Create: `src/lib/types.ts`
- Create: `src/lib/constants.ts`
- Create: `lambda/shared/types.ts`
- Port from: `/Users/braydenparkinson/Clyde-AI-Assistant/src/shared/types.ts` (lines 657-765)
- Port from: `/Users/braydenparkinson/Clyde-AI-Assistant/src/shared/constants.ts`

- [ ] **Step 1: Create the shared types file**

Create `src/lib/types.ts`. Port all interfaces from the Clyde `src/shared/types.ts` file (PRMetric, AIReviewComment, JiraTicket, CopilotDailyMetric, PRJiraLink, PRReview, OpenPRSnapshot). Changes from the Clyde version:

- Remove the `id?: number` auto-increment fields (Postgres handles this with `SERIAL`)
- Add `id: number` as a required field (returned from DB queries)
- Add the `AnthropicUsage` interface (new placeholder)

```typescript
// ─── PR Metrics ───
export interface PRMetric {
  id: number;
  repo: string;
  prNumber: number;
  title: string;
  branch: string | null;
  author: string | null;
  createdAt: string;
  mergedAt: string | null;
  cycleTimeHours: number | null;
  timeToFirstReviewHours: number | null;
  reviewRounds: number;
  additions: number;
  deletions: number;
  changedFiles: number;
  aiAssisted: boolean;
  aiTools: string[];
  aiReviewers: string[];
  isRevert: boolean;
  revertedPrNumber: number | null;
  syncedAt: string;
}

// ─── AI Review Comments ───
export interface AIReviewComment {
  id: number;
  repo: string;
  prNumber: number;
  prAuthor: string | null;
  tool: string;
  body: string;
  category: string;
  severity: string;
  filePath: string | null;
  createdAt: string;
  syncedAt: string;
}

// ─── Jira Tickets ───
export interface JiraTicket {
  id: number;
  key: string;
  summary: string;
  status: string;
  statusCategory: "todo" | "in_progress" | "done";
  issueType: string;
  component: string | null;
  priority: string;
  epicKey: string | null;
  projectKey: string;
  createdAt: string;
  updatedAt: string;
  assigneeEmail: string | null;
  assigneeDisplayName: string | null;
  resolvedAt: string | null;
  syncedAt: string;
}

// ─── PR-Jira Links ───
export interface PRJiraLink {
  id: number;
  prMetricId: number;
  jiraTicketKey: string;
  source: "title" | "branch";
  linkedAt: string;
}

// ─── Copilot Metrics ───
export interface CopilotDailyMetric {
  id: number;
  date: string;
  totalActiveUsers: number;
  totalEngagedUsers: number;
  totalChats: number;
  totalSuggestions: number;
  totalAcceptances: number;
  totalLinesSuggested: number;
  totalLinesAccepted: number;
  totalSeats: number | null;
  syncedAt: string;
}

// ─── PR Reviews ───
export interface PRReview {
  id: number;
  repo: string;
  prNumber: number;
  reviewer: string;
  prAuthor: string | null;
  state: string;
  submittedAt: string;
  syncedAt: string;
}

// ─── Open PR Snapshots ───
export interface OpenPRSnapshot {
  id: number;
  repo: string;
  openCount: number;
  snapshotAt: string;
}

// ─── Anthropic Usage (placeholder) ───
export interface AnthropicUsage {
  id: number;
  date: string;
  userId: string;
  userEmail: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  toolCalls: number;
  sessions: number;
  metadataJson: Record<string, unknown> | null;
  syncedAt: string;
}

// ─── Sync State ───
export interface SyncState {
  id: number;
  source: string;
  repo: string;
  lastSyncedAt: string;
  cursor: string | null;
}

// ─── Display/Computed Types ───
export interface WeekBucket {
  label: string;
  avgHours: number;
  count: number;
}

export interface TeamRow {
  team: string;
  prCount: number;
  avgCycleHours: number | null;
  medReviewHours: number | null;
  avgSize: number;
  aiPctTeam: number;
}

export interface AuthorAIRow {
  author: string;
  total: number;
  ai: number;
  pct: number;
  toolCounts: [string, number][];
  tools: string[];
  avgCycleHours: number | null;
  avgSize: number;
}

export interface PersonRow {
  author: string;
  prCount: number;
  prsPerWeek: number;
  avgCycleHours: number | null;
  medCycleHours: number | null;
  totalAdditions: number;
  totalDeletions: number;
  totalLOC: number;
  avgPRSize: number;
  aiPct: number;
  avgReviewDays: number;
  weeklyTrend: number[];
  primaryTeam: string | null;
  scores: ProductivityScores | null;
}

export interface ProductivityScores {
  velocity: number;
  quality: number;
  impact: number;
  collaboration: number;
  overall: number;
}

export interface ComponentCycleRow {
  component: string;
  prCount: number;
  avgCycleHours: number | null;
  medCycleHours: number | null;
  avgFirstReviewHours: number | null;
  avgReviewDays: number;
  avgSize: number;
  aiPct: number;
  weeklyTrend: number[];
  prsByType: Record<string, number>;
}

export interface CycleTimeAIComparison {
  aiPRs: { count: number; avgCycleHours: number; avgFirstReviewHours: number; avgSize: number };
  nonAIPRs: { count: number; avgCycleHours: number; avgFirstReviewHours: number; avgSize: number };
  cycleTimeDeltaPct: number;
  firstReviewDeltaPct: number;
}

export interface LOCStatsData {
  totalAdditions: number;
  totalDeletions: number;
  netLOC: number;
  totalPRs: number;
  avgPRSize: number;
  medPRSize: number;
  prsPerWeek: number;
  prSizeBuckets: { label: string; count: number; color: string }[];
  weeklyLOC: { label: string; additions: number; deletions: number }[];
  weeklyPRCount: { label: string; count: number }[];
}

export interface MatrixPoint {
  author: string;
  x: number;
  y: number;
  size: number;
  aiPct: number;
}
```

- [ ] **Step 2: Create constants file**

Create `src/lib/constants.ts`. Port `isBotAuthor`, `KNOWN_BOT_LOGINS`, and `AI_BOT_AUTHORS` from Clyde's `src/shared/constants.ts`. Also include the tool/category color maps from Clyde's `src/popup/components/eng-stats/shared.ts`:

```typescript
export const KNOWN_BOT_LOGINS = new Set([
  "dependabot[bot]",
  "renovate[bot]",
  "github-actions[bot]",
  "snyk-bot",
  "greenkeeper[bot]",
  "codecov[bot]",
  "stale[bot]",
  "openspace-bot",
  // Copy the full set from Clyde's src/shared/constants.ts
]);

export function isBotAuthor(author: string): boolean {
  return KNOWN_BOT_LOGINS.has(author) || author.endsWith("[bot]");
}

export const PR_SIZE_BUCKETS = [
  { label: "S (<194)", max: 194, color: "#10B981" },
  { label: "M (194–400)", max: 400, color: "#3B82F6" },
  { label: "L (400–800)", max: 800, color: "#F97316" },
  { label: "XL (800+)", max: Infinity, color: "#EF4444" },
] as const;

export const toolColors: Record<string, string> = {
  claude: "#D97706",
  copilot: "#2EA043",
  cursor: "#7C3AED",
  coderabbit: "#0891B2",
  aider: "#F59E0B",
  devin: "#EC4899",
  codex: "#10B981",
  "amazon-q": "#FF9900",
  sweep: "#6366F1",
  windsurf: "#06B6D4",
};

export const categoryColors: Record<string, string> = {
  bug: "#EF4444",
  security: "#F59E0B",
  "type-safety": "#8B5CF6",
  perf: "#F97316",
  logic: "#3B82F6",
  style: "#6B7280",
  other: "#9CA3AF",
};

export const DEFAULT_LOOKBACK_DAYS = 360;
export const SYNC_INTERVAL_HOURS = 6;
```

- [ ] **Step 3: Create Lambda shared types**

Create `lambda/shared/types.ts` — DB row types matching Postgres snake_case columns:

```typescript
export interface PRMetricRow {
  id: number;
  repo: string;
  pr_number: number;
  title: string;
  branch: string | null;
  author: string | null;
  created_at: string;
  merged_at: string | null;
  cycle_time_hours: number | null;
  time_to_first_review_hours: number | null;
  review_rounds: number;
  additions: number;
  deletions: number;
  changed_files: number;
  ai_assisted: boolean;
  ai_tools: string[];
  ai_reviewers: string[];
  is_revert: boolean;
  reverted_pr_number: number | null;
  synced_at: string;
}

// Repeat for all tables — these map 1:1 to the SQL schema in Task 3.
// Include: AIReviewCommentRow, JiraTicketRow, CopilotDailyMetricRow,
// PRReviewRow, PRJiraLinkRow, OpenPRSnapshotRow, AnthropicUsageRow, SyncStateRow

export function toCamelCase<T>(row: Record<string, unknown>): T {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    const camelKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    result[camelKey] = value;
  }
  return result as T;
}
```

- [ ] **Step 4: Verify typecheck passes**

```bash
npm run typecheck
```

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/types.ts src/lib/constants.ts lambda/shared/types.ts
git commit -m "feat: add shared types and constants"
```

---

## Task 3: Database Schema

**Files:**
- Create: `migrations/001_initial.sql`
- Create: `lambda/shared/db.ts`
- Create: `lambda/shared/secrets.ts`

- [ ] **Step 1: Write the SQL migration**

Create `migrations/001_initial.sql`:

```sql
-- Eng Stats database schema

CREATE TABLE IF NOT EXISTS pr_metrics (
  id SERIAL PRIMARY KEY,
  repo TEXT NOT NULL,
  pr_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  branch TEXT,
  author TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  merged_at TIMESTAMPTZ,
  cycle_time_hours REAL,
  time_to_first_review_hours REAL,
  review_rounds INTEGER NOT NULL DEFAULT 0,
  additions INTEGER NOT NULL DEFAULT 0,
  deletions INTEGER NOT NULL DEFAULT 0,
  changed_files INTEGER NOT NULL DEFAULT 0,
  ai_assisted BOOLEAN NOT NULL DEFAULT FALSE,
  ai_tools TEXT[] NOT NULL DEFAULT '{}',
  ai_reviewers TEXT[] NOT NULL DEFAULT '{}',
  is_revert BOOLEAN NOT NULL DEFAULT FALSE,
  reverted_pr_number INTEGER,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (repo, pr_number)
);
CREATE INDEX idx_pr_metrics_repo ON pr_metrics (repo);
CREATE INDEX idx_pr_metrics_merged_at ON pr_metrics (merged_at);
CREATE INDEX idx_pr_metrics_author ON pr_metrics (author);

CREATE TABLE IF NOT EXISTS pr_reviews (
  id SERIAL PRIMARY KEY,
  repo TEXT NOT NULL,
  pr_number INTEGER NOT NULL,
  reviewer TEXT NOT NULL,
  pr_author TEXT,
  state TEXT NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (repo, pr_number, reviewer, submitted_at)
);

CREATE TABLE IF NOT EXISTS ai_review_comments (
  id SERIAL PRIMARY KEY,
  repo TEXT NOT NULL,
  pr_number INTEGER NOT NULL,
  pr_author TEXT,
  tool TEXT NOT NULL,
  body TEXT NOT NULL,
  category TEXT NOT NULL,
  severity TEXT NOT NULL,
  file_path TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_ai_review_repo_pr ON ai_review_comments (repo, pr_number);
CREATE INDEX idx_ai_review_tool ON ai_review_comments (tool);
CREATE INDEX idx_ai_review_category ON ai_review_comments (category);
CREATE INDEX idx_ai_review_created ON ai_review_comments (created_at);

CREATE TABLE IF NOT EXISTS copilot_metrics (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL UNIQUE,
  total_active_users INTEGER NOT NULL DEFAULT 0,
  total_engaged_users INTEGER NOT NULL DEFAULT 0,
  total_chats INTEGER NOT NULL DEFAULT 0,
  total_suggestions INTEGER NOT NULL DEFAULT 0,
  total_acceptances INTEGER NOT NULL DEFAULT 0,
  total_lines_suggested INTEGER NOT NULL DEFAULT 0,
  total_lines_accepted INTEGER NOT NULL DEFAULT 0,
  total_seats INTEGER,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS anthropic_usage (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,
  user_id TEXT NOT NULL,
  user_email TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  tool_calls INTEGER NOT NULL DEFAULT 0,
  sessions INTEGER NOT NULL DEFAULT 0,
  metadata_json JSONB,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_anthropic_date ON anthropic_usage (date);
CREATE INDEX idx_anthropic_user ON anthropic_usage (user_id);

CREATE TABLE IF NOT EXISTS jira_tickets (
  id SERIAL PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  summary TEXT NOT NULL,
  status TEXT NOT NULL,
  status_category TEXT NOT NULL,
  issue_type TEXT NOT NULL,
  component TEXT,
  priority TEXT NOT NULL,
  epic_key TEXT,
  project_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  assignee_email TEXT,
  assignee_display_name TEXT,
  resolved_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pr_jira_links (
  id SERIAL PRIMARY KEY,
  pr_metric_id INTEGER NOT NULL REFERENCES pr_metrics(id) ON DELETE CASCADE,
  jira_ticket_key TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('title', 'branch')),
  linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_pr_jira_pr ON pr_jira_links (pr_metric_id);
CREATE INDEX idx_pr_jira_ticket ON pr_jira_links (jira_ticket_key);

CREATE TABLE IF NOT EXISTS teams (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  members TEXT[] NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS sync_state (
  id SERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  repo TEXT NOT NULL DEFAULT '',
  last_synced_at TIMESTAMPTZ NOT NULL,
  cursor TEXT,
  UNIQUE (source, repo)
);

CREATE TABLE IF NOT EXISTS open_pr_snapshots (
  id SERIAL PRIMARY KEY,
  repo TEXT NOT NULL,
  open_count INTEGER NOT NULL,
  snapshot_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

- [ ] **Step 2: Create the database client**

Create `lambda/shared/db.ts`:

```typescript
import { Pool, type QueryResult } from "pg";

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT || 5432),
      database: process.env.DB_NAME || "eng_stats",
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : undefined,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
  }
  return pool;
}

export async function query<T>(sql: string, params?: unknown[]): Promise<T[]> {
  const result: QueryResult<T> = await getPool().query(sql, params);
  return result.rows;
}

export async function queryOne<T>(sql: string, params?: unknown[]): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

export async function execute(sql: string, params?: unknown[]): Promise<number> {
  const result = await getPool().query(sql, params);
  return result.rowCount ?? 0;
}
```

- [ ] **Step 3: Create the Secrets Manager helper**

Create `lambda/shared/secrets.ts`:

```typescript
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

const client = new SecretsManagerClient({});
const cache = new Map<string, { value: string; expiresAt: number }>();
const TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function getSecret(secretId: string): Promise<string> {
  const cached = cache.get(secretId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const response = await client.send(
    new GetSecretValueCommand({ SecretId: secretId })
  );
  const value = response.SecretString ?? "";
  cache.set(secretId, { value, expiresAt: Date.now() + TTL_MS });
  return value;
}

export interface EngStatsSecrets {
  githubToken: string;
  githubOrg: string;
  githubRepos: string[];
  jiraHost: string;
  jiraEmail: string;
  jiraApiToken: string;
  jiraProjectKeys: string[];
}

export async function getEngStatsSecrets(): Promise<EngStatsSecrets> {
  const raw = await getSecret(process.env.SECRETS_ID || "eng-stats/config");
  return JSON.parse(raw);
}
```

- [ ] **Step 4: Commit**

```bash
git add migrations/ lambda/shared/
git commit -m "feat: add database schema, pg client, and secrets helper"
```

---

## Task 4: Sync Lambda — GitHub Client

**Files:**
- Create: `lambda/sync/githubClient.ts`
- Create: `lambda/sync/classify.ts`
- Port from: `/Users/braydenparkinson/Clyde-AI-Assistant/src/background/githubClient.ts`

- [ ] **Step 1: Port the GitHub client**

Create `lambda/sync/githubClient.ts`. Copy the entire file from Clyde's `src/background/githubClient.ts` and make these changes:

1. **Remove all Chrome extension imports** — no `@shared/constants`, no `@shared/types`. Import from `../shared/types` instead.
2. **Remove PR Inbox functions** — `fetchGitHubUser`, `fetchPRFullDetail`, `searchPRsForUser` are not needed (they're for Clyde's PR inbox, not Eng Stats).
3. **Keep all Eng Stats functions:** `fetchMergedPRs`, `fetchPRDetails`, `fetchPRReviews`, `fetchPRCommits`, `fetchPRReviewComments`, `fetchReleases`, `fetchCopilotMetrics`, `fetchCopilotBilling`, `fetchOpenPRs`
4. **Keep all detection functions:** `detectAITools`, `detectAIReviewers`, `detectRevert`, `getAIReviewTool`, `classifyReviewComment`, `aggregateCopilotCompletions`, `isBot`
5. **Keep all constants:** `AI_PATTERNS`, `AI_REVIEW_BOTS`, `REVERT_TITLE_PATTERN`, `REVERT_BODY_PATTERN`
6. **Copy `KNOWN_BOT_LOGINS` and `AI_BOT_AUTHORS`** inline (from Clyde's `src/shared/constants.ts`) so the Lambda has no frontend dependencies.
7. **Replace `ghFetch` pagination** — it should work as-is since it's just `fetch()` calls, but verify there are no Chrome-specific APIs (there shouldn't be).

The file should export all functions listed above. No Chrome APIs, no Dexie, no imports from `src/`.

- [ ] **Step 2: Extract classify into its own module**

Create `lambda/sync/classify.ts` — move `classifyReviewComment` and `getAIReviewTool` into a separate file for clarity:

```typescript
const AI_REVIEW_BOTS = new Map<string, string>([
  // Copy full map from githubClient.ts
]);

export function getAIReviewTool(login: string): string | null {
  return AI_REVIEW_BOTS.get(login.toLowerCase()) ?? null;
}

// Copy the full classifyReviewComment function from githubClient.ts
export function classifyReviewComment(
  tool: string,
  body: string,
): { category: string; severity: string } {
  // ... exact copy from Clyde
}
```

- [ ] **Step 3: Verify Lambda typecheck**

```bash
npx tsc --noEmit -p tsconfig.lambda.json
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add lambda/sync/githubClient.ts lambda/sync/classify.ts
git commit -m "feat: port GitHub client and comment classifier to Lambda"
```

---

## Task 5: Sync Lambda — Jira Client

**Files:**
- Create: `lambda/sync/jiraClient.ts`
- Create: `lambda/sync/jiraSync.ts`
- Port from: `/Users/braydenparkinson/Clyde-AI-Assistant/src/background/jiraClient.ts`
- Port from: `/Users/braydenparkinson/Clyde-AI-Assistant/src/background/jiraSync.ts`

- [ ] **Step 1: Port the Jira client**

Create `lambda/sync/jiraClient.ts`. Read Clyde's `src/background/jiraClient.ts` and port it:

1. Remove Chrome extension imports
2. Keep all Jira REST API v3 functions for fetching issues, searching by JQL
3. Auth uses Basic auth (email + API token) — same as Clyde, but credentials come from Secrets Manager instead of `chrome.storage.local`
4. The client should accept credentials as function parameters (not read from storage)

Key functions to port:
- `fetchJiraIssues(host, email, token, projectKey, since)` — paginated JQL search
- `fetchJiraIssue(host, email, token, key)` — single issue detail
- Jira ticket → `JiraTicket` mapping (extract component, status category, etc.)

- [ ] **Step 2: Port the Jira sync orchestration**

Create `lambda/sync/jiraSync.ts`. Read Clyde's `src/background/jiraSync.ts` and port it:

1. Replace `db.jira_tickets.put()` with SQL `INSERT ... ON CONFLICT (key) DO UPDATE`
2. Replace `chrome.storage.local` reads with function parameters
3. Track sync state in `sync_state` table instead of `chrome.storage.local`
4. Return a summary: `{ synced: number; errors: string[] }`

```typescript
import { query, execute } from "../shared/db";
import { fetchJiraIssues } from "./jiraClient";

export async function syncJiraData(config: {
  host: string;
  email: string;
  token: string;
  projectKeys: string[];
}): Promise<{ synced: number; errors: string[] }> {
  // For each project key:
  //   1. Read last_synced_at from sync_state WHERE source='jira' AND repo=projectKey
  //   2. Fetch issues updated since then (or 360 days lookback)
  //   3. Upsert into jira_tickets
  //   4. Update sync_state
  // Return summary
}
```

- [ ] **Step 3: Verify Lambda typecheck**

```bash
npx tsc --noEmit -p tsconfig.lambda.json
```

- [ ] **Step 4: Commit**

```bash
git add lambda/sync/jiraClient.ts lambda/sync/jiraSync.ts
git commit -m "feat: port Jira client and sync to Lambda"
```

---

## Task 6: Sync Lambda — Orchestrator

**Files:**
- Create: `lambda/sync/githubSync.ts`
- Create: `lambda/sync/handler.ts`
- Port from: `/Users/braydenparkinson/Clyde-AI-Assistant/src/background/githubSync.ts`

- [ ] **Step 1: Port the GitHub sync orchestration**

Create `lambda/sync/githubSync.ts`. Read Clyde's `src/background/githubSync.ts` and port:

1. **Replace all Dexie calls** with SQL queries via `lambda/shared/db.ts`:
   - `db.pr_metrics.put(metric)` → `INSERT INTO pr_metrics (...) VALUES (...) ON CONFLICT (repo, pr_number) DO UPDATE SET ...`
   - `db.pr_reviews.put(review)` → `INSERT INTO pr_reviews (...) VALUES (...) ON CONFLICT (repo, pr_number, reviewer, submitted_at) DO NOTHING`
   - `db.ai_review_comments.add(comment)` → `INSERT INTO ai_review_comments (...) VALUES (...)`
   - `db.copilot_metrics.put(metric)` → `INSERT INTO copilot_metrics (...) VALUES (...) ON CONFLICT (date) DO UPDATE SET ...`
2. **Replace `chrome.storage.local`** reads with parameters from Secrets Manager
3. **Replace `chrome.runtime.sendMessage`** progress broadcasts — just log to console (CloudWatch)
4. **Track sync state** in `sync_state` table instead of `chrome.storage.local.githubLastSynced`
5. **Keep the same sync flow:**
   - For each repo: fetch merged PRs since last sync → enrich each PR → store
   - PR enrichment: fetch details, reviews, commits → compute cycle time, detect AI tools, detect reverts
   - Store human reviews to pr_reviews
   - Fetch + classify AI review comments → store to ai_review_comments
   - Sync Copilot metrics if org configured
6. **Keep same error handling:** non-fatal per-PR, rate-limit detection (429/403)
7. **Also port `syncOpenPRSnapshots`** for backlog projection data
8. **Also port PR-Jira link extraction** from PR title/branch → `pr_jira_links` table

```typescript
import { query, execute } from "../shared/db";
import { fetchMergedPRs, fetchPRDetails, fetchPRReviews, fetchPRCommits,
         fetchPRReviewComments, fetchCopilotMetrics, fetchCopilotBilling,
         fetchOpenPRs, aggregateCopilotCompletions, detectAITools,
         detectAIReviewers, detectRevert, isBot } from "./githubClient";
import { getAIReviewTool, classifyReviewComment } from "./classify";

export async function syncGitHubData(config: {
  token: string;
  repos: string[];
  org: string;
}): Promise<{ synced: number; total: number; errors: string[] }> {
  const errors: string[] = [];
  let synced = 0;
  let total = 0;

  for (const repo of config.repos) {
    // 1. Get last sync time from sync_state
    // 2. Fetch merged PRs since then
    // 3. For each new PR, enrich and store
    // 4. Update sync_state
    // (Port the exact logic from Clyde's githubSync.ts)
  }

  // Sync Copilot metrics if org configured
  if (config.org) {
    // Port from Clyde's githubSync.ts copilot section
  }

  return { synced, total, errors };
}
```

- [ ] **Step 2: Create the Lambda handler**

Create `lambda/sync/handler.ts`:

```typescript
import { syncGitHubData } from "./githubSync";
import { syncJiraData } from "./jiraSync";
import { getEngStatsSecrets } from "../shared/secrets";

export async function handler(event: unknown): Promise<{ statusCode: number; body: string }> {
  console.log("Sync Lambda triggered", JSON.stringify(event));

  try {
    const secrets = await getEngStatsSecrets();

    // Run GitHub and Jira sync in parallel
    const [githubResult, jiraResult] = await Promise.all([
      syncGitHubData({
        token: secrets.githubToken,
        repos: secrets.githubRepos,
        org: secrets.githubOrg,
      }),
      syncJiraData({
        host: secrets.jiraHost,
        email: secrets.jiraEmail,
        token: secrets.jiraApiToken,
        projectKeys: secrets.jiraProjectKeys,
      }),
    ]);

    const summary = {
      github: githubResult,
      jira: jiraResult,
      timestamp: new Date().toISOString(),
    };

    console.log("Sync complete", JSON.stringify(summary));

    return {
      statusCode: 200,
      body: JSON.stringify(summary),
    };
  } catch (err) {
    console.error("Sync failed", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: String(err) }),
    };
  }
}
```

- [ ] **Step 3: Build the Lambda bundle**

```bash
npm run build:lambda:sync
```

Expected: `lambda/dist/sync/handler.js` is created.

- [ ] **Step 4: Commit**

```bash
git add lambda/sync/
git commit -m "feat: implement sync Lambda with GitHub and Jira orchestration"
```

---

## Task 7: API Lambda

**Files:**
- Create: `lambda/api/handler.ts`
- Create: `lambda/api/routes.ts`
- Create: `lambda/api/queries.ts`

- [ ] **Step 1: Create SQL query functions**

Create `lambda/api/queries.ts`:

```typescript
import { query } from "../shared/db";
import type { PRMetricRow } from "../shared/types";

export async function getPRMetrics(params: {
  repo?: string;
  since: string;
}): Promise<PRMetricRow[]> {
  const conditions = ["merged_at >= $1"];
  const values: unknown[] = [params.since];

  if (params.repo && params.repo !== "__all__") {
    conditions.push(`repo = $${values.length + 1}`);
    values.push(params.repo);
  }

  return query<PRMetricRow>(
    `SELECT * FROM pr_metrics WHERE ${conditions.join(" AND ")} ORDER BY merged_at DESC`,
    values,
  );
}

export async function getCopilotMetrics(since: string) {
  return query(`SELECT * FROM copilot_metrics WHERE date >= $1 ORDER BY date`, [since]);
}

export async function getAIReviewComments(params: { repo?: string; since: string }) {
  const conditions = ["created_at >= $1"];
  const values: unknown[] = [params.since];
  if (params.repo && params.repo !== "__all__") {
    conditions.push(`repo = $${values.length + 1}`);
    values.push(params.repo);
  }
  return query(
    `SELECT * FROM ai_review_comments WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC`,
    values,
  );
}

export async function getPRReviews(since: string) {
  return query(`SELECT * FROM pr_reviews WHERE submitted_at >= $1`, [since]);
}

export async function getJiraTickets() {
  return query(`SELECT * FROM jira_tickets`);
}

export async function getPRJiraLinks() {
  return query(`SELECT * FROM pr_jira_links`);
}

export async function getOpenPRSnapshots(repo?: string) {
  if (repo && repo !== "__all__") {
    return query(`SELECT * FROM open_pr_snapshots WHERE repo = $1 ORDER BY snapshot_at DESC LIMIT 90`, [repo]);
  }
  return query(`SELECT * FROM open_pr_snapshots ORDER BY snapshot_at DESC LIMIT 90`);
}

export async function getSyncState() {
  return query(`SELECT * FROM sync_state ORDER BY last_synced_at DESC`);
}

export async function getRepos(): Promise<string[]> {
  const rows = await query<{ repo: string }>(
    `SELECT DISTINCT repo FROM pr_metrics ORDER BY repo`,
  );
  return rows.map((r) => r.repo);
}

export async function getTeams() {
  return query(`SELECT * FROM teams ORDER BY name`);
}
```

- [ ] **Step 2: Create route dispatch**

Create `lambda/api/routes.ts`:

```typescript
import * as queries from "./queries";

type RouteHandler = (params: Record<string, string>) => Promise<unknown>;

const routes: Record<string, RouteHandler> = {
  "GET /metrics": (p) => queries.getPRMetrics({ repo: p.repo, since: p.since }),
  "GET /copilot": (p) => queries.getCopilotMetrics(p.since),
  "GET /ai-reviews": (p) => queries.getAIReviewComments({ repo: p.repo, since: p.since }),
  "GET /pr-reviews": (p) => queries.getPRReviews(p.since),
  "GET /jira-tickets": () => queries.getJiraTickets(),
  "GET /pr-jira-links": () => queries.getPRJiraLinks(),
  "GET /open-pr-snapshots": (p) => queries.getOpenPRSnapshots(p.repo),
  "GET /sync-state": () => queries.getSyncState(),
  "GET /repos": () => queries.getRepos(),
  "GET /teams": () => queries.getTeams(),
};

export function matchRoute(method: string, path: string): RouteHandler | null {
  const key = `${method} ${path}`;
  return routes[key] ?? null;
}
```

- [ ] **Step 3: Create the API handler**

Create `lambda/api/handler.ts`:

```typescript
import { matchRoute } from "./routes";

interface APIGatewayEvent {
  httpMethod: string;
  path: string;
  queryStringParameters: Record<string, string> | null;
  headers: Record<string, string>;
}

export async function handler(event: APIGatewayEvent) {
  const apiKey = event.headers["x-api-key"] || event.headers["X-Api-Key"];
  if (apiKey !== process.env.API_KEY) {
    return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }) };
  }

  const route = matchRoute(event.httpMethod, event.path);
  if (!route) {
    return { statusCode: 404, body: JSON.stringify({ error: "Not found" }) };
  }

  try {
    const params = event.queryStringParameters ?? {};
    const data = await route(params);
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "*",
      },
      body: JSON.stringify(data),
    };
  } catch (err) {
    console.error("API error", err);
    return { statusCode: 500, body: JSON.stringify({ error: "Internal server error" }) };
  }
}
```

- [ ] **Step 4: Build the API Lambda bundle**

```bash
npm run build:lambda:api
```

Expected: `lambda/dist/api/handler.js` is created.

- [ ] **Step 5: Commit**

```bash
git add lambda/api/
git commit -m "feat: implement API Lambda with query endpoints"
```

---

## Task 8: Auth (next-auth + GitHub OAuth)

**Files:**
- Create: `src/lib/auth/auth.ts`
- Create: `src/app/api/auth/[...nextauth]/route.ts`

- [ ] **Step 1: Configure next-auth**

Create `src/lib/auth/auth.ts`:

```typescript
import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";

const ALLOWED_ORG = "openspacelabs";

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    GitHub({
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      authorization: { params: { scope: "read:org" } },
    }),
  ],
  callbacks: {
    async signIn({ account }) {
      if (!account?.access_token) return false;

      // Verify org membership
      const res = await fetch(`https://api.github.com/orgs/${ALLOWED_ORG}/members/${account.providerAccountId}`, {
        headers: { Authorization: `Bearer ${account.access_token}` },
      });

      // 204 = member, 404 = not a member, 302 = requester is not org member
      if (res.status === 204) return true;

      // Fallback: check via user orgs list
      const orgsRes = await fetch("https://api.github.com/user/orgs", {
        headers: { Authorization: `Bearer ${account.access_token}` },
      });
      if (orgsRes.ok) {
        const orgs = await orgsRes.json();
        if (orgs.some((o: { login: string }) => o.login === ALLOWED_ORG)) return true;
      }

      return false;
    },
    async session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      return session;
    },
  },
  pages: {
    signIn: "/",
    error: "/",
  },
});
```

- [ ] **Step 2: Create the API route handler**

Create `src/app/api/auth/[...nextauth]/route.ts`:

```typescript
import { handlers } from "@/lib/auth/auth";

export const { GET, POST } = handlers;
```

- [ ] **Step 3: Create a `.env.local` template**

Create `.env.local.example`:

```
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
NEXTAUTH_SECRET=
NEXTAUTH_URL=http://localhost:3000
AWS_API_GATEWAY_URL=
AWS_API_KEY=
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/auth/ src/app/api/auth/ .env.local.example
git commit -m "feat: add GitHub OAuth with org membership gating"
```

---

## Task 9: Computation Library

**Files:**
- Create: `src/lib/compute/helpers.ts`
- Create: `src/lib/compute/shared.ts`
- Create: `src/lib/scoring/aiAdoptionScore.ts`
- Create: `src/lib/scoring/productivityScore.ts`
- Port from: `/Users/braydenparkinson/Clyde-AI-Assistant/src/popup/components/eng-stats/shared.ts`
- Port from: `/Users/braydenparkinson/Clyde-AI-Assistant/src/popup/components/eng-stats/aiAdoptionScore.ts`
- Port from: `/Users/braydenparkinson/Clyde-AI-Assistant/src/popup/components/eng-stats/cycle-time/productivityScore.ts`

These are all pure functions with no Chrome dependencies. They port almost verbatim.

- [ ] **Step 1: Port helper functions**

Create `src/lib/compute/helpers.ts`. Copy these functions from Clyde's `src/popup/components/eng-stats/shared.ts`:

- `daysAgoISO(days)` — returns ISO string for N days ago
- `median(values)` — median of number array
- `isWeekday(isoDate)` — checks if date is Mon-Fri
- `businessDaysInRange(totalDays)` — estimates business days
- `weekendDaysBetween(startISO, endISO)` — counts weekend days
- `toBusinessHours(rawHours, startISO, endISO)` — adjusts hours for weekends
- `removeOutliers(values)` — IQR-based outlier removal
- `fmtHours(h)` — format hours as "Xh" or "Xd Yh"
- `weekLabel(date)` — "Mon DD" format
- `weekKey(d)` — "YYYY-WNN" format
- `linearRegression(values)` — slope + intercept
- `predictPoints(values, count)` — predict future values

Change: Replace `import { OS } from "@shared/tokens"` if used — these helpers shouldn't need UI tokens. They're pure math/date functions.

- [ ] **Step 2: Port computation functions**

Create `src/lib/compute/shared.ts`. Copy these functions from Clyde's `src/popup/components/eng-stats/shared.ts`:

- `computeWeeklyBuckets(metrics, timeRange)` → `WeekBucket[]`
- `computeWeeklyAI(metrics, timeRange)` → `{ label, pct }[]`
- `computePersonRows(metrics, prToTickets, timeRange)` → `PersonRow[]`
- `computeComponentCycleRows(metrics, prToTickets)` → `ComponentCycleRow[]`
- `computeCycleTimeAIComparison(metrics)` → `CycleTimeAIComparison | null`
- `computeLOCStats(metrics, timeRange)` → `LOCStatsData`
- `computeProductivityMatrix(personRows)` → `MatrixPoint[]`
- `computeTeamRows(allMetrics, selectedRepo, prToTickets)` → `TeamRow[]`
- `computeTeamWeeklyCycles(allMetrics, selectedRepo, prToTickets)` → `Map<string, number[]>`

Change imports: `import type { PRMetric, JiraTicket, ... } from "@/lib/types"` and `import { isBotAuthor } from "@/lib/constants"` and `import { median, ... } from "./helpers"`.

- [ ] **Step 3: Port AI adoption scoring**

Create `src/lib/scoring/aiAdoptionScore.ts`. Copy the entire file from Clyde's `src/popup/components/eng-stats/aiAdoptionScore.ts`.

Change imports:
- `import type { PRMetric, CopilotDailyMetric } from "@/lib/types"`
- `import type { AuthorAIRow, TeamRow } from "@/lib/types"`
- `import { isBotAuthor } from "@/lib/constants"`
- `import { removeOutliers, toBusinessHours, toolColors } from "./..."` → adjust paths

- [ ] **Step 4: Port productivity scoring**

Create `src/lib/scoring/productivityScore.ts`. Copy from Clyde's `src/popup/components/eng-stats/cycle-time/productivityScore.ts`.

Change imports similarly. The `PersonRow`, `ProductivityScores` types now come from `@/lib/types`.

- [ ] **Step 5: Verify typecheck**

```bash
npx tsc --noEmit
```

Expected: No errors. If there are import issues, fix the paths.

- [ ] **Step 6: Commit**

```bash
git add src/lib/compute/ src/lib/scoring/
git commit -m "feat: port computation library and scoring algorithms"
```

---

## Task 10: API Client & React Query Hooks

**Files:**
- Create: `src/lib/api/client.ts`
- Create: `src/lib/api/hooks.ts`
- Create: `src/lib/api/provider.tsx`

- [ ] **Step 1: Create the typed API client**

Create `src/lib/api/client.ts`:

```typescript
import type {
  PRMetric, CopilotDailyMetric, AIReviewComment, PRReview,
  JiraTicket, PRJiraLink, OpenPRSnapshot, SyncState,
} from "@/lib/types";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || "/api/proxy";

async function apiFetch<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`, window.location.origin);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v) url.searchParams.set(k, v);
    }
  }

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

export const api = {
  getMetrics: (since: string, repo?: string) =>
    apiFetch<PRMetric[]>("/metrics", { since, repo: repo ?? "" }),
  getCopilotMetrics: (since: string) =>
    apiFetch<CopilotDailyMetric[]>("/copilot", { since }),
  getAIReviewComments: (since: string, repo?: string) =>
    apiFetch<AIReviewComment[]>("/ai-reviews", { since, repo: repo ?? "" }),
  getPRReviews: (since: string) =>
    apiFetch<PRReview[]>("/pr-reviews", { since }),
  getJiraTickets: () =>
    apiFetch<JiraTicket[]>("/jira-tickets"),
  getPRJiraLinks: () =>
    apiFetch<PRJiraLink[]>("/pr-jira-links"),
  getOpenPRSnapshots: (repo?: string) =>
    apiFetch<OpenPRSnapshot[]>("/open-pr-snapshots", { repo: repo ?? "" }),
  getSyncState: () =>
    apiFetch<SyncState[]>("/sync-state"),
  getRepos: () =>
    apiFetch<string[]>("/repos"),
  getTeams: () =>
    apiFetch<{ name: string; members: string[] }[]>("/teams"),
};
```

- [ ] **Step 2: Create React Query hooks**

Create `src/lib/api/hooks.ts`:

```typescript
import { useQuery } from "@tanstack/react-query";
import { api } from "./client";
import { daysAgoISO } from "@/lib/compute/helpers";

export function useMetrics(timeRange: number, repo?: string) {
  const since = daysAgoISO(timeRange);
  return useQuery({
    queryKey: ["metrics", timeRange, repo],
    queryFn: () => api.getMetrics(since, repo),
    staleTime: 5 * 60 * 1000, // 5 min
  });
}

export function useCopilotMetrics(timeRange: number) {
  const since = daysAgoISO(timeRange);
  return useQuery({
    queryKey: ["copilot", timeRange],
    queryFn: () => api.getCopilotMetrics(since),
    staleTime: 5 * 60 * 1000,
  });
}

export function useAIReviewComments(timeRange: number, repo?: string) {
  const since = daysAgoISO(timeRange);
  return useQuery({
    queryKey: ["ai-reviews", timeRange, repo],
    queryFn: () => api.getAIReviewComments(since, repo),
    staleTime: 5 * 60 * 1000,
  });
}

export function usePRReviews(timeRange: number) {
  const since = daysAgoISO(timeRange);
  return useQuery({
    queryKey: ["pr-reviews", timeRange],
    queryFn: () => api.getPRReviews(since),
    staleTime: 5 * 60 * 1000,
  });
}

export function useJiraTickets() {
  return useQuery({
    queryKey: ["jira-tickets"],
    queryFn: () => api.getJiraTickets(),
    staleTime: 10 * 60 * 1000,
  });
}

export function usePRJiraLinks() {
  return useQuery({
    queryKey: ["pr-jira-links"],
    queryFn: () => api.getPRJiraLinks(),
    staleTime: 10 * 60 * 1000,
  });
}

export function useOpenPRSnapshots(repo?: string) {
  return useQuery({
    queryKey: ["open-pr-snapshots", repo],
    queryFn: () => api.getOpenPRSnapshots(repo),
    staleTime: 5 * 60 * 1000,
  });
}

export function useRepos() {
  return useQuery({
    queryKey: ["repos"],
    queryFn: () => api.getRepos(),
    staleTime: 30 * 60 * 1000,
  });
}

export function useSyncState() {
  return useQuery({
    queryKey: ["sync-state"],
    queryFn: () => api.getSyncState(),
    staleTime: 60 * 1000,
  });
}
```

- [ ] **Step 3: Create the QueryClient provider**

Create `src/lib/api/provider.tsx`:

```tsx
"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  }));

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
```

- [ ] **Step 4: Wire the provider into the root layout**

Update `src/app/layout.tsx` to wrap children with `QueryProvider`:

```tsx
import { QueryProvider } from "@/lib/api/provider";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-gray-50 text-gray-900 antialiased">
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/api/ src/app/layout.tsx
git commit -m "feat: add API client, React Query hooks, and provider"
```

---

## Task 11: App Layout — Sidebar, Header, Auth Gate

**Files:**
- Create: `src/components/Sidebar.tsx`
- Create: `src/components/Header.tsx`
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: Create the sidebar**

Create `src/components/Sidebar.tsx`:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/", label: "Summary", icon: "📊" },
  { href: "/cycle-time", label: "Cycle Time", icon: "⏱" },
  { href: "/ai-adoption", label: "AI Adoption", icon: "🤖" },
  { href: "/ai-reviews", label: "AI Reviews", icon: "💬" },
  { href: "/teams", label: "Teams", icon: "👥" },
  { href: "/settings", label: "Settings", icon: "⚙️" },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-56 bg-white border-r border-gray-200 min-h-screen p-4 flex flex-col">
      <div className="text-lg font-bold mb-6 px-2">Eng Stats</div>
      <nav className="flex flex-col gap-1">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                active
                  ? "bg-blue-50 text-blue-700"
                  : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
              }`}
            >
              <span>{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
```

- [ ] **Step 2: Create the header with global filters**

Create `src/components/Header.tsx`:

```tsx
"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useRepos } from "@/lib/api/hooks";

const TIME_RANGES = [30, 60, 90, 180, 360];

export function Header() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { data: repos } = useRepos();

  const timeRange = Number(searchParams.get("days") || 90);
  const selectedRepo = searchParams.get("repo") || "__all__";

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set(key, value);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <header className="flex items-center gap-4 px-6 py-3 border-b border-gray-200 bg-white">
      <div className="flex items-center gap-2">
        <label className="text-sm text-gray-500">Time range:</label>
        <select
          value={timeRange}
          onChange={(e) => setParam("days", e.target.value)}
          className="text-sm border rounded px-2 py-1"
        >
          {TIME_RANGES.map((d) => (
            <option key={d} value={d}>{d} days</option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-2">
        <label className="text-sm text-gray-500">Repo:</label>
        <select
          value={selectedRepo}
          onChange={(e) => setParam("repo", e.target.value)}
          className="text-sm border rounded px-2 py-1"
        >
          <option value="__all__">All repos</option>
          {repos?.map((r) => (
            <option key={r} value={r}>{r.split("/").pop()}</option>
          ))}
        </select>
      </div>
    </header>
  );
}
```

- [ ] **Step 3: Wire layout with auth gate**

Update `src/app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import { SessionProvider } from "next-auth/react";
import { QueryProvider } from "@/lib/api/provider";
import { Sidebar } from "@/components/Sidebar";
import { Header } from "@/components/Header";
import { auth } from "@/lib/auth/auth";
import "./globals.css";

export const metadata: Metadata = {
  title: "Eng Stats — OpenSpace",
  description: "Engineering metrics dashboard",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  return (
    <html lang="en">
      <body className="bg-gray-50 text-gray-900 antialiased">
        <SessionProvider session={session}>
          <QueryProvider>
            {session ? (
              <div className="flex min-h-screen">
                <Sidebar />
                <div className="flex-1 flex flex-col">
                  <Header />
                  <main className="flex-1 p-6 overflow-auto">{children}</main>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center min-h-screen">
                <div className="text-center">
                  <h1 className="text-2xl font-bold mb-4">Eng Stats</h1>
                  <p className="text-gray-600 mb-6">Sign in with your GitHub account to access engineering metrics.</p>
                  <a href="/api/auth/signin" className="bg-gray-900 text-white px-6 py-2 rounded-lg hover:bg-gray-800">
                    Sign in with GitHub
                  </a>
                </div>
              </div>
            )}
          </QueryProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 4: Verify build**

```bash
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/components/Sidebar.tsx src/components/Header.tsx src/app/layout.tsx
git commit -m "feat: add sidebar, header with global filters, and auth gate"
```

---

## Task 12: Chart Components

**Files:**
- Create: `src/components/charts/CycleTimeChart.tsx`
- Create: `src/components/charts/AIAdoptionChart.tsx`
- Create: `src/components/charts/PRSizeChart.tsx`
- Create: `src/components/charts/PRFlowChart.tsx`
- Create: `src/components/charts/ScoreGauge.tsx`
- Create: `src/components/charts/InfoTip.tsx`
- Create: `src/components/KPICard.tsx`
- Port from: `/Users/braydenparkinson/Clyde-AI-Assistant/src/popup/components/eng-stats/charts.tsx`

- [ ] **Step 1: Port chart components**

Read Clyde's `src/popup/components/eng-stats/charts.tsx` (~49KB). It contains all chart components in a single file. Split them into individual files under `src/components/charts/`.

For each chart component:
1. Copy the component function
2. Change inline styles → Tailwind classes where straightforward (keep inline for dynamic colors since Recharts uses inline styles for data-driven colors)
3. Replace `import { OS } from "@shared/tokens"` with Tailwind color classes or the constants from `@/lib/constants`
4. Replace `dk(darkMode, dark, light)` helper with Tailwind dark mode classes or remove (the standalone app starts with light mode only — dark mode can be added later)
5. Add `"use client"` directive to each file (they use Recharts which requires client-side rendering)
6. Props stay the same — they already receive data, not DB queries

Components to port:
- `CycleTimeChart` — line chart with weekly averages + trend line
- `AIAdoptionChart` — line chart with weekly AI adoption %
- `PRSizeChart` — horizontal bar chart with size buckets
- `PRFlowChart` — dual-line chart (opened vs closed PRs per week)
- `ScoreGauge` — circular gauge (0-100) for adoption/productivity scores
- `InfoTip` — tooltip icon component
- `KPICard` — metric card with value, label, trend indicator

- [ ] **Step 2: Create the KPICard component**

Create `src/components/KPICard.tsx`. Port from the `KPICard` in Clyde's `charts.tsx`:

```tsx
"use client";

interface KPICardProps {
  label: string;
  value: string;
  subtitle?: string;
  trend?: number; // Positive = improving, negative = declining
  trendLabel?: string;
}

export function KPICard({ label, value, subtitle, trend, trendLabel }: KPICardProps) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 flex flex-col">
      <span className="text-sm text-gray-500 font-medium">{label}</span>
      <span className="text-2xl font-bold mt-1">{value}</span>
      {subtitle && <span className="text-xs text-gray-400 mt-1">{subtitle}</span>}
      {trend !== undefined && (
        <span className={`text-xs mt-2 ${trend >= 0 ? "text-green-600" : "text-red-600"}`}>
          {trend >= 0 ? "↓" : "↑"} {Math.abs(trend).toFixed(1)}% {trendLabel || "vs prev period"}
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify build**

```bash
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add src/components/charts/ src/components/KPICard.tsx
git commit -m "feat: port chart components and KPICard from Clyde"
```

---

## Task 13: Summary Page (/)

**Files:**
- Modify: `src/app/page.tsx`
- Port from: `/Users/braydenparkinson/Clyde-AI-Assistant/src/popup/components/eng-stats/SummaryTab.tsx`

- [ ] **Step 1: Implement the Summary page**

Replace `src/app/page.tsx`. This is the main dashboard. Port the rendering logic from Clyde's `SummaryTab.tsx`, but:

1. Replace `useLiveQuery()` with React Query hooks from `@/lib/api/hooks`
2. Read `timeRange` and `selectedRepo` from URL search params (via `useSearchParams()`)
3. Compute `prToTickets` map from `usePRJiraLinks()` + `useJiraTickets()` hooks
4. Use `useMemo` for derived computations (same as Clyde)
5. Render KPI cards, CycleTimeChart, AIAdoptionChart, PRSizeChart, tool usage section
6. Use Tailwind for layout (CSS grid for KPI cards, flex for sections)

```tsx
"use client";

import { useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { useMetrics, useCopilotMetrics, usePRJiraLinks, useJiraTickets, useOpenPRSnapshots } from "@/lib/api/hooks";
import { computeWeeklyBuckets, computeWeeklyAI } from "@/lib/compute/shared";
import { isBotAuthor, PR_SIZE_BUCKETS, toolColors } from "@/lib/constants";
import { fmtHours, median } from "@/lib/compute/helpers";
import { KPICard } from "@/components/KPICard";
import { CycleTimeChart } from "@/components/charts/CycleTimeChart";
import { AIAdoptionChart } from "@/components/charts/AIAdoptionChart";
import { PRSizeChart } from "@/components/charts/PRSizeChart";

export default function SummaryPage() {
  const searchParams = useSearchParams();
  const timeRange = Number(searchParams.get("days") || 90);
  const selectedRepo = searchParams.get("repo") || "__all__";

  const { data: allMetrics = [], isLoading } = useMetrics(timeRange, selectedRepo);
  const { data: copilotMetrics = [] } = useCopilotMetrics(timeRange);
  const { data: jiraTickets = [] } = useJiraTickets();
  const { data: prJiraLinks = [] } = usePRJiraLinks();
  const { data: openSnapshots = [] } = useOpenPRSnapshots(selectedRepo);

  // Filter out bots
  const metrics = useMemo(
    () => allMetrics.filter((m) => !m.author || !isBotAuthor(m.author)),
    [allMetrics],
  );

  // Build PR → tickets map
  const prToTickets = useMemo(() => {
    const map = new Map<number, typeof jiraTickets>();
    const ticketMap = new Map(jiraTickets.map((t) => [t.key, t]));
    for (const link of prJiraLinks) {
      const ticket = ticketMap.get(link.jiraTicketKey);
      if (ticket) {
        const existing = map.get(link.prMetricId) || [];
        existing.push(ticket);
        map.set(link.prMetricId, existing);
      }
    }
    return map;
  }, [jiraTickets, prJiraLinks]);

  // Compute derived data
  const weeklyBuckets = useMemo(() => computeWeeklyBuckets(metrics, timeRange), [metrics, timeRange]);
  const weeklyAI = useMemo(() => computeWeeklyAI(metrics, timeRange), [metrics, timeRange]);

  const kpis = useMemo(() => {
    const cycleTimes = metrics
      .map((m) => m.cycleTimeHours)
      .filter((h): h is number => h !== null);
    const reviewTimes = metrics
      .map((m) => m.timeToFirstReviewHours)
      .filter((h): h is number => h !== null);
    const aiCount = metrics.filter((m) => m.aiAssisted).length;

    return {
      medianCycleTime: median(cycleTimes),
      medianReviewTime: median(reviewTimes),
      prsMerged: metrics.length,
      aiPct: metrics.length ? Math.round((aiCount / metrics.length) * 100) : 0,
    };
  }, [metrics]);

  // PR size distribution
  const sizeBuckets = useMemo(() => {
    return PR_SIZE_BUCKETS.map((bucket) => ({
      label: bucket.label,
      color: bucket.color,
      count: metrics.filter((m) => {
        const size = m.additions + m.deletions;
        const prevMax = PR_SIZE_BUCKETS[PR_SIZE_BUCKETS.indexOf(bucket) - 1]?.max ?? 0;
        return size > prevMax && size <= bucket.max;
      }).length,
    }));
  }, [metrics]);

  // Tool usage
  const toolUsage = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of metrics) {
      for (const tool of m.aiTools) {
        counts.set(tool, (counts.get(tool) || 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([tool, count]) => ({ tool, count, color: toolColors[tool] || "#6B7280" }));
  }, [metrics]);

  if (isLoading) {
    return <div className="flex items-center justify-center h-64 text-gray-400">Loading metrics...</div>;
  }

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-4">
        <KPICard label="Median Cycle Time" value={fmtHours(kpis.medianCycleTime)} />
        <KPICard label="Median Review Time" value={fmtHours(kpis.medianReviewTime)} />
        <KPICard label="PRs Merged" value={String(kpis.prsMerged)} />
        <KPICard label="AI-Assisted" value={`${kpis.aiPct}%`} />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-2 gap-6">
        <div className="bg-white rounded-lg border p-4">
          <h3 className="text-sm font-semibold mb-4">Cycle Time Trend</h3>
          <CycleTimeChart buckets={weeklyBuckets} height={240} />
        </div>
        <div className="bg-white rounded-lg border p-4">
          <h3 className="text-sm font-semibold mb-4">AI Adoption Trend</h3>
          <AIAdoptionChart weeklyPcts={weeklyAI} height={240} />
        </div>
      </div>

      {/* PR Size Distribution + Tool Usage */}
      <div className="grid grid-cols-2 gap-6">
        <div className="bg-white rounded-lg border p-4">
          <h3 className="text-sm font-semibold mb-4">PR Size Distribution</h3>
          <PRSizeChart buckets={sizeBuckets} />
        </div>
        <div className="bg-white rounded-lg border p-4">
          <h3 className="text-sm font-semibold mb-4">AI Tool Usage</h3>
          <div className="space-y-2">
            {toolUsage.map(({ tool, count, color }) => (
              <div key={tool} className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
                <span className="text-sm flex-1">{tool}</span>
                <span className="text-sm font-medium">{count} PRs</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: implement Summary dashboard page"
```

---

## Task 14: Cycle Time Page

**Files:**
- Create: `src/app/cycle-time/page.tsx`
- Create: `src/components/cycle-time/LOCStats.tsx`
- Create: `src/components/cycle-time/AIImpactSection.tsx`
- Create: `src/components/cycle-time/ComponentBreakdown.tsx`
- Create: `src/components/cycle-time/PersonInsights.tsx`
- Create: `src/components/cycle-time/ProductivityMatrix.tsx`
- Port from: `/Users/braydenparkinson/Clyde-AI-Assistant/src/popup/components/eng-stats/CycleTimeTab.tsx`
- Port from: `/Users/braydenparkinson/Clyde-AI-Assistant/src/popup/components/eng-stats/cycle-time/*`

- [ ] **Step 1: Port cycle-time sub-components**

Port each sub-component from Clyde's `src/popup/components/eng-stats/cycle-time/` directory. For each:
1. Copy the component
2. Replace inline styles with Tailwind
3. Replace `import { OS } from "@shared/tokens"` with Tailwind classes
4. Replace `dk()` calls with static light-mode values (or Tailwind dark: variants)
5. Types come from `@/lib/types`, helpers from `@/lib/compute/helpers`

- `LOCStats.tsx` — weekly LOC trends, PR size buckets
- `AIImpactSection.tsx` — AI vs non-AI cycle time comparison table
- `ComponentBreakdown.tsx` — per-Jira-component cycle metrics table
- `PersonInsights.tsx` — developer-level sortable table with productivity scores
- `ProductivityMatrix.tsx` — scatter plot (uses Recharts ScatterChart)

- [ ] **Step 2: Create the Cycle Time page**

Create `src/app/cycle-time/page.tsx`. Port from Clyde's `CycleTimeTab.tsx`:

```tsx
"use client";

import { useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { useMetrics, usePRReviews, usePRJiraLinks, useJiraTickets } from "@/lib/api/hooks";
import { computeWeeklyBuckets, computePersonRows, computeComponentCycleRows,
         computeCycleTimeAIComparison, computeLOCStats, computeProductivityMatrix } from "@/lib/compute/shared";
import { applyProductivityScores } from "@/lib/scoring/productivityScore";
import { isBotAuthor } from "@/lib/constants";
import { CycleTimeChart } from "@/components/charts/CycleTimeChart";
import { LOCStats } from "@/components/cycle-time/LOCStats";
import { AIImpactSection } from "@/components/cycle-time/AIImpactSection";
import { ComponentBreakdown } from "@/components/cycle-time/ComponentBreakdown";
import { PersonInsights } from "@/components/cycle-time/PersonInsights";
import { ProductivityMatrix } from "@/components/cycle-time/ProductivityMatrix";

export default function CycleTimePage() {
  const searchParams = useSearchParams();
  const timeRange = Number(searchParams.get("days") || 90);
  const selectedRepo = searchParams.get("repo") || "__all__";

  const { data: allMetrics = [] } = useMetrics(timeRange, selectedRepo);
  const { data: reviews = [] } = usePRReviews(timeRange);
  const { data: jiraTickets = [] } = useJiraTickets();
  const { data: prJiraLinks = [] } = usePRJiraLinks();

  const metrics = useMemo(() => allMetrics.filter((m) => !m.author || !isBotAuthor(m.author)), [allMetrics]);

  // Build prToTickets map (same as Summary page — could extract to shared hook)
  const prToTickets = useMemo(() => {
    // ... same logic as Task 13
  }, [jiraTickets, prJiraLinks]);

  const weeklyBuckets = useMemo(() => computeWeeklyBuckets(metrics, timeRange), [metrics, timeRange]);
  const locStats = useMemo(() => computeLOCStats(metrics, timeRange), [metrics, timeRange]);
  const aiComparison = useMemo(() => computeCycleTimeAIComparison(metrics), [metrics]);
  const componentRows = useMemo(() => computeComponentCycleRows(metrics, prToTickets), [metrics, prToTickets]);
  const personRows = useMemo(() => {
    const base = computePersonRows(metrics, prToTickets, timeRange);
    return applyProductivityScores(base, metrics, prToTickets, timeRange, reviews);
  }, [metrics, prToTickets, timeRange, reviews]);
  const matrixPoints = useMemo(() => computeProductivityMatrix(personRows), [personRows]);

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg border p-4">
        <h3 className="text-sm font-semibold mb-4">Weekly Average Cycle Time</h3>
        <CycleTimeChart buckets={weeklyBuckets} height={280} />
      </div>

      <LOCStats data={locStats} />
      {aiComparison && <AIImpactSection data={aiComparison} />}
      <ComponentBreakdown rows={componentRows} />
      <PersonInsights rows={personRows} />
      {matrixPoints.length >= 5 && <ProductivityMatrix points={matrixPoints} />}
    </div>
  );
}
```

- [ ] **Step 3: Verify build**

```bash
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add src/app/cycle-time/ src/components/cycle-time/
git commit -m "feat: implement Cycle Time page with all sub-sections"
```

---

## Task 15: AI Adoption Page

**Files:**
- Create: `src/app/ai-adoption/page.tsx`
- Port from: `/Users/braydenparkinson/Clyde-AI-Assistant/src/popup/components/eng-stats/AIAdoptionTab.tsx`

- [ ] **Step 1: Implement the AI Adoption page**

Create `src/app/ai-adoption/page.tsx`. Port from Clyde's `AIAdoptionTab.tsx`. This is the largest tab (~44KB in Clyde). Key sections:

1. **Adoption Score gauge** (0-100) with maturity tier label
2. **Three pillars breakdown** — utilization, impact, quality with individual metric bars
3. **Author adoption tiers** — table grouping authors as non-user/infrequent/frequent/power
4. **Team adoption breakdown** — per-team AI %
5. **Tool matrix** — per-author tool distribution
6. **Copilot metrics** — daily usage charts (if data available)
7. **Action items** — prioritized recommendations

Use the hooks: `useMetrics`, `useCopilotMetrics`, `useJiraTickets`, `usePRJiraLinks`.
Call `computeAIAdoptionScore()` from `@/lib/scoring/aiAdoptionScore`.
Render the ScoreGauge component for the overall score.

Same porting approach: replace inline styles with Tailwind, replace `useLiveQuery` with React Query hooks, use `useMemo` for computations.

- [ ] **Step 2: Verify build**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/app/ai-adoption/
git commit -m "feat: implement AI Adoption page with scoring and segmentation"
```

---

## Task 16: AI Reviews Page

**Files:**
- Create: `src/app/ai-reviews/page.tsx`
- Port from: `/Users/braydenparkinson/Clyde-AI-Assistant/src/popup/components/eng-stats/AIReviewsTab.tsx`

- [ ] **Step 1: Implement the AI Reviews page**

Create `src/app/ai-reviews/page.tsx`. Port from Clyde's `AIReviewsTab.tsx`. Key sections:

1. **Comments by tool** — count per AI tool (coderabbit, copilot, etc.)
2. **Comments by category** — bug, security, type-safety, perf, logic, style, other
3. **Comments by severity** — high, medium, low, info
4. **Per-author analysis** — which authors receive the most AI review comments
5. **Weekly trends** — comment volume over time

Use `useAIReviewComments(timeRange, selectedRepo)` hook.
Category/severity colors come from `@/lib/constants`.

- [ ] **Step 2: Verify build**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/app/ai-reviews/
git commit -m "feat: implement AI Reviews page"
```

---

## Task 17: Teams Page

**Files:**
- Create: `src/app/teams/page.tsx`
- Port from: `/Users/braydenparkinson/Clyde-AI-Assistant/src/popup/components/eng-stats/TeamsTab.tsx`

- [ ] **Step 1: Implement the Teams page**

Create `src/app/teams/page.tsx`. Port from Clyde's `TeamsTab.tsx`. Key features:

1. **Sortable team table** — columns: team name, PRs merged, avg cycle time, median review time, avg PR size, AI %, weekly trend sparkline
2. **Expandable rows** — click a team to see weekly cycle time details and PR size distribution bar chart
3. **Sort by any column** — click column header to toggle asc/desc

Use `computeTeamRows()` and `computeTeamWeeklyCycles()` from `@/lib/compute/shared`.
Sparklines can be simple inline SVGs or tiny Recharts LineChart components.

- [ ] **Step 2: Verify build**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/app/teams/
git commit -m "feat: implement Teams page with sortable table"
```

---

## Task 18: Settings Page

**Files:**
- Create: `src/app/settings/page.tsx`

- [ ] **Step 1: Implement the Settings page**

Create `src/app/settings/page.tsx`. This is new (not ported from Clyde). It shows:

1. **Sync status** — last sync time per source/repo, pulled from `useSyncState()` hook
2. **Manual sync trigger** — button that invokes the sync Lambda via an API endpoint
3. **Configured repos** — read-only list of repos being synced (configured in Secrets Manager, shown here for visibility)
4. **Team mappings** — show the teams table (derived from Jira components)

```tsx
"use client";

import { useSyncState, useRepos, useTeams } from "@/lib/api/hooks";

export default function SettingsPage() {
  const { data: syncState = [] } = useSyncState();
  const { data: repos = [] } = useRepos();
  const { data: teams = [] } = useTeams();

  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="text-lg font-bold">Settings</h1>

      {/* Sync Status */}
      <section className="bg-white rounded-lg border p-4">
        <h2 className="text-sm font-semibold mb-3">Sync Status</h2>
        <div className="space-y-2">
          {syncState.map((s) => (
            <div key={`${s.source}-${s.repo}`} className="flex justify-between text-sm">
              <span className="text-gray-600">{s.source}{s.repo ? ` / ${s.repo}` : ""}</span>
              <span className="text-gray-400">{new Date(s.lastSyncedAt).toLocaleString()}</span>
            </div>
          ))}
          {syncState.length === 0 && <p className="text-sm text-gray-400">No sync history yet.</p>}
        </div>
      </section>

      {/* Configured Repos */}
      <section className="bg-white rounded-lg border p-4">
        <h2 className="text-sm font-semibold mb-3">Configured Repos</h2>
        <div className="flex flex-wrap gap-2">
          {repos.map((r) => (
            <span key={r} className="bg-gray-100 text-gray-700 text-xs px-2 py-1 rounded">{r}</span>
          ))}
        </div>
      </section>

      {/* Teams */}
      <section className="bg-white rounded-lg border p-4">
        <h2 className="text-sm font-semibold mb-3">Teams (from Jira Components)</h2>
        <div className="space-y-2">
          {teams.map((t) => (
            <div key={t.name} className="text-sm">
              <span className="font-medium">{t.name}</span>
              <span className="text-gray-400 ml-2">({t.members.length} members)</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/settings/
git commit -m "feat: implement Settings page with sync status and team config"
```

---

## Task 19: Next.js API Proxy Route

**Files:**
- Create: `src/app/api/proxy/[...path]/route.ts`

The Vercel frontend needs to reach the AWS API Gateway. Rather than exposing the API Gateway URL and key to the browser, we proxy through a Next.js API route. This keeps the API key server-side.

- [ ] **Step 1: Create the proxy route**

Create `src/app/api/proxy/[...path]/route.ts`:

```typescript
import { auth } from "@/lib/auth/auth";
import { NextRequest, NextResponse } from "next/server";

const API_GATEWAY_URL = process.env.AWS_API_GATEWAY_URL!;
const API_KEY = process.env.AWS_API_KEY!;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  // Verify auth
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { path } = await params;
  const targetPath = "/" + path.join("/");
  const searchParams = request.nextUrl.searchParams.toString();
  const url = `${API_GATEWAY_URL}${targetPath}${searchParams ? `?${searchParams}` : ""}`;

  const response = await fetch(url, {
    headers: {
      "x-api-key": API_KEY,
      "Content-Type": "application/json",
    },
  });

  const data = await response.json();
  return NextResponse.json(data, { status: response.status });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/proxy/
git commit -m "feat: add API proxy route to keep AWS credentials server-side"
```

---

## Task 20: Terraform Infrastructure

**Files:**
- Create: `infra/main.tf`
- Create: `infra/variables.tf`
- Create: `infra/outputs.tf`

- [ ] **Step 1: Create variables**

Create `infra/variables.tf`:

```hcl
variable "aws_region" {
  default = "us-west-2"
}

variable "db_password" {
  type      = string
  sensitive = true
}

variable "api_key" {
  type      = string
  sensitive = true
  description = "API key for API Gateway authentication"
}

variable "vpc_id" {
  type        = string
  description = "VPC ID for Lambda and RDS"
}

variable "private_subnet_ids" {
  type        = list(string)
  description = "Private subnet IDs for RDS and Lambda"
}

variable "allowed_origin" {
  type        = string
  default     = "https://eng-stats.vercel.app"
  description = "CORS allowed origin (Vercel app URL)"
}
```

- [ ] **Step 2: Create main infrastructure**

Create `infra/main.tf`:

```hcl
terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
}

provider "aws" {
  region = var.aws_region
}

# ─── Security Groups ───
resource "aws_security_group" "lambda" {
  name_prefix = "eng-stats-lambda-"
  vpc_id      = var.vpc_id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "rds" {
  name_prefix = "eng-stats-rds-"
  vpc_id      = var.vpc_id

  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.lambda.id]
  }
}

# ─── RDS PostgreSQL ───
resource "aws_db_subnet_group" "eng_stats" {
  name       = "eng-stats"
  subnet_ids = var.private_subnet_ids
}

resource "aws_db_instance" "eng_stats" {
  identifier           = "eng-stats"
  engine               = "postgres"
  engine_version       = "16"
  instance_class       = "db.t4g.micro"
  allocated_storage    = 20
  db_name              = "eng_stats"
  username             = "eng_stats"
  password             = var.db_password
  db_subnet_group_name = aws_db_subnet_group.eng_stats.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  skip_final_snapshot  = true
  publicly_accessible  = false
  storage_encrypted    = true
}

# ─── Secrets Manager ───
resource "aws_secretsmanager_secret" "eng_stats_config" {
  name = "eng-stats/config"
}

# ─── IAM Role for Lambda ───
resource "aws_iam_role" "lambda" {
  name = "eng-stats-lambda"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_basic" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy_attachment" "lambda_vpc" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

resource "aws_iam_role_policy" "lambda_secrets" {
  name = "secrets-access"
  role = aws_iam_role.lambda.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = [aws_secretsmanager_secret.eng_stats_config.arn]
    }]
  })
}

# ─── Lambda: API Handler ───
resource "aws_lambda_function" "api" {
  function_name = "eng-stats-api"
  role          = aws_iam_role.lambda.arn
  handler       = "handler.handler"
  runtime       = "nodejs20.x"
  timeout       = 30
  memory_size   = 256
  filename      = "${path.module}/../lambda/dist/api.zip"

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [aws_security_group.lambda.id]
  }

  environment {
    variables = {
      DB_HOST        = aws_db_instance.eng_stats.address
      DB_PORT        = "5432"
      DB_NAME        = "eng_stats"
      DB_USER        = "eng_stats"
      DB_PASSWORD    = var.db_password
      DB_SSL         = "true"
      API_KEY        = var.api_key
      ALLOWED_ORIGIN = var.allowed_origin
    }
  }
}

# ─── Lambda: Sync Job ───
resource "aws_lambda_function" "sync" {
  function_name = "eng-stats-sync"
  role          = aws_iam_role.lambda.arn
  handler       = "handler.handler"
  runtime       = "nodejs20.x"
  timeout       = 900  # 15 min max for full sync
  memory_size   = 512
  filename      = "${path.module}/../lambda/dist/sync.zip"

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [aws_security_group.lambda.id]
  }

  environment {
    variables = {
      DB_HOST    = aws_db_instance.eng_stats.address
      DB_PORT    = "5432"
      DB_NAME    = "eng_stats"
      DB_USER    = "eng_stats"
      DB_PASSWORD = var.db_password
      DB_SSL     = "true"
      SECRETS_ID = aws_secretsmanager_secret.eng_stats_config.name
    }
  }
}

# ─── EventBridge Schedule (every 6 hours) ───
resource "aws_cloudwatch_event_rule" "sync_schedule" {
  name                = "eng-stats-sync-schedule"
  schedule_expression = "rate(6 hours)"
}

resource "aws_cloudwatch_event_target" "sync_lambda" {
  rule = aws_cloudwatch_event_rule.sync_schedule.name
  arn  = aws_lambda_function.sync.arn
}

resource "aws_lambda_permission" "eventbridge_sync" {
  statement_id  = "AllowEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.sync.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.sync_schedule.arn
}

# ─── API Gateway ───
resource "aws_apigatewayv2_api" "eng_stats" {
  name          = "eng-stats-api"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = [var.allowed_origin]
    allow_methods = ["GET", "OPTIONS"]
    allow_headers = ["Content-Type", "x-api-key"]
  }
}

resource "aws_apigatewayv2_integration" "lambda" {
  api_id             = aws_apigatewayv2_api.eng_stats.id
  integration_type   = "AWS_PROXY"
  integration_uri    = aws_lambda_function.api.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "default" {
  api_id    = aws_apigatewayv2_api.eng_stats.id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_stage" "prod" {
  api_id      = aws_apigatewayv2_api.eng_stats.id
  name        = "$default"
  auto_deploy = true
}

resource "aws_lambda_permission" "apigw" {
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.eng_stats.execution_arn}/*"
}
```

- [ ] **Step 3: Create outputs**

Create `infra/outputs.tf`:

```hcl
output "api_gateway_url" {
  value = aws_apigatewayv2_api.eng_stats.api_endpoint
}

output "rds_endpoint" {
  value = aws_db_instance.eng_stats.address
}

output "sync_lambda_name" {
  value = aws_lambda_function.sync.function_name
}

output "api_lambda_name" {
  value = aws_lambda_function.api.function_name
}
```

- [ ] **Step 4: Commit**

```bash
git add infra/
git commit -m "feat: add Terraform config for RDS, Lambda, API Gateway, EventBridge"
```

---

## Task 21: GitHub Actions CI/CD

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/deploy-lambda.yml`

- [ ] **Step 1: Create CI workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  pull_request:
    branches: [main]

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm run build
```

- [ ] **Step 2: Create Lambda deploy workflow**

Create `.github/workflows/deploy-lambda.yml`:

```yaml
name: Deploy Lambdas

on:
  push:
    branches: [main]
    paths:
      - 'lambda/**'

permissions:
  id-token: write
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run build:lambda

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_ROLE_ARN }}
          aws-region: us-west-2

      - name: Package and deploy API Lambda
        run: |
          cd lambda/dist/api && zip -r ../api.zip .
          aws lambda update-function-code \
            --function-name eng-stats-api \
            --zip-file fileb://lambda/dist/api.zip

      - name: Package and deploy Sync Lambda
        run: |
          cd lambda/dist/sync && zip -r ../sync.zip .
          aws lambda update-function-code \
            --function-name eng-stats-sync \
            --zip-file fileb://lambda/dist/sync.zip
```

- [ ] **Step 3: Create Vercel config**

Create `vercel.json`:

```json
{
  "framework": "nextjs",
  "buildCommand": "npm run build",
  "installCommand": "npm ci"
}
```

- [ ] **Step 4: Commit**

```bash
git add .github/ vercel.json
git commit -m "feat: add CI/CD workflows and Vercel config"
```

---

## Task 22: README and Final Verification

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write README**

Create `README.md`:

```markdown
# Eng Stats

Engineering metrics dashboard for OpenSpace. Tracks cycle time, AI adoption, review quality, and team performance across GitHub and Jira.

## Architecture

- **Frontend:** Next.js on Vercel (GitHub OAuth, Tailwind, Recharts)
- **API:** AWS Lambda behind API Gateway (read-only queries)
- **Database:** RDS PostgreSQL
- **Sync:** Scheduled Lambda (every 6h) pulls from GitHub + Jira APIs

## Development

\`\`\`bash
npm install
cp .env.local.example .env.local  # Fill in values
npm run dev
\`\`\`

## Build

\`\`\`bash
npm run build           # Next.js frontend
npm run build:lambda    # Lambda bundles
npm run typecheck       # TypeScript check (frontend + lambda)
\`\`\`

## Deployment

- **Frontend:** Push to `main` → auto-deploys on Vercel
- **Lambdas:** Push to `main` with changes in `lambda/` → GitHub Action deploys
- **Infrastructure:** One-time Terraform apply (see `infra/`)

## Initial Setup

1. Create a GitHub OAuth App in the `openspacelabs` org
2. Provision AWS infrastructure: `cd infra && terraform apply`
3. Run the initial migration: `psql $DATABASE_URL < migrations/001_initial.sql`
4. Set Secrets Manager values (GitHub PAT, Jira credentials)
5. Connect repo to Vercel, configure env vars
6. Trigger initial sync: `aws lambda invoke --function-name eng-stats-sync /dev/null`
\`\`\`
```

- [ ] **Step 2: Final typecheck and build**

```bash
npm run typecheck
npm run build
npm run build:lambda
```

Expected: All pass.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add README with setup and deployment instructions"
```

---

## Execution Notes

**Task dependency order:** Tasks 1-3 must be sequential (scaffold → types → schema). After that:
- Tasks 4-7 (Lambda backend) can be done in parallel with Tasks 9-12 (frontend foundation) since they share only types
- Tasks 13-18 (pages) depend on Tasks 9-12 but are independent of each other
- Tasks 19-21 (infra/CI) are independent of all other tasks
- Task 22 is last

**Porting strategy:** When a task says "port from Clyde's `<file>`", the implementing agent should:
1. Read the source file from `/Users/braydenparkinson/Clyde-AI-Assistant/`
2. Copy the relevant functions/components
3. Apply the specified changes (import paths, Chrome API removal, style migration)
4. Verify typecheck passes

**Testing note:** The spec doesn't include a test suite. The Clyde codebase has minimal Eng Stats tests. For v1, verification is: `npm run typecheck` + `npm run build` + manual browser testing. Tests can be added incrementally after v1 ships.
