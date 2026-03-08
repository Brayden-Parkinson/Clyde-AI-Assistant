import React, { useState, useCallback, useEffect, useRef } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { OS } from "@shared/tokens";
import type { Commitment, CompletionSuggestion, MorningBrief, DecisionLogEntry, ActionLogEntry, Tag } from "@shared/types";
import type { PipelineStatus } from "@shared/status";
import { db } from "@shared/db";
import { useCommitments } from "./hooks/useCommitments";
import { useActions, type Actions } from "./hooks/useActions";
import { useKanban } from "./hooks/useKanban";
import {
  DEMO_ACTIVE,
  DEMO_KANBAN,
  DEMO_COUNTS,
  DEMO_DISMISSALS,
  DEMO_SUGGESTIONS,
  DEMO_BRIEFS,
  DEMO_DECISION_LOG,
  DEMO_TAGS,
} from "@shared/demo-data";
import { CommitmentCard } from "./components/CommitmentCard";
import { KanbanBoard } from "./components/KanbanBoard";
import type { FilterKey } from "./components/FilterBar";
import { ViewToolbar, matchesSearch } from "./components/ViewToolbar";
import { Toast } from "./components/Toast";
import { TranscriptPanel } from "./components/TranscriptPanel";
import { SmartTagsModal } from "./components/SmartTagsModal";
import { SetupWizard } from "./components/SetupWizard";
import { SettingsPanel } from "../options/Options";
import { ClydeChat } from "./components/ClydeChat";
import {
  IconSettings, IconWarning, IconX, IconRefresh, IconLoader, IconCheck,
  IconBoard, IconList, IconSun, IconChevronRight, IconChevronLeft,
  IconChevronUp, IconChevronDown, IconArrowRight, IconClock, IconLogo,
  IconSearch, InlineIcon,
} from "./components/Icons";

type ViewMode = "list" | "board" | "brief" | "devlog" | "settings";

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
  onOpenFullSettings,
  anchorRef,
  style: positionStyle,
  privacyMode,
  onTogglePrivacy,
}: {
  display: DisplaySettings;
  onUpdateDisplay: (patch: Partial<DisplaySettings>) => void;
  onClose: () => void;
  onOpenFullSettings: () => void;
  anchorRef?: React.RefObject<HTMLElement>;
  style?: React.CSSProperties;
  privacyMode: boolean;
  onTogglePrivacy: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) &&
          !(anchorRef?.current && anchorRef.current.contains(e.target as Node))) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose, anchorRef]);

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
        ...positionStyle,
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

      {/* Privacy mode toggle */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 0 8px",
          borderTop: `1px solid ${OS.border}`,
          marginTop: 4,
        }}
      >
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: OS.text }}>Hide sensitive items</div>
          <div style={{ fontSize: 11, color: OS.muted, marginTop: 1 }}>Blur HR, personal & confidential</div>
        </div>
        <ToggleSwitch on={privacyMode} onToggle={onTogglePrivacy} />
      </div>

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
        onClick={() => { onOpenFullSettings(); onClose(); }}
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
        onMouseEnter={(e) => { e.currentTarget.style.background = OS.border; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = OS.bg; }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><IconSettings size={12} /> All settings...</span>
      </button>
    </div>
  );
}

// ─── Warning banner (replaces StatusPanel) ───

function WarningBanner({ onOpenSettings, demoMode }: { onOpenSettings: () => void; demoMode?: boolean }) {
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

  if (demoMode) return null;
  if (dismissed || !status) return null;

  const problems: string[] = [];
  if (!status.slackConnected) problems.push("Slack not connected");
  // Granola connects lazily — don't warn about it since it resolves on its own
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
      color: "#8a6e1a",
      fontFamily: OS.font,
    }}>
      <span>
        <InlineIcon><IconWarning size={12} /></InlineIcon>{" "}{problems[0] === "Slack not connected"
          ? "Slack not connected \u2014 open or reload Slack in your browser"
          : problems[0] === "API key missing"
            ? <>{"API key missing \u2014 "}
                <span onClick={onOpenSettings} style={{ textDecoration: "underline", cursor: "pointer", fontWeight: 600 }}>
                  add it in Settings
                </span>
              </>
            : problems[0]
        }
        {problems.length > 1 ? ` (+${problems.length - 1} more)` : ""}
      </span>
      <button
        onClick={() => setDismissed(true)}
        style={{
          background: "none", border: "none", color: "#8a6e1a",
          cursor: "pointer", lineHeight: 1, padding: "0 0 0 8px",
          display: "inline-flex", alignItems: "center",
        }}
      >
        <IconX size={12} />
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

type LogEntryType = "accepted" | "rejected" | "user_dismissed" | "user_done";

interface UnifiedLogEntry {
  id: string;
  type: LogEntryType;
  timestamp: string;
  text: string;
  source: string;
  category: string | null;
  confidence: number | null;
  reason: string | null;
}

const LOG_TYPE_META: Record<LogEntryType, { label: string; color: string; bg: string }> = {
  accepted:       { label: "Accepted",  color: OS.green,  bg: OS.bg },
  rejected:       { label: "Rejected",  color: OS.muted,  bg: OS.bg },
  user_dismissed: { label: "Dismissed", color: "#b08d33", bg: OS.bg },
  user_done:      { label: "Done",      color: OS.blue,   bg: OS.bg },
};

