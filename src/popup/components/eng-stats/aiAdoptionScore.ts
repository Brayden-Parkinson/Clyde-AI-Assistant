/**
 * Pure computation module for the AI Adoption Score (0-100).
 * No React, no DOM, no DB access — all data arrives pre-queried.
 */

import type { PRMetric, CopilotDailyMetric } from "@shared/types";
import type { AuthorAIRow, TeamRow } from "./shared";
import { isBotAuthor } from "@shared/constants";
import { removeOutliers, toBusinessHours } from "./shared";

// ─── Types ───

export type MaturityTier = "minimal" | "early" | "growing" | "strong" | "ai-first";

export interface MetricDetail {
  name: string;
  value: number;
  max: number;
  weight: number;
  available: boolean;
}

export interface PillarScore {
  score: number;
  metrics: MetricDetail[];
}

export interface ActionItem {
  priority: "high" | "medium" | "low";
  message: string;
  metric: string;
}

export type AdoptionTier = "non-user" | "infrequent" | "frequent" | "power";

export interface AdoptionSegmentation {
  nonUsers: string[];
  infrequent: string[];
  frequent: string[];
  power: string[];
}

export interface AIAdoptionScore {
  overall: number;
  maturityTier: MaturityTier;
  utilization: PillarScore;
  impact: PillarScore;
  quality: PillarScore;
  segmentation: AdoptionSegmentation;
  actionItems: ActionItem[];
}

// ─── Constants ───

const KNOWN_TOOLS = 6; // claude, copilot, cursor, aider, devin, codex
const PILLAR_WEIGHTS = { utilization: 0.35, impact: 0.45, quality: 0.20 };

// ─── Helpers ───

