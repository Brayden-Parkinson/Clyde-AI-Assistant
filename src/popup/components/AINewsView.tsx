import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@shared/db";
import { OS } from "@shared/tokens";
import { NEWS_SOURCES } from "@shared/constants";
import { DEMO_NEWS_POSTS, DEMO_NEWS_BRIEFING } from "@shared/demo-data";
import type { NewsPost, NewsSourceType } from "@shared/types";
import { dk } from "../DarkModeContext";

interface AINewsViewProps {
  darkMode?: boolean;
  demoMode?: boolean;
}

const SOURCE_COLORS: Record<string, string> = {
  "anthropic-blog": OS.blue,
  "hacker-news": "#FF6600",
  "arxiv": "#B31B1B",
  "openai-blog": "#10A37F",
  "huggingface-blog": "#FFD21E",
  "verge-ai": OS.secondary,
  "techcrunch-ai": "#0A9E2C",
};

// ─── Helpers ───

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function relevanceLabel(score: number): { text: string; color: string } {
  if (score >= 9) return { text: "Must read", color: OS.green };
  if (score >= 7) return { text: "High", color: OS.green };
  if (score >= 5) return { text: "Medium", color: OS.warning };
  return { text: "Low", color: OS.muted };
}

function relevanceAccent(score: number): string {
  if (score >= 8) return OS.green;
  if (score >= 5) return OS.warning;
  return "transparent";
}

function domainFromUrl(url: string): string {
  try { return new URL(url).hostname.replace("www.", ""); } catch { return ""; }
}

function timeBucket(iso: string): "today" | "yesterday" | "this-week" | "older" {
  const now = new Date();
  const posted = new Date(iso);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(startOfToday.getTime() - 86_400_000);
  const startOfWeek = new Date(startOfToday.getTime() - startOfToday.getDay() * 86_400_000);
  if (posted >= startOfToday) return "today";
  if (posted >= startOfYesterday) return "yesterday";
  if (posted >= startOfWeek) return "this-week";
  return "older";
}

const TIME_LABELS: Record<string, string> = {
  today: "Today", yesterday: "Yesterday", "this-week": "This Week", older: "Earlier",
};
const TIME_ORDER = ["today", "yesterday", "this-week", "older"];

function highlightMatch(text: string, query: string, dark: boolean): React.ReactNode {
  if (!query.trim()) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <span style={{ background: dk(dark, "rgba(192,122,0,0.25)", OS.yellowBg), borderRadius: 2, padding: "0 1px" }}>
        {text.slice(idx, idx + query.length)}
      </span>
      {text.slice(idx + query.length)}
    </>
  );
}

// ─── Shadow helpers (dark mode needs stronger shadows) ───

function heroShadow(dark: boolean, state: "rest" | "hover" | "focus"): string {
  if (state === "focus") return `0 0 0 2px ${dk(dark, "rgba(94,106,210,0.5)", OS.blue + "30")}`;
  if (state === "hover") return dk(dark, "0 4px 16px rgba(0,0,0,0.4)", "0 4px 16px rgba(0,0,0,0.10)");
  return dk(dark, "0 2px 8px rgba(0,0,0,0.3)", "0 1px 4px rgba(0,0,0,0.06)");
}

function stdShadow(dark: boolean, state: "rest" | "hover" | "focus"): string {
  if (state === "focus") return `0 0 0 2px ${dk(dark, "rgba(94,106,210,0.5)", OS.blue + "30")}`;
  if (state === "hover") return dk(dark, "0 3px 12px rgba(0,0,0,0.35)", "0 3px 12px rgba(0,0,0,0.08)");
  return dk(dark, "0 1px 4px rgba(0,0,0,0.25)", "0 1px 3px rgba(0,0,0,0.04)");
}

function compactShadow(dark: boolean, state: "rest" | "hover" | "focus"): string {
  if (state === "focus") return `0 0 0 2px ${dk(dark, "rgba(94,106,210,0.5)", OS.blue + "30")}`;
  if (state === "hover") return dk(dark, "0 2px 6px rgba(0,0,0,0.25)", "0 1px 4px rgba(0,0,0,0.04)");
  return "none";
}

// ─── Types ───

interface SourceStat {
  source: string; name: string; count: number; error: string | null; fetchedAt: string;
}
interface SourceProgress {
  source: string; name: string; status: "pending" | "fetching" | "done" | "error";
}

// ─── Main Component ───

