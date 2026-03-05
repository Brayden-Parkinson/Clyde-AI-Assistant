import React, { useState, useCallback, useEffect, useRef } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { OS } from "@shared/tokens";
import type { Commitment, CompletionSuggestion, MorningBrief } from "@shared/types";
import type { PipelineStatus } from "@shared/status";
import { db } from "@shared/db";
import { useCommitments } from "./hooks/useCommitments";
import { useActions } from "./hooks/useActions";
import { useKanban } from "./hooks/useKanban";
import { CommitmentCard } from "./components/CommitmentCard";
import { KanbanBoard } from "./components/KanbanBoard";
import { FilterBar, type FilterKey } from "./components/FilterBar";
import { Toast } from "./components/Toast";
import { TranscriptPanel } from "./components/TranscriptPanel";
import { SetupWizard } from "./components/SetupWizard";

type ViewMode = "list" | "board" | "brief" | "devlog";

// ─── Display settings (persisted in chrome.storage.local) ───

interface DisplaySettings {
  showActions: boolean;
  showSourceBadges: boolean;
  showDeadlines: boolean;
  showConfidence: boolean;
}

const DEFAULT_DISPLAY: DisplaySettings = {
  showActions: true,
  showSourceBadges: true,
  showDeadlines: true,
  showConfidence: false,
};

function useDisplaySettings() {
  const [settings, setSettings] = useState<DisplaySettings>(DEFAULT_DISPLAY);

  useEffect(() => {
    chrome.storage.local.get("displaySettings").then((result) => {
      if (result.displaySettings) {
        setSettings({ ...DEFAULT_DISPLAY, ...(result.displaySettings as Partial<DisplaySettings>) });
      }
    });
  }, []);

  const update = useCallback((patch: Partial<DisplaySettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      chrome.storage.local.set({ displaySettings: next });
      return next;
    });
  }, []);

  return { settings, update };
}

// ─── Nav collapse state (persisted in chrome.storage.local) ───

function useNavCollapsed() {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    chrome.storage.local.get("navCollapsed").then((result) => {
      if (result.navCollapsed === true) setCollapsed(true);
    });
  }, []);

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      chrome.storage.local.set({ navCollapsed: !prev });
      return !prev;
    });
  }, []);

  const setTo = useCallback((val: boolean) => {
    setCollapsed(val);
    chrome.storage.local.set({ navCollapsed: val });
  }, []);

  return { collapsed, toggle, setTo };
}

// ─── Toggle Switch ───

function ToggleSwitch({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <div
      onClick={onToggle}
      style={{
        width: 36,
        height: 20,
        borderRadius: 10,
        padding: 2,
        background: on ? OS.blue : OS.faint,
        transition: "background 0.15s ease",
        display: "flex",
        alignItems: "center",
        justifyContent: on ? "flex-end" : "flex-start",
        cursor: "pointer",
        flexShrink: 0,
      }}
    >
      <div
        style={{
          width: 16,
          height: 16,
          borderRadius: 8,
          background: OS.white,
          boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
          transition: "all 0.15s ease",
        }}
      />
    </div>
  );
}

// ─── Settings Popover ───

function SettingsPopover({
  display,
  onUpdateDisplay,
  onClose,
}: {
  display: DisplaySettings;
  onUpdateDisplay: (patch: Partial<DisplaySettings>) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  const rows: Array<{ key: keyof DisplaySettings; label: string; desc: string }> = [
    { key: "showActions", label: "Show actions on cards", desc: "Calendar, Done, Dismiss buttons on each row" },
    { key: "showSourceBadges", label: "Show source badges", desc: "💬/🎙 icons on rows" },
    { key: "showDeadlines", label: "Show deadlines inline", desc: "Deadline dates on each row" },
    { key: "showConfidence", label: "Show confidence %", desc: "Extraction confidence score on each row" },
  ];

  return (
    <div
      ref={ref}
      style={{
        position: "absolute",
        top: "100%",
        right: 0,
        marginTop: 6,
        width: 300,
        background: OS.white,
        border: `1px solid ${OS.border}`,
        borderRadius: 10,
        boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
        zIndex: 40,
        padding: "14px 16px",
        fontFamily: OS.font,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 700, color: OS.text, marginBottom: 12 }}>
        Display Settings
      </div>

      {rows.map((row) => (
        <div
          key={row.key}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "8px 0",
            borderTop: `1px solid ${OS.border}`,
          }}
        >
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: OS.text }}>{row.label}</div>
            <div style={{ fontSize: 11, color: OS.muted, marginTop: 1 }}>{row.desc}</div>
          </div>
          <ToggleSwitch on={display[row.key]} onToggle={() => onUpdateDisplay({ [row.key]: !display[row.key] })} />
        </div>
      ))}

      <div style={{
        marginTop: 10,
        paddingTop: 10,
        borderTop: `1px solid ${OS.border}`,
        fontSize: 11,
        color: OS.muted,
        lineHeight: 1.5,
      }}>
        Actions are always available in expanded view and conversation panel regardless of these settings.
      </div>

      {/* Full settings button */}
      <button
        onClick={() => chrome.runtime.openOptionsPage?.()}
        style={{
          marginTop: 12,
          width: "100%",
          padding: "8px 0",
          borderRadius: 6,
          border: `1px solid ${OS.border}`,
          background: OS.bg,
          color: OS.secondary,
          fontSize: 12,
          fontWeight: 600,
          cursor: "pointer",
          fontFamily: OS.font,
          transition: "background 0.1s ease",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "#eef0f5"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = OS.bg; }}
      >
        {"\u2699"} All settings...
      </button>
    </div>
  );
}

// ─── Warning banner (replaces StatusPanel) ───

function WarningBanner({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [status, setStatus] = useState<PipelineStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const result = await chrome.storage.session.get("pipelineStatus");
        if (result.pipelineStatus) {
          setStatus(result.pipelineStatus as PipelineStatus);
        }
      } catch { /* not available */ }
    };
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, []);

  if (dismissed || !status) return null;

  const problems: string[] = [];
  if (!status.slackConnected) problems.push("Slack not connected");
  if (!status.granolaConnected) problems.push("Granola not connected");
  if (!status.hasApiKey) problems.push("API key missing");
  if (status.lastError) problems.push(status.lastError);

  if (problems.length === 0) return null;

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "8px 14px",
      background: OS.yellowBg,
      border: `1px solid ${OS.yellowBorder}`,
      borderRadius: 6,
      margin: "8px 16px 0",
      fontSize: 12,
      color: "#92680a",
      fontFamily: OS.font,
    }}>
      <span>
        {"\u26A0 "}{problems[0]}{problems.length > 1 ? ` (+${problems.length - 1} more)` : ""}
        {" \u2014 some commitments may be missed. "}
        <span
          onClick={onOpenSettings}
          style={{ textDecoration: "underline", cursor: "pointer", fontWeight: 600 }}
        >
          Connect \u2192
        </span>
      </span>
      <button
        onClick={() => setDismissed(true)}
        style={{
          background: "none", border: "none", color: "#92680a",
          cursor: "pointer", fontSize: 14, lineHeight: 1, padding: "0 0 0 8px",
        }}
      >
        {"\u2715"}
      </button>
    </div>
  );
}

