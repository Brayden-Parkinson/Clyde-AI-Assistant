import React from "react";
import { OS, URGENCY_COLORS, URGENCY_STYLES, getConfidenceColors } from "@shared/tokens";
import type { Commitment, SourceType, Urgency } from "@shared/types";
import { ActionButton } from "./ActionButton";

// ─── Sub-components ───

function ConfidencePill({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const { color, bg } = getConfidenceColors(value);
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 600,
        fontFamily: "monospace",
        color,
        background: bg,
        padding: "2px 8px",
        borderRadius: 10,
      }}
    >
      {pct}%
    </span>
  );
}

function SourceBadge({ type }: { type: SourceType }) {
  const isSlack = type === "slack";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 11,
        fontWeight: 600,
        color: isSlack ? "#611f69" : OS.blue,
        background: isSlack ? "#f4ecf7" : OS.lightestBlue,
        padding: "2px 8px",
        borderRadius: 10,
        letterSpacing: "0.01em",
      }}
    >
      {isSlack ? "\uD83D\uDCAC" : "\uD83C\uDF99"} {isSlack ? "Slack" : "Meeting"}
    </span>
  );
}

function UrgencyIndicator({ urgency }: { urgency: Urgency }) {
  const s = URGENCY_STYLES[urgency];
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        color: s.color,
        background: s.bg,
        padding: "2px 8px",
        borderRadius: 10,
      }}
    >
      {s.label}
    </span>
  );
}

// ─── Time formatting ───

function formatTime(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  const now = new Date();
  const diff = d.getTime() - now.getTime();
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (hours < 0) return "Overdue";
  if (hours < 1) return "< 1 hr";
  if (hours < 24) return `${hours}h`;
  return `${days}d`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "No deadline";
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// ─── Main component ───

interface CommitmentCardProps {
  item: Commitment;
  isExpanded: boolean;
  onToggle: () => void;
  onDismiss: (id: number) => void;
  onDone: (id: number) => void;
  onSnooze: (id: number) => void;
  onCalendar: (commitment: Commitment) => void;
  onSlack: (commitment: Commitment) => void;
  onReminder: (id: number) => void;
}

export function CommitmentCard({
  item,
  isExpanded,
  onToggle,
  onDismiss,
  onDone,
  onSnooze,
  onCalendar,
  onSlack,
  onReminder,
}: CommitmentCardProps) {
  const timeLeft = formatTime(item.deadline);
  const isOverdue = timeLeft === "Overdue";
  const borderColor = URGENCY_COLORS[item.urgency];

  return (
    <div
      onClick={onToggle}
      style={{
        background: OS.cardBg,
        border: `1.5px solid ${isExpanded ? OS.blue : OS.border}`,
        borderLeft: `4px solid ${borderColor}`,
        borderRadius: 10,
        padding: "16px 20px",
        cursor: "pointer",
        transition: "all 0.2s ease",
        boxShadow: isExpanded
          ? "0 4px 16px rgba(43, 103, 219, 0.08)"
          : "0 1px 3px rgba(0,0,0,0.04)",
      }}
    >
      {/* Header row */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Metadata row */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 8,
              flexWrap: "wrap",
            }}
          >
            <UrgencyIndicator urgency={item.urgency} />
            <SourceBadge type={item.source_type} />
            <span style={{ fontSize: 12, color: OS.textMuted }}>
              {item.context}
            </span>
            <ConfidencePill value={item.confidence} />
          </div>

          {/* Main text */}
          <div
            style={{
              fontSize: 15,
              fontWeight: 700,
              color: OS.textPrimary,
              fontFamily: OS.font,
              lineHeight: 1.45,
            }}
          >
            {item.text}
          </div>
        </div>

        {/* Deadline */}
        <div style={{ textAlign: "right", flexShrink: 0, minWidth: 80 }}>
          {item.deadline ? (
            <>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: isOverdue
                    ? "#dc2626"
                    : timeLeft === "< 1 hr"
                      ? "#ea580c"
                      : OS.textSecondary,
                  fontFamily: "monospace",
                }}
              >
                {isOverdue ? "\u26A0 Overdue" : `\u23F1 ${timeLeft}`}
              </div>
              <div
                style={{ fontSize: 11, color: OS.textMuted, marginTop: 2 }}
              >
                {formatDate(item.deadline)}
              </div>
            </>
          ) : (
            <span
              style={{
                fontSize: 11,
                color: OS.textMuted,
                fontStyle: "italic",
              }}
            >
              No deadline
            </span>
          )}
        </div>
      </div>

      {/* Expanded */}
      {isExpanded && (
        <div
          style={{
            marginTop: 16,
            paddingTop: 16,
            borderTop: `1px solid ${OS.border}`,
          }}
        >
          {/* Original quote */}
          <div
            style={{
              background: OS.lightestBlue,
              borderRadius: 8,
              padding: "12px 16px",
              borderLeft: `3px solid ${OS.blue}`,
              marginBottom: 16,
            }}
          >
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: OS.blue,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                marginBottom: 4,
              }}
            >
              Original quote
            </div>
            <div
              style={{
                fontSize: 13,
                color: OS.darkBlue,
                fontStyle: "italic",
                lineHeight: 1.55,
              }}
            >
              &ldquo;{item.original_quote}&rdquo;
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <ActionButton
              icon={"\uD83D\uDCC5"}
              label="Calendar event"
              onClick={(e) => {
                e.stopPropagation();
                onCalendar(item);
              }}
              variant="primary"
            />
            <ActionButton
              icon={"\uD83D\uDD14"}
              label="Set reminder"
              onClick={(e) => {
                e.stopPropagation();
                if (item.id != null) onReminder(item.id);
              }}
              variant="yellow"
            />
            <ActionButton
              icon={"\uD83D\uDCAC"}
              label="Slack message"
              onClick={(e) => {
                e.stopPropagation();
                onSlack(item);
              }}
            />
            <ActionButton
              icon={"\u23F0"}
              label="Snooze 1h"
              onClick={(e) => {
                e.stopPropagation();
                if (item.id != null) onSnooze(item.id);
              }}
            />
            <ActionButton
              icon={"\u2705"}
              label="Already done"
              onClick={(e) => {
                e.stopPropagation();
                if (item.id != null) onDone(item.id);
              }}
              variant="success"
            />
            <ActionButton
              icon={"\u2715"}
              label="Not a commitment"
              onClick={(e) => {
                e.stopPropagation();
                if (item.id != null) onDismiss(item.id);
              }}
              variant="danger"
            />
          </div>
        </div>
      )}
    </div>
  );
}
