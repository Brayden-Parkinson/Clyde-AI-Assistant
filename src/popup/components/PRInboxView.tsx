import React, { useState, useEffect, useCallback, useMemo } from "react";
import { OS } from "@shared/tokens";
import { dk } from "../DarkModeContext";
import type { PRInboxItem } from "@shared/types";
import { DEMO_PR_INBOX } from "@shared/demo-data";

type PRFilter = "all" | "review-requested" | "assigned" | "mentioned";

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

const REASON_COLORS: Record<PRInboxItem["reason"], string> = {
  "review-requested": OS.blue,
  "assigned": OS.green,
  "mentioned": "#8b5cf6", // purple
};

const REASON_LABELS: Record<PRInboxItem["reason"], string> = {
  "review-requested": "Review",
  "assigned": "Assigned",
  "mentioned": "Mentioned",
};

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
  const [filter, setFilter] = useState<PRFilter>("all");
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [noToken, setNoToken] = useState(false);

  // Inject spin keyframes on mount
  useEffect(() => { ensureSpinKeyframes(); }, []);

  // Load cached data + fetch
  useEffect(() => {
    if (demoMode) {
      setPrs(DEMO_PR_INBOX);
      setLastFetched(new Date().toISOString());
      return;
    }

    // Load cache
    chrome.storage.local.get("prInboxCache").then((result) => {
      if (result.prInboxCache) {
        const cache = result.prInboxCache as { prs: PRInboxItem[]; lastFetched: string };
        setPrs(cache.prs);
        setLastFetched(cache.lastFetched);
      }
    });

    // Check for token
    chrome.storage.local.get("githubToken").then((result) => {
      if (!result.githubToken) {
        setNoToken(true);
      }
    });

    // Request fresh data
    setLoading(true);
    chrome.runtime.sendMessage({ type: "PR_INBOX_FETCH" }).catch(() => {
      setLoading(false);
      setError("Failed to fetch PRs");
    });
  }, [demoMode]);

  // Listen for results
  useEffect(() => {
    if (demoMode) return;
    const listener = (msg: { type: string; prs?: PRInboxItem[]; error?: string }) => {
      if (msg.type === "PR_INBOX_RESULT") {
        setLoading(false);
        if (msg.error) {
          setError(msg.error);
        } else if (msg.prs) {
          setPrs(msg.prs);
          const now = new Date().toISOString();
          setLastFetched(now);
          setError(null);
          setNoToken(false);
          chrome.storage.local.set({ prInboxCache: { prs: msg.prs, lastFetched: now } });
        }
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
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

  // Filter counts
  const counts = useMemo(() => {
    const c = { all: prs.length, "review-requested": 0, assigned: 0, mentioned: 0 };
    for (const pr of prs) {
      c[pr.reason]++;
    }
    return c;
  }, [prs]);

  const filtered = useMemo(
    () => filter === "all" ? prs : prs.filter((pr) => pr.reason === filter),
    [prs, filter],
  );

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
    borderBottom: `1px solid ${dk(darkMode, "#2a2a2e", OS.border)}`,
  };

  const pillBarStyle: React.CSSProperties = {
    display: "flex",
    gap: 6,
    padding: "8px 16px",
    borderBottom: `1px solid ${dk(darkMode, "#2a2a2e", OS.border)}`,
  };

  const pillStyle = (active: boolean): React.CSSProperties => ({
    padding: "4px 10px",
    borderRadius: 12,
    fontSize: 12,
    fontWeight: active ? 600 : 400,
    fontFamily: OS.font,
    cursor: "pointer",
    border: "none",
    background: active ? dk(darkMode, "rgba(94,106,210,0.25)", OS.blueBg) : "transparent",
    color: active ? dk(darkMode, "#a5adff", OS.blue) : dk(darkMode, "#999", OS.muted),
    transition: "background 0.15s, color 0.15s",
  });

  const listStyle: React.CSSProperties = {
    flex: 1,
    overflowY: "auto",
    padding: "4px 0",
  };

  const rowStyle = (pr: PRInboxItem, hovered: boolean): React.CSSProperties => ({
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    padding: "10px 16px",
    cursor: "pointer",
    borderLeft: `3px solid ${REASON_COLORS[pr.reason]}`,
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

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>
          {prs.length > 0 ? `${prs.length} PR${prs.length === 1 ? "" : "s"} need you` : "PR Inbox"}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {lastFetchedLabel && (
            <span style={{ fontSize: 11, color: dk(darkMode, "#666", OS.faint) }}>
              Updated {lastFetchedLabel}
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

      {/* Filter pills */}
      <div style={pillBarStyle}>
        {(["all", "review-requested", "assigned", "mentioned"] as PRFilter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={pillStyle(filter === f)}
          >
            {f === "all" ? "All" : REASON_LABELS[f as PRInboxItem["reason"]]}
            {" "}
            <span style={{ opacity: 0.7 }}>
              {f === "all" ? counts.all : counts[f as PRInboxItem["reason"]]}
            </span>
          </button>
        ))}
      </div>

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
            <span>Nothing needs your attention right now</span>
          </div>
        ) : (
          filtered.map((pr) => (
            <div
              key={pr.id}
              style={rowStyle(pr, hoveredId === pr.id)}
              onMouseEnter={() => setHoveredId(pr.id)}
              onMouseLeave={() => setHoveredId(null)}
              onClick={() => chrome.tabs.create({ url: pr.html_url })}
            >
              {/* Content */}
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
                  {/* Author */}
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <img
                      src={pr.authorAvatar}
                      alt={pr.author}
                      width={16}
                      height={16}
                      style={{ borderRadius: "50%", flexShrink: 0 }}
                    />
                    <span style={{
                      fontSize: 11,
                      color: dk(darkMode, "#777", OS.muted),
                    }}>
                      {pr.author}
                    </span>
                  </div>

                  {/* Reason badge */}
                  <span style={{
                    fontSize: 10,
                    fontWeight: 600,
                    padding: "1px 6px",
                    borderRadius: 8,
                    color: REASON_COLORS[pr.reason],
                    background: REASON_COLORS[pr.reason] + "18",
                    letterSpacing: 0.2,
                  }}>
                    {REASON_LABELS[pr.reason]}
                  </span>

                  {/* Draft badge */}
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

                  {/* Labels */}
                  {pr.labels.slice(0, 2).map((label) => (
                    <span
                      key={label.name}
                      style={{
                        fontSize: 10,
                        padding: "1px 6px",
                        borderRadius: 8,
                        color: `#${label.color}`,
                        background: `#${label.color}18`,
                        fontWeight: 500,
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

        {/* Loading skeleton when no cached data */}
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
