/**
 * TeamsTab — Sortable table of team rows with expandable detail rows
 * showing cycle trend sparkline, PR size mix bar, and flags.
 */

import React, { useState, useMemo, useCallback } from "react";
import { OS } from "@shared/tokens";
import type { TabProps, EngStatsConfig, TeamColumnId } from "./shared";
import {
  computeTeamRows,
  computeTeamWeeklyCycles,
  dk,
  fmtHours,
  PR_SIZE_BUCKETS,
  toBusinessHours,
  weekKey,
} from "./shared";

export interface TeamsTabProps extends TabProps {
  config: EngStatsConfig;
}

// ─── Local Sparkline ───

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

// ─── TeamsTab ───

export function TeamsTab({ darkMode, allMetrics, selectedRepo, prToTickets, config }: TeamsTabProps) {
  // ─── Internal state ───
  const [teamSortCol, setTeamSortCol] = useState<string>("prs");
  const [teamSortDir, setTeamSortDir] = useState(-1);
  const [expandedTeam, setExpandedTeam] = useState<string | null>(null);
  const [hoveredTeam, setHoveredTeam] = useState<string | null>(null);

  // ─── Computed data ───
  const teamRows = useMemo(
    () => computeTeamRows(allMetrics, selectedRepo, prToTickets),
    [allMetrics, selectedRepo, prToTickets],
  );

  const teamWeeklyCycles = useMemo(
    () => computeTeamWeeklyCycles(allMetrics, selectedRepo, prToTickets),
    [allMetrics, selectedRepo, prToTickets],
  );

  const teamSizeDist = useMemo(() => {
    const result = new Map<string, { s: number; m: number; l: number; xl: number }>();
    const source = selectedRepo === "__all__" ? allMetrics : allMetrics.filter((x) => x.repo === selectedRepo);
    for (const m of source) {
      const tickets = prToTickets.get(m.id!);
      const team = tickets?.[0]?.component ?? (tickets?.length ? "No Component" : "Unlinked");
      if (!result.has(team)) result.set(team, { s: 0, m: 0, l: 0, xl: 0 });
      const dist = result.get(team)!;
      const lines = m.additions + m.deletions;
      if (lines < PR_SIZE_BUCKETS[0].max) dist.s++;
      else if (lines < PR_SIZE_BUCKETS[1].max) dist.m++;
      else if (lines < PR_SIZE_BUCKETS[2].max) dist.l++;
      else dist.xl++;
    }
    return result;
  }, [allMetrics, selectedRepo, prToTickets]);

  const sortedTeamRows = useMemo(() => {
    return [...teamRows].sort((a, b) => {
      let va: number, vb: number;
      switch (teamSortCol) {
        case "prs": va = a.prCount; vb = b.prCount; break;
        case "cycle": va = a.avgCycleHours ?? 0; vb = b.avgCycleHours ?? 0; break;
        case "medReview": va = a.medReviewHours ?? 0; vb = b.medReviewHours ?? 0; break;
        case "avgLines": va = a.avgSize; vb = b.avgSize; break;
        case "ai": va = a.aiPctTeam; vb = b.aiPctTeam; break;
        default: va = a.prCount; vb = b.prCount;
      }
      return (va - vb) * teamSortDir;
    });
  }, [teamRows, teamSortCol, teamSortDir]);

  // ─── Sort handler ───
  const handleTeamSort = useCallback((col: string) => {
    setTeamSortCol((prev) => {
      if (prev === col) {
        setTeamSortDir((d) => d * -1);
        return col;
      }
      setTeamSortDir(-1);
      return col;
    });
  }, []);

  // ─── Dynamic grid columns ───
  const gridCols = `180px ${config.teamColumns.includes("prs") ? "60px " : ""}${config.teamColumns.includes("cycle") ? "80px " : ""}${config.teamColumns.includes("medReview") ? "90px " : ""}${config.teamColumns.includes("avgLines") ? "80px " : ""}${config.teamColumns.includes("ai") ? "60px " : ""}${config.teamColumns.includes("trend") ? "90px" : ""}`;

  // ─── Cell style helpers ───
  const cellMono = (flag?: boolean): React.CSSProperties => ({
    textAlign: "right",
    fontSize: 12,
    fontFamily: OS.mono,
    color: flag ? OS.red : dk(darkMode, "rgba(255,255,255,0.7)", OS.secondary),
  });

  const headerStyle: React.CSSProperties = {
    fontSize: 10,
    color: dk(darkMode, "rgba(255,255,255,0.4)", OS.muted),
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    fontFamily: OS.mono,
  };

  return (
    <div style={{ padding: 0, borderRadius: 10, border: `1px solid ${dk(darkMode, "rgba(255,255,255,0.06)", OS.border)}`, background: dk(darkMode, "rgba(255,255,255,0.03)", OS.white), overflow: "hidden" }}>
      {/* Table header */}
      <div style={{
        display: "grid",
        gridTemplateColumns: gridCols,
        padding: "10px 16px",
        borderBottom: `1px solid ${dk(darkMode, "rgba(255,255,255,0.06)", OS.border)}`,
      }}>
        <div style={headerStyle}>Team</div>
        {([
          { col: "prs" as TeamColumnId, l: "PRs" },
          { col: "cycle" as TeamColumnId, l: "Cycle" },
          { col: "medReview" as TeamColumnId, l: "Med Review" },
          { col: "avgLines" as TeamColumnId, l: "Δ Lines" },
          { col: "ai" as TeamColumnId, l: "AI %" },
        ])
          .filter((c) => config.teamColumns.includes(c.col))
          .map((c) => (
            <div key={c.col} onClick={() => handleTeamSort(c.col)} style={{
              ...headerStyle,
              textAlign: "right",
              cursor: "pointer",
              userSelect: "none",
            }}>
              {c.l} {teamSortCol === c.col ? (teamSortDir > 0 ? "↑" : "↓") : ""}
            </div>
          ))}
        {config.teamColumns.includes("trend") && (
          <div style={{ ...headerStyle, textAlign: "right" }}>Trend</div>
        )}
      </div>

      {/* Rows */}
      {sortedTeamRows.map((row) => {
        const isGhost = row.team === "No Component" || row.team === "Unlinked";
        const flagCycle = row.avgCycleHours != null && row.avgCycleHours > 240;
        const flagReview = row.medReviewHours != null && row.medReviewHours >= 24;
        const trend = teamWeeklyCycles.get(row.team) ?? [];
        const sizeDist = teamSizeDist.get(row.team) ?? { s: 0, m: 0, l: 0, xl: 0 };
        const sizeTotal = sizeDist.s + sizeDist.m + sizeDist.l + sizeDist.xl || 1;
        const isExpanded = expandedTeam === row.team;

        return (
          <div key={row.team}>
            <div
              onClick={() => setExpandedTeam(isExpanded ? null : row.team)}
              onMouseEnter={() => setHoveredTeam(row.team)}
              onMouseLeave={() => setHoveredTeam(null)}
              style={{
                display: "grid",
                gridTemplateColumns: gridCols,
                padding: "10px 16px",
                cursor: "pointer",
                borderBottom: `1px solid ${dk(darkMode, "rgba(255,255,255,0.03)", "rgba(0,0,0,0.04)")}`,
                background: isExpanded
                  ? dk(darkMode, "rgba(255,255,255,0.03)", "rgba(0,0,0,0.02)")
                  : hoveredTeam === row.team
                    ? dk(darkMode, "rgba(255,255,255,0.02)", "rgba(0,0,0,0.015)")
                    : "transparent",
                opacity: isGhost ? 0.55 : 1,
                transition: "background 0.1s",
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", gap: 6, color: dk(darkMode, "rgba(255,255,255,0.85)", OS.text) }}>
                <span style={{ display: "inline-block", fontSize: 8, opacity: 0.3, transform: isExpanded ? "rotate(90deg)" : "none", transition: "transform 0.1s" }}>▶</span>
                {row.team}
                {row.team === "No Component" && (
                  <span style={{ fontSize: 9, opacity: 0.3, background: dk(darkMode, "rgba(255,255,255,0.06)", OS.bg), padding: "1px 5px", borderRadius: 3 }}>untagged</span>
                )}
              </div>
              {config.teamColumns.includes("prs") && <div style={cellMono()}>{row.prCount}</div>}
              {config.teamColumns.includes("cycle") && <div style={cellMono(flagCycle)}>{fmtHours(row.avgCycleHours)}</div>}
              {config.teamColumns.includes("medReview") && <div style={cellMono(flagReview)}>{fmtHours(row.medReviewHours)}</div>}
              {config.teamColumns.includes("avgLines") && <div style={cellMono()}>{row.avgSize > 0 ? `±${row.avgSize}` : "—"}</div>}
              {config.teamColumns.includes("ai") && (
                <div style={{ ...cellMono(), color: row.aiPctTeam > 30 ? OS.green : row.aiPctTeam > 15 ? OS.warning : undefined, opacity: row.aiPctTeam > 0 ? 0.9 : 0.3 }}>
                  {row.aiPctTeam}%
                </div>
              )}
              {config.teamColumns.includes("trend") && (
                <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center" }}>
                  {trend.length >= 2 && <Sparkline data={trend} width={80} height={18} color={flagCycle ? OS.red : OS.blue} />}
                </div>
              )}
            </div>

            {/* Expanded detail */}
            {isExpanded && (
              <div style={{ padding: "12px 16px", borderTop: `1px solid ${dk(darkMode, "rgba(255,255,255,0.06)", OS.border)}` }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
                  <div>
                    <div style={{ fontSize: 10, color: dk(darkMode, "rgba(255,255,255,0.4)", OS.muted), textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6, fontFamily: OS.mono }}>Cycle trend (6w)</div>
                    {trend.length >= 2 ? (
                      <Sparkline data={trend} width={140} height={36} color={flagCycle ? OS.red : OS.blue} />
                    ) : (
                      <span style={{ fontSize: 11, color: dk(darkMode, "rgba(255,255,255,0.3)", OS.muted) }}>No data</span>
                    )}
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: dk(darkMode, "rgba(255,255,255,0.4)", OS.muted), textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6, fontFamily: OS.mono }}>PR size mix</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ display: "flex", height: 8, flex: 1, borderRadius: 4, overflow: "hidden" }}>
                        <div style={{ width: `${(sizeDist.s / sizeTotal) * 100}%`, background: PR_SIZE_BUCKETS[0].color }} />
                        <div style={{ width: `${(sizeDist.m / sizeTotal) * 100}%`, background: PR_SIZE_BUCKETS[1].color }} />
                        <div style={{ width: `${(sizeDist.l / sizeTotal) * 100}%`, background: PR_SIZE_BUCKETS[2].color }} />
                        <div style={{ width: `${(sizeDist.xl / sizeTotal) * 100}%`, background: PR_SIZE_BUCKETS[3].color }} />
                      </div>
                      <span style={{ fontSize: 10, color: dk(darkMode, "rgba(255,255,255,0.4)", OS.muted), fontFamily: OS.mono, whiteSpace: "nowrap" }}>
                        {sizeDist.s}/{sizeDist.m}/{sizeDist.l}/{sizeDist.xl}
                      </span>
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: dk(darkMode, "rgba(255,255,255,0.4)", OS.muted), textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6, fontFamily: OS.mono }}>Flags</div>
                    <div style={{ fontSize: 11, lineHeight: 1.6, color: dk(darkMode, "rgba(255,255,255,0.7)", OS.secondary) }}>
                      {flagCycle && <div style={{ color: OS.red }}>⚠ Cycle time &gt; 10 business days</div>}
                      {flagReview && <div style={{ color: OS.warning }}>⚠ Review time in hours</div>}
                      {!flagCycle && !flagReview && <div style={{ opacity: 0.3 }}>No flags</div>}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