function clamp(min: number, max: number, value: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Compute a weighted score from metrics, redistributing unavailable metric weights */
function weightedScore(metrics: MetricDetail[]): number {
  const available = metrics.filter((m) => m.available);
  if (available.length === 0) return 0;
  const totalWeight = available.reduce((s, m) => s + m.weight, 0);
  if (totalWeight === 0) return 0;
  return available.reduce((s, m) => s + (m.value / m.max) * 100 * (m.weight / totalWeight), 0);
}

// ─── Pillar computations ───

export function computeUtilization(
  metrics: PRMetric[],
  copilotMetrics: CopilotDailyMetric[],
): PillarScore {
  const human = metrics.filter((m) => !m.author || !isBotAuthor(m.author));
  const aiCount = human.filter((m) => m.aiAssisted).length;
  const aiPrRate = human.length > 0 ? (aiCount / human.length) * 100 : 0;

  // Tool coverage: distinct tools across all PRs
  const toolSet = new Set<string>();
  for (const m of human) {
    for (const t of m.aiTools) toolSet.add(t);
  }
  const toolCoverage = (toolSet.size / KNOWN_TOOLS) * 100;

  // Copilot engagement: engaged / active
  const latest = copilotMetrics.length > 0
    ? copilotMetrics.sort((a, b) => b.date.localeCompare(a.date))[0]
    : null;
  const hasCopilot = latest !== null && latest.totalActiveUsers > 0;
  const copilotEngagement = hasCopilot
    ? (latest!.totalEngagedUsers / latest!.totalActiveUsers) * 100
    : 0;

  const ms: MetricDetail[] = [
    { name: "AI PR Rate", value: clamp(0, 100, aiPrRate), max: 100, weight: 0.50, available: human.length > 0 },
    { name: "Tool Coverage", value: clamp(0, 100, toolCoverage), max: 100, weight: 0.25, available: true },
    { name: "Copilot Engagement", value: clamp(0, 100, copilotEngagement), max: 100, weight: 0.25, available: hasCopilot },
  ];

  return { score: clamp(0, 100, weightedScore(ms)), metrics: ms };
}

export function computeImpact(metrics: PRMetric[]): PillarScore {
  const human = metrics.filter((m) => !m.author || !isBotAuthor(m.author));
  const aiPRs = human.filter((m) => m.aiAssisted);
  const nonAIPRs = human.filter((m) => !m.aiAssisted);

  // Cycle time delta: positive = AI is faster
  const aiCycles = removeOutliers(
    aiPRs
      .filter((m) => m.cycleTimeHours !== null && m.mergedAt)
      .map((m) => toBusinessHours(m.cycleTimeHours!, m.createdAt, m.mergedAt!)),
  );
  const nonAICycles = removeOutliers(
    nonAIPRs
      .filter((m) => m.cycleTimeHours !== null && m.mergedAt)
      .map((m) => toBusinessHours(m.cycleTimeHours!, m.createdAt, m.mergedAt!)),
  );
  const avgAI = aiCycles.length ? aiCycles.reduce((a, b) => a + b, 0) / aiCycles.length : null;
  const avgNonAI = nonAICycles.length ? nonAICycles.reduce((a, b) => a + b, 0) / nonAICycles.length : null;
  const hasCycleData = avgAI !== null && avgNonAI !== null && avgNonAI > 0;
  const cycleTimeDelta = hasCycleData ? ((avgNonAI! - avgAI!) / avgNonAI!) * 100 : 0;

  // Throughput delta: PRs per author comparison
  const aiAuthors = new Map<string, number>();
  const nonAIAuthors = new Map<string, number>();
  for (const m of human) {
    if (!m.author) continue;
    if (m.aiAssisted) {
      aiAuthors.set(m.author, (aiAuthors.get(m.author) ?? 0) + 1);
    } else {
      nonAIAuthors.set(m.author, (nonAIAuthors.get(m.author) ?? 0) + 1);
    }
  }
  // Identify authors who use AI at all
  const aiUserLogins = new Set(aiAuthors.keys());
  const aiUserThroughput: number[] = [];
  const nonAIUserThroughput: number[] = [];
  for (const m of human) {
    if (!m.author) continue;
    // Skip authors we've already counted
  }
  // Simpler: total PRs per author, split by whether they ever use AI
  const authorTotals = new Map<string, number>();
  for (const m of human) {
    if (!m.author) continue;
    authorTotals.set(m.author, (authorTotals.get(m.author) ?? 0) + 1);
  }
  for (const [author, count] of authorTotals) {
    if (aiUserLogins.has(author)) aiUserThroughput.push(count);
    else nonAIUserThroughput.push(count);
  }
  const avgAIThroughput = aiUserThroughput.length
    ? aiUserThroughput.reduce((a, b) => a + b, 0) / aiUserThroughput.length
    : 0;
  const avgNonAIThroughput = nonAIUserThroughput.length
    ? nonAIUserThroughput.reduce((a, b) => a + b, 0) / nonAIUserThroughput.length
    : 0;
  const hasThroughputData = avgNonAIThroughput > 0 && aiUserThroughput.length > 0;
  const throughputDelta = hasThroughputData
    ? ((avgAIThroughput - avgNonAIThroughput) / avgNonAIThroughput) * 100
    : 0;

  const ms: MetricDetail[] = [
    { name: "Cycle Time Delta", value: clamp(0, 100, cycleTimeDelta), max: 100, weight: 0.50, available: hasCycleData },
    { name: "Throughput Delta", value: clamp(0, 100, throughputDelta), max: 100, weight: 0.50, available: hasThroughputData },
  ];

  return { score: clamp(0, 100, weightedScore(ms)), metrics: ms };
}

export function computeQuality(metrics: PRMetric[]): PillarScore {
  const human = metrics.filter((m) => !m.author || !isBotAuthor(m.author));

  // Revert rate
  const totalMerged = human.length;
  const revertCount = human.filter((m) => m.isRevert).length;
  const revertPct = totalMerged > 0 ? (revertCount / totalMerged) * 100 : 0;
  const revertScore = clamp(0, 100, 100 - revertPct * 10);

  // Multi-tool adoption: authors using 2+ distinct tools
  const authorTools = new Map<string, Set<string>>();
  for (const m of human) {
    if (!m.author || !m.aiAssisted) continue;
    if (!authorTools.has(m.author)) authorTools.set(m.author, new Set());
    for (const t of m.aiTools) authorTools.get(m.author)!.add(t);
  }
  const aiAuthorsCount = authorTools.size;
  const multiToolCount = Array.from(authorTools.values()).filter((s) => s.size >= 2).length;
  const multiToolScore = aiAuthorsCount > 0 ? (multiToolCount / aiAuthorsCount) * 100 : 0;

  const ms: MetricDetail[] = [
    { name: "Revert Rate", value: revertScore, max: 100, weight: 0.50, available: totalMerged > 0 },
    { name: "Multi-Tool Adoption", value: clamp(0, 100, multiToolScore), max: 100, weight: 0.50, available: aiAuthorsCount > 0 },
  ];

  return { score: clamp(0, 100, weightedScore(ms)), metrics: ms };
}

// ─── Segmentation ───

export function computeSegmentation(authorRows: AuthorAIRow[]): AdoptionSegmentation {
  const seg: AdoptionSegmentation = { nonUsers: [], infrequent: [], frequent: [], power: [] };
  for (const r of authorRows) {
    if (r.pct === 0) seg.nonUsers.push(r.author);
    else if (r.pct < 25) seg.infrequent.push(r.author);
    else if (r.pct <= 75) seg.frequent.push(r.author);
    else seg.power.push(r.author);
  }
  return seg;
}

export function authorTier(pct: number): AdoptionTier {
  if (pct === 0) return "non-user";
  if (pct < 25) return "infrequent";
  if (pct <= 75) return "frequent";
  return "power";
}

// ─── Maturity tier ───

export function maturityTier(score: number): MaturityTier {
  if (score <= 20) return "minimal";
  if (score <= 50) return "early";
  if (score <= 75) return "growing";
  if (score <= 90) return "strong";
  return "ai-first";
}

const TIER_LABELS: Record<MaturityTier, string> = {
  "minimal": "Minimal",
  "early": "Early",
  "growing": "Growing",
  "strong": "Strong",
  "ai-first": "AI-First",
};

export function tierLabel(tier: MaturityTier): string {
  return TIER_LABELS[tier];
}

// ─── Inflection point detection ───

/** Find the first week where AI adoption > 10% and stays above for 2+ consecutive weeks */
export function autoDetectInflectionWeek(
  weeklyAI: { label: string; pct: number }[],
): number | null {
  for (let i = 0; i < weeklyAI.length - 1; i++) {
    if (weeklyAI[i].pct >= 10 && weeklyAI[i + 1].pct >= 10) {
      return i;
    }
  }
  return null;
}

// ─── Action items ───

export function generateActionItems(
  utilization: PillarScore,
  impact: PillarScore,
  quality: PillarScore,
  authorRows: AuthorAIRow[],
  teamRows: TeamRow[],
  copilotMetrics: CopilotDailyMetric[],
): ActionItem[] {
  const items: ActionItem[] = [];

  // Low overall adoption
  const aiPrMetric = utilization.metrics.find((m) => m.name === "AI PR Rate");
  if (aiPrMetric && aiPrMetric.available && aiPrMetric.value < 20) {
    items.push({
      priority: "high",
      message: `Only ${Math.round(aiPrMetric.value)}% of PRs are AI-assisted — consider team-wide AI tooling sessions`,
      metric: "AI PR Rate",
    });
  }

  // Non-users
  const nonUsers = authorRows.filter((r) => r.pct === 0);
  if (nonUsers.length > 0 && authorRows.length > 0 && nonUsers.length / authorRows.length > 0.3) {
    items.push({
      priority: "medium",
      message: `${nonUsers.length} engineers have never used AI tools in this period`,
      metric: "Segmentation",
    });
  }

  // AI PRs are slower
  const cycleDelta = impact.metrics.find((m) => m.name === "Cycle Time Delta");
  if (cycleDelta && cycleDelta.available && cycleDelta.value <= 0) {
    items.push({
      priority: "high",
      message: "AI-assisted PRs show longer cycle times than non-AI — investigate review bottlenecks",
      metric: "Cycle Time Delta",
    });
  }

  // Low tool diversity
  const toolCoverage = utilization.metrics.find((m) => m.name === "Tool Coverage");
  if (toolCoverage && toolCoverage.value < 34) {
    items.push({
      priority: "low",
      message: "Only 1-2 AI tools detected — explore alternatives for different use cases",
      metric: "Tool Coverage",
    });
  }

  // Team disparity
  const linkedTeams = teamRows.filter((r) => r.team !== "Unlinked" && r.prCount >= 3);
  if (linkedTeams.length >= 2) {
    const maxAI = Math.max(...linkedTeams.map((r) => r.aiPctTeam));
    const lowTeams = linkedTeams.filter((r) => r.aiPctTeam < 15 && maxAI > 50);
    for (const t of lowTeams.slice(0, 2)) {
      items.push({
        priority: "medium",
        message: `${t.team} has ${t.aiPctTeam}% AI adoption vs ${maxAI}% in top team`,
        metric: "Team Adoption",
      });
    }
  }

  // Elevated revert rate
  const revertMetric = quality.metrics.find((m) => m.name === "Revert Rate");
  if (revertMetric && revertMetric.available && revertMetric.value < 50) {
    items.push({
      priority: "high",
      message: "Elevated revert rate detected — review AI-assisted PR quality",
      metric: "Revert Rate",
    });
  }

  // Wasted Copilot licenses
  const latest = copilotMetrics.length > 0
    ? copilotMetrics.sort((a, b) => b.date.localeCompare(a.date))[0]
    : null;
  if (latest && latest.totalSeats !== null && latest.totalSeats > 0) {
    const unused = latest.totalSeats - latest.totalActiveUsers;
    if (unused > 0 && unused / latest.totalSeats > 0.2) {
      items.push({
        priority: "medium",
        message: `${unused} of ${latest.totalSeats} Copilot licenses are unused`,
        metric: "License Utilization",
      });
    }
  }

  return items.sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 };
    return order[a.priority] - order[b.priority];
  });
}

