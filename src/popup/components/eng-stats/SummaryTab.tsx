/**
 * SummaryTab — Renders the Summary tab of the Eng Stats dashboard.
 * KPI cards, cycle time + AI adoption charts, PR size distribution,
 * AI tool usage, and PR backlog projection.
 */

import React, { useMemo } from "react";
import { OS } from "@shared/tokens";
import type { PRMetric, OpenPRSnapshot } from "@shared/types";
import { isBotAuthor } from "@shared/constants";
import {
  dk,
  fmtHours,
  removeOutliers,
  toBusinessHours,
  daysAgoISO,
  median,
  weekKey,
  weekLabel,
  type TabProps,
  type WeekBucket,
  type EngStatsConfig,
  type KpiId,
  type SectionId,
  toolColors,
} from "./shared";

// ─── Props ───

interface SummaryTabProps extends TabProps {
  config: EngStatsConfig;
  sectionVisible: (id: SectionId) => boolean;
  openSnapshots: OpenPRSnapshot[];
  openPRCreatedDates: Record<string, string[]>;
  // TODO: extract chart components to shared file
  CycleTimeChart: React.ComponentType<{
    buckets: WeekBucket[];
    dark: boolean;
    height?: number;
    fullWidth?: boolean;
  }>;
  AIAdoptionChart: React.ComponentType<{
    weeklyPcts: { label: string; pct: number }[];
    dark: boolean;
    height?: number;
    fullWidth?: boolean;
  }>;
  PRSizeChart: React.ComponentType<{
    small: number;
    medium: number;
    large: number;
    dark: boolean;
  }>;
  PRFlowChart: React.ComponentType<{
    weeks: { label: string; opened: number; closed: number }[];
    dark: boolean;
  }>;
}

// ─── Local sub-components ───

function Sparkline({
  data,
  width = 64,
  height = 26,
  color = OS.blue,
}: {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
}) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pad = 2;
  const points = data
    .map((v, i) => {
      const x = pad + (i / (data.length - 1)) * (width - pad * 2);
      const y = height - pad - ((v - min) / range) * (height - pad * 2);
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <svg width={width} height={height} style={{ display: "block", flexShrink: 0 }}>
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

interface KPICardProps {
  label: string;
  value: string;
  sparklineData?: number[];
  deltaPercent?: number | null;
  deltaPeriodLabel?: string;
  detailSub?: string;
  alertBorder?: boolean;
  trendPositive?: boolean;
  dark: boolean;
  showDelta?: boolean;
  showSparkline?: boolean;
  showSubtitle?: boolean;
}

function KPICard({
  label,
  value,
  sparklineData,
  deltaPercent,
  deltaPeriodLabel,
  detailSub,
  alertBorder,
  trendPositive = true,
  dark,
  showDelta = true,
  showSparkline = true,
  showSubtitle = true,
}: KPICardProps) {
  const deltaUp = deltaPercent != null && deltaPercent > 0;
  const deltaDown = deltaPercent != null && deltaPercent < 0;
  const deltaGreen = trendPositive ? deltaUp : deltaDown;
  const deltaRed = trendPositive ? deltaDown : deltaUp;
  const deltaColor = deltaGreen
    ? OS.green
    : deltaRed
      ? OS.red
      : dk(dark, "#888", OS.muted);
  const deltaArrow = deltaUp ? "\u2191" : deltaDown ? "\u2193" : "";
  const absDelta = deltaPercent != null ? Math.abs(Math.round(deltaPercent)) : null;

  return (
    <div
      style={{
        flex: 1,
        minWidth: 120,
        padding: "14px 16px 12px",
        borderRadius: 10,
        border: alertBorder
          ? "1px solid rgba(232, 93, 93, 0.2)"
          : `1px solid ${dk(dark, "rgba(255,255,255,0.08)", OS.border)}`,
        borderTop: alertBorder
          ? "2px solid rgba(232, 93, 93, 0.3)"
          : undefined,
        background: dk(dark, "#1c1c22", OS.white),
      }}
    >
      <div
        style={{
          fontFamily: OS.mono,
          fontSize: 10,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          color: dk(dark, "rgba(255,255,255,0.45)", OS.muted),
          marginBottom: 8,
        }}
      >
        {label}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          marginBottom: 6,
        }}
      >
        <span
          style={{
            fontFamily: OS.mono,
            fontSize: 24,
            fontWeight: 700,
            color: dk(dark, "#fff", OS.text),
            fontVariantNumeric: "tabular-nums",
            lineHeight: 1,
          }}
        >
          {value}
        </span>
        {showSparkline && sparklineData && sparklineData.length >= 2 && (
          <Sparkline
            data={sparklineData}
            color={dk(dark, "rgba(255,255,255,0.5)", OS.blue)}
          />
        )}
      </div>

      {showDelta && deltaPercent != null && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginBottom: detailSub ? 6 : 0,
          }}
        >
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 2,
              fontSize: 11,
              fontFamily: OS.mono,
              fontWeight: 600,
              color: deltaColor,
              background: deltaGreen
                ? "rgba(59,140,95,0.1)"
                : deltaRed
                  ? "rgba(209,67,67,0.1)"
                  : "transparent",
              borderRadius: 4,
              padding: "1px 5px",
            }}
          >
            {deltaArrow} {absDelta != null ? `${absDelta}%` : "\u2014"}
          </span>
          {deltaPeriodLabel && (
            <span
              style={{
                fontSize: 10,
                color: dk(dark, "rgba(255,255,255,0.25)", OS.faint),
                fontFamily: OS.mono,
              }}
            >
              {deltaPeriodLabel}
            </span>
          )}
        </div>
      )}

      {showSubtitle && detailSub && (
        <div
          style={{
            fontSize: 11,
            color: dk(dark, "rgba(255,255,255,0.3)", OS.muted),
            fontFamily: OS.font,
          }}
        >
          {detailSub}
        </div>
      )}
    </div>
  );
}

