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
    .map(([key, vals]) => ({
      label: weekLabel(new Date(key + "T12:00:00")),
      avgHours: vals.reduce((a, b) => a + b, 0) / vals.length,
      count: vals.length,
    }))
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
      byWeek.get(key)!.push(biz / 24);
    }
    const weekly = Array.from(byWeek.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([, vals]) => vals.reduce((a, b) => a + b, 0) / vals.length)
      .slice(-6);
    result.set(team, weekly);
  }
  return result;
}
