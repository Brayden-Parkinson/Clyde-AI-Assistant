/**
 * MemoryPanel — View and manage long-term memories.
 *
 * Shows memories grouped by category with collapsible sections,
 * search, confirm/extend/remove actions, and manual refresh trigger.
 */

import React, { useState, useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@shared/db";
import { OS } from "@shared/tokens";
import type { MemoryEntry, MemoryCategory } from "@shared/types";

// ─── Props ───

interface MemoryPanelProps {
  demoMode: boolean;
  demoMemories?: MemoryEntry[];
}

// ─── Category Config ───

const CATEGORY_COLORS: Record<MemoryCategory, string> = {
  preference: OS.blue,
  fact: OS.green,
  pattern: "#7C3AED", // purple — OS doesn't have purple
  project: "#EA580C", // orange
  relationship: "#DB2777", // pink
  lesson: "#D97706", // amber
  context: OS.muted,
};

const CATEGORY_LABELS: Record<MemoryCategory, string> = {
  preference: "Preferences",
  fact: "Facts",
  pattern: "Patterns",
  project: "Projects",
  relationship: "Relationships",
  lesson: "Lessons",
  context: "Context",
};

const CATEGORY_ORDER: MemoryCategory[] = [
  "project",
  "fact",
  "preference",
  "pattern",
  "relationship",
  "lesson",
  "context",
];

// ─── Source Icons ───

function SourceIcon({ source }: { source: string }) {
  if (source === "ai_extraction") {
    return (
      <span title="AI extracted" style={{ fontSize: 11, opacity: 0.7 }}>
        {"AI"}
      </span>
    );
  }
  if (source === "user_manual") {
    return (
      <span title="User created" style={{ fontSize: 11, opacity: 0.7 }}>
        {"U"}
      </span>
    );
  }
  // pattern_detection
  return (
    <span title="Pattern detected" style={{ fontSize: 11, opacity: 0.7 }}>
      {"P"}
    </span>
  );
}

// ─── Stars ───

function ImportanceStars({ importance }: { importance: number }) {
  const stars: React.ReactNode[] = [];
  for (let i = 1; i <= 5; i++) {
    stars.push(
      <span
        key={i}
        style={{
          color: i <= importance ? "#D97706" : OS.border,
          fontSize: 12,
          lineHeight: 1,
        }}
      >
        {"\u2605"}
      </span>,
    );
  }
  return <span style={{ display: "inline-flex", gap: 1 }}>{stars}</span>;
}

// ─── Styles ───

const styles = {
  container: {
    padding: "16px",
    overflowY: "auto" as const,
    height: "100%",
    fontFamily: OS.font,
  },
  searchBar: {
    width: "100%",
    padding: "8px 12px",
    borderRadius: "6px",
    border: `1px solid ${OS.border}`,
    background: OS.white,
    color: OS.text,
    fontSize: "13px",
    marginBottom: "12px",
    outline: "none",
    fontFamily: OS.font,
    boxSizing: "border-box" as const,
  },
  header: {
    display: "flex" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    marginBottom: "12px",
  },
  title: {
    fontSize: "15px",
    fontWeight: 700,
    color: OS.text,
  },
  refreshBtn: {
    padding: "6px 12px",
    fontSize: "12px",
    fontWeight: 600,
    color: OS.white,
    background: OS.blue,
    border: "none",
    borderRadius: "6px",
    cursor: "pointer",
    fontFamily: OS.font,
  },
  categoryHeader: {
    display: "flex" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    padding: "8px 0",
    cursor: "pointer",
    userSelect: "none" as const,
  },
  categoryBadge: (color: string) => ({
    display: "inline-block" as const,
    padding: "2px 8px",
    borderRadius: "10px",
    fontSize: "11px",
    fontWeight: 600,
    color: "#fff",
    background: color,
  }),
  card: (isExpired: boolean) => ({
    background: OS.white,
    border: `1px solid ${OS.border}`,
    borderRadius: "8px",
    padding: "10px 12px",
    marginBottom: "6px",
    opacity: isExpired ? 0.5 : 1,
  }),
  cardContent: {
    fontSize: "13px",
    color: OS.text,
    lineHeight: 1.4,
    marginBottom: "6px",
  },
  cardMeta: {
    display: "flex" as const,
    alignItems: "center" as const,
    gap: "8px",
    flexWrap: "wrap" as const,
    fontSize: "11px",
    color: OS.muted,
  },
  smallBtn: (color: string) => ({
    padding: "2px 8px",
    fontSize: "11px",
    fontWeight: 600,
    color,
    background: "transparent",
    border: `1px solid ${color}`,
    borderRadius: "4px",
    cursor: "pointer",
    fontFamily: OS.font,
  }),
  emptyState: {
    textAlign: "center" as const,
    padding: "32px 16px",
    color: OS.muted,
    fontSize: "13px",
  },
  chevron: (open: boolean) => ({
    color: OS.muted,
    fontSize: "12px",
    transition: "transform 0.15s ease",
    transform: open ? "rotate(180deg)" : "rotate(0deg)",
    display: "inline-block" as const,
  }),
  countBadge: {
    fontSize: "11px",
    fontWeight: 600,
    fontFamily: OS.mono,
    background: OS.bg,
    color: OS.muted,
    padding: "2px 8px",
    borderRadius: "8px",
  },
};

// ─── Component ───

export function MemoryPanel({ demoMode, demoMemories }: MemoryPanelProps) {
  const [search, setSearch] = useState("");
  const [collapsedCategories, setCollapsedCategories] = useState<
    Set<MemoryCategory>
  >(new Set());
  const [refreshing, setRefreshing] = useState(false);

  // Live query from DB, or demo data
  const liveMemories = useLiveQuery(
    () => (demoMode ? ([] as MemoryEntry[]) : db.memories.toArray()),
    [demoMode],
  );
  const memories: MemoryEntry[] = demoMode
    ? demoMemories ?? []
    : liveMemories ?? [];

  // Filter by search
  const filtered = useMemo(() => {
    if (!search.trim()) return memories;
    const q = search.toLowerCase();
    return memories.filter((m) => m.content.toLowerCase().includes(q));
  }, [memories, search]);

  // Group by category
  const grouped = useMemo(() => {
    const groups = new Map<MemoryCategory, MemoryEntry[]>();
    for (const cat of CATEGORY_ORDER) {
      const items = filtered.filter((m) => m.category === cat);
      if (items.length > 0) {
        groups.set(cat, items.sort((a, b) => b.importance - a.importance));
      }
    }
    return groups;
  }, [filtered]);

  // Helpers
  const now = new Date().toISOString();
  const isExpired = (m: MemoryEntry) =>
    m.expiresAt != null && m.expiresAt < now;

  const toggleCategory = (cat: MemoryCategory) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const handleRefresh = async () => {
    if (demoMode) return;
    setRefreshing(true);
    try {
      await chrome.runtime.sendMessage({ type: "EXTRACT_MEMORIES" });
    } catch {
      // Service worker may not be listening yet
    }
    // Give it a moment to process
    setTimeout(() => setRefreshing(false), 2000);
  };

  const handleConfirm = async (id: number | undefined) => {
    if (demoMode || id == null) return;
    await db.memories.update(id, { confirmed: true });
  };

  const handleExtend = async (id: number | undefined) => {
    if (demoMode || id == null) return;
    const thirtyDaysFromNow = new Date(
      Date.now() + 30 * 24 * 60 * 60 * 1000,
    ).toISOString();
    await db.memories.update(id, { expiresAt: thirtyDaysFromNow });
  };

  const handleRemove = async (id: number | undefined) => {
    if (demoMode || id == null) return;
    await db.memories.delete(id);
  };

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <span style={styles.title}>Memories</span>
        <button
          style={{
            ...styles.refreshBtn,
            opacity: refreshing ? 0.6 : 1,
          }}
          onClick={handleRefresh}
          disabled={refreshing}
        >
          {refreshing ? "Extracting..." : "Refresh Memories"}
        </button>
      </div>

      {/* Search */}
      <input
        type="text"
        placeholder="Search memories..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={styles.searchBar}
      />

      {/* Empty state */}
      {filtered.length === 0 && (
        <div style={styles.emptyState}>
          {memories.length === 0
            ? "No memories yet. Click \"Refresh Memories\" to extract from your commitment history."
            : "No memories match your search."}
        </div>
      )}

      {/* Grouped memories */}
      {CATEGORY_ORDER.map((cat) => {
        const items = grouped.get(cat);
        if (!items) return null;
        const isOpen = !collapsedCategories.has(cat);
        const color = CATEGORY_COLORS[cat];

        return (
          <div key={cat} style={{ marginBottom: "8px" }}>
            {/* Category header */}
            <div
              style={styles.categoryHeader}
              onClick={() => toggleCategory(cat)}
            >
              <div
                style={{ display: "flex", alignItems: "center", gap: "8px" }}
              >
                <span style={styles.categoryBadge(color)}>
                  {CATEGORY_LABELS[cat]}
                </span>
                <span style={styles.countBadge}>{items.length}</span>
              </div>
              <span style={styles.chevron(isOpen)}>{"\u25BC"}</span>
            </div>

            {/* Memory cards */}
            {isOpen &&
              items.map((memory) => {
                const expired = isExpired(memory);
                return (
                  <div key={memory.id ?? memory.createdAt} style={styles.card(expired)}>
                    <div style={styles.cardContent}>{memory.content}</div>
                    <div style={styles.cardMeta}>
                      <ImportanceStars importance={memory.importance} />
                      <SourceIcon source={memory.source} />
                      {memory.reinforceCount > 0 && (
                        <span>
                          {memory.reinforceCount}x reinforced
                        </span>
                      )}
                      {memory.confirmed && (
                        <span
                          style={{ color: OS.green }}
                          title="Confirmed"
                        >
                          {"\u2713"}
                        </span>
                      )}
                      {!memory.confirmed && !expired && (
                        <button
                          style={styles.smallBtn(OS.green)}
                          onClick={() => handleConfirm(memory.id)}
                        >
                          Confirm
                        </button>
                      )}
                      {expired && (
                        <>
                          <button
                            style={styles.smallBtn(OS.blue)}
                            onClick={() => handleExtend(memory.id)}
                          >
                            Extend
                          </button>
                          <button
                            style={styles.smallBtn(OS.red)}
                            onClick={() => handleRemove(memory.id)}
                          >
                            Remove
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        );
      })}
    </div>
  );
}
