import React, { useState } from "react";
import { OS } from "@shared/tokens";
import type { Commitment, SourceType } from "@shared/types";
import { ActionButton } from "./ActionButton";
import { IconChat, IconDocument, IconMic, IconCalendar, IconBell, IconCheck, IconX } from "./Icons";

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

function formatDeadlineShort(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function sourceIconEl(type: SourceType): React.ReactNode {
  if (type === "slack") return <IconChat size={13} />;
  if (type === "gdoc") return <IconDocument size={13} />;
  if (type === "voice") return <IconMic size={13} />;
  return <IconMic size={13} />;
}

// ─── Display settings interface ───

interface DisplaySettings {
  showActions: boolean;
  showSourceBadges: boolean;
  showDeadlines: boolean;
  showConfidence: boolean;
}

// ─── Main component ───

interface CommitmentCardProps {
  item: Commitment;
  isExpanded: boolean;
  isSelected?: boolean;
  isNarrow?: boolean;
  verboseMode?: boolean;
  displaySettings?: DisplaySettings;
  privacyMode?: boolean;
  onToggle: () => void;
  onSelect?: (id: number) => void;
  onDismiss: (id: number) => void;
  onClose: (id: number) => void;
  onDone: (id: number) => void;
  onSnooze: (id: number) => void;
  onCalendar: (commitment: Commitment) => void;
  onSlack: (commitment: Commitment) => void;
  onReminder: (id: number) => void;
}

export function CommitmentCard({
  item,
  isExpanded,
  isSelected,
  isNarrow,
  verboseMode,
  displaySettings,
  privacyMode,
  onToggle,
  onSelect,
  onDismiss,
  onClose,
  onDone,
  onSnooze,
  onCalendar,
  onSlack,
  onReminder,
}: CommitmentCardProps) {
  const [hovered, setHovered] = useState(false);
  const timeLeft = formatTime(item.deadline);
  const isOverdue = timeLeft === "Overdue";
  const isUrgent = item.urgency === "high" || isOverdue;
  const isLowConfidence = item.confidence < 0.7;
  const ds = displaySettings ?? { showActions: true, showSourceBadges: true, showDeadlines: true, showConfidence: false };
  const blurred = !!(privacyMode && item.sensitive);

  return (
    <div
      onClick={(e) => {
        onToggle();
        if (onSelect && item.id != null) {
          e.stopPropagation();
          onSelect(item.id);
        }
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: isExpanded ? "14px 16px" : "11px 16px",
        borderBottom: `1px solid ${OS.border}`,
        cursor: "pointer",
        background: isExpanded ? OS.bg : isSelected ? OS.bg : hovered ? OS.bg : OS.white,
        transition: "background 0.1s ease",
        position: "relative",
      }}
    >
      {/* Main row */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        {/* Circle indicator */}
        <div
          style={{
            width: 18,
            height: 18,
            borderRadius: 9,
            flexShrink: 0,
            marginTop: 2,
            border: `2px solid ${isUrgent ? OS.red : OS.faint}`,
            background: isUrgent ? OS.red + "0a" : "transparent",
            transition: "border-color 0.15s ease",
          }}
        />

        {/* Content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 500,
              color: isLowConfidence ? OS.secondary : OS.text,
              lineHeight: 1.5,
              fontFamily: OS.font,
              opacity: isLowConfidence ? 0.75 : 1,
              filter: blurred ? "blur(5px)" : undefined,
              userSelect: blurred ? "none" : undefined,
            }}
          >
            {blurred ? "Sensitive commitment" : item.text}
          </div>

          {/* Metadata line */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              marginTop: 3,
              fontSize: 12.5,
              color: OS.secondary,
              fontFamily: OS.font,
            }}
          >
            {ds.showSourceBadges && <span style={{ display: "inline-flex", alignItems: "center" }}>{sourceIconEl(item.source_type)}</span>}
            <span style={blurred ? { filter: "blur(4px)", userSelect: "none" } : undefined}>{item.context}</span>
            {item.triggered && (
              <span style={{
                fontSize: 10, fontWeight: 500, padding: "1px 5px",
                borderRadius: 3, background: OS.bg, color: OS.blue,
              }}>
                triggered
              </span>
            )}
            {ds.showDeadlines && item.deadline && (
              <>
                <span style={{ color: OS.faint }}>&middot;</span>
                <span
                  style={{
                    color: isOverdue ? OS.red : OS.secondary,
                    fontWeight: isOverdue ? 600 : 400,
                  }}
                >
                  {isOverdue ? "Overdue" : formatDeadlineShort(item.deadline)}
                </span>
              </>
            )}
            {isLowConfidence && (
              <>
                <span style={{ color: OS.faint }}>&middot;</span>
                <span style={{ fontStyle: "italic" }}>might not be a commitment</span>
              </>
            )}
          </div>

          {/* Verbose metadata badges */}
          {verboseMode && (
            <div
              style={{
                display: "flex",
                gap: 6,
                marginTop: 5,
                flexWrap: "wrap",
              }}
            >
              {[
                {
                  label: `${Math.round(item.confidence * 100)}%`,
                  color: item.confidence >= 0.8 ? OS.green : item.confidence >= 0.5 ? "#b08d33" : OS.faint,
                },
                {
                  label: item.urgency,
                  color: item.urgency === "high" ? OS.red : item.urgency === "medium" ? "#b08d33" : OS.faint,
                },
                {
                  label: item.direction === "by_me" ? "mine" : "assigned",
                  color: OS.faint,
                },
                {
                  label: item.source_type,
                  color: OS.faint,
                },
                ...(item.likely_completed ? [{
                  label: "likely done",
                  color: OS.green,
                }] : []),
              ].map((badge) => (
                <span
                  key={badge.label}
                  style={{
                    padding: "1px 6px",
                    fontSize: 10,
                    fontFamily: OS.mono,
                    fontWeight: 500,
                    borderRadius: 3,
                    color: badge.color,
                    background: OS.bg,
                    lineHeight: 1.6,
                  }}
                >
                  {badge.label}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Inline hover actions — only when hovered and NOT expanded, respects displaySettings */}
        {ds.showActions && hovered && !isExpanded && (
          <div
            style={{
              display: "flex",
              gap: 2,
              flexShrink: 0,
              alignItems: "center",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              title="Add to calendar"
              onClick={(e) => { e.stopPropagation(); onCalendar(item); }}
              onMouseEnter={(e) => { (e.currentTarget.style.background = OS.bg); }}
              onMouseLeave={(e) => { (e.currentTarget.style.background = "transparent"); }}
              style={{
                width: 28, height: 28, borderRadius: 6, border: "none",
                background: "transparent", cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 14, color: OS.secondary, transition: "background 0.1s ease",
              }}
            >
              <IconCalendar size={14} />
            </button>
            <button
              title="Already done"
              onClick={(e) => { e.stopPropagation(); if (item.id != null) onDone(item.id); }}
              onMouseEnter={(e) => { (e.currentTarget.style.background = OS.bg); }}
              onMouseLeave={(e) => { (e.currentTarget.style.background = "transparent"); }}
              style={{
                width: 28, height: 28, borderRadius: 6, border: "none",
                background: "transparent", cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 14, color: OS.green, transition: "background 0.1s ease",
              }}
            >
              <IconCheck size={14} />
            </button>
            <button
              title="Close"
              onClick={(e) => { e.stopPropagation(); if (item.id != null) onClose(item.id); }}
              onMouseEnter={(e) => { (e.currentTarget.style.background = OS.bg); }}
              onMouseLeave={(e) => { (e.currentTarget.style.background = "transparent"); }}
              style={{
                width: 28, height: 28, borderRadius: 6, border: "none",
                background: "transparent", cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 14, color: OS.muted, transition: "background 0.1s ease",
              }}
            >
              <IconX size={14} />
            </button>
          </div>
        )}
      </div>

      {/* Expanded detail */}
      {isExpanded && (
        <div style={{ marginLeft: 30, marginTop: 12 }}>
          {/* Original quote */}
          <div
            style={{
              fontSize: 13,
              color: OS.secondary,
              fontStyle: "italic",
              lineHeight: 1.55,
              marginBottom: 12,
              paddingLeft: 12,
              borderLeft: `2px solid ${OS.faint}`,
              fontFamily: OS.font,
            }}
          >
            &ldquo;{item.original_quote}&rdquo;
          </div>

          {/* Actions */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <ActionButton
              icon={<IconCalendar size={12} />}
              label="Add to calendar"
              onClick={(e) => {
                e.stopPropagation();
                onCalendar(item);
              }}
              variant="primary"
              shortcut="C"
            />
            <ActionButton
              icon={<IconBell size={12} />}
              label="Remind me later"
              onClick={(e) => {
                e.stopPropagation();
                if (item.id != null) onReminder(item.id);
              }}
              variant="yellow"
              shortcut="R"
            />
            <ActionButton
              icon={<IconCheck size={12} />}
              label="Already done"
              onClick={(e) => {
                e.stopPropagation();
                if (item.id != null) onDone(item.id);
              }}
              variant="success"
              shortcut="D"
            />
            <ActionButton
              icon={<IconX size={12} />}
              label="Close"
              onClick={(e) => {
                e.stopPropagation();
                if (item.id != null) onClose(item.id);
              }}
              variant="muted"
              shortcut="X"
            />
            <ActionButton
              icon={<IconX size={12} />}
              label="Not a commitment"
              onClick={(e) => {
                e.stopPropagation();
                if (item.id != null) onDismiss(item.id);
              }}
              variant="danger"
              shortcut="N"
            />
          </div>

          {/* View context link */}
          {(item.slack_link || item.conversation_messages.length > 0) && !isNarrow && (
            <div style={{ marginTop: 10 }}>
              <a
                href={item.slack_link || "#"}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => {
                  e.stopPropagation();
                  if (!item.slack_link) e.preventDefault();
                }}
                style={{
                  fontSize: 12,
                  fontWeight: 500,
                  color: OS.blue,
                  textDecoration: "none",
                  fontFamily: OS.font,
                }}
              >
                View context &rarr;
              </a>
            </div>
          )}

          {/* Inline mini-transcript for narrow mode */}
          {isNarrow && (item.context_summary || item.conversation_messages.length > 0) && (
            <div
              style={{
                marginTop: 16,
                paddingTop: 12,
                borderTop: `1px solid ${OS.border}`,
              }}
            >
              {item.context_summary && (
                <div
                  style={{
                    padding: "8px 12px",
                    borderLeft: `2px solid ${OS.border}`,
                    marginBottom: 10,
                  }}
                >
                  <div style={{
                    fontSize: 10, fontWeight: 600, color: OS.muted,
                    textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3,
                  }}>
                    Conversation Summary
                  </div>
                  <div style={{ fontSize: 12, color: OS.secondary, lineHeight: 1.5 }}>
                    {item.context_summary}
                  </div>
                </div>
              )}
              {item.conversation_messages.length > 0 && (
                <div
                  style={{
                    maxHeight: 200,
                    overflowY: "auto",
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                  }}
                >
                  {item.conversation_messages.map((msg, i) => (
                    <div
                      key={i}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: msg.isMine ? "flex-end" : "flex-start",
                      }}
                    >
                      <div style={{
                        fontSize: 9, fontWeight: 600, color: OS.muted, marginBottom: 1,
                      }}>
                        {msg.sender}
                      </div>
                      <div
                        style={{
                          maxWidth: "85%",
                          padding: "6px 10px",
                          borderRadius: 8,
                          fontSize: 12,
                          lineHeight: 1.4,
                          background: msg.isMine ? OS.bg : OS.white,
                          border: (msg.text.includes(item.original_quote) || item.original_quote.includes(msg.text))
                            ? `1.5px solid ${OS.blue}`
                            : `1px solid ${OS.border}`,
                        }}
                      >
                        {msg.text}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {item.slack_link && (
                <a
                  href={item.slack_link}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    marginTop: 8,
                    fontSize: 11,
                    fontWeight: 600,
                    color: OS.blue,
                    textDecoration: "none",
                  }}
                >
                  Open in Slack
                </a>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
