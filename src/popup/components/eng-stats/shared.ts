/**
 * Shared types, helpers, and constants used across Eng Stats tab components.
 */

import type { PRMetric, JiraTicket } from "@shared/types";

// ─── Shared types ───

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

export type SectionId = "kpis" | "cycleTime" | "aiAdoption" | "prSize" | "toolUsage" | "projection";
export type KpiId = "cycletime" | "medreview" | "prsmerged" | "aiassisted" | "leadtime";
export type TeamColumnId = "prs" | "cycle" | "medReview" | "avgLines" | "ai" | "trend";

export interface KpiDisplayConfig {
  delta: boolean;
  sparkline: boolean;
  subtitle: boolean;
}

export interface EngStatsConfig {
  visibleSections: SectionId[];
  kpiOrder: KpiId[];
  kpiDisplay: Record<KpiId, KpiDisplayConfig>;
  teamColumns: TeamColumnId[];
}

// ─── Shared props passed to all tab components ───

export interface TabProps {
  darkMode: boolean;
  metrics: PRMetric[];
  allMetrics: PRMetric[];
  timeRange: number;
  selectedRepo: string;
  prToTickets: Map<number, JiraTicket[]>;
}

// ─── Color maps ───

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

// ─── Helpers ───

export const dk = (dark: boolean, d: string, l: string) => (dark ? d : l);

export function daysAgoISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function isWeekday(isoDate: string): boolean {
  const day = new Date(isoDate).getDay();
  return day !== 0 && day !== 6;
}

export function businessDaysInRange(totalDays: number): number {
  const fullWeeks = Math.floor(totalDays / 7);
  const remainder = totalDays % 7;
  let bizDays = fullWeeks * 5;
  const today = new Date().getDay(); // 0=Sun..6=Sat
  for (let i = 0; i < remainder; i++) {
    const d = ((today - remainder + i) % 7 + 7) % 7;
    if (d !== 0 && d !== 6) bizDays++;
  }
  return Math.max(bizDays, 1); // avoid div-by-zero
}

