import React, { useMemo, useState, useCallback } from "react";
import type { PRMetric, JiraTicket } from "@shared/types";
import { OS } from "@shared/tokens";
import { dk, fmtHours, computeComponentCycleRows, type ComponentCycleRow } from "../shared";
import { Sparkline, InfoTip } from "../charts";

interface ComponentBreakdownProps {
  darkMode: boolean;
  metrics: PRMetric[];
  prToTickets: Map<number, JiraTicket[]>;
}

type SortKey = "component" | "prCount" | "avgCycleHours" | "avgFirstReviewHours" | "avgReviewDays" | "avgSize" | "aiPct";

export function ComponentBreakdown({ darkMode, metrics, prToTickets }: ComponentBreakdownProps) {
  const rows = useMemo(
    () => computeComponentCycleRows(metrics, prToTickets),
    [metrics, prToTickets],
  );

  const [sortKey, setSortKey] = useState<SortKey>("avgCycleHours");
  const [sortAsc, setSortAsc] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const handleSort = useCallback((key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  }, [sortKey, sortAsc]);

  const sorted = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => {
      const av = a[sortKey] ?? -Infinity;
      const bv = b[sortKey] ?? -Infinity;
      if (typeof av === "string" && typeof bv === "string") return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
    return arr;
  }, [rows, sortKey, sortAsc]);

  const cardBg = dk(darkMode, "#1c1c22", OS.white);
  const cardBorder = `1px solid ${dk(darkMode, "rgba(255,255,255,0.08)", OS.border)}`;
  const headerColor = dk(darkMode, "rgba(255,255,255,0.45)", OS.muted);
  const textColor = dk(darkMode, "#fff", OS.text);
  const subColor = dk(darkMode, "rgba(255,255,255,0.5)", OS.secondary);

  const hasLinks = rows.length > 0;

  return (
    <>
      <div style={{
        fontSize: 12, fontWeight: 600,
        color: dk(darkMode, "rgba(255,255,255,0.6)", OS.secondary),
        marginTop: 4,
      }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          By Component
          <InfoTip dark={darkMode} text="Cycle time breakdown per Jira component. Click column headers to sort. Click a row to see issue type breakdown. Red text indicates avg cycle time over 10 business days." />
        </span>
      </div>

      {!hasLinks ? (
        <div style={{
          padding: "20px 16px", borderRadius: 10, border: cardBorder, background: cardBg,
          fontSize: 11, color: dk(darkMode, "rgba(255,255,255,0.35)", OS.muted), textAlign: "center",
        }}>
          Link Jira tickets to see component breakdown
        </div>
      ) : (
        <div style={{ borderRadius: 10, border: cardBorder, background: cardBg, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead>
              <tr>
                {([
                  ["component", "Component"],
                  ["prCount", "PRs"],
                  ["avgCycleHours", "Avg Cycle"],
                  ["avgFirstReviewHours", "First Review"],
                  ["avgReviewDays", "Review Days"],
                  ["avgSize", "Avg Size"],
                  ["aiPct", "AI %"],
                ] as [SortKey, string][]).map(([key, label]) => (
                  <th key={key} onClick={() => handleSort(key)} style={{
                    padding: "8px 10px", textAlign: key === "component" ? "left" : "right",
                    color: headerColor, fontWeight: 600, cursor: "pointer",
                    borderBottom: `1px solid ${dk(darkMode, "rgba(255,255,255,0.06)", OS.border)}`,
                    userSelect: "none", fontSize: 10, whiteSpace: "nowrap",
                  }}>
                    {label}{sortKey === key ? (sortAsc ? " \u25B2" : " \u25BC") : ""}
                  </th>
                ))}
                <th style={{
                  padding: "8px 10px", textAlign: "right", color: headerColor, fontWeight: 600,
                  borderBottom: `1px solid ${dk(darkMode, "rgba(255,255,255,0.06)", OS.border)}`,
                  fontSize: 10,
                }}>Trend</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const flagCycle = r.avgCycleHours != null && r.avgCycleHours > 240;
                const isExpanded = expanded === r.component;
                return (
                  <React.Fragment key={r.component}>
                    <tr
                      onClick={() => setExpanded(isExpanded ? null : r.component)}
                      style={{
                        cursor: "pointer",
                        background: isExpanded ? dk(darkMode, "rgba(255,255,255,0.03)", "rgba(0,0,0,0.02)") : "transparent",
                      }}
                    >
                      <td style={{ padding: "8px 10px", color: subColor, fontWeight: 600 }}>{r.component}</td>
                      <td style={{ padding: "8px 10px", textAlign: "right", color: textColor, fontFamily: OS.mono }}>{r.prCount}</td>
                      <td style={{ padding: "8px 10px", textAlign: "right", color: flagCycle ? OS.red : textColor, fontFamily: OS.mono, fontWeight: flagCycle ? 700 : 400 }}>{fmtHours(r.avgCycleHours)}</td>
                      <td style={{ padding: "8px 10px", textAlign: "right", color: textColor, fontFamily: OS.mono }}>{fmtHours(r.avgFirstReviewHours)}</td>
                      <td style={{ padding: "8px 10px", textAlign: "right", color: textColor, fontFamily: OS.mono }}>{r.avgReviewDays.toFixed(1)}</td>
                      <td style={{ padding: "8px 10px", textAlign: "right", color: textColor, fontFamily: OS.mono }}>{r.avgSize}</td>
                      <td style={{ padding: "8px 10px", textAlign: "right", color: textColor, fontFamily: OS.mono }}>{r.aiPct}%</td>
                      <td style={{ padding: "8px 10px", textAlign: "right" }}>
                        {r.weeklyTrend.length >= 2 && (
                          <Sparkline data={r.weeklyTrend} width={64} height={22} color={flagCycle ? OS.red : OS.blue} />
                        )}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={8} style={{
                          padding: "8px 16px 12px",
                          background: dk(darkMode, "rgba(255,255,255,0.02)", "rgba(0,0,0,0.01)"),
                          borderBottom: `1px solid ${dk(darkMode, "rgba(255,255,255,0.04)", OS.border)}`,
                        }}>
                          <IssueTypeBar types={r.prsByType} darkMode={darkMode} total={r.prCount} />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

const TYPE_COLORS: Record<string, string> = {
  Bug: "#EF4444", Story: "#3B82F6", Task: "#10B981", "Sub-task": "#8B5CF6",
  Epic: "#F59E0B", Improvement: "#06B6D4", Unknown: "#9CA3AF",
};

function IssueTypeBar({ types, darkMode, total }: { types: Record<string, number>; darkMode: boolean; total: number }) {
  const entries = Object.entries(types).sort((a, b) => b[1] - a[1]);
  return (
    <div>
      <div style={{ fontSize: 10, color: dk(darkMode, "rgba(255,255,255,0.4)", OS.muted), marginBottom: 6 }}>Issue Types</div>
      <div style={{ display: "flex", height: 12, borderRadius: 4, overflow: "hidden", marginBottom: 6 }}>
        {entries.map(([type, count]) => (
          <div key={type} style={{
            width: `${(count / total) * 100}%`,
            background: TYPE_COLORS[type] ?? "#9CA3AF",
            opacity: 0.8,
          }} />
        ))}
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {entries.map(([type, count]) => (
          <span key={type} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: TYPE_COLORS[type] ?? "#9CA3AF", flexShrink: 0 }} />
            <span style={{ color: dk(darkMode, "rgba(255,255,255,0.5)", OS.secondary) }}>{type}</span>
            <span style={{ color: dk(darkMode, "rgba(255,255,255,0.3)", OS.faint), fontFamily: OS.mono }}>{count}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
