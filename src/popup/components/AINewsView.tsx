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

// ─── Source colors (brand colors stay consistent in both modes) ───

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
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function relevanceLabel(score: number): { text: string; color: string } {
  if (score >= 9) return { text: "Must read", color: OS.green };
  if (score >= 7) return { text: "High", color: OS.green };
  if (score >= 5) return { text: "Medium", color: OS.warning };
  return { text: "Low", color: OS.muted };
}

function relevanceBorderColor(score: number): string {
  if (score >= 8) return OS.green;
  if (score >= 5) return OS.warning;
  return "transparent";
}

function domainFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace("www.", "");
  } catch {
    return "";
  }
}

/** Categorize a post into a temporal bucket */
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

const TIME_BUCKET_LABELS: Record<string, string> = {
  "today": "Today",
  "yesterday": "Yesterday",
  "this-week": "This Week",
  "older": "Earlier",
};

const TIME_BUCKET_ORDER = ["today", "yesterday", "this-week", "older"];

/** Highlight search matches in text */
function highlightMatch(text: string, query: string, darkMode: boolean): React.ReactNode {
  if (!query.trim()) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <span style={{
        background: dk(darkMode, "rgba(192,122,0,0.25)", OS.yellowBg),
        borderRadius: 2, padding: "0 1px",
      }}>
        {text.slice(idx, idx + query.length)}
      </span>
      {text.slice(idx + query.length)}
    </>
  );
}

// ─── Types ───

interface SourceStat {
  source: string;
  name: string;
  count: number;
  error: string | null;
  fetchedAt: string;
}

interface SourceProgress {
  source: string;
  name: string;
  status: "pending" | "fetching" | "done" | "error";
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

  const livePosts = useLiveQuery(
    () => db.news_posts.orderBy("relevanceScore").reverse().toArray(),
    [],
  );
  const posts: NewsPost[] = demoMode ? DEMO_NEWS_POSTS : (livePosts ?? []);

  const lastFetched = posts?.[0]?.fetchedAt ?? null;
  const unreadCount = useMemo(() => posts.filter((p) => !p.readAt).length, [posts]);

  // Load persisted state
  useEffect(() => {
    if (demoMode) {
      setBriefing(DEMO_NEWS_BRIEFING);
      return;
    }
    chrome.storage.local.get(["newsBriefing", "newsAutoRefresh", "newsSourceStats", "newsDisabledSources"]).then((r) => {
      if (r.newsBriefing) setBriefing(r.newsBriefing);
      if (r.newsAutoRefresh) setAutoRefresh(true);
      if (r.newsSourceStats) setSourceStats(r.newsSourceStats);
      if (r.newsDisabledSources) setDisabledSources(new Set(r.newsDisabledSources));
    });
  }, [demoMode]);

