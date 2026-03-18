/**
 * Eng Stats Dashboard — KPI cards, cycle time chart, PR size distribution,
 * AI usage section, and optional Copilot section.
 * All charts are pure SVG — no chart library dependency.
 */

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@shared/db";
import { OS } from "@shared/tokens";
import type { PRMetric, JiraTicket, PRJiraLink } from "@shared/types";

// ─── Dark mode context (mirrors App.tsx pattern) ───
const dk = (dark: boolean, d: string, l: string) => (dark ? d : l);

// ─── Helpers ───

function daysAgoISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function fmtHours(h: number | null): string {
  if (h === null || isNaN(h)) return "—";
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 24) return `${h.toFixed(1)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

function weekLabel(date: Date): string {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

// ─── Sub-components ───

interface KPICardProps {
  label: string;
  value: string;
  sub?: string;
  trend?: "up" | "down" | "flat" | null;
  trendPositive?: boolean; // whether "up" is good
  dark: boolean;
}

function KPICard({ label, value, sub, trend, trendPositive, dark }: KPICardProps) {
  const trendColor =
    trend === null || trend === "flat"
      ? OS.muted
      : trend === "up"
      ? trendPositive
        ? OS.green
        : OS.red
      : trendPositive
      ? OS.red
      : OS.green;

  const trendArrow =
    trend === "up" ? "↑" : trend === "down" ? "↓" : "";

  return (
    <div
      style={{
        flex: 1,
        minWidth: 120,
        padding: "14px 16px",
        borderRadius: 10,
        border: `1px solid ${dk(dark, "rgba(255,255,255,0.08)", OS.border)}`,
        background: dk(dark, "#1c1c22", OS.white),
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 500,
          color: dk(dark, "rgba(255,255,255,0.45)", OS.muted),
          fontFamily: OS.font,
          marginBottom: 6,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 24,
          fontWeight: 700,
          fontFamily: OS.font,
          color: dk(dark, "#fff", OS.text),
          display: "flex",
          alignItems: "baseline",
          gap: 6,
        }}
      >
        {value}
        {trend && trend !== "flat" && (
          <span style={{ fontSize: 16, color: trendColor, fontWeight: 500 }}>
            {trendArrow}
          </span>
        )}
      </div>
      {sub && (
        <div
          style={{
            fontSize: 11,
            color: dk(dark, "rgba(255,255,255,0.35)", OS.muted),
            fontFamily: OS.font,
            marginTop: 4,
          }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

// ─── Cycle Time Bar Chart (pure SVG) ───

interface WeekBucket {
  label: string;
  avgHours: number;
  count: number;
}

function CycleTimeChart({
  buckets,
  dark,
}: {
  buckets: WeekBucket[];
  dark: boolean;
}) {
  const W = 360;
  const H = 120;
  const PAD = { top: 8, right: 8, bottom: 24, left: 40 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;

  const maxVal = Math.max(...buckets.map((b) => b.avgHours), 1);
  const barW = Math.max(4, (chartW / Math.max(buckets.length, 1)) * 0.7);
  const gap = chartW / Math.max(buckets.length, 1);

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((f) => ({
    y: PAD.top + chartH * (1 - f),
    label: fmtHours(maxVal * f),
  }));

  const textColor = dk(dark, "rgba(255,255,255,0.4)", OS.muted);
  const barColor = OS.blue;
  const gridColor = dk(dark, "rgba(255,255,255,0.06)", "rgba(0,0,0,0.06)");

  return (
    <svg width={W} height={H} style={{ overflow: "visible" }}>
      {/* Grid lines */}
      {gridLines.map((g, i) => (
        <g key={i}>
          <line
            x1={PAD.left}
            y1={g.y}
            x2={PAD.left + chartW}
            y2={g.y}
            stroke={gridColor}
            strokeWidth={1}
          />
          <text
            x={PAD.left - 4}
            y={g.y + 3}
            textAnchor="end"
            fontSize={9}
            fill={textColor}
            fontFamily={OS.font}
          >
            {g.label}
          </text>
        </g>
      ))}

      {/* Bars */}
      {buckets.map((b, i) => {
        const x = PAD.left + i * gap + gap / 2 - barW / 2;
        const barH = (b.avgHours / maxVal) * chartH;
        const y = PAD.top + chartH - barH;
        return (
          <g key={i}>
            <rect
              x={x}
              y={y}
              width={barW}
              height={Math.max(barH, 1)}
              rx={2}
              fill={barColor}
              opacity={0.85}
            />
            <text
              x={x + barW / 2}
              y={H - 6}
              textAnchor="middle"
              fontSize={9}
              fill={textColor}
              fontFamily={OS.font}
            >
              {b.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ─── PR Size Distribution Bar Chart (pure SVG) ───

function PRSizeChart({
  small,
  medium,
  large,
  dark,
}: {
  small: number;
  medium: number;
  large: number;
  dark: boolean;
}) {
  const total = small + medium + large || 1;
  const bars = [
    { label: "Small\n<100", count: small, color: OS.green },
    { label: "Med\n100-500", count: medium, color: OS.warning },
    { label: "Large\n>500", count: large, color: OS.red },
  ];

  const W = 220;
  const H = 120;
  const PAD = { top: 8, right: 8, bottom: 36, left: 32 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;
  const barW = Math.floor(chartW / 4);
  const gap = chartW / 3;

  const textColor = dk(dark, "rgba(255,255,255,0.4)", OS.muted);
  const gridColor = dk(dark, "rgba(255,255,255,0.06)", "rgba(0,0,0,0.06)");

  return (
    <svg width={W} height={H} style={{ overflow: "visible" }}>
      {/* Baseline */}
      <line
        x1={PAD.left}
        y1={PAD.top + chartH}
        x2={PAD.left + chartW}
        y2={PAD.top + chartH}
        stroke={gridColor}
        strokeWidth={1}
      />

      {bars.map((b, i) => {
        const pct = b.count / total;
        const barH = Math.max(pct * chartH, 1);
        const x = PAD.left + i * gap + gap / 2 - barW / 2;
        const y = PAD.top + chartH - barH;
        return (
          <g key={i}>
            <rect
              x={x}
              y={y}
              width={barW}
              height={barH}
              rx={2}
              fill={b.color}
              opacity={0.8}
            />
            {/* Count label */}
            <text
              x={x + barW / 2}
              y={y - 3}
              textAnchor="middle"
              fontSize={10}
              fontWeight={600}
              fill={dk(dark, "rgba(255,255,255,0.7)", OS.text)}
              fontFamily={OS.font}
            >
              {b.count}
            </text>
            {/* X-axis labels (two lines) */}
            {b.label.split("\n").map((line, li) => (
              <text
                key={li}
                x={x + barW / 2}
                y={PAD.top + chartH + 12 + li * 11}
                textAnchor="middle"
                fontSize={9}
                fill={textColor}
                fontFamily={OS.font}
              >
                {line}
              </text>
            ))}
          </g>
        );
      })}

      {/* Y-axis pct label */}
      <text
        x={PAD.left - 4}
        y={PAD.top + chartH / 2}
        textAnchor="end"
        fontSize={9}
        fill={textColor}
        fontFamily={OS.font}
        transform={`rotate(-90, ${PAD.left - 4}, ${PAD.top + chartH / 2})`}
      >
        PRs
      </text>
    </svg>
  );
}

// ─── AI Adoption Line Chart (pure SVG) ───

function AIAdoptionChart({
  weeklyPcts,
  dark,
}: {
  weeklyPcts: { label: string; pct: number }[];
  dark: boolean;
}) {
  const W = 360;
  const H = 80;
  const PAD = { top: 8, right: 8, bottom: 20, left: 32 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;

  if (weeklyPcts.length < 2) return null;

  const maxPct = Math.max(...weeklyPcts.map((w) => w.pct), 10);
  const points = weeklyPcts.map((w, i) => {
    const x = PAD.left + (i / (weeklyPcts.length - 1)) * chartW;
    const y = PAD.top + chartH - (w.pct / maxPct) * chartH;
    return { x, y, label: w.label };
  });

  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const areaD = `${pathD} L ${points[points.length - 1].x} ${PAD.top + chartH} L ${points[0].x} ${PAD.top + chartH} Z`;

  const lineColor = OS.blue;
  const areaColor = `${OS.blue}22`;
  const textColor = dk(dark, "rgba(255,255,255,0.4)", OS.muted);

  return (
    <svg width={W} height={H} style={{ overflow: "visible" }}>
      <path d={areaD} fill={areaColor} />
      <path d={pathD} fill="none" stroke={lineColor} strokeWidth={1.5} />
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={2.5} fill={lineColor} />
      ))}
      {/* X labels — only first and last */}
      <text x={points[0].x} y={H - 4} textAnchor="middle" fontSize={9} fill={textColor} fontFamily={OS.font}>
        {points[0].label}
      </text>
      <text x={points[points.length - 1].x} y={H - 4} textAnchor="middle" fontSize={9} fill={textColor} fontFamily={OS.font}>
        {points[points.length - 1].label}
      </text>
    </svg>
  );
}

// ─── Main EngStatsView ───

interface EngStatsViewProps {
  darkMode?: boolean;
}

export function EngStatsView({ darkMode = false }: EngStatsViewProps) {
  const [selectedRepo, setSelectedRepo] = useState<string>("__all__");
  const [timeRange, setTimeRange] = useState<30 | 60 | 90>(30);
  const [syncing, setSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [repos, setRepos] = useState<string[]>([]);
  const [githubOrg, setGithubOrg] = useState<string>("");
  const [syncError, setSyncError] = useState<string | null>(null);
  const [selectedTeam, setSelectedTeam] = useState<string>("__all__");
  const [selectedType, setSelectedType] = useState<string>("__all__");
  const [jiraSyncing, setJiraSyncing] = useState(false);
  const [jiraSyncProgress, setJiraSyncProgress] = useState<{ phase: string; current: number; total: number } | null>(null);

  // Load config from chrome.storage
  useEffect(() => {
    chrome.storage.local
      .get(["githubRepos", "githubOrg", "githubLastSynced"])
      .then((r) => {
        setRepos((r.githubRepos as string[]) ?? []);
        setGithubOrg((r.githubOrg as string) ?? "");
        setLastSynced((r.githubLastSynced as string) ?? null);
      });
  }, []);

  const since = daysAgoISO(timeRange);
  // Bump this after sync to force useLiveQuery to re-evaluate
  const [queryKey, setQueryKey] = useState(0);

  // Live query from IndexedDB
  const allMetrics = useLiveQuery(
    () =>
      db.pr_metrics
        .where("mergedAt")
        .aboveOrEqual(since)
        .toArray()
        .catch(() => []),
    [since, queryKey],
    [] as PRMetric[],
  );

  // Total count in DB (helps debug whether data is persisted)
  const totalInDB = useLiveQuery(
    () => db.pr_metrics.count().catch(() => 0),
    [queryKey],
    0,
  );

  const copilotMetrics = useLiveQuery(
    () =>
      db.copilot_metrics
        .where("date")
        .aboveOrEqual(since.slice(0, 10))
        .toArray()
        .catch(() => []),
    [since],
    [],
  );

  // Jira tickets
  const jiraTickets = useLiveQuery(
    () => db.jira_tickets.toArray().catch(() => []),
    [queryKey],
    [] as JiraTicket[],
  );

  // PR-Jira links
  const prJiraLinks = useLiveQuery(
    () => db.pr_jira_links.toArray().catch(() => []),
    [queryKey],
    [] as PRJiraLink[],
  );

  // ─── Jira link maps ───
  const prToTickets = useMemo(() => {
    const map = new Map<number, JiraTicket[]>();
    const ticketByKey = new Map(jiraTickets.map((t) => [t.key, t]));
    for (const link of prJiraLinks) {
      const ticket = ticketByKey.get(link.jiraTicketKey);
      if (!ticket) continue;
      const existing = map.get(link.prMetricId) ?? [];
      existing.push(ticket);
      map.set(link.prMetricId, existing);
    }
    return map;
  }, [jiraTickets, prJiraLinks]);

  // Available teams (distinct components)
  const teams = useMemo(() => {
    const set = new Set<string>();
    for (const t of jiraTickets) {
      if (t.component) set.add(t.component);
    }
    return Array.from(set).sort();
  }, [jiraTickets]);

  // Available issue types
  const issueTypes = useMemo(() => {
    const set = new Set<string>();
    for (const t of jiraTickets) {
      set.add(t.issueType);
    }
    return Array.from(set).sort();
  }, [jiraTickets]);

  // Filter by selected repo, team, and type
  const metrics = useMemo(() => {
    let filtered = selectedRepo === "__all__"
      ? allMetrics
      : allMetrics.filter((m) => m.repo === selectedRepo);

    // Filter by team (via linked Jira tickets)
    if (selectedTeam !== "__all__") {
      filtered = filtered.filter((m) => {
        const tickets = prToTickets.get(m.id!);
        return tickets?.some((t) => t.component === selectedTeam);
      });
    }

    // Filter by issue type
    if (selectedType !== "__all__") {
      filtered = filtered.filter((m) => {
        const tickets = prToTickets.get(m.id!);
        return tickets?.some((t) => t.issueType === selectedType);
      });
    }

    return filtered;
  }, [allMetrics, selectedRepo, selectedTeam, selectedType, prToTickets]);

  // Collect unique repos from DB + config
  const allRepos = useMemo(() => {
    const fromDB = Array.from(new Set(allMetrics.map((m) => m.repo)));
    const combined = Array.from(new Set([...repos, ...fromDB]));
    return combined;
  }, [allMetrics, repos]);

  // ─── Computed KPIs ───

  const cycleTimes = metrics
    .map((m) => m.cycleTimeHours)
    .filter((h): h is number => h !== null);

  const avgCycleTime = cycleTimes.length
    ? cycleTimes.reduce((a, b) => a + b, 0) / cycleTimes.length
    : null;

  const reviewTimes = metrics
    .map((m) => m.timeToFirstReviewHours)
    .filter((h): h is number => h !== null);

  const medianReviewTime = reviewTimes.length ? median(reviewTimes) : null;

  const prsMerged = metrics.length;

  // Deploy frequency: from DB releases data (approximated from all repos)
  // We'll show it from releases count / weeks
  const weeksInRange = timeRange / 7;

  // ─── Cycle time trend (current half vs prior half) ───
  const halfPoint = daysAgoISO(timeRange / 2);
  const recent = metrics.filter((m) => m.mergedAt && m.mergedAt >= halfPoint);
  const older = metrics.filter((m) => m.mergedAt && m.mergedAt < halfPoint);

  const recentAvg =
    recent.length
      ? recent
          .map((m) => m.cycleTimeHours)
          .filter((h): h is number => h !== null)
          .reduce((a, b, _i, arr) => a + b / arr.length, 0)
      : null;
  const olderAvg =
    older.length
      ? older
          .map((m) => m.cycleTimeHours)
          .filter((h): h is number => h !== null)
          .reduce((a, b, _i, arr) => a + b / arr.length, 0)
      : null;

  const cycleTrend: "up" | "down" | "flat" | null =
    recentAvg !== null && olderAvg !== null && olderAvg > 0
      ? recentAvg / olderAvg > 1.05
        ? "up"
        : recentAvg / olderAvg < 0.95
        ? "down"
        : "flat"
      : null;

  // ─── Weekly buckets for cycle time chart ───
  const weeklyBuckets: WeekBucket[] = useMemo(() => {
    const buckets: Map<string, number[]> = new Map();
    for (const m of metrics) {
      if (!m.mergedAt || m.cycleTimeHours === null) continue;
      const d = new Date(m.mergedAt);
      // Week start = Monday
      const day = d.getDay();
      const diff = (day + 6) % 7;
      d.setDate(d.getDate() - diff);
      const key = d.toISOString().slice(0, 10);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(m.cycleTimeHours);
    }

    return Array.from(buckets.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, vals]) => ({
        label: weekLabel(new Date(key + "T12:00:00")),
        avgHours: vals.reduce((a, b) => a + b, 0) / vals.length,
        count: vals.length,
      }))
      .slice(-Math.ceil(timeRange / 7));
  }, [metrics, timeRange]);

  // ─── PR size distribution ───
  const smallCount = metrics.filter(
    (m) => m.additions + m.deletions < 100,
  ).length;
  const mediumCount = metrics.filter(
    (m) =>
      m.additions + m.deletions >= 100 && m.additions + m.deletions < 500,
  ).length;
  const largeCount = metrics.filter(
    (m) => m.additions + m.deletions >= 500,
  ).length;

  // ─── AI adoption ───
  const aiPRs = metrics.filter((m) => m.aiAssisted).length;
  const aiPct = metrics.length ? Math.round((aiPRs / metrics.length) * 100) : 0;

  // Tool breakdown
  const toolCounts: Record<string, number> = {};
  for (const m of metrics) {
    for (const tool of m.aiTools) {
      toolCounts[tool] = (toolCounts[tool] ?? 0) + 1;
    }
  }
  const toolEntries = Object.entries(toolCounts).sort((a, b) => b[1] - a[1]);

  // Weekly AI pct trend
  const weeklyAI = useMemo(() => {
    const buckets: Map<string, { ai: number; total: number }> = new Map();
    for (const m of metrics) {
      if (!m.mergedAt) continue;
      const d = new Date(m.mergedAt);
      const day = d.getDay();
      const diff = (day + 6) % 7;
      d.setDate(d.getDate() - diff);
      const key = d.toISOString().slice(0, 10);
      if (!buckets.has(key)) buckets.set(key, { ai: 0, total: 0 });
      const b = buckets.get(key)!;
      b.total++;
      if (m.aiAssisted) b.ai++;
    }
    return Array.from(buckets.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, v]) => ({
        label: weekLabel(new Date(key + "T12:00:00")),
        pct: v.total > 0 ? Math.round((v.ai / v.total) * 100) : 0,
      }))
      .slice(-Math.ceil(timeRange / 7));
  }, [metrics, timeRange]);

  // ─── Lead Time: Jira created → PR merged (for linked tickets) ───
  const leadTimes = useMemo(() => {
    const times: number[] = [];
    for (const m of metrics) {
      if (!m.mergedAt || m.id == null) continue;
      const tickets = prToTickets.get(m.id);
      if (!tickets?.length) continue;
      // Use earliest ticket creation date
      const earliest = tickets
        .map((t) => new Date(t.createdAt).getTime())
        .filter((t) => !isNaN(t));
      if (!earliest.length) continue;
      const ticketCreated = Math.min(...earliest);
      const merged = new Date(m.mergedAt).getTime();
      if (merged > ticketCreated) {
        times.push((merged - ticketCreated) / (1000 * 60 * 60));
      }
    }
    return times;
  }, [metrics, prToTickets]);

  const avgLeadTime = leadTimes.length
    ? leadTimes.reduce((a, b) => a + b, 0) / leadTimes.length
    : null;

  // ─── Copilot summary ───
  const latestCopilot =
    copilotMetrics.length > 0
      ? copilotMetrics.sort((a, b) => b.date.localeCompare(a.date))[0]
      : null;

  // ─── Manual sync ───
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [syncPhase, setSyncPhase] = useState<string>("");
  const handleSync = useCallback(async () => {
    setSyncing(true);
    setSyncError(null);
    setSyncResult(null);
    setJiraSyncProgress(null);
    const parts: string[] = [];
    try {
      // 1. GitHub sync
      setSyncPhase("GitHub PRs…");
      const ghResp = await chrome.runtime.sendMessage({ type: "GITHUB_SYNC" });

      if (!ghResp) {
        setSyncError("No response from service worker — try reloading the extension");
        return;
      }

      const ghErrors = ghResp.errors as string[] | undefined;
      const ghError = ghResp.error as string | undefined;
      if (ghErrors?.length) parts.push(`GitHub: ${ghErrors.join(", ")}`);
      else if (ghError) parts.push(`GitHub: ${ghError}`);

      const ghSynced = ghResp.synced as number | undefined;
      const ghTotal = ghResp.total as number | undefined;
      const ghMsg = ghSynced != null && ghSynced > 0
        ? `${ghSynced} PRs`
        : ghTotal && ghTotal > 0
        ? `${ghTotal} PRs (up to date)`
        : null;

      // 2. Jira sync (if configured)
      const jiraConf = await chrome.storage.local.get(["jiraToken", "jiraEmail"]);
      let jiraMsg: string | null = null;
      if (jiraConf.jiraToken && jiraConf.jiraEmail) {
        setSyncPhase("Jira tickets…");
        const jiraResp = await chrome.runtime.sendMessage({ type: "JIRA_SYNC" });

        if (jiraResp) {
          const jErrors = jiraResp.errors as string[] | undefined;
          const jError = jiraResp.error as string | undefined;
          if (jErrors?.length) parts.push(`Jira: ${jErrors.join(", ")}`);
          else if (jError) parts.push(`Jira: ${jError}`);

          const jSynced = jiraResp.synced as number | undefined;
          const jLinked = jiraResp.linked as number | undefined;
          jiraMsg = [
            jSynced ? `${jSynced} tickets` : null,
            jLinked ? `${jLinked} linked` : null,
          ].filter(Boolean).join(", ") || null;
        }
        setJiraSyncProgress(null);
      }

      // Combined result
      setSyncResult([ghMsg, jiraMsg].filter(Boolean).join(" · ") || "Up to date");
      if (parts.length) setSyncError(parts.join(" | "));

      const r = await chrome.storage.local.get(["githubLastSynced", "jiraLastSynced"]);
      setLastSynced(r.githubLastSynced ?? r.jiraLastSynced ?? null);
      setQueryKey((k) => k + 1);
    } catch (e) {
      setSyncError(String(e));
    } finally {
      setSyncing(false);
      setSyncPhase("");
      setJiraSyncProgress(null);
    }
  }, []);

  // Listen for Jira sync progress messages
  useEffect(() => {
    const listener = (message: { type?: string; phase?: string; current?: number; total?: number }) => {
      if (message.type === "JIRA_SYNC_PROGRESS") {
        setJiraSyncProgress({
          phase: message.phase ?? "tickets",
          current: message.current ?? 0,
          total: message.total ?? 0,
        });
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  // ─── Styles ───
  const cardBg = dk(darkMode, "#1c1c22", OS.white);
  const cardBorder = `1px solid ${dk(darkMode, "rgba(255,255,255,0.08)", OS.border)}`;
  const sectionTitle: React.CSSProperties = {
    fontSize: 12,
    fontWeight: 600,
    color: dk(darkMode, "rgba(255,255,255,0.7)", OS.secondary),
    fontFamily: OS.font,
    margin: 0,
    marginBottom: 12,
  };

  const noData = allMetrics.length === 0;

  return (
    <div
      style={{
        padding: "16px",
        fontFamily: OS.font,
        color: dk(darkMode, "#fff", OS.text),
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      {/* ─── Header ─── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: dk(darkMode, "#fff", OS.text),
          }}
        >
          Eng Stats
        </span>

        {/* Repo selector */}
        {allRepos.length > 0 && (
          <select
            value={selectedRepo}
            onChange={(e) => setSelectedRepo(e.target.value)}
            style={{
              fontSize: 12,
              padding: "4px 8px",
              borderRadius: 6,
              border: cardBorder,
              background: cardBg,
              color: dk(darkMode, "rgba(255,255,255,0.8)", OS.text),
              fontFamily: OS.font,
              cursor: "pointer",
            }}
          >
            <option value="__all__">All repos</option>
            {allRepos.map((r) => (
              <option key={r} value={r}>
                {r.split("/")[1] ?? r}
              </option>
            ))}
          </select>
        )}

        {/* Team selector (from Jira components) */}
        {teams.length > 0 && (
          <select
            value={selectedTeam}
            onChange={(e) => setSelectedTeam(e.target.value)}
            style={{
              fontSize: 12,
              padding: "4px 8px",
              borderRadius: 6,
              border: cardBorder,
              background: cardBg,
              color: dk(darkMode, "rgba(255,255,255,0.8)", OS.text),
              fontFamily: OS.font,
              cursor: "pointer",
            }}
          >
            <option value="__all__">All teams</option>
            {teams.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        )}

        {/* Type selector */}
        {issueTypes.length > 0 && (
          <select
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            style={{
              fontSize: 12,
              padding: "4px 8px",
              borderRadius: 6,
              border: cardBorder,
              background: cardBg,
              color: dk(darkMode, "rgba(255,255,255,0.8)", OS.text),
              fontFamily: OS.font,
              cursor: "pointer",
            }}
          >
            <option value="__all__">All types</option>
            {issueTypes.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        )}

        {/* Time range toggle */}
        <div style={{ display: "flex", gap: 2, marginLeft: "auto" }}>
          {([30, 60, 90] as const).map((d) => (
            <button
              key={d}
              onClick={() => setTimeRange(d)}
              style={{
                fontSize: 11,
                fontWeight: 500,
                padding: "3px 10px",
                borderRadius: 6,
                border: cardBorder,
                cursor: "pointer",
                fontFamily: OS.font,
                background:
                  timeRange === d
                    ? OS.blue
                    : dk(darkMode, "rgba(255,255,255,0.05)", OS.bg),
                color:
                  timeRange === d
                    ? "#fff"
                    : dk(darkMode, "rgba(255,255,255,0.6)", OS.secondary),
              }}
            >
              {d}d
            </button>
          ))}
        </div>

        {/* Sync button */}
        <button
          onClick={handleSync}
          disabled={syncing}
          style={{
            fontSize: 11,
            fontWeight: 500,
            padding: "4px 12px",
            borderRadius: 6,
            border: `1px solid ${OS.blue}`,
            background: "transparent",
            color: OS.blue,
            cursor: syncing ? "not-allowed" : "pointer",
            fontFamily: OS.font,
            opacity: syncing ? 0.6 : 1,
          }}
        >
          {syncing ? (syncPhase || "Syncing…") : "Sync"}
        </button>
      </div>

      {/* Status line: last synced, sync result, DB count */}
      <div
        style={{
          fontSize: 11,
          color: dk(darkMode, "rgba(255,255,255,0.3)", OS.muted),
          marginTop: -10,
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        {lastSynced && <span>Last synced {new Date(lastSynced).toLocaleString()}</span>}
        {syncResult && <span style={{ color: OS.green }}>{syncResult}</span>}
        {totalInDB > 0 && <span>{totalInDB} PRs in database</span>}
      </div>
      {syncError && (
        <div
          style={{
            fontSize: 11,
            color: OS.red,
            background: "rgba(209,67,67,0.08)",
            border: `1px solid rgba(209,67,67,0.2)`,
            borderRadius: 6,
            padding: "6px 10px",
            marginTop: -8,
          }}
        >
          Sync error: {syncError}
        </div>
      )}

      {/* Jira sync progress */}
      {jiraSyncProgress && jiraSyncProgress.total > 0 && (
        <div style={{ marginTop: -8 }}>
          <div style={{ fontSize: 11, color: dk(darkMode, "rgba(255,255,255,0.4)", OS.muted), marginBottom: 4 }}>
            {jiraSyncProgress.phase === "tickets" ? "Syncing Jira" : "Linking PRs to Jira"}… {jiraSyncProgress.current}/{jiraSyncProgress.total}
          </div>
          <div style={{
            height: 4,
            borderRadius: 2,
            background: dk(darkMode, "rgba(255,255,255,0.08)", OS.border),
            overflow: "hidden",
          }}>
            <div style={{
              height: "100%",
              width: `${Math.round((jiraSyncProgress.current / jiraSyncProgress.total) * 100)}%`,
              background: OS.blue,
              borderRadius: 2,
              transition: "width 0.3s",
            }} />
          </div>
        </div>
      )}

      {/* No GitHub token configured */}
      {repos.length === 0 && (
        <div
          style={{
            padding: "20px",
            textAlign: "center",
            background: cardBg,
            border: cardBorder,
            borderRadius: 10,
            fontSize: 13,
            color: dk(darkMode, "rgba(255,255,255,0.4)", OS.muted),
          }}
        >
          No GitHub repos configured.{" "}
          <span style={{ color: OS.blue, fontWeight: 500 }}>
            Add your PAT + repos in Options → Integrations → GitHub.
          </span>
        </div>
      )}

      {/* ─── KPI Cards ─── */}
      {repos.length > 0 && (
        <>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <KPICard
              label="Avg Cycle Time"
              value={fmtHours(avgCycleTime)}
              sub={`${cycleTimes.length} PRs merged`}
              trend={cycleTrend}
              trendPositive={false}
              dark={darkMode}
            />
            <KPICard
              label="Median Review Time"
              value={fmtHours(medianReviewTime)}
              sub={`time to first review`}
              dark={darkMode}
            />
            <KPICard
              label="PRs Merged"
              value={String(prsMerged)}
              sub={`last ${timeRange} days`}
              dark={darkMode}
            />
            <KPICard
              label="AI-Assisted"
              value={`${aiPct}%`}
              sub={`${aiPRs} of ${prsMerged} PRs`}
              dark={darkMode}
            />
            {avgLeadTime !== null && (
              <KPICard
                label="Avg Lead Time"
                value={fmtHours(avgLeadTime)}
                sub={`ticket → merge (${leadTimes.length} linked)`}
                dark={darkMode}
              />
            )}
          </div>

          {noData && (
            <div
              style={{
                padding: "16px",
                textAlign: "center",
                background: cardBg,
                border: cardBorder,
                borderRadius: 10,
                fontSize: 12,
                color: dk(darkMode, "rgba(255,255,255,0.4)", OS.muted),
              }}
            >
              No PR data for this period. Click <strong>Sync</strong> to fetch
              from GitHub.
            </div>
          )}

          {/* ─── Charts row ─── */}
          {!noData && (
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              {/* Cycle Time Chart */}
              <div
                style={{
                  flex: "3 1 320px",
                  padding: "14px 16px",
                  borderRadius: 10,
                  border: cardBorder,
                  background: cardBg,
                }}
              >
                <h3 style={sectionTitle}>Cycle Time (weekly avg)</h3>
                {weeklyBuckets.length > 0 ? (
                  <CycleTimeChart buckets={weeklyBuckets} dark={darkMode} />
                ) : (
                  <div
                    style={{
                      fontSize: 12,
                      color: dk(
                        darkMode,
                        "rgba(255,255,255,0.3)",
                        OS.muted,
                      ),
                      height: 80,
                      display: "flex",
                      alignItems: "center",
                    }}
                  >
                    Not enough data
                  </div>
                )}
              </div>

              {/* PR Size Chart */}
              <div
                style={{
                  flex: "2 1 200px",
                  padding: "14px 16px",
                  borderRadius: 10,
                  border: cardBorder,
                  background: cardBg,
                }}
              >
                <h3 style={sectionTitle}>PR Size Distribution</h3>
                <PRSizeChart
                  small={smallCount}
                  medium={mediumCount}
                  large={largeCount}
                  dark={darkMode}
                />
              </div>
            </div>
          )}

          {/* ─── AI Usage Section ─── */}
          {!noData && (
            <div
              style={{
                padding: "14px 16px",
                borderRadius: 10,
                border: cardBorder,
                background: cardBg,
              }}
            >
              <h3 style={sectionTitle}>AI Usage</h3>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                {/* Adoption card */}
                <div style={{ minWidth: 140 }}>
                  <div
                    style={{
                      fontSize: 28,
                      fontWeight: 700,
                      color: dk(darkMode, "#fff", OS.text),
                    }}
                  >
                    {aiPct}%
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: dk(
                        darkMode,
                        "rgba(255,255,255,0.4)",
                        OS.muted,
                      ),
                      marginTop: 2,
                    }}
                  >
                    of PRs AI-assisted
                  </div>
                  <div style={{ marginTop: 12 }}>
                    {toolEntries.map(([tool, count]) => (
                      <div
                        key={tool}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          marginBottom: 4,
                        }}
                      >
                        <div
                          style={{
                            width: 60,
                            fontSize: 11,
                            color: dk(
                              darkMode,
                              "rgba(255,255,255,0.6)",
                              OS.secondary,
                            ),
                            textTransform: "capitalize",
                          }}
                        >
                          {tool}
                        </div>
                        <div
                          style={{
                            flex: 1,
                            height: 6,
                            borderRadius: 3,
                            background: dk(
                              darkMode,
                              "rgba(255,255,255,0.1)",
                              OS.border,
                            ),
                            overflow: "hidden",
                          }}
                        >
                          <div
                            style={{
                              height: "100%",
                              width: `${Math.round(
                                (count / Math.max(aiPRs, 1)) * 100,
                              )}%`,
                              background: OS.blue,
                              borderRadius: 3,
                            }}
                          />
                        </div>
                        <div
                          style={{
                            fontSize: 11,
                            color: dk(
                              darkMode,
                              "rgba(255,255,255,0.4)",
                              OS.muted,
                            ),
                            minWidth: 20,
                            textAlign: "right",
                          }}
                        >
                          {count}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Adoption trend chart */}
                {weeklyAI.length >= 2 && (
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div
                      style={{
                        fontSize: 11,
                        color: dk(
                          darkMode,
                          "rgba(255,255,255,0.4)",
                          OS.muted,
                        ),
                        marginBottom: 6,
                      }}
                    >
                      Weekly trend
                    </div>
                    <AIAdoptionChart weeklyPcts={weeklyAI} dark={darkMode} />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ─── Team Breakdown ─── */}
          {teams.length > 0 && !noData && (
            <div
              style={{
                padding: "14px 16px",
                borderRadius: 10,
                border: cardBorder,
                background: cardBg,
              }}
            >
              <h3 style={sectionTitle}>Team Breakdown</h3>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: OS.font }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${dk(darkMode, "rgba(255,255,255,0.08)", OS.border)}` }}>
                      {["Team", "PRs", "Avg Cycle", "Med Review", "Avg Size", "AI %"].map((h) => (
                        <th key={h} style={{
                          textAlign: h === "Team" ? "left" : "right",
                          padding: "6px 8px",
                          fontWeight: 600,
                          color: dk(darkMode, "rgba(255,255,255,0.5)", OS.secondary),
                          fontSize: 11,
                        }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      // Build per-team stats
                      const teamStats = new Map<string, PRMetric[]>();
                      // Also track unlinked
                      const unlinked: PRMetric[] = [];
                      for (const m of (selectedRepo === "__all__" ? allMetrics : allMetrics.filter((x) => x.repo === selectedRepo))) {
                        const tickets = prToTickets.get(m.id!);
                        if (!tickets?.length) {
                          unlinked.push(m);
                          continue;
                        }
                        const team = tickets[0].component ?? "No Component";
                        if (!teamStats.has(team)) teamStats.set(team, []);
                        teamStats.get(team)!.push(m);
                      }

                      const rows = Array.from(teamStats.entries()).sort((a, b) => b[1].length - a[1].length);
                      if (unlinked.length > 0) rows.push(["Unlinked", unlinked]);

                      return rows.map(([team, prs]) => {
                        const ct = prs.map((p) => p.cycleTimeHours).filter((h): h is number => h !== null);
                        const rt = prs.map((p) => p.timeToFirstReviewHours).filter((h): h is number => h !== null);
                        const avgSize = prs.length ? Math.round(prs.reduce((a, p) => a + p.additions + p.deletions, 0) / prs.length) : 0;
                        const aiPctTeam = prs.length ? Math.round((prs.filter((p) => p.aiAssisted).length / prs.length) * 100) : 0;
                        const isSelected = selectedTeam === team;

                        return (
                          <tr
                            key={team}
                            onClick={() => setSelectedTeam(isSelected ? "__all__" : team)}
                            style={{
                              cursor: team !== "Unlinked" ? "pointer" : "default",
                              borderBottom: `1px solid ${dk(darkMode, "rgba(255,255,255,0.04)", "rgba(0,0,0,0.04)")}`,
                              background: isSelected ? dk(darkMode, "rgba(94,106,210,0.12)", "rgba(94,106,210,0.06)") : "transparent",
                            }}
                          >
                            <td style={{ padding: "6px 8px", color: dk(darkMode, "rgba(255,255,255,0.85)", OS.text), fontWeight: 500 }}>{team}</td>
                            <td style={{ padding: "6px 8px", textAlign: "right", color: dk(darkMode, "rgba(255,255,255,0.7)", OS.secondary) }}>{prs.length}</td>
                            <td style={{ padding: "6px 8px", textAlign: "right", color: dk(darkMode, "rgba(255,255,255,0.7)", OS.secondary) }}>{fmtHours(ct.length ? ct.reduce((a, b) => a + b, 0) / ct.length : null)}</td>
                            <td style={{ padding: "6px 8px", textAlign: "right", color: dk(darkMode, "rgba(255,255,255,0.7)", OS.secondary) }}>{fmtHours(rt.length ? median(rt) : null)}</td>
                            <td style={{ padding: "6px 8px", textAlign: "right", color: dk(darkMode, "rgba(255,255,255,0.7)", OS.secondary) }}>{avgSize > 0 ? `±${avgSize}` : "—"}</td>
                            <td style={{ padding: "6px 8px", textAlign: "right", color: dk(darkMode, "rgba(255,255,255,0.7)", OS.secondary) }}>{aiPctTeam}%</td>
                          </tr>
                        );
                      });
                    })()}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ─── Work Type Distribution ─── */}
          {prJiraLinks.length > 0 && !noData && (
            <div
              style={{
                padding: "14px 16px",
                borderRadius: 10,
                border: cardBorder,
                background: cardBg,
              }}
            >
              <h3 style={sectionTitle}>Work Type Distribution</h3>
              {(() => {
                const typeCounts: Record<string, number> = {};
                let unlinkedCount = 0;
                for (const m of metrics) {
                  const tickets = prToTickets.get(m.id!);
                  if (!tickets?.length) {
                    unlinkedCount++;
                    continue;
                  }
                  const type = tickets[0].issueType;
                  typeCounts[type] = (typeCounts[type] ?? 0) + 1;
                }
                if (unlinkedCount > 0) typeCounts["Unlinked"] = unlinkedCount;

                const total = Object.values(typeCounts).reduce((a, b) => a + b, 0) || 1;
                const typeColors: Record<string, string> = {
                  Story: OS.blue, "New Feature": OS.blue,
                  Bug: OS.red, Task: OS.green,
                  "Sub-task": "#7C3AED", Epic: OS.warning,
                  Unlinked: dk(darkMode, "rgba(255,255,255,0.15)", OS.faint),
                };
                const entries = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);

                return (
                  <div>
                    {/* Stacked bar */}
                    <div style={{ display: "flex", height: 20, borderRadius: 4, overflow: "hidden", marginBottom: 10 }}>
                      {entries.map(([type, count]) => (
                        <div
                          key={type}
                          title={`${type}: ${count} (${Math.round((count / total) * 100)}%)`}
                          style={{
                            width: `${(count / total) * 100}%`,
                            background: typeColors[type] ?? OS.muted,
                            minWidth: count > 0 ? 2 : 0,
                          }}
                        />
                      ))}
                    </div>
                    {/* Legend */}
                    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                      {entries.map(([type, count]) => (
                        <div key={type} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <div style={{ width: 8, height: 8, borderRadius: 2, background: typeColors[type] ?? OS.muted }} />
                          <span style={{ fontSize: 11, color: dk(darkMode, "rgba(255,255,255,0.6)", OS.secondary) }}>
                            {type} ({count})
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* ─── Throughput by Team ─── */}
          {teams.length > 0 && !noData && (
            <div
              style={{
                padding: "14px 16px",
                borderRadius: 10,
                border: cardBorder,
                background: cardBg,
              }}
            >
              <h3 style={sectionTitle}>Throughput by Team (PRs merged / week)</h3>
              {(() => {
                // Build weekly team buckets
                const teamColorMap: Record<string, string> = {};
                const palette = [OS.blue, OS.green, OS.red, OS.warning, "#7C3AED", "#0891B2", "#DB2777", "#EA580C"];
                teams.forEach((t, i) => { teamColorMap[t] = palette[i % palette.length]; });
                teamColorMap["Other"] = dk(darkMode, "rgba(255,255,255,0.2)", OS.faint);

                type WeekTeam = Record<string, number>;
                const weekMap = new Map<string, WeekTeam>();

                for (const m of metrics) {
                  if (!m.mergedAt) continue;
                  const d = new Date(m.mergedAt);
                  const day = d.getDay();
                  const diff = (day + 6) % 7;
                  d.setDate(d.getDate() - diff);
                  const wk = d.toISOString().slice(0, 10);
                  if (!weekMap.has(wk)) weekMap.set(wk, {});
                  const bucket = weekMap.get(wk)!;

                  const tickets = prToTickets.get(m.id!);
                  const team = tickets?.[0]?.component ?? "Other";
                  bucket[team] = (bucket[team] ?? 0) + 1;
                }

                const weeks = Array.from(weekMap.entries())
                  .sort((a, b) => a[0].localeCompare(b[0]))
                  .slice(-Math.ceil(timeRange / 7));

                if (weeks.length === 0) return <div style={{ fontSize: 12, color: dk(darkMode, "rgba(255,255,255,0.3)", OS.muted) }}>Not enough data</div>;

                const maxStack = Math.max(...weeks.map(([, b]) => Object.values(b).reduce((a, c) => a + c, 0)), 1);
                const allTeamKeys = Array.from(new Set(weeks.flatMap(([, b]) => Object.keys(b))));

                const W = 360, H = 120;
                const PAD = { top: 8, right: 8, bottom: 24, left: 32 };
                const chartW = W - PAD.left - PAD.right;
                const chartH = H - PAD.top - PAD.bottom;
                const gap = chartW / weeks.length;
                const barW = Math.max(4, gap * 0.7);
                const textColor = dk(darkMode, "rgba(255,255,255,0.4)", OS.muted);

                return (
                  <div>
                    <svg width={W} height={H} style={{ overflow: "visible" }}>
                      {weeks.map(([wk, bucket], i) => {
                        const x = PAD.left + i * gap + gap / 2 - barW / 2;
                        let yOffset = 0;
                        const total = Object.values(bucket).reduce((a, c) => a + c, 0);
                        return (
                          <g key={wk}>
                            {allTeamKeys.map((team) => {
                              const count = bucket[team] ?? 0;
                              if (count === 0) return null;
                              const barH = (count / maxStack) * chartH;
                              const y = PAD.top + chartH - yOffset - barH;
                              yOffset += barH;
                              return (
                                <rect
                                  key={team}
                                  x={x}
                                  y={y}
                                  width={barW}
                                  height={Math.max(barH, 1)}
                                  rx={1}
                                  fill={teamColorMap[team] ?? OS.muted}
                                  opacity={0.85}
                                />
                              );
                            })}
                            <text x={x + barW / 2} y={H - 6} textAnchor="middle" fontSize={9} fill={textColor} fontFamily={OS.font}>
                              {weekLabel(new Date(wk + "T12:00:00"))}
                            </text>
                            <text x={x + barW / 2} y={PAD.top + chartH - yOffset - 3} textAnchor="middle" fontSize={9} fill={textColor} fontFamily={OS.font}>
                              {total}
                            </text>
                          </g>
                        );
                      })}
                    </svg>
                    {/* Legend */}
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 6 }}>
                      {allTeamKeys.map((team) => (
                        <div key={team} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <div style={{ width: 8, height: 8, borderRadius: 2, background: teamColorMap[team] ?? OS.muted }} />
                          <span style={{ fontSize: 10, color: dk(darkMode, "rgba(255,255,255,0.5)", OS.secondary) }}>{team}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* ─── Ticket Flow ─── */}
          {jiraTickets.length > 0 && (
            <div
              style={{
                padding: "14px 16px",
                borderRadius: 10,
                border: cardBorder,
                background: cardBg,
              }}
            >
              <h3 style={sectionTitle}>Ticket Flow</h3>
              {(() => {
                const filteredTickets = selectedTeam === "__all__"
                  ? jiraTickets
                  : jiraTickets.filter((t) => t.component === selectedTeam);

                const counts = { todo: 0, in_progress: 0, done: 0 };
                for (const t of filteredTickets) counts[t.statusCategory]++;
                const total = counts.todo + counts.in_progress + counts.done || 1;

                const bars = [
                  { label: "To Do", count: counts.todo, color: dk(darkMode, "rgba(255,255,255,0.2)", OS.faint) },
                  { label: "In Progress", count: counts.in_progress, color: OS.blue },
                  { label: "Done", count: counts.done, color: OS.green },
                ];

                return (
                  <div>
                    <div style={{ display: "flex", height: 20, borderRadius: 4, overflow: "hidden", marginBottom: 10 }}>
                      {bars.map((b) => (
                        <div
                          key={b.label}
                          title={`${b.label}: ${b.count}`}
                          style={{
                            width: `${(b.count / total) * 100}%`,
                            background: b.color,
                            minWidth: b.count > 0 ? 2 : 0,
                          }}
                        />
                      ))}
                    </div>
                    <div style={{ display: "flex", gap: 16 }}>
                      {bars.map((b) => (
                        <div key={b.label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <div style={{ width: 8, height: 8, borderRadius: 2, background: b.color }} />
                          <span style={{ fontSize: 11, color: dk(darkMode, "rgba(255,255,255,0.6)", OS.secondary) }}>
                            {b.label}: {b.count}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* ─── Copilot Section (only if org configured) ─── */}
          {githubOrg && latestCopilot && (
            <div
              style={{
                padding: "14px 16px",
                borderRadius: 10,
                border: cardBorder,
                background: cardBg,
              }}
            >
              <h3 style={sectionTitle}>
                Copilot —{" "}
                <span
                  style={{
                    fontWeight: 400,
                    fontSize: 11,
                    color: dk(darkMode, "rgba(255,255,255,0.3)", OS.muted),
                  }}
                >
                  {latestCopilot.date}
                </span>
              </h3>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <KPICard
                  label="Active Users"
                  value={String(latestCopilot.totalActiveUsers)}
                  dark={darkMode}
                />
                <KPICard
                  label="Engaged Users"
                  value={String(latestCopilot.totalEngagedUsers)}
                  dark={darkMode}
                />
                <KPICard
                  label="Chat Messages"
                  value={String(latestCopilot.totalChats)}
                  dark={darkMode}
                />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
