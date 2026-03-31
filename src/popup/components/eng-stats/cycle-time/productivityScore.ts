/**
 * Multi-dimensional productivity scoring system.
 *
 * 3 sub-scores + 1 composite, each 0-100:
 *
 * Velocity: shipping speed & throughput
 *   - Throughput 35% (PRs/week)
 *   - Speed 30% (inverse cycle time)
 *   - Review responsiveness 20% (inverse first review time)
 *   - Consistency 15% (active weeks ratio)
 *
 * Quality: clean, well-sized, durable PRs
 *   - PR sizing 35% (inverse PR size — smaller is better)
 *   - Non-revert rate 30% (revert penalty)
 *   - Code efficiency 20% (deletion ratio — cleanup is valuable)
 *   - Focus 15% (inverse files changed)
 *
 * Impact: meaningful, substantive contribution
 *   - Capped volume 30% (adds*1.0 + dels*0.6 + files*15, capped at 800/PR)
 *   - Non-trivial ratio 25% (PRs > 50 lines / total)
 *   - Component breadth 10% (distinct Jira components)
 *   - Ticket throughput 10% (Jira tickets closed in period)
 *   - Sustained output 25% (PRs * (1 - revert_rate)^2)
 *
 * Overall: 0.35 * Velocity + 0.35 * Impact + 0.30 * Quality
 */

import type { PersonRow, ProductivityScores } from "../shared";
import { weekKey } from "../shared";
import type { PRMetric, JiraTicket } from "@shared/types";

const MIN_AUTHORS = 5;

// ─── Percentile helpers ───

function percentileRank(value: number, allValues: number[]): number {
  if (allValues.length <= 1) return 50;
  const below = allValues.filter((v) => v < value).length;
  const equal = allValues.filter((v) => v === value).length;
  return ((below + equal * 0.5) / allValues.length) * 100;
}

/** Percentile rank where lower raw value = higher score */
function percentileRankInverse(value: number, allValues: number[]): number {
  return 100 - percentileRank(value, allValues);
}

// ─── Per-author raw metrics ───

interface AuthorRaw {
  author: string;
  prsPerWeek: number;
  avgCycleHours: number;
  avgFirstReviewHours: number;
  activeWeeksRatio: number;
  revertCount: number;
  avgPRSize: number;
  deletionRatio: number;
  avgChangedFiles: number;
  weightedVolume: number;
  nontrivialRatio: number;
  componentBreadth: number;
  sustainedOutput: number;
  ticketsClosedPerWeek: number;
  ticketThroughput: number;
}

function computeAuthorRaws(
  rows: PersonRow[],
  metrics: PRMetric[],
  prToTickets: Map<number, JiraTicket[]>,
  timeRange: number,
  authorTickets: Map<string, JiraTicket[]> = new Map(),
): AuthorRaw[] {
  const totalWeeks = Math.max(4, Math.ceil(timeRange / 7));

  // Group metrics by author
  const byAuthor = new Map<string, PRMetric[]>();
  for (const m of metrics) {
    if (!m.author) continue;
    if (!byAuthor.has(m.author)) byAuthor.set(m.author, []);
    byAuthor.get(m.author)!.push(m);
  }

  return rows.map((r) => {
    const prs = byAuthor.get(r.author) ?? [];
    const merged = prs.filter((p) => p.mergedAt);

    // Active weeks
    const weeks = new Set(merged.map((p) => weekKey(new Date(p.mergedAt!))));

    // Revert count
    const revertCount = prs.filter((p) => p.isRevert).length;
    const revertRate = prs.length > 0 ? revertCount / prs.length : 0;

    // Deletion ratio
    const totalAdds = prs.reduce((s, p) => s + p.additions, 0);
    const totalDels = prs.reduce((s, p) => s + p.deletions, 0);
    const totalChanges = totalAdds + totalDels;
    const deletionRatio = totalChanges > 0 ? totalDels / totalChanges : 0;

    // Avg changed files
    const avgChangedFiles = prs.length > 0
      ? prs.reduce((s, p) => s + p.changedFiles, 0) / prs.length
      : 0;

    // Weighted volume — cap each PR at 800 lines equivalent so giant PRs
    // don't dominate. 10 small PRs should score higher than 1 massive PR.
    const PR_CAP = 800;
    const weightedVolume = prs.reduce(
      (s, p) => s + Math.min(PR_CAP, p.additions * 1.0 + p.deletions * 0.6 + p.changedFiles * 15),
      0,
    );

    // Non-trivial ratio (PRs where adds+dels > 50)
    const nontrivial = prs.filter((p) => p.additions + p.deletions > 50).length;
    const nontrivialRatio = prs.length > 0 ? nontrivial / prs.length : 0;

    // Component breadth (distinct Jira components)
    const components = new Set<string>();
    for (const p of prs) {
      const tickets = prToTickets.get(p.id!);
      const comp = tickets?.[0]?.component;
      if (comp) components.add(comp);
    }

    // Sustained output: prs * (1 - revert_rate)^2
    const sustainedOutput = prs.length * Math.pow(1 - revertRate, 2);

    // Ticket metrics from JIRA assignee data
    const myTickets = authorTickets.get(r.author) ?? [];
    const closedTickets = myTickets.filter((t) => t.statusCategory === "done");
    const ticketsClosedPerWeek = closedTickets.length / totalWeeks;
    const ticketThroughput = closedTickets.length;

    return {
      author: r.author,
      prsPerWeek: r.prsPerWeek,
      avgCycleHours: r.avgCycleHours ?? 9999,
      avgFirstReviewHours: prs.length > 0
        ? prs.reduce((s, p) => s + (p.timeToFirstReviewHours ?? 0), 0) / prs.filter((p) => p.timeToFirstReviewHours !== null).length || 9999
        : 9999,
      activeWeeksRatio: weeks.size / totalWeeks,
      revertCount,
      avgPRSize: r.avgPRSize,
      deletionRatio,
      avgChangedFiles,
      weightedVolume,
      nontrivialRatio,
      componentBreadth: components.size,
      sustainedOutput,
      ticketsClosedPerWeek,
      ticketThroughput,
    };
  });
}

