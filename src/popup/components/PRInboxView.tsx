import React, { useState, useEffect, useCallback, useMemo } from "react";
import { OS } from "@shared/tokens";
import { dk } from "../DarkModeContext";
import type { PRInboxItem } from "@shared/types";
import { DEMO_PR_INBOX } from "@shared/demo-data";

interface PRInboxViewProps {
  darkMode?: boolean;
  demoMode?: boolean;
}

// ─── Detail types (from service worker PR_INBOX_DETAIL response) ───

interface PRDetailData {
  detail: {
    body: string | null;
    state: string;
    draft: boolean;
    labels: Array<{ name: string; color: string }>;
    requested_reviewers: Array<{ login: string; avatar_url: string }>;
    requested_teams: Array<{ name: string; slug: string }>;
  };
  checks: Array<{ name: string; status: string; conclusion: string | null }>;
  status: { state: string; statuses: Array<{ context: string; state: string; description: string | null }> };
}

// ─── Helpers ───

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

function repoShortName(repo: string): string {
  const parts = repo.split("/");
  return parts.length > 1 ? parts[1] : repo;
}

/** Strip HTML comments, image tags, and common PR template boilerplate */
function cleanBody(raw: string): string {
  return raw
    .replace(/<!--[\s\S]*?-->/g, "")      // HTML comments
    .replace(/<img[^>]*>/gi, "")           // inline images
    .replace(/\[!\[.*?\]\(.*?\)\]\(.*?\)/g, "") // markdown image links
    .replace(/!\[.*?\]\(.*?\)/g, "")       // markdown images
    .replace(/^#+\s*(Checklist|Test Plan|Automated PR Environment|Frontend Proxy Environment|Risk)\b[\s\S]*?(?=^#|\z)/gm, "") // common template sections
    .replace(/\n{3,}/g, "\n\n")            // collapse blank runs
    .trim();
}

function ciSummary(data: PRDetailData): { passed: number; failed: number; pending: number; total: number } {
  let passed = 0, failed = 0, pending = 0;
  for (const c of data.checks) {
    if (c.conclusion === "success") passed++;
    else if (c.conclusion === "failure" || c.conclusion === "cancelled" || c.conclusion === "timed_out") failed++;
    else pending++;
  }
  for (const s of data.status.statuses) {
    if (s.state === "success") passed++;
    else if (s.state === "failure" || s.state === "error") failed++;
    else pending++;
  }
  return { passed, failed, pending, total: passed + failed + pending };
}

// ─── Spin keyframes ───

let spinInjected = false;
function ensureSpinKeyframes() {
  if (spinInjected) return;
  const style = document.createElement("style");
  style.textContent = `@keyframes pr-inbox-spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`;
  document.head.appendChild(style);
  spinInjected = true;
}

// ─── External link icon ───

function ExternalIcon({ size = 12, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 3H3v10h10V9" />
      <path d="M10 2h4v4" />
      <path d="M14 2L7 9" />
    </svg>
  );
}

// ─── Main Component ───

export function PRInboxView({ darkMode = false, demoMode = false }: PRInboxViewProps) {
  const [prs, setPrs] = useState<PRInboxItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<string | null>(null);
  const [activeLabel, setActiveLabel] = useState<string | null>(null);
  const [activeRepo, setActiveRepo] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [noToken, setNoToken] = useState(false);

  // Drawer state
  const [selectedPR, setSelectedPR] = useState<PRInboxItem | null>(null);
  const [drawerData, setDrawerData] = useState<PRDetailData | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerError, setDrawerError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => { ensureSpinKeyframes(); }, []);

  // Load cached data + fetch
  useEffect(() => {
    if (demoMode) {
      setPrs(DEMO_PR_INBOX);
      setLastFetched(new Date().toISOString());
      return;
    }

    chrome.storage.local.get(["prInboxCache", "githubToken"]).then((result) => {
      if (!result.githubToken) setNoToken(true);
      if (result.prInboxCache) {
        const cache = result.prInboxCache as { prs: PRInboxItem[]; fetchedAt: string };
        setPrs(cache.prs);
        setLastFetched(cache.fetchedAt);
      }
    });

    const onStorageChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== "local" || !changes.prInboxCache) return;
      const cache = changes.prInboxCache.newValue as { prs: PRInboxItem[]; fetchedAt: string; error?: string } | undefined;
      setLoading(false);
      if (cache?.error) {
        setError(cache.error);
      } else if (cache?.prs) {
        setPrs(cache.prs);
        setLastFetched(cache.fetchedAt);
        setError(null);
        setNoToken(false);
      }
    };
    chrome.storage.onChanged.addListener(onStorageChanged);

    setLoading(true);
    chrome.runtime.sendMessage({ type: "PR_INBOX_FETCH" }).catch(() => {
      setLoading(false);
      setError("Failed to fetch PRs");
    });

    return () => chrome.storage.onChanged.removeListener(onStorageChanged);
  }, [demoMode]);

  const handleRefresh = useCallback(() => {
    if (demoMode || loading) return;
    setLoading(true);
    setError(null);
    chrome.runtime.sendMessage({ type: "PR_INBOX_FETCH" }).catch(() => {
      setLoading(false);
      setError("Failed to fetch PRs");
    });
  }, [demoMode, loading]);

  // Open drawer for a PR
  const openDrawer = useCallback((pr: PRInboxItem) => {
    setSelectedPR(pr);
    setDrawerData(null);
    setDrawerError(null);
    setDrawerLoading(true);
    setDrawerOpen(true);

    if (demoMode) {
      setDrawerLoading(false);
      setDrawerData({
        detail: { body: "Demo PR description.\n\n- Fixed a bug\n- Added tests", state: "open", draft: pr.isDraft, labels: pr.labels, requested_reviewers: [{ login: "reviewer1", avatar_url: "" }], requested_teams: [{ name: "frontend", slug: "frontend" }] },
        checks: [{ name: "CI / build", status: "completed", conclusion: "success" }, { name: "CI / test", status: "completed", conclusion: "success" }, { name: "Deploy preview", status: "in_progress", conclusion: null }],
        status: { state: "pending", statuses: [] },
      });
      return;
    }

    chrome.runtime.sendMessage(
      { type: "PR_INBOX_DETAIL", repo: pr.repo, prNumber: pr.number },
      (response) => {
        setDrawerLoading(false);
        if (response?.error) {
          setDrawerError(response.error);
        } else if (response?.detail) {
          setDrawerData(response as PRDetailData);
        }
      },
    );
  }, [demoMode]);

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
    setTimeout(() => { setSelectedPR(null); setDrawerData(null); }, 250);
  }, []);

  // Filter data
  const allLabels = useMemo(() => {
    const map = new Map<string, { name: string; color: string; count: number }>();
    for (const pr of prs) {
      for (const label of pr.labels) {
        const existing = map.get(label.name);
        if (existing) existing.count++;
        else map.set(label.name, { ...label, count: 1 });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [prs]);

  const allRepos = useMemo(() => {
    const map = new Map<string, number>();
    for (const pr of prs) {
      map.set(pr.repo, (map.get(pr.repo) ?? 0) + 1);
    }
    return Array.from(map.entries()).map(([repo, count]) => ({ repo, count })).sort((a, b) => b.count - a.count);
  }, [prs]);

  const filtered = useMemo(() => {
    let list = prs;
    if (activeLabel) list = list.filter((pr) => pr.labels.some((l) => l.name === activeLabel));
    if (activeRepo) list = list.filter((pr) => pr.repo === activeRepo);
    return list;
  }, [prs, activeLabel, activeRepo]);

  const lastFetchedLabel = useMemo(() => lastFetched ? timeAgo(lastFetched) : null, [lastFetched]);

  // ─── Styles ───

  const bg = dk(darkMode, "#1a1a1e", OS.bg);
  const border = dk(darkMode, "#2a2a2e", OS.border);
  const muted = dk(darkMode, "#999", OS.muted);
  const faint = dk(darkMode, "#555", OS.faint);

  const chipStyle = (active: boolean, color?: string): React.CSSProperties => ({
    padding: "3px 8px", borderRadius: 10, fontSize: 11, fontWeight: active ? 600 : 400,
    fontFamily: OS.font, cursor: "pointer", border: "none",
    background: active ? (color ? `#${color}25` : dk(darkMode, "rgba(94,106,210,0.25)", OS.blueBg)) : dk(darkMode, "rgba(255,255,255,0.05)", "#f3f3f3"),
    color: active ? (color ? `#${color}` : dk(darkMode, "#a5adff", OS.blue)) : muted,
    transition: "background 0.15s, color 0.15s",
  });

  // ─── Empty states ───

  if (noToken && prs.length === 0) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%", fontFamily: OS.font, color: dk(darkMode, "#e0e0e0", OS.text), background: bg }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: 1, gap: 8, padding: 32, color: muted, fontSize: 13, textAlign: "center" }}>
          <span style={{ fontSize: 28, opacity: 0.4 }}>&#128279;</span>
          <span>Connect GitHub in Settings to see your PRs</span>
        </div>
      </div>
    );
  }

  const hasFilters = allLabels.length > 0 || allRepos.length > 1;
  const ci = drawerData ? ciSummary(drawerData) : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", fontFamily: OS.font, color: dk(darkMode, "#e0e0e0", OS.text), background: bg, position: "relative", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px 8px" }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>
          {prs.length > 0 ? `${prs.length} PR${prs.length === 1 ? "" : "s"}` : "PR Inbox"}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {lastFetchedLabel && <span style={{ fontSize: 11, color: faint }}>{lastFetchedLabel}</span>}
          <button onClick={handleRefresh} disabled={loading} style={{ background: "none", border: "none", cursor: loading ? "default" : "pointer", padding: 4, borderRadius: 4, display: "flex", alignItems: "center", color: dk(darkMode, "#888", OS.muted), animation: loading ? "pr-inbox-spin 1s linear infinite" : "none", opacity: loading ? 0.6 : 1 }} title="Refresh">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 1v5h5" /><path d="M3.51 10a5.5 5.5 0 1 0 1.12-5.5L1 8" />
            </svg>
          </button>
        </div>
      </div>

      {/* Filter bar */}
      {hasFilters && (
        <div style={{ display: "flex", gap: 5, padding: "6px 16px 8px", flexWrap: "wrap", borderBottom: `1px solid ${border}` }}>
          {allRepos.length > 1 && allRepos.map(({ repo, count }) => (
            <button key={repo} onClick={() => setActiveRepo(activeRepo === repo ? null : repo)} style={chipStyle(activeRepo === repo)}>
              {repoShortName(repo)} <span style={{ opacity: 0.6 }}>{count}</span>
            </button>
          ))}
          {allRepos.length > 1 && allLabels.length > 0 && (
            <span style={{ color: border, fontSize: 11, padding: "3px 2px" }}>|</span>
          )}
          {allLabels.slice(0, 8).map(({ name, color, count }) => (
            <button key={name} onClick={() => setActiveLabel(activeLabel === name ? null : name)} style={chipStyle(activeLabel === name, color)}>
              {name} <span style={{ opacity: 0.6 }}>{count}</span>
            </button>
          ))}
          {(activeLabel || activeRepo) && (
            <button onClick={() => { setActiveLabel(null); setActiveRepo(null); }} style={{ ...chipStyle(false), color: muted, fontStyle: "italic" }}>clear</button>
          )}
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div style={{ padding: "8px 16px", fontSize: 12, color: OS.red, background: dk(darkMode, "rgba(209,67,67,0.1)", "#fef0f0"), display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span>{error}</span>
          <button onClick={handleRefresh} style={{ background: "none", border: `1px solid ${OS.red}`, borderRadius: 4, color: OS.red, fontSize: 11, padding: "2px 8px", cursor: "pointer", fontFamily: OS.font }}>Retry</button>
        </div>
      )}

      {/* PR list */}
      <div style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}>
        {filtered.length === 0 && !loading && !error ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: 1, gap: 8, padding: 32, color: muted, fontSize: 13, textAlign: "center" }}>
            <span style={{ fontSize: 28, opacity: 0.3 }}>&#10003;</span>
            <span>{(activeLabel || activeRepo) ? "No PRs match this filter" : "Nothing needs your attention right now"}</span>
          </div>
        ) : (
          filtered.map((pr) => (
            <div
              key={`${pr.repo}-${pr.number}`}
              style={{
                display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 16px", cursor: "pointer",
                background: (selectedPR?.number === pr.number && selectedPR?.repo === pr.repo)
                  ? dk(darkMode, "rgba(94,106,210,0.12)", "rgba(94,106,210,0.06)")
                  : hoveredId === pr.id ? dk(darkMode, "rgba(255,255,255,0.04)", "rgba(0,0,0,0.02)") : "transparent",
                transition: "background 0.12s",
              }}
              onMouseEnter={() => setHoveredId(pr.id)}
              onMouseLeave={() => setHoveredId(null)}
              onClick={() => openDrawer(pr)}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
                  <span style={{ fontSize: 11, color: muted, fontWeight: 500 }}>
                    {repoShortName(pr.repo)}<span style={{ color: faint, fontWeight: 400 }}> #{pr.number}</span>
                  </span>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 11, color: faint, whiteSpace: "nowrap" }}>{timeAgo(pr.updatedAt)}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); chrome.tabs.create({ url: pr.html_url }); }}
                      title="Open in GitHub"
                      style={{ background: "none", border: "none", cursor: "pointer", padding: 2, display: "flex", alignItems: "center", color: faint, opacity: hoveredId === pr.id ? 1 : 0, transition: "opacity 0.15s" }}
                    >
                      <ExternalIcon size={11} />
                    </button>
                  </div>
                </div>
                <div title={pr.title} style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginBottom: 4 }}>
                  {pr.title}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <img src={pr.authorAvatar} alt={pr.author} width={16} height={16} style={{ borderRadius: "50%", flexShrink: 0 }} />
                    <span style={{ fontSize: 11, color: muted }}>{pr.author}</span>
                  </div>
                  {pr.isDraft && (
                    <span style={{ fontSize: 10, fontWeight: 500, padding: "1px 6px", borderRadius: 8, color: faint, background: dk(darkMode, "rgba(255,255,255,0.06)", "#f0f0f0") }}>Draft</span>
                  )}
                  {pr.labels.map((label) => (
                    <span key={label.name} onClick={(e) => { e.stopPropagation(); setActiveLabel(activeLabel === label.name ? null : label.name); }}
                      style={{ fontSize: 10, padding: "1px 6px", borderRadius: 8, color: `#${label.color}`, background: `#${label.color}18`, fontWeight: 500, cursor: "pointer" }}>
                      {label.name}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ))
        )}
        {loading && prs.length === 0 && (
          <div style={{ padding: "24px 16px", textAlign: "center" }}>
            <span style={{ fontSize: 12, color: muted }}>Loading PRs...</span>
          </div>
        )}
      </div>

      {/* ─── Drawer overlay ─── */}
      {selectedPR && (
        <>
          {/* Backdrop */}
          <div
            onClick={closeDrawer}
            style={{
              position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)",
              opacity: drawerOpen ? 1 : 0, transition: "opacity 0.25s ease",
              zIndex: 100,
            }}
          />
          {/* Drawer panel */}
          <div style={{
            position: "fixed", top: 0, right: 0, bottom: 0, width: "70%", maxWidth: 420, minWidth: 280,
            background: dk(darkMode, "#222226", OS.white), borderLeft: `1px solid ${border}`,
            boxShadow: "-4px 0 24px rgba(0,0,0,0.15)",
            transform: drawerOpen ? "translateX(0)" : "translateX(100%)",
            transition: "transform 0.25s cubic-bezier(0.32, 0.72, 0, 1)",
            zIndex: 101, display: "flex", flexDirection: "column", overflow: "hidden",
          }}>
            {/* Drawer header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: `1px solid ${border}`, flexShrink: 0 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: muted }}>
                {repoShortName(selectedPR.repo)} #{selectedPR.number}
              </span>
              <button onClick={closeDrawer} style={{ background: "none", border: "none", cursor: "pointer", padding: 4, fontSize: 16, lineHeight: 1, color: muted }}>&times;</button>
            </div>

            {/* Drawer body */}
            <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
              {/* Title */}
              <div style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.35, marginBottom: 12 }}>
                {selectedPR.title}
              </div>

              {/* State + author row */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                {/* State badge */}
                <span style={{
                  fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 10,
                  color: drawerData?.detail.draft ? faint : (drawerData?.detail.state === "open" ? OS.green : OS.red),
                  background: drawerData?.detail.draft ? dk(darkMode, "rgba(255,255,255,0.06)", "#f0f0f0") : (drawerData?.detail.state === "open" ? OS.green + "18" : OS.red + "18"),
                }}>
                  {drawerData?.detail.draft ? "Draft" : drawerData?.detail.state ?? "..."}
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <img src={selectedPR.authorAvatar} alt="" width={16} height={16} style={{ borderRadius: "50%" }} />
                  <span style={{ fontSize: 12, color: muted }}>{selectedPR.author}</span>
                </div>
                <span style={{ fontSize: 11, color: faint }}>{timeAgo(selectedPR.updatedAt)}</span>
              </div>

              {/* CI Status */}
              {ci && ci.total > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: muted, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>CI Status</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                    {ci.passed > 0 && <span style={{ fontSize: 11, color: OS.green }}>&#10003; {ci.passed} passed</span>}
                    {ci.failed > 0 && <span style={{ fontSize: 11, color: OS.red }}>&#10007; {ci.failed} failed</span>}
                    {ci.pending > 0 && <span style={{ fontSize: 11, color: dk(darkMode, "#c9a227", OS.warning) }}>&#9679; {ci.pending} pending</span>}
                  </div>
                  {/* Individual check names for failures */}
                  {drawerData && [...drawerData.checks.filter(c => c.conclusion === "failure"), ...drawerData.status.statuses.filter(s => s.state === "failure" || s.state === "error")].slice(0, 5).map((item, i) => (
                    <div key={i} style={{ fontSize: 11, color: OS.red, paddingLeft: 8, marginTop: 2 }}>
                      {"name" in item ? item.name : ("context" in item ? (item as { context: string }).context : "")}
                    </div>
                  ))}
                </div>
              )}

              {/* Reviewers */}
              {drawerData && (drawerData.detail.requested_reviewers.length > 0 || drawerData.detail.requested_teams.length > 0) && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: muted, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>Reviewers</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {drawerData.detail.requested_reviewers.map((r) => (
                      <div key={r.login} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}>
                        <img src={r.avatar_url} alt="" width={18} height={18} style={{ borderRadius: "50%" }} />
                        <span>{r.login}</span>
                      </div>
                    ))}
                    {drawerData.detail.requested_teams.map((t) => (
                      <span key={t.slug} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: dk(darkMode, "rgba(255,255,255,0.06)", "#f0f0f0"), color: muted }}>
                        {t.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Labels */}
              {drawerData && drawerData.detail.labels.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: muted, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>Labels</div>
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                    {drawerData.detail.labels.map((l) => (
                      <span key={l.name} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, color: `#${l.color}`, background: `#${l.color}18`, fontWeight: 500 }}>
                        {l.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Description */}
              {drawerData?.detail.body && cleanBody(drawerData.detail.body).length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: muted, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>Description</div>
                  <div style={{
                    fontSize: 12, lineHeight: 1.5, color: dk(darkMode, "#bbb", OS.secondary),
                    whiteSpace: "pre-wrap", wordBreak: "break-word",
                    maxHeight: 300, overflowY: "auto",
                    padding: 10, borderRadius: 6,
                    background: dk(darkMode, "rgba(255,255,255,0.03)", "#f8f8f8"),
                  }}>
                    {(() => { const cleaned = cleanBody(drawerData.detail.body ?? ""); return cleaned.slice(0, 2000) + (cleaned.length > 2000 ? "…" : ""); })()}
                  </div>
                </div>
              )}

              {/* Loading state */}
              {drawerLoading && (
                <div style={{ textAlign: "center", padding: 24, color: muted, fontSize: 12 }}>Loading...</div>
              )}
              {drawerError && (
                <div style={{ padding: 12, fontSize: 12, color: OS.red }}>{drawerError}</div>
              )}
            </div>

            {/* Drawer footer — Open in GitHub */}
            <div style={{ flexShrink: 0, padding: "10px 16px", borderTop: `1px solid ${border}` }}>
              <button
                onClick={() => chrome.tabs.create({ url: selectedPR.html_url })}
                style={{
                  width: "100%", padding: "8px 0", borderRadius: 6, border: `1px solid ${border}`,
                  background: dk(darkMode, "rgba(255,255,255,0.06)", OS.white),
                  color: dk(darkMode, "#ccc", OS.text), fontSize: 12, fontWeight: 500, fontFamily: OS.font,
                  cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                }}
              >
                Open in GitHub <ExternalIcon size={12} />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