export function AINewsView({ darkMode = false, demoMode = false }: AINewsViewProps) {
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [activeFilter, setActiveFilter] = useState<string>("all");
  const [briefing, setBriefing] = useState<string | null>(null);
  const [briefingExpanded, setBriefingExpanded] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [sourceStats, setSourceStats] = useState<SourceStat[]>([]);
  const [sourcesExpanded, setSourcesExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [sourceProgress, setSourceProgress] = useState<SourceProgress[]>([]);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [disabledSources, setDisabledSources] = useState<Set<string>>(new Set());
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const postRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const livePosts = useLiveQuery(() => db.news_posts.orderBy("relevanceScore").reverse().toArray(), []);
  const posts: NewsPost[] = demoMode ? DEMO_NEWS_POSTS : (livePosts ?? []);
  const lastFetched = posts?.[0]?.fetchedAt ?? null;
  const unreadCount = useMemo(() => posts.filter((p) => !p.readAt).length, [posts]);

  useEffect(() => {
    if (demoMode) { setBriefing(DEMO_NEWS_BRIEFING); return; }
    chrome.storage.local.get(["newsBriefing", "newsAutoRefresh", "newsSourceStats", "newsDisabledSources"]).then((r) => {
      if (r.newsBriefing) setBriefing(r.newsBriefing);
      if (r.newsAutoRefresh) setAutoRefresh(true);
      if (r.newsSourceStats) setSourceStats(r.newsSourceStats);
      if (r.newsDisabledSources) setDisabledSources(new Set(r.newsDisabledSources));
    });
  }, [demoMode]);

  const markRead = useCallback((post: NewsPost) => {
    if (demoMode || post.readAt || post.id == null) return;
    db.news_posts.update(post.id, { readAt: new Date().toISOString() });
  }, [demoMode]);

  const toggleBookmark = useCallback((e: React.MouseEvent, post: NewsPost) => {
    e.stopPropagation();
    if (demoMode || post.id == null) return;
    db.news_posts.update(post.id, { bookmarked: !post.bookmarked });
  }, [demoMode]);

  const toggleSource = useCallback((sourceKey: string) => {
    if (demoMode) return;
    setDisabledSources((prev) => {
      const next = new Set(prev);
      if (next.has(sourceKey)) next.delete(sourceKey); else next.add(sourceKey);
      chrome.storage.local.set({ newsDisabledSources: [...next] });
      return next;
    });
  }, [demoMode]);

  const handleRefresh = useCallback(() => {
    if (demoMode || refreshing) return;
    setRefreshing(true); setError(null);
    const entries = Object.entries(NEWS_SOURCES).filter(([, cfg]) => cfg.enabled);
    setSourceProgress(entries.map(([key, cfg]) => ({ source: key, name: cfg.name, status: "fetching" as const })));
    chrome.runtime.sendMessage({ type: "REFRESH_NEWS" }).catch(() => {
      setRefreshing(false); setError("Failed to start refresh"); setSourceProgress([]);
    });
  }, [demoMode, refreshing]);

  const handleAutoRefreshToggle = useCallback(() => {
    if (demoMode) return;
    const next = !autoRefresh; setAutoRefresh(next);
    chrome.storage.local.set({ newsAutoRefresh: next });
    chrome.runtime.sendMessage({ type: "SET_NEWS_ALARM", enabled: next });
  }, [demoMode, autoRefresh]);

  useEffect(() => {
    const listener = (msg: { type: string; error?: string; sourceStats?: SourceStat[]; source?: string; status?: string }) => {
      if (msg.type === "NEWS_REFRESH_COMPLETE") {
        setRefreshing(false); setSourceProgress([]);
        if (msg.error) setError(msg.error);
        if (msg.sourceStats) setSourceStats(msg.sourceStats);
        chrome.storage.local.get("newsBriefing").then((r) => { if (r.newsBriefing) setBriefing(r.newsBriefing); });
      } else if (msg.type === "NEWS_SOURCE_PROGRESS") {
        setSourceProgress((prev) => prev.map((s) => s.source === msg.source ? { ...s, status: (msg.status as SourceProgress["status"]) ?? "done" } : s));
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  const sourceCounts = useMemo(() => {
    const c = new Map<string, number>();
    for (const p of posts) c.set(p.source, (c.get(p.source) ?? 0) + 1);
    return c;
  }, [posts]);

  const bookmarkedCount = useMemo(() => posts.filter((p) => p.bookmarked).length, [posts]);

  const filteredPosts = useMemo(() => {
    let r = posts;
    if (activeFilter === "bookmarked") r = r.filter((p) => p.bookmarked);
    else if (activeFilter !== "all") r = r.filter((p) => p.source === activeFilter);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      r = r.filter((p) => p.title.toLowerCase().includes(q) || p.summary.toLowerCase().includes(q));
    }
    return r;
  }, [posts, activeFilter, searchQuery]);

  const timeGroups = useMemo(() => {
    if (searchQuery.trim() || (activeFilter !== "all" && activeFilter !== "bookmarked")) return null;
    const buckets = new Map<string, NewsPost[]>();
    for (const p of filteredPosts) {
      const b = timeBucket(p.postedAt);
      if (!buckets.has(b)) buckets.set(b, []);
      buckets.get(b)!.push(p);
    }
    const groups: Array<{ bucket: string; label: string; posts: NewsPost[] }> = [];
    for (const b of TIME_ORDER) {
      const items = buckets.get(b);
      if (items && items.length > 0) {
        items.sort((a, b2) => b2.relevanceScore - a.relevanceScore);
        groups.push({ bucket: b, label: TIME_LABELS[b], posts: items });
      }
    }
    return groups;
  }, [filteredPosts, searchQuery, activeFilter]);

  const flatPosts = useMemo(() => {
    if (timeGroups) return timeGroups.flatMap((g) => g.posts);
    return [...filteredPosts].sort((a, b) => new Date(b.postedAt).getTime() - new Date(a.postedAt).getTime());
  }, [timeGroups, filteredPosts]);

  const toggleExpand = useCallback((post: NewsPost) => {
    if (post.id == null) return;
    setExpandedId((prev) => { const ex = prev !== post.id; if (ex) markRead(post); return ex ? post.id! : null; });
  }, [markRead]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.key === "ArrowDown" || e.key === "j") {
      e.preventDefault();
      setFocusedIndex((prev) => { const n = Math.min(prev + 1, flatPosts.length - 1); flatPosts[n]?.id != null && postRefs.current.get(flatPosts[n].id!)?.scrollIntoView({ block: "center", behavior: "smooth" }); return n; });
    } else if (e.key === "ArrowUp" || e.key === "k") {
      e.preventDefault();
      setFocusedIndex((prev) => { const n = Math.max(prev - 1, 0); flatPosts[n]?.id != null && postRefs.current.get(flatPosts[n].id!)?.scrollIntoView({ block: "center", behavior: "smooth" }); return n; });
    } else if (e.key === "Enter") { e.preventDefault(); const p = flatPosts[focusedIndex]; if (p) toggleExpand(p); }
    else if (e.key === "Escape") setExpandedId(null);
    else if (e.key === "b" && focusedIndex >= 0) { const p = flatPosts[focusedIndex]; if (p?.id != null && !demoMode) db.news_posts.update(p.id, { bookmarked: !p.bookmarked }); }
    else if (e.key === "o" && focusedIndex >= 0) { const p = flatPosts[focusedIndex]; if (p?.url) window.open(p.url, "_blank", "noopener,noreferrer"); }
  }, [flatPosts, focusedIndex, toggleExpand, demoMode]);

  const sourceEntries = Object.entries(NEWS_SOURCES)
    .filter(([key]) => sourceCounts.has(key) || demoMode)
    .map(([key, cfg]) => ({ key, shortName: cfg.shortName, count: sourceCounts.get(key) ?? 0 }));

  // ─── Shared card props builder ───
  const cardProps = useCallback((post: NewsPost) => {
    const idx = flatPosts.indexOf(post);
    return {
      post, expanded: expandedId === post.id, focused: focusedIndex === idx,
      hovered: hoveredId === post.id, darkMode, searchQuery,
      onToggle: () => toggleExpand(post),
      onBookmark: (e: React.MouseEvent) => toggleBookmark(e, post),
      onHover: (h: boolean) => setHoveredId(h ? (post.id ?? null) : null),
      refCallback: (el: HTMLDivElement | null) => {
        if (post.id != null) { if (el) postRefs.current.set(post.id, el); else postRefs.current.delete(post.id!); }
      },
    };
  }, [flatPosts, expandedId, focusedIndex, hoveredId, darkMode, searchQuery, toggleExpand, toggleBookmark]);

  return (
    <div ref={containerRef} tabIndex={0} onKeyDown={handleKeyDown} style={{ fontFamily: OS.font, outline: "none" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingBottom: 12 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: dk(darkMode, "#e0e0e0", OS.text) }}>AI News</h2>
            {unreadCount > 0 && (
              <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 9999, background: dk(darkMode, "rgba(94,106,210,0.25)", OS.blueBg), color: dk(darkMode, "#8b95e0", OS.blue) }}>
                {unreadCount} new
              </span>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
            {lastFetched && <span style={{ fontSize: 11, color: dk(darkMode, "rgba(255,255,255,0.45)", OS.muted) }}>Updated {timeAgo(lastFetched)}</span>}
            {autoRefresh && <span style={{ fontSize: 10, color: dk(darkMode, "rgba(255,255,255,0.30)", OS.faint) }}>Auto every 30m</span>}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button onClick={handleAutoRefreshToggle} style={{
            fontSize: 11, fontFamily: OS.font, padding: "4px 10px", borderRadius: 6, cursor: "pointer", transition: "all 150ms",
            background: autoRefresh ? dk(darkMode, "rgba(59,140,95,0.2)", "rgba(59,140,95,0.1)") : "transparent",
            border: `1px solid ${autoRefresh ? dk(darkMode, "rgba(59,140,95,0.4)", OS.green + "40") : dk(darkMode, "rgba(255,255,255,0.10)", OS.border)}`,
            color: autoRefresh ? OS.green : dk(darkMode, "rgba(255,255,255,0.40)", OS.muted),
          }}>Auto</button>
          <button onClick={handleRefresh} disabled={refreshing} style={{
            fontSize: 12, fontWeight: 600, fontFamily: OS.font, padding: "5px 14px", borderRadius: 6,
            cursor: refreshing ? "default" : "pointer", transition: "all 150ms",
            background: dk(darkMode, "rgba(94,106,210,0.15)", OS.blueBg),
            border: `1px solid ${dk(darkMode, "rgba(94,106,210,0.3)", OS.blue + "40")}`,
            color: dk(darkMode, "#8b95e0", OS.blue), opacity: refreshing ? 0.6 : 1,
          }}>{refreshing ? "Refreshing..." : "Refresh"}</button>
        </div>
      </div>

      {/* Search */}
      {posts.length > 0 && (
        <div style={{ marginBottom: 10, position: "relative" }}>
          <input type="text" placeholder="Search news..." value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setFocusedIndex(-1); }}
            style={{
              width: "100%", boxSizing: "border-box", padding: "7px 12px", borderRadius: 8,
              fontSize: 12, fontFamily: OS.font, outline: "none",
              background: dk(darkMode, "rgba(255,255,255,0.06)", OS.white),
              border: `1px solid ${dk(darkMode, "rgba(255,255,255,0.10)", OS.border)}`,
              color: dk(darkMode, "#e0e0e0", OS.text),
            }} />
          {searchQuery && (
            <span style={{
              position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)",
              fontSize: 11, fontWeight: 500,
              color: filteredPosts.length > 0 ? dk(darkMode, "rgba(255,255,255,0.45)", OS.muted) : OS.red,
            }}>{filteredPosts.length} of {posts.length}</span>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{ padding: "8px 12px", marginBottom: 10, borderRadius: 6, fontSize: 12,
          background: dk(darkMode, "rgba(209,67,67,0.1)", "#fef2f2"),
          border: `1px solid ${dk(darkMode, "rgba(209,67,67,0.2)", "#fecaca")}`, color: OS.red }}>
          {error}
        </div>
      )}

      {/* Per-source progress */}
      {refreshing && sourceProgress.length > 0 && (
        <div style={{ padding: "10px 14px", marginBottom: 10, borderRadius: 8,
          background: dk(darkMode, "rgba(255,255,255,0.04)", OS.white),
          border: `1px solid ${dk(darkMode, "rgba(255,255,255,0.08)", OS.border)}` }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {sourceProgress.map((sp) => (
              <span key={sp.source} style={{
                display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, padding: "3px 8px", borderRadius: 6, transition: "all 300ms",
                background: sp.status === "done" ? dk(darkMode, "rgba(59,140,95,0.15)", "#e8f5ee") : sp.status === "error" ? dk(darkMode, "rgba(209,67,67,0.1)", "#fef2f2") : dk(darkMode, "rgba(255,255,255,0.06)", OS.bg),
                color: sp.status === "done" ? OS.green : sp.status === "error" ? OS.red : dk(darkMode, "rgba(255,255,255,0.50)", OS.secondary),
              }}>
                <span style={{ fontSize: 10 }}>{sp.status === "done" ? "✓" : sp.status === "error" ? "✗" : "⟳"}</span>
                {sp.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Briefing */}
      {briefing && posts.length > 0 && <BriefingCard briefing={briefing} expanded={briefingExpanded} onToggle={() => setBriefingExpanded(!briefingExpanded)} darkMode={darkMode} />}

      {/* Empty state */}
      {(!posts || posts.length === 0) && !refreshing && (
        <div style={{ textAlign: "center", padding: "48px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
          <div style={{ width: 48, height: 48, borderRadius: "50%", background: dk(darkMode, "rgba(94,106,210,0.15)", OS.blueBg), display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontSize: 22 }}>📡</span>
          </div>
          <div style={{ fontSize: 15, fontWeight: 600, color: dk(darkMode, "#e0e0e0", OS.text) }}>No news yet</div>
          <div style={{ fontSize: 13, color: dk(darkMode, "rgba(255,255,255,0.50)", OS.muted), lineHeight: 1.6, maxWidth: 260 }}>
            Click Refresh to fetch AI news from {Object.keys(NEWS_SOURCES).length} sources
          </div>
        </div>
      )}

      {/* Skeleton */}
      {refreshing && (!posts || posts.length === 0) && sourceProgress.length === 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "12px 0" }}>
          {[1, 2, 3].map((i) => (
            <div key={i} style={{ height: 56, borderRadius: 8, background: dk(darkMode, "rgba(255,255,255,0.04)", OS.bg), border: `1px solid ${dk(darkMode, "rgba(255,255,255,0.06)", OS.border)}`, boxShadow: dk(darkMode, "0 1px 4px rgba(0,0,0,0.15)", "0 1px 3px rgba(0,0,0,0.03)") }} />
          ))}
        </div>
      )}

      {/* Filter pills */}
      {posts.length > 0 && (
        <div style={{ display: "flex", gap: 5, marginBottom: 10, flexWrap: "wrap" }}>
          <FilterPill label="All" count={posts.length} active={activeFilter === "all"} color={OS.blue} darkMode={darkMode} onClick={() => { setActiveFilter("all"); setFocusedIndex(-1); }} />
          {bookmarkedCount > 0 && <FilterPill label="★ Saved" count={bookmarkedCount} active={activeFilter === "bookmarked"} color={OS.warning} darkMode={darkMode} onClick={() => { setActiveFilter("bookmarked"); setFocusedIndex(-1); }} />}
          {sourceEntries.map(({ key, shortName, count }) => (
            <FilterPill key={key} label={shortName} count={count} active={activeFilter === key} color={SOURCE_COLORS[key] ?? OS.muted} darkMode={darkMode} onClick={() => { setActiveFilter(key); setFocusedIndex(-1); }} />
          ))}
        </div>
      )}

      {/* Keyboard hints */}
      {posts.length > 0 && (
        <div style={{ fontSize: 10, color: dk(darkMode, "rgba(255,255,255,0.25)", OS.faint), marginBottom: 10 }}>
          ↑↓ j/k navigate · Enter expand · b bookmark · o open · Esc close
        </div>
      )}

      {/* ─── Post list: gap-spaced contained cards ─── */}
      {timeGroups ? (
        timeGroups.map((group) => (
          <div key={group.bucket}>
            <div style={{
              display: "flex", alignItems: "center", gap: 6,
              marginTop: group.bucket !== "today" ? 16 : 4, marginBottom: 8,
            }}>
              <div style={{ width: 3, height: 14, borderRadius: 2, background: group.bucket === "today" ? OS.blue : dk(darkMode, "rgba(255,255,255,0.15)", OS.faint), flexShrink: 0 }} />
              <span style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", color: dk(darkMode, "rgba(255,255,255,0.50)", OS.muted) }}>{group.label}</span>
              <span style={{ fontSize: 11, fontWeight: 400, color: dk(darkMode, "rgba(255,255,255,0.30)", OS.faint) }}>{group.posts.length}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {group.posts.map((post) => <PostCard key={post.id} {...cardProps(post)} />)}
            </div>
          </div>
        ))
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {flatPosts.map((post) => <PostCard key={post.id} {...cardProps(post)} />)}
        </div>
      )}

      {/* No results */}
      {searchQuery && filteredPosts.length === 0 && (
        <div style={{ textAlign: "center", padding: "24px 20px", color: dk(darkMode, "rgba(255,255,255,0.45)", OS.muted), fontSize: 13 }}>
          No posts matching "{searchQuery}"
        </div>
      )}

      {/* Sources footer */}
      {(sourceStats.length > 0 || demoMode) && (
        <SourcesFooter stats={demoMode ? demoSourceStats() : sourceStats} expanded={sourcesExpanded} onToggle={() => setSourcesExpanded(!sourcesExpanded)} darkMode={darkMode} disabledSources={disabledSources} onToggleSource={toggleSource} />
      )}
    </div>
  );
}

// ─── Briefing Card ───

function BriefingCard({ briefing, expanded, onToggle, darkMode }: { briefing: string; expanded: boolean; onToggle: () => void; darkMode: boolean }) {
  const bullets = briefing.split("\n").filter((l) => l.trim());
  const preview = bullets.slice(0, 3);
  const rest = bullets.slice(3);
  return (
    <div onClick={onToggle} style={{
      padding: "10px 14px", marginBottom: 12, borderRadius: 8, cursor: "pointer",
      background: dk(darkMode, "rgba(94,106,210,0.06)", OS.blueBg),
      border: `1px solid ${dk(darkMode, "rgba(94,106,210,0.15)", OS.blue + "20")}`,
      borderLeft: `4px solid ${OS.blue}`,
      boxShadow: dk(darkMode, "0 1px 4px rgba(0,0,0,0.25)", "0 1px 3px rgba(0,0,0,0.04)"),
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6, color: dk(darkMode, "rgba(94,106,210,0.8)", OS.blue) }}>Daily Briefing</div>
      {preview.map((line, i) => <div key={i} style={{ fontSize: 12, lineHeight: 1.55, color: dk(darkMode, "rgba(255,255,255,0.80)", OS.text) }}>{line}</div>)}
      {expanded && rest.map((line, i) => <div key={`r${i}`} style={{ fontSize: 12, lineHeight: 1.55, color: dk(darkMode, "rgba(255,255,255,0.80)", OS.text) }}>{line}</div>)}
      {!expanded && rest.length > 0 && <div style={{ fontSize: 11, color: dk(darkMode, "rgba(255,255,255,0.30)", OS.faint), marginTop: 4 }}>+{rest.length} more</div>}
    </div>
  );
}

// ─── Filter Pill ───

function FilterPill({ label, count, active, color, darkMode, onClick }: { label: string; count: number; active: boolean; color: string; darkMode: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      display: "flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 9999, cursor: "pointer",
      fontSize: 10, fontWeight: 500, fontFamily: OS.font, transition: "all 150ms",
      background: active ? color + "20" : "transparent",
      border: `1px solid ${active ? color + "50" : dk(darkMode, "rgba(255,255,255,0.10)", OS.border)}`,
      color: active ? color : dk(darkMode, "rgba(255,255,255,0.50)", OS.secondary),
    }}>
      {!label.startsWith("★") && <span style={{ width: 5, height: 5, borderRadius: "50%", background: color, flexShrink: 0 }} />}
      {label}
      <span style={{ fontSize: 9, opacity: 0.6 }}>{count}</span>
    </button>
  );
}

// ─── Post Card — Contained surface with shadow ───

function PostCard({
  post, expanded, focused, hovered, onToggle, onBookmark, onHover, darkMode, searchQuery, refCallback,
}: {
  post: NewsPost; expanded: boolean; focused: boolean; hovered: boolean;
  onToggle: () => void; onBookmark: (e: React.MouseEvent) => void; onHover: (h: boolean) => void;
  darkMode: boolean; searchQuery: string; refCallback: (el: HTMLDivElement | null) => void;
}) {
  const sourceColor = SOURCE_COLORS[post.source] ?? OS.muted;
  const isRead = !!post.readAt;
  const isHero = post.relevanceScore >= 9;
  const isCompact = post.relevanceScore <= 4;
  const rl = relevanceLabel(post.relevanceScore);
  const isActive = expanded || hovered || focused;
  const shadowState = focused ? "focus" : isActive ? "hover" : "rest";

  // ─── Compact card ───
  if (isCompact && !expanded) {
    return (
      <div ref={refCallback} onClick={onToggle} onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)}
        style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "8px 14px", cursor: "pointer",
          borderRadius: 6,
          background: isActive
            ? dk(darkMode, "rgba(255,255,255,0.06)", OS.white)
            : dk(darkMode, "rgba(255,255,255,0.025)", OS.bg),
          border: `1px solid ${dk(darkMode, "rgba(255,255,255,0.06)", "rgba(0,0,0,0.06)")}`,
          boxShadow: compactShadow(darkMode, shadowState),
          transition: "background 0.15s ease, box-shadow 0.2s ease",
        }}>
        <span style={{ width: 5, height: 5, borderRadius: "50%", background: sourceColor, flexShrink: 0 }} />
        <span style={{
          fontSize: 12, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          fontWeight: isRead ? 400 : 500,
          color: isRead ? dk(darkMode, "rgba(255,255,255,0.45)", OS.muted) : dk(darkMode, "rgba(255,255,255,0.70)", OS.secondary),
        }}>
          {highlightMatch(post.title, searchQuery, darkMode)}
        </span>
        <span style={{ fontSize: 10, color: dk(darkMode, "rgba(255,255,255,0.30)", OS.faint), flexShrink: 0 }}>
          {post.postedAt ? timeAgo(post.postedAt) : ""}
        </span>
        {post.bookmarked && <span style={{ fontSize: 10, color: OS.warning, flexShrink: 0 }}>★</span>}
      </div>
    );
  }

  // ─── Hero card (9-10) — featured contained surface ───
  if (isHero) {
    return (
      <div ref={refCallback} onClick={onToggle} onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)}
        style={{
          padding: expanded ? "16px 16px" : "14px 16px", cursor: "pointer",
          borderRadius: 10,
          background: expanded
            ? dk(darkMode, "rgba(59,140,95,0.08)", "#eef7f1")
            : isActive
              ? dk(darkMode, "rgba(59,140,95,0.05)", "#f2faf5")
              : dk(darkMode, "rgba(255,255,255,0.04)", OS.white),
          border: `1px solid ${expanded ? dk(darkMode, "rgba(59,140,95,0.25)", OS.green + "30") : dk(darkMode, "rgba(255,255,255,0.08)", OS.border)}`,
          borderLeft: `4px solid ${OS.green}`,
          boxShadow: heroShadow(darkMode, shadowState),
          transition: "background 0.15s ease, box-shadow 0.2s ease, border-color 0.15s ease",
        }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{
              fontSize: 15, lineHeight: 1.4, fontWeight: 700,
              color: isRead ? dk(darkMode, "rgba(255,255,255,0.60)", OS.secondary) : dk(darkMode, "#f0f0f0", OS.text),
            }}>
              {!isRead && <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: OS.blue, marginRight: 6, verticalAlign: "middle" }} />}
              {highlightMatch(post.title, searchQuery, darkMode)}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 4, fontSize: 11, color: dk(darkMode, "rgba(255,255,255,0.55)", OS.secondary), flexWrap: "wrap", rowGap: 2 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: sourceColor, flexShrink: 0 }} />
              <span style={{ fontWeight: 500 }}>{post.sourceName}</span>
              <span style={{ fontSize: 10, fontWeight: 600, padding: "1px 5px", borderRadius: 3, background: rl.color + "18", color: rl.color }}>{rl.text}</span>
              {post.topicTag && <span style={{ fontSize: 10, color: dk(darkMode, "rgba(255,255,255,0.35)", OS.muted) }}>{post.topicTag}</span>}
              <span style={{ marginLeft: "auto", fontSize: 11, color: dk(darkMode, "rgba(255,255,255,0.35)", OS.faint) }}>{post.postedAt ? timeAgo(post.postedAt) : ""}</span>
            </div>
            <div style={{
              fontSize: 13, lineHeight: 1.55, marginTop: 6,
              color: isRead ? dk(darkMode, "rgba(255,255,255,0.45)", OS.muted) : dk(darkMode, "rgba(255,255,255,0.65)", OS.secondary),
            }}>
              {highlightMatch(post.summary, searchQuery, darkMode)}
            </div>
          </div>
          <button onClick={onBookmark} style={{ background: "none", border: "none", cursor: "pointer", padding: "4px 8px", fontSize: 14, color: post.bookmarked ? OS.warning : dk(darkMode, "rgba(255,255,255,0.15)", OS.faint), transition: "color 150ms", flexShrink: 0 }}>
            {post.bookmarked ? "★" : "☆"}
          </button>
        </div>
        {expanded && (
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${dk(darkMode, "rgba(255,255,255,0.06)", OS.border)}` }}>
            {post.author && <div style={{ fontSize: 11, color: dk(darkMode, "rgba(255,255,255,0.40)", OS.faint), marginBottom: 6 }}>by {post.author}</div>}
            {post.rawText && post.rawText !== post.title && (
              <div style={{ fontSize: 12, lineHeight: 1.55, color: dk(darkMode, "rgba(255,255,255,0.50)", OS.secondary), paddingLeft: 12, borderLeft: `2px solid ${dk(darkMode, "rgba(255,255,255,0.10)", OS.faint)}`, fontStyle: "italic" }}>
                {post.rawText.slice(0, 400)}{post.rawText.length > 400 && "..."}
              </div>
            )}
            <a href={post.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={{ display: "inline-block", marginTop: 8, fontSize: 11, color: OS.blue, textDecoration: "none", fontWeight: 600 }}>
              {domainFromUrl(post.url)} →
            </a>
          </div>
        )}
      </div>
    );
  }

  // ─── Standard card (5-8) — contained surface ───
  return (
    <div ref={refCallback} onClick={onToggle} onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)}
      style={{
        padding: expanded ? "14px 16px" : "12px 16px", cursor: "pointer",
        borderRadius: 8,
        background: expanded
          ? dk(darkMode, "rgba(255,255,255,0.06)", OS.white)
          : isActive
            ? dk(darkMode, "rgba(255,255,255,0.05)", OS.white)
            : dk(darkMode, "rgba(255,255,255,0.03)", OS.white),
        border: `1px solid ${dk(darkMode, "rgba(255,255,255,0.08)", OS.border)}`,
        borderLeft: post.relevanceScore >= 5 ? `3px solid ${relevanceAccent(post.relevanceScore)}` : undefined,
        boxShadow: stdShadow(darkMode, shadowState),
        transition: "background 0.15s ease, box-shadow 0.2s ease",
      }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={{
            fontSize: 14, lineHeight: 1.4,
            fontWeight: isRead ? 400 : 600,
            color: isRead ? dk(darkMode, "rgba(255,255,255,0.55)", OS.muted) : dk(darkMode, "#e0e0e0", OS.text),
          }}>
            {!isRead && <span style={{ display: "inline-block", width: 5, height: 5, borderRadius: "50%", background: OS.blue, marginRight: 6, verticalAlign: "middle" }} />}
            {highlightMatch(post.title, searchQuery, darkMode)}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 3, fontSize: 12, color: isRead ? dk(darkMode, "rgba(255,255,255,0.40)", OS.faint) : dk(darkMode, "rgba(255,255,255,0.55)", OS.secondary), flexWrap: "wrap", rowGap: 2 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: sourceColor, flexShrink: 0 }} />
            <span>{post.sourceName}</span>
            <span style={{ fontSize: 10, fontWeight: 600, padding: "1px 5px", borderRadius: 3, background: rl.color + "18", color: rl.color }}>{rl.text}</span>
            <span style={{ marginLeft: "auto", fontSize: 11, color: dk(darkMode, "rgba(255,255,255,0.35)", OS.faint) }}>{post.postedAt ? timeAgo(post.postedAt) : ""}</span>
          </div>
        </div>
        <button onClick={onBookmark} style={{ background: "none", border: "none", cursor: "pointer", padding: "4px 8px", fontSize: 13, color: post.bookmarked ? OS.warning : dk(darkMode, "rgba(255,255,255,0.15)", OS.faint), transition: "color 150ms", flexShrink: 0 }}>
          {post.bookmarked ? "★" : "☆"}
        </button>
      </div>
      {expanded && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${dk(darkMode, "rgba(255,255,255,0.06)", OS.border)}` }}>
          <div style={{ fontSize: 13, lineHeight: 1.55, marginBottom: 8, color: dk(darkMode, "rgba(255,255,255,0.70)", OS.secondary) }}>
            {highlightMatch(post.summary, searchQuery, darkMode)}
          </div>
          {post.author && <div style={{ fontSize: 11, color: dk(darkMode, "rgba(255,255,255,0.40)", OS.faint), marginBottom: 6 }}>by {post.author}</div>}
          {post.rawText && post.rawText !== post.title && post.rawText !== post.summary && (
            <div style={{ fontSize: 12, lineHeight: 1.55, color: dk(darkMode, "rgba(255,255,255,0.45)", OS.secondary), paddingLeft: 12, borderLeft: `2px solid ${dk(darkMode, "rgba(255,255,255,0.08)", OS.faint)}`, fontStyle: "italic" }}>
              {post.rawText.slice(0, 300)}{post.rawText.length > 300 && "..."}
            </div>
          )}
          <a href={post.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={{ display: "inline-block", marginTop: 8, fontSize: 11, color: OS.blue, textDecoration: "none", fontWeight: 600 }}>
            {domainFromUrl(post.url)} →
          </a>
        </div>
      )}
    </div>
  );
}

