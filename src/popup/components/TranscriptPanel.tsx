import React, { useState } from "react";
import { OS } from "@shared/tokens";
import type { Commitment, ConversationMessage } from "@shared/types";
import { IconMic, IconDocument, IconChat, IconX, IconChevronRight, IconCalendar, IconBell, IconCheck } from "./Icons";

interface TranscriptPanelProps {
  commitment: Commitment;
  onClose: () => void;
  onCalendar?: () => void;
  onDone?: () => void;
  onDismiss?: () => void;
  onCloseCommitment?: () => void;
  onReminder?: () => void;
  privacyMode?: boolean;
}

function SectionLabel({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <div
      style={{
        fontSize: 10,
        fontWeight: 700,
        color,
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        marginBottom: 6,
      }}
    >
      {children}
    </div>
  );
}

function formatDeadline(deadline: string | null): string {
  if (!deadline) return "No deadline";
  try {
    const d = new Date(deadline);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return deadline;
  }
}

export function TranscriptPanel({
  commitment,
  onClose,
  onCalendar,
  onDone,
  onDismiss,
  onCloseCommitment,
  onReminder,
  privacyMode,
}: TranscriptPanelProps) {
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const hasTranscript = commitment.conversation_messages.length > 0;
  const blurred = !!(privacyMode && commitment.sensitive);

  const sourceIcon = commitment.source_type === "meeting" ? <IconMic size={13} />
    : commitment.source_type === "gdoc" ? <IconDocument size={13} />
    : commitment.source_type === "voice" ? <IconMic size={13} />
    : <IconChat size={13} />;
  const sourceLabel = commitment.source_type === "meeting" ? "Meeting"
    : commitment.source_type === "gdoc" ? "Google Doc"
    : commitment.source_type === "voice" ? "Voice"
    : "Slack";
  const deadlineLabel = formatDeadline(commitment.deadline);

  return (
    <div
      style={{
        background: OS.white,
        borderLeft: `1px solid ${OS.border}`,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        height: "100%",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          padding: "14px 16px 12px",
          borderBottom: `1px solid ${OS.border}`,
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: OS.text,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {commitment.context}
          </div>
          <div style={{ fontSize: 12, color: OS.muted, marginTop: 2, display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ display: "inline-flex" }}>{sourceIcon}</span> {sourceLabel} · {deadlineLabel}
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            width: 28,
            height: 28,
            borderRadius: 6,
            border: `1px solid ${OS.border}`,
            background: OS.white,
            color: OS.muted,
            fontSize: 14,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            lineHeight: 1,
            flexShrink: 0,
            marginLeft: 8,
          }}
        >
          <IconX size={14} />
        </button>
      </div>

      {/* Body — scrollable */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "16px 16px 12px",
          display: "flex",
          flexDirection: "column",
          gap: 16,
          filter: blurred ? "blur(6px)" : undefined,
          userSelect: blurred ? "none" : undefined,
          pointerEvents: blurred ? "none" : undefined,
        }}
      >
        {/* 1. COMMITMENT */}
        <div>
          <SectionLabel color={OS.text}>Commitment</SectionLabel>
          <div
            style={{
              background: OS.yellowBg,
              borderLeft: `3px solid ${OS.yellowBorder}`,
              borderRadius: 8,
              padding: "12px 14px",
            }}
          >
            <div style={{ fontSize: 15, fontWeight: 600, color: OS.text, wordWrap: "break-word" }}>
              {commitment.text}
            </div>
          </div>
        </div>

        {/* 2. CONTEXT */}
        {commitment.context_summary && (
          <div>
            <SectionLabel color={OS.blue}>Context</SectionLabel>
            <div
              style={{
                background: OS.bg,
                borderLeft: `3px solid ${OS.blue}`,
                borderRadius: 8,
                padding: "12px 14px",
              }}
            >
              <div
                style={{
                  fontSize: 13.5,
                  color: OS.text,
                  lineHeight: 1.6,
                  wordWrap: "break-word",
                }}
              >
                {commitment.context_summary}
              </div>
            </div>
          </div>
        )}

        {/* 3. WHAT YOU SAID */}
        {commitment.original_quote && (
          <div>
            <SectionLabel color={OS.muted}>What you said</SectionLabel>
            <div
              style={{
                background: OS.bg,
                border: `1px solid ${OS.border}`,
                borderRadius: 8,
                padding: "12px 14px",
              }}
            >
              <div
                style={{
                  fontSize: 13,
                  fontStyle: "italic",
                  color: OS.secondary,
                  wordWrap: "break-word",
                }}
              >
                {commitment.original_quote}
              </div>
            </div>
          </div>
        )}

        {/* 4. Full transcript — collapsible */}
        {hasTranscript && (
          <div>
            <button
              onClick={() => setTranscriptOpen((v) => !v)}
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: OS.muted,
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: 0,
                display: "flex",
                alignItems: "center",
                gap: 4,
                fontFamily: OS.font,
              }}
            >
              <span
                style={{
                  display: "inline-flex",
                  transition: "transform 0.15s",
                  transform: transcriptOpen ? "rotate(90deg)" : "rotate(0deg)",
                }}
              >
                <IconChevronRight size={12} />
              </span>
              Full transcript
            </button>
            {transcriptOpen && (
              <div
                style={{
                  marginTop: 8,
                  background: OS.bg,
                  border: `1px solid ${OS.border}`,
                  borderRadius: 8,
                  padding: "12px 14px",
                }}
              >
                {commitment.conversation_messages.map((msg, i) => (
                  <div key={i} style={{ marginBottom: i < commitment.conversation_messages.length - 1 ? 8 : 0 }}>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: OS.muted,
                      }}
                    >
                      {msg.sender}
                      <span
                        style={{
                          fontWeight: 400,
                          marginLeft: 6,
                          fontFamily: OS.mono,
                          fontSize: 10,
                        }}
                      >
                        {msg.timestamp}
                      </span>
                    </span>
                    <div
                      style={{
                        fontSize: 13,
                        color: OS.secondary,
                        lineHeight: 1.65,
                        wordWrap: "break-word",
                        marginTop: 1,
                      }}
                    >
                      {msg.text}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {!hasTranscript && !commitment.context_summary && !commitment.original_quote && (
          <div
            style={{
              padding: "24px 0",
              textAlign: "center",
              color: OS.muted,
              fontSize: 13,
            }}
          >
            No conversation transcript available
          </div>
        )}
      </div>

      {/* Bottom actions — pinned */}
      <div
        style={{
          borderTop: `1px solid ${OS.border}`,
          padding: "12px 16px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <button
          onClick={onCalendar}
          style={{
            width: "100%",
            background: OS.blue,
            color: "white",
            borderRadius: 7,
            padding: "10px 0",
            fontSize: 13,
            fontWeight: 600,
            border: "none",
            cursor: "pointer",
            fontFamily: OS.font,
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><IconCalendar size={14} /> Add to calendar</span>
        </button>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={onReminder}
            style={{
              flex: 1,
              border: `1px solid ${OS.border}`,
              background: OS.white,
              borderRadius: 6,
              padding: "7px 14px",
              fontSize: 12,
              fontWeight: 600,
              color: OS.secondary,
              cursor: "pointer",
              fontFamily: OS.font,
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><IconBell size={13} /> Remind</span>
          </button>
          <button
            onClick={onDone}
            style={{
              flex: 1,
              border: `1px solid ${OS.border}`,
              background: OS.white,
              borderRadius: 6,
              padding: "7px 14px",
              fontSize: 12,
              fontWeight: 600,
              color: OS.green,
              cursor: "pointer",
              fontFamily: OS.font,
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><IconCheck size={13} /> Done</span>
          </button>
          <button
            onClick={onCloseCommitment}
            style={{
              flex: 1,
              border: `1px solid ${OS.border}`,
              background: OS.white,
              borderRadius: 6,
              padding: "7px 14px",
              fontSize: 12,
              fontWeight: 600,
              color: OS.muted,
              cursor: "pointer",
              fontFamily: OS.font,
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><IconX size={13} /> Close</span>
          </button>
          <button
            onClick={onDismiss}
            title="Remove and train Clyde to stop showing similar items"
            style={{
              border: `1px solid ${OS.border}`,
              background: OS.white,
              borderRadius: 6,
              padding: "7px 10px",
              fontSize: 12,
              fontWeight: 600,
              color: OS.red,
              cursor: "pointer",
              fontFamily: OS.font,
            }}
          >
            <IconX size={13} />
          </button>
        </div>
        {commitment.slack_link && (
          <a
            href={commitment.slack_link}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: 12,
              color: OS.blue,
              textAlign: "center",
              textDecoration: "none",
              fontWeight: 500,
              fontFamily: OS.font,
              padding: "2px 0",
            }}
          >
            Open in Slack
          </a>
        )}
      </div>
    </div>
  );
}
