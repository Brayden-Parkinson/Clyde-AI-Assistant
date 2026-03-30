/**
 * Productivity Score — composite 0-100 score from PR data.
 *
 * Dimensions (all percentile-ranked within the cohort):
 *   Throughput  (25%) — PRs merged per week
 *   Efficiency  (25%) — inverse avg cycle time
 *   Volume      (15%) — log2(additions + 1)
 *   Consistency (20%) — weeks with ≥1 PR / total weeks
 *   AI Adoption (15%) — % of PRs that are AI-assisted
 *
 * Returns null for all authors when cohort has <5 members.
 */

import type { PersonRow } from "../shared";
import { weekKey } from "../shared";
import type { PRMetric } from "@shared/types";

const WEIGHTS = {
  throughput: 0.25,
  efficiency: 0.25,
  volume: 0.15,
  consistency: 0.20,
  aiAdoption: 0.15,
} as const;

const MIN_AUTHORS = 5;

function percentileRank(value: number, allValues: number[]): number {
  if (allValues.length <= 1) return 50;
  const below = allValues.filter((v) => v < value).length;
  const equal = allValues.filter((v) => v === value).length;
  // Midpoint percentile: handles ties gracefully
  return ((below + equal * 0.5) / allValues.length) * 100;
}

interface AuthorWeeklyActivity {
  author: string;
  weeksWithPRs: number;
}

export function computeWeeklyActivity(
  metrics: PRMetric[],
  timeRange: number,
): Map<string, number> {
  const totalWeeks = Math.max(4, Math.ceil(timeRange / 7));
  const authorWeeks = new Map<string, Set<string>>();
  for (const m of metrics) {
    if (!m.author || !m.mergedAt) continue;
    if (!authorWeeks.has(m.author)) authorWeeks.set(m.author, new Set());
    authorWeeks.get(m.author)!.add(weekKey(new Date(m.mergedAt)));
  }
  const result = new Map<string, number>();
  for (const [author, weeks] of authorWeeks) {
    result.set(author, weeks.size / totalWeeks);
  }
  return result;
}

export function applyProductivityScores(
  rows: PersonRow[],
  metrics: PRMetric[],
  timeRange: number,
): PersonRow[] {
  if (rows.length < MIN_AUTHORS) return rows;

  const weeklyActivity = computeWeeklyActivity(metrics, timeRange);

  // Extract raw dimension values
  const throughputs = rows.map((r) => r.prsPerWeek);
  const efficiencies = rows.map((r) =>
    r.avgCycleHours !== null && r.avgCycleHours > 0 ? 1 / r.avgCycleHours : 0,
  );
  const volumes = rows.map((r) => Math.log2(r.totalAdditions + 1));
  const consistencies = rows.map((r) => weeklyActivity.get(r.author) ?? 0);
  const aiAdoptions = rows.map((r) => r.aiPct / 100);

  return rows.map((r, i) => {
    const score =
      percentileRank(throughputs[i], throughputs) * WEIGHTS.throughput +
      percentileRank(efficiencies[i], efficiencies) * WEIGHTS.efficiency +
      percentileRank(volumes[i], volumes) * WEIGHTS.volume +
      percentileRank(consistencies[i], consistencies) * WEIGHTS.consistency +
      percentileRank(aiAdoptions[i], aiAdoptions) * WEIGHTS.aiAdoption;

    return { ...r, productivityScore: Math.round(score) };
  });
}