// ─── Sources Footer ───

function SourcesFooter({ stats, expanded, onToggle, darkMode, disabledSources, onToggleSource }: {
  stats: SourceStat[]; expanded: boolean; onToggle: () => void; darkMode: boolean; disabledSources: Set<string>; onToggleSource: (key: string) => void;
}) {
  return (
    <div style={{ marginTop: 16 }}>
      <div onClick={onToggle} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", userSelect: "none", marginBottom: expanded ? 8 : 0 }}>
        <span style={{ color: dk(darkMode, "rgba(255,255,255,0.30)", OS.faint), fontSize: 9, transition: "transform 150ms", transform: expanded ? "rotate(0deg)" : "rotate(-90deg)", display: "inline-block" }}>▼</span>
        <span style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", color: dk(darkMode, "rgba(255,255,255,0.40)", OS.muted) }}>Sources</span>
        <span style={{ fontSize: 11, color: dk(darkMode, "rgba(255,255,255,0.25)", OS.faint), fontWeight: 400 }}>{stats.length}</span>
      </div>
      {expanded && (
        <div style={{ background: dk(darkMode, "rgba(255,255,255,0.03)", OS.white), borderRadius: 8, border: `1px solid ${dk(darkMode, "rgba(255,255,255,0.06)", OS.border)}`, overflow: "hidden" }}>
          {stats.map((s, i) => (
            <div key={s.source} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", borderBottom: i < stats.length - 1 ? `1px solid ${dk(darkMode, "rgba(255,255,255,0.04)", "rgba(0,0,0,0.04)")}` : "none" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", flexShrink: 0, background: s.error ? OS.red : (SOURCE_COLORS[s.source] ?? OS.muted) }} />
              <span style={{ flex: 1, fontSize: 12, color: dk(darkMode, "rgba(255,255,255,0.60)", OS.secondary) }}>{s.name}</span>
              {s.error
                ? <span style={{ fontSize: 10, color: OS.red }}>Failed</span>
                : <span style={{ fontSize: 10, color: dk(darkMode, "rgba(255,255,255,0.30)", OS.faint) }}>{s.count} items · {timeAgo(s.fetchedAt)}</span>}
              <button onClick={(e) => { e.stopPropagation(); onToggleSource(s.source); }} style={{
                fontSize: 10, fontFamily: OS.font, padding: "2px 8px", borderRadius: 4, cursor: "pointer", marginLeft: 4, transition: "all 150ms",
                background: disabledSources.has(s.source) ? dk(darkMode, "rgba(209,67,67,0.1)", "#fef2f2") : dk(darkMode, "rgba(59,140,95,0.1)", "#e8f5ee"),
                border: `1px solid ${disabledSources.has(s.source) ? dk(darkMode, "rgba(209,67,67,0.2)", "#fecaca") : dk(darkMode, "rgba(59,140,95,0.2)", "#bbdfcc")}`,
                color: disabledSources.has(s.source) ? OS.red : OS.green,
              }}>{disabledSources.has(s.source) ? "Off" : "On"}</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function demoSourceStats(): SourceStat[] {
  const now = new Date().toISOString();
  return [
    { source: "anthropic-blog", name: "Anthropic Blog", count: 2, error: null, fetchedAt: now },
    { source: "hacker-news", name: "Hacker News", count: 1, error: null, fetchedAt: now },
    { source: "arxiv", name: "arXiv AI", count: 1, error: null, fetchedAt: now },
    { source: "verge-ai", name: "The Verge AI", count: 1, error: null, fetchedAt: now },
    { source: "openai-blog", name: "OpenAI Blog", count: 1, error: null, fetchedAt: now },
    { source: "huggingface-blog", name: "Hugging Face Blog", count: 1, error: null, fetchedAt: now },
    { source: "techcrunch-ai", name: "TechCrunch AI", count: 1, error: null, fetchedAt: now },
  ];
}
