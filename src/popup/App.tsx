import React, { useState, useCallback } from "react";
import { OS } from "@shared/tokens";
import type { Commitment } from "@shared/types";
import { useCommitments } from "./hooks/useCommitments";
import { useActions } from "./hooks/useActions";
import { CommitmentCard } from "./components/CommitmentCard";
import { FilterBar, type FilterKey } from "./components/FilterBar";
import { LearnedPatterns } from "./components/LearnedPatterns";
import { StatBar } from "./components/StatBar";
import { Toast } from "./components/Toast";

export default function App() {
  const { commitments, dismissalPatterns, counts, stats } = useCommitments();
  const actions = useActions();
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => setToast(msg), []);

  // ─── Action handlers that show toasts ───

  const onDismiss = useCallback(
    async (id: number) => {
      const msg = await actions.handleDismiss(id);
      setExpandedId(null);
      showToast(msg);
    },
    [actions, showToast],
  );

  const onDone = useCallback(
    async (id: number) => {
      const msg = await actions.handleDone(id);
      setExpandedId(null);
      showToast(msg);
    },
    [actions, showToast],
  );

  const onSnooze = useCallback(
    async (id: number) => {
      const msg = await actions.handleSnooze(id);
      setExpandedId(null);
      showToast(msg);
    },
    [actions, showToast],
  );

  const onCalendar = useCallback(
    async (commitment: Commitment) => {
      const msg = await actions.handleCalendar(commitment);
      setExpandedId(null);
      showToast(msg);
    },
    [actions, showToast],
  );

  const onSlack = useCallback(
    async (commitment: Commitment) => {
      const msg = await actions.handleSlack(commitment);
      showToast(msg);
    },
    [actions, showToast],
  );

  const onReminder = useCallback(
    async (id: number) => {
      const msg = await actions.handleReminder(id, 30);
      showToast(msg);
    },
    [actions, showToast],
  );

  // ─── Filtering and sorting ───

  const filtered = commitments
    .filter((c) => {
      if (filter === "all") return true;
      if (filter === "high") return c.urgency === "high";
      if (filter === "meetings") return c.source_type === "meeting";
      if (filter === "slack") return c.source_type === "slack";
      if (filter === "confident") return c.confidence >= 0.85;
      return true;
    })
    .sort((a, b) => {
      const urg: Record<string, number> = { high: 0, medium: 1, low: 2 };
      if (urg[a.urgency] !== urg[b.urgency])
        return urg[a.urgency] - urg[b.urgency];
      return b.confidence - a.confidence;
    });

  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  return (
    <div
      style={{
        minHeight: "100vh",
        background: OS.bg,
        fontFamily: OS.font,
        color: OS.textPrimary,
      }}
    >
      {/* Top bar */}
      <div
        style={{
          background: OS.white,
          borderBottom: `1.5px solid ${OS.border}`,
          padding: "16px 24px",
          position: "sticky",
          top: 0,
          zIndex: 10,
        }}
      >
        <div style={{ maxWidth: 760, margin: "0 auto" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 14,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {/* Logo mark */}
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  background: `linear-gradient(135deg, ${OS.blue}, ${OS.darkBlue})`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: OS.white,
                  fontSize: 16,
                  fontWeight: 900,
                  boxShadow: "0 2px 8px rgba(43,103,219,0.25)",
                }}
              >
                {"\u25C9"}
              </div>
              <div>
                <h1
                  style={{
                    fontSize: 18,
                    fontWeight: 900,
                    color: OS.darkBlue,
                    letterSpacing: "-0.01em",
                    lineHeight: 1.2,
                  }}
                >
                  Commitments
                </h1>
                <span style={{ fontSize: 11, color: OS.textMuted }}>
                  {dateStr} &middot; {counts.all} items to review
                </span>
              </div>
              {counts.high > 0 && (
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    background: "#fee2e2",
                    color: "#dc2626",
                    padding: "3px 10px",
                    borderRadius: 10,
                    fontFamily: "monospace",
                  }}
                >
                  {counts.high} urgent
                </span>
              )}
            </div>
            <StatBar stats={stats} />
          </div>
          <FilterBar filter={filter} setFilter={setFilter} counts={counts} />
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: 760, margin: "0 auto", padding: "20px 24px" }}>
        <LearnedPatterns patterns={dismissalPatterns} />

        <div
          style={{ display: "flex", flexDirection: "column", gap: 8 }}
        >
          {filtered.length === 0 ? (
            <div
              style={{
                textAlign: "center",
                padding: "64px 0",
                color: OS.textMuted,
              }}
            >
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 16,
                  background: OS.lightestBlue,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 28,
                  marginBottom: 12,
                }}
              >
                {"\u2713"}
              </div>
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 700,
                  color: OS.textPrimary,
                  marginBottom: 4,
                }}
              >
                All clear
              </div>
              <div style={{ fontSize: 13 }}>
                No commitments to review right now.
              </div>
            </div>
          ) : (
            filtered.map((item) => (
              <CommitmentCard
                key={item.id}
                item={item}
                isExpanded={expandedId === item.id}
                onToggle={() =>
                  setExpandedId(expandedId === item.id ? null : (item.id ?? null))
                }
                onDismiss={onDismiss}
                onDone={onDone}
                onSnooze={onSnooze}
                onCalendar={onCalendar}
                onSlack={onSlack}
                onReminder={onReminder}
              />
            ))
          )}
        </div>

        {filtered.length > 0 && (
          <div
            style={{
              textAlign: "center",
              marginTop: 24,
              padding: "16px 0",
              fontSize: 12,
              color: OS.textMuted,
              borderTop: `1px solid ${OS.border}`,
            }}
          >
            Click a card to expand &middot; Dismissals train the AI filter over
            time
          </div>
        )}
      </div>

      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </div>
  );
}