function DevLogView({ demoMode, demoEntries }: { demoMode?: boolean; demoEntries?: DecisionLogEntry[] } = {}) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<LogEntryType | "all">("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const liveDecisions = useLiveQuery(
    () => db.decision_log.orderBy("createdAt").reverse().limit(500).toArray(),
    []
  ) ?? [];

  // User actions: dismissed + done commitments (with commitment text)
  const liveActions = useLiveQuery(async () => {
    if (demoMode) return [];
    const actions = await db.action_log
      .where("action")
      .anyOf("dismissed", "done")
      .reverse()
      .limit(200)
      .toArray();
    // Batch-fetch commitment data
    const commitmentIds = [...new Set(actions.map(a => a.commitmentId))];
    const commitments = await db.commitments.where("id").anyOf(commitmentIds).toArray();
    const commitmentMap = new Map(commitments.map(c => [c.id!, c]));
    return actions.map(a => ({ action: a, commitment: commitmentMap.get(a.commitmentId) }));
  }, [demoMode]) ?? [];

  const decisions = demoMode ? (demoEntries ?? []) : liveDecisions;

  // Merge into unified timeline
  const unified: UnifiedLogEntry[] = [];

  for (const entry of decisions) {
    unified.push({
      id: `d-${entry.id}`,
      type: entry.decision === "accepted" ? "accepted" : "rejected",
      timestamp: entry.createdAt,
      text: entry.original_text,
      source: `${entry.sender} in #${entry.channel}`,
      category: entry.category,
      confidence: entry.confidence,
      reason: entry.reason,
    });
  }

  for (const { action, commitment } of liveActions) {
    unified.push({
      id: `a-${action.id}`,
      type: action.action === "dismissed" ? "user_dismissed" : "user_done",
      timestamp: action.createdAt,
      text: commitment?.original_quote ?? commitment?.text ?? "(deleted commitment)",
      source: commitment?.context ?? "",
      category: null,
      confidence: commitment?.confidence ?? null,
      reason: commitment ? commitment.text : null,
    });
  }

  // Sort by timestamp descending
  unified.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  // Apply filters
  const searchLower = search.toLowerCase();
  const filtered = unified.filter(entry => {
    if (typeFilter !== "all" && entry.type !== typeFilter) return false;
    if (searchLower && !entry.text.toLowerCase().includes(searchLower)
        && !entry.source.toLowerCase().includes(searchLower)
        && !(entry.reason ?? "").toLowerCase().includes(searchLower)) return false;
    return true;
  });

  // Counts per type
  const counts: Record<string, number> = { all: unified.length };
  for (const e of unified) counts[e.type] = (counts[e.type] ?? 0) + 1;

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const isToday = d.toDateString() === now.toDateString();
    const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
    if (isToday) return time;
    if (diffMs < 7 * 86400000) {
      const day = d.toLocaleDateString([], { weekday: "short" });
      return `${day} ${time}`;
    }
    return d.toLocaleDateString([], { month: "short", day: "numeric" }) + " " + time;
  };

  if (unified.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "56px 16px", fontFamily: OS.font }}>
        <div style={{ fontSize: 13, color: OS.muted }}>
          No log entries yet. Decisions will appear after the next scan.
        </div>
      </div>
    );
  }

  // Group entries by time bucket for visual separation
  const getTimeGroup = (iso: string): string => {
    const d = new Date(iso);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      const h = d.getHours();
      if (h < 6) return "Early morning";
      if (h < 12) return "Morning";
      if (h < 17) return "Afternoon";
      return "Evening";
    }
    const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return d.toLocaleDateString([], { weekday: "long" });
    return d.toLocaleDateString([], { month: "long", day: "numeric" });
  };

  // Build grouped entries
  const groups: Array<{ label: string; entries: typeof filtered }> = [];
  let currentGroup = "";
  for (const entry of filtered) {
    const group = getTimeGroup(entry.timestamp);
    if (group !== currentGroup) {
      groups.push({ label: group, entries: [] });
      currentGroup = group;
    }
    groups[groups.length - 1].entries.push(entry);
  }

  return (
    <div style={{ padding: "12px 16px", fontFamily: OS.font, fontSize: 13 }}>
      {/* Toolbar */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center" }}>
        <div style={{
          flex: 1, display: "flex", alignItems: "center",
          background: OS.white, borderRadius: 8, padding: "0 10px",
          border: `1px solid ${OS.border}`,
        }}>
          <input
            type="text"
            placeholder="Filter entries..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              flex: 1, padding: "8px 0", fontSize: 13,
              fontFamily: OS.font, border: "none", background: "transparent",
              color: OS.text, outline: "none",
            }}
          />
          {search && (
            <span
              onClick={() => setSearch("")}
              style={{ color: OS.muted, cursor: "pointer", padding: "0 2px", display: "inline-flex", alignItems: "center" }}
            >
              <IconX size={12} />
            </span>
          )}
        </div>
        {!demoMode && (
          <button
            onClick={() => db.decision_log.clear()}
            style={{
              background: OS.white, border: `1px solid ${OS.border}`, borderRadius: 8,
              color: OS.muted, fontSize: 12, cursor: "pointer",
              fontFamily: OS.font, padding: "8px 12px", whiteSpace: "nowrap",
            }}
          >
            Clear log
          </button>
        )}
      </div>

      {/* Filter pills */}
      <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        {(["all", "accepted", "rejected", "user_dismissed", "user_done"] as const).map((key) => {
          const count = counts[key] ?? 0;
          if (key !== "all" && count === 0) return null;
          const active = typeFilter === key;
          const meta = key === "all" ? null : LOG_TYPE_META[key];
          return (
            <button
              key={key}
              onClick={() => setTypeFilter(key)}
              style={{
                padding: "5px 12px", borderRadius: 6, fontSize: 12,
                fontFamily: OS.font, fontWeight: active ? 600 : 500,
                border: `1px solid ${active ? (meta?.color ?? OS.text) + "33" : OS.border}`,
                cursor: "pointer",
                background: active ? (meta?.bg ?? OS.bg) : OS.white,
                color: active ? (meta?.color ?? OS.text) : OS.muted,
                transition: "all 0.1s ease",
              }}
            >
              {key === "all" ? "All" : meta!.label}
              <span style={{
                marginLeft: 5, fontSize: 11, opacity: 0.6,
                fontFamily: OS.mono,
              }}>
                {count}
              </span>
            </button>
          );
        })}
        <span style={{ marginLeft: "auto", fontSize: 11, color: OS.faint, fontFamily: OS.mono }}>
          {filtered.length}/{unified.length}
        </span>
      </div>

      {/* Log entries — grouped */}
      <div style={{
        background: OS.white, borderRadius: 10, overflow: "hidden",
        border: `1px solid ${OS.border}`,
        maxHeight: "calc(100vh - 220px)", overflowY: "auto",
      }}>
        {filtered.length === 0 ? (
          <div style={{ padding: "32px 16px", color: OS.muted, textAlign: "center", fontSize: 13 }}>
            No matching entries
          </div>
        ) : groups.map((group) => (
          <div key={group.label}>
            {/* Time group header */}
            <div style={{
              padding: "10px 16px 6px",
              fontSize: 11,
              fontWeight: 600,
              color: OS.muted,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              background: OS.bg,
              borderBottom: `1px solid ${OS.border}`,
              position: "sticky",
              top: 0,
              zIndex: 1,
            }}>
              {group.label}
            </div>

            {group.entries.map((entry) => {
              const meta = LOG_TYPE_META[entry.type];
              const isExpanded = expandedId === entry.id;
              return (
                <div key={entry.id} style={{ borderBottom: `1px solid ${OS.border}` }}>
                  <div
                    onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                    style={{
                      padding: "10px 16px",
                      cursor: "pointer",
                      display: "flex", gap: 12, alignItems: "flex-start",
                      background: isExpanded ? OS.bg : OS.white,
                      borderLeft: `3px solid ${meta.color}`,
                      transition: "background 0.1s ease",
                    }}
                    onMouseEnter={(e) => { if (!isExpanded) e.currentTarget.style.background = OS.bg; }}
                    onMouseLeave={(e) => { if (!isExpanded) e.currentTarget.style.background = OS.white; }}
                  >
                    {/* Left: timestamp + badge stacked */}
                    <div style={{ flexShrink: 0, width: 62, paddingTop: 1 }}>
                      <div style={{ fontSize: 11, color: OS.muted, fontFamily: OS.mono, lineHeight: 1.4 }}>
                        {formatTime(entry.timestamp)}
                      </div>
                      <div style={{
                        display: "inline-block",
                        marginTop: 4,
                        padding: "1px 7px",
                        borderRadius: 4,
                        fontSize: 10,
                        fontWeight: 600,
                        color: meta.color,
                        background: meta.bg,
                        border: `1px solid ${meta.color}22`,
                        lineHeight: 1.6,
                        fontFamily: OS.font,
                      }}>
                        {meta.label}
                      </div>
                    </div>

                    {/* Center: message text + metadata */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 13, color: OS.text, lineHeight: 1.5,
                        overflow: "hidden", textOverflow: "ellipsis",
                        whiteSpace: isExpanded ? "pre-wrap" : "nowrap",
                        fontFamily: OS.font,
                      }}>
                        {entry.text}
                      </div>
                      {!isExpanded && entry.source && (
                        <div style={{ fontSize: 11, color: OS.faint, marginTop: 2, fontFamily: OS.font }}>
                          {entry.source}
                        </div>
                      )}
                    </div>

                    {/* Right: confidence */}
                    {entry.confidence != null && (
                      <div style={{
                        flexShrink: 0,
                        fontSize: 11,
                        fontWeight: 600,
                        fontFamily: OS.mono,
                        color: entry.confidence >= 0.8 ? OS.green : entry.confidence >= 0.6 ? "#b08d33" : OS.faint,
                        paddingTop: 2,
                      }}>
                        {Math.round(entry.confidence * 100)}%
                      </div>
                    )}
                  </div>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div style={{
                      padding: "0 16px 14px 93px",
                      background: OS.bg,
                      borderLeft: `3px solid ${meta.color}`,
                    }}>
                      <div style={{
                        display: "flex", flexDirection: "column", gap: 6,
                        fontSize: 12, lineHeight: 1.5,
                      }}>
                        {entry.source && (
                          <div style={{ display: "flex", gap: 8 }}>
                            <span style={{ color: OS.faint, flexShrink: 0, width: 60 }}>Source</span>
                            <span style={{ color: OS.secondary }}>{entry.source}</span>
                          </div>
                        )}
                        {entry.reason && (
                          <div style={{ display: "flex", gap: 8 }}>
                            <span style={{ color: OS.faint, flexShrink: 0, width: 60 }}>
                              {entry.type === "accepted" ? "Extracted" : entry.type.startsWith("user_") ? "Task" : "Reason"}
                            </span>
                            <span style={{ color: OS.secondary }}>{entry.reason}</span>
                          </div>
                        )}
                        {entry.category && (
                          <div style={{ display: "flex", gap: 8 }}>
                            <span style={{ color: OS.faint, flexShrink: 0, width: 60 }}>Category</span>
                            <span style={{ color: OS.muted }}>{entry.category.replace(/_/g, " ")}</span>
                          </div>
                        )}
                        {entry.confidence != null && (
                          <div style={{ display: "flex", gap: 8 }}>
                            <span style={{ color: OS.faint, flexShrink: 0, width: 60 }}>Conf.</span>
                            <span style={{ color: OS.secondary }}>{Math.round(entry.confidence * 100)}%</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
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
      background: OS.bg,
      borderLeft: `3px solid ${OS.green}`,
      padding: "14px 16px",
      borderBottom: `1px solid ${OS.border}`,
    }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: OS.green, marginBottom: 8 }}>
        Looks like you completed this
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
            background: OS.green, color: "#fff", border: "none", borderRadius: 5,
            cursor: "pointer",
          }}
        >
          Yes, mark done
        </button>
        <button
          onClick={onDismiss}
          style={{
            padding: "6px 14px", fontSize: 12, fontWeight: 500, fontFamily: OS.font,
            background: OS.white, color: OS.muted, border: `1px solid ${OS.border}`,
            borderRadius: 5, cursor: "pointer",
          }}
        >
          Not yet
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
      if (dl < todayStart + 86400000) return { label: "Due today", color: "#b08d33" };
      if (dl < tomorrowEnd) return { label: "Due tomorrow", color: OS.muted };
    }
    return null;
  }

  const activeMoves = brief.suggestedMoves.filter(m => !dismissedMoveIds.has(m.commitmentId));

  return (
    <div style={{ fontFamily: OS.font }}>
      {/* ── a) Header ── */}
      <div style={{
        padding: "20px 20px 16px",
        borderBottom: `1px solid ${OS.border}`,
        background: OS.white,
      }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 8 }}>
          <div>
            <div style={{
              fontSize: 10, fontWeight: 700, color: OS.muted,
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
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><IconRefresh size={11} /> Refresh</span>
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
            const circleColor = isOverdue ? OS.red : isTop ? OS.blue : OS.muted;
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
                        <InlineIcon><IconClock size={11} /></InlineIcon> {p.suggestedTime}
                      </span>
                    )}
                    {statusTag && (
                      <span style={{
                        fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 4,
                        background: OS.bg,
                        color: statusTag.color,
                        border: `1px solid ${OS.border}`,
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
                        background: OS.white, color: OS.secondary,
                        border: `1px solid ${OS.border}`, borderRadius: 4, cursor: "pointer",
                      }}
                    >
                      Block time
                    </button>
                  )}
                  {commitment && onDone && commitment.id != null && (
                    <button
                      onClick={() => onDone(commitment.id!)}
                      title="Mark done"
                      style={{
                        padding: "3px 8px", fontSize: 11, fontWeight: 600, fontFamily: OS.font,
                        background: OS.white, color: OS.secondary,
                        border: `1px solid ${OS.border}`, borderRadius: 4, cursor: "pointer",
                      }}
                    >
                      Done
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
                        <InlineIcon><IconArrowRight size={11} /></InlineIcon> {ev.end}
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

      {/* ── d) Suggested moves ── */}
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
                  <span style={{ fontSize: 13, color: OS.muted, flexShrink: 0 }}><InlineIcon><IconArrowRight size={11} /></InlineIcon></span>
                  <span style={{
                    flex: 1, fontSize: 12, color: OS.text,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {commitment.text}
                  </span>
                  <span style={{
                    fontSize: 10, fontWeight: 500, padding: "2px 7px", borderRadius: 4,
                    background: OS.bg, color: OS.secondary,
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
                      background: OS.white, color: OS.secondary,
                      border: `1px solid ${OS.border}`, borderRadius: 4, cursor: "pointer",
                      flexShrink: 0,
                    }}
                  >
                    <IconCheck size={11} />
                  </button>
                  <button
                    onClick={() => setDismissedMoveIds(prev => new Set([...prev, move.commitmentId]))}
                    style={{
                      padding: "3px 6px", fontSize: 11, fontWeight: 500, fontFamily: OS.font,
                      background: "none", color: OS.muted,
                      border: `1px solid ${OS.border}`, borderRadius: 4, cursor: "pointer",
                      flexShrink: 0, display: "inline-flex", alignItems: "center",
                    }}
                  >
                    <IconX size={11} />
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
  demoMode,
  demoBriefs,
}: {
  commitments: Commitment[];
  onCalendar: (commitment: Commitment) => void;
  onDone: (id: number) => void;
  demoMode?: boolean;
  demoBriefs?: MorningBrief[];
}) {
  const todayDateStr = new Date().toISOString().slice(0, 10);
  const liveBriefs = useLiveQuery(
    () => db.briefs.orderBy("date").reverse().toArray(),
    []
  ) ?? [];
  const allBriefs = demoMode ? (demoBriefs ?? []) : liveBriefs;

  const todayBrief = allBriefs.find(b => b.date === todayDateStr);
  const pastBriefs = allBriefs.filter(b => b.date !== todayDateStr);

  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [expandedPastId, setExpandedPastId] = useState<number | null>(null);
  const autoGenTriggered = useRef(false);

  const handleGenerate = async () => {
    if (demoMode) return;
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

  // Auto-generate brief when viewing this tab if none exists for today
  useEffect(() => {
    if (demoMode || todayBrief || autoGenTriggered.current) return;
    autoGenTriggered.current = true;
    handleGenerate();
  }, [todayBrief, demoMode]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", fontFamily: OS.font, paddingTop: 12 }}>
      {/* Auto-generating indicator when no brief exists */}
      {!todayBrief && generating && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: "16px", background: OS.white, borderBottom: `1px solid ${OS.border}`,
          fontSize: 13, color: OS.muted, gap: 8,
        }}>
          Generating your morning brief...
        </div>
      )}

      {genError && (
        <div style={{
          margin: "12px 16px 0", padding: "8px 12px",
          background: OS.bg, color: OS.red, fontSize: 12, borderRadius: 6,
          border: `1px solid ${OS.border}`,
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
              if (demoMode) return;
              if (todayBrief.id != null) await db.briefs.update(todayBrief.id, { dismissed: true });
            }}
            onSnooze={async () => {
              if (demoMode) return;
              if (todayBrief.id != null) {
                await db.briefs.update(todayBrief.id, {
                  snoozedUntil: new Date(Date.now() + 3600000).toISOString(),
                });
              }
            }}
          />
        ) : !generating ? (
          <div style={{ textAlign: "center", padding: "52px 16px" }}>
            <div style={{ marginBottom: 10, color: OS.muted, display: "inline-flex" }}><IconSun size={28} /></div>
            <div style={{ fontSize: 14, fontWeight: 600, color: OS.text, marginBottom: 6 }}>
              No brief yet
            </div>
            <div style={{ fontSize: 13, color: OS.muted, lineHeight: 1.6 }}>
              Check your API key in settings and try again.
            </div>
          </div>
        ) : (
          <div style={{ textAlign: "center", padding: "52px 16px" }}>
            <div style={{ marginBottom: 10, color: OS.muted, display: "inline-flex" }}><IconSun size={28} /></div>
            <div style={{ fontSize: 14, fontWeight: 600, color: OS.text, marginBottom: 6 }}>
              Building your brief...
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
                    <span style={{ color: OS.faint, flexShrink: 0, display: "inline-flex" }}>
                      {isExpanded ? <IconChevronUp size={10} /> : <IconChevronDown size={10} />}
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
  icon: React.ReactNode; label: string; active: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      style={{
        width: 36, height: 36, borderRadius: 6,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: active ? "rgba(255,255,255,0.08)" : "transparent",
        border: "1px solid transparent",
        color: active ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.4)",
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
  developerMode,
  collapsed,
  onToggleCollapse,
  displaySettings,
  onUpdateDisplay,
  onOpenFullSettings,
  scanAgo,
  scanning,
  onRescan,
  demoMode,
  privacyMode,
  onTogglePrivacy,
}: {
  viewMode: ViewMode;
  setViewMode: (v: ViewMode) => void;
  developerMode: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
  displaySettings: DisplaySettings;
  onUpdateDisplay: (patch: Partial<DisplaySettings>) => void;
  onOpenFullSettings: () => void;
  scanAgo: string | null;
  scanning: boolean;
  onRescan: () => void;
  demoMode: boolean;
  privacyMode: boolean;
  onTogglePrivacy: () => void;
}) {
  const [showNavSettings, setShowNavSettings] = useState(false);
  const settingsBtnRef = useRef<HTMLButtonElement>(null) as React.RefObject<HTMLButtonElement>;
  const settingsIconRef = useRef<HTMLButtonElement>(null) as React.RefObject<HTMLButtonElement>;

  // Compute popover position from anchor button rect (fixed positioning to avoid overflow clipping)
  const getPopoverStyle = (anchor: React.RefObject<HTMLElement>, mode: "expanded" | "collapsed"): React.CSSProperties => {
    const rect = anchor.current?.getBoundingClientRect();
    if (!rect) return {};
    if (mode === "expanded") {
      // Above the button, aligned left
      return {
        position: "fixed",
        top: "auto",
        bottom: window.innerHeight - rect.top + 6,
        left: rect.left,
        right: "auto",
        marginTop: 0,
      };
    }
    // Collapsed: to the right of the icon
    return {
      position: "fixed",
      top: "auto",
      bottom: window.innerHeight - rect.bottom,
      left: rect.right + 6,
      right: "auto",
      marginTop: 0,
    };
  };

  const labelColor = "rgba(255,255,255,0.35)";
  const itemColor = "rgba(255,255,255,0.7)";
  const activeItemColor = "rgba(255,255,255,0.95)";
  const activeBg = "rgba(255,255,255,0.08)";

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

  function NavItem({ label, active, onClick }: {
    label: string; active: boolean; onClick: () => void;
  }) {
    return (
      <div
        onClick={onClick}
        style={{
          display: "flex", alignItems: "center",
          padding: "7px 14px", cursor: "pointer",
          background: active ? activeBg : "transparent",
          margin: "1px 8px", borderRadius: 6,
          transition: "background 0.1s ease",
        }}
      >
        <span style={{
          flex: 1, fontSize: 13,
          fontWeight: active ? 600 : 400,
          color: active ? activeItemColor : itemColor,
        }}>
          {label}
        </span>
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
            <IconChevronRight size={14} />
          </button>
        </div>

        {/* View icons */}
        <div style={{ flex: 1, paddingTop: 10, display: "flex", flexDirection: "column", gap: 2 }}>
          <NavIcon icon={<IconBoard size={14} />} label="Board" active={viewMode === "board"} onClick={() => setViewMode("board")} />
          <NavIcon icon={<IconList size={14} />} label="List" active={viewMode === "list"} onClick={() => setViewMode("list")} />
          <NavIcon icon={<IconSun size={14} />} label="Brief" active={viewMode === "brief"} onClick={() => setViewMode("brief")} />
          {developerMode && (
            <NavIcon icon={"</>"} label="Dev Log" active={viewMode === "devlog"} onClick={() => setViewMode("devlog")} />
          )}
        </div>

        {/* Scan button */}
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", padding: "8px 0", width: "100%", textAlign: "center" }}>
            <button
              onClick={onRescan}
              disabled={scanning}
              title={scanning ? "Scanning..." : scanAgo ? `Scanned ${demoMode ? "just now" : scanAgo}` : "Scan now"}
              style={{
                width: 36, height: 36, borderRadius: 8,
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                background: "transparent",
                border: "1px solid transparent",
                color: scanning ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.4)",
                fontSize: 16, cursor: scanning ? "default" : "pointer",
                transition: "all 0.1s ease",
              }}
            >
              {scanning ? <IconLoader size={12} /> : <IconRefresh size={12} />}
            </button>
        </div>

        {/* Settings icon */}
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", padding: "10px 0", width: "100%", textAlign: "center" }}>
          <button
            ref={settingsIconRef}
            onClick={() => setShowNavSettings(!showNavSettings)}
            title="Settings"
            style={{
              width: 36, height: 36, borderRadius: 8,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              background: showNavSettings ? "rgba(255,255,255,0.08)" : "transparent",
              border: "1px solid transparent",
              color: showNavSettings ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.4)",
              fontSize: 16, cursor: "pointer",
              transition: "all 0.1s ease",
            }}
          >
            <IconSettings size={14} />
          </button>
          {showNavSettings && (
            <SettingsPopover
              display={displaySettings}
              onUpdateDisplay={onUpdateDisplay}
              onClose={() => setShowNavSettings(false)}
              onOpenFullSettings={() => { setShowNavSettings(false); onOpenFullSettings(); }}
              anchorRef={settingsIconRef}
              style={getPopoverStyle(settingsIconRef, "collapsed")}
              privacyMode={privacyMode}
              onTogglePrivacy={onTogglePrivacy}
            />
          )}
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
        <div style={{ fontSize: 15, fontWeight: 700, color: "rgba(255,255,255,0.9)", letterSpacing: "-0.02em" }}>
          Clyde <span style={{ fontWeight: 400, fontSize: 11, color: "rgba(255,255,255,0.35)" }}>AI Assistant</span>
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
          <IconChevronLeft size={14} />
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
      </div>

      {/* Scan status */}
      <div style={{
          borderTop: "1px solid rgba(255,255,255,0.1)",
          padding: "10px 14px",
          display: "flex", alignItems: "center", gap: 8,
        }}>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", flex: 1 }}>
            {demoMode ? "Scanned just now" : scanAgo ? `Scanned ${scanAgo}` : "Not scanned yet"}
          </span>
          <button
            onClick={onRescan}
            disabled={scanning}
            style={{
              padding: "3px 8px", fontSize: 11, fontWeight: 500,
              fontFamily: OS.font, borderRadius: 5,
              background: "transparent",
              border: "1px solid rgba(255,255,255,0.15)",
              color: scanning ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.5)",
              cursor: scanning ? "default" : "pointer",
            }}
          >
            {scanning ? <IconLoader size={12} /> : <IconRefresh size={12} />}
          </button>
      </div>

      {/* Settings footer */}
      <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", padding: "10px 14px" }}>
        <button
          ref={settingsBtnRef}
          onClick={() => setShowNavSettings(!showNavSettings)}
          style={{
            display: "flex", alignItems: "center", gap: 8,
            background: showNavSettings ? "rgba(255,255,255,0.08)" : "none",
            border: "none",
            color: showNavSettings ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.4)",
            fontSize: 12,
            cursor: "pointer", fontFamily: OS.font, padding: "4px 6px",
            borderRadius: 6,
          }}
        >
          <span style={{ display: "inline-flex" }}><IconSettings size={14} /></span>
          <span>Settings</span>
        </button>
        {showNavSettings && (
          <SettingsPopover
            display={displaySettings}
            onUpdateDisplay={onUpdateDisplay}
            onClose={() => setShowNavSettings(false)}
            onOpenFullSettings={() => { setShowNavSettings(false); onOpenFullSettings(); }}
            anchorRef={settingsBtnRef}
            style={getPopoverStyle(settingsBtnRef, "expanded")}
            privacyMode={privacyMode}
            onTogglePrivacy={onTogglePrivacy}
          />
        )}
      </div>
    </div>
  );
}

// ─── Main App ───

export default function App() {
  const { commitments: realCommitments, dismissalPatterns: realDismissalPatterns, counts: realCounts } = useCommitments();
  const realActions = useActions();
  const [boardFilter, setBoardFilter] = useState<FilterKey>("all");
  const [boardSearch, setBoardSearch] = useState("");
  const [listFilter, setListFilter] = useState<FilterKey>("all");
  const [listSearch, setListSearch] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [toast, setToast] = useState<{ message: string; variant?: "success" | "error" | "warning" | "info" } | null>(null);
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null);
  const [isFirstRun, setIsFirstRun] = useState<boolean | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showSmartTags, setShowSmartTags] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [isWide, setIsWide] = useState(false);
  const isNarrow = !isWide;
  const [viewMode, setViewMode] = useState<ViewMode>("board");
  const [developerMode, setDeveloperMode] = useState(false);
  const [demoMode, setDemoMode] = useState(false);
  const [privacyMode, setPrivacyMode] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [proactiveMsg, setProactiveMsg] = useState<string | null>(null);
  const todoOverflowFiredRef = useRef(false);
  const scanAgo = useScanAgo();
  const realKanban = useKanban(boardFilter);
  const { settings: displaySettings, update: updateDisplay } = useDisplaySettings();
  const nav = useNavCollapsed();

  const tags = useLiveQuery(() => db.tags.orderBy("name").toArray(), []) ?? [];
  const [listSelectedTags, setListSelectedTags] = useState<number[]>([]);
  const [boardSelectedTags, setBoardSelectedTags] = useState<number[]>([]);
  const toggleListTag = useCallback((id: number) => {
    setListSelectedTags((prev) => prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]);
  }, []);
  const toggleBoardTag = useCallback((id: number) => {
    setBoardSelectedTags((prev) => prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]);
  }, []);

  const realPendingSuggestions = useLiveQuery(
    () => db.completion_suggestions.where("status").equals("pending").toArray(),
    []
  ) ?? [];

  useEffect(() => {
    chrome.storage.local.get(["anthropicApiKey", "userName", "developerMode", "demoMode"]).then((result) => {
      setHasApiKey(!!result.anthropicApiKey);
      setDeveloperMode(result.developerMode === true);
      setDemoMode(result.demoMode === true);
      // In demo mode, always show the setup wizard on refresh
      setIsFirstRun(result.demoMode === true || (!result.anthropicApiKey && !result.userName));
    });
  }, []);

  // Re-read settings when they change (e.g. from embedded SettingsPanel)
  useEffect(() => {
    const listener = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
      if (area !== "local") return;
      if (changes.developerMode) {
        setDeveloperMode(changes.developerMode.newValue === true);
      }
      if (changes.demoMode) {
        setDemoMode(changes.demoMode.newValue === true);
      }
      if (changes.anthropicApiKey) {
        setHasApiKey(!!changes.anthropicApiKey.newValue);
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  // ─── Demo mode: shadow real data with fixtures ───
  const commitments = demoMode ? DEMO_ACTIVE : realCommitments;
  const dismissalPatterns = demoMode ? DEMO_DISMISSALS : realDismissalPatterns;
  const counts = demoMode ? DEMO_COUNTS : realCounts;
  const kanban = demoMode ? DEMO_KANBAN : realKanban;
  const pendingSuggestions = demoMode ? DEMO_SUGGESTIONS : realPendingSuggestions;
  const effectiveTags = demoMode ? DEMO_TAGS : tags;
  const tagMap = React.useMemo(() => {
    const m = new Map<number, Tag>();
    for (const t of effectiveTags) if (t.id != null) m.set(t.id, t);
    return m;
  }, [effectiveTags]);
  const demoActions: Actions = {
    handleDismiss: async () => "Dismissed",
    handleClose: async () => "Closed",
    handleDone: async () => "Marked done",
    handleSnooze: async () => "Snoozed for 1 hour",
    handleCalendar: async () => "Added to calendar",
    handleSlack: async () => "Opening Slack",
    handleReminder: async () => "Reminder set",
    handleStartWorking: async () => "Moved to In Progress",
    handleReopen: async () => "Moved back to Todo",
  };
  const actions = demoMode ? demoActions : realActions;

  useEffect(() => {
    const check = () => setIsWide(window.innerWidth > 700);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

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

  const onClose = useCallback(
    async (id: number) => {
      const msg = await actions.handleClose(id);
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

  const onMetaUpdate = useCallback(
    async (id: number, changes: Partial<Pick<Commitment, "tag_id" | "urgency" | "deadline" | "text" | "direction" | "sensitive">>) => {
      if (demoMode) return;
      await db.commitments.update(id, changes);
      showToast("Updated");
    },
    [demoMode, showToast],
  );

  const onAcceptCompletion = useCallback(async (suggestionId: number, commitmentId: number) => {
    if (demoMode) { showToast("\u2713 Marked done"); return; }
    const now = new Date().toISOString();
    await db.commitments.update(commitmentId, { status: "done" });
    await db.action_log.add({ commitmentId, action: "done", createdAt: now });
    await db.completion_suggestions.update(suggestionId, { status: "accepted" });
    showToast("\u2713 Marked done");
  }, [showToast, demoMode]);

  const handleTodoOverflow = useCallback(async (count: number) => {
    if (todoOverflowFiredRef.current || demoMode) return;
    // Check if we've already suggested this session or recently
    const { columnSuggestionDismissedAt } = await chrome.storage.local.get("columnSuggestionDismissedAt");
    if (columnSuggestionDismissedAt) {
      const daysSince = (Date.now() - columnSuggestionDismissedAt) / 86_400_000;
      if (daysSince < 7) return; // Don't re-suggest for a week
    }
    todoOverflowFiredRef.current = true;
    chrome.storage.local.set({ columnSuggestionDismissedAt: Date.now() });
    setProactiveMsg(
      `My Todo column has ${count} items and it's getting hard to manage. Can you suggest a few new columns to help me organize my board? Look at my tasks and suggest 2-3 columns that would make sense, then offer to create them for me.`
    );
  }, [demoMode]);

  const onDismissCompletion = useCallback(async (suggestionId: number, commitmentId: number) => {
    if (demoMode) return;
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

  const onRescan = useCallback(async () => {
    if (demoMode || scanning) return;
    setScanning(true);
    try {
      await chrome.runtime.sendMessage({ type: "MANUAL_FLUSH" });
      showToast("Scan complete");
    } catch {
      showToast("Scan failed — background worker not ready", "error");
    } finally {
      setScanning(false);
    }
  }, [demoMode, scanning, showToast]);

  // ─── List view filtering and sorting ───

  const filtered = commitments
    .filter((c) => {
      if (listFilter === "all") return true;
      if (listFilter === "overdue") return c.deadline != null && new Date(c.deadline).getTime() < Date.now();
      if (listFilter === "has_deadline") return c.deadline != null;
      if (listFilter === "high") return c.urgency === "high";
      if (listFilter === "meetings") return c.source_type === "meeting";
      if (listFilter === "slack") return c.source_type === "slack";
      if (listFilter === "gdoc") return c.source_type === "gdoc";
      return true;
    })
    .filter((c) => matchesSearch(c, listSearch))
    .filter((c) => listSelectedTags.length === 0 || (c.tag_id != null && listSelectedTags.includes(c.tag_id)))
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

  // ─── Board view: apply search to kanban columns ───

  const matchesBoardTag = (c: Commitment) => boardSelectedTags.length === 0 || (c.tag_id != null && boardSelectedTags.includes(c.tag_id));
  const boardTodo = kanban.todo.filter((c) => matchesSearch(c, boardSearch) && matchesBoardTag(c));
  const boardInProgress = kanban.inProgress.filter((c) => matchesSearch(c, boardSearch) && matchesBoardTag(c));
  const boardDone = kanban.done.filter((c) => matchesSearch(c, boardSearch) && matchesBoardTag(c));

  const renderCard = (item: Commitment) => (
    <CommitmentCard
      key={item.id}
      item={item}
      allTags={effectiveTags}
      onMetaUpdate={onMetaUpdate}
      tag={item.tag_id != null ? tagMap.get(item.tag_id) : undefined}
      isExpanded={expandedId === item.id}
      isSelected={selectedId === item.id}
      isNarrow={!isWide}
      verboseMode={displaySettings.showConfidence}
      displaySettings={displaySettings}
      privacyMode={privacyMode}
      onToggle={() =>
        setExpandedId(expandedId === item.id ? null : (item.id ?? null))
      }
      onSelect={(id) => setSelectedId(selectedId === id ? null : id)}
      onDismiss={onDismiss}
      onClose={onClose}
      onDone={onDone}
      onSnooze={onSnooze}
      onCalendar={onCalendar}
      onSlack={onSlack}
      onReminder={onReminder}
    />
  );

  // Resolve selected item for the detail panel (use unfiltered kanban for board so selection persists through search)
  const allItems = viewMode === "board"
    ? [...kanban.todo, ...kanban.inProgress, ...kanban.done]
    : commitments;
  const selectedItem = selectedId != null ? allItems.find((c) => c.id === selectedId) ?? null : null;
  const showPanel = selectedItem != null && !isNarrow;

  const dismissWizard = () => {
    setIsFirstRun(false);
    if (!demoMode) setHasApiKey(true);
  };

  return (
    <>
    {isFirstRun && (
      <SetupWizard
        onComplete={dismissWizard}
        onDismiss={dismissWizard}
        demoMode={demoMode}
      />
    )}
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
          developerMode={developerMode}
          collapsed={nav.collapsed}
          onToggleCollapse={nav.toggle}
          displaySettings={displaySettings}
          onUpdateDisplay={updateDisplay}
          onOpenFullSettings={() => setViewMode("settings")}
          scanAgo={scanAgo}
          scanning={scanning}
          onRescan={onRescan}
          demoMode={demoMode}
          privacyMode={privacyMode}
          onTogglePrivacy={() => setPrivacyMode((p) => !p)}
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
        <WarningBanner onOpenSettings={() => setViewMode("settings")} demoMode={demoMode} />

        {/* Demo mode indicator banner */}
        {demoMode && (
          <div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "7px 14px",
            background: OS.yellowBg,
            border: `1px solid ${OS.yellowBorder}`,
            borderRadius: 6,
            margin: "8px 16px 0",
            fontSize: 12,
            color: "#8a6e1a",
            fontFamily: OS.font,
            fontWeight: 600,
            gap: 8,
          }}>
            <span>DEMO MODE — Showing sample data · your real data is safe</span>
            <button
              onClick={() => chrome.storage.local.set({ demoMode: false })}
              style={{
                padding: "3px 10px", fontSize: 11, fontWeight: 600, fontFamily: OS.font,
                background: "#8a6e1a", color: "#fff", border: "none",
                borderRadius: 4, cursor: "pointer", flexShrink: 0,
              }}
            >
              Exit Demo
            </button>
          </div>
        )}

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
                <h1 style={{ fontSize: 18, fontWeight: 700, color: OS.text, letterSpacing: "-0.02em", flexShrink: 0 }}>
                  Clyde <span style={{ fontWeight: 400, fontSize: 11, color: OS.faint }}>AI Assistant</span>
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
                  <option value="settings">Settings</option>
                </select>
                {viewMode !== "settings" && (
                  <div style={{ marginLeft: "auto", display: "flex", gap: 6, flexShrink: 0 }}>
                    <button
                      onClick={onRescan}
                      disabled={scanning}
                      title="Re-scan now"
                      style={{
                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                        width: 30, height: 30, borderRadius: 6,
                        background: OS.white, border: `1px solid ${OS.border}`,
                        color: scanning ? OS.muted : OS.blue, fontSize: 14, cursor: scanning ? "default" : "pointer",
                      }}
                    >
                      {scanning ? <IconLoader size={12} /> : <IconRefresh size={12} />}
                    </button>
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
                      <IconSettings size={14} />
                    </button>
                    {showSettings && (
                      <SettingsPopover
                        display={displaySettings}
                        onUpdateDisplay={updateDisplay}
                        onClose={() => setShowSettings(false)}
                        onOpenFullSettings={() => setViewMode("settings")}
                        privacyMode={privacyMode}
                        onTogglePrivacy={() => setPrivacyMode((p) => !p)}
                      />
                    )}
                  </div>
                )}
              </div>
              <div style={{ borderBottom: `1px solid ${OS.border}` }} />
            </div>
          </div>
        )}

        {/* Scrollable content area */}
        <div style={{ flex: isWide ? 1 : undefined, overflowY: isWide ? "auto" : undefined }}>
          <div style={{
            maxWidth: (viewMode === "board" || viewMode === "devlog") ? "none" : 640,
            margin: (viewMode === "board" || viewMode === "devlog") ? undefined : "0 auto",
            padding: (viewMode === "board" || viewMode === "devlog") ? "12px 16px" : 0,
          }}>
            {hasApiKey === false && (
              <div style={{ padding: "20px 16px" }}>
                <ApiKeySetup onSaved={() => setHasApiKey(true)} />
              </div>
            )}

            {/* Board view */}
            {hasApiKey !== false && viewMode === "board" && (
              <>
                <ViewToolbar
                  filter={boardFilter}
                  onFilterChange={setBoardFilter}
                  search={boardSearch}
                  onSearchChange={setBoardSearch}
                  tags={effectiveTags}
                  selectedTags={boardSelectedTags}
                  onTagToggle={toggleBoardTag}
                  onSmartTags={() => setShowSmartTags(true)}
                />
                <KanbanBoard
                  todo={boardTodo}
                  inProgress={boardInProgress}
                  done={boardDone}
                  selectedId={selectedId}
                  onSelect={(id) => setSelectedId(id)}
                  actions={actions}
                  showToast={showToast}
                  isNarrow={isNarrow}
                  verboseMode={displaySettings.showConfidence}
                  demoMode={demoMode}
                  pendingSuggestions={pendingSuggestions}
                  onAcceptCompletion={onAcceptCompletion}
                  onDismissCompletion={onDismissCompletion}
                  displaySettings={displaySettings}
                  privacyMode={privacyMode}
                  onTodoOverflow={handleTodoOverflow}
                  tagMap={tagMap}
                />
              </>
            )}

            {/* List view */}
            {hasApiKey !== false && viewMode === "list" && (
              <div style={{ background: OS.white, paddingTop: 12 }}>
                <div style={{ padding: "0 16px" }}>
                  <ViewToolbar
                    filter={listFilter}
                    onFilterChange={setListFilter}
                    search={listSearch}
                    onSearchChange={setListSearch}
                    tags={effectiveTags}
                    selectedTags={listSelectedTags}
                    onTagToggle={toggleListTag}
                    onSmartTags={() => setShowSmartTags(true)}
                  />
                </div>
                {filtered.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "56px 16px" }}>
                    <div style={{ marginBottom: 8, color: OS.green, display: "inline-flex" }}><IconCheck size={22} /></div>
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
                        <SectionHeader label="Completed?" color={OS.green} />
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
              <BriefView commitments={commitments} onCalendar={onCalendar} onDone={onDone} demoMode={demoMode} demoBriefs={demoMode ? DEMO_BRIEFS : undefined} />
            )}

            {/* Dev Log view */}
            {viewMode === "devlog" && <DevLogView demoMode={demoMode} demoEntries={demoMode ? DEMO_DECISION_LOG : undefined} />}

            {/* Settings view */}
            {viewMode === "settings" && (
              <SettingsPanel onBack={() => setViewMode("board")} />
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
            onCloseCommitment={() => selectedItem.id != null && onClose(selectedItem.id)}
            onCalendar={() => onCalendar(selectedItem)}
            onDone={() => selectedItem.id != null && onDone(selectedItem.id)}
            onDismiss={() => selectedItem.id != null && onDismiss(selectedItem.id)}
            onReminder={() => selectedItem.id != null && onReminder(selectedItem.id)}
            privacyMode={privacyMode}
            allTags={effectiveTags}
            onMetaUpdate={onMetaUpdate}
          />
        </div>
      )}

      {showSmartTags && <SmartTagsModal onClose={() => setShowSmartTags(false)} />}

      {toast && <Toast message={toast.message} variant={toast.variant} onClose={() => setToast(null)} />}
      <ClydeChat showToast={showToast} sidePanelOpen={showPanel} proactiveMessage={proactiveMsg} onProactiveHandled={() => setProactiveMsg(null)} />
    </div>
    </>
  );
}
