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

const TOPIC_ORDER = [
  "Claude & Anthropic",
  "Agents & Workflows",
  "Research",
  "Tools & Infra",
  "Industry",
  "Open Source",
];

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

function relevanceBorder(score: number): string {
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

// ─── Source Stats type ───

interface SourceStat {
  source: string;
  name: string;
  count: number;
  error: string | null;
  fetchedAt: string;
}

// ─── Source progress type (per-source loading) ───

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
  const [briefingExpanded, setBriefingExpanded] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [sourceStats, setSourceStats] = useState<SourceStat[]>([]);
  const [sourcesExpanded, setSourcesExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [sourceProgress, setSourceProgress] = useState<SourceProgress[]>([]);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [disabledSources, setDisabledSources] = useState<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);
  const postRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const livePosts = useLiveQuery(
    () => db.news_posts.orderBy("relevanceScore").reverse().toArray(),
    [],
  );
  const posts: NewsPost[] = demoMode ? DEMO_NEWS_POSTS : (livePosts ?? []);

  const lastFetched = posts?.[0]?.fetchedAt ?? null;

  // Unread count
  const unreadCount = useMemo(() => posts.filter((p) => !p.readAt).length, [posts]);

  // Load briefing + auto-refresh state + source stats
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

  // ─── Toggle source enabled/disabled ───

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

  // ─── Mark post as read ───

  const markRead = useCallback((post: NewsPost) => {
    if (demoMode || post.readAt) return;
    if (post.id != null) {
      db.news_posts.update(post.id, { readAt: new Date().toISOString() });
    }
  }, [demoMode]);

  // ─── Toggle bookmark ───

  const toggleBookmark = useCallback((e: React.MouseEvent, post: NewsPost) => {
    e.stopPropagation();
    if (demoMode || post.id == null) return;
    db.news_posts.update(post.id, { bookmarked: !post.bookmarked });
  }, [demoMode]);

  const handleRefresh = useCallback(() => {
    if (demoMode || refreshing) return;
    setRefreshing(true);
    setError(null);
    // Initialize per-source progress
    const entries = Object.entries(NEWS_SOURCES).filter(([, cfg]) => cfg.enabled);
    setSourceProgress(entries.map(([key, cfg]) => ({
      source: key,
      name: cfg.name,
      status: "fetching" as const,
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
          prev.map((s) =>
            s.source === msg.source
              ? { ...s, status: (msg.status as SourceProgress["status"]) ?? "done" }
              : s,
          ),
        );
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  // ─── Source counts for filter pills ───

  const sourceCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of posts) {
      counts.set(p.source, (counts.get(p.source) ?? 0) + 1);
    }
    return counts;
  }, [posts]);

  // ─── Bookmarked count ───

  const bookmarkedCount = useMemo(() => posts.filter((p) => p.bookmarked).length, [posts]);

  // ─── Filtered + searched + grouped posts ───

  const filteredPosts = useMemo(() => {
    let result = posts;
    if (activeFilter === "bookmarked") {
      result = result.filter((p) => p.bookmarked);
    } else if (activeFilter !== "all") {
      result = result.filter((p) => p.source === activeFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (p) => p.title.toLowerCase().includes(q) || p.summary.toLowerCase().includes(q),
      );
    }
    return result;
  }, [posts, activeFilter, searchQuery]);

  const topicGroups = useMemo(() => {
    if (activeFilter !== "all" || searchQuery.trim()) return null;
    const groups = new Map<string, NewsPost[]>();
    for (const p of filteredPosts) {
      const tag = p.topicTag || "Industry";
      if (!groups.has(tag)) groups.set(tag, []);
      groups.get(tag)!.push(p);
    }
    const sorted: Array<{ topic: string; items: NewsPost[] }> = [];
    for (const topic of TOPIC_ORDER) {
      const items = groups.get(topic);
      if (items && items.length > 0) {
        items.sort((a, b) => b.relevanceScore - a.relevanceScore);
        sorted.push({ topic, items });
      }
    }
    for (const [topic, items] of groups) {
      if (!TOPIC_ORDER.includes(topic)) {
        items.sort((a, b) => b.relevanceScore - a.relevanceScore);
        sorted.push({ topic, items });
      }
    }
    return sorted;
  }, [filteredPosts, activeFilter, searchQuery]);

  // Flat list for keyboard nav
  const flatPosts = useMemo(() => {
    if (topicGroups) {
      return topicGroups.flatMap((g) => g.items);
    }
    return [...filteredPosts].sort(
      (a, b) => new Date(b.postedAt).getTime() - new Date(a.postedAt).getTime(),
    );
  }, [topicGroups, filteredPosts]);

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
        if (post?.id != null) {
          postRefs.current.get(post.id)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }
        return next;
      });
    } else if (e.key === "ArrowUp" || e.key === "k") {
      e.preventDefault();
      setFocusedIndex((prev) => {
        const next = Math.max(prev - 1, 0);
        const post = flatPosts[next];
        if (post?.id != null) {
          postRefs.current.get(post.id)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }
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
      if (post && post.id != null && !demoMode) {
        db.news_posts.update(post.id, { bookmarked: !post.bookmarked });
      }
    } else if (e.key === "o" && focusedIndex >= 0) {
      const post = flatPosts[focusedIndex];
      if (post?.url) {
        window.open(post.url, "_blank", "noopener,noreferrer");
      }
    }
  }, [flatPosts, focusedIndex, toggleExpand, demoMode]);

  // ─── Source list for filters ───

  const sourceEntries = Object.entries(NEWS_SOURCES)
    .filter(([key]) => sourceCounts.has(key) || demoMode)
    .map(([key, cfg]) => ({ key, shortName: cfg.shortName, count: sourceCounts.get(key) ?? 0 }));

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      style={{ fontFamily: OS.font, outline: "none" }}
    >
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 12,
      }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <h2 style={{
              margin: 0, fontSize: 15, fontWeight: 600,
              color: dk(darkMode, "#e0e0e0", OS.text),
            }}>
              AI News
            </h2>
            {unreadCount > 0 && (
              <span style={{
                fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 9999,
                background: dk(darkMode, "rgba(94,106,210,0.25)", OS.blueBg),
                color: dk(darkMode, "#8b95e0", OS.blue),
              }}>
                {unreadCount} new
              </span>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {lastFetched && (
              <span style={{ fontSize: 11, color: OS.muted }}>
                Updated {timeAgo(lastFetched)}
              </span>
            )}
            {autoRefresh && (
              <span style={{ fontSize: 10, color: dk(darkMode, "rgba(255,255,255,0.25)", OS.faint) }}>
                Auto-refreshes every 30m
              </span>
            )}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
                : dk(darkMode, "rgba(255,255,255,0.08)", OS.border)}`,
              color: autoRefresh
                ? OS.green
                : dk(darkMode, "rgba(255,255,255,0.35)", OS.muted),
            }}
          >
            Auto
          </button>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            style={{
              fontSize: 12, fontWeight: 600, fontFamily: OS.font,
              padding: "5px 12px", borderRadius: 6, cursor: refreshing ? "default" : "pointer",
              background: dk(darkMode, "rgba(94,106,210,0.15)", OS.blueBg),
              border: `1px solid ${dk(darkMode, "rgba(94,106,210,0.3)", OS.blue + "40")}`,
              color: dk(darkMode, "#8b95e0", OS.blue),
              opacity: refreshing ? 0.6 : 1,
            }}
          >
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      {/* Search bar */}
      {posts.length > 0 && (
        <div style={{ marginBottom: 12, position: "relative" }}>
          <span style={{
            position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)",
            fontSize: 12, color: dk(darkMode, "rgba(255,255,255,0.25)", OS.faint),
            pointerEvents: "none",
          }}>
            ⌕
          </span>
          <input
            type="text"
            placeholder="Search headlines & summaries..."
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setFocusedIndex(-1); }}
            style={{
              width: "100%", boxSizing: "border-box",
              padding: "7px 10px 7px 28px", borderRadius: 8,
              fontSize: 12, fontFamily: OS.font,
              background: dk(darkMode, "rgba(255,255,255,0.06)", OS.white),
              border: `1px solid ${dk(darkMode, "rgba(255,255,255,0.08)", OS.border)}`,
              color: dk(darkMode, "#e0e0e0", OS.text),
              outline: "none",
            }}
          />
          {searchQuery && (
            <span style={{
              position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)",
              fontSize: 10, color: OS.muted,
            }}>
              {filteredPosts.length} result{filteredPosts.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{
          padding: "8px 12px", marginBottom: 10, borderRadius: 6, fontSize: 12,
          background: darkMode ? "rgba(209,67,67,0.1)" : "#fef2f2",
          border: `1px solid ${darkMode ? "rgba(209,67,67,0.2)" : "#fecaca"}`,
          color: OS.red,
        }}>
          {error}
        </div>
      )}

      {/* Per-source loading progress */}
      {refreshing && sourceProgress.length > 0 && (
        <div style={{
          padding: "10px 14px", marginBottom: 12, borderRadius: 10,
          background: dk(darkMode, "rgba(255,255,255,0.04)", OS.white),
          border: `1px solid ${dk(darkMode, "rgba(255,255,255,0.08)", OS.border)}`,
        }}>
          <div style={{
            fontSize: 11, fontWeight: 600, textTransform: "uppercase",
            letterSpacing: "0.08em", marginBottom: 8,
            color: dk(darkMode, "rgba(255,255,255,0.35)", OS.muted),
          }}>
            Fetching sources
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {sourceProgress.map((sp) => (
              <span
                key={sp.source}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  fontSize: 11, padding: "3px 8px", borderRadius: 6,
                  background: sp.status === "done"
                    ? dk(darkMode, "rgba(59,140,95,0.15)", "#e8f5ee")
                    : sp.status === "error"
                      ? dk(darkMode, "rgba(209,67,67,0.1)", "#fef2f2")
                      : dk(darkMode, "rgba(255,255,255,0.06)", "#f5f5f7"),
                  color: sp.status === "done"
                    ? OS.green
                    : sp.status === "error"
                      ? OS.red
                      : dk(darkMode, "rgba(255,255,255,0.45)", OS.secondary),
                  transition: "all 300ms",
                }}
              >
                <span style={{ fontSize: 10 }}>
                  {sp.status === "done" ? "✓" : sp.status === "error" ? "✗" : "⟳"}
                </span>
                {sp.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Section A: Daily Briefing */}
      {briefing && posts.length > 0 && (
        <BriefingCard
          briefing={briefing}
          expanded={briefingExpanded}
          onToggle={() => setBriefingExpanded(!briefingExpanded)}
          darkMode={darkMode}
        />
      )}

      {/* Empty state */}
      {(!posts || posts.length === 0) && !refreshing && (
        <div style={{
          textAlign: "center", padding: "40px 20px",
          color: OS.muted, fontSize: 13,
        }}>
          <div style={{ fontSize: 24, marginBottom: 8 }}>📡</div>
          <div>Click <strong>Refresh</strong> to fetch the latest AI news from {Object.keys(NEWS_SOURCES).length} sources</div>
          <div style={{
            marginTop: 8, fontSize: 11, color: dk(darkMode, "rgba(255,255,255,0.25)", OS.faint),
            lineHeight: 1.6,
          }}>
            {Object.values(NEWS_SOURCES).map((s) => s.name).join(" · ")}
          </div>
        </div>
      )}

      {/* Loading state (only when no posts yet and no progress tracker) */}
      {refreshing && (!posts || posts.length === 0) && sourceProgress.length === 0 && (
        <div style={{
          textAlign: "center", padding: "40px 20px",
          color: OS.muted, fontSize: 13,
        }}>
          Fetching from {Object.values(NEWS_SOURCES).map((s) => s.name).join(", ")}...
        </div>
      )}

      {/* Section B: Source filter pills */}
      {posts.length > 0 && (
        <div style={{
          display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap",
        }}>
          <FilterPill
            label="All"
            count={posts.length}
            active={activeFilter === "all"}
            color={OS.blue}
            darkMode={darkMode}
            onClick={() => { setActiveFilter("all"); setFocusedIndex(-1); }}
          />
          {bookmarkedCount > 0 && (
            <FilterPill
              label="★ Saved"
              count={bookmarkedCount}
              active={activeFilter === "bookmarked"}
              color={OS.warning}
              darkMode={darkMode}
              onClick={() => { setActiveFilter("bookmarked"); setFocusedIndex(-1); }}
            />
          )}
          {sourceEntries.map(({ key, shortName, count }) => (
            <FilterPill
              key={key}
              label={shortName}
              count={count}
              active={activeFilter === key}
              color={SOURCE_COLORS[key] ?? OS.muted}
              darkMode={darkMode}
              onClick={() => { setActiveFilter(key); setFocusedIndex(-1); }}
            />
          ))}
        </div>
      )}

      {/* Keyboard hint */}
      {posts.length > 0 && (
        <div style={{
          fontSize: 10, color: dk(darkMode, "rgba(255,255,255,0.15)", OS.faint),
          marginBottom: 10, fontFamily: OS.font,
        }}>
          ↑↓ navigate · Enter expand · b bookmark · o open link
        </div>
      )}

      {/* Section B: Grouped or flat post list */}
      {topicGroups ? (
        topicGroups.map((group) => (
          <div key={group.topic} style={{ marginBottom: 16 }}>
            <div style={{
              fontSize: 11, fontWeight: 600, textTransform: "uppercase",
              letterSpacing: "0.08em", marginBottom: 8,
              color: dk(darkMode, "rgba(255,255,255,0.35)", OS.muted),
              fontFamily: OS.font,
            }}>
              {group.topic}
              <span style={{
                fontWeight: 400, marginLeft: 6,
                color: dk(darkMode, "rgba(255,255,255,0.20)", OS.faint),
              }}>
                {group.items.length}
              </span>
            </div>
            {group.items.map((post) => {
              const idx = flatPosts.indexOf(post);
              return (
                <PostCard
                  key={post.id}
                  post={post}
                  expanded={expandedId === post.id}
                  focused={focusedIndex === idx}
                  onToggle={() => toggleExpand(post)}
                  onBookmark={(e) => toggleBookmark(e, post)}
                  darkMode={darkMode}
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
        [...filteredPosts]
          .sort((a, b) => new Date(b.postedAt).getTime() - new Date(a.postedAt).getTime())
          .map((post) => {
            const idx = flatPosts.indexOf(post);
            return (
              <PostCard
                key={post.id}
                post={post}
                expanded={expandedId === post.id}
                focused={focusedIndex === idx}
                onToggle={() => toggleExpand(post)}
                onBookmark={(e) => toggleBookmark(e, post)}
                darkMode={darkMode}
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

      {/* No search results */}
      {searchQuery && filteredPosts.length === 0 && (
        <div style={{
          textAlign: "center", padding: "24px 20px",
          color: OS.muted, fontSize: 12,
        }}>
          No posts matching "{searchQuery}"
        </div>
      )}

      {/* Section C: Sources footer */}
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
  const preview = bullets[0] ?? "";
  const rest = bullets.slice(1);

  return (
    <div
      onClick={onToggle}
      style={{
        padding: "12px 14px", marginBottom: 14, borderRadius: 12, cursor: "pointer",
        background: dk(darkMode, "rgba(255,255,255,0.04)", OS.white),
        border: `1px solid ${dk(darkMode, "rgba(255,255,255,0.08)", OS.border)}`,
        borderLeft: `3px solid ${OS.blue}`,
      }}
    >
      <div style={{
        fontSize: 11, fontWeight: 600, textTransform: "uppercase",
        letterSpacing: "0.08em", marginBottom: 8,
        color: dk(darkMode, "rgba(94,106,210,0.7)", OS.blue),
        fontFamily: OS.font,
      }}>
        Your Briefing
      </div>
      <div style={{
        fontSize: 13, lineHeight: 1.6,
        color: dk(darkMode, "rgba(255,255,255,0.80)", OS.text),
        fontFamily: OS.font,
      }}>
        {preview}
      </div>
      {expanded && rest.length > 0 && (
        <div style={{ marginTop: 4 }}>
          {rest.map((line, i) => (
            <div key={i} style={{
              fontSize: 13, lineHeight: 1.6,
              color: dk(darkMode, "rgba(255,255,255,0.80)", OS.text),
              fontFamily: OS.font,
            }}>
              {line}
            </div>
          ))}
        </div>
      )}
      {!expanded && rest.length > 0 && (
        <div style={{
          fontSize: 11, color: dk(darkMode, "rgba(255,255,255,0.25)", OS.faint),
          marginTop: 4, fontFamily: OS.font,
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
        display: "flex", alignItems: "center", gap: 5,
        padding: "4px 10px", borderRadius: 9999, cursor: "pointer",
        fontSize: 11, fontWeight: 500, fontFamily: OS.font,
        transition: "all 150ms",
        background: active ? color + "20" : "transparent",
        border: `1px solid ${active ? color + "50" : dk(darkMode, "rgba(255,255,255,0.08)", OS.border)}`,
        color: active ? color : dk(darkMode, "rgba(255,255,255,0.45)", OS.secondary),
      }}
    >
      {!label.startsWith("★") && (
        <span style={{
          width: 6, height: 6, borderRadius: "50%",
          background: color, flexShrink: 0,
        }} />
      )}
      {label}
      <span style={{ fontSize: 10, opacity: 0.6 }}>
        {count}
      </span>
    </button>
  );
}

// ─── Post Card (tiered: hero / standard / compact) ───

function PostCard({
  post, expanded, focused, onToggle, onBookmark, darkMode, refCallback,
}: {
  post: NewsPost;
  expanded: boolean;
  focused: boolean;
  onToggle: () => void;
  onBookmark: (e: React.MouseEvent) => void;
  darkMode: boolean;
  refCallback: (el: HTMLDivElement | null) => void;
}) {
  const sourceColor = SOURCE_COLORS[post.source] ?? OS.muted;
  const isRead = !!post.readAt;
  const isHero = post.relevanceScore >= 9;
  const isCompact = post.relevanceScore <= 4;

  const focusRing = focused
    ? `0 0 0 2px ${dk(darkMode, "rgba(94,106,210,0.5)", OS.blue + "50")}`
    : "none";

  // ─── Compact card for low-relevance posts ───
  if (isCompact) {
    return (
      <div
        ref={refCallback}
        onClick={onToggle}
        style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "6px 10px", marginBottom: 3, borderRadius: 6, cursor: "pointer",
          background: dk(darkMode, "rgba(255,255,255,0.02)", "rgba(0,0,0,0.01)"),
          border: `1px solid ${dk(darkMode, "rgba(255,255,255,0.04)", "rgba(0,0,0,0.04)")}`,
          opacity: isRead ? 0.6 : 0.85,
          boxShadow: focusRing,
          transition: "box-shadow 100ms",
        }}
      >
        <span style={{
          width: 5, height: 5, borderRadius: "50%",
          background: sourceColor, flexShrink: 0,
        }} />
        <span style={{
          fontSize: 12, fontWeight: isRead ? 400 : 500,
          color: dk(darkMode, "rgba(255,255,255,0.50)", OS.secondary),
          flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          fontFamily: OS.font,
        }}>
          {post.title}
        </span>
        <span style={{
          fontSize: 10, color: OS.muted, flexShrink: 0,
        }}>
          {post.postedAt ? timeAgo(post.postedAt) : ""}
        </span>
        {post.bookmarked && (
          <span style={{ fontSize: 10, color: OS.warning, flexShrink: 0 }}>★</span>
        )}
      </div>
    );
  }

  // ─── Hero card for high-relevance posts (9-10) ───
  if (isHero) {
    return (
      <div
        ref={refCallback}
        onClick={onToggle}
        style={{
          padding: "14px 16px", marginBottom: 10, borderRadius: 12, cursor: "pointer",
          background: dk(darkMode, "rgba(255,255,255,0.06)", OS.white),
          border: `1px solid ${dk(darkMode, "rgba(255,255,255,0.10)", OS.border)}`,
          borderLeft: `4px solid ${relevanceBorder(post.relevanceScore)}`,
          opacity: isRead ? 0.75 : 1,
          boxShadow: focused
            ? `0 0 0 2px ${dk(darkMode, "rgba(94,106,210,0.5)", OS.blue + "50")}, 0 2px 8px rgba(0,0,0,0.06)`
            : "0 2px 8px rgba(0,0,0,0.04)",
          transition: "box-shadow 100ms, opacity 150ms",
        }}
      >
        {/* Top row */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
          <span style={{
            width: 7, height: 7, borderRadius: "50%",
            background: sourceColor, flexShrink: 0,
          }} />
          <span style={{
            fontSize: 11, fontWeight: 600,
            color: dk(darkMode, "rgba(255,255,255,0.50)", OS.muted),
          }}>
            {post.sourceName}
          </span>
          <span style={{
            fontSize: 10, padding: "2px 7px", borderRadius: 4, fontWeight: 700,
            background: dk(darkMode, "rgba(59,140,95,0.25)", "#e0f5e8"),
            color: OS.green,
          }}>
            {post.relevanceScore}
          </span>
          {post.topicTag && (
            <span style={{
              fontSize: 10, padding: "1px 6px", borderRadius: 4,
              background: dk(darkMode, "rgba(255,255,255,0.06)", "#f0f0f5"),
              color: dk(darkMode, "rgba(255,255,255,0.40)", OS.secondary),
              fontFamily: OS.font,
            }}>
              {post.topicTag}
            </span>
          )}
          <span style={{ flex: 1 }} />
          <button
            onClick={onBookmark}
            style={{
              background: "none", border: "none", cursor: "pointer", padding: "2px 4px",
              fontSize: 13, color: post.bookmarked ? OS.warning : dk(darkMode, "rgba(255,255,255,0.15)", OS.faint),
              transition: "color 150ms",
            }}
          >
            {post.bookmarked ? "★" : "☆"}
          </button>
          <span style={{ fontSize: 11, color: OS.muted }}>
            {post.postedAt ? timeAgo(post.postedAt) : ""}
          </span>
        </div>

        {/* Title — larger for hero */}
        <div style={{
          fontSize: 15, lineHeight: 1.4, fontWeight: 700,
          color: dk(darkMode, "#f0f0f0", OS.text),
          marginBottom: 6, fontFamily: OS.font,
        }}>
          {post.title}
          {!isRead && (
            <span style={{
              display: "inline-block", width: 6, height: 6, borderRadius: "50%",
              background: OS.blue, marginLeft: 6, verticalAlign: "middle",
            }} />
          )}
        </div>

        {/* Summary */}
        <div style={{
          fontSize: 13, lineHeight: 1.6, fontWeight: 400,
          color: dk(darkMode, "rgba(255,255,255,0.65)", OS.secondary),
          fontFamily: OS.font,
        }}>
          {post.summary}
        </div>

        {/* Bottom: author + link */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
          {post.author && (
            <span style={{
              fontSize: 11, color: dk(darkMode, "rgba(255,255,255,0.30)", OS.faint),
              fontFamily: OS.font,
            }}>
              {post.author}
            </span>
          )}
          <a
            href={post.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            style={{
              fontSize: 11, color: OS.blue, textDecoration: "none",
              fontWeight: 600, marginLeft: "auto", fontFamily: OS.font,
            }}
          >
            {domainFromUrl(post.url)} →
          </a>
        </div>

        {/* Expanded: raw text */}
        {expanded && post.rawText && post.rawText !== post.title && (
          <div style={{
            marginTop: 10, paddingTop: 10,
            borderTop: `1px solid ${dk(darkMode, "rgba(255,255,255,0.06)", OS.border)}`,
          }}>
            <div style={{
              fontSize: 12, lineHeight: 1.5,
              color: dk(darkMode, "#aaa", OS.secondary),
              fontFamily: OS.font,
            }}>
              {post.rawText.slice(0, 500)}
              {post.rawText.length > 500 && "..."}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ─── Standard card (relevance 5-8) ───
  return (
    <div
      ref={refCallback}
      onClick={onToggle}
      style={{
        padding: "10px 12px", marginBottom: 6, borderRadius: 8, cursor: "pointer",
        background: dk(darkMode, "rgba(255,255,255,0.04)", OS.white),
        border: `1px solid ${dk(darkMode, "rgba(255,255,255,0.08)", OS.border)}`,
        borderLeft: `3px solid ${relevanceBorder(post.relevanceScore)}`,
        opacity: isRead ? 0.7 : 1,
        boxShadow: focusRing,
        transition: "box-shadow 100ms, opacity 150ms",
      }}
    >
      {/* Top row */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
        <span style={{
          width: 6, height: 6, borderRadius: "50%",
          background: sourceColor, flexShrink: 0,
        }} />
        <span style={{
          fontSize: 11, fontWeight: 500,
          color: dk(darkMode, "rgba(255,255,255,0.45)", OS.muted),
        }}>
          {post.sourceName}
        </span>
        <span style={{
          fontSize: 10, padding: "1px 6px", borderRadius: 4, fontWeight: 700,
          background: post.relevanceScore >= 8
            ? dk(darkMode, "rgba(59,140,95,0.2)", "#e8f5ee")
            : post.relevanceScore >= 5
              ? dk(darkMode, "rgba(192,122,0,0.15)", OS.yellowBg)
              : dk(darkMode, "rgba(119,119,119,0.15)", "#f0f0f0"),
          color: post.relevanceScore >= 8 ? OS.green
            : post.relevanceScore >= 5 ? OS.warning : OS.muted,
        }}>
          {post.relevanceScore}
        </span>
        <span style={{ flex: 1 }} />
        <button
          onClick={onBookmark}
          style={{
            background: "none", border: "none", cursor: "pointer", padding: "2px 4px",
            fontSize: 12, color: post.bookmarked ? OS.warning : dk(darkMode, "rgba(255,255,255,0.15)", OS.faint),
            transition: "color 150ms",
          }}
        >
          {post.bookmarked ? "★" : "☆"}
        </button>
        <span style={{ fontSize: 11, color: OS.muted }}>
          {post.postedAt ? timeAgo(post.postedAt) : ""}
        </span>
      </div>

      {/* Title */}
      <div style={{
        fontSize: 13, lineHeight: 1.4, fontWeight: isRead ? 500 : 600,
        color: dk(darkMode, isRead ? "rgba(255,255,255,0.65)" : "#e0e0e0", isRead ? OS.secondary : OS.text),
        marginBottom: 3, fontFamily: OS.font,
      }}>
        {post.title}
        {!isRead && (
          <span style={{
            display: "inline-block", width: 5, height: 5, borderRadius: "50%",
            background: OS.blue, marginLeft: 6, verticalAlign: "middle",
          }} />
        )}
      </div>

      {/* Summary */}
      <div style={{
        fontSize: 12, lineHeight: 1.5, fontWeight: 400,
        color: dk(darkMode, "rgba(255,255,255,0.55)", OS.secondary),
        fontFamily: OS.font,
      }}>
        {post.summary}
      </div>

      {/* Bottom: author + link */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
        {post.author && (
          <span style={{
            fontSize: 10, color: dk(darkMode, "rgba(255,255,255,0.25)", OS.faint),
            fontFamily: OS.font,
          }}>
            {post.author}
          </span>
        )}
        <a
          href={post.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          style={{
            fontSize: 10, color: OS.blue, textDecoration: "none",
            fontWeight: 600, marginLeft: "auto", fontFamily: OS.font,
          }}
        >
          {domainFromUrl(post.url)} →
        </a>
      </div>

      {/* Expanded: raw text */}
      {expanded && post.rawText && post.rawText !== post.title && (
        <div style={{
          marginTop: 8, paddingTop: 8,
          borderTop: `1px solid ${dk(darkMode, "rgba(255,255,255,0.06)", OS.border)}`,
        }}>
          <div style={{
            fontSize: 12, lineHeight: 1.5,
            color: dk(darkMode, "#aaa", OS.secondary),
            fontFamily: OS.font,
          }}>
            {post.rawText.slice(0, 300)}
            {post.rawText.length > 300 && "..."}
          </div>
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
          color: dk(darkMode, "rgba(255,255,255,0.25)", OS.faint),
          fontSize: 9, transition: "transform 150ms",
          transform: expanded ? "rotate(0deg)" : "rotate(-90deg)",
          display: "inline-block",
        }}>
          ▼
        </span>
        <span style={{
          fontSize: 11, fontWeight: 600, textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: dk(darkMode, "rgba(255,255,255,0.35)", OS.muted),
          fontFamily: OS.font,
        }}>
          Sources
        </span>
        <span style={{
          fontSize: 11, color: dk(darkMode, "rgba(255,255,255,0.20)", OS.faint),
          fontWeight: 400,
        }}>
          {stats.length}
        </span>
      </div>
      {expanded && (
        <div style={{
          background: dk(darkMode, "rgba(255,255,255,0.03)", OS.white),
          borderRadius: 12,
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
                flex: 1, fontSize: 12, fontFamily: OS.font,
                color: dk(darkMode, "rgba(255,255,255,0.55)", OS.secondary),
              }}>
                {s.name}
              </span>
              {s.error ? (
                <span style={{ fontSize: 10, color: OS.red, fontFamily: OS.font }}>
                  Failed
                </span>
              ) : (
                <span style={{
                  fontSize: 10, fontFamily: OS.font,
                  color: dk(darkMode, "rgba(255,255,255,0.25)", OS.faint),
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
