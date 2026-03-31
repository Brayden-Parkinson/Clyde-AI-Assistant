import React, { useMemo } from "react";
import type { PRMetric, PRReview, JiraTicket } from "@shared/types";
import {
  TabProps,
  WeekBucket,
  computeWeeklyBuckets,
  computePersonRows,
  dk,
} from "./shared";
import { OS } from "@shared/tokens";
import { InfoTip } from "./charts";
import { applyProductivityScores } from "./cycle-time/productivityScore";
import { LOCStatsSection } from "./cycle-time/LOCStats";
import { AIImpactSection } from "./cycle-time/AIImpactSection";
import { ComponentBreakdown } from "./cycle-time/ComponentBreakdown";
import { PersonInsights } from "./cycle-time/PersonInsights";
import { ProductivityMatrixSection } from "./cycle-time/ProductivityMatrix";

interface CycleTimeTabProps extends TabProps {
  reviews?: PRReview[];
  authorTickets?: Map<string, JiraTicket[]>;
  CycleTimeChart: React.ComponentType<{
    buckets: WeekBucket[];
    dark: boolean;
    height?: number;
    fullWidth?: boolean;
  }>;
}

export function CycleTimeTab({
  darkMode,
  metrics,
  allMetrics,
  timeRange,
  selectedRepo,
  prToTickets,
  reviews = [],
  authorTickets,
  CycleTimeChart,
}: CycleTimeTabProps) {
  const cardBg = dk(darkMode, "#1c1c22", OS.white);
  const cardBorder = `1px solid ${dk(darkMode, "rgba(255,255,255,0.08)", OS.border)}`;

  const weeklyBuckets = useMemo(
    () => computeWeeklyBuckets(metrics, timeRange),
    [metrics, timeRange],
  );

  // Person rows are computed here and shared between PersonInsights and ProductivityMatrix
  const personRows = useMemo(() => {
    const base = computePersonRows(metrics, prToTickets, timeRange);
    return applyProductivityScores(base, metrics, prToTickets, timeRange, reviews);
  }, [metrics, prToTickets, timeRange, reviews]);

  return (
    <>
      {/* Weekly Average Cycle Time (existing) */}
      <div style={{ padding: "14px 16px", borderRadius: 10, border: cardBorder, background: cardBg }}>
        <div style={{
          fontSize: 15, fontWeight: 700,
          color: dk(darkMode, "rgba(255,255,255,0.8)", OS.secondary),
          marginBottom: 2,
        }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            Weekly Average Cycle Time
            <InfoTip dark={darkMode} text="Average time from PR creation to merge per week, in business hours (weekends/nights excluded). Outliers removed. Trend line shows linear regression; dotted section forecasts future weeks." />
          </span>
        </div>
        <div style={{
          fontSize: 10,
          color: dk(darkMode, "rgba(255,255,255,0.35)", OS.muted),
          marginBottom: 12,
        }}>
          {weeklyBuckets.length > 0 ? `${weeklyBuckets.length} weeks of data` : ""}
        </div>
        {weeklyBuckets.length > 0 && (
          <CycleTimeChart buckets={weeklyBuckets} dark={darkMode} fullWidth height={220} />
        )}
      </div>

      {/* LOC & PR Stats */}
      <LOCStatsSection darkMode={darkMode} metrics={metrics} timeRange={timeRange} />

      {/* AI Impact on Cycle Time */}
      <AIImpactSection darkMode={darkMode} metrics={metrics} />

      {/* Per-Component Breakdown */}
      <ComponentBreakdown darkMode={darkMode} metrics={metrics} prToTickets={prToTickets} />

      {/* Developer Insights */}
      <PersonInsights darkMode={darkMode} metrics={metrics} prToTickets={prToTickets} timeRange={timeRange} reviews={reviews} authorTickets={authorTickets} />

      {/* Productivity Matrix */}
      <ProductivityMatrixSection darkMode={darkMode} personRows={personRows} />
    </>
  );
}