// ─── Scan time helper ───

function useScanAgo() {
  const [status, setStatus] = useState<PipelineStatus | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const result = await chrome.storage.session.get("pipelineStatus");
        if (result.pipelineStatus) setStatus(result.pipelineStatus as PipelineStatus);
      } catch { /* not available */ }
    };
    load();
    const interval = setInterval(load, 10000);
    return () => clearInterval(interval);
  }, []);

  if (!status?.lastExtraction) return null;
  const diff = Date.now() - new Date(status.lastExtraction).getTime();
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  return `${Math.floor(diff / 3600000)}h ago`;
}

// ─── API Key Setup ───

function ApiKeySetup({ onSaved }: { onSaved: () => void }) {
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!apiKey.trim()) return;
    setSaving(true);
    await chrome.storage.local.set({ anthropicApiKey: apiKey.trim() });
    setSaving(false);
    onSaved();
  };

  return (
    <div style={{
      background: OS.white, border: `1px solid ${OS.border}`, borderRadius: 12,
      padding: 32, maxWidth: 480, margin: "0 auto",
    }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, color: OS.text, marginBottom: 4 }}>
        Set up Clyde
      </h2>
      <p style={{ fontSize: 13, color: OS.secondary, marginBottom: 20, lineHeight: 1.5 }}>
        Enter your Anthropic API key to enable AI-powered commitment detection.
        Your key is stored locally and never leaves your browser except to call the Claude API.
      </p>
      <label style={{ fontSize: 12, fontWeight: 600, color: OS.text, marginBottom: 6, display: "block" }}>
        Anthropic API Key
      </label>
      <input
        type="password"
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && handleSave()}
        placeholder="sk-ant-..."
        style={{
          width: "100%", padding: "10px 14px", borderRadius: 8,
          border: `1px solid ${OS.border}`, fontSize: 14,
          fontFamily: "monospace", outline: "none", marginBottom: 16,
        }}
      />
      <button
        onClick={handleSave}
        disabled={!apiKey.trim() || saving}
        style={{
          width: "100%", padding: "10px 0", borderRadius: 8,
          background: apiKey.trim() ? OS.blue : OS.faint,
          border: "none", color: OS.white, fontSize: 14, fontWeight: 700,
          fontFamily: OS.font, cursor: apiKey.trim() ? "pointer" : "default",
          transition: "all 0.15s ease",
        }}
      >
        {saving ? "Saving..." : "Save & Start Tracking"}
      </button>
      <p style={{ fontSize: 11, color: OS.muted, marginTop: 12, textAlign: "center" }}>
        Get your API key at console.anthropic.com
      </p>
    </div>
  );
}

// ─── Section header ───

function SectionHeader({ label, color }: { label: string; color: string }) {
  return (
    <div
      style={{
        padding: "10px 16px 6px 16px",
        fontSize: 11,
        fontWeight: 600,
        color,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        background: OS.bg,
        borderBottom: `1px solid ${OS.border}`,
      }}
    >
      {label}
    </div>
  );
}

// ─── Dev Log View ───

