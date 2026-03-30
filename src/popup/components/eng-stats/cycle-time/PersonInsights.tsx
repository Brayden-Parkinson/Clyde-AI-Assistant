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

type SortKey = "author" | "prCount" | "prsPerWeek" | "avgCycleHours" | "totalLOC" | "avgPRSize" | "aiPct" | "avgReviewDays" | "velocity" | "quality" | "impact" | "overall";

const MIN_AUTHORS_FOR_SCORE = 5;

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

  const [sortKey, setSortKey] = useState<SortKey>("author");
  const [sortAsc, setSortAsc] = useState(true);

  const handleSort = useCallback((key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(key === "author"); }
  }, [sortKey, sortAsc]);

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

  const cardBg = dk(darkMode, "#1c1c22", OS.white);
  const cardBorder = `1px solid ${dk(darkMode, "rgba(255,255,255,0.08)", OS.border)}`;
  const headerColor = dk(darkMode, "rgba(255,255,255,0.45)", OS.muted);
  const textColor = dk(darkMode, "#fff", OS.text);

  type ColDef = { key: SortKey; label: string; left?: boolean; tip?: string };

  const columns: ColDef[] = [
    { key: "author", label: "Person", left: true },
    { key: "prCount", label: "PRs" },
    { key: "prsPerWeek", label: "PRs/wk" },
    { key: "avgCycleHours", label: "Avg Cycle" },
    { key: "totalLOC", label: "Total LOC" },
    { key: "avgPRSize", label: "Avg Size" },
    { key: "aiPct", label: "AI %" },
    { key: "avgReviewDays", label: "Rev Days" },
  ];
  if (showScores) {
    columns.push(
      { key: "velocity", label: "V", tip: SCORE_TOOLTIPS.velocity },
      { key: "quality", label: "Q", tip: SCORE_TOOLTIPS.quality },
      { key: "impact", label: "I", tip: SCORE_TOOLTIPS.impact },
      { key: "overall", label: "Overall", tip: SCORE_TOOLTIPS.overall },
    );
  }

  function fmtLOC(n: number): string {
    return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
  }

  function scoreVal(r: PersonRow, key: "velocity" | "quality" | "impact" | "overall"): string {
    return r.scores ? String(r.scores[key]) : "—";
  }

  return (
    <>
      <div style={{
        fontSize: 12, fontWeight: 600,
        color: dk(darkMode, "rgba(255,255,255,0.6)", OS.secondary),
        marginTop: 4,
      }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          Developer Insights
          <InfoTip dark={darkMode} text={
            showScores
              ? "Per-developer metrics with multi-dimensional scoring. V=Velocity (shipping speed), Q=Quality (clean PRs), I=Impact (substantive contribution), Overall=composite. Hover each score header for formula details."
              : "Per-developer metrics. Scoring requires 5+ contributors to display."
          } />
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
        <div style={{ borderRadius: 10, border: cardBorder, background: cardBg, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead>
              <tr>
                {columns.map((col) => (
                  <th key={col.key} onClick={() => handleSort(col.key)} style={{
                    padding: "8px 10px", textAlign: col.left ? "left" : "right",
                    color: headerColor, fontWeight: 600, cursor: "pointer",
                    borderBottom: `1px solid ${dk(darkMode, "rgba(255,255,255,0.06)", OS.border)}`,
                    userSelect: "none", fontSize: 10, whiteSpace: "nowrap",
                  }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                      {col.label}{sortKey === col.key ? (sortAsc ? " \u25B2" : " \u25BC") : ""}
                      {col.tip && <InfoTip dark={darkMode} text={col.tip} />}
                    </span>
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
              {sorted.map((r) => (
                <tr key={r.author}>
                  <td style={{ padding: "8px 10px", color: dk(darkMode, "rgba(255,255,255,0.7)", OS.secondary), fontWeight: 600 }}>
                    {r.author}
                    {r.primaryTeam && (
                      <span style={{ fontSize: 9, color: dk(darkMode, "rgba(255,255,255,0.25)", OS.faint), marginLeft: 6 }}>
                        {r.primaryTeam}
                      </span>
                    )}
                  </td>
                  <td style={{ padding: "8px 10px", textAlign: "right", color: textColor, fontFamily: OS.mono }}>{r.prCount}</td>
                  <td style={{ padding: "8px 10px", textAlign: "right", color: textColor, fontFamily: OS.mono }}>{r.prsPerWeek.toFixed(1)}</td>
                  <td style={{ padding: "8px 10px", textAlign: "right", color: textColor, fontFamily: OS.mono }}>{fmtHours(r.avgCycleHours)}</td>
                  <td style={{ padding: "8px 10px", textAlign: "right", color: textColor, fontFamily: OS.mono }}>{fmtLOC(r.totalLOC)}</td>
                  <td style={{ padding: "8px 10px", textAlign: "right", color: textColor, fontFamily: OS.mono }}>{fmtLOC(r.avgPRSize)}</td>
                  <td style={{ padding: "8px 10px", textAlign: "right", color: textColor, fontFamily: OS.mono }}>{r.aiPct}%</td>
                  <td style={{ padding: "8px 10px", textAlign: "right", color: textColor, fontFamily: OS.mono }}>{r.avgReviewDays.toFixed(1)}</td>
                  {showScores && (
                    <>
                      <ScoreCell value={scoreVal(r, "velocity")} darkMode={darkMode} />
                      <ScoreCell value={scoreVal(r, "quality")} darkMode={darkMode} />
                      <ScoreCell value={scoreVal(r, "impact")} darkMode={darkMode} />
                      <ScoreCell value={scoreVal(r, "overall")} darkMode={darkMode} bold />
                    </>
                  )}
                  <td style={{ padding: "8px 10px", textAlign: "right" }}>
                    {r.weeklyTrend.length >= 2 && (
                      <Sparkline data={r.weeklyTrend} width={64} height={22} color={OS.blue} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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

function ScoreCell({ value, darkMode, bold }: { value: string; darkMode: boolean; bold?: boolean }) {
  return (
    <td style={{ padding: "8px 6px", textAlign: "right" }}>
      <span style={{
        display: "inline-block", padding: "2px 6px", borderRadius: 4,
        fontSize: 10, fontWeight: bold ? 700 : 600, fontFamily: OS.mono,
        color: dk(darkMode, "rgba(255,255,255,0.7)", OS.secondary),
        background: dk(darkMode, "rgba(255,255,255,0.06)", "rgba(0,0,0,0.04)"),
      }}>{value}</span>
    </td>
  );
}
