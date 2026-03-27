/**
 * Thin GitHub REST API client for Eng Stats.
 * All functions accept a PAT and return typed responses.
 * Handles rate-limit headers and Link-header pagination.
 */

import { KNOWN_BOT_LOGINS, AI_BOT_AUTHORS } from "@shared/constants";

// ─── GitHub API response shapes ───

export interface GHPull {
  number: number;
  title: string;
  body: string | null;
  created_at: string;
  merged_at: string | null;
  state: string;
  head: { ref: string };
  user: { login: string; type: string } | null;
}

export interface GHPRDetail {
  number: number;
  additions: number;
  deletions: number;
  changed_files: number;
  user: { login: string; type: string } | null;
}

export interface GHReview {
  submitted_at: string;
  state: string;
  user: { login: string; type: string } | null;
  author_association: string;
}

// KNOWN_BOT_LOGINS imported from @shared/constants

/** Returns true if a review was submitted by a bot account */
export function isBot(review: GHReview): boolean {
  if (!review.user) return false;
  if (review.user.type === "Bot") return true;
  const login = review.user.login.toLowerCase();
  if (login.endsWith("[bot]")) return true;
  return KNOWN_BOT_LOGINS.has(login);
}

export interface GHCommit {
  commit: {
    message: string;
  };
}

export interface GHRelease {
  published_at: string;
}

export interface GHCopilotMetric {
  date: string;
  total_active_users: number;
  total_engaged_users: number;
  copilot_ide_chat?: {
    total_chats?: number;
  };
}

// ─── Internal fetch helper ───

async function ghFetch<T>(token: string, path: string, maxPages = 50): Promise<T[]> {
  const results: T[] = [];
  let url: string | null = `https://api.github.com${path}`;
  let pages = 0;

  while (url && pages < maxPages) {
    pages++;
    const resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`GitHub API ${resp.status}: ${text}`);
    }

    const page = (await resp.json()) as T[];
    results.push(...page);

    // Follow Link: <url>; rel="next" pagination
    const link = resp.headers.get("Link") ?? "";
    const next = link.match(/<([^>]+)>;\s*rel="next"/);
    url = next ? next[1] : null;
  }

  return results;
}

async function ghFetchOne<T>(token: string, path: string): Promise<T> {
  const resp = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`GitHub API ${resp.status}: ${text}`);
  }

  return resp.json() as Promise<T>;
}

// ─── Public API ───

/** Fetch currently open PRs for a repo (for backlog projection). Caps at 10 pages (1000 PRs). */
export async function fetchOpenPRs(
  token: string,
  repo: string,
): Promise<GHPull[]> {
  return ghFetch<GHPull>(
    token,
    `/repos/${repo}/pulls?state=open&per_page=100&sort=created&direction=desc`,
    10,
  );
}

/** Fetch closed (merged) PRs since the given ISO date string */
export async function fetchMergedPRs(
  token: string,
  repo: string,
  since: string,
): Promise<GHPull[]> {
  // GitHub pulls endpoint doesn't filter by merged_at, but `since` filters by
  // updated_at — this avoids paginating through ancient PRs on incremental syncs.
  const pulls = await ghFetch<GHPull>(
    token,
    `/repos/${repo}/pulls?state=closed&per_page=100&sort=updated&direction=desc&since=${encodeURIComponent(since)}`,
    20,
  );
  return pulls.filter(
    (p) => p.merged_at !== null && p.merged_at >= since,
  );
}

/** Fetch additions/deletions/changed_files for a specific PR */
export async function fetchPRDetails(
  token: string,
  repo: string,
  prNumber: number,
): Promise<GHPRDetail> {
  return ghFetchOne<GHPRDetail>(token, `/repos/${repo}/pulls/${prNumber}`);
}

/** Fetch all reviews for a PR */
export async function fetchPRReviews(
  token: string,
  repo: string,
  prNumber: number,
): Promise<GHReview[]> {
  return ghFetch<GHReview>(token, `/repos/${repo}/pulls/${prNumber}/reviews`, 5);
}

