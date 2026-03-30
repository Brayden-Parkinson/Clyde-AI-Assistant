import React, { useMemo } from "react";
import type { PRMetric } from "@shared/types";
import { OS } from "@shared/tokens";
import { dk, fmtHours, computeCycleTimeAIComparison } from "../shared";
import { InfoTip } from "../charts";

interface AIImpactProps {
  darkMode: boolean;
  metrics: PRMetric[];
}

export function AIImpactSection({ darkMode, metrics }: AIImpactProps) {
  const comparison = useMemo(() => computeCycleTimeAIComparison(metrics), [metrics]);
  const cardBg = dk(darkMode, "#1c1c22", OS.white);
  const cardBorder = `1px solid ${dk(darkMode, "rgba(255,255,255,0.08)", OS.border)}`;

  return (
    <>
      <div style={{
        fontSize: 12, fontWeight: 600,
        color: dk(darkMode, "rgba(255,255,255,0.6)", OS.secondary),
        marginTop: 4,
      }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          AI Impact on Cycle Time
          <InfoTip dark={darkMode} text="Compares PRs flagged as AI-assisted vs those without AI tool signals. Requires at least 3 PRs in each category." />
        </span>
      </div>

      {!comparison ? (
        <div style={{
          padding: "20px 16px", borderRadius: 10, border: cardBorder, background: cardBg,
          fontSize: 11, color: dk(darkMode, "rgba(255,255,255,0.35)", OS.muted), textAlign: "center",
        }}>
          Need at least 3 AI-assisted and 3 human-only PRs to compare
        </div>
      ) : (
        <div style={{ display: "flex", gap: 10 }}>
          {/* AI-Assisted Card */}
          <ComparisonCard
            label="AI-Assisted"
            data={comparison.aiPRs}
            darkMode={darkMode}
            accent={OS.blue}
          />

          {/* Delta column */}
          <div style={{
            display: "flex", flexDirection: "column", justifyContent: "center",
            alignItems: "center", gap: 6, minWidth: 80,
          }}>
            <DeltaBadge
              label="Cycle Time"
              deltaPct={comparison.cycleTimeDeltaPct}
              darkMode={darkMode}
            />
            <DeltaBadge
              label="First Review"
              deltaPct={comparison.firstReviewDeltaPct}
              darkMode={darkMode}
            />
          </div>

          {/* Human-Only Card */}
          <ComparisonCard
            label="Human-Only"
            data={comparison.nonAIPRs}
            darkMode={darkMode}
            accent={dk(darkMode, "rgba(255,255,255,0.5)", OS.secondary)}
          />
        </div>
      )}
    </>
  );
}

function ComparisonCard({
  label, data, darkMode, accent,
}: {
  label: string;
  data: { count: number; avgCycleHours: number; avgFirstReviewHours: number; avgSize: number };
  darkMode: boolean;
  accent: string;
}) {
  const cardBg = dk(darkMode, "#1c1c22", OS.white);
  const cardBorder = `1px solid ${dk(darkMode, "rgba(255,255,255,0.08)", OS.border)}`;

  return (
    <div style={{
      flex: 1, padding: "14px 16px", borderRadius: 10,
      border: cardBorder, background: cardBg,
    }}>
      <div style={{
        fontSize: 11, fontWeight: 600, color: accent, marginBottom: 10,
        borderBottom: `2px solid ${accent}`, paddingBottom: 4, display: "inline-block",
      }}>{label}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <StatRow label="PRs" value={String(data.count)} darkMode={darkMode} />
        <StatRow label="Avg Cycle" value={fmtHours(data.avgCycleHours)} darkMode={darkMode} />
        <StatRow label="Avg First Review" value={fmtHours(data.avgFirstReviewHours)} darkMode={darkMode} />
        <StatRow label="Avg Size" value={`${data.avgSize} lines`} darkMode={darkMode} />
      </div>
    </div>
  );
}

function StatRow({ label, value, darkMode }: { label: string; value: string; darkMode: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
      <span style={{ fontSize: 10, color: dk(darkMode, "rgba(255,255,255,0.4)", OS.muted) }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 600, fontFamily: OS.mono, color: dk(darkMode, "#fff", OS.text) }}>{value}</span>
    </div>
  );
}

function DeltaBadge({ label, deltaPct, darkMode }: { label: string; deltaPct: number; darkMode: boolean }) {
  const faster = deltaPct < 0;
  const color = faster ? OS.green : deltaPct > 0 ? "#F97316" : dk(darkMode, "rgba(255,255,255,0.4)", OS.muted);
  const arrow = faster ? "\u2193" : deltaPct > 0 ? "\u2191" : "";
  const text = deltaPct === 0
    ? "Same"
    : `${arrow} ${Math.abs(Math.round(deltaPct))}% ${faster ? "faster" : "slower"}`;

  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 9, color: dk(darkMode, "rgba(255,255,255,0.35)", OS.muted), marginBottom: 2 }}>{label}</div>
      <div style={{
        fontSize: 10, fontWeight: 600, fontFamily: OS.mono,
        color, padding: "2px 6px", borderRadius: 4,
        background: dk(darkMode, "rgba(255,255,255,0.05)", "rgba(0,0,0,0.03)"),
      }}>{text}</div>
    </div>
  );
}