  // ─── Actions ───

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
      if (next.has(sourceKey)) next.delete(sourceKey);
      else next.add(sourceKey);
      chrome.storage.local.set({ newsDisabledSources: [...next] });
      return next;
    });
  }, [demoMode]);

  const handleRefresh = useCallback(() => {
    if (demoMode || refreshing) return;
    setRefreshing(true);
    setError(null);
    const entries = Object.entries(NEWS_SOURCES).filter(([, cfg]) => cfg.enabled);
    setSourceProgress(entries.map(([key, cfg]) => ({
      source: key, name: cfg.name, status: "fetching" as const,
    })));
    chrome.runtime.sendMessage({ type: "REFRESH_NEWS" }).catch(() => {
      setRefreshing(false);
      setError("Failed to start refresh");
      setSourceProgress([]);
    });
  }, [demoMode, refreshing]);

  const handleAutoRefreshToggle = useCallback(() => {
    if (demoMode) return;
    const next = !autoRefresh;
    setAutoRefresh(next);
    chrome.storage.local.set({ newsAutoRefresh: next });
    chrome.runtime.sendMessage({ type: "SET_NEWS_ALARM", enabled: next });
  }, [demoMode, autoRefresh]);

  // Listen for completion + per-source progress
  useEffect(() => {
    const listener = (msg: { type: string; error?: string; sourceStats?: SourceStat[]; source?: string; status?: string }) => {
      if (msg.type === "NEWS_REFRESH_COMPLETE") {
        setRefreshing(false);
        setSourceProgress([]);
        if (msg.error) setError(msg.error);
        if (msg.sourceStats) setSourceStats(msg.sourceStats);
        chrome.storage.local.get("newsBriefing").then((r) => {
          if (r.newsBriefing) setBriefing(r.newsBriefing);
        });
      } else if (msg.type === "NEWS_SOURCE_PROGRESS") {
        setSourceProgress((prev) =>
          prev.map((s) => s.source === msg.source ? { ...s, status: (msg.status as SourceProgress["status"]) ?? "done" } : s),
        );
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  // ─── Computed data ───

  const sourceCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of posts) counts.set(p.source, (counts.get(p.source) ?? 0) + 1);
    return counts;
  }, [posts]);

  const bookmarkedCount = useMemo(() => posts.filter((p) => p.bookmarked).length, [posts]);

  const filteredPosts = useMemo(() => {
    let result = posts;
    if (activeFilter === "bookmarked") result = result.filter((p) => p.bookmarked);
    else if (activeFilter !== "all") result = result.filter((p) => p.source === activeFilter);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((p) => p.title.toLowerCase().includes(q) || p.summary.toLowerCase().includes(q));
    }
    return result;
  }, [posts, activeFilter, searchQuery]);

  // Temporal → topic grouping
  const timeGroups = useMemo(() => {
    if (searchQuery.trim() || (activeFilter !== "all" && activeFilter !== "bookmarked")) return null;
    const buckets = new Map<string, NewsPost[]>();
    for (const p of filteredPosts) {
      const bucket = timeBucket(p.postedAt);
      if (!buckets.has(bucket)) buckets.set(bucket, []);
      buckets.get(bucket)!.push(p);
    }
    const groups: Array<{ bucket: string; label: string; posts: NewsPost[] }> = [];
    for (const bucket of TIME_BUCKET_ORDER) {
      const items = buckets.get(bucket);
      if (items && items.length > 0) {
        items.sort((a, b) => b.relevanceScore - a.relevanceScore);
        groups.push({ bucket, label: TIME_BUCKET_LABELS[bucket], posts: items });
      }
    }
    return groups;
  }, [filteredPosts, searchQuery, activeFilter]);

  // Flat list for keyboard nav
  const flatPosts = useMemo(() => {
    if (timeGroups) return timeGroups.flatMap((g) => g.posts);
    return [...filteredPosts].sort((a, b) => new Date(b.postedAt).getTime() - new Date(a.postedAt).getTime());
  }, [timeGroups, filteredPosts]);

  const toggleExpand = useCallback((post: NewsPost) => {
    if (post.id == null) return;
    setExpandedId((prev) => {
      const expanding = prev !== post.id;
      if (expanding) markRead(post);
      return expanding ? post.id! : null;
    });
  }, [markRead]);

  // ─── Keyboard navigation ───

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.key === "ArrowDown" || e.key === "j") {
      e.preventDefault();
      setFocusedIndex((prev) => {
        const next = Math.min(prev + 1, flatPosts.length - 1);
        const post = flatPosts[next];
        if (post?.id != null) postRefs.current.get(post.id)?.scrollIntoView({ block: "center", behavior: "smooth" });
        return next;
      });
    } else if (e.key === "ArrowUp" || e.key === "k") {
      e.preventDefault();
      setFocusedIndex((prev) => {
        const next = Math.max(prev - 1, 0);
        const post = flatPosts[next];
        if (post?.id != null) postRefs.current.get(post.id)?.scrollIntoView({ block: "center", behavior: "smooth" });
        return next;
      });
    } else if (e.key === "Enter") {
      e.preventDefault();
      const post = flatPosts[focusedIndex];
      if (post) toggleExpand(post);
    } else if (e.key === "Escape") {
      setExpandedId(null);
    } else if (e.key === "b" && focusedIndex >= 0) {
      const post = flatPosts[focusedIndex];
      if (post?.id != null && !demoMode) db.news_posts.update(post.id, { bookmarked: !post.bookmarked });
    } else if (e.key === "o" && focusedIndex >= 0) {
      const post = flatPosts[focusedIndex];
      if (post?.url) window.open(post.url, "_blank", "noopener,noreferrer");
    }
  }, [flatPosts, focusedIndex, toggleExpand, demoMode]);

  // ─── Filter pill entries ───

  const sourceEntries = Object.entries(NEWS_SOURCES)
    .filter(([key]) => sourceCounts.has(key) || demoMode)
    .map(([key, cfg]) => ({ key, shortName: cfg.shortName, count: sourceCounts.get(key) ?? 0 }));

  // ─── Render ───

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      style={{ fontFamily: OS.font, outline: "none" }}
    >
      {/* ─── Header ─── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 0 12px",
      }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <h2 style={{
              margin: 0, fontSize: 18, fontWeight: 700,
              color: dk(darkMode, "#e0e0e0", OS.text),
            }}>
              AI News
            </h2>
            {unreadCount > 0 && (
              <span style={{
                fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 9999,
                background: dk(darkMode, "rgba(94,106,210,0.25)", OS.blueBg),
                color: dk(darkMode, "#8b95e0", OS.blue),
              }}>
                {unreadCount} new
              </span>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
            {lastFetched && (
              <span style={{ fontSize: 11, color: dk(darkMode, "rgba(255,255,255,0.45)", OS.muted) }}>
                Updated {timeAgo(lastFetched)}
              </span>
            )}
            {autoRefresh && (
              <span style={{ fontSize: 10, color: dk(darkMode, "rgba(255,255,255,0.30)", OS.faint) }}>
                Auto every 30m
              </span>
            )}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button
            onClick={handleAutoRefreshToggle}
            style={{
              fontSize: 11, fontFamily: OS.font, padding: "4px 10px", borderRadius: 6,
              cursor: "pointer", transition: "all 150ms",
              background: autoRefresh
                ? dk(darkMode, "rgba(59,140,95,0.2)", "rgba(59,140,95,0.1)")
                : "transparent",
              border: `1px solid ${autoRefresh
                ? dk(darkMode, "rgba(59,140,95,0.4)", OS.green + "40")
                : dk(darkMode, "rgba(255,255,255,0.10)", OS.border)}`,
              color: autoRefresh ? OS.green : dk(darkMode, "rgba(255,255,255,0.40)", OS.muted),
            }}
          >
            Auto
          </button>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            style={{
              fontSize: 12, fontWeight: 600, fontFamily: OS.font,
              padding: "5px 14px", borderRadius: 6, cursor: refreshing ? "default" : "pointer",
              background: dk(darkMode, "rgba(94,106,210,0.15)", OS.blueBg),
              border: `1px solid ${dk(darkMode, "rgba(94,106,210,0.3)", OS.blue + "40")}`,
              color: dk(darkMode, "#8b95e0", OS.blue),
              opacity: refreshing ? 0.6 : 1, transition: "all 150ms",
            }}
          >
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      {/* ─── Search ─── */}
      {posts.length > 0 && (
        <div style={{ marginBottom: 10, position: "relative" }}>
          <input
            type="text"
            placeholder="Search news..."
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setFocusedIndex(-1); }}
            style={{
              width: "100%", boxSizing: "border-box",
              padding: "7px 12px", borderRadius: 8,
              fontSize: 12, fontFamily: OS.font,
              background: dk(darkMode, "rgba(255,255,255,0.06)", OS.white),
              border: `1px solid ${dk(darkMode, "rgba(255,255,255,0.10)", OS.border)}`,
              color: dk(darkMode, "#e0e0e0", OS.text),
              outline: "none",
            }}
          />
          {searchQuery && (
            <span style={{
              position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)",
              fontSize: 11, fontWeight: 500,
              color: filteredPosts.length > 0
                ? dk(darkMode, "rgba(255,255,255,0.45)", OS.muted)
                : OS.red,
            }}>
              {filteredPosts.length} of {posts.length}
            </span>
          )}
        </div>
      )}

      {/* ─── Error ─── */}
      {error && (
        <div style={{
          padding: "8px 12px", marginBottom: 10, borderRadius: 6, fontSize: 12,
          background: dk(darkMode, "rgba(209,67,67,0.1)", "#fef2f2"),
          border: `1px solid ${dk(darkMode, "rgba(209,67,67,0.2)", "#fecaca")}`,
          color: OS.red,
        }}>
          {error}
        </div>
      )}

      {/* ─── Per-source loading progress ─── */}
      {refreshing && sourceProgress.length > 0 && (
        <div style={{
          padding: "10px 14px", marginBottom: 10, borderRadius: 8,
          background: dk(darkMode, "rgba(255,255,255,0.04)", OS.white),
          border: `1px solid ${dk(darkMode, "rgba(255,255,255,0.08)", OS.border)}`,
        }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {sourceProgress.map((sp) => (
              <span key={sp.source} style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                fontSize: 11, padding: "3px 8px", borderRadius: 6,
                background: sp.status === "done"
                  ? dk(darkMode, "rgba(59,140,95,0.15)", "#e8f5ee")
                  : sp.status === "error"
                    ? dk(darkMode, "rgba(209,67,67,0.1)", "#fef2f2")
                    : dk(darkMode, "rgba(255,255,255,0.06)", OS.bg),
                color: sp.status === "done" ? OS.green
                  : sp.status === "error" ? OS.red
                    : dk(darkMode, "rgba(255,255,255,0.50)", OS.secondary),
                transition: "all 300ms",
              }}>
                <span style={{ fontSize: 10 }}>
                  {sp.status === "done" ? "✓" : sp.status === "error" ? "✗" : "⟳"}
                </span>
                {sp.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ─── Briefing ─── */}
      {briefing && posts.length > 0 && (
        <BriefingCard
          briefing={briefing}
          expanded={briefingExpanded}
          onToggle={() => setBriefingExpanded(!briefingExpanded)}
          darkMode={darkMode}
        />
      )}

      {/* ─── Empty state ─── */}
      {(!posts || posts.length === 0) && !refreshing && (
        <div style={{
          textAlign: "center", padding: "48px 24px",
          display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
        }}>
          <div style={{
            width: 48, height: 48, borderRadius: "50%",
            background: dk(darkMode, "rgba(94,106,210,0.15)", OS.blueBg),
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <span style={{ fontSize: 22 }}>📡</span>
          </div>
          <div style={{ fontSize: 15, fontWeight: 600, color: dk(darkMode, "#e0e0e0", OS.text) }}>
            No news yet
          </div>
          <div style={{
            fontSize: 13, color: dk(darkMode, "rgba(255,255,255,0.50)", OS.muted),
            lineHeight: 1.6, maxWidth: 260,
          }}>
            Click Refresh to fetch AI news from {Object.keys(NEWS_SOURCES).length} sources
          </div>
        </div>
      )}

      {/* ─── Loading skeleton ─── */}
      {refreshing && (!posts || posts.length === 0) && sourceProgress.length === 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "12px 0" }}>
          {[1, 2, 3].map((i) => (
            <div key={i} style={{
              height: 56, borderRadius: 8,
              background: dk(darkMode, "rgba(255,255,255,0.04)", OS.bg),
              border: `1px solid ${dk(darkMode, "rgba(255,255,255,0.06)", OS.border)}`,
            }} />
          ))}
        </div>
      )}

      {/* ─── Filter pills ─── */}
      {posts.length > 0 && (
        <div style={{ display: "flex", gap: 5, marginBottom: 10, flexWrap: "wrap" }}>
          <FilterPill label="All" count={posts.length} active={activeFilter === "all"}
            color={OS.blue} darkMode={darkMode}
            onClick={() => { setActiveFilter("all"); setFocusedIndex(-1); }} />
          {bookmarkedCount > 0 && (
            <FilterPill label="★ Saved" count={bookmarkedCount} active={activeFilter === "bookmarked"}
              color={OS.warning} darkMode={darkMode}
              onClick={() => { setActiveFilter("bookmarked"); setFocusedIndex(-1); }} />
          )}
          {sourceEntries.map(({ key, shortName, count }) => (
            <FilterPill key={key} label={shortName} count={count}
              active={activeFilter === key} color={SOURCE_COLORS[key] ?? OS.muted}
              darkMode={darkMode}
              onClick={() => { setActiveFilter(key); setFocusedIndex(-1); }} />
          ))}
        </div>
      )}

      {/* ─── Keyboard hints ─── */}
      {posts.length > 0 && (
        <div style={{
          fontSize: 10, color: dk(darkMode, "rgba(255,255,255,0.30)", OS.faint),
          marginBottom: 8, padding: "4px 0",
          borderBottom: `1px solid ${dk(darkMode, "rgba(255,255,255,0.06)", OS.border)}`,
        }}>
          ↑↓ or j/k navigate · Enter expand · b bookmark · o open · Esc close
        </div>
      )}

      {/* ─── Post list: temporal groups or flat ─── */}
      {timeGroups ? (
        timeGroups.map((group) => (
          <div key={group.bucket} style={{ marginBottom: 4 }}>
            {/* Section header — Clyde SectionHeader pattern */}
            <div style={{
              display: "flex", alignItems: "center", gap: 6,
              marginTop: 14, marginBottom: 8, paddingTop: 10,
              borderTop: group.bucket !== "today"
                ? `1px solid ${dk(darkMode, "rgba(255,255,255,0.06)", OS.border)}`
                : "none",
            }}>
              <div style={{
                width: 3, height: 14, borderRadius: 2,
                background: group.bucket === "today" ? OS.blue : dk(darkMode, "rgba(255,255,255,0.15)", OS.faint),
                flexShrink: 0,
              }} />
              <span style={{
                fontSize: 12, fontWeight: 600, textTransform: "uppercase",
                letterSpacing: "0.04em",
                color: dk(darkMode, "rgba(255,255,255,0.50)", OS.muted),
              }}>
                {group.label}
              </span>
              <span style={{
                fontSize: 11, fontWeight: 400,
                color: dk(darkMode, "rgba(255,255,255,0.30)", OS.faint),
              }}>
                {group.posts.length}
              </span>
            </div>
            {group.posts.map((post) => {
              const idx = flatPosts.indexOf(post);
              return (
                <PostCard
                  key={post.id}
                  post={post}
                  expanded={expandedId === post.id}
                  focused={focusedIndex === idx}
                  hovered={hoveredId === post.id}
                  onToggle={() => toggleExpand(post)}
                  onBookmark={(e) => toggleBookmark(e, post)}
                  onHover={(h) => setHoveredId(h ? (post.id ?? null) : null)}
                  darkMode={darkMode}
                  searchQuery={searchQuery}
                  refCallback={(el) => {
                    if (post.id != null) {
                      if (el) postRefs.current.set(post.id, el);
                      else postRefs.current.delete(post.id!);
                    }
                  }}
                />
              );
            })}
          </div>
        ))
      ) : (
        flatPosts.map((post) => {
          const idx = flatPosts.indexOf(post);
          return (
            <PostCard
              key={post.id}
              post={post}
              expanded={expandedId === post.id}
              focused={focusedIndex === idx}
              hovered={hoveredId === post.id}
              onToggle={() => toggleExpand(post)}
              onBookmark={(e) => toggleBookmark(e, post)}
              onHover={(h) => setHoveredId(h ? (post.id ?? null) : null)}
              darkMode={darkMode}
              searchQuery={searchQuery}
              refCallback={(el) => {
                if (post.id != null) {
                  if (el) postRefs.current.set(post.id, el);
                  else postRefs.current.delete(post.id!);
                }
              }}
            />
          );
        })
      )}

      {/* ─── No search results ─── */}
      {searchQuery && filteredPosts.length === 0 && (
        <div style={{
          textAlign: "center", padding: "24px 20px",
          color: dk(darkMode, "rgba(255,255,255,0.45)", OS.muted), fontSize: 13,
        }}>
          No posts matching "{searchQuery}"
        </div>
      )}

      {/* ─── Sources footer ─── */}
      {(sourceStats.length > 0 || demoMode) && (
        <SourcesFooter
          stats={demoMode ? demoSourceStats() : sourceStats}
          expanded={sourcesExpanded}
          onToggle={() => setSourcesExpanded(!sourcesExpanded)}
          darkMode={darkMode}
          disabledSources={disabledSources}
          onToggleSource={toggleSource}
        />
      )}
    </div>
  );
}

// ─── Briefing Card ───

function BriefingCard({
  briefing, expanded, onToggle, darkMode,
}: {
  briefing: string; expanded: boolean; onToggle: () => void; darkMode: boolean;
}) {
  const bullets = briefing.split("\n").filter((l) => l.trim());
  const preview = bullets.slice(0, 3);
  const rest = bullets.slice(3);

  return (
    <div
      onClick={onToggle}
      style={{
        padding: "10px 14px", marginBottom: 10, borderRadius: 8, cursor: "pointer",
        background: dk(darkMode, "rgba(94,106,210,0.06)", OS.blueBg),
        border: `1px solid ${dk(darkMode, "rgba(94,106,210,0.15)", OS.blue + "20")}`,
        borderLeft: `3px solid ${OS.blue}`,
      }}
    >
      <div style={{
        fontSize: 11, fontWeight: 600, textTransform: "uppercase",
        letterSpacing: "0.04em", marginBottom: 6,
        color: dk(darkMode, "rgba(94,106,210,0.8)", OS.blue),
      }}>
        Daily Briefing
      </div>
      {preview.map((line, i) => (
        <div key={i} style={{
          fontSize: 12, lineHeight: 1.55,
          color: dk(darkMode, "rgba(255,255,255,0.80)", OS.text),
        }}>
          {line}
        </div>
      ))}
      {expanded && rest.length > 0 && rest.map((line, i) => (
        <div key={`r${i}`} style={{
          fontSize: 12, lineHeight: 1.55,
          color: dk(darkMode, "rgba(255,255,255,0.80)", OS.text),
        }}>
          {line}
        </div>
      ))}
      {!expanded && rest.length > 0 && (
        <div style={{
          fontSize: 11, color: dk(darkMode, "rgba(255,255,255,0.30)", OS.faint),
          marginTop: 4,
        }}>
          +{rest.length} more
        </div>
      )}
    </div>
  );
}

// ─── Filter Pill ───

function FilterPill({
  label, count, active, color, darkMode, onClick,
}: {
  label: string; count: number; active: boolean; color: string; darkMode: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 4,
        padding: "3px 8px", borderRadius: 9999, cursor: "pointer",
        fontSize: 10, fontWeight: 500, fontFamily: OS.font,
        transition: "all 150ms",
        background: active ? color + "20" : "transparent",
        border: `1px solid ${active ? color + "50" : dk(darkMode, "rgba(255,255,255,0.10)", OS.border)}`,
        color: active ? color : dk(darkMode, "rgba(255,255,255,0.50)", OS.secondary),
      }}
    >
      {!label.startsWith("★") && (
        <span style={{
          width: 5, height: 5, borderRadius: "50%",
          background: color, flexShrink: 0,
        }} />
      )}
      {label}
      <span style={{ fontSize: 9, opacity: 0.6 }}>{count}</span>
    </button>
  );
}

