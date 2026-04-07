import React, { useState, useEffect, useCallback, useMemo } from "react";
import { OS } from "@shared/tokens";
import { dk } from "../DarkModeContext";
import type { PRInboxItem } from "@shared/types";
import { DEMO_PR_INBOX } from "@shared/demo-data";

interface PRInboxViewProps {
  darkMode?: boolean;
  demoMode?: boolean;
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

// ─── Spin keyframes (injected once) ───

let spinInjected = false;
function ensureSpinKeyframes() {
  if (spinInjected) return;
  const style = document.createElement("style");
  style.textContent = `@keyframes pr-inbox-spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`;
  document.head.appendChild(style);
  spinInjected = true;
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

  // Collect all unique labels and repos for filter pills
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
    return Array.from(map.entries())
      .map(([repo, count]) => ({ repo, count }))
      .sort((a, b) => b.count - a.count);
  }, [prs]);

  const filtered = useMemo(() => {
    let list = prs;
    if (activeLabel) list = list.filter((pr) => pr.labels.some((l) => l.name === activeLabel));
    if (activeRepo) list = list.filter((pr) => pr.repo === activeRepo);
    return list;
  }, [prs, activeLabel, activeRepo]);

  const lastFetchedLabel = useMemo(() => {
    if (!lastFetched) return null;
    return timeAgo(lastFetched);
  }, [lastFetched]);

  // ─── Styles ───

  const containerStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    fontFamily: OS.font,
    color: dk(darkMode, "#e0e0e0", OS.text),
    background: dk(darkMode, "#1a1a1e", OS.bg),
  };

  const headerStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 16px 8px",
  };

  const filterBarStyle: React.CSSProperties = {
    display: "flex",
    gap: 5,
    padding: "6px 16px 8px",
    flexWrap: "wrap",
    borderBottom: `1px solid ${dk(darkMode, "#2a2a2e", OS.border)}`,
  };

  const chipStyle = (active: boolean, color?: string): React.CSSProperties => ({
    padding: "3px 8px",
    borderRadius: 10,
    fontSize: 11,
    fontWeight: active ? 600 : 400,
    fontFamily: OS.font,
    cursor: "pointer",
    border: "none",
    background: active
      ? (color ? `#${color}25` : dk(darkMode, "rgba(94,106,210,0.25)", OS.blueBg))
      : dk(darkMode, "rgba(255,255,255,0.05)", "#f3f3f3"),
    color: active
      ? (color ? `#${color}` : dk(darkMode, "#a5adff", OS.blue))
      : dk(darkMode, "#999", OS.muted),
    transition: "background 0.15s, color 0.15s",
  });

  const listStyle: React.CSSProperties = {
    flex: 1,
    overflowY: "auto",
    padding: "4px 0",
  };

  const rowStyle = (hovered: boolean): React.CSSProperties => ({
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    padding: "10px 16px",
    cursor: "pointer",
    background: hovered
      ? dk(darkMode, "rgba(255,255,255,0.04)", "rgba(0,0,0,0.02)")
      : "transparent",
    transition: "background 0.12s",
  });

  const emptyStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    flex: 1,
    gap: 8,
    padding: 32,
    color: dk(darkMode, "#666", OS.muted),
    fontSize: 13,
    textAlign: "center",
  };

  // ─── Empty states ───

  if (noToken && prs.length === 0) {
    return (
      <div style={containerStyle}>
        <div style={emptyStyle}>
          <span style={{ fontSize: 28, opacity: 0.4 }}>&#128279;</span>
          <span>Connect GitHub in Settings to see your PRs</span>
        </div>
      </div>
    );
  }

  const hasFilters = allLabels.length > 0 || allRepos.length > 1;

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>
          {prs.length > 0 ? `${prs.length} PR${prs.length === 1 ? "" : "s"}` : "PR Inbox"}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {lastFetchedLabel && (
            <span style={{ fontSize: 11, color: dk(darkMode, "#666", OS.faint) }}>
              {lastFetchedLabel}
            </span>
          )}
          <button
            onClick={handleRefresh}
            disabled={loading}
            style={{
              background: "none",
              border: "none",
              cursor: loading ? "default" : "pointer",
              padding: 4,
              borderRadius: 4,
              display: "flex",
              alignItems: "center",
              color: dk(darkMode, "#888", OS.muted),
              animation: loading ? "pr-inbox-spin 1s linear infinite" : "none",
              opacity: loading ? 0.6 : 1,
            }}
            title="Refresh"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 1v5h5" />
              <path d="M3.51 10a5.5 5.5 0 1 0 1.12-5.5L1 8" />
            </svg>
          </button>
        </div>
      </div>

      {/* Filter bar — repo chips + label chips */}
      {hasFilters && (
        <div style={filterBarStyle}>
          {/* Repo chips */}
          {allRepos.length > 1 && allRepos.map(({ repo, count }) => (
            <button
              key={repo}
              onClick={() => setActiveRepo(activeRepo === repo ? null : repo)}
              style={chipStyle(activeRepo === repo)}
            >
              {repoShortName(repo)} <span style={{ opacity: 0.6 }}>{count}</span>
            </button>
          ))}
          {/* Separator if both exist */}
          {allRepos.length > 1 && allLabels.length > 0 && (
            <span style={{ color: dk(darkMode, "#333", OS.border), fontSize: 11, padding: "3px 2px" }}>|</span>
          )}
          {/* Label chips */}
          {allLabels.slice(0, 8).map(({ name, color, count }) => (
            <button
              key={name}
              onClick={() => setActiveLabel(activeLabel === name ? null : name)}
              style={chipStyle(activeLabel === name, color)}
            >
              {name} <span style={{ opacity: 0.6 }}>{count}</span>
            </button>
          ))}
          {/* Clear filters */}
          {(activeLabel || activeRepo) && (
            <button
              onClick={() => { setActiveLabel(null); setActiveRepo(null); }}
              style={{
                ...chipStyle(false),
                color: dk(darkMode, "#888", OS.muted),
                fontStyle: "italic",
              }}
            >
              clear
            </button>
          )}
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div style={{
          padding: "8px 16px",
          fontSize: 12,
          color: OS.red,
          background: dk(darkMode, "rgba(209,67,67,0.1)", "#fef0f0"),
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}>
          <span>{error}</span>
          <button
            onClick={handleRefresh}
            style={{
              background: "none",
              border: `1px solid ${OS.red}`,
              borderRadius: 4,
              color: OS.red,
              fontSize: 11,
              padding: "2px 8px",
              cursor: "pointer",
              fontFamily: OS.font,
            }}
          >
            Retry
          </button>
        </div>
      )}

      {/* PR list */}
      <div style={listStyle}>
        {filtered.length === 0 && !loading && !error ? (
          <div style={emptyStyle}>
            <span style={{ fontSize: 28, opacity: 0.3 }}>&#10003;</span>
            <span>{(activeLabel || activeRepo) ? "No PRs match this filter" : "Nothing needs your attention right now"}</span>
          </div>
        ) : (
          filtered.map((pr) => (
            <div
              key={`${pr.repo}-${pr.number}`}
              style={rowStyle(hoveredId === pr.id)}
              onMouseEnter={() => setHoveredId(pr.id)}
              onMouseLeave={() => setHoveredId(null)}
              onClick={() => chrome.tabs.create({ url: pr.html_url })}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                {/* Top line: repo + time */}
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 2,
                }}>
                  <span style={{
                    fontSize: 11,
                    color: dk(darkMode, "#777", OS.muted),
                    fontWeight: 500,
                  }}>
                    {repoShortName(pr.repo)}
                    <span style={{ color: dk(darkMode, "#555", OS.faint), fontWeight: 400 }}>
                      {" "}#{pr.number}
                    </span>
                  </span>
                  <span style={{
                    fontSize: 11,
                    color: dk(darkMode, "#555", OS.faint),
                    whiteSpace: "nowrap",
                    marginLeft: 8,
                  }}>
                    {timeAgo(pr.updatedAt)}
                  </span>
                </div>

                {/* Title */}
                <div
                  title={pr.title}
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    lineHeight: 1.3,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    marginBottom: 4,
                  }}
                >
                  {pr.title}
                </div>

                {/* Bottom line: avatar + author + badges */}
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  flexWrap: "wrap",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <img
                      src={pr.authorAvatar}
                      alt={pr.author}
                      width={16}
                      height={16}
                      style={{ borderRadius: "50%", flexShrink: 0 }}
                    />
                    <span style={{ fontSize: 11, color: dk(darkMode, "#777", OS.muted) }}>
                      {pr.author}
                    </span>
                  </div>

                  {pr.isDraft && (
                    <span style={{
                      fontSize: 10,
                      fontWeight: 500,
                      padding: "1px 6px",
                      borderRadius: 8,
                      color: dk(darkMode, "#666", OS.faint),
                      background: dk(darkMode, "rgba(255,255,255,0.06)", "#f0f0f0"),
                    }}>
                      Draft
                    </span>
                  )}

                  {pr.labels.map((label) => (
                    <span
                      key={label.name}
                      onClick={(e) => { e.stopPropagation(); setActiveLabel(activeLabel === label.name ? null : label.name); }}
                      style={{
                        fontSize: 10,
                        padding: "1px 6px",
                        borderRadius: 8,
                        color: `#${label.color}`,
                        background: `#${label.color}18`,
                        fontWeight: 500,
                        cursor: "pointer",
                      }}
                    >
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
            <span style={{ fontSize: 12, color: dk(darkMode, "#666", OS.muted) }}>
              Loading PRs...
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