function DevLogView() {
  const entries = useLiveQuery(
    () => db.decision_log.orderBy("createdAt").reverse().limit(300).toArray(),
    []
  ) ?? [];

  const timeAgo = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 60000) return "just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return new Date(iso).toLocaleDateString();
  };

  if (entries.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "56px 16px", fontFamily: OS.font }}>
        <div style={{ fontSize: 22, marginBottom: 8 }}>🔍</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: OS.text, marginBottom: 4 }}>
          Clean slate.
        </div>
        <div style={{ fontSize: 13, color: OS.muted, lineHeight: 1.5 }}>
          Decisions will show up here after the next scan.
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: "12px 16px", fontFamily: OS.font }}>
      <div style={{ fontSize: 11, color: OS.muted, marginBottom: 12, display: "flex", alignItems: "center", gap: 10 }}>
        <span>{entries.length} decisions logged</span>
        <button
          onClick={() => db.decision_log.clear()}
          style={{
            background: "none", border: "none", color: OS.muted, fontSize: 11,
            cursor: "pointer", textDecoration: "underline", fontFamily: OS.font, padding: 0,
          }}
        >
          Clear log
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {entries.map((entry) => {
          const isAccepted = entry.decision === "accepted";
          return (
            <div key={entry.id} style={{
              background: OS.white,
              border: `1px solid ${OS.border}`,
              borderRadius: 8,
              padding: "10px 12px",
              borderLeft: `3px solid ${isAccepted ? "#16a34a" : OS.faint}`,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 4,
                  background: isAccepted ? "#f0fdf4" : OS.bg,
                  color: isAccepted ? "#16a34a" : OS.secondary,
                  border: `1px solid ${isAccepted ? "#bbf7d0" : OS.border}`,
                  textTransform: "uppercase", letterSpacing: "0.04em",
                }}>
                  {isAccepted ? "accepted" : "rejected"}
                </span>
                {entry.category && (
                  <span style={{
                    fontSize: 10, padding: "2px 7px", borderRadius: 4,
                    background: OS.bg, color: OS.muted, border: `1px solid ${OS.border}`,
                  }}>
                    {entry.category.replace(/_/g, " ")}
                  </span>
                )}
                {entry.confidence != null && (
                  <span style={{ fontSize: 10, color: OS.muted }}>
                    {Math.round(entry.confidence * 100)}% conf
                  </span>
                )}
                <span style={{ fontSize: 11, color: OS.muted, marginLeft: "auto" }}>
                  {timeAgo(entry.createdAt)}
                </span>
              </div>

              <div style={{ fontSize: 12, color: OS.muted, marginBottom: 4 }}>
                <span style={{ fontWeight: 600, color: OS.secondary }}>{entry.sender}</span>
                {" in "}
                <span style={{ fontWeight: 500 }}>{entry.channel}</span>
              </div>

              <div style={{
                fontSize: 12, color: OS.text, marginBottom: entry.reason ? 6 : 0,
                fontStyle: "italic",
                display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}>
                "{entry.original_text}"
              </div>

              {entry.reason && (
                <div style={{ fontSize: 11, color: isAccepted ? "#16a34a" : OS.secondary }}>
                  {isAccepted ? `→ ${entry.reason}` : `✗ ${entry.reason}`}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Completion Suggestion Card ───

function CompletionSuggestionCard({
  suggestion,
  commitment,
  onAccept,
  onDismiss,
}: {
  suggestion: CompletionSuggestion;
  commitment: Commitment | undefined;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  return (
    <div style={{
      background: "#f0faf4",
      borderLeft: "3px solid #16a34a",
      padding: "14px 16px",
      borderBottom: `1px solid ${OS.border}`,
    }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: "#16a34a", marginBottom: 8 }}>
        {"\u2713"} Looks like you completed this
      </div>
      {commitment && (
        <div style={{ fontSize: 14, fontWeight: 500, color: OS.text, marginBottom: 8 }}>
          {commitment.text}
        </div>
      )}
      <div style={{
        fontSize: 12, color: OS.secondary, fontStyle: "italic", marginBottom: 12,
      }}>
        &quot;{suggestion.evidence}&quot;
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={onAccept}
          style={{
            padding: "6px 14px", fontSize: 12, fontWeight: 600, fontFamily: OS.font,
            background: "#16a34a", color: "#fff", border: "none", borderRadius: 6,
            cursor: "pointer",
          }}
        >
          {"\u2713"} Yes, mark done
        </button>
        <button
          onClick={onDismiss}
          style={{
            padding: "6px 14px", fontSize: 12, fontWeight: 500, fontFamily: OS.font,
            background: OS.white, color: OS.muted, border: `1px solid ${OS.border}`,
            borderRadius: 6, cursor: "pointer",
          }}
        >
          {"\u2715"} Not yet
        </button>
      </div>
    </div>
  );
}

// ─── Morning Brief Card ───

function MorningBriefCard({
  brief,
  commitments,
  onCalendar,
  onDismiss,
  onSnooze,
  onRefresh,
  onDone,
}: {
  brief: MorningBrief;
  commitments: Commitment[];
  onCalendar: (commitment: Commitment) => void;
  onDismiss: () => void;
  onSnooze: () => void;
  onRefresh?: () => void;
  onDone?: (id: number) => void;
}) {
  const findCommitment = (id: number) => commitments.find(c => c.id === id);
  const [hoveredPriorityIdx, setHoveredPriorityIdx] = useState<number | null>(null);
  const [dismissedMoveIds, setDismissedMoveIds] = useState<Set<number>>(new Set());

  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const overdueCount = brief.priorities.filter(p => {
    const c = findCommitment(p.commitmentId);
    return c?.deadline && new Date(c.deadline).getTime() < Date.now();
  }).length;
  const meetingCount = brief.calendarEvents?.length ?? 0;

  const summaryParts: string[] = [];
  if (brief.priorities.length > 0) summaryParts.push(`${brief.priorities.length} priorities`);
  if (meetingCount > 0) summaryParts.push(`${meetingCount} meetings`);
  if (overdueCount > 0) summaryParts.push(`${overdueCount} overdue`);

  function getStatusTag(commitment: Commitment | undefined): { label: string; color: string } | null {
    if (!commitment) return null;
    if (commitment.deadline) {
      const dl = new Date(commitment.deadline).getTime();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const tomorrowEnd = todayStart + 2 * 86400000;
      if (dl < Date.now()) return { label: "Overdue", color: OS.red };
      if (dl < todayStart + 86400000) return { label: "Due today", color: "#d97706" };
      if (dl < tomorrowEnd) return { label: "Due tomorrow", color: OS.muted };
    }
    return null;
  }

  const headsUpItems: Array<{ text: string; borderColor: string }> = brief.headsUpTyped
    ? brief.headsUpTyped.map(h => ({
        text: h.text,
        borderColor: h.severity === "warning" ? "#d97706"
          : h.severity === "due_soon" ? OS.red
          : h.severity === "duplicate" ? OS.faint
          : OS.blue,
      }))
    : brief.headsUp.map(text => ({ text, borderColor: "#d97706" }));

  const activeMoves = brief.suggestedMoves.filter(m => !dismissedMoveIds.has(m.commitmentId));

  return (
    <div style={{ fontFamily: OS.font }}>
      {/* ── a) Header ── */}
      <div style={{
        padding: "20px 20px 16px",
        borderBottom: `1px solid ${OS.border}`,
        background: "#fdfcf8",
      }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 8 }}>
          <div>
            <div style={{
              fontSize: 10, fontWeight: 700, color: "#d97706",
              textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4,
            }}>
              Morning Brief
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: OS.text, lineHeight: 1.2 }}>
              {dateStr}
            </div>
            {summaryParts.length > 0 && (
              <div style={{ fontSize: 12, color: OS.muted, marginTop: 4 }}>
                {summaryParts.join(" \u00B7 ")}
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            {onRefresh && (
              <button
                onClick={onRefresh}
                style={{
                  padding: "5px 12px", fontSize: 11, fontWeight: 600, fontFamily: OS.font,
                  background: OS.white, color: OS.secondary,
                  border: `1px solid ${OS.border}`, borderRadius: 6, cursor: "pointer",
                }}
              >
                {"\u21BB"} Refresh
              </button>
            )}
            <button
              onClick={onDismiss}
              style={{
                padding: "5px 12px", fontSize: 11, fontWeight: 600, fontFamily: OS.font,
                background: OS.white, color: OS.muted,
                border: `1px solid ${OS.border}`, borderRadius: 6, cursor: "pointer",
              }}
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>

      {/* ── b) Today's priorities ── */}
      {brief.priorities.length > 0 && (
        <div style={{ padding: "14px 20px", borderBottom: `1px solid ${OS.border}` }}>
          <div style={{
            fontSize: 10, fontWeight: 700, color: OS.muted,
            textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10,
          }}>
            Today&apos;s Priorities
          </div>
          {brief.priorities.map((p, i) => {
            const commitment = findCommitment(p.commitmentId);
            const statusTag = getStatusTag(commitment);
            const isOverdue = statusTag?.label === "Overdue";
            const isTop = i === 0;
            const circleColor = isOverdue ? OS.red : isTop ? OS.blue : OS.faint;
            const isHovered = hoveredPriorityIdx === i;

            return (
              <div
                key={i}
                onMouseEnter={() => setHoveredPriorityIdx(i)}
                onMouseLeave={() => setHoveredPriorityIdx(null)}
                style={{
                  display: "flex", alignItems: "flex-start", gap: 10,
                  padding: "8px 4px", borderRadius: 6,
                  background: isHovered ? OS.bg : "transparent",
                  transition: "background 0.1s ease",
                }}
              >
                {/* Numbered circle */}
                <div style={{
                  width: 24, height: 24, borderRadius: 12,
                  background: circleColor, color: OS.white,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 12, fontWeight: 700, flexShrink: 0, marginTop: 1,
                }}>
                  {i + 1}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: OS.text }}>{p.text}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 3, flexWrap: "wrap" }}>
                    {p.suggestedTime && (
                      <span style={{ fontSize: 11, color: OS.muted }}>
                        {"\u23F0"} {p.suggestedTime}
                      </span>
                    )}
                    {statusTag && (
                      <span style={{
                        fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 4,
                        background: isOverdue ? "#fef2f2" : "#fef9e8",
                        color: statusTag.color,
                        border: `1px solid ${isOverdue ? "#fecaca" : "#f5d565"}`,
                      }}>
                        {statusTag.label}
                      </span>
                    )}
                    {!p.suggestedTime && !statusTag && p.reason && (
                      <span style={{ fontSize: 11, color: OS.muted }}>{p.reason}</span>
                    )}
                  </div>
                </div>
                {/* Hover action buttons */}
                <div style={{
                  display: "flex", gap: 6, flexShrink: 0,
                  opacity: isHovered ? 1 : 0, transition: "opacity 0.1s ease",
                }}>
                  {p.action === "calendar" && commitment && (
                    <button
                      onClick={() => onCalendar(commitment)}
                      title="Block time"
                      style={{
                        padding: "3px 8px", fontSize: 11, fontWeight: 600, fontFamily: OS.font,
                        background: OS.white, color: OS.blue,
                        border: `1px solid ${OS.blue}`, borderRadius: 5, cursor: "pointer",
                      }}
                    >
                      {"\uD83D\uDCC5"} Block time
                    </button>
                  )}
                  {commitment && onDone && commitment.id != null && (
                    <button
                      onClick={() => onDone(commitment.id!)}
                      title="Mark done"
                      style={{
                        padding: "3px 8px", fontSize: 11, fontWeight: 600, fontFamily: OS.font,
                        background: OS.white, color: OS.green,
                        border: `1px solid ${OS.green}`, borderRadius: 5, cursor: "pointer",
                      }}
                    >
                      Done {"\u2713"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── c) Your day timeline ── */}
      <div style={{ padding: "14px 20px", borderBottom: `1px solid ${OS.border}` }}>
        <div style={{
          fontSize: 10, fontWeight: 700, color: OS.muted,
          textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10,
        }}>
          Your Day
        </div>
        {brief.calendarEvents && brief.calendarEvents.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {brief.calendarEvents.map((ev, i) => {
              const isMeeting = true;
              const barColor = isMeeting ? OS.blue : OS.green;
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{
                    fontSize: 11, color: OS.muted, width: 72, flexShrink: 0, textAlign: "right",
                  }}>
                    {ev.start}
                  </span>
                  <div style={{
                    flex: 1, height: 28, borderRadius: 4,
                    background: `${barColor}15`, borderLeft: `3px solid ${barColor}`,
                    display: "flex", alignItems: "center", paddingLeft: 8,
                  }}>
                    <span style={{ fontSize: 12, color: OS.text, fontWeight: 500 }}>{ev.title}</span>
                    {ev.end !== ev.start && ev.end !== "All day" && (
                      <span style={{ fontSize: 10, color: OS.muted, marginLeft: 6 }}>
                        {"\u2192"} {ev.end}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : brief.scheduleSuggestion ? (
          <div style={{
            fontSize: 12, color: OS.secondary, lineHeight: 1.5,
            padding: "8px 12px", background: OS.bg, borderRadius: 6,
          }}>
            {brief.scheduleSuggestion}
          </div>
        ) : (
          <div style={{ fontSize: 12, color: OS.muted, fontStyle: "italic" }}>
            No calendar connected — add an ICS feed in Settings to see your timeline.
          </div>
        )}
      </div>

      {/* ── d) Heads up alerts ── */}
      {headsUpItems.length > 0 && (
        <div style={{ padding: "14px 20px", borderBottom: `1px solid ${OS.border}` }}>
          <div style={{
            fontSize: 10, fontWeight: 700, color: OS.muted,
            textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10,
          }}>
            Heads Up
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {headsUpItems.map((item, i) => (
              <div key={i} style={{
                fontSize: 12, color: OS.text, padding: "8px 10px",
                borderLeft: `3px solid ${item.borderColor}`,
                background: OS.bg, borderRadius: "0 4px 4px 0",
                lineHeight: 1.4,
              }}>
                {item.text}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── e) Suggested moves ── */}
      {activeMoves.length > 0 && (
        <div style={{ padding: "14px 20px", borderBottom: `1px solid ${OS.border}` }}>
          <div style={{
            fontSize: 10, fontWeight: 700, color: OS.muted,
            textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10,
          }}>
            Suggested Moves
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {activeMoves.map((move, i) => {
              const commitment = findCommitment(move.commitmentId);
              if (!commitment) return null;
              return (
                <div key={i} style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "8px 10px", background: OS.bg, borderRadius: 6,
                }}>
                  <span style={{ fontSize: 13, color: OS.muted, flexShrink: 0 }}>{"\u2192"}</span>
                  <span style={{
                    flex: 1, fontSize: 12, color: OS.text,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {commitment.text}
                  </span>
                  <span style={{
                    fontSize: 10, fontWeight: 600, padding: "2px 7px", borderRadius: 4,
                    background: OS.blue + "18", color: OS.blue,
                    flexShrink: 0, textTransform: "capitalize",
                  }}>
                    {move.to.replace(/_/g, " ")}
                  </span>
                  <button
                    onClick={async () => {
                      const colId = move.to === "do_next" ? "inProgress" : move.to;
                      if (commitment.id != null) {
                        await db.kanban_assignments.put({ commitment_id: commitment.id, column_id: colId });
                      }
                    }}
                    style={{
                      padding: "3px 8px", fontSize: 11, fontWeight: 600, fontFamily: OS.font,
                      background: OS.white, color: OS.green,
                      border: `1px solid ${OS.green}`, borderRadius: 5, cursor: "pointer",
                      flexShrink: 0,
                    }}
                  >
                    {"\u2713"}
                  </button>
                  <button
                    onClick={() => setDismissedMoveIds(prev => new Set([...prev, move.commitmentId]))}
                    style={{
                      padding: "3px 6px", fontSize: 11, fontWeight: 500, fontFamily: OS.font,
                      background: "none", color: OS.muted,
                      border: `1px solid ${OS.border}`, borderRadius: 5, cursor: "pointer",
                      flexShrink: 0,
                    }}
                  >
                    {"\u2715"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── f) Footer ── */}
      <div style={{
        padding: "10px 20px", display: "flex", alignItems: "center", justifyContent: "space-between",
        fontSize: 11, color: OS.muted,
      }}>
        <span>
          Generated {new Date(brief.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
          {brief.calendarEvents ? " \u00B7 Calendar synced via ICS feed" : ""}
        </span>
        <button
          onClick={onSnooze}
          style={{
            fontSize: 11, color: OS.muted, background: "none", border: "none",
            cursor: "pointer", fontFamily: OS.font, textDecoration: "underline",
          }}
        >
          Snooze 1h
        </button>
      </div>
    </div>
  );
}

// ─── Brief View ───

function BriefView({
  commitments,
  onCalendar,
  onDone,
}: {
  commitments: Commitment[];
  onCalendar: (commitment: Commitment) => void;
  onDone: (id: number) => void;
}) {
  const todayDate = new Date().toISOString().slice(0, 10);
  const allBriefs = useLiveQuery(
    () => db.briefs.orderBy("date").reverse().toArray(),
    []
  ) ?? [];

  const todayBrief = allBriefs.find(b => b.date === todayDate);
  const pastBriefs = allBriefs.filter(b => b.date !== todayDate);

  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [expandedPastId, setExpandedPastId] = useState<number | null>(null);

  const handleGenerate = async () => {
    setGenerating(true);
    setGenError(null);
    try {
      const response = await chrome.runtime.sendMessage({ type: "GENERATE_MORNING_BRIEF" });
      if (!response?.ok) setGenError(response?.error ?? "Generation failed — check API key and try again");
    } catch (err) {
      setGenError(err instanceof Error ? err.message : "Failed to reach background worker");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", fontFamily: OS.font }}>
      {/* Generate button when no brief exists */}
      {!todayBrief && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: "12px 16px", background: OS.white, borderBottom: `1px solid ${OS.border}`,
        }}>
          <button
            onClick={handleGenerate}
            disabled={generating}
            style={{
              padding: "7px 16px", fontSize: 12, fontWeight: 600, fontFamily: OS.font,
              background: generating ? OS.bg : OS.blue,
              color: generating ? OS.muted : OS.white,
              border: `1px solid ${generating ? OS.border : OS.blue}`,
              borderRadius: 8, cursor: generating ? "default" : "pointer",
              transition: "all 0.15s ease",
            }}
          >
            {generating ? "Generating..." : "Generate Brief"}
          </button>
        </div>
      )}

      {genError && (
        <div style={{
          margin: "12px 16px 0", padding: "8px 12px",
          background: "#fef2f2", color: "#dc2626", fontSize: 12, borderRadius: 6,
          border: "1px solid #fecaca",
        }}>
          {genError}
        </div>
      )}

      {/* Today's brief */}
      <div style={{ background: OS.white }}>
        {todayBrief ? (
          <MorningBriefCard
            brief={todayBrief}
            commitments={commitments}
            onCalendar={onCalendar}
            onRefresh={handleGenerate}
            onDone={onDone}
            onDismiss={async () => {
              if (todayBrief.id != null) await db.briefs.update(todayBrief.id, { dismissed: true });
            }}
            onSnooze={async () => {
              if (todayBrief.id != null) {
                await db.briefs.update(todayBrief.id, {
                  snoozedUntil: new Date(Date.now() + 3600000).toISOString(),
                });
              }
            }}
          />
        ) : (
          <div style={{ textAlign: "center", padding: "52px 16px" }}>
            <div style={{ fontSize: 28, marginBottom: 10 }}>{"\u2600"}</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: OS.text, marginBottom: 6 }}>
              No brief yet.
            </div>
            <div style={{ fontSize: 13, color: OS.muted, lineHeight: 1.6 }}>
              I can put one together now, or it'll generate tomorrow morning.
            </div>
          </div>
        )}
      </div>

      {/* Past briefs */}
      {pastBriefs.length > 0 && (
        <div style={{ margin: "16px 16px 24px" }}>
          <div style={{
            fontSize: 11, fontWeight: 600, color: OS.muted,
            textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8,
          }}>
            Past Briefs
          </div>
          <div style={{ background: OS.white, border: `1px solid ${OS.border}`, borderRadius: 8, overflow: "hidden" }}>
            {pastBriefs.map((brief, i) => {
              const isExpanded = expandedPastId === brief.id;
              const dateLabel = new Date(brief.date + "T12:00:00").toLocaleDateString("en-US", {
                weekday: "short", month: "short", day: "numeric",
              });
              return (
                <div key={brief.id} style={{ borderTop: i > 0 ? `1px solid ${OS.border}` : "none" }}>
                  <div
                    onClick={() => setExpandedPastId(isExpanded ? null : (brief.id ?? null))}
                    style={{
                      display: "flex", alignItems: "center", padding: "11px 14px",
                      cursor: "pointer", gap: 10,
                    }}
                  >
                    <span style={{ fontSize: 12, fontWeight: 600, color: OS.secondary, minWidth: 84, flexShrink: 0 }}>
                      {dateLabel}
                    </span>
                    <span style={{
                      flex: 1, fontSize: 12, color: OS.text,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {brief.greeting}
                    </span>
                    <span style={{ fontSize: 10, color: OS.faint, flexShrink: 0 }}>
                      {isExpanded ? "\u25B2" : "\u25BC"}
                    </span>
                  </div>
                  {isExpanded && (
                    <div style={{ borderTop: `1px solid ${OS.border}` }}>
                      <MorningBriefCard
                        brief={brief}
                        commitments={commitments}
                        onCalendar={onCalendar}
                        onDismiss={() => {}}
                        onSnooze={() => {}}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Nav Icon (collapsed mode button) ───

function NavIcon({ icon, label, active, onClick }: {
  icon: string; label: string; active: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      style={{
        width: 36, height: 36, borderRadius: 8,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: active ? "rgba(255,255,255,0.1)" : "transparent",
        border: active ? "1px solid rgba(255,255,255,0.15)" : "1px solid transparent",
        color: active ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.5)",
        fontSize: 16, cursor: "pointer",
        transition: "all 0.1s ease",
        margin: "2px auto",
      }}
    >
      {icon}
    </button>
  );
}

// ─── Left Navigation Sidebar ───

function LeftNav({
  viewMode,
  setViewMode,
  filter,
  setFilter,
  counts,
  commitments,
  developerMode,
  onOpenSettings,
  collapsed,
  onToggleCollapse,
}: {
  viewMode: ViewMode;
  setViewMode: (v: ViewMode) => void;
  filter: FilterKey;
  setFilter: (f: FilterKey) => void;
  counts: { all: number; high: number; byMe: number; assignedToMe: number };
  commitments: Commitment[];
  developerMode: boolean;
  onOpenSettings: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}) {
  const meetingsCount = commitments.filter((c) => c.source_type === "meeting").length;
  const slackCount = commitments.filter((c) => c.source_type === "slack").length;
  const isFilterView = viewMode === "list" || viewMode === "board";

  const labelColor = "rgba(255,255,255,0.42)";
  const itemColor = "rgba(255,255,255,0.84)";
  const itemMuted = "rgba(255,255,255,0.32)";
  const activeBg = "rgba(255,255,255,0.1)";
  const activeBorder = "#5b8dee";

  function NavSection({ label }: { label: string }) {
    return (
      <div style={{
        fontSize: 10, fontWeight: 700, color: labelColor,
        textTransform: "uppercase", letterSpacing: "0.08em",
        padding: "14px 16px 5px",
      }}>
        {label}
      </div>
    );
  }

  function NavItem({ label, count, active, dimmed, onClick }: {
    label: string; count?: number; active: boolean; dimmed?: boolean; onClick: () => void;
  }) {
    return (
      <div
        onClick={onClick}
        style={{
          display: "flex", alignItems: "center",
          padding: "7px 12px 7px 14px", cursor: "pointer",
          background: active ? activeBg : "transparent",
          borderLeft: `2px solid ${active ? activeBorder : "transparent"}`,
          marginRight: 8, borderRadius: "0 6px 6px 0",
          transition: "background 0.1s ease",
        }}
      >
        <span style={{
          flex: 1, fontSize: 13,
          fontWeight: active ? 600 : 400,
          color: dimmed ? itemMuted : itemColor,
        }}>
          {label}
        </span>
        {count !== undefined && (
          <span style={{
            fontSize: 11, fontWeight: 500,
            color: active ? "rgba(255,255,255,0.9)" : labelColor,
            background: active ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.07)",
            padding: "1px 6px", borderRadius: 8,
            minWidth: 20, textAlign: "center",
          }}>
            {count}
          </span>
        )}
      </div>
    );
  }

  // ── Collapsed mode: icon column ──
  if (collapsed) {
    return (
      <div style={{
        width: 56, flexShrink: 0, height: "100vh",
        background: OS.darkBlue, display: "flex",
        flexDirection: "column", alignItems: "center",
        fontFamily: OS.font,
        transition: "width 0.15s ease",
      }}>
        {/* Expand button */}
        <div style={{ padding: "14px 0 10px", borderBottom: "1px solid rgba(255,255,255,0.1)", width: "100%", textAlign: "center" }}>
          <button
            onClick={onToggleCollapse}
            title="Expand sidebar"
            style={{
              background: "none", border: "none",
              color: "rgba(255,255,255,0.5)", fontSize: 16,
              cursor: "pointer", padding: "4px 0",
            }}
          >
            {"\u203A"}
          </button>
        </div>

        {/* View icons */}
        <div style={{ flex: 1, paddingTop: 10, display: "flex", flexDirection: "column", gap: 2 }}>
          <NavIcon icon={"\u25A6"} label="Board" active={viewMode === "board"} onClick={() => setViewMode("board")} />
          <NavIcon icon={"\u2630"} label="List" active={viewMode === "list"} onClick={() => setViewMode("list")} />
          <NavIcon icon={"\u2600"} label="Brief" active={viewMode === "brief"} onClick={() => setViewMode("brief")} />
          {developerMode && (
            <NavIcon icon={"</>"} label="Dev Log" active={viewMode === "devlog"} onClick={() => setViewMode("devlog")} />
          )}
        </div>

        {/* Settings icon */}
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", padding: "10px 0", width: "100%", textAlign: "center" }}>
          <NavIcon icon={"\u2699"} label="Settings" active={false} onClick={onOpenSettings} />
        </div>
      </div>
    );
  }

  // ── Expanded mode ──
  return (
    <div style={{
      width: 200, flexShrink: 0, height: "100vh",
      background: OS.darkBlue, display: "flex",
      flexDirection: "column", fontFamily: OS.font,
      transition: "width 0.15s ease",
    }}>
      {/* Title + collapse chevron */}
      <div style={{
        padding: "18px 16px 14px",
        borderBottom: "1px solid rgba(255,255,255,0.1)",
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "rgba(255,255,255,0.95)", letterSpacing: "-0.01em" }}>
          Clyde
        </div>
        <button
          onClick={onToggleCollapse}
          title="Collapse sidebar"
          style={{
            background: "none", border: "none",
            color: "rgba(255,255,255,0.4)", fontSize: 16,
            cursor: "pointer", padding: "0 2px",
            lineHeight: 1,
          }}
        >
          {"\u2039"}
        </button>
      </div>

      {/* Nav items */}
      <div style={{ flex: 1, overflowY: "auto", paddingBottom: 8 }}>
        <NavSection label="Views" />
        <NavItem label="Board" active={viewMode === "board"} onClick={() => setViewMode("board")} />
        <NavItem label="List" active={viewMode === "list"} onClick={() => setViewMode("list")} />
        <NavItem label="Brief" active={viewMode === "brief"} onClick={() => setViewMode("brief")} />
        {developerMode && (
          <NavItem label="Dev Log" active={viewMode === "devlog"} onClick={() => setViewMode("devlog")} />
        )}

        <NavSection label="Filter" />
        <NavItem
          label="All" count={counts.all}
          active={isFilterView && filter === "all"} dimmed={!isFilterView}
          onClick={() => { setFilter("all"); if (!isFilterView) setViewMode("list"); }}
        />
        <NavItem
          label="Urgent" count={counts.high}
          active={isFilterView && filter === "high"} dimmed={!isFilterView}
          onClick={() => { setFilter("high"); if (!isFilterView) setViewMode("list"); }}
        />
        <NavItem
          label="Mine" count={counts.byMe}
          active={isFilterView && filter === "by_me"} dimmed={!isFilterView}
          onClick={() => { setFilter("by_me"); if (!isFilterView) setViewMode("list"); }}
        />

        <NavSection label="Sources" />
        <NavItem
          label="Meetings" count={meetingsCount}
          active={isFilterView && filter === "meetings"} dimmed={!isFilterView}
          onClick={() => { setFilter("meetings"); if (!isFilterView) setViewMode("list"); }}
        />
        <NavItem
          label="Slack" count={slackCount}
          active={isFilterView && filter === "slack"} dimmed={!isFilterView}
          onClick={() => { setFilter("slack"); if (!isFilterView) setViewMode("list"); }}
        />
      </div>

      {/* Settings footer */}
      <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", padding: "10px 14px" }}>
        <button
          onClick={onOpenSettings}
          style={{
            display: "flex", alignItems: "center", gap: 8,
            background: "none", border: "none",
            color: "rgba(255,255,255,0.5)", fontSize: 12,
            cursor: "pointer", fontFamily: OS.font, padding: "4px 0",
          }}
        >
          <span style={{ fontSize: 14 }}>{"\u2699"}</span>
          <span>Settings</span>
        </button>
      </div>
    </div>
  );
}

// ─── Main App ───

export default function App() {
  const { commitments, dismissalPatterns, counts } = useCommitments();
  const actions = useActions();
  const [filter, setFilter] = useState<FilterKey>("all");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [toast, setToast] = useState<{ message: string; variant?: "success" | "error" | "warning" | "info" } | null>(null);
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null);
  const [isFirstRun, setIsFirstRun] = useState<boolean | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [isWide, setIsWide] = useState(false);
  const isNarrow = !isWide;
  const [viewMode, setViewMode] = useState<ViewMode>("board");
  const [developerMode, setDeveloperMode] = useState(false);
  const scanAgo = useScanAgo();
  const kanban = useKanban(filter);
  const { settings: displaySettings, update: updateDisplay } = useDisplaySettings();
  const nav = useNavCollapsed();

  const pendingSuggestions = useLiveQuery(
    () => db.completion_suggestions.where("status").equals("pending").toArray(),
    []
  ) ?? [];

  useEffect(() => {
    chrome.storage.local.get(["anthropicApiKey", "userName", "developerMode"]).then((result) => {
      setHasApiKey(!!result.anthropicApiKey);
      setDeveloperMode(result.developerMode === true);
      setIsFirstRun(!result.anthropicApiKey && !result.userName);
    });
  }, []);

  useEffect(() => {
    const check = () => setIsWide(window.innerWidth > 700);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Auto-collapse nav when entering brief view
  useEffect(() => {
    if (viewMode === "brief") nav.setTo(true);
  }, [viewMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const showToast = useCallback((msg: string, variant?: "success" | "error" | "warning" | "info") => {
    setToast({ message: msg, variant });
  }, []);

  // Check for recent errors from the background pipeline
  useEffect(() => {
    const checkErrors = async () => {
      try {
        const result = await chrome.storage.session.get("pipelineStatus");
        const status = result.pipelineStatus as { lastError?: string | null; lastExtraction?: string | null } | undefined;
        if (status?.lastError) {
          const lastExtraction = status.lastExtraction ? new Date(status.lastExtraction).getTime() : 0;
          const fiveMinAgo = Date.now() - 5 * 60 * 1000;
          if (lastExtraction > fiveMinAgo) {
            showToast(status.lastError, "error");
          }
        }
      } catch { /* session storage not available in some contexts */ }
    };
    checkErrors();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Action handlers ───

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

  const onAcceptCompletion = useCallback(async (suggestionId: number, commitmentId: number) => {
    const now = new Date().toISOString();
    await db.commitments.update(commitmentId, { status: "done" });
    await db.action_log.add({ commitmentId, action: "done", createdAt: now });
    await db.completion_suggestions.update(suggestionId, { status: "accepted" });
    showToast("\u2713 Marked done");
  }, [showToast]);

  const onDismissCompletion = useCallback(async (suggestionId: number, commitmentId: number) => {
    await db.completion_suggestions.update(suggestionId, { status: "dismissed" });
    const existing = await db.dismissed_completions.get(commitmentId);
    if (existing) {
      await db.dismissed_completions.update(commitmentId, {
        dismissCount: existing.dismissCount + 1,
        lastDismissedAt: new Date().toISOString(),
      });
    } else {
      await db.dismissed_completions.add({
        commitmentId,
        dismissCount: 1,
        lastDismissedAt: new Date().toISOString(),
      });
    }
  }, []);

  // ─── Filtering and sorting ───

  const filtered = commitments
    .filter((c) => {
      if (filter === "all") return true;
      if (filter === "high") return c.urgency === "high" || (c.deadline != null && new Date(c.deadline).getTime() < Date.now());
      if (filter === "by_me") return c.direction === "by_me";
      if (filter === "meetings") return c.source_type === "meeting";
      if (filter === "slack") return c.source_type === "slack";
      return true;
    })
    .sort((a, b) => {
      if (a.likely_completed !== b.likely_completed) {
        return a.likely_completed ? 1 : -1;
      }
      const urg: Record<string, number> = { high: 0, medium: 1, low: 2 };
      if (urg[a.urgency] !== urg[b.urgency])
        return urg[a.urgency] - urg[b.urgency];
      return b.confidence - a.confidence;
    });

  // ─── Section grouping ───

  const urgent = filtered.filter(
    (c) => c.urgency === "high" || (c.deadline && new Date(c.deadline).getTime() < Date.now()),
  );
  const urgentIds = new Set(urgent.map((c) => c.id));
  const open = filtered.filter((c) => !urgentIds.has(c.id) && c.confidence >= 0.75);
  const unsure = filtered.filter((c) => !urgentIds.has(c.id) && c.confidence < 0.75);

  const renderCard = (item: Commitment) => (
    <CommitmentCard
      key={item.id}
      item={item}
      isExpanded={expandedId === item.id}
      isSelected={selectedId === item.id}
      isNarrow={!isWide}
      verboseMode={displaySettings.showConfidence}
      displaySettings={displaySettings}
      onToggle={() =>
        setExpandedId(expandedId === item.id ? null : (item.id ?? null))
      }
      onSelect={(id) => setSelectedId(selectedId === id ? null : id)}
      onDismiss={onDismiss}
      onDone={onDone}
      onSnooze={onSnooze}
      onCalendar={onCalendar}
      onSlack={onSlack}
      onReminder={onReminder}
    />
  );

  // Resolve selected item for the detail panel
  const allItems = viewMode === "board"
    ? [...kanban.todo, ...kanban.inProgress, ...kanban.done]
    : filtered;
  const selectedItem = selectedId != null ? allItems.find((c) => c.id === selectedId) ?? null : null;
  const showPanel = selectedItem != null && !isNarrow;

  // First-run: show setup wizard
  if (isFirstRun) {
    return (
      <SetupWizard onComplete={() => {
        setIsFirstRun(false);
        setHasApiKey(true);
      }} />
    );
  }

  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        overflow: "hidden",
        background: OS.bg,
        fontFamily: OS.font,
        color: OS.text,
      }}
    >
      {showPanel && (
        <style>{`@keyframes slideInPanel { from { opacity: 0; transform: translateX(16px); } to { opacity: 1; transform: translateX(0); } }`}</style>
      )}

      {/* Left nav sidebar — wide screens only */}
      {isWide && (
        <LeftNav
          viewMode={viewMode}
          setViewMode={setViewMode}
          filter={filter}
          setFilter={setFilter}
          counts={counts}
          commitments={commitments}
          developerMode={developerMode}
          onOpenSettings={() => chrome.runtime.openOptionsPage?.()}
          collapsed={nav.collapsed}
          onToggleCollapse={nav.toggle}
        />
      )}

      {/* Main content column */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          height: "100vh",
          overflowY: isWide ? "hidden" : "auto",
          display: isWide ? "flex" : undefined,
          flexDirection: isWide ? "column" : undefined,
        }}
      >
        {/* Warning banner */}
        <WarningBanner onOpenSettings={() => chrome.runtime.openOptionsPage?.()} />

        {/* Narrow header — includes view selector, filter, settings */}
        {!isWide && (
          <div
            style={{
              background: OS.white,
              borderBottom: `1px solid ${OS.border}`,
              position: "sticky",
              top: 0,
              zIndex: 10,
            }}
          >
            <div style={{ padding: "14px 16px 0 16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 10 }}>
                <h1 style={{ fontSize: 20, fontWeight: 700, color: OS.text, letterSpacing: "-0.02em", flexShrink: 0 }}>
                  Clyde
                </h1>
                <select
                  value={viewMode}
                  onChange={(e) => setViewMode(e.target.value as ViewMode)}
                  style={{
                    fontSize: 12, fontWeight: 500, fontFamily: OS.font,
                    color: OS.text, background: OS.white,
                    border: `1px solid ${OS.border}`, borderRadius: 6,
                    padding: "4px 8px", cursor: "pointer", outline: "none",
                  }}
                >
                  <option value="list">List</option>
                  <option value="board">Board</option>
                  <option value="brief">Brief</option>
                  {developerMode && <option value="devlog">Dev Log</option>}
                </select>
                <FilterBar filter={filter} setFilter={setFilter} />
                <div style={{ marginLeft: "auto", position: "relative", flexShrink: 0 }}>
                  <button
                    onClick={() => setShowSettings(!showSettings)}
                    title="Settings"
                    style={{
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      width: 30, height: 30, borderRadius: 6,
                      background: OS.white, border: `1px solid ${OS.border}`,
                      color: OS.muted, fontSize: 14, cursor: "pointer",
                    }}
                  >
                    {"\u2699"}
                  </button>
                  {showSettings && (
                    <SettingsPopover
                      display={displaySettings}
                      onUpdateDisplay={updateDisplay}
                      onClose={() => setShowSettings(false)}
                    />
                  )}
                </div>
              </div>
              <div style={{ borderBottom: `1px solid ${OS.border}` }} />
            </div>
          </div>
        )}

        {/* Wide mode thin top bar — scan time + display settings */}
        {isWide && (
          <div
            style={{
              background: OS.white,
              borderBottom: `1px solid ${OS.border}`,
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              padding: "7px 16px",
              gap: 12,
              zIndex: 10,
            }}
          >
            {scanAgo && (
              <span style={{ fontSize: 11, color: OS.muted }}>Scanned {scanAgo}</span>
            )}
            <div style={{ position: "relative" }}>
              <button
                onClick={() => setShowSettings(!showSettings)}
                title="Display Settings"
                style={{
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  width: 28, height: 28, borderRadius: 6,
                  background: OS.white, border: `1px solid ${OS.border}`,
                  color: OS.muted, fontSize: 13, cursor: "pointer",
                }}
              >
                {"\u2699"}
              </button>
              {showSettings && (
                <SettingsPopover
                  display={displaySettings}
                  onUpdateDisplay={updateDisplay}
                  onClose={() => setShowSettings(false)}
                />
              )}
            </div>
          </div>
        )}

        {/* Scrollable content area */}
        <div style={{ flex: isWide ? 1 : undefined, overflowY: isWide ? "auto" : undefined }}>
          <div style={{
            maxWidth: viewMode === "board" ? "none" : 640,
            margin: viewMode === "board" ? undefined : "0 auto",
            padding: viewMode === "board" ? "12px 16px" : 0,
          }}>
            {hasApiKey === false && (
              <div style={{ padding: "20px 16px" }}>
                <ApiKeySetup onSaved={() => setHasApiKey(true)} />
              </div>
            )}

            {/* Board view */}
            {hasApiKey !== false && viewMode === "board" && (
              <KanbanBoard
                todo={kanban.todo}
                inProgress={kanban.inProgress}
                done={kanban.done}
                selectedId={selectedId}
                onSelect={(id) => setSelectedId(id)}
                actions={actions}
                showToast={showToast}
                isNarrow={isNarrow}
                verboseMode={displaySettings.showConfidence}
              />
            )}

            {/* List view */}
            {hasApiKey !== false && viewMode === "list" && (
              <div style={{ background: OS.white }}>
                {filtered.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "56px 16px" }}>
                    <div style={{ fontSize: 22, marginBottom: 8 }}>{"\u2713"}</div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: OS.text, marginBottom: 4 }}>
                      No commitments yet
                    </div>
                    <div style={{ fontSize: 13, color: OS.muted, lineHeight: 1.6, maxWidth: 280, margin: "0 auto" }}>
                      Open Slack and Clyde will automatically detect commitments.
                      Say "Clyde" in any message to explicitly flag something.
                    </div>
                  </div>
                ) : (
                  <>
                    {pendingSuggestions.length > 0 && (
                      <>
                        <SectionHeader label="Completed?" color="#16a34a" />
                        {pendingSuggestions.map((suggestion) => {
                          const commitment = commitments.find(c => c.id === suggestion.commitmentId);
                          return (
                            <CompletionSuggestionCard
                              key={suggestion.id}
                              suggestion={suggestion}
                              commitment={commitment}
                              onAccept={() => suggestion.id != null && onAcceptCompletion(suggestion.id, suggestion.commitmentId)}
                              onDismiss={() => suggestion.id != null && onDismissCompletion(suggestion.id, suggestion.commitmentId)}
                            />
                          );
                        })}
                      </>
                    )}
                    {urgent.length > 0 && (
                      <>
                        <SectionHeader label="Needs attention" color={OS.red} />
                        {urgent.map(renderCard)}
                      </>
                    )}
                    {open.length > 0 && (
                      <>
                        {urgent.length > 0 && <SectionHeader label="Open" color={OS.secondary} />}
                        {open.map(renderCard)}
                      </>
                    )}
                    {unsure.length > 0 && (
                      <>
                        <SectionHeader label="Might be commitments" color={OS.muted} />
                        {unsure.map(renderCard)}
                      </>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Brief view */}
            {viewMode === "brief" && (
              <BriefView commitments={commitments} onCalendar={onCalendar} onDone={onDone} />
            )}

            {/* Dev Log view */}
            {viewMode === "devlog" && <DevLogView />}

            {/* Learned patterns */}
            {hasApiKey !== false && viewMode !== "devlog" && viewMode !== "brief" && dismissalPatterns.length > 0 && (
              <div style={{
                padding: "14px 16px", fontSize: 12,
                color: OS.muted, textAlign: "center", fontFamily: OS.font,
              }}>
                {"\uD83E\uDDE0 "}{dismissalPatterns.length} pattern{dismissalPatterns.length !== 1 ? "s" : ""} suppressed
                {" \u00B7 "}
                <span
                  onClick={() => chrome.runtime.openOptionsPage?.()}
                  style={{ textDecoration: "underline", cursor: "pointer" }}
                >
                  Manage
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Transcript detail panel */}
      {showPanel && (
        <div style={{
          width: 420,
          flexShrink: 0,
          borderLeft: `1px solid ${OS.border}`,
          height: "100vh",
          overflowY: "auto",
          background: OS.white,
          animation: "slideInPanel 0.15s ease",
        }}>
          <TranscriptPanel
            commitment={selectedItem}
            onClose={() => setSelectedId(null)}
            onCalendar={() => onCalendar(selectedItem)}
            onDone={() => selectedItem.id != null && onDone(selectedItem.id)}
            onDismiss={() => selectedItem.id != null && onDismiss(selectedItem.id)}
            onReminder={() => selectedItem.id != null && onReminder(selectedItem.id)}
          />
        </div>
      )}

      {toast && <Toast message={toast.message} variant={toast.variant} onClose={() => setToast(null)} />}
    </div>
  );
}
