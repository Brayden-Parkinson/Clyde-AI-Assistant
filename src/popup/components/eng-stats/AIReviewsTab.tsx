import React, { useMemo } from "react";
import type { AIReviewComment } from "@shared/types";
import { TabProps, dk, weekKey, categoryColors, toolColors } from "./shared";
import { OS } from "@shared/tokens";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@shared/db";

interface AIReviewsTabProps extends TabProps {
  since: string;
  queryKey: number;
  selectedTeam: string;
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

export function AIReviewsTab({
  darkMode,
  metrics,
  allMetrics,
  timeRange,
  selectedRepo,
  prToTickets,
  since,
  queryKey,
  selectedTeam,
}: AIReviewsTabProps) {
  const cardBg = dk(darkMode, "#1c1c22", OS.white);
  const cardBorder = `1px solid ${dk(darkMode, "rgba(255,255,255,0.08)", OS.border)}`;

  // ─── Query AI review comments from DB ───
  const allReviewComments = useLiveQuery(
    () => db.ai_review_comments.where("createdAt").aboveOrEqual(since).toArray(),
    [since, queryKey],
    [] as AIReviewComment[],
  );

  // ─── Filter by repo and team ───
  const filteredReviewComments = useMemo(() => {
    let result = allReviewComments;
    if (selectedRepo !== "__all__") result = result.filter((c) => c.repo === selectedRepo);
    if (selectedTeam !== "__all__") {
      const prKeysInTeam = new Set<string>();
      for (const m of metrics) {
        const tickets = prToTickets.get(m.id!);
        if (tickets?.length) {
          const team = tickets[0].component ?? "No Component";
          if (team === selectedTeam) prKeysInTeam.add(`${m.repo}:${m.prNumber}`);
        }
      }
      result = result.filter((c) => prKeysInTeam.has(`${c.repo}:${c.prNumber}`));
    }
    return result;
  }, [allReviewComments, selectedRepo, selectedTeam, metrics, prToTickets]);

  // ─── Compute all stats in a single pass ───
  const reviewTabStats = useMemo(() => {
    const comments = filteredReviewComments;
    const byTool: Record<string, number> = {};
    const byCategory: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};
    const byRepo: Record<string, number> = {};
    const byAuthor: Record<string, { total: number; byCategory: Record<string, number>; byTool: Record<string, number> }> = {};
    const byTeamMap: Record<string, number> = {};
    const weeklyBuckets: Map<string, number> = new Map();
    const reviewedPRs = new Set<string>();

    for (const c of comments) {
      byTool[c.tool] = (byTool[c.tool] ?? 0) + 1;
      byCategory[c.category] = (byCategory[c.category] ?? 0) + 1;
      bySeverity[c.severity] = (bySeverity[c.severity] ?? 0) + 1;
      byRepo[c.repo] = (byRepo[c.repo] ?? 0) + 1;
      reviewedPRs.add(`${c.repo}:${c.prNumber}`);

      // By author
      const author = c.prAuthor ?? "unknown";
      if (!byAuthor[author]) byAuthor[author] = { total: 0, byCategory: {}, byTool: {} };
      byAuthor[author].total++;
      byAuthor[author].byCategory[c.category] = (byAuthor[author].byCategory[c.category] ?? 0) + 1;
      byAuthor[author].byTool[c.tool] = (byAuthor[author].byTool[c.tool] ?? 0) + 1;

      // By team (via PR -> Jira link)
      const matchingMetric = metrics.find((m) => m.repo === c.repo && m.prNumber === c.prNumber);
      if (matchingMetric) {
        const tickets = prToTickets.get(matchingMetric.id!);
        const team = tickets?.[0]?.component ?? "Unlinked";
        byTeamMap[team] = (byTeamMap[team] ?? 0) + 1;
      }

      // Weekly trend
      const wk = weekKey(new Date(c.createdAt));
      weeklyBuckets.set(wk, (weeklyBuckets.get(wk) ?? 0) + 1);
    }

    const weeklyTrend = Array.from(weeklyBuckets.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, count]) => ({ label, count }));