// ─── Main composite score ───

export function computeAIAdoptionScore(
  metrics: PRMetric[],
  copilotMetrics: CopilotDailyMetric[],
  authorRows: AuthorAIRow[],
  teamRows: TeamRow[],
): AIAdoptionScore {
  const utilization = computeUtilization(metrics, copilotMetrics);
  const impact = computeImpact(metrics);
  const quality = computeQuality(metrics);

  // Weighted composite with redistribution for empty pillars
  const pillars = [
    { score: utilization.score, weight: PILLAR_WEIGHTS.utilization, hasData: utilization.metrics.some((m) => m.available) },
    { score: impact.score, weight: PILLAR_WEIGHTS.impact, hasData: impact.metrics.some((m) => m.available) },
    { score: quality.score, weight: PILLAR_WEIGHTS.quality, hasData: quality.metrics.some((m) => m.available) },
  ];
  const activePillars = pillars.filter((p) => p.hasData);
  const totalWeight = activePillars.reduce((s, p) => s + p.weight, 0);
  const overall = totalWeight > 0
    ? clamp(0, 100, Math.round(activePillars.reduce((s, p) => s + p.score * (p.weight / totalWeight), 0)))
    : 0;

  const tier = maturityTier(overall);
  const segmentation = computeSegmentation(authorRows);
  const actionItems = generateActionItems(utilization, impact, quality, authorRows, teamRows, copilotMetrics);

  return { overall, maturityTier: tier, utilization, impact, quality, segmentation, actionItems };
}
