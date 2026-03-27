import React, { useMemo, useState } from "react";
import type { PRMetric } from "@shared/types";
import {
  TabProps,
  TeamRow,
  AuthorAIRow,
  computeTeamRows,
  computeWeeklyAI,
  dk,
  fmtHours,
  removeOutliers,
  toBusinessHours,
  toolColors,
} from "./shared";
import { OS } from "@shared/tokens";
import { isBotAuthor } from "@shared/constants";

interface AIAdoptionTabProps extends TabProps {
  AIAdoptionChart: React.ComponentType<{
    weeklyPcts: { label: string; pct: number }[];
    dark: boolean;
    height?: number;
    fullWidth?: boolean;
  }>;
}

const reviewColors: Record<string, string> = {
  coderabbit: "#0891B2",
  copilot: "#2EA043",
  "amazon-q": "#FF9900",
  cursor: "#7C3AED",
  devin: "#EC4899",
  tabnine: "#4B83CD",
  sonarcloud: "#F97316",
  codeclimate: "#10B981",
  windsurf: "#06B6D4",
};

export function AIAdoptionTab({
  darkMode,
  metrics,
  allMetrics,
  timeRange,
  selectedRepo,
  prToTickets,
  AIAdoptionChart,
}: AIAdoptionTabProps) {
  const [showZeroAuthors, setShowZeroAuthors] = useState(false);
  const [showAllAuthors, setShowAllAuthors] = useState(false);
  const [showLowTeams, setShowLowTeams] = useState(false);
  const [authorSortKey, setAuthorSortKey] = useState<"pct" | "ai" | "total" | "cycle">("pct");
  const [authorSortAsc, setAuthorSortAsc] = useState(false);

  const cardBg = dk(darkMode, "#1c1c22", OS.white);
  const cardBorder = `1px solid ${dk(darkMode, "rgba(255,255,255,0.08)", OS.border)}`;
  const authorBackfillPending = metrics.length > 0 && metrics.every((m) => !m.author);

  // ─── Core AI stats (single pass) ───
  const {
    humanMetrics,
    aiPRs,
    aiPct,
    displayToolEntries,
    unattributedAICount,
    aiCycleComparison,
    aiReviewStats,
  } = useMemo(() => {
    const human = metrics.filter((m) => !m.author || !isBotAuthor(m.author));
    const ai = human.filter((m) => m.aiAssisted);
    const pct = human.length ? Math.round((ai.length / human.length) * 100) : 0;

    // Tool counts
    const toolMap = new Map<string, number>();
    for (const m of ai) {
      if (m.aiTools.length === 0) continue;
      for (const t of m.aiTools) {
        toolMap.set(t, (toolMap.get(t) ?? 0) + 1);
      }
    }
    const entries = Array.from(toolMap.entries()).sort((a, b) => b[1] - a[1]);
    const display = entries.slice(0, 8);
    const unattributed = ai.filter((m) => m.aiTools.length === 0).length;

    // AI vs non-AI cycle times
    const aiCycles = removeOutliers(
      ai
        .filter((m) => m.cycleTimeHours !== null && m.mergedAt)
        .map((m) => toBusinessHours(m.cycleTimeHours!, m.createdAt, m.mergedAt!)),
    );
    const nonAI = human.filter((m) => !m.aiAssisted);
    const nonAICycles = removeOutliers(
      nonAI
        .filter((m) => m.cycleTimeHours !== null && m.mergedAt)
        .map((m) => toBusinessHours(m.cycleTimeHours!, m.createdAt, m.mergedAt!)),
    );
    const avgAI = aiCycles.length ? aiCycles.reduce((a, b) => a + b, 0) / aiCycles.length : null;
    const avgNonAI = nonAICycles.length
      ? nonAICycles.reduce((a, b) => a + b, 0) / nonAICycles.length
      : null;

    // AI review stats
    const reviewMap = new Map<string, number>();
    for (const m of human) {
      for (const r of m.aiReviewers) {
        reviewMap.set(r, (reviewMap.get(r) ?? 0) + 1);
      }
    }
    const reviewEntries = Array.from(reviewMap.entries()).sort((a, b) => b[1] - a[1]);
    const totalReviews = reviewEntries.reduce((s, [, c]) => s + c, 0);

    return {
      humanMetrics: human,
      aiPRs: ai,
      aiPct: pct,
      displayToolEntries: display,
      unattributedAICount: unattributed,
      aiCycleComparison: { avgAI, avgNonAI },
      aiReviewStats: { entries: reviewEntries, total: totalReviews },
    };
  }, [metrics]);

  // ─── Weekly AI data ───
  const weeklyAI = useMemo(() => computeWeeklyAI(metrics, timeRange), [metrics, timeRange]);

  // ─── AI subtitle/trend ───
  const aiSubtitle = useMemo(() => {
    if (weeklyAI.length < 2) return null;
    const recent = weeklyAI[weeklyAI.length - 1].pct;
    const prev = weeklyAI[weeklyAI.length - 2].pct;
    const diff = recent - prev;
    if (diff === 0) return "Flat vs last week";
    return `${diff > 0 ? "+" : ""}${diff}pp vs last week`;
  }, [weeklyAI]);

  // ─── Author AI rows (single pass) ───
  const { authorAIRows, activeAuthorRows, zeroAdoptionCount } = useMemo(() => {
    const authorMap = new Map<
      string,
      { total: number; ai: number; tools: Map<string, number>; cycles: number[]; sizes: number[] }
    >();
    for (const m of humanMetrics) {
      if (!m.author) continue;
      let entry = authorMap.get(m.author);
      if (!entry) {
        entry = { total: 0, ai: 0, tools: new Map(), cycles: [], sizes: [] };
        authorMap.set(m.author, entry);
      }
      entry.total++;
      entry.sizes.push(m.additions + m.deletions);
      if (m.cycleTimeHours !== null && m.mergedAt) {
        entry.cycles.push(toBusinessHours(m.cycleTimeHours, m.createdAt, m.mergedAt));
      }
      if (m.aiAssisted) {
        entry.ai++;
        for (const t of m.aiTools) {
          entry.tools.set(t, (entry.tools.get(t) ?? 0) + 1);
        }
      }
    }

    const rows: AuthorAIRow[] = Array.from(authorMap.entries()).map(([author, d]) => {
      const cleaned = removeOutliers(d.cycles);
      const avgCycleHours = cleaned.length ? cleaned.reduce((a, b) => a + b, 0) / cleaned.length : null;
      const avgSize = d.sizes.length ? Math.round(d.sizes.reduce((a, b) => a + b, 0) / d.sizes.length) : 0;
      const toolEntries = Array.from(d.tools.entries()).sort((a, b) => b[1] - a[1]);
      return {
        author,
        total: d.total,
        ai: d.ai,
        pct: d.total ? Math.round((d.ai / d.total) * 100) : 0,
        toolCounts: toolEntries,
        tools: toolEntries.map(([t]) => t),
        avgCycleHours,
        avgSize,
      };
    });

    const active = rows.filter((r) => r.pct > 0);
    const zeroCount = rows.filter((r) => r.pct === 0).length;
    return { authorAIRows: rows, activeAuthorRows: active, zeroAdoptionCount: zeroCount };
  }, [humanMetrics]);

  // ─── Team rows ───
  const teamRows = useMemo(
    () => computeTeamRows(allMetrics, selectedRepo, prToTickets),
    [allMetrics, selectedRepo, prToTickets],
  );

  // ─── Sorted authors ───
  const sortedActiveAuthors = useMemo(() => {
    const source = showZeroAuthors ? authorAIRows : activeAuthorRows;
    const sorted = [...source].sort((a, b) => {
      let av: number, bv: number;
      switch (authorSortKey) {
        case "pct":
          av = a.pct;
          bv = b.pct;
          break;
        case "ai":
          av = a.ai;
          bv = b.ai;
          break;
        case "total":
          av = a.total;
          bv = b.total;
          break;
        case "cycle":
          av = a.avgCycleHours ?? 9999;
          bv = b.avgCycleHours ?? 9999;
          break;
        default:
          av = a.pct;
          bv = b.pct;
      }
      return authorSortAsc ? av - bv : bv - av;
    });
    return showAllAuthors ? sorted : sorted.slice(0, 15);
  }, [authorAIRows, activeAuthorRows, showZeroAuthors, showAllAuthors, authorSortKey, authorSortAsc]);

  const handleSort = (key: "pct" | "ai" | "total" | "cycle") => {
    if (authorSortKey === key) {
      setAuthorSortAsc(!authorSortAsc);
    } else {
      setAuthorSortKey(key);
      setAuthorSortAsc(false);
    }
  };

  const sortArrow = (key: string) =>
    authorSortKey === key ? (authorSortAsc ? " \u25B2" : " \u25BC") : "";

  const topTool = displayToolEntries.length > 0 ? displayToolEntries[0] : null;

  // ─── Team rows sorted by AI adoption (lowest first) ───
  const teamByAI = useMemo(() => {
    const filtered = teamRows.filter((r) => r.team !== "Unlinked");
    const sorted = [...filtered].sort((a, b) => a.aiPctTeam - b.aiPctTeam);
    return showLowTeams ? sorted : sorted.slice(0, 8);
  }, [teamRows, showLowTeams]);

  const maxTeamPct = useMemo(
    () => Math.max(...teamByAI.map((r) => r.aiPctTeam), 1),
    [teamByAI],
  );
  const maxToolCount = useMemo(
    () => Math.max(...displayToolEntries.map(([, c]) => c), 1),
    [displayToolEntries],
  );

  return (
    <>
      {/* ─── Hero Scorecard ─── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
        {/* AI-Assisted % */}
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
              fontSize: 11,
              fontWeight: 600,
              color: dk(darkMode, "rgba(255,255,255,0.5)", OS.muted),
              marginBottom: 4,
            }}
          >
            AI-Assisted PRs
          </div>
          <div style={{ fontSize: 28, fontWeight: 700, color: dk(darkMode, "#fff", OS.text) }}>
            {aiPct}%
          </div>
          <div
            style={{
              fontSize: 10,
              color: dk(darkMode, "rgba(255,255,255,0.35)", OS.muted),
              marginTop: 2,
            }}
          >
            {aiPRs.length} of {humanMetrics.length} PRs
            {aiSubtitle ? ` \u00B7 ${aiSubtitle}` : ""}
          </div>
        </div>

        {/* Top Tool */}
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
              fontSize: 11,
              fontWeight: 600,
              color: dk(darkMode, "rgba(255,255,255,0.5)", OS.muted),
              marginBottom: 4,
            }}
          >
            Top Tool
          </div>
          <div style={{ fontSize: 28, fontWeight: 700, color: dk(darkMode, "#fff", OS.text) }}>
            {topTool ? topTool[0] : "\u2014"}
          </div>
          <div
            style={{
              fontSize: 10,
              color: dk(darkMode, "rgba(255,255,255,0.35)", OS.muted),
              marginTop: 2,
            }}
          >
            {topTool ? `${topTool[1]} PRs` : "No data"}
            {unattributedAICount > 0 ? ` \u00B7 ${unattributedAICount} unattributed` : ""}
          </div>
        </div>

        {/* AI PRs Cycle Time */}
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
              fontSize: 11,
              fontWeight: 600,
              color: dk(darkMode, "rgba(255,255,255,0.5)", OS.muted),
              marginBottom: 4,
            }}
          >
            AI PRs Cycle Time
          </div>
          <div style={{ fontSize: 28, fontWeight: 700, color: dk(darkMode, "#fff", OS.text) }}>
            {fmtHours(aiCycleComparison.avgAI)}
          </div>
          <div
            style={{
              fontSize: 10,
              color: dk(darkMode, "rgba(255,255,255,0.35)", OS.muted),
              marginTop: 2,
            }}
          >
            {aiCycleComparison.avgNonAI !== null
              ? `vs ${fmtHours(aiCycleComparison.avgNonAI)} non-AI`
              : "No comparison data"}
          </div>
        </div>
      </div>

      {/* ─── Weekly Trend Chart ─── */}
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
          Weekly AI Adoption
        </div>
        <div
          style={{
            fontSize: 10,
            color: dk(darkMode, "rgba(255,255,255,0.35)", OS.muted),
            marginBottom: 12,
          }}
        >
          {weeklyAI.length > 0 ? `${weeklyAI.length} weeks of data` : ""}
        </div>
        {weeklyAI.length > 0 && (
          <AIAdoptionChart weeklyPcts={weeklyAI} dark={darkMode} fullWidth height={220} />
        )}
      </div>

      {/* ─── By Team + By Tool side-by-side grid ─── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {/* By Team */}
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
              fontSize: 12,
              fontWeight: 600,
              color: dk(darkMode, "rgba(255,255,255,0.6)", OS.secondary),
              marginBottom: 10,
            }}
          >
            By Team
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {teamByAI.map((r) => (
              <div key={r.team} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div
                  style={{
                    width: 80,
                    fontSize: 10,
                    color: dk(darkMode, "rgba(255,255,255,0.6)", OS.secondary),
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                  }}
                  title={r.team}
                >
                  {r.team}
                </div>
                <div
                  style={{
                    flex: 1,
                    height: 14,
                    background: dk(darkMode, "rgba(255,255,255,0.05)", "#f0f0f3"),
                    borderRadius: 3,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${(r.aiPctTeam / maxTeamPct) * 100}%`,
                      height: "100%",
                      background: OS.blue,
                      borderRadius: 3,
                      minWidth: r.aiPctTeam > 0 ? 2 : 0,
                    }}
                  />
                </div>
                <div
                  style={{
                    width: 36,
                    fontSize: 10,
                    fontWeight: 600,
                    color: dk(darkMode, "rgba(255,255,255,0.7)", OS.text),
                    textAlign: "right",
                    flexShrink: 0,
                  }}
                >
                  {r.aiPctTeam}%
                </div>
              </div>
            ))}
          </div>
          {teamRows.filter((r) => r.team !== "Unlinked").length > 8 && (
            <div
              style={{
                fontSize: 10,
                color: OS.blue,
                cursor: "pointer",
                marginTop: 6,
              }}
              onClick={() => setShowLowTeams(!showLowTeams)}
            >
              {showLowTeams ? "Show less" : "Show all teams"}
            </div>
          )}
        </div>

        {/* By Tool */}
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
              fontSize: 12,
              fontWeight: 600,
              color: dk(darkMode, "rgba(255,255,255,0.6)", OS.secondary),
              marginBottom: 10,
            }}
          >
            By Tool
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {displayToolEntries.map(([tool, count]) => (
              <div key={tool} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div
                  style={{
                    width: 64,
                    fontSize: 10,
                    color: dk(darkMode, "rgba(255,255,255,0.6)", OS.secondary),
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                  }}
                >
                  {tool}
                </div>
                <div
                  style={{
                    flex: 1,
                    height: 14,
                    background: dk(darkMode, "rgba(255,255,255,0.05)", "#f0f0f3"),
                    borderRadius: 3,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${(count / maxToolCount) * 100}%`,
                      height: "100%",
                      background: toolColors[tool] ?? OS.blue,
                      borderRadius: 3,
                      minWidth: 2,
                    }}
                  />
                </div>
                <div
                  style={{
                    width: 30,
                    fontSize: 10,
                    fontWeight: 600,
                    color: dk(darkMode, "rgba(255,255,255,0.7)", OS.text),
                    textAlign: "right",
                    flexShrink: 0,
                  }}
                >
                  {count}
                </div>
              </div>
            ))}
            {unattributedAICount > 0 && (
              <div
                style={{
                  fontSize: 10,
                  color: dk(darkMode, "rgba(255,255,255,0.35)", OS.muted),
                  marginTop: 2,
                }}
              >
                + {unattributedAICount} unattributed AI PRs
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ─── Per-Author AI Adoption Table ─── */}
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
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 10,
          }}
        >
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: dk(darkMode, "rgba(255,255,255,0.6)", OS.secondary),
            }}
          >
            Per-Author AI Adoption
          </div>
          {zeroAdoptionCount > 0 && (
            <div
              style={{ fontSize: 10, color: OS.blue, cursor: "pointer" }}
              onClick={() => setShowZeroAuthors(!showZeroAuthors)}
            >
              {showZeroAuthors ? "Hide 0% authors" : `Show ${zeroAdoptionCount} with 0%`}
            </div>
          )}
        </div>

        {authorBackfillPending && (
          <div
            style={{
              fontSize: 10,
              color: OS.warning,
              marginBottom: 8,
              padding: "6px 8px",
              background: OS.yellowBg,
              borderRadius: 6,
              border: `1px solid ${OS.yellowBorder}`,
            }}
          >
            Author data is being backfilled. Per-author stats will appear after the next sync.
          </div>
        )}

        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 11,
            fontFamily: OS.font,
          }}
        >
          <thead>
            <tr>
              <th
                style={{
                  textAlign: "left",
                  padding: "4px 6px",
                  fontSize: 10,
                  fontWeight: 600,
                  color: dk(darkMode, "rgba(255,255,255,0.4)", OS.muted),
                  borderBottom: `1px solid ${dk(darkMode, "rgba(255,255,255,0.06)", OS.border)}`,
                }}
              >
                Author
              </th>
              <th
                style={{
                  textAlign: "right",
                  padding: "4px 6px",
                  fontSize: 10,
                  fontWeight: 600,
                  color: dk(darkMode, "rgba(255,255,255,0.4)", OS.muted),
                  borderBottom: `1px solid ${dk(darkMode, "rgba(255,255,255,0.06)", OS.border)}`,
                  cursor: "pointer",
                }}
                onClick={() => handleSort("pct")}
              >
                AI %{sortArrow("pct")}
              </th>
              <th
                style={{
                  textAlign: "right",
                  padding: "4px 6px",
                  fontSize: 10,
                  fontWeight: 600,
                  color: dk(darkMode, "rgba(255,255,255,0.4)", OS.muted),
                  borderBottom: `1px solid ${dk(darkMode, "rgba(255,255,255,0.06)", OS.border)}`,
                  cursor: "pointer",
                }}
                onClick={() => handleSort("total")}
              >
                PRs{sortArrow("total")}
              </th>
              <th
                style={{
                  textAlign: "right",
                  padding: "4px 6px",
                  fontSize: 10,
                  fontWeight: 600,
                  color: dk(darkMode, "rgba(255,255,255,0.4)", OS.muted),
                  borderBottom: `1px solid ${dk(darkMode, "rgba(255,255,255,0.06)", OS.border)}`,
                  cursor: "pointer",
                }}
                onClick={() => handleSort("cycle")}
              >
                Cycle{sortArrow("cycle")}
              </th>
              <th
                style={{
                  textAlign: "left",
                  padding: "4px 6px",
                  fontSize: 10,
                  fontWeight: 600,
                  color: dk(darkMode, "rgba(255,255,255,0.4)", OS.muted),
                  borderBottom: `1px solid ${dk(darkMode, "rgba(255,255,255,0.06)", OS.border)}`,
                }}
              >
                Tools
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedActiveAuthors.map((row) => (
              <tr key={row.author}>
                <td
                  style={{
                    padding: "5px 6px",
                    color: dk(darkMode, "rgba(255,255,255,0.8)", OS.text),
                    fontFamily: OS.mono,
                    fontSize: 10,
                    borderBottom: `1px solid ${dk(darkMode, "rgba(255,255,255,0.04)", "#f5f5f7")}`,
                    maxWidth: 120,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={row.author}
                >
                  {row.author}
                </td>
                <td
                  style={{
                    padding: "5px 6px",
                    textAlign: "right",
                    fontWeight: 600,
                    color:
                      row.pct === 0
                        ? dk(darkMode, "rgba(255,255,255,0.2)", OS.faint)
                        : dk(darkMode, "#fff", OS.text),
                    borderBottom: `1px solid ${dk(darkMode, "rgba(255,255,255,0.04)", "#f5f5f7")}`,
                  }}
                >
                  {row.pct}%
                </td>
                <td
                  style={{
                    padding: "5px 6px",
                    textAlign: "right",
                    color: dk(darkMode, "rgba(255,255,255,0.5)", OS.secondary),
                    borderBottom: `1px solid ${dk(darkMode, "rgba(255,255,255,0.04)", "#f5f5f7")}`,
                  }}
                >
                  {row.ai}/{row.total}
                </td>
                <td
                  style={{
                    padding: "5px 6px",
                    textAlign: "right",
                    color: dk(darkMode, "rgba(255,255,255,0.5)", OS.secondary),
                    fontFamily: OS.mono,
                    fontSize: 10,
                    borderBottom: `1px solid ${dk(darkMode, "rgba(255,255,255,0.04)", "#f5f5f7")}`,
                  }}
                >
                  {fmtHours(row.avgCycleHours)}
                </td>
                <td
                  style={{
                    padding: "5px 6px",
                    borderBottom: `1px solid ${dk(darkMode, "rgba(255,255,255,0.04)", "#f5f5f7")}`,
                  }}
                >
                  <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
                    {row.tools.map((t) => (
                      <span
                        key={t}
                        style={{
                          fontSize: 9,
                          padding: "1px 5px",
                          borderRadius: 4,
                          background: dk(darkMode, "rgba(255,255,255,0.06)", "#f0f0f3"),
                          color: toolColors[t] ?? dk(darkMode, "rgba(255,255,255,0.5)", OS.secondary),
                          fontWeight: 500,
                        }}
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {(showZeroAuthors ? authorAIRows : activeAuthorRows).length > 15 && (
          <div
            style={{
              fontSize: 10,
              color: OS.blue,
              cursor: "pointer",
              marginTop: 8,
              textAlign: "center",
            }}
            onClick={() => setShowAllAuthors(!showAllAuthors)}
          >
            {showAllAuthors
              ? "Show fewer"
              : `Show all ${(showZeroAuthors ? authorAIRows : activeAuthorRows).length} authors`}
          </div>
        )}
      </div>

      {/* ─── AI Reviews Section ─── */}
      {aiReviewStats.entries.length > 0 && (
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
              fontSize: 12,
              fontWeight: 600,
              color: dk(darkMode, "rgba(255,255,255,0.6)", OS.secondary),
              marginBottom: 10,
            }}
          >
            AI Reviews
          </div>
          <div
            style={{
              fontSize: 10,
              color: dk(darkMode, "rgba(255,255,255,0.35)", OS.muted),
              marginBottom: 10,
            }}
          >
            {aiReviewStats.total} AI review{aiReviewStats.total !== 1 ? "s" : ""} across{" "}
            {aiReviewStats.entries.length} tool{aiReviewStats.entries.length !== 1 ? "s" : ""}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {aiReviewStats.entries.map(([tool, count]) => (
              <div key={tool} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div
                  style={{
                    width: 80,
                    fontSize: 10,
                    color: dk(darkMode, "rgba(255,255,255,0.6)", OS.secondary),
                    flexShrink: 0,
                  }}
                >
                  {tool}
                </div>
                <div
                  style={{
                    flex: 1,
                    height: 14,
                    background: dk(darkMode, "rgba(255,255,255,0.05)", "#f0f0f3"),
                    borderRadius: 3,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width:
                        aiReviewStats.total > 0
                          ? `${(count / aiReviewStats.entries[0][1]) * 100}%`
                          : "0%",
                      height: "100%",
                      background: reviewColors[tool] ?? OS.blue,
                      borderRadius: 3,
                      minWidth: 2,
                    }}
                  />
                </div>
                <div
                  style={{
                    width: 30,
                    fontSize: 10,
                    fontWeight: 600,
                    color: dk(darkMode, "rgba(255,255,255,0.7)", OS.text),
                    textAlign: "right",
                    flexShrink: 0,
                  }}
                >
                  {count}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