    const authorRows = Object.entries(byAuthor)
      .map(([author, data]) => {
        const topCat = Object.entries(data.byCategory).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "\u2014";
        return { author, ...data, topCategory: topCat };
      })
      .sort((a, b) => b.total - a.total);

    return {
      totalComments: comments.length,
      reviewedPRCount: reviewedPRs.size,
      byTool: Object.entries(byTool).sort((a, b) => b[1] - a[1]),
      byCategory: Object.entries(byCategory).sort((a, b) => b[1] - a[1]),
      bySeverity: Object.entries(bySeverity).sort((a, b) => b[1] - a[1]),
      byRepo: Object.entries(byRepo).sort((a, b) => b[1] - a[1]),
      byTeam: Object.entries(byTeamMap).filter(([t]) => t !== "Unlinked").sort((a, b) => b[1] - a[1]),
      unlinkedCount: byTeamMap["Unlinked"] ?? 0,
      weeklyTrend,
      authorRows,
    };
  }, [filteredReviewComments, metrics, prToTickets]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {reviewTabStats.totalComments === 0 ? (
        <div style={{ padding: "40px 16px", textAlign: "center" }}>
          <div style={{ fontSize: 14, color: dk(darkMode, "rgba(255,255,255,0.5)", OS.secondary), marginBottom: 4 }}>
            No AI review comments found
          </div>
          <div style={{ fontSize: 12, color: dk(darkMode, "rgba(255,255,255,0.35)", OS.muted) }}>
            Trigger a GitHub sync to populate review data. AI review bots (CodeRabbit, Cursor, Copilot, Claude) are detected automatically.
          </div>
        </div>
      ) : (
        <>
          {/* KPI cards */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            {/* Card 1 — AI-Reviewed PRs */}
            <div style={{ padding: "14px 16px", borderRadius: 10, border: cardBorder, background: cardBg, textAlign: "center" }}>
              <div style={{ fontSize: 28, fontWeight: 700, color: dk(darkMode, "#fff", OS.text), fontFamily: OS.mono }}>
                {reviewTabStats.reviewedPRCount}
              </div>
              <div style={{ fontSize: 12, color: dk(darkMode, "rgba(255,255,255,0.6)", OS.secondary), marginTop: 2 }}>
                AI-Reviewed PRs
              </div>
              <div style={{ fontSize: 11, color: dk(darkMode, "rgba(255,255,255,0.35)", OS.muted), marginTop: 4 }}>
                {metrics.length > 0 ? Math.round((reviewTabStats.reviewedPRCount / metrics.length) * 100) : 0}% of {metrics.length} PRs
              </div>
            </div>

            {/* Card 2 — Issues Found */}
            <div style={{ padding: "14px 16px", borderRadius: 10, border: cardBorder, background: cardBg, textAlign: "center" }}>
              <div style={{ fontSize: 28, fontWeight: 700, color: dk(darkMode, "#fff", OS.text), fontFamily: OS.mono }}>
                {reviewTabStats.totalComments}
              </div>
              <div style={{ fontSize: 12, color: dk(darkMode, "rgba(255,255,255,0.6)", OS.secondary), marginTop: 2 }}>
                Issues Found
              </div>
              <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 6 }}>
                {reviewTabStats.bySeverity.map(([sev, count]) => (
                  <span key={sev} style={{
                    fontSize: 10, fontFamily: OS.mono, padding: "1px 6px", borderRadius: 4,
                    background: sev === "high" ? `${OS.red}20` : sev === "medium" ? `${OS.warning}20` : dk(darkMode, "rgba(255,255,255,0.06)", OS.bg),
                    color: sev === "high" ? OS.red : sev === "medium" ? OS.warning : dk(darkMode, "rgba(255,255,255,0.5)", OS.muted),
                  }}>
                    {count} {sev}
                  </span>
                ))}
              </div>
            </div>

            {/* Card 3 — Tool breakdown */}
            <div style={{ padding: "14px 16px", borderRadius: 10, border: cardBorder, background: cardBg }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: dk(darkMode, "rgba(255,255,255,0.8)", OS.secondary), marginBottom: 8, textAlign: "center" }}>
                Review Tools
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {reviewTabStats.byTool.map(([tool, count]) => (
                  <div key={tool} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ fontSize: 12, color: reviewColors[tool] ?? toolColors[tool] ?? dk(darkMode, "rgba(255,255,255,0.7)", OS.secondary), textTransform: "capitalize", fontWeight: 500 }}>{tool}</span>
                    <span style={{ fontSize: 11, fontFamily: OS.mono, color: dk(darkMode, "rgba(255,255,255,0.5)", OS.muted) }}>
                      {count} <span style={{ opacity: 0.6 }}>issues</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Issues by Category — horizontal bars */}
          <div style={{ padding: "14px 16px", borderRadius: 10, border: cardBorder, background: cardBg }}>
            <div style={{ fontSize: 14, fontWeight: 500, color: dk(darkMode, "rgba(255,255,255,0.85)", OS.text), marginBottom: 2 }}>Issues by Category</div>
            <div style={{ fontSize: 12, color: dk(darkMode, "rgba(255,255,255,0.5)", OS.muted), marginBottom: 12 }}>
              What AI reviewers are catching ({timeRange}d)
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {reviewTabStats.byCategory.map(([cat, count]) => {
                const maxCount = reviewTabStats.byCategory[0]?.[1] ?? 1;
                return (
                  <div key={cat} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ width: 80, fontSize: 12, color: dk(darkMode, "rgba(255,255,255,0.7)", OS.secondary), textAlign: "right", flexShrink: 0, textTransform: "capitalize" }}>{cat}</span>
                    <div style={{ flex: 1, height: 16, background: dk(darkMode, "rgba(255,255,255,0.06)", OS.border), borderRadius: 3, overflow: "hidden" }}>
                      <div style={{ width: `${Math.round((count / maxCount) * 100)}%`, height: "100%", borderRadius: 3, minWidth: 2, background: categoryColors[cat] ?? OS.faint }} />
                    </div>
                    <span style={{ width: 36, fontSize: 12, fontFamily: OS.mono, color: dk(darkMode, "rgba(255,255,255,0.6)", OS.secondary), textAlign: "right" }}>{count}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Weekly Trend */}
          {reviewTabStats.weeklyTrend.length > 1 && (
            <div style={{ padding: "14px 16px", borderRadius: 10, border: cardBorder, background: cardBg }}>
              <div style={{ fontSize: 14, fontWeight: 500, color: dk(darkMode, "rgba(255,255,255,0.85)", OS.text), marginBottom: 2 }}>Weekly Trend</div>
              <div style={{ fontSize: 12, color: dk(darkMode, "rgba(255,255,255,0.5)", OS.muted), marginBottom: 12 }}>
                AI review issues per week
              </div>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 80 }}>
                {reviewTabStats.weeklyTrend.map(({ label, count }) => {
                  const maxW = Math.max(...reviewTabStats.weeklyTrend.map((w) => w.count), 1);
                  const pct = Math.max(4, Math.round((count / maxW) * 100));
                  return (
                    <div key={label} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                      <span style={{ fontSize: 9, fontFamily: OS.mono, color: dk(darkMode, "rgba(255,255,255,0.4)", OS.muted) }}>{count}</span>
                      <div style={{ width: "100%", height: `${pct}%`, background: OS.blue, borderRadius: 2, minHeight: 2 }}
                        title={`Week of ${label}: ${count} issues`} />
                    </div>
                  );
                })}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                <span style={{ fontSize: 9, color: dk(darkMode, "rgba(255,255,255,0.3)", OS.muted) }}>{reviewTabStats.weeklyTrend[0]?.label}</span>
                <span style={{ fontSize: 9, color: dk(darkMode, "rgba(255,255,255,0.3)", OS.muted) }}>{reviewTabStats.weeklyTrend[reviewTabStats.weeklyTrend.length - 1]?.label}</span>
              </div>
            </div>
          )}

          {/* By Team + By Repo side by side */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {/* By Team chips */}
            <div style={{ padding: "14px 16px", borderRadius: 10, border: cardBorder, background: cardBg }}>
              <div style={{ fontSize: 14, fontWeight: 500, color: dk(darkMode, "rgba(255,255,255,0.85)", OS.text), marginBottom: 8 }}>By Team</div>
              {reviewTabStats.byTeam.length === 0 ? (
                <div style={{ fontSize: 12, color: dk(darkMode, "rgba(255,255,255,0.4)", OS.muted) }}>No team data (link PRs to Jira)</div>
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {reviewTabStats.byTeam.map(([team, count]) => (
                    <div key={team} style={{
                      padding: "8px 12px", borderRadius: 8,
                      border: `1px solid ${dk(darkMode, "rgba(255,255,255,0.08)", OS.border)}`,
                      background: dk(darkMode, "rgba(255,255,255,0.03)", OS.bg),
                    }}>
                      <div style={{ fontSize: 11, color: dk(darkMode, "rgba(255,255,255,0.6)", OS.secondary), marginBottom: 2 }} title={team}>{team}</div>
                      <div style={{ fontSize: 16, fontWeight: 700, fontFamily: OS.mono, color: dk(darkMode, "#fff", OS.text) }}>{count}</div>
                      <div style={{ fontSize: 10, color: dk(darkMode, "rgba(255,255,255,0.35)", OS.muted) }}>issues</div>
                    </div>
                  ))}
                </div>
              )}
              {reviewTabStats.unlinkedCount > 0 && (
                <div style={{ fontSize: 11, color: dk(darkMode, "rgba(255,255,255,0.35)", OS.muted), marginTop: 8 }}>
                  {reviewTabStats.unlinkedCount} issues on PRs not linked to Jira
                </div>
              )}
            </div>

            {/* By Repo chips */}
            <div style={{ padding: "14px 16px", borderRadius: 10, border: cardBorder, background: cardBg }}>
              <div style={{ fontSize: 14, fontWeight: 500, color: dk(darkMode, "rgba(255,255,255,0.85)", OS.text), marginBottom: 8 }}>By Repo</div>
              {reviewTabStats.byRepo.length === 0 ? (
                <div style={{ fontSize: 12, color: dk(darkMode, "rgba(255,255,255,0.4)", OS.muted) }}>No data</div>
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {reviewTabStats.byRepo.map(([repo, count]) => {
                    const shortName = repo.split("/").pop() ?? repo;
                    return (
                      <div key={repo} style={{
                        padding: "8px 12px", borderRadius: 8,
                        border: `1px solid ${dk(darkMode, "rgba(255,255,255,0.08)", OS.border)}`,
                        background: dk(darkMode, "rgba(255,255,255,0.03)", OS.bg),
                      }}>
                        <div style={{ fontSize: 11, color: dk(darkMode, "rgba(255,255,255,0.6)", OS.secondary), marginBottom: 2 }} title={repo}>{shortName}</div>
                        <div style={{ fontSize: 16, fontWeight: 700, fontFamily: OS.mono, color: dk(darkMode, "#fff", OS.text) }}>{count}</div>
                        <div style={{ fontSize: 10, color: dk(darkMode, "rgba(255,255,255,0.35)", OS.muted) }}>issues</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* By Author table */}
          <div style={{ padding: "14px 16px", borderRadius: 10, border: cardBorder, background: cardBg }}>
            <div style={{ fontSize: 14, fontWeight: 500, color: dk(darkMode, "rgba(255,255,255,0.85)", OS.text), marginBottom: 2 }}>By Author</div>
            <div style={{ fontSize: 12, color: dk(darkMode, "rgba(255,255,255,0.5)", OS.muted), marginBottom: 10 }}>
              Who is receiving the most AI review feedback ({timeRange}d)
            </div>
            {/* Header */}
            <div style={{ display: "grid", gridTemplateColumns: "130px 1fr 60px 80px", gap: 6, marginBottom: 6, padding: "0 0 4px 0", borderBottom: `1px solid ${dk(darkMode, "rgba(255,255,255,0.08)", OS.border)}` }}>
              <div style={{ fontSize: 11, color: dk(darkMode, "rgba(255,255,255,0.5)", OS.muted), textTransform: "uppercase", letterSpacing: "0.05em" }}>Author</div>
              <div style={{ fontSize: 11, color: dk(darkMode, "rgba(255,255,255,0.5)", OS.muted), textTransform: "uppercase", letterSpacing: "0.05em" }}>Severity</div>
              <div style={{ fontSize: 11, color: dk(darkMode, "rgba(255,255,255,0.5)", OS.muted), textTransform: "uppercase", letterSpacing: "0.05em", textAlign: "right" }}>Issues</div>
              <div style={{ fontSize: 11, color: dk(darkMode, "rgba(255,255,255,0.5)", OS.muted), textTransform: "uppercase", letterSpacing: "0.05em", textAlign: "right" }}>Top Category</div>
            </div>
            {reviewTabStats.authorRows.slice(0, 10).map((row) => (
              <div key={row.author} style={{ display: "grid", gridTemplateColumns: "130px 1fr 60px 80px", gap: 6, alignItems: "center", padding: "4px 0" }}>
                <span style={{ fontSize: 12, color: dk(darkMode, "rgba(255,255,255,0.8)", OS.text), overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={row.author}>
                  {row.author}
                </span>
                {/* Severity distribution mini bar */}
                <div style={{ display: "flex", height: 10, borderRadius: 3, overflow: "hidden", background: dk(darkMode, "rgba(255,255,255,0.04)", OS.border) }}
                  title={Object.entries(row.byCategory).map(([c, n]) => `${c}: ${n}`).join(", ")}
                >
                  {Object.entries(row.byCategory).sort((a, b) => b[1] - a[1]).map(([cat, count]) => (
                    <div key={cat} style={{
                      flex: count,
                      height: "100%",
                      background: categoryColors[cat] ?? dk(darkMode, "rgba(255,255,255,0.15)", OS.faint),
                    }} />
                  ))}
                </div>
                <span style={{ fontSize: 12, fontFamily: OS.mono, fontWeight: 600, color: dk(darkMode, "rgba(255,255,255,0.85)", OS.text), textAlign: "right" }}>
                  {row.total}
                </span>
                <span style={{ fontSize: 11, color: categoryColors[row.topCategory] ?? dk(darkMode, "rgba(255,255,255,0.5)", OS.muted), textAlign: "right", textTransform: "capitalize" }}>
                  {row.topCategory}
                </span>
              </div>
            ))}
            {reviewTabStats.authorRows.length > 10 && (
              <div style={{ fontSize: 11, color: dk(darkMode, "rgba(255,255,255,0.4)", OS.muted), marginTop: 6 }}>
                +{reviewTabStats.authorRows.length - 10} more authors
              </div>
            )}
          </div>

          {/* Category legend */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "0 4px" }}>
            {Object.entries(categoryColors).map(([cat, color]) => (
              <div key={cat} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0 }} />
                <span style={{ fontSize: 11, color: dk(darkMode, "rgba(255,255,255,0.5)", OS.secondary), textTransform: "capitalize" }}>{cat}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