export function weekendDaysBetween(startISO: string, endISO: string): number {
  const start = new Date(startISO);
  const end = new Date(endISO);
  let count = 0;
  const d = new Date(start);
  d.setHours(0, 0, 0, 0);
  while (d < end) {
    const dow = d.getDay();
    if (dow === 0 || dow === 6) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

export function toBusinessHours(rawHours: number, startISO: string, endISO: string): number {
  const weekendHours = weekendDaysBetween(startISO, endISO) * 24;
  return Math.max(0, rawHours - weekendHours);
}

export function removeOutliers(values: number[]): number[] {
  if (values.length < 4) return values;
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  const iqr = q3 - q1;
  const lower = q1 - 1.5 * iqr;
  const upper = q3 + 1.5 * iqr;
  return values.filter((v) => v >= lower && v <= upper);
}

export function fmtHours(h: number | null): string {
  if (h === null || isNaN(h)) return "—";
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 24) return `${h.toFixed(1)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

export function weekLabel(date: Date): string {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

export function weekKey(d: Date): string {
  const day = d.getDay();
  const diff = (day + 6) % 7;
  const monday = new Date(d);
  monday.setDate(d.getDate() - diff);
  return monday.toISOString().slice(0, 10);
}

export function linearRegression(values: number[]): { slope: number; intercept: number } {
  const n = values.length;
  if (n < 2) return { slope: 0, intercept: values[0] ?? 0 };
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i; sumY += values[i]; sumXY += i * values[i]; sumX2 += i * i;
  }
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return { slope: 0, intercept: sumY / n };
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

export function predictPoints(values: number[], count: number): number[] {
  const { slope, intercept } = linearRegression(values);
  const n = values.length;
  return Array.from({ length: count }, (_, i) => {
    const predicted = intercept + slope * (n + i);
    return Math.max(0, predicted);
  });
}

// ─── Cycle Time expansion types ───

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

// PR size buckets (LinearB benchmarks)
export const PR_SIZE_BUCKETS = [
  { label: "S (<194)", max: 194, color: "#10B981" },
  { label: "M (194–400)", max: 400, color: "#3B82F6" },
  { label: "L (400–800)", max: 800, color: "#F97316" },
  { label: "XL (800+)", max: Infinity, color: "#EF4444" },
] as const;

// ─── Cycle Time compute helpers ───

function groupByComponent(
  metrics: PRMetric[],
  prToTickets: Map<number, JiraTicket[]>,
): Map<string, PRMetric[]> {
  const map = new Map<string, PRMetric[]>();
  for (const m of metrics) {
    const tickets = prToTickets.get(m.id!);
    if (!tickets?.length) continue;
    const comp = tickets[0].component ?? "No Component";
    if (!map.has(comp)) map.set(comp, []);
    map.get(comp)!.push(m);
  }
  return map;
}

function avgBizCycleHours(prs: PRMetric[]): number | null {
  const vals = removeOutliers(
    prs.filter((p) => p.cycleTimeHours !== null && p.mergedAt)
      .map((p) => toBusinessHours(p.cycleTimeHours!, p.createdAt, p.mergedAt!)),
  );
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

function medBizCycleHours(prs: PRMetric[]): number | null {
  const vals = prs
    .filter((p) => p.cycleTimeHours !== null && p.mergedAt)
    .map((p) => toBusinessHours(p.cycleTimeHours!, p.createdAt, p.mergedAt!));
  return vals.length ? median(vals) : null;
}

function avgFirstReview(prs: PRMetric[]): number | null {
  const vals = removeOutliers(
    prs.filter((p) => p.timeToFirstReviewHours !== null)
      .map((p) => {
        const end = new Date(new Date(p.createdAt).getTime() + p.timeToFirstReviewHours! * 3600000).toISOString();
        return toBusinessHours(p.timeToFirstReviewHours!, p.createdAt, end);
      }),
  );
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

function avgReviewDays(prs: PRMetric[]): number {
  const vals = prs.filter((p) => p.reviewRounds > 0).map((p) => p.reviewRounds);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
}

function weeklyTrendForPRs(prs: PRMetric[]): number[] {
  const byWeek = new Map<string, number[]>();
  for (const m of prs) {
    if (!m.mergedAt || m.cycleTimeHours === null) continue;
    const biz = toBusinessHours(m.cycleTimeHours, m.createdAt, m.mergedAt);
    const key = weekKey(new Date(m.mergedAt));
    if (!byWeek.has(key)) byWeek.set(key, []);
    byWeek.get(key)!.push(biz);
  }
  return Array.from(byWeek.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, vals]) => vals.reduce((a, b) => a + b, 0) / vals.length)
    .slice(-6);
}

export function computeComponentCycleRows(
  metrics: PRMetric[],
  prToTickets: Map<number, JiraTicket[]>,
): ComponentCycleRow[] {
  const byComp = groupByComponent(metrics, prToTickets);
  return Array.from(byComp.entries())
    .sort((a, b) => b[1].length - a[1].length)
    .map(([component, prs]) => {
      const prsByType: Record<string, number> = {};
      for (const m of prs) {
        const tickets = prToTickets.get(m.id!);
        const issueType = tickets?.[0]?.issueType ?? "Unknown";
        prsByType[issueType] = (prsByType[issueType] ?? 0) + 1;
      }
      return {
        component,
        prCount: prs.length,
        avgCycleHours: avgBizCycleHours(prs),
        medCycleHours: medBizCycleHours(prs),
        avgFirstReviewHours: avgFirstReview(prs),
        avgReviewDays: avgReviewDays(prs),
        avgSize: prs.length ? Math.round(prs.reduce((a, p) => a + p.additions + p.deletions, 0) / prs.length) : 0,
        aiPct: prs.length ? Math.round((prs.filter((p) => p.aiAssisted).length / prs.length) * 100) : 0,
        weeklyTrend: weeklyTrendForPRs(prs),
        prsByType,
      };
    });
}

export function computePersonRows(
  metrics: PRMetric[],
  prToTickets: Map<number, JiraTicket[]>,
  timeRange: number,
): PersonRow[] {
  const weeksInRange = Math.max(1, Math.ceil(timeRange / 7));
  const byAuthor = new Map<string, PRMetric[]>();
  let nullAuthorCount = 0;
  for (const m of metrics) {
    if (!m.author) { nullAuthorCount++; continue; }
    if (!byAuthor.has(m.author)) byAuthor.set(m.author, []);
    byAuthor.get(m.author)!.push(m);
  }

  const rows: PersonRow[] = [];
  for (const [author, prs] of byAuthor) {
    if (prs.length < 2) continue;
    const totalAdditions = prs.reduce((a, p) => a + p.additions, 0);
    const totalDeletions = prs.reduce((a, p) => a + p.deletions, 0);

    // Find most common Jira component
    const compCounts = new Map<string, number>();
    for (const m of prs) {
      const tickets = prToTickets.get(m.id!);
      const comp = tickets?.[0]?.component;
      if (comp) compCounts.set(comp, (compCounts.get(comp) ?? 0) + 1);
    }
    let primaryTeam: string | null = null;
    let maxCount = 0;
    for (const [comp, count] of compCounts) {
      if (count > maxCount) { primaryTeam = comp; maxCount = count; }
    }

    rows.push({
      author,
      prCount: prs.length,
      prsPerWeek: prs.length / weeksInRange,
      avgCycleHours: avgBizCycleHours(prs),
      medCycleHours: medBizCycleHours(prs),
      totalAdditions,
      totalDeletions,
      totalLOC: totalAdditions + totalDeletions,
      avgPRSize: Math.round((totalAdditions + totalDeletions) / prs.length),
      aiPct: Math.round((prs.filter((p) => p.aiAssisted).length / prs.length) * 100),
      avgReviewDays: avgReviewDays(prs),
      weeklyTrend: weeklyTrendForPRs(prs),
      primaryTeam,
      scores: null, // filled by productivityScore.ts
    });
  }

  return rows;
}

export function computeCycleTimeAIComparison(metrics: PRMetric[]): CycleTimeAIComparison | null {
  const ai = metrics.filter((m) => m.aiAssisted && m.mergedAt);
  const nonAI = metrics.filter((m) => !m.aiAssisted && m.mergedAt);
  if (ai.length < 3 || nonAI.length < 3) return null;

  const aiAvgCycle = avgBizCycleHours(ai) ?? 0;
  const nonAIAvgCycle = avgBizCycleHours(nonAI) ?? 0;
  const aiAvgReview = avgFirstReview(ai) ?? 0;
  const nonAIAvgReview = avgFirstReview(nonAI) ?? 0;

  const cycleDelta = nonAIAvgCycle > 0 ? ((aiAvgCycle - nonAIAvgCycle) / nonAIAvgCycle) * 100 : 0;
  const reviewDelta = nonAIAvgReview > 0 ? ((aiAvgReview - nonAIAvgReview) / nonAIAvgReview) * 100 : 0;

  return {
    aiPRs: {
      count: ai.length,
      avgCycleHours: aiAvgCycle,
      avgFirstReviewHours: aiAvgReview,
      avgSize: Math.round(ai.reduce((a, p) => a + p.additions + p.deletions, 0) / ai.length),
    },
    nonAIPRs: {
      count: nonAI.length,
      avgCycleHours: nonAIAvgCycle,
      avgFirstReviewHours: nonAIAvgReview,
      avgSize: Math.round(nonAI.reduce((a, p) => a + p.additions + p.deletions, 0) / nonAI.length),
    },
    cycleTimeDeltaPct: cycleDelta,
    firstReviewDeltaPct: reviewDelta,
  };
}

export function computeLOCStats(metrics: PRMetric[], timeRange: number): LOCStatsData {
  const weeksInRange = Math.max(1, Math.ceil(timeRange / 7));
  const totalAdditions = metrics.reduce((a, m) => a + m.additions, 0);
  const totalDeletions = metrics.reduce((a, m) => a + m.deletions, 0);
  const sizes = metrics.map((m) => m.additions + m.deletions);
  const sorted = [...sizes].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const medPRSize = sorted.length
    ? sorted.length % 2 !== 0
      ? sorted[mid]
      : Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : 0;

  const prSizeBuckets = PR_SIZE_BUCKETS.map((b) => ({ label: b.label, count: 0, color: b.color }));
  for (const s of sizes) {
    for (let i = 0; i < PR_SIZE_BUCKETS.length; i++) {
      if (s < PR_SIZE_BUCKETS[i].max) { prSizeBuckets[i].count++; break; }
    }
  }

  // Weekly LOC
  const weeklyMap = new Map<string, { additions: number; deletions: number }>();
  const weeklyCountMap = new Map<string, number>();
  for (const m of metrics) {
    if (!m.mergedAt) continue;
    const key = weekKey(new Date(m.mergedAt));
    const existing = weeklyMap.get(key) ?? { additions: 0, deletions: 0 };
    existing.additions += m.additions;
    existing.deletions += m.deletions;
    weeklyMap.set(key, existing);
    weeklyCountMap.set(key, (weeklyCountMap.get(key) ?? 0) + 1);
  }

  const weeklyLOC = Array.from(weeklyMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, v]) => ({ label: weekLabel(new Date(key + "T12:00:00")), ...v }))
    .slice(-Math.ceil(timeRange / 7));

  const weeklyPRCount = Array.from(weeklyCountMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, count]) => ({ label: weekLabel(new Date(key + "T12:00:00")), count }))
    .slice(-Math.ceil(timeRange / 7));

  return {
    totalAdditions,
    totalDeletions,
    netLOC: totalAdditions - totalDeletions,
    totalPRs: metrics.length,
    avgPRSize: metrics.length ? Math.round((totalAdditions + totalDeletions) / metrics.length) : 0,
    medPRSize,
    prsPerWeek: metrics.length / weeksInRange,
    prSizeBuckets,
    weeklyLOC,
    weeklyPRCount,
  };
}

export function computeProductivityMatrix(personRows: PersonRow[]): MatrixPoint[] {
  if (personRows.length < 3) return [];
  return personRows
    .filter((r) => r.avgCycleHours !== null && r.avgCycleHours > 0)
    .map((r) => ({
      author: r.author,
      x: r.prsPerWeek,
      y: 1 / (r.avgCycleHours! / 24), // efficiency: inverse of cycle time in days
      size: Math.max(6, Math.min(20, Math.log2(r.totalLOC + 1) * 2)),
      aiPct: r.aiPct,
    }));
}

// ─── Computed helpers for team/author data ───

export function computeTeamRows(
  allMetrics: PRMetric[],
  selectedRepo: string,
  prToTickets: Map<number, JiraTicket[]>,
): TeamRow[] {
  const teamStats = new Map<string, PRMetric[]>();
  const unlinked: PRMetric[] = [];
  const source = selectedRepo === "__all__" ? allMetrics : allMetrics.filter((x) => x.repo === selectedRepo);
  const seen = new Set<number>();
  for (const m of source) {
    if (m.id != null && seen.has(m.id)) continue;
    if (m.id != null) seen.add(m.id);
    const tickets = prToTickets.get(m.id!);
    if (!tickets?.length) { unlinked.push(m); continue; }
    const team = tickets[0].component ?? "No Component";
    if (!teamStats.has(team)) teamStats.set(team, []);
    teamStats.get(team)!.push(m);
  }
  const rows = Array.from(teamStats.entries()).sort((a, b) => b[1].length - a[1].length);
  if (unlinked.length > 0) rows.push(["Unlinked", unlinked]);

  return rows.map(([team, prs]) => {
    const ct = removeOutliers(
      prs.filter((p) => p.cycleTimeHours !== null && p.mergedAt)
        .map((p) => toBusinessHours(p.cycleTimeHours!, p.createdAt, p.mergedAt!)),
    );
    const rt = removeOutliers(
      prs.filter((p) => p.timeToFirstReviewHours !== null)
        .map((p) => {
          const reviewEnd = new Date(new Date(p.createdAt).getTime() + p.timeToFirstReviewHours! * 3600000).toISOString();
          return toBusinessHours(p.timeToFirstReviewHours!, p.createdAt, reviewEnd);
        }),
    );
    const avgSize = prs.length ? Math.round(prs.reduce((a, p) => a + p.additions + p.deletions, 0) / prs.length) : 0;
    const aiPctTeam = prs.length ? Math.round((prs.filter((p) => p.aiAssisted).length / prs.length) * 100) : 0;
    const avgCycleHours = ct.length ? ct.reduce((a, b) => a + b, 0) / ct.length : null;
    const medReviewHours = rt.length ? median(rt) : null;
    return { team, prCount: prs.length, avgCycleHours, medReviewHours, avgSize, aiPctTeam };
  });
}

export function computeWeeklyBuckets(metrics: PRMetric[], timeRange: number): WeekBucket[] {
  const buckets: Map<string, number[]> = new Map();
  for (const m of metrics) {
    if (!m.mergedAt || m.cycleTimeHours === null) continue;
    const biz = toBusinessHours(m.cycleTimeHours, m.createdAt, m.mergedAt);
    const key = weekKey(new Date(m.mergedAt));
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(biz);
  }
  return Array.from(buckets.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, vals]) => {
      const cleaned = vals.length >= 4 ? removeOutliers(vals) : vals;
      const avg = cleaned.length > 0
        ? cleaned.reduce((a, b) => a + b, 0) / cleaned.length
        : vals.reduce((a, b) => a + b, 0) / vals.length;
      return {
        label: weekLabel(new Date(key + "T12:00:00")),
        avgHours: avg,
        count: vals.length,
      };
    })
    .slice(-Math.ceil(timeRange / 7));
}

export function computeWeeklyAI(metrics: PRMetric[], timeRange: number): { label: string; pct: number }[] {
  const buckets: Map<string, { ai: number; total: number }> = new Map();
  for (const m of metrics) {
    if (!m.mergedAt) continue;
    const key = weekKey(new Date(m.mergedAt));
    if (!buckets.has(key)) buckets.set(key, { ai: 0, total: 0 });
    const b = buckets.get(key)!;
    b.total++;
    if (m.aiAssisted) b.ai++;
  }
  return Array.from(buckets.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, v]) => ({
      label: weekLabel(new Date(key + "T12:00:00")),
      pct: v.total > 0 ? Math.round((v.ai / v.total) * 100) : 0,
    }))
    .slice(-Math.ceil(timeRange / 7));
}

export function computeTeamWeeklyCycles(
  allMetrics: PRMetric[],
  selectedRepo: string,
  prToTickets: Map<number, JiraTicket[]>,
): Map<string, number[]> {
  const result = new Map<string, number[]>();
  const teamPRs = new Map<string, PRMetric[]>();
  const source = selectedRepo === "__all__" ? allMetrics : allMetrics.filter((x) => x.repo === selectedRepo);
  for (const m of source) {
    const tickets = prToTickets.get(m.id!);
    const team = tickets?.[0]?.component ?? (tickets?.length ? "No Component" : "Unlinked");
    if (!teamPRs.has(team)) teamPRs.set(team, []);
    teamPRs.get(team)!.push(m);
  }
  for (const [team, prs] of teamPRs) {
    const byWeek = new Map<string, number[]>();
    for (const m of prs) {
      if (!m.mergedAt || m.cycleTimeHours === null) continue;
      const biz = toBusinessHours(m.cycleTimeHours, m.createdAt, m.mergedAt);
      const key = weekKey(new Date(m.mergedAt));
      if (!byWeek.has(key)) byWeek.set(key, []);
      byWeek.get(key)!.push(biz);
    }
    const weekly = Array.from(byWeek.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([, vals]) => vals.reduce((a, b) => a + b, 0) / vals.length)
      .slice(-6);
    result.set(team, weekly);
  }
  return result;
}