// ─── Score computation ───

function computeVelocity(raw: AuthorRaw, allRaws: AuthorRaw[]): number {
  return (
    0.35 * percentileRank(raw.prsPerWeek, allRaws.map((r) => r.prsPerWeek)) +
    0.30 * percentileRankInverse(raw.avgCycleHours, allRaws.map((r) => r.avgCycleHours)) +
    0.20 * percentileRankInverse(raw.avgFirstReviewHours, allRaws.map((r) => r.avgFirstReviewHours)) +
    0.15 * percentileRank(raw.activeWeeksRatio, allRaws.map((r) => r.activeWeeksRatio))
  );
}

function revertScore(count: number): number {
  if (count === 0) return 90;
  if (count === 1) return 60;
  return Math.max(0, 90 - 30 * count);
}

function computeQuality(raw: AuthorRaw, allRaws: AuthorRaw[]): number {
  const revertScores = allRaws.map((r) => revertScore(r.revertCount));
  const thisRevertScore = revertScore(raw.revertCount);

  return (
    0.30 * percentileRank(thisRevertScore, revertScores) +
    0.35 * percentileRankInverse(raw.avgPRSize, allRaws.map((r) => r.avgPRSize)) +
    0.20 * percentileRank(raw.deletionRatio, allRaws.map((r) => r.deletionRatio)) +
    0.15 * percentileRankInverse(raw.avgChangedFiles, allRaws.map((r) => r.avgChangedFiles))
  );
}

function computeImpact(raw: AuthorRaw, allRaws: AuthorRaw[]): number {
  return (
    0.30 * percentileRank(raw.weightedVolume, allRaws.map((r) => r.weightedVolume)) +
    0.25 * percentileRank(raw.nontrivialRatio, allRaws.map((r) => r.nontrivialRatio)) +
    0.10 * percentileRank(raw.componentBreadth, allRaws.map((r) => r.componentBreadth)) +
    0.10 * percentileRank(raw.ticketThroughput, allRaws.map((r) => r.ticketThroughput)) +
    0.25 * percentileRank(raw.sustainedOutput, allRaws.map((r) => r.sustainedOutput))
  );
}

// ─── Public API ───

export function applyProductivityScores(
  rows: PersonRow[],
  metrics: PRMetric[],
  prToTickets: Map<number, JiraTicket[]>,
  timeRange: number,
  authorTickets: Map<string, JiraTicket[]> = new Map(),
): PersonRow[] {
  if (rows.length < MIN_AUTHORS) return rows;

  const allRaws = computeAuthorRaws(rows, metrics, prToTickets, timeRange, authorTickets);

  return rows.map((r, i) => {
    const raw = allRaws[i];
    const velocity = Math.round(computeVelocity(raw, allRaws));
    const quality = Math.round(computeQuality(raw, allRaws));
    const impact = Math.round(computeImpact(raw, allRaws));
    const overall = Math.round(0.35 * velocity + 0.35 * impact + 0.30 * quality);

    return { ...r, scores: { velocity, quality, impact, overall } };
  });
}

// ─── Tooltip descriptions ───

export const SCORE_TOOLTIPS = {
  velocity: "Throughput (35%): PRs/week. Speed (30%): inverse cycle time. Review responsiveness (20%): how fast first reviews happen. Consistency (15%): weeks with activity.",
  quality: "PR sizing (35%): smaller PRs = fewer defects. Non-revert rate (30%): PRs that don't get reverted. Code efficiency (20%): deletion ratio. Focus (15%): fewer files per PR.",
  impact: "Capped volume (30%): code output with per-PR cap at 800 lines — 10 small PRs beat 1 giant PR. Non-trivial ratio (25%): substantive vs trivial PRs. Breadth (10%): cross-component work. Ticket throughput (10%): Jira tickets closed. Sustained output (25%): volume adjusted for reverts.",
  overall: "Balanced composite: Velocity (35%) + Impact (35%) + Quality (30%). AI adoption shown separately. Score tiers: 65+ Elite (green) · 55–64 Good (blue) · 45–54 Average (gray) · <45 Needs Attention (red).",
} as const;
