import React, { useMemo, useState, useCallback } from "react";
import type { PRMetric, JiraTicket } from "@shared/types";
import { OS } from "@shared/tokens";
import { dk, fmtHours, computePersonRows, type PersonRow } from "../shared";
import { applyProductivityScores, SCORE_TOOLTIPS } from "./productivityScore";
import { Sparkline, InfoTip } from "../charts";

interface PersonInsightsProps {
  darkMode: boolean;
  metrics: PRMetric[];
  prToTickets: Map<number, JiraTicket[]>;
  timeRange: number;
}

type SortKey = "author" | "prCount" | "prsPerWeek" | "avgCycleHours" | "aiPct" | "avgReviewDays" | "velocity" | "quality" | "impact" | "overall";

const MIN_AUTHORS_FOR_SCORE = 5;

// ─── Deterministic avatar color from name ───

const AVATAR_PALETTE = ["#E53E3E", "#DD6B20", "#38A169", "#3182CE", "#805AD5", "#D53F8C", "#2B6CB0"];

function nameToColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_PALETTE[((hash % AVATAR_PALETTE.length) + AVATAR_PALETTE.length) % AVATAR_PALETTE.length];
}

function getInitials(name: string): string {
  const parts = name.replace(/[^a-zA-Z0-9 -]/g, "").split(/[\s-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// ─── AI % badge tiers ───

function aiPctStyle(pct: number, dark: boolean): React.CSSProperties {
  if (pct >= 80) return { background: dk(dark, "rgba(45,212,191,0.25)", "rgba(20,184,166,0.18)"), color: dk(dark, "#5EEAD4", "#0D9488"), fontWeight: 600 };
  if (pct >= 50) return { background: dk(dark, "rgba(45,212,191,0.12)", "rgba(20,184,166,0.10)"), color: dk(dark, "#99F6E4", "#0F766E") };
  if (pct >= 25) return { background: dk(dark, "rgba(255,255,255,0.05)", "rgba(0,0,0,0.04)"), color: dk(dark, "rgba(255,255,255,0.5)", OS.secondary) };
  if (pct >= 1) return { background: dk(dark, "rgba(255,255,255,0.03)", "rgba(0,0,0,0.02)"), color: dk(dark, "rgba(255,255,255,0.35)", OS.muted) };
  return { background: "transparent", color: dk(dark, "rgba(255,255,255,0.2)", OS.faint) };
}

// ─── Score bar colors ───

function scoreBarColor(value: number): string {
  if (value >= 70) return "#14B8A6";
  if (value >= 50) return "#3B82F6";
  if (value >= 35) return "#6B7280";
  return "#EF4444";
}

// ─── Overall badge tiers ───

function overallStyle(value: number, dark: boolean): React.CSSProperties {
  if (value >= 65) return { background: dk(dark, "rgba(34,197,94,0.15)", "rgba(34,197,94,0.12)"), color: dk(dark, "#4ADE80", "#16A34A") };
  if (value >= 55) return { background: dk(dark, "rgba(59,130,246,0.15)", "rgba(59,130,246,0.12)"), color: dk(dark, "#60A5FA", "#2563EB") };
  if (value >= 45) return { background: dk(dark, "rgba(255,255,255,0.06)", "rgba(0,0,0,0.04)"), color: dk(dark, "rgba(255,255,255,0.55)", OS.secondary) };
  return { background: dk(dark, "rgba(239,68,68,0.15)", "rgba(239,68,68,0.10)"), color: dk(dark, "#F87171", "#DC2626") };
}

// ─── Rev Days color ───

function revDaysStyle(days: number, dark: boolean): React.CSSProperties {
  if (days >= 2.5) return { color: dk(dark, "#F87171", "#DC2626"), fontWeight: 500 };
  if (days >= 2.0) return { color: dk(dark, "#FBBF24", "#D97706") };
  return { color: dk(dark, "rgba(255,255,255,0.55)", OS.secondary) };
}

// ─── Compact columns ───

const COMPACT_KEYS = new Set<SortKey>(["author", "prsPerWeek", "aiPct", "overall", "avgReviewDays"]);

const SORT_CYCLE: SortKey[] = ["overall", "aiPct", "velocity", "quality", "impact", "avgReviewDays", "prsPerWeek", "prCount"];

export function PersonInsights({ darkMode, metrics, prToTickets, timeRange }: PersonInsightsProps) {
  const rows = useMemo(() => {
    const base = computePersonRows(metrics, prToTickets, timeRange);
    return applyProductivityScores(base, metrics, prToTickets, timeRange);
  }, [metrics, prToTickets, timeRange]);

  const nullAuthorCount = useMemo(
    () => metrics.filter((m) => !m.author).length,
    [metrics],
  );

  const showScores = rows.length >= MIN_AUTHORS_FOR_SCORE;

  const [sortKey, setSortKey] = useState<SortKey>(showScores ? "overall" : "author");
  const [sortAsc, setSortAsc] = useState(showScores ? false : true);
  const [compact, setCompact] = useState(false);

  const handleSort = useCallback((key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(key === "author"); }
  }, [sortKey, sortAsc]);

  const cycleSortKey = useCallback(() => {
    const idx = SORT_CYCLE.indexOf(sortKey);
    const next = SORT_CYCLE[(idx + 1) % SORT_CYCLE.length];
    setSortKey(next);
    setSortAsc(false);
  }, [sortKey]);

  const sorted = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => {
      if (sortKey === "velocity" || sortKey === "quality" || sortKey === "impact" || sortKey === "overall") {
        const av = a.scores?.[sortKey] ?? -Infinity;
        const bv = b.scores?.[sortKey] ?? -Infinity;
        return sortAsc ? av - bv : bv - av;
      }
      const av = a[sortKey as keyof PersonRow] ?? -Infinity;
      const bv = b[sortKey as keyof PersonRow] ?? -Infinity;
      if (typeof av === "string" && typeof bv === "string") return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
    return arr;
  }, [rows, sortKey, sortAsc]);

  // ─── Summary card stats ───

  const summaryStats = useMemo(() => {
    if (rows.length === 0) return null;
    const avgAi = Math.round(rows.reduce((s, r) => s + r.aiPct, 0) / rows.length);
    const aboveHalf = rows.filter((r) => r.aiPct > 50).length;
    const avgOverall = showScores
      ? Math.round(rows.reduce((s, r) => s + (r.scores?.overall ?? 0), 0) / rows.length)
      : null;
    const avgRevDays = +(rows.reduce((s, r) => s + r.avgReviewDays, 0) / rows.length).toFixed(1);
    const flaggedRev = rows.filter((r) => r.avgReviewDays >= 2.5).length;
    const totalPRs = rows.reduce((s, r) => s + r.prCount, 0);
    return { avgAi, aboveHalf, avgOverall, avgRevDays, flaggedRev, totalPRs, devCount: rows.length };
  }, [rows, showScores]);

  const cardBg = dk(darkMode, "#1c1c22", OS.white);
  const cardBorder = `1px solid ${dk(darkMode, "rgba(255,255,255,0.08)", OS.border)}`;
  const headerColor = dk(darkMode, "rgba(255,255,255,0.45)", OS.muted);
  const textColor = dk(darkMode, "#fff", OS.text);
  const rowHoverBg = dk(darkMode, "rgba(255,255,255,0.03)", "rgba(0,0,0,0.02)");
  const altRowBg = dk(darkMode, "rgba(255,255,255,0.015)", "rgba(0,0,0,0.01)");
  const borderColor = dk(darkMode, "rgba(255,255,255,0.06)", OS.border);

  type ColDef = { key: SortKey; label: string; left?: boolean; tip?: string };

  const allColumns: ColDef[] = useMemo(() => {
    const cols: ColDef[] = [
      { key: "author", label: "Person", left: true },
      { key: "prCount", label: "PRs" },
      { key: "prsPerWeek", label: "PRs/wk" },
      { key: "avgCycleHours", label: "Cycle" },
      { key: "aiPct", label: "AI %" },
      { key: "avgReviewDays", label: "Rev Days" },
    ];
    if (showScores) {
      cols.push(
        { key: "velocity", label: "Velocity", tip: SCORE_TOOLTIPS.velocity },
        { key: "quality", label: "Quality", tip: SCORE_TOOLTIPS.quality },
        { key: "impact", label: "Impact", tip: SCORE_TOOLTIPS.impact },
        { key: "overall", label: "Overall", tip: SCORE_TOOLTIPS.overall },
      );
    }
    return cols;
  }, [showScores]);

  const columns = compact ? allColumns.filter((c) => COMPACT_KEYS.has(c.key)) : allColumns;

  function fmtLOC(n: number): string {
    return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
  }

  const sortLabel = allColumns.find((c) => c.key === sortKey)?.label ?? sortKey;

  return (
    <>
      {/* ─── Section header ─── */}
      <div style={{
        fontSize: 12, fontWeight: 600,
        color: dk(darkMode, "rgba(255,255,255,0.6)", OS.secondary),
        marginTop: 4,
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          Developer Insights
          <span style={{ fontWeight: 400, color: dk(darkMode, "rgba(255,255,255,0.3)", OS.faint), fontSize: 11 }}>
            {rows.length} engineer{rows.length !== 1 ? "s" : ""}
          </span>
          <InfoTip dark={darkMode} text={
            showScores
              ? "Per-developer metrics with multi-dimensional scoring. V=Velocity (shipping speed), Q=Quality (clean PRs), I=Impact (substantive contribution), Overall=composite. Hover each score header for formula details."
              : "Per-developer metrics. Scoring requires 5+ contributors to display."
          } />
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          {/* Compact toggle */}
          <button
            onClick={() => setCompact(!compact)}
            style={{
              fontSize: 10, fontWeight: 500, padding: "3px 8px", borderRadius: 4,
              border: `1px solid ${dk(darkMode, "rgba(255,255,255,0.12)", OS.border)}`,
              background: dk(darkMode, "rgba(255,255,255,0.06)", "rgba(0,0,0,0.03)"),
              color: dk(darkMode, "rgba(255,255,255,0.55)", OS.secondary),
              cursor: "pointer",
            }}
          >
            {compact ? "Expanded" : "Compact"}
          </button>
          {/* Sort cycle button */}
          <button
            onClick={cycleSortKey}
            style={{
              fontSize: 10, fontWeight: 500, padding: "3px 8px", borderRadius: 4,
              border: `1px solid ${dk(darkMode, "rgba(255,255,255,0.12)", OS.border)}`,
              background: dk(darkMode, "rgba(255,255,255,0.06)", "rgba(0,0,0,0.03)"),
              color: dk(darkMode, "rgba(255,255,255,0.55)", OS.secondary),
              cursor: "pointer",
            }}
          >
            Sort: {sortLabel}
          </button>
        </span>
      </div>

      {nullAuthorCount > 0 && (
        <div style={{
          fontSize: 10, color: "#F97316", padding: "6px 10px", borderRadius: 6,
          background: dk(darkMode, "rgba(249,115,22,0.1)", "rgba(249,115,22,0.06)"),
          border: `1px solid ${dk(darkMode, "rgba(249,115,22,0.2)", "rgba(249,115,22,0.15)")}`,
        }}>
          {nullAuthorCount} PR{nullAuthorCount > 1 ? "s" : ""} missing author data — re-sync to populate
        </div>
      )}

      {rows.length === 0 ? (
        <div style={{
          padding: "20px 16px", borderRadius: 10, border: cardBorder, background: cardBg,
          fontSize: 11, color: dk(darkMode, "rgba(255,255,255,0.35)", OS.muted), textAlign: "center",
        }}>
          No developers with 2+ PRs in this period
        </div>
      ) : (
        <>
          {/* ─── Summary cards ─── */}
          {summaryStats && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
              <SummaryCard dark={darkMode} label="Avg AI adoption" value={`${summaryStats.avgAi}%`} subtitle={`${summaryStats.aboveHalf} above 50%`} />
              <SummaryCard dark={darkMode} label="Avg overall score" value={summaryStats.avgOverall != null ? String(summaryStats.avgOverall) : "—"} subtitle={`out of 100 · ${summaryStats.devCount} devs`} />
              <SummaryCard dark={darkMode} label="Avg review days" value={`${summaryStats.avgRevDays}d`} subtitle={`${summaryStats.flaggedRev} flagged`} />
              <SummaryCard dark={darkMode} label="Total PRs" value={String(summaryStats.totalPRs)} subtitle="this period" />
            </div>
          )}

          {/* ─── Table ─── */}
          <div style={{ borderRadius: 10, border: cardBorder, background: cardBg, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, tableLayout: "fixed" }}>
              <thead>
                <tr>
                  {columns.map((col) => (
                    <th key={col.key} onClick={() => handleSort(col.key)} style={{
                      padding: "8px 10px", textAlign: col.left ? "left" : "right",
                      color: headerColor, fontWeight: 600, cursor: "pointer",
                      borderBottom: `1px solid ${borderColor}`,
                      userSelect: "none", fontSize: 10, whiteSpace: "nowrap",
                    }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                        {col.label}{sortKey === col.key ? (sortAsc ? " ▲" : " ▼") : ""}
                        {col.tip && <InfoTip dark={darkMode} text={col.tip} />}
                      </span>
                    </th>
                  ))}
                  {!compact && (
                    <th style={{
                      padding: "8px 10px", textAlign: "right", color: headerColor, fontWeight: 600,
                      borderBottom: `1px solid ${borderColor}`, fontSize: 10,
                    }}>Trend</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {sorted.map((r, i) => (
                  <PersonRow
                    key={r.author}
                    row={r}
                    index={i}
                    darkMode={darkMode}
                    showScores={showScores}
                    compact={compact}
                    columns={columns}
                    textColor={textColor}
                    altRowBg={altRowBg}
                    rowHoverBg={rowHoverBg}
                    borderColor={borderColor}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!showScores && rows.length > 0 && (
        <div style={{
          fontSize: 10, color: dk(darkMode, "rgba(255,255,255,0.3)", OS.faint),
          textAlign: "center", marginTop: -4,
        }}>
          Productivity scores require 5+ contributors
        </div>
      )}
    </>
  );
}

// ─── Summary Card ───

function SummaryCard({ dark, label, value, subtitle }: { dark: boolean; label: string; value: string; subtitle: string }) {
  return (
    <div style={{
      padding: "10px 12px", borderRadius: 8,
      background: dk(dark, "#1c1c22", OS.white),
      border: `1px solid ${dk(dark, "rgba(255,255,255,0.08)", OS.border)}`,
    }}>
      <div style={{ fontSize: 12, color: dk(dark, "rgba(255,255,255,0.4)", OS.muted), marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: dk(dark, "#fff", OS.text), fontFamily: OS.mono }}>{value}</div>
      <div style={{ fontSize: 11, color: dk(dark, "rgba(255,255,255,0.3)", OS.faint), marginTop: 1 }}>{subtitle}</div>
    </div>
  );
}

// ─── Person Row ───

interface PersonRowProps {
  row: PersonRow;
  index: number;
  darkMode: boolean;
  showScores: boolean;
  compact: boolean;
  columns: { key: SortKey; label: string; left?: boolean }[];
  textColor: string;
  altRowBg: string;
  rowHoverBg: string;
  borderColor: string;
}

function PersonRowComponent({ row: r, index, darkMode, showScores, compact, columns, textColor, altRowBg, rowHoverBg, borderColor }: PersonRowProps) {
  const [hovered, setHovered] = useState(false);
  const bg = hovered ? rowHoverBg : index % 2 === 1 ? altRowBg : "transparent";

  const colKeys = new Set(columns.map((c) => c.key));

  return (
    <tr
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ background: bg, transition: "background 0.15s" }}
    >
      {/* Person */}
      <td style={{ padding: "8px 10px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{
            width: 26, height: 26, borderRadius: "50%", flexShrink: 0,
            background: nameToColor(r.author),
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 10, fontWeight: 700, color: "#fff", letterSpacing: 0.5,
          }}>
            {getInitials(r.author)}
          </div>
          <span style={{ fontWeight: 500, color: dk(darkMode, "rgba(255,255,255,0.7)", OS.secondary) }}>
            {r.author}
            {r.primaryTeam && (
              <span style={{ fontSize: 9, color: dk(darkMode, "rgba(255,255,255,0.25)", OS.faint), marginLeft: 6 }}>
                {r.primaryTeam}
              </span>
            )}
          </span>
        </div>
      </td>

      {/* PRs */}
      {colKeys.has("prCount") && (
        <td style={{ padding: "8px 10px", textAlign: "right", color: textColor, fontFamily: OS.mono }}>{r.prCount}</td>
      )}

      {/* PRs/wk */}
      {colKeys.has("prsPerWeek") && (
        <td style={{ padding: "8px 10px", textAlign: "right", color: textColor, fontFamily: OS.mono }}>{r.prsPerWeek.toFixed(1)}</td>
      )}

      {/* Cycle */}
      {colKeys.has("avgCycleHours") && (
        <td style={{ padding: "8px 10px", textAlign: "right", color: textColor, fontFamily: OS.mono }}>{fmtHours(r.avgCycleHours)}</td>
      )}

      {/* AI % — badge */}
      {colKeys.has("aiPct") && (
        <td style={{ padding: "8px 10px", textAlign: "right" }}>
          <span style={{
            display: "inline-block", padding: "2px 8px", borderRadius: 10,
            fontSize: 10, fontFamily: OS.mono,
            ...aiPctStyle(r.aiPct, darkMode),
          }}>
            {r.aiPct}%
          </span>
        </td>
      )}

      {/* Rev Days — colored text */}
      {colKeys.has("avgReviewDays") && (
        <td style={{ padding: "8px 10px", textAlign: "right", fontFamily: OS.mono, ...revDaysStyle(r.avgReviewDays, darkMode) }}>
          {r.avgReviewDays.toFixed(1)}d
        </td>
      )}

      {/* Velocity — mini bar */}
      {showScores && colKeys.has("velocity") && (
        <ScoreBarCell value={r.scores?.velocity ?? null} darkMode={darkMode} />
      )}

      {/* Quality — mini bar */}
      {showScores && colKeys.has("quality") && (
        <ScoreBarCell value={r.scores?.quality ?? null} darkMode={darkMode} />
      )}

      {/* Impact — mini bar */}
      {showScores && colKeys.has("impact") && (
        <ScoreBarCell value={r.scores?.impact ?? null} darkMode={darkMode} />
      )}

      {/* Overall — tier badge */}
      {showScores && colKeys.has("overall") && (
        <td style={{ padding: "8px 6px", textAlign: "right" }}>
          {r.scores ? (
            <span style={{
              display: "inline-block", padding: "2px 8px", borderRadius: 10,
              fontSize: 10, fontWeight: 700, fontFamily: OS.mono,
              ...overallStyle(r.scores.overall, darkMode),
            }}>
              {r.scores.overall}
            </span>
          ) : (
            <span style={{ fontSize: 10, color: dk(darkMode, "rgba(255,255,255,0.25)", OS.faint) }}>—</span>
          )}
        </td>
      )}

      {/* Trend sparkline (expanded only) */}
      {!compact && (
        <td style={{ padding: "8px 10px", textAlign: "right" }}>
          {r.weeklyTrend.length >= 2 && (
            <Sparkline data={r.weeklyTrend} width={64} height={22} color={OS.blue} />
          )}
        </td>
      )}
    </tr>
  );
}

const PersonRow = React.memo(PersonRowComponent);

// ─── Score Bar Cell ───

function ScoreBarCell({ value, darkMode }: { value: number | null; darkMode: boolean }) {
  if (value == null) {
    return (
      <td style={{ padding: "8px 6px", textAlign: "right" }}>
        <span style={{ fontSize: 10, color: dk(darkMode, "rgba(255,255,255,0.25)", OS.faint) }}>—</span>
      </td>
    );
  }

  const barWidth = Math.max(0, Math.min(100, value));
  const barColor = scoreBarColor(value);
  const trackBg = dk(darkMode, "rgba(255,255,255,0.06)", "rgba(0,0,0,0.06)");

  return (
    <td style={{ padding: "8px 6px", textAlign: "right" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6 }}>
        <div style={{ width: 40, height: 4, borderRadius: 2, background: trackBg, overflow: "hidden", flexShrink: 0 }}>
          <div style={{ width: `${barWidth}%`, height: "100%", borderRadius: 2, background: barColor, transition: "width 0.3s" }} />
        </div>
        <span style={{ fontSize: 10, fontWeight: 600, fontFamily: OS.mono, color: dk(darkMode, "rgba(255,255,255,0.6)", OS.secondary), minWidth: 18, textAlign: "right" }}>
          {value}
        </span>
      </div>
    </td>
  );
}
