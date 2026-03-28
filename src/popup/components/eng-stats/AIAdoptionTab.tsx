import React, { useMemo, useState } from "react";
import type { PRMetric, CopilotDailyMetric } from "@shared/types";
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
import {
  computeAIAdoptionScore,
  authorTier,
  tierLabel,
  type AdoptionTier,
  type AIAdoptionScore as ScoreResult,
  type ActionItem,
} from "./aiAdoptionScore";
import { ScoreGauge } from "./charts";

interface AIAdoptionTabProps extends TabProps {
  AIAdoptionChart: React.ComponentType<{
    weeklyPcts: { label: string; pct: number }[];
    dark: boolean;
    height?: number;
    fullWidth?: boolean;
  }>;
  copilotMetrics: CopilotDailyMetric[];
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
  copilotMetrics,
}: AIAdoptionTabProps) {
  const [showZeroAuthors, setShowZeroAuthors] = useState(false);
  const [showAllAuthors, setShowAllAuthors] = useState(false);
  const [showLowTeams, setShowLowTeams] = useState(false);
  const [authorSortKey, setAuthorSortKey] = useState<"pct" | "ai" | "total" | "cycle">("pct");
  const [authorSortAsc, setAuthorSortAsc] = useState(false);
  const [hoveredAuthor, setHoveredAuthor] = useState<string | null>(null);
  const [expandedAuthor, setExpandedAuthor] = useState<string | null>(null);

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

  // ─── AI Adoption Score ───
  const adoptionScore: ScoreResult = useMemo(
    () => computeAIAdoptionScore(metrics, copilotMetrics, authorAIRows, teamRows),
    [metrics, copilotMetrics, authorAIRows, teamRows],
  );

  // ─── Copilot acceptance rate ───
  const copilotAcceptanceRate = useMemo(() => {
    if (copilotMetrics.length === 0) return null;
    const totalSugg = copilotMetrics.reduce((s, m) => s + (m.totalSuggestions ?? 0), 0);
    const totalAcc = copilotMetrics.reduce((s, m) => s + (m.totalAcceptances ?? 0), 0);
    if (totalSugg === 0) return null;
    return Math.round((totalAcc / totalSugg) * 100);
  }, [copilotMetrics]);

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

  // Tier badge styling
  const tierColors: Record<AdoptionTier, { bg: string; text: string }> = {
    "power": { bg: dk(darkMode, "rgba(34,197,94,0.15)", "rgba(34,197,94,0.12)"), text: "#22C55E" },
    "frequent": { bg: dk(darkMode, "rgba(59,130,246,0.15)", "rgba(59,130,246,0.12)"), text: OS.blue },
    "infrequent": { bg: dk(darkMode, "rgba(245,158,11,0.15)", "rgba(245,158,11,0.12)"), text: "#F59E0B" },
    "non-user": { bg: dk(darkMode, "rgba(255,255,255,0.05)", "rgba(0,0,0,0.04)"), text: dk(darkMode, "rgba(255,255,255,0.3)", OS.muted) },
  };
  const tierLabelMap: Record<AdoptionTier, string> = {
    "power": "Power", "frequent": "Frequent", "infrequent": "Light", "non-user": "None",
  };

  // Pillar colors for display
  const pillarColors = {
    utilization: "#3B82F6",
    impact: "#22C55E",
    quality: "#F59E0B",
  };

  // Priority colors for action items
  const priorityStyles: Record<string, { border: string; bg: string }> = {
    high: { border: OS.red, bg: dk(darkMode, "rgba(239,68,68,0.08)", "rgba(239,68,68,0.06)") },
    medium: { border: "#F59E0B", bg: dk(darkMode, "rgba(245,158,11,0.08)", "rgba(245,158,11,0.06)") },
    low: { border: OS.blue, bg: dk(darkMode, "rgba(59,130,246,0.08)", "rgba(59,130,246,0.06)") },
  };

  // Cycle time delta display
  const cycleTimeDeltaPct = useMemo(() => {
    if (aiCycleComparison.avgAI === null || aiCycleComparison.avgNonAI === null || aiCycleComparison.avgNonAI === 0) return null;
    return Math.round(((aiCycleComparison.avgNonAI - aiCycleComparison.avgAI) / aiCycleComparison.avgNonAI) * 100);
  }, [aiCycleComparison]);

  const { seg } = useMemo(() => ({ seg: adoptionScore.segmentation }), [adoptionScore]);

  return (
    <>
      {/* ─── AI Adoption Score Hero ─── */}
      <div
        style={{
          padding: "14px 16px",
          borderRadius: 10,
          border: cardBorder,
          background: cardBg,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <ScoreGauge
            score={adoptionScore.overall}
            tier={tierLabel(adoptionScore.maturityTier)}
            pillars={{
              utilization: adoptionScore.utilization.score,
              impact: adoptionScore.impact.score,
              quality: adoptionScore.quality.score,
            }}
            dark={darkMode}
          />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
            {(["utilization", "impact", "quality"] as const).map((key) => {
              const pillar = adoptionScore[key];
              const color = pillarColors[key];
              return (
                <div key={key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{
                    width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0,
                  }} />
                  <div style={{
                    fontSize: 10, color: dk(darkMode, "rgba(255,255,255,0.6)", OS.secondary),
                    flex: 1, textTransform: "capitalize",
                  }}>
                    {key}
                  </div>
                  <div style={{
                    fontSize: 12, fontWeight: 700, fontFamily: OS.mono,
                    color: dk(darkMode, "#fff", OS.text),
                  }}>
                    {Math.round(pillar.score)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ─── KPI Grid ─── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
        {/* AI-Assisted % */}
        <div style={{ padding: "12px 14px", borderRadius: 10, border: cardBorder, background: cardBg }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: dk(darkMode, "rgba(255,255,255,0.5)", OS.muted), marginBottom: 4 }}>
            AI-Assisted PRs
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, color: dk(darkMode, "#fff", OS.text) }}>
            {aiPct}%
          </div>
          <div style={{ fontSize: 9, color: dk(darkMode, "rgba(255,255,255,0.35)", OS.muted), marginTop: 2 }}>
            {aiPRs.length}/{humanMetrics.length} PRs{aiSubtitle ? ` \u00B7 ${aiSubtitle}` : ""}
          </div>
        </div>

        {/* Cycle Time Delta */}
        <div style={{ padding: "12px 14px", borderRadius: 10, border: cardBorder, background: cardBg }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: dk(darkMode, "rgba(255,255,255,0.5)", OS.muted), marginBottom: 4 }}>
            Cycle Time Delta
          </div>
          <div style={{
            fontSize: 24, fontWeight: 700,
            color: cycleTimeDeltaPct !== null && cycleTimeDeltaPct > 0 ? OS.green : cycleTimeDeltaPct !== null && cycleTimeDeltaPct < 0 ? OS.red : dk(darkMode, "#fff", OS.text),
          }}>
            {cycleTimeDeltaPct !== null ? `${cycleTimeDeltaPct > 0 ? "+" : ""}${cycleTimeDeltaPct}%` : "\u2014"}
          </div>
          <div style={{ fontSize: 9, color: dk(darkMode, "rgba(255,255,255,0.35)", OS.muted), marginTop: 2 }}>
            {cycleTimeDeltaPct !== null ? (cycleTimeDeltaPct > 0 ? "AI PRs faster" : "AI PRs slower") : "No data"}
          </div>
        </div>

        {/* Acceptance Rate */}
        <div style={{ padding: "12px 14px", borderRadius: 10, border: cardBorder, background: cardBg }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: dk(darkMode, "rgba(255,255,255,0.5)", OS.muted), marginBottom: 4 }}>
            Acceptance Rate
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, color: dk(darkMode, "#fff", OS.text) }}>
            {copilotAcceptanceRate !== null ? `${copilotAcceptanceRate}%` : "\u2014"}
          </div>
          <div style={{ fontSize: 9, color: dk(darkMode, "rgba(255,255,255,0.35)", OS.muted), marginTop: 2 }}>
            {copilotAcceptanceRate !== null ? "Copilot suggestions" : "No Copilot data"}
          </div>
        </div>

        {/* Top Tool */}
        <div style={{ padding: "12px 14px", borderRadius: 10, border: cardBorder, background: cardBg }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: dk(darkMode, "rgba(255,255,255,0.5)", OS.muted), marginBottom: 4 }}>
            Top Tool
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, color: dk(darkMode, "#fff", OS.text) }}>
            {topTool ? topTool[0] : "\u2014"}
          </div>
          <div style={{ fontSize: 9, color: dk(darkMode, "rgba(255,255,255,0.35)", OS.muted), marginTop: 2 }}>
            {topTool ? `${topTool[1]} PRs` : "No data"}
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

      {/* ─── By Team + Segmentation side-by-side grid ─── */}
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
              style={{ fontSize: 10, color: OS.blue, cursor: "pointer", marginTop: 6 }}
              onClick={() => setShowLowTeams(!showLowTeams)}
            >
              {showLowTeams ? "Show less" : "Show all teams"}
            </div>
          )}
        </div>

        {/* Segmentation + By Tool */}
        <div
          style={{
            padding: "14px 16px",
            borderRadius: 10,
            border: cardBorder,
            background: cardBg,
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          {/* Segmentation summary */}
          <div>
            <div
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: dk(darkMode, "rgba(255,255,255,0.6)", OS.secondary),
                marginBottom: 10,
              }}
            >
              Engineer Segments
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              {([
                { key: "power" as const, label: "Power", count: seg.power.length },
                { key: "frequent" as const, label: "Frequent", count: seg.frequent.length },
                { key: "infrequent" as const, label: "Light", count: seg.infrequent.length },
                { key: "non-user" as const, label: "Non-users", count: seg.nonUsers.length },
              ]).map((s) => (
                <div
                  key={s.key}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "5px 8px",
                    borderRadius: 6,
                    background: tierColors[s.key].bg,
                  }}
                >
                  <div style={{ fontSize: 16, fontWeight: 700, fontFamily: OS.mono, color: tierColors[s.key].text }}>
                    {s.count}
                  </div>
                  <div style={{ fontSize: 9, color: dk(darkMode, "rgba(255,255,255,0.5)", OS.secondary) }}>
                    {s.label}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* By Tool (compact) */}
          <div>
            <div
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: dk(darkMode, "rgba(255,255,255,0.6)", OS.secondary),
                marginBottom: 8,
              }}
            >
              By Tool
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {displayToolEntries.map(([tool, count]) => (
                <div key={tool} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ width: 54, fontSize: 10, color: dk(darkMode, "rgba(255,255,255,0.6)", OS.secondary), flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {tool}
                  </div>
                  <div style={{ flex: 1, height: 12, background: dk(darkMode, "rgba(255,255,255,0.05)", "#f0f0f3"), borderRadius: 3, overflow: "hidden" }}>
                    <div style={{ width: `${(count / maxToolCount) * 100}%`, height: "100%", background: toolColors[tool] ?? OS.blue, borderRadius: 3, minWidth: 2 }} />
                  </div>
                  <div style={{ width: 26, fontSize: 10, fontWeight: 600, color: dk(darkMode, "rgba(255,255,255,0.7)", OS.text), textAlign: "right", flexShrink: 0 }}>
                    {count}
                  </div>
                </div>
              ))}
              {unattributedAICount > 0 && (
                <div style={{ fontSize: 9, color: dk(darkMode, "rgba(255,255,255,0.35)", OS.muted), marginTop: 1 }}>
                  + {unattributedAICount} unattributed
                </div>
              )}
            </div>
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
                  textAlign: "center",
                  padding: "4px 4px",
                  fontSize: 10,
                  fontWeight: 600,
                  color: dk(darkMode, "rgba(255,255,255,0.4)", OS.muted),
                  borderBottom: `1px solid ${dk(darkMode, "rgba(255,255,255,0.06)", OS.border)}`,
                  width: 52,
                }}
              >
                Tier
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
                onClick={() => handleSort("ai")}
              >
                AI PRs{sortArrow("ai")}
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
                Total{sortArrow("total")}
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
            {sortedActiveAuthors.map((row) => {
              const rowBorder = `1px solid ${dk(darkMode, "rgba(255,255,255,0.04)", "#f5f5f7")}`;
              const isExpanded = expandedAuthor === row.author;
              const isHovered = hoveredAuthor === row.author;
              const hoverBg = isHovered ? dk(darkMode, "rgba(255,255,255,0.02)", "rgba(0,0,0,0.015)") : "transparent";
              const cycleColor = row.avgCycleHours == null
                ? dk(darkMode, "rgba(255,255,255,0.2)", OS.faint)
                : row.avgCycleHours > 168
                  ? OS.red
                  : row.avgCycleHours > 48
                    ? OS.warning
                    : OS.green;
              const barColor = row.pct >= 50 ? OS.green : row.pct >= 20 ? OS.blue : row.pct > 0 ? OS.warning : "transparent";
              return (
                <React.Fragment key={row.author}>
                  <tr
                    style={{ cursor: "pointer", background: hoverBg }}
                    onMouseEnter={() => setHoveredAuthor(row.author)}
                    onMouseLeave={() => setHoveredAuthor(null)}
                    onClick={() => setExpandedAuthor(isExpanded ? null : row.author)}
                  >
                    <td
                      style={{
                        padding: "5px 6px",
                        color: dk(darkMode, "rgba(255,255,255,0.8)", OS.text),
                        fontFamily: OS.mono,
                        fontSize: 10,
                        borderBottom: isExpanded ? "none" : rowBorder,
                        maxWidth: 110,
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
                        padding: "5px 4px",
                        textAlign: "center",
                        borderBottom: isExpanded ? "none" : rowBorder,
                      }}
                    >
                      {(() => {
                        const t = authorTier(row.pct);
                        const tc = tierColors[t];
                        return (
                          <span style={{
                            fontSize: 8,
                            fontWeight: 600,
                            padding: "2px 5px",
                            borderRadius: 4,
                            background: tc.bg,
                            color: tc.text,
                          }}>
                            {tierLabelMap[t]}
                          </span>
                        );
                      })()}
                    </td>
                    <td
                      style={{
                        padding: "5px 6px",
                        textAlign: "right",
                        fontWeight: 600,
                        color: row.pct === 0
                          ? dk(darkMode, "rgba(255,255,255,0.2)", OS.faint)
                          : dk(darkMode, "#fff", OS.text),
                        borderBottom: isExpanded ? "none" : rowBorder,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>
                        <div style={{
                          width: 36,
                          height: 4,
                          borderRadius: 2,
                          background: dk(darkMode, "rgba(255,255,255,0.08)", "#eee"),
                          overflow: "hidden",
                        }}>
                          <div style={{
                            width: `${row.pct}%`,
                            height: "100%",
                            borderRadius: 2,
                            background: barColor,
                          }} />
                        </div>
                        <span>{row.pct}%</span>
                      </div>
                    </td>
                    <td
                      style={{
                        padding: "5px 6px",
                        textAlign: "right",
                        color: dk(darkMode, "rgba(255,255,255,0.5)", OS.secondary),
                        borderBottom: isExpanded ? "none" : rowBorder,
                      }}
                    >
                      {row.ai}
                    </td>
                    <td
                      style={{
                        padding: "5px 6px",
                        textAlign: "right",
                        color: dk(darkMode, "rgba(255,255,255,0.5)", OS.secondary),
                        borderBottom: isExpanded ? "none" : rowBorder,
                      }}
                    >
                      {row.total}
                    </td>
                    <td
                      style={{
                        padding: "5px 6px",
                        textAlign: "right",
                        color: cycleColor,
                        fontFamily: OS.mono,
                        fontSize: 10,
                        borderBottom: isExpanded ? "none" : rowBorder,
                      }}
                    >
                      {fmtHours(row.avgCycleHours)}
                    </td>
                    <td
                      style={{
                        padding: "5px 6px",
                        borderBottom: isExpanded ? "none" : rowBorder,
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
                  {isExpanded && (
                    <tr>
                      <td colSpan={7} style={{
                        padding: "6px 12px 10px",
                        background: dk(darkMode, "rgba(255,255,255,0.015)", "rgba(0,0,0,0.01)"),
                        borderBottom: rowBorder,
                        fontSize: 10,
                      }}>
                        <div style={{ display: "flex", gap: 16, alignItems: "baseline" }}>
                          <div>
                            <span style={{ color: dk(darkMode, "rgba(255,255,255,0.35)", OS.muted) }}>Avg size </span>
                            <span style={{ fontFamily: OS.mono, color: dk(darkMode, "rgba(255,255,255,0.6)", OS.secondary) }}>
                              {row.avgSize > 0 ? `\u00B1${row.avgSize} lines` : "\u2014"}
                            </span>
                          </div>
                          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "baseline" }}>
                            <span style={{ color: dk(darkMode, "rgba(255,255,255,0.35)", OS.muted) }}>Tools </span>
                            {row.toolCounts.length === 0
                              ? <span style={{ color: dk(darkMode, "rgba(255,255,255,0.2)", OS.faint) }}>{"\u2014"}</span>
                              : row.toolCounts.map(([tool, count]) => (
                                <span key={tool} style={{
                                  fontFamily: OS.mono,
                                  color: toolColors[tool] ?? dk(darkMode, "rgba(255,255,255,0.5)", OS.secondary),
                                }}>
                                  {tool}\u00A0({count})
                                </span>
                              ))}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
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

      {/* ─── Action Items ─── */}
      {adoptionScore.actionItems.length > 0 && (
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
            Insights
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {adoptionScore.actionItems.map((item, idx) => {
              const ps = priorityStyles[item.priority] ?? priorityStyles.low;
              return (
                <div
                  key={idx}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 8,
                    padding: "8px 10px",
                    borderRadius: 6,
                    background: ps.bg,
                    borderLeft: `3px solid ${ps.border}`,
                  }}
                >
                  <div style={{ flex: 1, fontSize: 10, lineHeight: 1.4, color: dk(darkMode, "rgba(255,255,255,0.75)", OS.text) }}>
                    {item.message}
                  </div>
                  <div style={{ fontSize: 8, fontWeight: 600, color: dk(darkMode, "rgba(255,255,255,0.3)", OS.muted), flexShrink: 0, textTransform: "uppercase" }}>
                    {item.metric}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

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
