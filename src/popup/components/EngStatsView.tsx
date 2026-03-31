/**
 * Eng Stats Dashboard — orchestrator component.
 * Holds shared state, DB queries, sync logic, and tab routing.
 * Each tab is a separate component that computes its own data.
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@shared/db";
import { OS } from "@shared/tokens";
import type { PRMetric, PRReview, JiraTicket, PRJiraLink, OpenPRSnapshot } from "@shared/types";
import {
  dk, daysAgoISO, isWeekday,
  type EngStatsConfig, type SectionId, type KpiId, type TeamColumnId,
} from "./eng-stats/shared";
import { KPICard, CycleTimeChart, AIAdoptionChart, PRSizeChart, PRFlowChart } from "./eng-stats/charts";
import { SummaryTab } from "./eng-stats/SummaryTab";
import { CycleTimeTab } from "./eng-stats/CycleTimeTab";
import { AIAdoptionTab } from "./eng-stats/AIAdoptionTab";
import { AIReviewsTab } from "./eng-stats/AIReviewsTab";
import { TeamsTab } from "./eng-stats/TeamsTab";

// ─── Sub-tab types ───
type EngStatsTab = "Summary" | "Cycle Time" | "AI Adoption" | "AI Reviews" | "Teams";
const ENG_STATS_TABS: EngStatsTab[] = ["Summary", "Cycle Time", "AI Adoption", "AI Reviews", "Teams"];

// ─── Config defaults ───
const DEFAULT_CONFIG: EngStatsConfig = {
  visibleSections: ["kpis", "cycleTime", "aiAdoption", "prSize", "toolUsage", "projection"],
  kpiOrder: ["cycletime", "medreview", "prsmerged", "aiassisted", "leadtime"],
  kpiDisplay: {
    cycletime: { delta: true, sparkline: true, subtitle: true },
    medreview: { delta: true, sparkline: true, subtitle: true },
    prsmerged: { delta: true, sparkline: true, subtitle: true },
    aiassisted: { delta: true, sparkline: true, subtitle: true },
    leadtime: { delta: true, sparkline: true, subtitle: true },
  },
  teamColumns: ["prs", "cycle", "medReview", "avgLines", "ai", "trend"],
};

function useEngStatsConfig() {
  const [config, setConfig] = useState<EngStatsConfig>(DEFAULT_CONFIG);

  useEffect(() => {
    chrome.storage.local.get("engStatsConfig").then((r) => {
      if (r.engStatsConfig) {
        setConfig({ ...DEFAULT_CONFIG, ...(r.engStatsConfig as Partial<EngStatsConfig>) });
      }
    });
  }, []);

  const update = useCallback((patch: Partial<EngStatsConfig>) => {
    setConfig((prev) => {
      const next = { ...prev, ...patch };
      chrome.storage.local.set({ engStatsConfig: next });
      return next;
    });
  }, []);

  return { config, updateConfig: update };
}

// ─── Main EngStatsView ───

interface EngStatsViewProps {
  darkMode?: boolean;
}

export function EngStatsView({ darkMode = false }: EngStatsViewProps) {
  const [selectedRepo, setSelectedRepo] = useState<string>("__all__");
  const [timeRange, setTimeRange] = useState<30 | 60 | 90 | 180 | 360>(30);
  const [syncing, setSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [repos, setRepos] = useState<string[]>([]);
  const [githubOrg, setGithubOrg] = useState<string>("");
  const [syncError, setSyncError] = useState<string | null>(null);
  const [selectedTeam, setSelectedTeam] = useState<string>("__all__");
  const [selectedType, setSelectedType] = useState<string>("__all__");
  const [jiraSyncing, setJiraSyncing] = useState(false);
  const [jiraSyncProgress, setJiraSyncProgress] = useState<{
    phase: string;
    current: number;
    total: number;
  } | null>(null);

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
  const [queryKey, setQueryKey] = useState(0);

  // ─── Live DB queries ───

  const allMetrics = useLiveQuery(
    () =>
      db.pr_metrics
        .where("mergedAt")
        .aboveOrEqual(since)
        .toArray()
        .then((prs) => prs.filter((p) => p.mergedAt && isWeekday(p.mergedAt)))
        .catch(() => []),
    [since, queryKey],
    [] as PRMetric[],
  );

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
        .then((rows) => rows.filter((r) => isWeekday(r.date)))
        .catch(() => []),
    [since],
    [],
  );

  // PR-Jira links — scoped to PR IDs currently in view
  const prMetricIds = useMemo(
    () => allMetrics.map((m) => m.id!).filter((id) => id != null),
    [allMetrics],
  );
  const prJiraLinks = useLiveQuery(
    async () => {
      if (prMetricIds.length === 0) return [] as PRJiraLink[];
      return db.pr_jira_links.where("prMetricId").anyOf(prMetricIds).toArray();
    },
    [prMetricIds, queryKey],
    [] as PRJiraLink[],
  );

  // Jira tickets — only those referenced by visible PR links
  const linkedTicketKeys = useMemo(
    () => [...new Set(prJiraLinks.map((l) => l.jiraTicketKey))],
    [prJiraLinks],
  );
  const jiraTickets = useLiveQuery(
    async () => {
      if (linkedTicketKeys.length === 0) return [] as JiraTicket[];
      return db.jira_tickets.where("key").anyOf(linkedTicketKeys).toArray();
    },
    [linkedTicketKeys, queryKey],
    [] as JiraTicket[],
  );

  // Open PR snapshots (for backlog projection — fetch enough for longest time range)
  const openSnapshots = useLiveQuery(
    () =>
      db.open_pr_snapshots
        .where("snapshotAt")
        .aboveOrEqual(daysAgoISO(Math.max(timeRange, 90)))
        .toArray()
        .catch(() => []),
    [queryKey, timeRange],
    [] as OpenPRSnapshot[],
  );

  // PR reviews for collaboration scoring
  const prReviews = useLiveQuery(
    () =>
      db.pr_reviews
        .where("submittedAt")
        .aboveOrEqual(since)
        .toArray()
        .catch(() => []),
    [since, queryKey],
    [] as PRReview[],
  );

  // Open PR created dates from chrome.storage (set during sync)
  const [openPRCreatedDates, setOpenPRCreatedDates] = useState<Record<string, string[]>>({});
  useEffect(() => {
    chrome.storage.local.get("openPRCreatedDates").then((r) => {
      if (r.openPRCreatedDates) setOpenPRCreatedDates(r.openPRCreatedDates as Record<string, string[]>);
    });
  }, []);

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
    let filtered =
      selectedRepo === "__all__"
        ? allMetrics
        : allMetrics.filter((m) => m.repo === selectedRepo);

    if (selectedTeam !== "__all__") {
      filtered = filtered.filter((m) => {
        const tickets = prToTickets.get(m.id!);
        return tickets?.some((t) => t.component === selectedTeam);
      });
    }

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

  // Copilot summary
  const latestCopilot =
    copilotMetrics.length > 0
      ? copilotMetrics.sort((a, b) => b.date.localeCompare(a.date))[0]
      : null;

  // ─── Manual sync ───
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [syncPhase, setSyncPhase] = useState<string>("");

  const ghSyncResolveRef = React.useRef<
    ((result: { synced?: number; total?: number; errors?: string[]; error?: string }) => void) | null
  >(null);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    setSyncError(null);
    setSyncResult(null);
    setJiraSyncProgress(null);
    const parts: string[] = [];
    try {
      const storageSnap = await chrome.storage.local.get([
        "githubLastSynced",
        "jiraToken",
        "jiraEmail",
      ]);
      const ghLastSynced = storageSnap.githubLastSynced as string | undefined;
      const ghSyncedRecently =
        ghLastSynced &&
        Date.now() - new Date(ghLastSynced).getTime() < 60 * 60 * 1000;

      let ghMsg: string | null = null;
      if (ghSyncedRecently) {
        ghMsg = "GitHub up to date";
        setSyncPhase("Skipping GitHub (recent)…");
      } else {
        setSyncPhase("Starting GitHub sync…");

        const ghResult = await new Promise<{
          synced?: number;
          total?: number;
          errors?: string[];
          error?: string;
        }>((resolve) => {
          ghSyncResolveRef.current = resolve;
          chrome.runtime.sendMessage({ type: "GITHUB_SYNC" }).catch(() => {});
        });

        const ghErrors = ghResult.errors;
        const ghError = ghResult.error;
        if (ghErrors?.length)
          parts.push(`GitHub: ${ghErrors.join(", ")}`);
        else if (ghError) parts.push(`GitHub: ${ghError}`);

        const ghSynced = ghResult.synced;
        const ghTotal = ghResult.total;
        ghMsg =
          ghSynced != null && ghSynced > 0
            ? `${ghSynced} PRs`
            : ghTotal && ghTotal > 0
              ? `${ghTotal} PRs (up to date)`
              : null;
      }

      let jiraMsg: string | null = null;
      if (storageSnap.jiraToken && storageSnap.jiraEmail) {
        setSyncPhase("Jira tickets…");
        const jiraResp = await chrome.runtime.sendMessage({
          type: "JIRA_SYNC",
        });

        if (jiraResp) {
          const jErrors = jiraResp.errors as string[] | undefined;
          const jError = jiraResp.error as string | undefined;
          if (jErrors?.length)
            parts.push(`Jira: ${jErrors.join(", ")}`);
          else if (jError) parts.push(`Jira: ${jError}`);

          const jSynced = jiraResp.synced as number | undefined;
          const jLinked = jiraResp.linked as number | undefined;
          jiraMsg =
            [
              jSynced ? `${jSynced} tickets` : null,
              jLinked ? `${jLinked} linked` : null,
            ]
              .filter(Boolean)
              .join(", ") || null;
        }
        setJiraSyncProgress(null);
      }

      setSyncResult(
        [ghMsg, jiraMsg].filter(Boolean).join(" · ") || "Up to date",
      );
      if (parts.length) setSyncError(parts.join(" | "));

      const r = await chrome.storage.local.get([
        "githubLastSynced",
        "jiraLastSynced",
      ]);
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

  // Listen for sync progress messages
  useEffect(() => {
    const listener = (message: {
      type?: string;
      phase?: string;
      current?: number;
      total?: number;
      repo?: string;
      repoIndex?: number;
      repoCount?: number;
    }) => {
      if (message.type === "JIRA_SYNC_PROGRESS") {
        setJiraSyncProgress({
          phase: message.phase ?? "tickets",
          current: message.current ?? 0,
          total: message.total ?? 0,
        });
      } else if (message.type === "GITHUB_SYNC_PROGRESS") {
        const shortRepo = message.repo?.split("/")[1] ?? message.repo ?? "";
        const repoTag = message.repoCount && message.repoCount > 1
          ? ` (${message.repoIndex}/${message.repoCount})`
          : "";
        if (message.phase === "fetch") {
          setSyncPhase(`Scanning ${shortRepo}${repoTag}…`);
        } else {
          setSyncPhase(`Enriching ${message.current}/${message.total} PRs · ${shortRepo}${repoTag}`);
        }
      } else if (message.type === "GITHUB_SYNC_COMPLETE") {
        if (ghSyncResolveRef.current) {
          ghSyncResolveRef.current(message as Record<string, unknown>);
          ghSyncResolveRef.current = null;
        }
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  // ─── Sub-tabs + customization state ───
  const [activeTab, setActiveTab] = useState<EngStatsTab>("Summary");
  const { config, updateConfig } = useEngStatsConfig();
  const [showCustomize, setShowCustomize] = useState(false);
  const customizeRef = useRef<HTMLDivElement>(null);

  // Close customize popover on outside click
  useEffect(() => {
    if (!showCustomize) return;
    const handler = (e: MouseEvent) => {
      if (customizeRef.current && !customizeRef.current.contains(e.target as Node)) {
        setShowCustomize(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showCustomize]);

  // ─── KPI card reorder helpers ───
  const moveKpi = useCallback((id: KpiId, dir: -1 | 1) => {
    updateConfig({
      kpiOrder: (() => {
        const order = [...config.kpiOrder];
        const idx = order.indexOf(id);
        if (idx < 0) return order;
        const newIdx = idx + dir;
        if (newIdx < 0 || newIdx >= order.length) return order;
        [order[idx], order[newIdx]] = [order[newIdx], order[idx]];
        return order;
      })(),
    });
  }, [config.kpiOrder, updateConfig]);

  // ─── Section visibility helper ───
  const sectionVisible = useCallback((id: SectionId) => config.visibleSections.includes(id), [config.visibleSections]);
  const toggleSection = useCallback((id: SectionId) => {
    const current = config.visibleSections;
    const next = current.includes(id) ? current.filter((s) => s !== id) : [...current, id];
    updateConfig({ visibleSections: next });
  }, [config.visibleSections, updateConfig]);

  // ─── Styles ───
  const cardBg = dk(darkMode, "#1c1c22", OS.white);
  const cardBorder = `1px solid ${dk(darkMode, "rgba(255,255,255,0.08)", OS.border)}`;
  const sectionTitle: React.CSSProperties = {
    fontSize: 13,
    fontWeight: 600,
    color: dk(darkMode, "rgba(255,255,255,0.7)", OS.secondary),
    fontFamily: OS.font,
    margin: 0,
    marginBottom: 12,
  };
  const subLabel: React.CSSProperties = {
    fontSize: 10,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    fontFamily: OS.mono,
    color: dk(darkMode, "rgba(255,255,255,0.35)", OS.muted),
    margin: 0,
    marginBottom: 8,
  };
  const subTabStyle = (active: boolean): React.CSSProperties => ({
    background: active ? dk(darkMode, "rgba(255,255,255,0.08)", OS.blue) : "transparent",
    color: active ? dk(darkMode, "#fff", "#fff") : dk(darkMode, "rgba(255,255,255,0.4)", OS.muted),
    border: "none",
    borderRadius: 4,
    padding: "5px 12px",
    fontSize: 11,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: OS.font,
  });

  const noData = allMetrics.length === 0;

  // ─── Shared tab props ───
  const tabProps = {
    darkMode,
    metrics,
    allMetrics,
    timeRange,
    selectedRepo,
    prToTickets,
  };

  return (
    <div
      style={{
        padding: "16px",
        fontFamily: OS.font,
        color: dk(darkMode, "#fff", OS.text),
        display: "flex",
        flexDirection: "column",
        gap: 14,
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
              <option key={t} value={t}>
                {t}
              </option>
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
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        )}

        {/* Time range toggle */}
        <div style={{ display: "flex", gap: 2, marginLeft: "auto" }}>
          {([30, 60, 90, 180, 360] as const).map((d) => (
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
                fontFamily: OS.mono,
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
            fontFamily: OS.mono,
            opacity: syncing ? 0.6 : 1,
          }}
        >
          {syncing ? syncPhase || "Syncing…" : "Sync"}
        </button>

        {/* Compact sync status */}
        {lastSynced && !syncing && (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: OS.green,
                flexShrink: 0,
              }}
            />
            <span
              style={{
                fontSize: 11,
                fontFamily: OS.mono,
                color: dk(darkMode, "rgba(255,255,255,0.3)", OS.muted),
              }}
            >
              Synced{" "}
              {new Date(lastSynced).toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
              })}{" "}
              · {totalInDB} PRs
            </span>
          </div>
        )}
      </div>

      {/* Sync error */}
      {syncError && (
        <div
          style={{
            fontSize: 11,
            color: OS.red,
            background: "rgba(209,67,67,0.08)",
            border: `1px solid rgba(209,67,67,0.2)`,
            borderRadius: 6,
            padding: "6px 10px",
            fontFamily: OS.mono,
          }}
        >
          Sync error: {syncError}
        </div>
      )}

      {/* Jira sync progress */}
      {jiraSyncProgress && jiraSyncProgress.total > 0 && (
        <div>
          <div
            style={{
              fontSize: 11,
              color: dk(darkMode, "rgba(255,255,255,0.4)", OS.muted),
              fontFamily: OS.mono,
              marginBottom: 4,
            }}
          >
            {jiraSyncProgress.phase === "tickets"
              ? "Syncing Jira"
              : "Linking PRs to Jira"}
            … {jiraSyncProgress.current}/{jiraSyncProgress.total}
          </div>
          <div
            style={{
              height: 3,
              borderRadius: 2,
              background: dk(darkMode, "rgba(255,255,255,0.08)", OS.border),
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${Math.round((jiraSyncProgress.current / jiraSyncProgress.total) * 100)}%`,
                background: OS.blue,
                borderRadius: 2,
                transition: "width 0.3s",
              }}
            />
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

      {/* ─── Sub-tab Navigation + Customize ─── */}
      {repos.length > 0 && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{
              display: "flex", gap: 2,
              background: dk(darkMode, "rgba(255,255,255,0.03)", OS.bg),
              borderRadius: 6, padding: 3,
            }}>
              {ENG_STATS_TABS.map((tab) => (
                <button key={tab} onClick={() => setActiveTab(tab)} style={subTabStyle(activeTab === tab)}>
                  {tab}
                </button>
              ))}
            </div>
            <div style={{ marginLeft: "auto", position: "relative" }} ref={customizeRef}>
              <button
                onClick={() => setShowCustomize((p) => !p)}
                style={{
                  background: "transparent", border: "none", cursor: "pointer",
                  fontSize: 14, padding: "4px 8px", borderRadius: 4, opacity: 0.5,
                  color: dk(darkMode, "#fff", OS.text),
                }}
                title="Customize dashboard"
              >
                ⚙
              </button>
              {/* ─── Customize Popover ─── */}
              {showCustomize && (
                <div style={{
                  position: "absolute", top: "100%", right: 0, marginTop: 4,
                  width: 280, maxHeight: 420, overflowY: "auto",
                  background: dk(darkMode, "#1c1c22", OS.white),
                  border: cardBorder, borderRadius: 8, padding: 12,
                  boxShadow: "0 4px 16px rgba(0,0,0,0.2)", zIndex: 100,
                }}>
                  <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 10, color: dk(darkMode, "rgba(255,255,255,0.7)", OS.secondary) }}>
                    Customize Dashboard
                  </div>

                  {/* Section visibility */}
                  <div style={{ marginBottom: 12 }}>
                    <div style={subLabel}>Show / Hide Sections</div>
                    {([
                      ["kpis", "KPI Cards"],
                      ["cycleTime", "Cycle Time Chart"],
                      ["aiAdoption", "AI Adoption Chart"],
                      ["prSize", "PR Size Distribution"],
                      ["toolUsage", "Tool Usage"],
                    ] as [SectionId, string][]).map(([id, label]) => (
                      <label key={id} style={{
                        display: "flex", alignItems: "center", gap: 8, padding: "3px 0",
                        fontSize: 11, color: dk(darkMode, "rgba(255,255,255,0.7)", OS.secondary), cursor: "pointer",
                      }}>
                        <input type="checkbox" checked={sectionVisible(id)} onChange={() => toggleSection(id)}
                          style={{ accentColor: OS.blue }} />
                        {label}
                      </label>
                    ))}
                  </div>

                  {/* KPI card order */}
                  <div style={{ marginBottom: 12 }}>
                    <div style={subLabel}>KPI Card Order</div>
                    {config.kpiOrder.map((id, idx) => {
                      const names: Record<KpiId, string> = {
                        cycletime: "Avg Cycle Time", medreview: "Med. Review",
                        prsmerged: "PRs Merged", aiassisted: "AI-Assisted", leadtime: "Avg Lead Time",
                      };
                      return (
                        <div key={id} style={{
                          display: "flex", alignItems: "center", gap: 6, padding: "2px 0",
                          fontSize: 11, color: dk(darkMode, "rgba(255,255,255,0.7)", OS.secondary),
                        }}>
                          <button onClick={() => moveKpi(id, -1)} disabled={idx === 0}
                            style={{ background: "transparent", border: "none", cursor: idx === 0 ? "default" : "pointer", fontSize: 10, opacity: idx === 0 ? 0.2 : 0.6, color: dk(darkMode, "#fff", OS.text), padding: "0 2px" }}>▲</button>
                          <button onClick={() => moveKpi(id, 1)} disabled={idx === config.kpiOrder.length - 1}
                            style={{ background: "transparent", border: "none", cursor: idx === config.kpiOrder.length - 1 ? "default" : "pointer", fontSize: 10, opacity: idx === config.kpiOrder.length - 1 ? 0.2 : 0.6, color: dk(darkMode, "#fff", OS.text), padding: "0 2px" }}>▼</button>
                          <span>{names[id]}</span>
                        </div>
                      );
                    })}
                  </div>

                  {/* KPI display toggles */}
                  <div style={{ marginBottom: 12 }}>
                    <div style={subLabel}>KPI Card Elements</div>
                    {(["delta", "sparkline", "subtitle"] as const).map((key) => (
                      <label key={key} style={{
                        display: "flex", alignItems: "center", gap: 8, padding: "3px 0",
                        fontSize: 11, color: dk(darkMode, "rgba(255,255,255,0.7)", OS.secondary), cursor: "pointer",
                      }}>
                        <input type="checkbox"
                          checked={Object.values(config.kpiDisplay).every((d) => d[key])}
                          onChange={() => {
                            const allOn = Object.values(config.kpiDisplay).every((d) => d[key]);
                            const next = { ...config.kpiDisplay };
                            for (const k of Object.keys(next) as KpiId[]) {
                              next[k] = { ...next[k], [key]: !allOn };
                            }
                            updateConfig({ kpiDisplay: next });
                          }}
                          style={{ accentColor: OS.blue }}
                        />
                        Show {key === "delta" ? "% change" : key}
                      </label>
                    ))}
                  </div>

                  {/* Team table columns */}
                  <div>
                    <div style={subLabel}>Team Table Columns</div>
                    {([
                      ["prs", "PRs"], ["cycle", "Cycle"],
                      ["medReview", "Med Review"], ["avgLines", "Δ Lines"],
                      ["ai", "AI %"], ["trend", "Trend"],
                    ] as [TeamColumnId, string][]).map(([id, label]) => (
                      <label key={id} style={{
                        display: "flex", alignItems: "center", gap: 8, padding: "3px 0",
                        fontSize: 11, color: dk(darkMode, "rgba(255,255,255,0.7)", OS.secondary), cursor: "pointer",
                      }}>
                        <input type="checkbox"
                          checked={config.teamColumns.includes(id)}
                          onChange={() => {
                            const cols = config.teamColumns.includes(id)
                              ? config.teamColumns.filter((c) => c !== id)
                              : [...config.teamColumns, id];
                            updateConfig({ teamColumns: cols });
                          }}
                          style={{ accentColor: OS.blue }}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
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
              No PR data for this period. Click <strong>Sync</strong> to fetch from GitHub.
            </div>
          )}

          {/* ─── Tab Content ─── */}
          {activeTab === "Summary" && (
            <SummaryTab
              {...tabProps}
              config={config}
              sectionVisible={sectionVisible}
              openSnapshots={openSnapshots}
              openPRCreatedDates={openPRCreatedDates}
              CycleTimeChart={CycleTimeChart}
              AIAdoptionChart={AIAdoptionChart}
              PRSizeChart={PRSizeChart}
              PRFlowChart={PRFlowChart}
            />
          )}

          {activeTab === "Cycle Time" && !noData && (
            <CycleTimeTab {...tabProps} reviews={prReviews} CycleTimeChart={CycleTimeChart} />
          )}

          {activeTab === "AI Adoption" && !noData && (
            <AIAdoptionTab {...tabProps} AIAdoptionChart={AIAdoptionChart} copilotMetrics={copilotMetrics} />
          )}

          {activeTab === "AI Reviews" && (
            <AIReviewsTab
              {...tabProps}
              since={since}
              queryKey={queryKey}
              selectedTeam={selectedTeam}
            />
          )}

          {activeTab === "Teams" && !noData && (
            <TeamsTab {...tabProps} config={config} />
          )}

          {/* ─── Copilot Section (only if org configured, hidden on AI Adoption tab) ─── */}
          {githubOrg && latestCopilot && activeTab !== "AI Adoption" && (
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
                <span style={{ fontWeight: 400, fontSize: 11, color: dk(darkMode, "rgba(255,255,255,0.3)", OS.muted) }}>
                  {latestCopilot.date}
                </span>
              </h3>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <KPICard label="Active Users" value={String(latestCopilot.totalActiveUsers)} dark={darkMode} />
                <KPICard label="Engaged Users" value={String(latestCopilot.totalEngagedUsers)} dark={darkMode} />
                <KPICard label="Chat Messages" value={String(latestCopilot.totalChats)} dark={darkMode} />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
