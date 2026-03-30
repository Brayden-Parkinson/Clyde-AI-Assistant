import React, { useMemo } from "react";
import type { PRMetric, JiraTicket } from "@shared/types";
import {
  TabProps,
  WeekBucket,
  TeamRow,
  computeWeeklyBuckets,
  computeTeamRows,
  computeTeamWeeklyCycles,
  dk,
  fmtHours,
} from "./shared";
import { OS } from "@shared/tokens";
import { InfoTip } from "./charts";

interface CycleTimeTabProps extends TabProps {
  CycleTimeChart: React.ComponentType<{
    buckets: WeekBucket[];
    dark: boolean;
    height?: number;
    fullWidth?: boolean;
  }>;
}

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
    <svg
      width={width}
      height={height}
      style={{ display: "block", flexShrink: 0 }}
    >
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

export function CycleTimeTab({
  darkMode,
  metrics,
  allMetrics,
  timeRange,
  selectedRepo,
  prToTickets,
  CycleTimeChart,
}: CycleTimeTabProps) {
  const cardBg = dk(darkMode, "#1c1c22", OS.white);
  const cardBorder = `1px solid ${dk(darkMode, "rgba(255,255,255,0.08)", OS.border)}`;

  const weeklyBuckets = useMemo(
    () => computeWeeklyBuckets(metrics, timeRange),
    [metrics, timeRange],
  );

  const teamRows = useMemo(
    () => computeTeamRows(allMetrics, selectedRepo, prToTickets),
    [allMetrics, selectedRepo, prToTickets],
  );

  const teamWeeklyCycles = useMemo(
    () => computeTeamWeeklyCycles(allMetrics, selectedRepo, prToTickets),
    [allMetrics, selectedRepo, prToTickets],
  );

  return (
    <>
      <div
        style={{
          padding: "14px 16px",
          borderRadius: 10,
          border: cardBorder,
          background: cardBg,
        }}
      >
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: dk(darkMode, "rgba(255,255,255,0.8)", OS.secondary),
            marginBottom: 2,
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            Weekly Average Cycle Time
            <InfoTip dark={darkMode} text="Average time from PR creation to merge per week, in business hours (weekends/nights excluded). Outliers removed. Trend line shows linear regression; dotted section forecasts future weeks." />
          </span>
        </div>
        <div
          style={{
            fontSize: 10,
            color: dk(darkMode, "rgba(255,255,255,0.35)", OS.muted),
            marginBottom: 12,
          }}
        >
          {weeklyBuckets.length > 0
            ? `${weeklyBuckets.length} weeks of data`
            : ""}
        </div>
        {weeklyBuckets.length > 0 && (
          <CycleTimeChart
            buckets={weeklyBuckets}
            dark={darkMode}
            fullWidth
            height={220}
          />
        )}
      </div>

      <div
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: dk(darkMode, "rgba(255,255,255,0.6)", OS.secondary),
          marginTop: 4,
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          By Team
          <InfoTip dark={darkMode} text="Average cycle time per Jira component/team. Red border indicates teams averaging over 10 days. Sparkline shows the weekly trend over the selected period." />
        </span>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 10,
        }}
      >
        {teamRows
          .filter((r) => r.team !== "Unlinked")
          .sort((a, b) => (b.avgCycleHours ?? 0) - (a.avgCycleHours ?? 0))
          .map((r) => {
            const flagCycle =
              r.avgCycleHours != null && r.avgCycleHours > 240;
            const trend = teamWeeklyCycles.get(r.team) ?? [];
            return (
              <div
                key={r.team}
                style={{
                  padding: "14px 16px",
                  borderRadius: 10,
                  border: cardBorder,
                  background: cardBg,
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: dk(
                      darkMode,
                      "rgba(255,255,255,0.6)",
                      OS.secondary,
                    ),
                  }}
                >
                  {r.team}
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: 8,
                  }}
                >
                  <span
                    style={{
                      fontSize: 20,
                      fontWeight: 700,
                      color: flagCycle
                        ? OS.red
                        : dk(darkMode, "#fff", OS.text),
                    }}
                  >
                    {fmtHours(r.avgCycleHours)}
                  </span>
                  <span
                    style={{
                      fontSize: 10,
                      color: dk(
                        darkMode,
                        "rgba(255,255,255,0.3)",
                        OS.faint,
                      ),
                    }}
                  >
                    {r.prCount} PRs
                  </span>
                </div>
                {trend.length >= 2 && (
                  <Sparkline
                    data={trend}
                    width={120}
                    height={28}
                    color={flagCycle ? OS.red : OS.blue}
                  />
                )}
                <div
                  style={{
                    fontSize: 10,
                    color: dk(
                      darkMode,
                      "rgba(255,255,255,0.35)",
                      OS.muted,
                    ),
                    fontFamily: OS.mono,
                  }}
                >
                  med review: {fmtHours(r.medReviewHours)}
                </div>
              </div>
            );
          })}
      </div>
    </>
  );
}