// ─── SummaryTab Component ───

export function SummaryTab({
  darkMode,
  metrics,
  allMetrics: _allMetrics,
  timeRange,
  selectedRepo,
  prToTickets,
  config,
  sectionVisible,
  openSnapshots,
  openPRCreatedDates,
  CycleTimeChart,
  AIAdoptionChart,
  PRSizeChart,
  PRFlowChart,
}: SummaryTabProps) {
  const dark = darkMode;

  // ─── Consolidated pass 1: summary stats ───
  // Single iteration over metrics to compute cycle times, review times,
  // PR size buckets, tool counts, and AI stats.
  const summaryStats = useMemo(() => {
    const rawCycleTimes: number[] = [];
    const rawReviewTimes: number[] = [];
    let smallCount = 0;
    let mediumCount = 0;
    let largeCount = 0;
    const toolCounts: Record<string, number> = {};
    const humanOnly: PRMetric[] = [];

    for (const m of metrics) {
      // Cycle times
      if (m.cycleTimeHours !== null && m.mergedAt) {
        rawCycleTimes.push(toBusinessHours(m.cycleTimeHours, m.createdAt, m.mergedAt));
      }

      // Review times
      if (m.timeToFirstReviewHours !== null) {
        const reviewEnd = new Date(
          new Date(m.createdAt).getTime() + m.timeToFirstReviewHours * 3600000,
        ).toISOString();
        rawReviewTimes.push(toBusinessHours(m.timeToFirstReviewHours, m.createdAt, reviewEnd));
      }

      // PR sizes
      const lines = m.additions + m.deletions;
      if (lines < 100) smallCount++;
      else if (lines < 500) mediumCount++;
      else largeCount++;

      // Tool counts
      for (const tool of m.aiTools) {
        toolCounts[tool] = (toolCounts[tool] ?? 0) + 1;
      }

      // Human metrics (exclude bots)
      if (!m.author || !isBotAuthor(m.author)) {
        humanOnly.push(m);
      }
    }

    const cycleTimes = removeOutliers(rawCycleTimes);
    const avgCycleTime = cycleTimes.length
      ? cycleTimes.reduce((a, b) => a + b, 0) / cycleTimes.length
      : null;

    const reviewTimes = removeOutliers(rawReviewTimes);
    const medianReviewTime = reviewTimes.length ? median(reviewTimes) : null;

    const toolEntries = Object.entries(toolCounts).sort((a, b) => b[1] - a[1]);
    const displayToolEntries = toolEntries
      .filter(([tool]) => tool.toLowerCase() !== "ai")
      .map(([tool, count]) => [tool, count] as [string, number]);
    const unattributedAICount = toolEntries.find(([t]) => t.toLowerCase() === "ai")?.[1] ?? 0;

    const aiPRs = humanOnly.filter((m) => m.aiAssisted).length;
    const aiPct = humanOnly.length ? Math.round((aiPRs / humanOnly.length) * 100) : 0;

    return {
      cycleTimes,
      avgCycleTime,
      reviewTimes,
      medianReviewTime,
      smallCount,
      mediumCount,
      largeCount,
      displayToolEntries,
      unattributedAICount,
      aiPRs,
      aiPct,
    };
  }, [metrics]);

  // ─── Consolidated pass 2: weekly sparkline data ───
  // Single iteration to compute all weekly buckets for sparklines.
  const weeklyData = useMemo(() => {
    const cycleByWeek = new Map<string, number[]>();
    const reviewByWeek = new Map<string, number[]>();
    const prCountByWeek = new Map<string, number>();
    const aiByWeek = new Map<string, { ai: number; total: number }>();
    const leadByWeek = new Map<string, number[]>();

    for (const m of metrics) {
      if (!m.mergedAt) continue;
      const wk = weekKey(new Date(m.mergedAt));

      // Cycle time buckets
      if (m.cycleTimeHours !== null) {
        const biz = toBusinessHours(m.cycleTimeHours, m.createdAt, m.mergedAt);
        if (!cycleByWeek.has(wk)) cycleByWeek.set(wk, []);
        cycleByWeek.get(wk)!.push(biz);
      }

      // Review time buckets
      if (m.timeToFirstReviewHours != null) {
        const reviewEnd = new Date(
          new Date(m.createdAt).getTime() + m.timeToFirstReviewHours * 3600000,
        ).toISOString();
        const biz = toBusinessHours(m.timeToFirstReviewHours, m.createdAt, reviewEnd);
        if (!reviewByWeek.has(wk)) reviewByWeek.set(wk, []);
        reviewByWeek.get(wk)!.push(biz);
      }

      // PR count
      prCountByWeek.set(wk, (prCountByWeek.get(wk) ?? 0) + 1);

      // AI adoption
      if (!aiByWeek.has(wk)) aiByWeek.set(wk, { ai: 0, total: 0 });
      const ab = aiByWeek.get(wk)!;
      ab.total++;
      if (m.aiAssisted) ab.ai++;

      // Lead time
      if (m.id != null) {
        const tickets = prToTickets.get(m.id);
        if (tickets?.length) {
          const earliest = tickets
            .map((t) => new Date(t.createdAt).getTime())
            .filter((t) => !isNaN(t));
          if (earliest.length) {
            const ticketCreated = Math.min(...earliest);
            const merged = new Date(m.mergedAt).getTime();
            if (merged > ticketCreated) {
              const leadDays = (merged - ticketCreated) / (1000 * 60 * 60 * 24);
              if (!leadByWeek.has(wk)) leadByWeek.set(wk, []);
              leadByWeek.get(wk)!.push(leadDays);
            }
          }
        }
      }
    }

    const maxWeeks = Math.ceil(timeRange / 7);

    // Weekly buckets for cycle time chart
    const weeklyBuckets: WeekBucket[] = Array.from(cycleByWeek.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, vals]) => ({
        label: weekLabel(new Date(key + "T12:00:00")),
        avgHours: vals.reduce((a, b) => a + b, 0) / vals.length,
        count: vals.length,
      }))
      .slice(-maxWeeks);

    // 7-point sparkline arrays
    const weeklyCycleDays = weeklyBuckets.map((b) => b.avgHours / 24).slice(-7);

    const weeklyReviewMedians = Array.from(reviewByWeek.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([, vals]) => median(removeOutliers(vals)))
      .slice(-7);

    const weeklyPRCounts = Array.from(prCountByWeek.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([, count]) => count)
      .slice(-7);

    const weeklyAI = Array.from(aiByWeek.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, v]) => ({
        label: weekLabel(new Date(key + "T12:00:00")),
        pct: v.total > 0 ? Math.round((v.ai / v.total) * 100) : 0,
      }))
      .slice(-maxWeeks);

    const weeklyAIPcts = weeklyAI.map((w) => w.pct).slice(-7);

    const weeklyLeadDays = Array.from(leadByWeek.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([, vals]) => vals.reduce((a, b) => a + b, 0) / vals.length)
      .slice(-7);

    return {
      weeklyBuckets,
      weeklyCycleDays,
      weeklyReviewMedians,
      weeklyPRCounts,
      weeklyAI,
      weeklyAIPcts,
      weeklyLeadDays,
    };
  }, [metrics, timeRange, prToTickets]);

  // ─── Consolidated pass 3: deltas (recent half vs older half) ───
  const deltas = useMemo(() => {
    const halfPoint = daysAgoISO(timeRange / 2);
    const recent = metrics.filter((m) => m.mergedAt && m.mergedAt >= halfPoint);
    const older = metrics.filter((m) => m.mergedAt && m.mergedAt < halfPoint);

    const toBizCycle = (m: PRMetric) =>
      m.cycleTimeHours !== null && m.mergedAt
        ? toBusinessHours(m.cycleTimeHours, m.createdAt, m.mergedAt)
        : null;

    // Cycle delta
    const recentCycles = removeOutliers(recent.map(toBizCycle).filter((h): h is number => h !== null));
    const recentAvg = recentCycles.length ? recentCycles.reduce((a, b) => a + b, 0) / recentCycles.length : null;
    const olderCycles = removeOutliers(older.map(toBizCycle).filter((h): h is number => h !== null));
    const olderAvg = olderCycles.length ? olderCycles.reduce((a, b) => a + b, 0) / olderCycles.length : null;
    const cycleDelta =
      recentAvg != null && olderAvg != null && olderAvg !== 0
        ? Math.round(((recentAvg - olderAvg) / olderAvg) * 100)
        : null;

    // Review delta
    const toBizReview = (m: PRMetric) => {
      if (m.timeToFirstReviewHours == null) return null;
      const reviewEnd = new Date(
        new Date(m.createdAt).getTime() + m.timeToFirstReviewHours * 3600000,
      ).toISOString();
      return toBusinessHours(m.timeToFirstReviewHours, m.createdAt, reviewEnd);
    };
    const recentReviews = removeOutliers(recent.map(toBizReview).filter((h): h is number => h !== null));
    const olderReviews = removeOutliers(older.map(toBizReview).filter((h): h is number => h !== null));
    let reviewDelta: number | null = null;
    if (recentReviews.length && olderReviews.length) {
      const recentMed = median(recentReviews);
      const olderMed = median(olderReviews);
      if (olderMed !== 0) reviewDelta = Math.round(((recentMed - olderMed) / olderMed) * 100);
    }

    // PRs merged delta
    const prsDelta = older.length > 0
      ? Math.round(((recent.length - older.length) / older.length) * 100)
      : null;

    // AI delta
    const recentAIPct = recent.length > 0
      ? (recent.filter((m) => m.aiAssisted).length / recent.length) * 100
      : 0;
    const olderAIPct = older.length > 0
      ? (older.filter((m) => m.aiAssisted).length / older.length) * 100
      : 0;
    const aiDelta = olderAIPct !== 0
      ? Math.round(((recentAIPct - olderAIPct) / olderAIPct) * 100)
      : null;

    // Lead delta
    const recentLeads: number[] = [];
    const olderLeads: number[] = [];
    for (const m of metrics) {
      if (!m.mergedAt || m.id == null) continue;
      const tickets = prToTickets.get(m.id);
      if (!tickets?.length) continue;
      const earliest = tickets
        .map((t) => new Date(t.createdAt).getTime())
        .filter((t) => !isNaN(t));
      if (!earliest.length) continue;
      const ticketCreated = Math.min(...earliest);
      const merged = new Date(m.mergedAt).getTime();
      if (merged <= ticketCreated) continue;
      const hours = (merged - ticketCreated) / (1000 * 60 * 60);
      if (m.mergedAt >= halfPoint) recentLeads.push(hours);
      else olderLeads.push(hours);
    }
    let leadDelta: number | null = null;
    if (recentLeads.length && olderLeads.length) {
      const recentAvgLead = recentLeads.reduce((a, b) => a + b, 0) / recentLeads.length;
      const olderAvgLead = olderLeads.reduce((a, b) => a + b, 0) / olderLeads.length;
      if (olderAvgLead !== 0) leadDelta = Math.round(((recentAvgLead - olderAvgLead) / olderAvgLead) * 100);
    }

    return { cycleDelta, reviewDelta, prsDelta, aiDelta, leadDelta };
  }, [metrics, timeRange, prToTickets]);

  // ─── Consolidated pass 4: lead time ───
  const leadTimeData = useMemo(() => {
    const times: number[] = [];
    for (const m of metrics) {
      if (!m.mergedAt || m.id == null) continue;
      const tickets = prToTickets.get(m.id);
      if (!tickets?.length) continue;
      const earliest = tickets
        .map((t) => new Date(t.createdAt).getTime())
        .filter((t) => !isNaN(t));
      if (!earliest.length) continue;
      const ticketCreated = Math.min(...earliest);
      const merged = new Date(m.mergedAt).getTime();
      if (merged > ticketCreated) {
        times.push((merged - ticketCreated) / (1000 * 60 * 60));
      }
    }
    const avgLeadTime = times.length
      ? times.reduce((a, b) => a + b, 0) / times.length
      : null;
    const leadTimeIsHigh = avgLeadTime != null && avgLeadTime > 120;
    return { leadTimes: times, avgLeadTime, leadTimeIsHigh };
  }, [metrics, prToTickets]);

  // ─── AI subtitle ───
  const aiInfo = useMemo(() => {
    const { weeklyAI } = weeklyData;
    const { aiPct } = summaryStats;

    const firstWeekAIPct = weeklyAI.length > 0
      ? weeklyAI[Math.max(0, weeklyAI.length - 6)]?.pct
      : undefined;

    let aiTrendWord = "flat";
    if (firstWeekAIPct != null) {
      const diff = aiPct - firstWeekAIPct;
      if (diff > 2) aiTrendWord = "up";
      else if (diff < -2) aiTrendWord = "down";
    }

    let aiSubtitle = `${aiPct}% of PRs AI-assisted`;
    if (firstWeekAIPct != null && weeklyAI.length >= 2) {
      const weeksBack = Math.min(weeklyAI.length, 6) - 1;
      aiSubtitle = `${aiSubtitle} \u00b7 trending ${aiTrendWord} from ${firstWeekAIPct}% ${weeksBack} weeks ago`;
    }

    return { aiSubtitle };
  }, [weeklyData, summaryStats]);

  // ─── PR Backlog Projection ───
  const prProjection = useMemo(() => {
    // Latest snapshot per repo (for "current open" count)
    const latestByRepo = new Map<string, OpenPRSnapshot>();
    for (const s of openSnapshots) {
      const existing = latestByRepo.get(s.repo);
      if (!existing || s.snapshotAt > existing.snapshotAt) {
        latestByRepo.set(s.repo, s);
      }
    }
    const relevantSnapshots = selectedRepo === "__all__"
      ? Array.from(latestByRepo.values())
      : Array.from(latestByRepo.values()).filter((s) => s.repo === selectedRepo);
    const currentOpen = relevantSnapshots.reduce((sum, s) => sum + s.openCount, 0);

    // Use timeRange for rate calculations
    const windowDays = Math.max(timeRange, 14); // at least 14 days for meaningful rates
    const windowStart = daysAgoISO(windowDays);
    const recentMerged = metrics.filter((m) => m.mergedAt && m.mergedAt >= windowStart);
    const closeRatePerDay = recentMerged.length / windowDays;

    const recentMergedCreated = metrics.filter((m) => m.createdAt >= windowStart);
    const relevantRepos = selectedRepo === "__all__"
      ? Object.keys(openPRCreatedDates)
      : [selectedRepo];
    let openCreatedInWindow = 0;
    for (const repo of relevantRepos) {
      const dates = openPRCreatedDates[repo] ?? [];
      openCreatedInWindow += dates.filter((d) => d >= windowStart).length;
    }
    const totalOpened = recentMergedCreated.length + openCreatedInWindow;
    const openRatePerDay = totalOpened / windowDays;
    const netRatePerDay = openRatePerDay - closeRatePerDay;

    // Build weekly opened/closed flow data
    const historyWeeks = Math.min(Math.floor(timeRange / 7), 12);

    const weeklyFlow: { label: string; opened: number; closed: number }[] = [];
    for (let w = historyWeeks; w >= 0; w--) {
      const weekEnd = new Date(Date.now() - w * 7 * 86400_000);
      const weekStart = new Date(weekEnd.getTime() - 7 * 86400_000);
      const weekEndISO = weekEnd.toISOString();
      const weekStartISO = weekStart.toISOString();

      // Closed in this week (merged PRs)
      const closedInWeek = metrics.filter(
        (m) => m.mergedAt && m.mergedAt >= weekStartISO && m.mergedAt < weekEndISO,
      ).length;

      // Opened in this week: merged PRs created this week + still-open PRs created this week
      let openedInWeek = metrics.filter(
        (m) => m.createdAt >= weekStartISO && m.createdAt < weekEndISO,
      ).length;
      for (const repo of relevantRepos) {
        const dates = openPRCreatedDates[repo] ?? [];
        openedInWeek += dates.filter((d) => d >= weekStartISO && d < weekEndISO).length;
      }

      const label = w === 0 ? "Now" : `${w}w`;
      weeklyFlow.push({ label, opened: openedInWeek, closed: closedInWeek });
    }

    return {
      currentOpen,
      openRatePerWeek: Math.round(openRatePerDay * 7 * 10) / 10,
      closeRatePerWeek: Math.round(closeRatePerDay * 7 * 10) / 10,
      netRatePerWeek: Math.round(netRatePerDay * 7 * 10) / 10,
      weeklyFlow,
      hasData: latestByRepo.size > 0,
    };
  }, [openSnapshots, metrics, openPRCreatedDates, selectedRepo, timeRange]);

  // ─── Derived values ───
  const {
    cycleTimes, avgCycleTime, medianReviewTime,
    smallCount, mediumCount, largeCount,
    displayToolEntries, unattributedAICount,
    aiPRs, aiPct,
  } = summaryStats;
  const {
    weeklyBuckets, weeklyCycleDays, weeklyReviewMedians,
    weeklyPRCounts, weeklyAI, weeklyAIPcts, weeklyLeadDays,
  } = weeklyData;
  const { cycleDelta, reviewDelta, prsDelta, aiDelta, leadDelta } = deltas;
  const { leadTimes, avgLeadTime, leadTimeIsHigh } = leadTimeData;
  const { aiSubtitle } = aiInfo;
  const prsMerged = metrics.length;

  // ─── Styles ───
  const cardBg = dk(dark, "#1c1c22", OS.white);
  const cardBorder = `1px solid ${dk(dark, "rgba(255,255,255,0.08)", OS.border)}`;
  const sectionTitle: React.CSSProperties = {
    fontSize: 13,
    fontWeight: 600,
    color: dk(dark, "rgba(255,255,255,0.7)", OS.secondary),
    fontFamily: OS.font,
    margin: 0,
    marginBottom: 12,
  };

  // ─── KPI card definitions ───
  const kpiDefs: Record<KpiId, Omit<KPICardProps, "dark" | "showDelta" | "showSparkline" | "showSubtitle">> = {
    cycletime: {
      label: "Avg Cycle Time",
      value: fmtHours(avgCycleTime),
      sparklineData: weeklyCycleDays,
      deltaPercent: cycleDelta,
      deltaPeriodLabel: `vs prev ${timeRange / 2}d`,
      trendPositive: false,
      detailSub: `${cycleTimes.length} PRs with cycle data`,
    },
    medreview: {
      label: "Median Review Time",
      value: fmtHours(medianReviewTime),
      sparklineData: weeklyReviewMedians,
      deltaPercent: reviewDelta,
      deltaPeriodLabel: `vs prev ${timeRange / 2}d`,
      trendPositive: false,
      detailSub: "time to first review",
    },
    prsmerged: {
      label: "PRs Merged",
      value: String(prsMerged),
      sparklineData: weeklyPRCounts,
      deltaPercent: prsDelta,
      deltaPeriodLabel: `vs prev ${timeRange / 2}d`,
      trendPositive: true,
      detailSub: `last ${timeRange} days`,
    },
    aiassisted: {
      label: "AI-Assisted",
      value: `${aiPct}%`,
      sparklineData: weeklyAIPcts,
      deltaPercent: aiDelta,
      deltaPeriodLabel: `vs prev ${timeRange / 2}d`,
      trendPositive: true,
      detailSub: `${aiPRs} of ${prsMerged} PRs`,
    },
    leadtime: {
      label: "Avg Lead Time",
      value: fmtHours(avgLeadTime),
      sparklineData: weeklyLeadDays,
      deltaPercent: leadDelta,
      deltaPeriodLabel: `vs prev ${timeRange / 2}d`,
      trendPositive: false,
      alertBorder: leadTimeIsHigh,
      detailSub: `ticket \u2192 merge (${leadTimes.length} linked)`,
    },
  };

  return (
    <>
      {/* ─── KPI Cards ─── */}
      {sectionVisible("kpis") && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {config.kpiOrder
            .filter((id) => id !== "leadtime" || avgLeadTime !== null)
            .map((id) => {
              const def = kpiDefs[id];
              const disp = config.kpiDisplay[id];
              return (
                <KPICard
                  key={id}
                  {...def}
                  dark={dark}
                  showDelta={disp.delta}
                  showSparkline={disp.sparkline}
                  showSubtitle={disp.subtitle}
                />
              );
            })}
        </div>
      )}

      {/* ─── Side-by-side Cycle Time + AI Adoption (or stacked if only one visible) ─── */}
      {sectionVisible("cycleTime") && sectionVisible("aiAdoption") ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div style={{ padding: "14px 16px", borderRadius: 10, border: cardBorder, background: cardBg }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: dk(dark, "rgba(255,255,255,0.7)", OS.secondary) }}>Cycle Time</span>
              <span style={{ fontSize: 10, color: dk(dark, "rgba(255,255,255,0.3)", OS.faint), fontFamily: OS.mono }}>weekly avg, days</span>
            </div>
            {weeklyBuckets.length > 0 ? (
              <CycleTimeChart buckets={weeklyBuckets} dark={dark} height={300} />
            ) : (
              <div style={{ fontSize: 12, color: dk(dark, "rgba(255,255,255,0.3)", OS.muted), height: 80, display: "flex", alignItems: "center" }}>Not enough data</div>
            )}
          </div>
          <div style={{ padding: "14px 16px", borderRadius: 10, border: cardBorder, background: cardBg }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: dk(dark, "rgba(255,255,255,0.7)", OS.secondary) }}>AI Adoption</span>
              <span style={{ fontSize: 10, color: dk(dark, "rgba(255,255,255,0.3)", OS.faint), fontFamily: OS.mono }}>weekly % of PRs</span>
            </div>
            <div style={{ fontSize: 10, color: dk(dark, "rgba(255,255,255,0.35)", OS.muted), marginBottom: 8 }}>{aiSubtitle}</div>
            {weeklyAI.length >= 2 && <AIAdoptionChart weeklyPcts={weeklyAI} dark={dark} height={280} />}
          </div>
        </div>
      ) : (
        <>
          {sectionVisible("cycleTime") && (
            <div style={{ padding: "14px 16px", borderRadius: 10, border: cardBorder, background: cardBg }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: dk(dark, "rgba(255,255,255,0.7)", OS.secondary) }}>Cycle Time</span>
                <span style={{ fontSize: 10, color: dk(dark, "rgba(255,255,255,0.3)", OS.faint), fontFamily: OS.mono }}>weekly avg, days</span>
              </div>
              {weeklyBuckets.length > 0 ? <CycleTimeChart buckets={weeklyBuckets} dark={dark} height={300} /> : null}
            </div>
          )}
          {sectionVisible("aiAdoption") && weeklyAI.length >= 2 && (
            <div style={{ padding: "14px 16px", borderRadius: 10, border: cardBorder, background: cardBg }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: dk(dark, "rgba(255,255,255,0.7)", OS.secondary) }}>AI Adoption</span>
                <span style={{ fontSize: 10, color: dk(dark, "rgba(255,255,255,0.3)", OS.faint), fontFamily: OS.mono }}>weekly % of PRs</span>
              </div>
              <AIAdoptionChart weeklyPcts={weeklyAI} dark={dark} height={280} />
            </div>
          )}
        </>
      )}

      {/* ─── PR Size Distribution + AI Tool Usage ─── */}
      {(sectionVisible("prSize") || sectionVisible("toolUsage")) && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {sectionVisible("prSize") && (
            <div style={{ padding: "14px 16px", borderRadius: 10, border: cardBorder, background: cardBg }}>
              <h3 style={sectionTitle}>PR Size Distribution</h3>
              <PRSizeChart small={smallCount} medium={mediumCount} large={largeCount} dark={dark} />
            </div>
          )}
          {sectionVisible("toolUsage") && (
            <div style={{ padding: "14px 16px", borderRadius: 10, border: cardBorder, background: cardBg }}>
              <h3 style={sectionTitle}>AI Tool Usage</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {displayToolEntries.map(([tool, count]) => {
                  const maxCount = displayToolEntries.length > 0 ? displayToolEntries[0][1] : 1;
                  return (
                    <div key={tool} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 11, fontFamily: OS.mono, color: dk(dark, "rgba(255,255,255,0.6)", OS.secondary), width: 80, flexShrink: 0, textTransform: "capitalize" }}>{tool}</span>
                      <div style={{ flex: 1, height: 12, borderRadius: 3, background: dk(dark, "rgba(255,255,255,0.06)", OS.border), overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${Math.round((count / maxCount) * 100)}%`, background: toolColors[tool.toLowerCase()] ?? OS.faint, borderRadius: 3, minWidth: count > 0 ? 2 : 0 }} />
                      </div>
                      <span style={{ fontSize: 11, fontFamily: OS.mono, color: dk(dark, "rgba(255,255,255,0.4)", OS.muted), minWidth: 24, textAlign: "right" }}>{count}</span>
                    </div>
                  );
                })}
                {unattributedAICount > 0 && (
                  <div style={{ fontSize: 10, color: dk(dark, "rgba(255,255,255,0.3)", OS.muted), marginTop: 4 }}>
                    +{unattributedAICount} PRs with unidentified tool
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── PR Backlog Projection ─── */}
      {sectionVisible("projection") && (
        <div style={{ padding: "14px 16px", borderRadius: 10, border: cardBorder, background: cardBg }}>
          <h3 style={sectionTitle}>PR Backlog Projection</h3>
          {!prProjection.hasData ? (
            <div style={{ fontSize: 12, color: dk(dark, "rgba(255,255,255,0.4)", OS.muted), padding: "12px 0" }}>
              No open PR data yet — click <strong>Scan Now</strong> to sync.
            </div>
          ) : (
            <>
              {/* Mini KPI cards */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 12 }}>
                {[
                  { label: "Open Now", value: String(prProjection.currentOpen) },
                  { label: "Opened / wk", value: String(prProjection.openRatePerWeek) },
                  { label: "Closed / wk", value: String(prProjection.closeRatePerWeek) },
                  { label: "Net / wk", value: (prProjection.netRatePerWeek >= 0 ? "+" : "") + prProjection.netRatePerWeek },
                ].map((kpi) => (
                  <div key={kpi.label} style={{
                    padding: "8px 10px",
                    borderRadius: 8,
                    background: dk(dark, "rgba(255,255,255,0.04)", "rgba(0,0,0,0.02)"),
                    border: `1px solid ${dk(dark, "rgba(255,255,255,0.06)", OS.border)}`,
                  }}>
                    <div style={{ fontSize: 10, color: dk(dark, "rgba(255,255,255,0.4)", OS.muted), marginBottom: 2 }}>{kpi.label}</div>
                    <div style={{ fontSize: 18, fontWeight: 700, fontFamily: OS.mono, color: dk(dark, "#fff", OS.text) }}>{kpi.value}</div>
                  </div>
                ))}
              </div>

              {/* Opened vs Closed flow chart */}
              <PRFlowChart
                weeks={prProjection.weeklyFlow}
                dark={dark}
              />

              {/* Insight text */}
              <div style={{
                fontSize: 11,
                marginTop: 8,
                padding: "6px 10px",
                borderRadius: 6,
                background: prProjection.netRatePerWeek > 0
                  ? dk(dark, "rgba(234,88,12,0.1)", "rgba(234,88,12,0.06)")
                  : prProjection.netRatePerWeek < 0
                  ? dk(dark, "rgba(59,140,95,0.1)", "rgba(59,140,95,0.06)")
                  : dk(dark, "rgba(255,255,255,0.04)", "rgba(0,0,0,0.03)"),
                color: prProjection.netRatePerWeek > 0
                  ? dk(dark, "#FB923C", "#C2410C")
                  : prProjection.netRatePerWeek < 0
                  ? OS.green
                  : dk(dark, "rgba(255,255,255,0.6)", OS.secondary),
                fontFamily: OS.font,
              }}>
                {prProjection.netRatePerWeek > 0
                  ? `Backlog growing — opening ${prProjection.openRatePerWeek}/wk, closing ${prProjection.closeRatePerWeek}/wk (net +${prProjection.netRatePerWeek}/wk).`
                  : prProjection.netRatePerWeek < 0
                  ? `Backlog shrinking — closing ${prProjection.closeRatePerWeek}/wk vs ${prProjection.openRatePerWeek}/wk opened (net ${prProjection.netRatePerWeek}/wk).`
                  : `Open/close rates are balanced at ~${prProjection.openRatePerWeek}/wk.`}
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
