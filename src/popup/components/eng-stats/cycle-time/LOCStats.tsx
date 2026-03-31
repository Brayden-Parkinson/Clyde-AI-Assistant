import React, { useMemo } from "react";
import type { PRMetric } from "@shared/types";
import { OS } from "@shared/tokens";
import { dk, fmtHours, computeLOCStats } from "../shared";
import { LOCBarChart, InfoTip } from "../charts";

interface LOCStatsProps {
  darkMode: boolean;
  metrics: PRMetric[];
  timeRange: number;
}

function MiniCard({ label, value, dark }: { label: string; value: string; dark: boolean }) {
  return (
    <div style={{
      padding: "12px 14px",
      borderRadius: 8,
      border: `1px solid ${dk(dark, "rgba(255,255,255,0.12)", OS.border)}`,
      background: dk(dark, "#1c1c22", OS.white),
      flex: 1,
      minWidth: 0,
    }}>
      <div style={{ fontSize: 12, color: dk(dark, "rgba(255,255,255,0.55)", OS.muted), marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 600, color: dk(dark, "#fff", OS.text), fontFamily: OS.mono }}>{value}</div>
    </div>
  );
}

function fmtLOC(n: number): string {
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function LOCStatsSection({ darkMode, metrics, timeRange }: LOCStatsProps) {
  const stats = useMemo(() => computeLOCStats(metrics, timeRange), [metrics, timeRange]);
  const cardBg = dk(darkMode, "#1c1c22", OS.white);
  const cardBorder = `1px solid ${dk(darkMode, "rgba(255,255,255,0.08)", OS.border)}`;

  return (
    <>
      <div style={{
        fontSize: 12, fontWeight: 600,
        color: dk(darkMode, "rgba(255,255,255,0.5)", OS.secondary),
        marginTop: 4,
      }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          LOC & PR Stats
          <InfoTip dark={darkMode} text="Lines of code and pull request throughput metrics. PR sizes benchmarked against LinearB data: Elite <194, Good <400, Fair <800 lines changed." />
        </span>
      </div>

      {/* KPI row */}
      <div style={{ display: "flex", gap: 10 }}>
        <MiniCard label="Total LOC" value={fmtLOC(stats.totalAdditions + stats.totalDeletions)} dark={darkMode} />
        <MiniCard label="Net LOC" value={(stats.netLOC >= 0 ? "+" : "") + fmtLOC(stats.netLOC)} dark={darkMode} />
        <MiniCard label="Avg PR Size" value={fmtLOC(stats.avgPRSize)} dark={darkMode} />
        <MiniCard label="PRs / Week" value={stats.prsPerWeek.toFixed(1)} dark={darkMode} />
      </div>

      {/* Weekly LOC chart */}
      {stats.weeklyLOC.length > 1 && (
        <div style={{ padding: "14px 16px", borderRadius: 10, border: cardBorder, background: cardBg }}>
          <div style={{
            fontSize: 11, fontWeight: 600,
            color: dk(darkMode, "rgba(255,255,255,0.6)", OS.secondary),
            marginBottom: 8,
          }}>Weekly Lines Changed</div>
          <LOCBarChart data={stats.weeklyLOC} dark={darkMode} height={140} />
        </div>
      )}

      {/* PR Size Distribution */}
      {stats.totalPRs > 0 && (
        <div style={{ padding: "14px 16px", borderRadius: 10, border: cardBorder, background: cardBg }}>
          <div style={{
            fontSize: 11, fontWeight: 600,
            color: dk(darkMode, "rgba(255,255,255,0.6)", OS.secondary),
            marginBottom: 10,
          }}>PR Size Distribution</div>
          <div style={{
            fontSize: 10, color: dk(darkMode, "rgba(255,255,255,0.4)", OS.faint),
            marginBottom: 8, fontFamily: OS.mono,
          }}>
            S: Elite &lt;194 lines | M: Good &lt;400 | L: Fair &lt;800 | XL: 800+
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {stats.prSizeBuckets.map((b) => {
              const pct = stats.totalPRs > 0 ? (b.count / stats.totalPRs) * 100 : 0;
              return (
                <div key={b.label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{
                    fontSize: 10, fontFamily: OS.mono, width: 80, flexShrink: 0,
                    color: dk(darkMode, "rgba(255,255,255,0.6)", OS.secondary),
                  }}>{b.label}</span>
                  <div style={{
                    flex: 1, height: 14, borderRadius: 4,
                    background: dk(darkMode, "rgba(255,255,255,0.06)", "rgba(0,0,0,0.04)"),
                    overflow: "hidden",
                  }}>
                    <div style={{
                      width: `${pct}%`, height: "100%", borderRadius: 4,
                      background: b.color, opacity: 0.8,
                      transition: "width 0.3s",
                    }} />
                  </div>
                  <span style={{
                    fontSize: 10, fontFamily: OS.mono, width: 60, textAlign: "right", flexShrink: 0, paddingRight: 4,
                    color: dk(darkMode, "rgba(255,255,255,0.5)", OS.muted),
                  }}>{b.count} ({Math.round(pct)}%)</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
