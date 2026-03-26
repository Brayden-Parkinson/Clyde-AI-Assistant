import React, { useState, useEffect, useCallback } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@shared/db";
import { OS } from "@shared/tokens";
import { DEMO_NEWS_POSTS } from "@shared/demo-data";
import type { NewsPost } from "@shared/types";
import { dk } from "../DarkModeContext";

interface AINewsViewProps {
  darkMode?: boolean;
  demoMode?: boolean;
}

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

function relevanceBadge(score: number, darkMode: boolean): { bg: string; text: string } {
  if (score >= 8) return { bg: darkMode ? "rgba(59,140,95,0.2)" : "#e8f5ee", text: OS.green };
  if (score >= 5) return { bg: darkMode ? "rgba(192,122,0,0.15)" : OS.yellowBg, text: OS.warning };
  return { bg: darkMode ? "rgba(119,119,119,0.15)" : "#f0f0f0", text: OS.muted };
}

export function AINewsView({ darkMode = false, demoMode = false }: AINewsViewProps) {
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const livePosts = useLiveQuery(
    () => db.news_posts.orderBy("relevanceScore").reverse().toArray(),
    [],
  );
  const posts = demoMode ? DEMO_NEWS_POSTS : livePosts;

  const lastScraped = posts?.[0]?.scrapedAt ?? null;

  const handleRefresh = useCallback(() => {
    if (demoMode || refreshing) return;
    setRefreshing(true);
    setError(null);
    chrome.runtime.sendMessage({ type: "REFRESH_NEWS" }).catch(() => {
      setRefreshing(false);
      setError("Failed to start refresh");
    });
  }, [demoMode, refreshing]);

  // Listen for completion
  useEffect(() => {
    const listener = (msg: { type: string; error?: string }) => {
      if (msg.type === "NEWS_REFRESH_COMPLETE") {
        setRefreshing(false);
        if (msg.error) setError(msg.error);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  const toggleExpand = (id: number | undefined) => {
    if (id == null) return;
    setExpandedId((prev) => (prev === id ? null : id));
  };

  return (
    <div style={{ fontFamily: OS.font }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 12,
      }}>
        <div>
          <h2 style={{
            margin: 0, fontSize: 15, fontWeight: 600,
            color: dk(darkMode, "#e0e0e0", OS.text),
          }}>
            AI News
          </h2>
          {lastScraped && (
            <span style={{ fontSize: 11, color: OS.muted }}>
              Updated {timeAgo(lastScraped)}
            </span>
          )}
        </div>
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

      {/* Empty state */}
      {(!posts || posts.length === 0) && !refreshing && (
        <div style={{
          textAlign: "center", padding: "40px 20px",
          color: OS.muted, fontSize: 13,
        }}>
          <div style={{ fontSize: 24, marginBottom: 8 }}>📡</div>
          Click <strong>Refresh</strong> to fetch the latest posts from X
        </div>
      )}

      {/* Loading state */}
      {refreshing && (!posts || posts.length === 0) && (
        <div style={{
          textAlign: "center", padding: "40px 20px",
          color: OS.muted, fontSize: 13,
        }}>
          Fetching posts...
        </div>
      )}

      {/* Post cards */}
      {posts?.map((post) => (
        <PostCard
          key={post.id}
          post={post}
          expanded={expandedId === post.id}
          onToggle={() => toggleExpand(post.id)}
          darkMode={darkMode}
        />
      ))}
    </div>
  );
}

function PostCard({
  post,
  expanded,
  onToggle,
  darkMode,
}: {
  post: NewsPost;
  expanded: boolean;
  onToggle: () => void;
  darkMode: boolean;
}) {
  const badge = relevanceBadge(post.relevanceScore, darkMode);

  return (
    <div
      onClick={onToggle}
      style={{
        padding: "10px 12px", marginBottom: 6, borderRadius: 8, cursor: "pointer",
        background: dk(darkMode, "rgba(255,255,255,0.04)", OS.white),
        border: `1px solid ${dk(darkMode, "rgba(255,255,255,0.08)", OS.border)}`,
        transition: "background 0.1s",
      }}
    >
      {/* Top row: badge + author + time */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <span style={{
          fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 4,
          background: badge.bg, color: badge.text,
        }}>
          {post.relevanceScore}
        </span>
        <span style={{ fontSize: 11, fontWeight: 600, color: dk(darkMode, "#c0c0c0", OS.text) }}>
          @{post.author}
        </span>
        <span style={{ fontSize: 11, color: OS.muted, marginLeft: "auto" }}>
          {post.postedAt ? timeAgo(post.postedAt) : ""}
        </span>
      </div>

      {/* Summary */}
      <div style={{
        fontSize: 13, lineHeight: 1.45, fontWeight: 500,
        color: dk(darkMode, "#e0e0e0", OS.text),
      }}>
        {post.summary}
      </div>

      {/* Expanded: raw text + link */}
      {expanded && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${dk(darkMode, "rgba(255,255,255,0.06)", OS.border)}` }}>
          <div style={{
            fontSize: 12, lineHeight: 1.5, color: dk(darkMode, "#aaa", OS.secondary),
            whiteSpace: "pre-wrap", marginBottom: 8,
          }}>
            {post.rawText}
          </div>
          {post.links.length > 0 && (
            <div style={{ marginBottom: 6 }}>
              {post.links.map((link, i) => (
                <a
                  key={i}
                  href={link}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    display: "block", fontSize: 11, color: OS.blue,
                    textDecoration: "none", marginBottom: 2,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}
                >
                  {link}
                </a>
              ))}
            </div>
          )}
          <a
            href={post.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            style={{
              fontSize: 11, color: OS.blue, textDecoration: "none", fontWeight: 600,
            }}
          >
            View original →
          </a>
        </div>
      )}
    </div>
  );
}