// ─── Post Card — Clyde-native, tiered by relevance ───

function PostCard({
  post, expanded, focused, hovered, onToggle, onBookmark, onHover, darkMode, searchQuery, refCallback,
}: {
  post: NewsPost;
  expanded: boolean;
  focused: boolean;
  hovered: boolean;
  onToggle: () => void;
  onBookmark: (e: React.MouseEvent) => void;
  onHover: (h: boolean) => void;
  darkMode: boolean;
  searchQuery: string;
  refCallback: (el: HTMLDivElement | null) => void;
}) {
  const sourceColor = SOURCE_COLORS[post.source] ?? OS.muted;
  const isRead = !!post.readAt;
  const isHero = post.relevanceScore >= 9;
  const isCompact = post.relevanceScore <= 4;
  const rl = relevanceLabel(post.relevanceScore);

  const isActive = expanded || hovered || focused;
  const bgBase = dk(darkMode, "transparent", "transparent");
  const bgHover = dk(darkMode, "rgba(255,255,255,0.04)", OS.bg);
  const bgExpanded = dk(darkMode, "rgba(255,255,255,0.06)", OS.bg);

  // ─── Compact card ───
  if (isCompact && !expanded) {
    return (
      <div
        ref={refCallback}
        onClick={onToggle}
        onMouseEnter={() => onHover(true)}
        onMouseLeave={() => onHover(false)}
        style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "5px 16px", cursor: "pointer",
          background: isActive ? bgHover : bgBase,
          borderBottom: `1px solid ${dk(darkMode, "rgba(255,255,255,0.04)", "rgba(0,0,0,0.04)")}`,
          opacity: isRead ? 0.55 : 0.75,
          boxShadow: focused ? `inset 3px 0 0 ${OS.blue}` : "none",
          transition: "background 0.1s ease, box-shadow 0.1s ease",
        }}
      >
        <span style={{
          width: 5, height: 5, borderRadius: "50%",
          background: sourceColor, flexShrink: 0,
        }} />
        <span style={{
          fontSize: 12, fontWeight: isRead ? 400 : 500,
          color: dk(darkMode, "rgba(255,255,255,0.55)", OS.secondary),
          flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
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

  // ─── Hero card (9-10) — elevated, tinted background ───
  if (isHero) {
    return (
      <div
        ref={refCallback}
        onClick={onToggle}
        onMouseEnter={() => onHover(true)}
        onMouseLeave={() => onHover(false)}
        style={{
          padding: expanded ? "14px 16px" : "11px 16px",
          cursor: "pointer",
          background: expanded
            ? dk(darkMode, "rgba(59,140,95,0.06)", "#f0faf4")
            : isActive
              ? dk(darkMode, "rgba(59,140,95,0.04)", "#f5fbf7")
              : bgBase,
          borderBottom: `1px solid ${dk(darkMode, "rgba(255,255,255,0.06)", OS.border)}`,
          borderLeft: `${expanded ? 6 : 4}px solid ${OS.green}`,
          opacity: isRead ? 0.8 : 1,
          boxShadow: focused ? `0 0 0 2px ${dk(darkMode, "rgba(94,106,210,0.4)", OS.blue + "40")}` : "none",
          transition: "background 0.1s ease, border-left-width 0.15s ease, box-shadow 0.1s ease",
        }}
      >
        {/* Main row */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <div style={{ flex: 1 }}>
            {/* Title */}
            <div style={{
              fontSize: 15, lineHeight: 1.4, fontWeight: 700,
              color: dk(darkMode, "#f0f0f0", OS.text),
            }}>
              {!isRead && (
                <span style={{
                  display: "inline-block", width: 6, height: 6, borderRadius: "50%",
                  background: OS.blue, marginRight: 6, verticalAlign: "middle",
                }} />
              )}
              {highlightMatch(post.title, searchQuery, darkMode)}
            </div>
            {/* Metadata row */}
            <div style={{
              display: "flex", alignItems: "center", gap: 5, marginTop: 4,
              fontSize: 11, color: dk(darkMode, "rgba(255,255,255,0.55)", OS.secondary),
              flexWrap: "wrap", rowGap: 2,
            }}>
              <span style={{
                width: 6, height: 6, borderRadius: "50%",
                background: sourceColor, flexShrink: 0,
              }} />
              <span style={{ fontWeight: 500 }}>{post.sourceName}</span>
              <span style={{
                fontSize: 10, fontWeight: 600, padding: "1px 5px", borderRadius: 3,
                background: rl.color + "18", color: rl.color,
              }}>
                {rl.text}
              </span>
              {post.topicTag && (
                <span style={{
                  fontSize: 10, color: dk(darkMode, "rgba(255,255,255,0.35)", OS.muted),
                }}>
                  {post.topicTag}
                </span>
              )}
              <span style={{ marginLeft: "auto", fontSize: 11, color: dk(darkMode, "rgba(255,255,255,0.35)", OS.faint) }}>
                {post.postedAt ? timeAgo(post.postedAt) : ""}
              </span>
            </div>
            {/* Summary always visible for hero */}
            <div style={{
              fontSize: 13, lineHeight: 1.55, marginTop: 6,
              color: dk(darkMode, "rgba(255,255,255,0.65)", OS.secondary),
            }}>
              {highlightMatch(post.summary, searchQuery, darkMode)}
            </div>
          </div>
          {/* Bookmark */}
          <button
            onClick={onBookmark}
            style={{
              background: "none", border: "none", cursor: "pointer", padding: "4px 8px",
              fontSize: 14, color: post.bookmarked ? OS.warning : dk(darkMode, "rgba(255,255,255,0.15)", OS.faint),
              transition: "color 150ms", flexShrink: 0,
            }}
          >
            {post.bookmarked ? "★" : "☆"}
          </button>
        </div>

        {/* Expanded detail */}
        {expanded && (
          <div style={{
            marginTop: 10, paddingTop: 10,
            borderTop: `1px solid ${dk(darkMode, "rgba(255,255,255,0.06)", OS.border)}`,
          }}>
            {post.author && (
              <div style={{ fontSize: 11, color: dk(darkMode, "rgba(255,255,255,0.40)", OS.faint), marginBottom: 6 }}>
                by {post.author}
              </div>
            )}
            {post.rawText && post.rawText !== post.title && (
              <div style={{
                fontSize: 12, lineHeight: 1.55,
                color: dk(darkMode, "rgba(255,255,255,0.50)", OS.secondary),
                paddingLeft: 12, borderLeft: `2px solid ${dk(darkMode, "rgba(255,255,255,0.10)", OS.faint)}`,
                fontStyle: "italic",
              }}>
                {post.rawText.slice(0, 400)}{post.rawText.length > 400 && "..."}
              </div>
            )}
            <a
              href={post.url} target="_blank" rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              style={{
                display: "inline-block", marginTop: 8,
                fontSize: 11, color: OS.blue, textDecoration: "none", fontWeight: 600,
              }}
            >
              {domainFromUrl(post.url)} →
            </a>
          </div>
        )}
      </div>
    );
  }

  // ─── Standard card (5-8) — progressive disclosure ───
  return (
    <div
      ref={refCallback}
      onClick={onToggle}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      style={{
        padding: expanded ? "14px 16px" : "11px 16px",
        cursor: "pointer",
        background: expanded ? bgExpanded : isActive ? bgHover : bgBase,
        borderBottom: `1px solid ${dk(darkMode, "rgba(255,255,255,0.06)", OS.border)}`,
        borderLeft: `3px solid ${relevanceBorderColor(post.relevanceScore)}`,
        opacity: isRead ? 0.7 : 1,
        boxShadow: focused ? `0 0 0 2px ${dk(darkMode, "rgba(94,106,210,0.4)", OS.blue + "40")}` : "none",
        transition: "background 0.1s ease, box-shadow 0.1s ease",
      }}
    >
      {/* Main row */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{ flex: 1 }}>
          {/* Title */}
          <div style={{
            fontSize: 14, lineHeight: 1.4, fontWeight: isRead ? 500 : 600,
            color: dk(darkMode, isRead ? "rgba(255,255,255,0.70)" : "#e0e0e0", isRead ? OS.secondary : OS.text),
          }}>
            {!isRead && (
              <span style={{
                display: "inline-block", width: 5, height: 5, borderRadius: "50%",
                background: OS.blue, marginRight: 6, verticalAlign: "middle",
              }} />
            )}
            {highlightMatch(post.title, searchQuery, darkMode)}
          </div>
          {/* Metadata row */}
          <div style={{
            display: "flex", alignItems: "center", gap: 5, marginTop: 3,
            fontSize: 12, color: dk(darkMode, "rgba(255,255,255,0.55)", OS.secondary),
            flexWrap: "wrap", rowGap: 2,
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: "50%",
              background: sourceColor, flexShrink: 0,
            }} />
            <span>{post.sourceName}</span>
            <span style={{
              fontSize: 10, fontWeight: 600, padding: "1px 5px", borderRadius: 3,
              background: rl.color + "18", color: rl.color,
            }}>
              {rl.text}
            </span>
            <span style={{ marginLeft: "auto", fontSize: 11, color: dk(darkMode, "rgba(255,255,255,0.35)", OS.faint) }}>
              {post.postedAt ? timeAgo(post.postedAt) : ""}
            </span>
          </div>
        </div>
        {/* Bookmark */}
        <button
          onClick={onBookmark}
          style={{
            background: "none", border: "none", cursor: "pointer", padding: "4px 8px",
            fontSize: 13, color: post.bookmarked ? OS.warning : dk(darkMode, "rgba(255,255,255,0.15)", OS.faint),
            transition: "color 150ms", flexShrink: 0,
          }}
        >
          {post.bookmarked ? "★" : "☆"}
        </button>
      </div>

      {/* Expanded detail — summary + raw text + link */}
      {expanded && (
        <div style={{
          marginTop: 10, paddingTop: 10,
          borderTop: `1px solid ${dk(darkMode, "rgba(255,255,255,0.06)", OS.border)}`,
        }}>
          <div style={{
            fontSize: 13, lineHeight: 1.55, marginBottom: 8,
            color: dk(darkMode, "rgba(255,255,255,0.70)", OS.secondary),
          }}>
            {highlightMatch(post.summary, searchQuery, darkMode)}
          </div>
          {post.author && (
            <div style={{ fontSize: 11, color: dk(darkMode, "rgba(255,255,255,0.40)", OS.faint), marginBottom: 6 }}>
              by {post.author}
            </div>
          )}
          {post.rawText && post.rawText !== post.title && post.rawText !== post.summary && (
            <div style={{
              fontSize: 12, lineHeight: 1.55,
              color: dk(darkMode, "rgba(255,255,255,0.45)", OS.secondary),
              paddingLeft: 12, borderLeft: `2px solid ${dk(darkMode, "rgba(255,255,255,0.08)", OS.faint)}`,
              fontStyle: "italic",
            }}>
              {post.rawText.slice(0, 300)}{post.rawText.length > 300 && "..."}
            </div>
          )}
          <a
            href={post.url} target="_blank" rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            style={{
              display: "inline-block", marginTop: 8,
              fontSize: 11, color: OS.blue, textDecoration: "none", fontWeight: 600,
            }}
          >
            {domainFromUrl(post.url)} →
          </a>
        </div>
      )}
    </div>
  );
}

// ─── Sources Footer ───

function SourcesFooter({
  stats, expanded, onToggle, darkMode, disabledSources, onToggleSource,
}: {
  stats: SourceStat[]; expanded: boolean; onToggle: () => void; darkMode: boolean;
  disabledSources: Set<string>; onToggleSource: (key: string) => void;
}) {
  return (
    <div style={{ marginTop: 16 }}>
      <div
        onClick={onToggle}
        style={{
          display: "flex", alignItems: "center", gap: 6, cursor: "pointer",
          userSelect: "none", marginBottom: expanded ? 8 : 0,
        }}
      >
        <span style={{
          color: dk(darkMode, "rgba(255,255,255,0.30)", OS.faint),
          fontSize: 9, transition: "transform 150ms",
          transform: expanded ? "rotate(0deg)" : "rotate(-90deg)",
          display: "inline-block",
        }}>
          ▼
        </span>
        <span style={{
          fontSize: 11, fontWeight: 600, textTransform: "uppercase",
          letterSpacing: "0.04em",
          color: dk(darkMode, "rgba(255,255,255,0.40)", OS.muted),
        }}>
          Sources
        </span>
        <span style={{
          fontSize: 11, color: dk(darkMode, "rgba(255,255,255,0.25)", OS.faint),
          fontWeight: 400,
        }}>
          {stats.length}
        </span>
      </div>
      {expanded && (
        <div style={{
          background: dk(darkMode, "rgba(255,255,255,0.03)", OS.white),
          borderRadius: 8,
          border: `1px solid ${dk(darkMode, "rgba(255,255,255,0.06)", OS.border)}`,
          overflow: "hidden",
        }}>
          {stats.map((s, i) => (
            <div
              key={s.source}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "8px 14px",
                borderBottom: i < stats.length - 1
                  ? `1px solid ${dk(darkMode, "rgba(255,255,255,0.04)", "rgba(0,0,0,0.04)")}`
                  : "none",
              }}
            >
              <span style={{
                width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
                background: s.error ? OS.red : (SOURCE_COLORS[s.source] ?? OS.muted),
              }} />
              <span style={{
                flex: 1, fontSize: 12,
                color: dk(darkMode, "rgba(255,255,255,0.60)", OS.secondary),
              }}>
                {s.name}
              </span>
              {s.error ? (
                <span style={{ fontSize: 10, color: OS.red }}>Failed</span>
              ) : (
                <span style={{
                  fontSize: 10,
                  color: dk(darkMode, "rgba(255,255,255,0.30)", OS.faint),
                }}>
                  {s.count} items · {timeAgo(s.fetchedAt)}
                </span>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); onToggleSource(s.source); }}
                style={{
                  fontSize: 10, fontFamily: OS.font, padding: "2px 8px", borderRadius: 4,
                  cursor: "pointer", marginLeft: 4, transition: "all 150ms",
                  background: disabledSources.has(s.source)
                    ? dk(darkMode, "rgba(209,67,67,0.1)", "#fef2f2")
                    : dk(darkMode, "rgba(59,140,95,0.1)", "#e8f5ee"),
                  border: `1px solid ${disabledSources.has(s.source)
                    ? dk(darkMode, "rgba(209,67,67,0.2)", "#fecaca")
                    : dk(darkMode, "rgba(59,140,95,0.2)", "#bbdfcc")}`,
                  color: disabledSources.has(s.source) ? OS.red : OS.green,
                }}
              >
                {disabledSources.has(s.source) ? "Off" : "On"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Demo source stats ───

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
