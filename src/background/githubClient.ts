/**
 * Thin GitHub REST API client for Eng Stats.
 * All functions accept a PAT and return typed responses.
 * Handles rate-limit headers and Link-header pagination.
 */

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

const KNOWN_BOT_LOGINS = new Set([
  "dependabot", "renovate", "codecov", "sonarcloud", "coderabbitai",
  "github-actions", "mergify", "snyk-bot", "depfu", "greenkeeper",
  "imgbot", "allcontributors", "stale", "netlify", "vercel",
]);

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

async function ghFetch<T>(token: string, path: string): Promise<T[]> {
  const results: T[] = [];
  let url: string | null = `https://api.github.com${path}`;

  while (url) {
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

/** Fetch closed (merged) PRs since the given ISO date string */
export async function fetchMergedPRs(
  token: string,
  repo: string,
  since: string,
): Promise<GHPull[]> {
  const pulls = await ghFetch<GHPull>(
    token,
    `/repos/${repo}/pulls?state=closed&per_page=100&sort=updated&direction=desc`,
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
  return ghFetch<GHReview>(token, `/repos/${repo}/pulls/${prNumber}/reviews`);
}

/** Fetch commits for a PR (used for AI signature scanning) */
export async function fetchPRCommits(
  token: string,
  repo: string,
  prNumber: number,
): Promise<GHCommit[]> {
  return ghFetch<GHCommit>(token, `/repos/${repo}/pulls/${prNumber}/commits`);
}

/** Fetch recent releases for deploy-frequency metric */
export async function fetchReleases(
  token: string,
  repo: string,
): Promise<GHRelease[]> {
  return ghFetch<GHRelease>(token, `/repos/${repo}/releases?per_page=30`);
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
      /codeium/i,
      /windsurf/i,
    ],
  },
];

/** Known AI bot accounts that author PRs directly */
const AI_BOT_AUTHORS = new Map<string, string>([
  ["copilot-swe-agent[bot]", "copilot"],
  ["devin-ai-integration[bot]", "devin"],
  ["amazon-q-developer[bot]", "amazon-q"],
  ["sweep-ai[bot]", "sweep"],
]);

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
  ["coderabbitai", "coderabbit"],
  ["github-actions[bot]", "github-actions"],
  ["copilot-swe-agent[bot]", "copilot"],
  ["amazon-q-developer[bot]", "amazon-q"],
  ["devin-ai-integration[bot]", "devin"],
  ["cursorbot", "cursor"],
  ["sonarcloud[bot]", "sonarcloud"],
  ["codeclimate[bot]", "codeclimate"],
]);

/**
 * Detect which AI tools reviewed a PR based on reviewer logins.
 * Returns deduplicated array of AI review tool names.
 */
export function detectAIReviewers(reviews: GHReview[]): string[] {
  const found = new Set<string>();
  for (const r of reviews) {
    if (!r.user) continue;
    const login = r.user.login.toLowerCase();
    const tool = AI_REVIEW_BOTS.get(login);
    if (tool) found.add(tool);
    // Also catch any [bot] reviewer with "ai" or known tool name in their login
    if (login.endsWith("[bot]")) {
      if (login.includes("coderabbit")) found.add("coderabbit");
      if (login.includes("tabnine")) found.add("tabnine");
      if (login.includes("windsurf")) found.add("windsurf");
    }
  }
  return Array.from(found);
}
