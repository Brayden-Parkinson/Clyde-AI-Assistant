import React, { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@shared/db";
import { OS } from "@shared/tokens";
import { IconChevronRight, IconSearch } from "./Icons";
import type { DecisionLogEntry } from "@shared/types";

const CATEGORY_META: Record<string, { label: string; color: string; bg: string }> = {
  not_commitment: { label: "Not a commitment", color: OS.muted, bg: OS.bg },
  third_party: { label: "Third party", color: OS.blue, bg: OS.bg },
  hedging: { label: "Hedging", color: "#b08d33", bg: OS.bg },
  past_tense: { label: "Already done", color: OS.green, bg: OS.bg },
  delegation: { label: "Delegation", color: OS.blue, bg: OS.bg },
  politeness: { label: "Politeness", color: OS.muted, bg: OS.bg },
  low_confidence: { label: "Low confidence", color: "#b08d33", bg: OS.bg },
  acknowledgment: { label: "Acknowledgment", color: OS.muted, bg: OS.bg },
  accepted: { label: "Accepted", color: OS.green, bg: OS.bg },
};

type FilterCategory = "all" | "rejected" | string;

function timeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function BatchGroup({ batchId, entries }: { batchId: string; entries: DecisionLogEntry[] }) {
  const [expanded, setExpanded] = useState(true);
  const accepted = entries.filter(e => e.decision === "accepted");
  const rejected = entries.filter(e => e.decision === "rejected");
  const time = entries[0]?.createdAt;

  return (
    <div style={{
      background: OS.white, borderRadius: 10,
      border: `1px solid ${OS.border}`,
      overflow: "hidden",
      marginBottom: 12,
    }}>
      {/* Batch header */}
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          width: "100%", display: "flex", alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px", border: "none",
          background: OS.bg, cursor: "pointer",
          fontFamily: OS.font,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ display: "inline-flex", color: OS.muted, transform: expanded ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>
            <IconChevronRight size={12} />
          </span>
          <span style={{ fontSize: 12, fontWeight: 700, color: OS.text }}>
            Scan batch
          </span>
          <span style={{ fontSize: 11, color: OS.muted }}>
            {time ? timeAgo(time) : ""}
          </span>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {accepted.length > 0 && (
            <span style={{
              fontSize: 11, fontWeight: 500,
              padding: "2px 8px", borderRadius: 4,
              background: OS.bg, color: OS.green,
            }}>
              {accepted.length} accepted
            </span>
          )}
          {rejected.length > 0 && (
            <span style={{
              fontSize: 11, fontWeight: 500,
              padding: "2px 8px", borderRadius: 4,
              background: OS.bg, color: OS.muted,
            }}>
              {rejected.length} rejected
            </span>
          )}
        </div>
      </button>

      {expanded && (
        <div style={{ padding: "4px 0" }}>
          {/* Rejected items first (the main interest) */}
          {rejected.map((entry) => (
            <DecisionRow key={entry.id} entry={entry} />
          ))}
          {/* Then accepted, dimmer */}
          {accepted.map((entry) => (
            <DecisionRow key={entry.id} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}

function DecisionRow({ entry }: { entry: DecisionLogEntry }) {
  const meta = CATEGORY_META[entry.category] ?? CATEGORY_META.not_commitment;
  const isRejected = entry.decision === "rejected";

  return (
    <div style={{
      padding: "10px 14px",
      borderBottom: `1px solid ${OS.bg}`,
      opacity: isRejected ? 1 : 0.6,
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        {/* Decision indicator */}
        <div style={{
          width: 6, height: 6, borderRadius: 3, marginTop: 6, flexShrink: 0,
          background: isRejected ? OS.red : OS.green,
        }} />

        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Original text */}
          <div style={{
            fontSize: 13, color: OS.text, lineHeight: 1.45,
            marginBottom: 6,
          }}>
            <span style={{ fontWeight: 600, color: OS.secondary, fontSize: 12 }}>
              {entry.sender}
            </span>
            <span style={{ color: OS.muted, fontSize: 11 }}> in #{entry.channel}</span>
            <div style={{
              marginTop: 3,
              padding: "6px 10px",
              background: OS.bg,
              borderRadius: 6,
              borderLeft: `3px solid ${isRejected ? OS.red : OS.green}`,
              fontSize: 13,
              color: OS.text,
              lineHeight: 1.5,
            }}>
              {entry.original_text}
            </div>
          </div>

          {/* Reason + Category */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span style={{
              fontSize: 11, fontWeight: 600,
              padding: "2px 8px", borderRadius: 6,
              background: meta.bg, color: meta.color,
            }}>
              {meta.label}
            </span>
            <span style={{ fontSize: 12, color: OS.secondary, lineHeight: 1.4 }}>
              {entry.reason}
            </span>
            {entry.confidence !== null && (
              <span style={{
                fontSize: 11, fontWeight: 600,
                padding: "2px 6px", borderRadius: 4,
                background: OS.bg, color: OS.green, fontFamily: OS.mono,
              }}>
                {Math.round(entry.confidence * 100)}%
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function DevLog() {
  const [categoryFilter, setCategoryFilter] = useState<FilterCategory>("all");

  const entries = useLiveQuery(
    () => db.decision_log.orderBy("id").reverse().limit(200).toArray(),
    [],
    [],
  );

  // Group by batch
  const batchMap = new Map<string, DecisionLogEntry[]>();
  for (const entry of entries) {
    const filtered = categoryFilter === "all" ? true
      : categoryFilter === "rejected" ? entry.decision === "rejected"
      : entry.category === categoryFilter;
    if (!filtered) continue;
    const existing = batchMap.get(entry.batchId) ?? [];
    existing.push(entry);
    batchMap.set(entry.batchId, existing);
  }

  // Count categories for filter chips
  const categoryCounts = new Map<string, number>();
  let rejectedCount = 0;
  for (const entry of entries) {
    if (entry.decision === "rejected") {
      rejectedCount++;
      categoryCounts.set(entry.category, (categoryCounts.get(entry.category) ?? 0) + 1);
    }
  }

  const clearLog = async () => {
    await db.decision_log.clear();
  };

  return (
    <div>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 12,
      }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: OS.text }}>
            Decision Log
          </div>
          <div style={{ fontSize: 11, color: OS.muted, marginTop: 2 }}>
            What the AI considered but excluded from your commitments
          </div>
        </div>
        {entries.length > 0 && (
          <button
            onClick={clearLog}
            style={{
              padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600,
              fontFamily: OS.font, background: OS.white,
              border: `1px solid ${OS.border}`, color: OS.muted,
              cursor: "pointer",
            }}
          >
            Clear log
          </button>
        )}
      </div>

      {/* Category filters */}
      <div style={{
        display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 14,
      }}>
        {[
          { key: "all", label: `All (${entries.length})` },
          { key: "rejected", label: `Rejected (${rejectedCount})` },
          ...Array.from(categoryCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([cat, count]) => ({
              key: cat,
              label: `${CATEGORY_META[cat]?.label ?? cat} (${count})`,
            })),
        ].map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setCategoryFilter(key as FilterCategory)}
            style={{
              padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600,
              fontFamily: OS.font, border: "none", cursor: "pointer",
              background: categoryFilter === key ? OS.text : OS.bg,
              color: categoryFilter === key ? OS.white : OS.secondary,
              transition: "all 0.15s ease",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Batch groups */}
      {batchMap.size === 0 ? (
        <div style={{
          textAlign: "center", padding: "48px 0", color: OS.muted,
        }}>
          <div style={{
            width: 48, height: 48, borderRadius: 12,
            background: OS.bg,
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            color: OS.muted, marginBottom: 10,
          }}>
            <IconSearch size={22} />
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, color: OS.text, marginBottom: 4 }}>
            No decisions logged yet
          </div>
          <div style={{ fontSize: 12 }}>
            Decisions will appear here after the next scan runs with Developer Mode on.
          </div>
        </div>
      ) : (
        Array.from(batchMap.entries()).map(([batchId, batchEntries]) => (
          <BatchGroup key={batchId} batchId={batchId} entries={batchEntries} />
        ))
      )}
    </div>
  );
}