/** Fetch commits for a PR (used for AI signature scanning) */
export async function fetchPRCommits(
  token: string,
  repo: string,
  prNumber: number,
): Promise<GHCommit[]> {
  return ghFetch<GHCommit>(token, `/repos/${repo}/pulls/${prNumber}/commits`, 5);
}

/** Fetch recent releases for deploy-frequency metric */
export async function fetchReleases(
  token: string,
  repo: string,
): Promise<GHRelease[]> {
  return ghFetch<GHRelease>(token, `/repos/${repo}/releases?per_page=30`, 3);
}

/** Fetch Copilot org-level daily metrics (requires read:org scope) */
export async function fetchCopilotMetrics(
  token: string,
  org: string,
): Promise<GHCopilotMetric[]> {
  return ghFetch<GHCopilotMetric>(token, `/orgs/${org}/copilot/metrics`);
}

// ─── AI tool detection ───

const AI_PATTERNS: Array<{ tool: string; patterns: RegExp[] }> = [
  {
    tool: "claude",
    patterns: [
      /co-authored-by:.*claude/i,
      /🤖 generated with (?:\[)?claude(?: code)?/i,
      /noreply@anthropic\.com/i,
    ],
  },
  {
    tool: "copilot",
    patterns: [
      /co-authored-by:.*copilot/i,
      /agent-logs-url:/i,
    ],
  },
  {
    tool: "cursor",
    patterns: [
      /co-authored-by:.*cursor/i,
      /generated by cursor/i,
      /cursor\.sh/i,
    ],
  },
  {
    tool: "aider",
    patterns: [
      /co-authored-by:.*aider/i,
      /noreply@aider\.chat/i,
      /\(aider\)/i,
      /^aider:/m,
    ],
  },
  {
    tool: "devin",
    patterns: [
      /devin-ai-integration/i,
      /app\.devin\.ai/i,
    ],
  },
  {
    tool: "codex",
    patterns: [
      /co-authored-by:.*codex/i,
      /openai codex/i,
    ],
  },
  {
    tool: "amazon-q",
    patterns: [
      /amazon-q-developer/i,
      /co-authored-by:.*amazon q/i,
    ],
  },
  {
    tool: "sweep",
    patterns: [
      /sweep-ai\[bot\]/i,
    ],
  },
  {
    tool: "windsurf",
    patterns: [
      /co-authored-by:.*windsurf/i,
      /co-authored-by:.*codeium/i,
      /generated by windsurf/i,
      /generated by codeium/i,
    ],
  },
];

// AI_BOT_AUTHORS imported from @shared/constants

/**
 * Scan PR body, commit messages, branch name, and PR author for AI tool signatures.
 * Returns deduplicated array of matched tool names.
 */
export function detectAITools(
  prBody: string | null,
  commitMessages: string[],
  branch?: string | null,
  prAuthor?: string | null,
): string[] {
  const haystack = [prBody ?? "", ...commitMessages, branch ?? ""].join("\n");
  const found = new Set<string>();

  // Check if the PR was authored by a known AI bot
  if (prAuthor) {
    const botTool = AI_BOT_AUTHORS.get(prAuthor.toLowerCase());
    if (botTool) found.add(botTool);
  }

  // Check branch prefix for Sweep
  if (branch?.startsWith("sweep/")) found.add("sweep");

  for (const { tool, patterns } of AI_PATTERNS) {
    if (patterns.some((re) => re.test(haystack))) {
      found.add(tool);
    }
  }

  return Array.from(found);
}

// ─── AI review tool detection ───

/** Known AI review bot accounts (login → display name) */
const AI_REVIEW_BOTS = new Map<string, string>([
  ["coderabbitai[bot]", "coderabbit"],
  ["coderabbitai", "coderabbit"],
  ["cursor[bot]", "cursor"],
  ["copilot-swe-agent[bot]", "copilot"],
  ["copilot[bot]", "copilot"],
  ["claude-code-review[bot]", "claude"],
  ["github-actions[bot]", "github-actions"],
  ["amazon-q-developer[bot]", "amazon-q"],
  ["devin-ai-integration[bot]", "devin"],
  ["sonarcloud[bot]", "sonarcloud"],
  ["codeclimate[bot]", "codeclimate"],
]);

/** Check if a login belongs to a known AI review bot. Returns tool name or null. */
export function getAIReviewTool(login: string): string | null {
  const lower = login.toLowerCase();
  const direct = AI_REVIEW_BOTS.get(lower);
  if (direct) return direct;
  // Fallback patterns for [bot] accounts
  if (lower.endsWith("[bot]")) {
    if (lower.includes("coderabbit")) return "coderabbit";
    if (lower.includes("cursor")) return "cursor";
    if (lower.includes("claude")) return "claude";
    if (lower.includes("copilot")) return "copilot";
    if (lower.includes("tabnine")) return "tabnine";
    if (lower.includes("windsurf")) return "windsurf";
  }
  return null;
}

/**
 * Detect which AI tools reviewed a PR based on reviewer logins.
 * Returns deduplicated array of AI review tool names.
 */
export function detectAIReviewers(reviews: GHReview[]): string[] {
  const found = new Set<string>();
  for (const r of reviews) {
    if (!r.user) continue;
    const tool = getAIReviewTool(r.user.login);
    if (tool) found.add(tool);
  }
  return Array.from(found);
}

// ─── Review comment types ───

export interface GHReviewComment {
  id: number;
  user: { login: string; type: string } | null;
  body: string;
  path: string;
  created_at: string;
}

/** Fetch line-level review comments for a PR. */
export async function fetchPRReviewComments(
  token: string,
  repo: string,
  prNumber: number,
): Promise<GHReviewComment[]> {
  return ghFetch<GHReviewComment>(
    token,
    `/repos/${repo}/pulls/${prNumber}/comments?per_page=100`,
    5,
  );
}

/** Classify a review comment into category + severity. */
export function classifyReviewComment(
  tool: string,
  body: string,
): { category: string; severity: string } {
  const lower = body.toLowerCase();

  // ── Tool-specific parsing ──

  // Cursor Bugbot: "**High Severity**", "**Medium Severity**", "**Low Severity**"
  let severity = "info";
  if (tool === "cursor") {
    if (/\*\*high\s+severity\*\*/i.test(body)) severity = "high";
    else if (/\*\*medium\s+severity\*\*/i.test(body)) severity = "medium";
    else if (/\*\*low\s+severity\*\*/i.test(body)) severity = "low";
    else severity = "info";
  }

  // CodeRabbit: "_🟠 Major_", "_🔴 Critical_", "_🟡 Minor_"
  if (tool === "coderabbit") {
    if (lower.includes("critical") || body.includes("🔴")) severity = "high";
    else if (lower.includes("major") || body.includes("🟠")) severity = "medium";
    else if (lower.includes("minor") || body.includes("🟡")) severity = "low";
    else severity = "info";
  }

  // Copilot / Claude: generic severity detection
  if (severity === "info" && tool !== "cursor" && tool !== "coderabbit") {
    if (lower.includes("critical") || lower.includes("vulnerability")) severity = "high";
    else if (lower.includes("warning") || lower.includes("issue")) severity = "medium";
    else if (lower.includes("suggestion") || lower.includes("nit")) severity = "low";
  }

  // ── Category classification (keyword-based) ──
  let category = "other";
  if (/security|vulnerab|xss|injection|auth|csrf|secret|credential/i.test(body)) category = "security";
  else if (/type[- ]?safe|type\s+error|typescript|type\s+mismatch|generic|any\b/i.test(body)) category = "type-safety";
  else if (/performance|O\(n|complex|slow|optimi[zs]|memo|cache|render/i.test(body)) category = "perf";
  else if (/bug|error|crash|null|undefined|race\s+condition|deadlock|off[- ]by/i.test(body)) category = "bug";
  else if (/logic|condition|branch|edge\s+case|incorrect|wrong/i.test(body)) category = "logic";
  else if (/style|naming|format|convention|readab|lint|spell/i.test(body)) category = "style";

  return { category, severity };
}
