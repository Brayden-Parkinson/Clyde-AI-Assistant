import React, { useState, useEffect } from "react";
import { OS } from "@shared/tokens";
import type { Commitment, ConversationMessage, Tag, Urgency, CommitmentDirection } from "@shared/types";
import { IconMic, IconDocument, IconChat, IconMail, IconX, IconChevronRight, IconCalendar, IconBell, IconCheck } from "./Icons";
import { useDarkMode, dk } from "../DarkModeContext";

interface TranscriptPanelProps {
  commitment: Commitment;
  onClose: () => void;
  onCalendar?: () => void;
  onDone?: () => void;
  onDismiss?: () => void;
  onCloseCommitment?: () => void;
  onReminder?: () => void;
  privacyMode?: boolean;
  allTags?: Tag[];
  onMetaUpdate?: (id: number, changes: Partial<Pick<Commitment, "tag_id" | "urgency" | "deadline" | "text" | "direction" | "sensitive">>) => void;
}

function SectionLabel({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <div
      style={{
        fontSize: 10,
        fontWeight: 500,
        color,
        letterSpacing: "0.04em",
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
  allTags,
  onMetaUpdate,
}: TranscriptPanelProps) {
  const darkMode = useDarkMode();
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [editText, setEditText] = useState(commitment.text);
  useEffect(() => { setEditText(commitment.text); }, [commitment.id]);
  const hasTranscript = commitment.conversation_messages.length > 0;
  const blurred = !!(privacyMode && commitment.sensitive);

  const sourceIcon = commitment.source_type === "meeting" ? <IconMic size={13} />
    : commitment.source_type === "gdoc" ? <IconDocument size={13} />
    : commitment.source_type === "voice" ? <IconMic size={13} />
    : commitment.source_type === "gmail" ? <IconMail size={13} />
    : <IconChat size={13} />;
  const sourceLabel = commitment.source_type === "meeting" ? "Meeting"
    : commitment.source_type === "gdoc" ? "Google Doc"
    : commitment.source_type === "voice" ? "Voice"
    : commitment.source_type === "gmail" ? "Gmail"
    : "Slack";
  const deadlineLabel = formatDeadline(commitment.deadline);

  return (
    <div
      style={{
        background: dk(darkMode, '#161618', OS.white),
        borderLeft: `1px solid ${dk(darkMode, 'rgba(255,255,255,0.08)', OS.border)}`,
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
          borderBottom: `1px solid ${dk(darkMode, 'rgba(255,255,255,0.08)', OS.border)}`,
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 500,
              color: dk(darkMode, 'rgba(255,255,255,0.90)', OS.text),
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {commitment.context}
          </div>
          <div style={{ fontSize: 12, color: dk(darkMode, 'rgba(255,255,255,0.35)', OS.muted), marginTop: 2, display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ display: "inline-flex" }}>{sourceIcon}</span> {sourceLabel} · {deadlineLabel}
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            border: `0.5px solid ${dk(darkMode, 'rgba(255,255,255,0.10)', 'rgba(0,0,0,0.08)')}`,
            background: dk(darkMode, 'rgba(255,255,255,0.06)', OS.white),
            color: dk(darkMode, 'rgba(255,255,255,0.55)', OS.muted),
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
          <SectionLabel color={dk(darkMode, 'rgba(255,255,255,0.90)', OS.text)}>Commitment</SectionLabel>
          <div
            style={{
              background: "transparent",
              borderLeft: `3px solid ${OS.yellowBorder}`,
              borderRadius: 12,
              padding: "10px 14px",
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 400, color: dk(darkMode, 'rgba(255,255,255,0.90)', OS.text), wordWrap: "break-word" }}>
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
                background: dk(darkMode, 'rgba(255,255,255,0.04)', OS.bg),
                borderLeft: `3px solid ${OS.blue}`,
                borderRadius: 12,
                padding: "12px 14px",
              }}
            >
              <div
                style={{
                  fontSize: 13,
                  color: dk(darkMode, 'rgba(255,255,255,0.90)', OS.text),
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
            <SectionLabel color={dk(darkMode, 'rgba(255,255,255,0.35)', OS.muted)}>What you said</SectionLabel>
            <div
              style={{
                background: "transparent",
                borderLeft: `2px solid ${dk(darkMode, 'rgba(255,255,255,0.12)', 'rgba(0,0,0,0.08)')}`,
                borderRadius: 0,
                padding: "8px 14px",
              }}
            >
              <div
                style={{
                  fontSize: 13,
                  fontStyle: "italic",
                  color: dk(darkMode, 'rgba(255,255,255,0.55)', OS.secondary),
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
                color: dk(darkMode, 'rgba(255,255,255,0.35)', OS.muted),
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
                  background: dk(darkMode, 'rgba(255,255,255,0.04)', OS.bg),
                  border: `0.5px solid ${dk(darkMode, 'rgba(255,255,255,0.08)', 'rgba(0,0,0,0.08)')}`,
                  borderRadius: 12,
                  padding: "12px 14px",
                }}
              >
                {commitment.conversation_messages.map((msg, i) => (
                  <div key={i} style={{ marginBottom: i < commitment.conversation_messages.length - 1 ? 8 : 0 }}>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: dk(darkMode, 'rgba(255,255,255,0.35)', OS.muted),
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
                        color: dk(darkMode, 'rgba(255,255,255,0.55)', OS.secondary),
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
              color: dk(darkMode, 'rgba(255,255,255,0.35)', OS.muted),
              fontSize: 13,
            }}
          >
            No conversation transcript available
          </div>
        )}

        {/* Details — editable fields */}
        {onMetaUpdate && commitment.id != null && (
          <div>
            <SectionLabel color={dk(darkMode, 'rgba(255,255,255,0.55)', OS.secondary)}>Details</SectionLabel>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {/* Description */}
              <div>
                <div style={{ fontSize: 11, color: dk(darkMode, 'rgba(255,255,255,0.35)', OS.muted), fontWeight: 500, marginBottom: 3 }}>Description</div>
                <textarea
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  onBlur={() => {
                    if (editText.trim() && editText !== commitment.text) {
                      onMetaUpdate(commitment.id!, { text: editText.trim() });
                    }
                  }}
                  rows={2}
                  style={{
                    fontSize: 13, fontFamily: OS.font, color: dk(darkMode, 'rgba(255,255,255,0.85)', OS.text),
                    border: `0.5px solid ${dk(darkMode, 'rgba(255,255,255,0.10)', 'rgba(0,0,0,0.12)')}`, borderRadius: 8,
                    padding: "6px 8px", resize: "vertical",
                    width: "100%", boxSizing: "border-box" as const,
                    outline: "none", background: dk(darkMode, 'rgba(255,255,255,0.06)', OS.white), lineHeight: 1.4,
                  }}
                />
              </div>

              {/* Tag */}
              {allTags && allTags.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, color: dk(darkMode, 'rgba(255,255,255,0.35)', OS.muted), fontWeight: 500, marginBottom: 3 }}>Tag</div>
                  <select
                    value={commitment.tag_id ?? ""}
                    onChange={(e) => {
                      const val = e.target.value ? Number(e.target.value) : null;
                      onMetaUpdate(commitment.id!, { tag_id: val });
                    }}
                    style={{
                      fontSize: 12, fontFamily: OS.font, color: dk(darkMode, 'rgba(255,255,255,0.85)', OS.text),
                      border: `0.5px solid ${dk(darkMode, 'rgba(255,255,255,0.10)', 'rgba(0,0,0,0.12)')}`, borderRadius: 8,
                      padding: "5px 7px", background: dk(darkMode, 'rgba(255,255,255,0.06)', OS.white), outline: "none",
                      width: "100%", boxSizing: "border-box" as const,
                    }}
                  >
                    <option value="">— none —</option>
                    {allTags.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Urgency */}
              <div>
                <div style={{ fontSize: 11, color: dk(darkMode, 'rgba(255,255,255,0.35)', OS.muted), fontWeight: 500, marginBottom: 3 }}>Urgency</div>
                <div style={{ display: "flex", gap: 6 }}>
                  {(["high", "medium", "low"] as Urgency[]).map((u) => {
                    const active = commitment.urgency === u;
                    return (
                      <button
                        key={u}
                        onClick={() => onMetaUpdate(commitment.id!, { urgency: u })}
                        style={{
                          background: active ? dk(darkMode, 'rgba(94,106,210,0.18)', OS.blueBg) : "transparent",
                          color: active ? OS.blue : dk(darkMode, 'rgba(255,255,255,0.45)', OS.secondary),
                          border: active ? `0.5px solid ${OS.blue}` : `0.5px solid ${dk(darkMode, 'rgba(255,255,255,0.10)', 'rgba(0,0,0,0.12)')}`,
                          borderRadius: 999,
                          padding: "5px 0",
                          fontSize: 11,
                          fontWeight: active ? 500 : 400,
                          fontFamily: OS.font,
                          flex: 1,
                          cursor: "pointer",
                        }}
                      >
                        {u}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Deadline */}
              <div>
                <div style={{ fontSize: 11, color: dk(darkMode, 'rgba(255,255,255,0.35)', OS.muted), fontWeight: 500, marginBottom: 3 }}>Deadline</div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input
                    type="datetime-local"
                    value={commitment.deadline ? commitment.deadline.slice(0, 16) : ""}
                    onChange={(e) => {
                      const iso = e.target.value ? new Date(e.target.value).toISOString() : null;
                      onMetaUpdate(commitment.id!, { deadline: iso });
                    }}
                    style={{
                      fontSize: 12, fontFamily: OS.font, color: dk(darkMode, 'rgba(255,255,255,0.85)', OS.text),
                      border: `0.5px solid ${dk(darkMode, 'rgba(255,255,255,0.10)', 'rgba(0,0,0,0.12)')}`, borderRadius: 8,
                      padding: "5px 7px", background: dk(darkMode, 'rgba(255,255,255,0.06)', OS.white), outline: "none",
                      flex: 1, minWidth: 0, boxSizing: "border-box" as const,
                    }}
                  />
                  {commitment.deadline && (
                    <button
                      onClick={() => onMetaUpdate(commitment.id!, { deadline: null })}
                      style={{
                        padding: "5px 8px", fontSize: 11, fontFamily: OS.font,
                        color: dk(darkMode, 'rgba(255,255,255,0.35)', OS.muted), border: `0.5px solid ${dk(darkMode, 'rgba(255,255,255,0.10)', 'rgba(0,0,0,0.12)')}`,
                        borderRadius: 999, background: dk(darkMode, 'rgba(255,255,255,0.06)', OS.white), cursor: "pointer",
                        whiteSpace: "nowrap" as const, flexShrink: 0, fontWeight: 500,
                      }}
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>

              {/* Direction + Sensitive */}
              <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: dk(darkMode, 'rgba(255,255,255,0.35)', OS.muted), fontWeight: 500, marginBottom: 3 }}>Direction</div>
                  <div style={{ display: "flex", gap: 6 }}>
                    {(["by_me", "assigned_to_me"] as CommitmentDirection[]).map((d) => {
                      const active = commitment.direction === d;
                      return (
                        <button
                          key={d}
                          onClick={() => onMetaUpdate(commitment.id!, { direction: d })}
                          style={{
                            flex: 1, padding: "5px 0", fontSize: 11, fontFamily: OS.font,
                            fontWeight: active ? 500 : 400,
                            color: active ? OS.blue : dk(darkMode, 'rgba(255,255,255,0.45)', OS.secondary),
                            background: active ? dk(darkMode, 'rgba(94,106,210,0.18)', OS.blueBg) : "transparent",
                            border: active ? `0.5px solid ${OS.blue}` : `0.5px solid ${dk(darkMode, 'rgba(255,255,255,0.10)', 'rgba(0,0,0,0.12)')}`,
                            borderRadius: 999, cursor: "pointer",
                          }}
                        >
                          {d === "by_me" ? "Mine" : "Assigned"}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: dk(darkMode, 'rgba(255,255,255,0.35)', OS.muted), fontWeight: 500, marginBottom: 3 }}>Sensitive</div>
                  <label style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer", marginTop: 4 }}>
                    <input
                      type="checkbox"
                      checked={commitment.sensitive}
                      onChange={(e) => onMetaUpdate(commitment.id!, { sensitive: e.target.checked })}
                      style={{ cursor: "pointer", width: 14, height: 14 }}
                    />
                    <span style={{ fontSize: 11, color: dk(darkMode, 'rgba(255,255,255,0.35)', OS.muted), whiteSpace: "nowrap" as const }}>Hide</span>
                  </label>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom actions — pinned */}
      <div
        style={{
          borderTop: `1px solid ${dk(darkMode, 'rgba(255,255,255,0.08)', OS.border)}`,
          padding: "12px 16px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={onCalendar}
            style={{
              flex: 1,
              border: `0.5px solid ${dk(darkMode, 'rgba(255,255,255,0.10)', 'rgba(0,0,0,0.12)')}`,
              background: "transparent",
              borderRadius: 999,
              padding: "7px 14px",
              fontSize: 12,
              fontWeight: 500,
              color: dk(darkMode, 'rgba(255,255,255,0.55)', OS.secondary),
              cursor: "pointer",
              fontFamily: OS.font,
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><IconCalendar size={13} /> Calendar</span>
          </button>
          <button
            onClick={onReminder}
            style={{
              flex: 1,
              border: `0.5px solid ${dk(darkMode, 'rgba(255,255,255,0.10)', 'rgba(0,0,0,0.12)')}`,
              background: "transparent",
              borderRadius: 999,
              padding: "7px 14px",
              fontSize: 12,
              fontWeight: 500,
              color: dk(darkMode, 'rgba(255,255,255,0.55)', OS.secondary),
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
              border: `0.5px solid ${OS.blue}`,
              background: dk(darkMode, 'rgba(94,106,210,0.18)', OS.blueBg),
              borderRadius: 999,
              padding: "7px 14px",
              fontSize: 12,
              fontWeight: 500,
              color: OS.blue,
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
              border: `0.5px solid ${dk(darkMode, 'rgba(255,255,255,0.10)', 'rgba(0,0,0,0.12)')}`,
              background: "transparent",
              borderRadius: 999,
              padding: "7px 14px",
              fontSize: 12,
              fontWeight: 500,
              color: dk(darkMode, 'rgba(255,255,255,0.55)', OS.secondary),
              cursor: "pointer",
              fontFamily: OS.font,
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><IconX size={13} /> Dismiss</span>
          </button>
          <button
            onClick={onDismiss}
            title="Remove and train Clyde to stop showing similar items"
            style={{
              border: `0.5px solid ${dk(darkMode, 'rgba(255,255,255,0.10)', 'rgba(0,0,0,0.12)')}`,
              background: "transparent",
              borderRadius: 999,
              padding: "7px 10px",
              fontSize: 12,
              fontWeight: 500,
              color: dk(darkMode, 'rgba(255,255,255,0.55)', OS.secondary),
              cursor: "pointer",
              fontFamily: OS.font,
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><IconX size={13} /> Never extract</span>
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
