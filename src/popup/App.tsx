import React, { useState, useCallback, useEffect, useRef } from "react";
import { DarkModeContext, useDarkMode as useDarkModeContext, dk } from "./DarkModeContext";
import { useLiveQuery } from "dexie-react-hooks";
import { OS } from "@shared/tokens";
import type { Commitment, Tag } from "@shared/types";
import type { PipelineStatus } from "@shared/status";
import { db } from "@shared/db";
import { useCommitments } from "./hooks/useCommitments";
import { useActions, type Actions } from "./hooks/useActions";
import { useKanban } from "./hooks/useKanban";
import { useSeenCommitments } from "./hooks/useSeenCommitments";
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
import { KanbanBoard } from "./components/KanbanBoard";
import { matchesSearch } from "./components/ViewToolbar";
import { FilterBubbles } from "./components/FilterBubbles";
import { Toast } from "./components/Toast";
import { TranscriptPanel } from "./components/TranscriptPanel";
import { SmartTagsModal } from "./components/SmartTagsModal";
import { SetupWizard } from "./components/SetupWizard";
import { SettingsPanel } from "../options/Options";
import { ClydeChat } from "./components/ClydeChat";
import { DraftComposer } from "./components/DraftComposer";
import { PeoplePanel } from "./components/PeoplePanel";
import { EngStatsView } from "./components/EngStatsView";
import { AINewsView } from "./components/AINewsView";
import { PRInboxView } from "./components/PRInboxView";
import { FocusView } from "./components/focus/FocusView";
import {
  IconSettings, IconWarning, IconX, IconRefresh, IconLoader, IconCheck,
  IconChevronUp, IconChevronDown, IconArrowRight, IconClock, IconPeople,
  InlineIcon,
} from "./components/Icons";

type ViewMode = "focus" | "board" | "people" | "pr-inbox" | "eng-stats" | "ai-news" | "devlog" | "settings" | "draft";

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

function useDarkMode() {
  const [darkMode, setDarkMode] = useState(false);

  useEffect(() => {
    chrome.storage.local.get("darkMode").then((result) => {
      if (result.darkMode === true) setDarkMode(true);
    });
  }, []);

  const toggle = useCallback(() => {
    setDarkMode((prev) => {
      const next = !prev;
      chrome.storage.local.set({ darkMode: next });
      return next;
    });
  }, []);

  return { darkMode, toggleDarkMode: toggle };
}

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
  darkMode,
  onToggleDark,
}: {
  display: DisplaySettings;
  onUpdateDisplay: (patch: Partial<DisplaySettings>) => void;
  onClose: () => void;
  onOpenFullSettings: () => void;
  anchorRef?: React.RefObject<HTMLElement>;
  style?: React.CSSProperties;
  privacyMode: boolean;
  onTogglePrivacy: () => void;
  darkMode: boolean;
  onToggleDark: () => void;
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
        background: darkMode ? '#1c1c1e' : OS.white,
        border: `1px solid ${dk(darkMode, 'rgba(255,255,255,0.10)', OS.border)}`,
        borderRadius: 10,
        boxShadow: dk(darkMode, '0 8px 24px rgba(0,0,0,0.5)', '0 8px 24px rgba(0,0,0,0.12)'),
        zIndex: 40,
        padding: "14px 16px",
        fontFamily: OS.font,
        ...positionStyle,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 700, color: dk(darkMode, 'rgba(255,255,255,0.90)', OS.text), marginBottom: 12 }}>
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
            borderTop: `1px solid ${dk(darkMode, 'rgba(255,255,255,0.08)', OS.border)}`,
          }}
        >
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: dk(darkMode, 'rgba(255,255,255,0.90)', OS.text) }}>{row.label}</div>
            <div style={{ fontSize: 11, color: dk(darkMode, 'rgba(255,255,255,0.35)', OS.muted), marginTop: 1 }}>{row.desc}</div>
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
          borderTop: `1px solid ${dk(darkMode, 'rgba(255,255,255,0.08)', OS.border)}`,
          marginTop: 4,
        }}
      >
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: dk(darkMode, 'rgba(255,255,255,0.90)', OS.text) }}>Hide sensitive items</div>
          <div style={{ fontSize: 11, color: dk(darkMode, 'rgba(255,255,255,0.35)', OS.muted), marginTop: 1 }}>Blur HR, personal & confidential</div>
        </div>
        <ToggleSwitch on={privacyMode} onToggle={onTogglePrivacy} />
      </div>

      {/* Dark mode toggle */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 0 8px",
          borderTop: `1px solid ${dk(darkMode, 'rgba(255,255,255,0.08)', OS.border)}`,
        }}
      >
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: dk(darkMode, 'rgba(255,255,255,0.90)', OS.text) }}>Dark mode</div>
          <div style={{ fontSize: 11, color: dk(darkMode, 'rgba(255,255,255,0.35)', OS.muted), marginTop: 1 }}>Switch to dark appearance</div>
        </div>
        <ToggleSwitch on={darkMode} onToggle={onToggleDark} />
      </div>

      <div style={{
        marginTop: 10,
        paddingTop: 10,
        borderTop: `1px solid ${dk(darkMode, 'rgba(255,255,255,0.08)', OS.border)}`,
        fontSize: 11,
        color: dk(darkMode, 'rgba(255,255,255,0.35)', OS.muted),
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
          border: `1px solid ${dk(darkMode, 'rgba(255,255,255,0.10)', OS.border)}`,
          background: dk(darkMode, 'rgba(255,255,255,0.04)', OS.bg),
          color: dk(darkMode, 'rgba(255,255,255,0.55)', OS.secondary),
          fontSize: 12,
          fontWeight: 600,
          cursor: "pointer",
          fontFamily: OS.font,
          transition: "background 0.1s ease",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = dk(darkMode, 'rgba(255,255,255,0.08)', OS.border); }}
        onMouseLeave={(e) => { e.currentTarget.style.background = dk(darkMode, 'rgba(255,255,255,0.04)', OS.bg); }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><IconSettings size={12} /> All settings...</span>
      </button>
    </div>
  );
}

// ─── Warning banner (replaces StatusPanel) ───

function WarningBanner({ onOpenSettings, demoMode }: { onOpenSettings: () => void; demoMode?: boolean }) {
  const darkMode = useDarkModeContext();
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
      background: dk(darkMode, 'rgba(180,120,0,0.18)', OS.yellowBg),
      border: `1px solid ${dk(darkMode, 'rgba(180,120,0,0.35)', OS.yellowBorder)}`,
      borderRadius: 6,
      margin: "8px 16px 0",
      fontSize: 12,
      color: dk(darkMode, 'rgba(255,190,80,0.85)', '#8a6e1a'),
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
          background: "none", border: "none", color: dk(darkMode, 'rgba(255,190,80,0.85)', '#8a6e1a'),
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

const STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

interface ScanStatus {
  scanAgo: string | null;
  staleWarning: string | null;
}

function useScanStatus(): ScanStatus {
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

  let scanAgo: string | null = null;
  if (status?.lastExtraction) {
    const diff = Date.now() - new Date(status.lastExtraction).getTime();
    if (diff < 60000) scanAgo = "just now";
    else if (diff < 3600000) scanAgo = `${Math.floor(diff / 60000)}m ago`;
    else scanAgo = `${Math.floor(diff / 3600000)}h ago`;
  }

  // Stale detection: warn if a previously-connected source has gone silent
  let staleWarning: string | null = null;
  if (status) {
    const now = Date.now();
    // Check Slack: was connected but last ping is stale
    if (status.slackConnected && status.lastContentPing) {
      const pingAge = now - new Date(status.lastContentPing).getTime();
      if (pingAge > STALE_THRESHOLD_MS) {
        staleWarning = "Slack data may be stale — no messages received recently. Make sure Slack is open in a browser tab.";
      }
    }
    // Check extraction: had successful extraction before but it's very old
    if (!staleWarning && status.lastExtraction) {
      const extractAge = now - new Date(status.lastExtraction).getTime();
      if (extractAge > STALE_THRESHOLD_MS && status.totalMessagesReceived > 0) {
        staleWarning = "No recent scans — Clyde may be missing new commitments.";
      }
    }
    // Check for extraction errors
    if (!staleWarning && status.lastError) {
      staleWarning = `Last scan failed: ${status.lastError.slice(0, 80)}`;
    }
  }

  return { scanAgo, staleWarning };
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

import type { DecisionLogEntry } from "@shared/types";

function DevLogView({ demoMode, demoEntries }: { demoMode?: boolean; demoEntries?: DecisionLogEntry[] } = {}) {
  const darkMode = useDarkModeContext();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<LogEntryType | "all">("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const filterTabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [filterSlider, setFilterSlider] = useState({ left: 0, width: 0 });

  useEffect(() => {
    const el = filterTabRefs.current[typeFilter];
    if (el) setFilterSlider({ left: el.offsetLeft, width: el.offsetWidth });
  }, [typeFilter]);

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
        <div style={{ fontSize: 13, color: dk(darkMode, 'rgba(255,255,255,0.30)', OS.muted) }}>
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
          background: dk(darkMode, 'rgba(255,255,255,0.06)', OS.white), borderRadius: 999, padding: "0 10px",
          border: `0.5px solid ${dk(darkMode, 'rgba(255,255,255,0.10)', 'rgba(0,0,0,0.08)')}`,
        }}>
          <input
            type="text"
            placeholder="Filter entries..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              flex: 1, padding: "8px 0", fontSize: 13,
              fontFamily: OS.font, border: "none", background: "transparent",
              color: dk(darkMode, 'rgba(255,255,255,0.85)', OS.text), outline: "none",
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
              background: dk(darkMode, 'rgba(255,255,255,0.06)', OS.white),
              border: `0.5px solid ${dk(darkMode, 'rgba(255,255,255,0.10)', 'rgba(0,0,0,0.12)')}`,
              borderRadius: 999,
              color: dk(darkMode, 'rgba(255,255,255,0.45)', OS.muted), fontSize: 12, cursor: "pointer",
              fontFamily: OS.font, padding: "8px 12px", whiteSpace: "nowrap",
            }}
          >
            Clear log
          </button>
        )}
      </div>

      {/* Filter pills — sliding pill nav */}
      <div style={{ display: "flex", alignItems: "center", marginBottom: 14, gap: 8 }}>
        <div style={{
          display: "flex",
          alignItems: "center",
          background: dk(darkMode, 'rgba(255,255,255,0.06)', 'rgba(0,0,0,0.03)'),
          borderRadius: 999,
          padding: 3,
          position: "relative",
          width: "fit-content",
          flexWrap: "nowrap",
          gap: 0,
        }}>
          {/* Slider */}
          <div style={{
            position: "absolute",
            top: 3,
            left: filterSlider.left + 3,
            width: filterSlider.width,
            height: "calc(100% - 6px)",
            background: dk(darkMode, 'rgba(255,255,255,0.10)', OS.white),
            borderRadius: 999,
            border: `0.5px solid ${dk(darkMode, 'rgba(255,255,255,0.12)', 'rgba(0,0,0,0.08)')}`,
            transition: "left 450ms cubic-bezier(0.34, 1.56, 0.64, 1), width 300ms cubic-bezier(0.34, 1.2, 0.64, 1)",
            zIndex: 0,
            pointerEvents: "none",
          }} />

          {/* Tab buttons */}
          {(["all", "accepted", "rejected", "user_dismissed", "user_done"] as const).map((key) => {
            const count = counts[key] ?? 0;
            if (key !== "all" && count === 0) return null;
            const active = typeFilter === key;
            const meta = key === "all" ? null : LOG_TYPE_META[key];
            return (
              <button
                key={key}
                ref={(el) => { filterTabRefs.current[key] = el; }}
                onClick={() => setTypeFilter(key)}
                style={{
                  position: "relative", zIndex: 1,
                  padding: "5px 12px",
                  borderRadius: 999,
                  border: "none",
                  background: "transparent",
                  fontSize: 12,
                  fontWeight: active ? 500 : 400,
                  fontFamily: OS.font,
                  color: active ? dk(darkMode, 'rgba(255,255,255,0.90)', OS.text) : dk(darkMode, 'rgba(255,255,255,0.45)', OS.secondary),
                  cursor: "pointer",
                  transition: "color 0.2s ease",
                  whiteSpace: "nowrap",
                }}
              >
                {key === "all" ? "All" : meta!.label}
                <span style={{
                  marginLeft: 5, fontSize: 10,
                  color: active ? dk(darkMode, 'rgba(255,255,255,0.35)', OS.muted) : dk(darkMode, 'rgba(255,255,255,0.20)', OS.faint),
                  fontFamily: OS.mono,
                }}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
        <span style={{ marginLeft: "auto", fontSize: 11, color: OS.faint, fontFamily: OS.mono }}>
          {filtered.length}/{unified.length}
        </span>
      </div>

      {/* Log entries — grouped */}
      <div style={{
        background: dk(darkMode, '#1c1c1e', OS.white), borderRadius: 10, overflow: "hidden",
        border: `1px solid ${dk(darkMode, 'rgba(255,255,255,0.08)', OS.border)}`,
        maxHeight: "calc(100vh - 220px)", overflowY: "auto",
      }}>
        {filtered.length === 0 ? (
          <div style={{ padding: "32px 16px", color: dk(darkMode, 'rgba(255,255,255,0.30)', OS.muted), textAlign: "center", fontSize: 13 }}>
            No matching entries
          </div>
        ) : groups.map((group) => (
          <div key={group.label}>
            {/* Time group header */}
            <div style={{
              padding: "10px 16px 6px",
              fontSize: 11,
              fontWeight: 500,
              color: dk(darkMode, 'rgba(255,255,255,0.30)', OS.muted),
              letterSpacing: "0.02em",
              background: dk(darkMode, 'rgba(255,255,255,0.04)', OS.bg),
              borderBottom: `1px solid ${dk(darkMode, 'rgba(255,255,255,0.06)', OS.border)}`,
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
                <div key={entry.id} style={{ borderBottom: `1px solid ${dk(darkMode, 'rgba(255,255,255,0.06)', OS.border)}` }}>
                  <div
                    onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                    style={{
                      padding: "10px 16px",
                      cursor: "pointer",
                      display: "flex", gap: 12, alignItems: "flex-start",
                      background: isExpanded ? dk(darkMode, 'rgba(255,255,255,0.04)', OS.bg) : dk(darkMode, '#1c1c1e', OS.white),
                      borderLeft: `3px solid ${meta.color}`,
                      transition: "background 0.1s ease",
                    }}
                    onMouseEnter={(e) => { if (!isExpanded) e.currentTarget.style.background = dk(darkMode, 'rgba(255,255,255,0.04)', OS.bg); }}
                    onMouseLeave={(e) => { if (!isExpanded) e.currentTarget.style.background = dk(darkMode, '#1c1c1e', OS.white); }}
                  >
                    {/* Left: timestamp + badge stacked */}
                    <div style={{ flexShrink: 0, width: 62, paddingTop: 1 }}>
                      <div style={{ fontSize: 11, color: dk(darkMode, 'rgba(255,255,255,0.35)', OS.muted), fontFamily: OS.mono, lineHeight: 1.4 }}>
                        {formatTime(entry.timestamp)}
                      </div>
                      <div style={{
                        display: "inline-block",
                        marginTop: 4,
                        padding: "1px 7px",
                        borderRadius: 999,
                        fontSize: 10,
                        fontWeight: 500,
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
                        fontSize: 13, color: dk(darkMode, 'rgba(255,255,255,0.85)', OS.text), lineHeight: 1.5,
                        overflow: "hidden", textOverflow: "ellipsis",
                        whiteSpace: isExpanded ? "pre-wrap" : "nowrap",
                        fontFamily: OS.font,
                      }}>
                        {entry.text}
                      </div>
                      {!isExpanded && entry.source && (
                        <div style={{ fontSize: 11, color: dk(darkMode, 'rgba(255,255,255,0.35)', OS.faint), marginTop: 2, fontFamily: OS.font }}>
                          {entry.source}
                        </div>
                      )}
                    </div>

                    {/* Right: confidence */}
                    {entry.confidence != null && (
                      <span style={{
                        flexShrink: 0,
                        fontSize: 10,
                        fontWeight: 500,
                        fontFamily: OS.mono,
                        padding: "1px 6px",
                        borderRadius: 999,
                        background: entry.confidence >= 0.8 ? OS.green + "18" : entry.confidence >= 0.6 ? "#b08d33" + "18" : OS.faint + "18",
                        color: entry.confidence >= 0.8 ? OS.green : entry.confidence >= 0.6 ? "#b08d33" : OS.faint,
                        lineHeight: 1.6,
                        display: "inline-flex",
                        alignItems: "center",
                        alignSelf: "flex-start",
                        marginTop: 2,
                      }}>
                        {Math.round(entry.confidence * 100)}%
                      </span>
                    )}
                  </div>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div style={{
                      padding: "0 16px 14px 93px",
                      background: dk(darkMode, 'rgba(255,255,255,0.04)', OS.bg),
                      borderLeft: `3px solid ${meta.color}`,
                    }}>
                      <div style={{
                        display: "flex", flexDirection: "column", gap: 6,
                        fontSize: 12, lineHeight: 1.5,
                      }}>
                        {entry.source && (
                          <div style={{ display: "flex", gap: 8 }}>
                            <span style={{ color: dk(darkMode, 'rgba(255,255,255,0.25)', OS.faint), flexShrink: 0, width: 60 }}>Source</span>
                            <span style={{ color: dk(darkMode, 'rgba(255,255,255,0.55)', OS.secondary) }}>{entry.source}</span>
                          </div>
                        )}
                        {entry.reason && (
                          <div style={{ display: "flex", gap: 8 }}>
                            <span style={{ color: dk(darkMode, 'rgba(255,255,255,0.25)', OS.faint), flexShrink: 0, width: 60 }}>
                              {entry.type === "accepted" ? "Extracted" : entry.type.startsWith("user_") ? "Task" : "Reason"}
                            </span>
                            <span style={{ color: dk(darkMode, 'rgba(255,255,255,0.55)', OS.secondary) }}>{entry.reason}</span>
                          </div>
                        )}
                        {entry.category && (
                          <div style={{ display: "flex", gap: 8 }}>
                            <span style={{ color: dk(darkMode, 'rgba(255,255,255,0.25)', OS.faint), flexShrink: 0, width: 60 }}>Category</span>
                            <span style={{ color: dk(darkMode, 'rgba(255,255,255,0.55)', OS.muted) }}>{entry.category.replace(/_/g, " ")}</span>
                          </div>
                        )}
                        {entry.confidence != null && (
                          <div style={{ display: "flex", gap: 8 }}>
                            <span style={{ color: dk(darkMode, 'rgba(255,255,255,0.25)', OS.faint), flexShrink: 0, width: 60 }}>Conf.</span>
                            <span style={{ color: dk(darkMode, 'rgba(255,255,255,0.55)', OS.secondary) }}>{Math.round(entry.confidence * 100)}%</span>
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

// ─── Morning Brief Card ───

import type { MorningBrief } from "@shared/types";

function formatEventTime(iso: string): string {
  if (!iso || iso === "All day") return iso;
  try {
    return new Date(iso).toLocaleTimeString("en-US", {
      hour: "numeric", minute: "2-digit", hour12: true,
    });
  } catch {
    return iso;
  }
}

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
  const darkMode = useDarkModeContext();
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
        padding: "20px 24px 16px",
        borderBottom: `1px solid ${dk(darkMode, 'rgba(255,255,255,0.08)', OS.border)}`,
        background: dk(darkMode, '#1c1c1e', OS.white),
      }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 8 }}>
          <div>
            <div style={{
              fontSize: 10, fontWeight: 700, color: dk(darkMode, 'rgba(255,255,255,0.35)', OS.muted),
              textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4,
            }}>
              Morning Brief
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: dk(darkMode, 'rgba(255,255,255,0.90)', OS.text), lineHeight: 1.2 }}>
              {dateStr}
            </div>
            {summaryParts.length > 0 && (
              <div style={{ fontSize: 12, color: dk(darkMode, 'rgba(255,255,255,0.35)', OS.muted), marginTop: 4 }}>
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
                  background: dk(darkMode, '#1c1c1e', OS.white), color: dk(darkMode, 'rgba(255,255,255,0.55)', OS.secondary),
                  border: `1px solid ${dk(darkMode, 'rgba(255,255,255,0.08)', OS.border)}`, borderRadius: 6, cursor: "pointer",
                }}
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><IconRefresh size={11} /> ✦ Refresh brief</span>
              </button>
            )}
            <button
              onClick={onDismiss}
              style={{
                padding: "5px 12px", fontSize: 11, fontWeight: 600, fontFamily: OS.font,
                background: dk(darkMode, '#1c1c1e', OS.white), color: dk(darkMode, 'rgba(255,255,255,0.35)', OS.muted),
                border: `1px solid ${dk(darkMode, 'rgba(255,255,255,0.08)', OS.border)}`, borderRadius: 6, cursor: "pointer",
              }}
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>

      {/* ── b) Today's priorities ── */}
      {brief.priorities.length > 0 && (
        <div style={{ padding: "14px 24px", borderBottom: `1px solid ${dk(darkMode, 'rgba(255,255,255,0.08)', OS.border)}` }}>
          <div style={{
            fontSize: 10, fontWeight: 700, color: dk(darkMode, 'rgba(255,255,255,0.35)', OS.muted),
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
                  background: isHovered ? dk(darkMode, 'rgba(255,255,255,0.06)', OS.bg) : "transparent",
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
                  <div style={{ fontSize: 13, fontWeight: 500, color: dk(darkMode, 'rgba(255,255,255,0.90)', OS.text) }}>{p.text}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 3, flexWrap: "wrap" }}>
                    {p.suggestedTime && (
                      <span style={{ fontSize: 11, color: dk(darkMode, 'rgba(255,255,255,0.35)', OS.muted) }}>
                        <InlineIcon><IconClock size={11} /></InlineIcon> {p.suggestedTime}
                      </span>
                    )}
                    {statusTag && (
                      <span style={{
                        fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 4,
                        background: dk(darkMode, 'rgba(255,255,255,0.06)', OS.bg),
                        color: statusTag.color,
                        border: `1px solid ${dk(darkMode, 'rgba(255,255,255,0.08)', OS.border)}`,
                      }}>
                        {statusTag.label}
                      </span>
                    )}
                    {!p.suggestedTime && !statusTag && p.reason && (
                      <span style={{ fontSize: 11, color: dk(darkMode, 'rgba(255,255,255,0.35)', OS.muted) }}>{p.reason}</span>
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
                        background: dk(darkMode, '#1c1c1e', OS.white), color: dk(darkMode, 'rgba(255,255,255,0.55)', OS.secondary),
                        border: `1px solid ${dk(darkMode, 'rgba(255,255,255,0.08)', OS.border)}`, borderRadius: 4, cursor: "pointer",
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
                        background: dk(darkMode, '#1c1c1e', OS.white), color: dk(darkMode, 'rgba(255,255,255,0.55)', OS.secondary),
                        border: `1px solid ${dk(darkMode, 'rgba(255,255,255,0.08)', OS.border)}`, borderRadius: 4, cursor: "pointer",
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
      <div style={{ padding: "14px 24px", borderBottom: `1px solid ${dk(darkMode, 'rgba(255,255,255,0.08)', OS.border)}` }}>
        <div style={{
          fontSize: 10, fontWeight: 700, color: dk(darkMode, 'rgba(255,255,255,0.35)', OS.muted),
          textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10,
        }}>
          Your Day
        </div>
        {brief.calendarEvents && brief.calendarEvents.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {brief.calendarEvents.map((ev, i) => {
              const barColor = OS.blue;
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{
                    fontSize: 11, color: dk(darkMode, 'rgba(255,255,255,0.35)', OS.muted), width: 72, flexShrink: 0, textAlign: "right",
                  }}>
                    {formatEventTime(ev.start)}
                  </span>
                  <div style={{
                    flex: 1, height: 28, borderRadius: 4,
                    background: `${barColor}15`, borderLeft: `3px solid ${barColor}`,
                    display: "flex", alignItems: "center", paddingLeft: 8,
                  }}>
                    <span style={{ fontSize: 12, color: dk(darkMode, 'rgba(255,255,255,0.90)', OS.text), fontWeight: 500 }}>{ev.title}</span>
                    {ev.end !== ev.start && ev.end !== "All day" && (
                      <span style={{ fontSize: 10, color: dk(darkMode, 'rgba(255,255,255,0.35)', OS.muted), marginLeft: 6 }}>
                        <InlineIcon><IconArrowRight size={11} /></InlineIcon> {formatEventTime(ev.end)}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : brief.scheduleSuggestion ? (
          <div style={{
            fontSize: 12, color: dk(darkMode, 'rgba(255,255,255,0.55)', OS.secondary), lineHeight: 1.5,
            padding: "8px 12px", background: dk(darkMode, 'rgba(255,255,255,0.06)', OS.bg), borderRadius: 6,
          }}>
            {brief.scheduleSuggestion}
          </div>
        ) : (
          <div style={{ fontSize: 12, color: dk(darkMode, 'rgba(255,255,255,0.35)', OS.muted), fontStyle: "italic" }}>
            No calendar connected — add an ICS feed in Settings to see your timeline.
          </div>
        )}
      </div>

      {/* ── d) Suggested moves ── */}
      {activeMoves.length > 0 && (
        <div style={{ padding: "14px 24px", borderBottom: `1px solid ${dk(darkMode, 'rgba(255,255,255,0.08)', OS.border)}` }}>
          <div style={{
            fontSize: 10, fontWeight: 700, color: dk(darkMode, 'rgba(255,255,255,0.35)', OS.muted),
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
                  padding: "8px 10px", background: dk(darkMode, 'rgba(255,255,255,0.06)', OS.bg), borderRadius: 6,
                }}>
                  <span style={{ fontSize: 13, color: dk(darkMode, 'rgba(255,255,255,0.35)', OS.muted), flexShrink: 0 }}><InlineIcon><IconArrowRight size={11} /></InlineIcon></span>
                  <span style={{
                    flex: 1, fontSize: 12, color: dk(darkMode, 'rgba(255,255,255,0.90)', OS.text),
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {commitment.text}
                  </span>
                  <span style={{
                    fontSize: 10, fontWeight: 500, padding: "2px 7px", borderRadius: 4,
                    background: dk(darkMode, 'rgba(255,255,255,0.06)', OS.bg), color: dk(darkMode, 'rgba(255,255,255,0.55)', OS.secondary),
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
                      background: dk(darkMode, '#1c1c1e', OS.white), color: dk(darkMode, 'rgba(255,255,255,0.55)', OS.secondary),
                      border: `1px solid ${dk(darkMode, 'rgba(255,255,255,0.08)', OS.border)}`, borderRadius: 4, cursor: "pointer",
                      flexShrink: 0,
                    }}
                  >
                    <IconCheck size={11} />
                  </button>
                  <button
                    onClick={() => setDismissedMoveIds(prev => new Set([...prev, move.commitmentId]))}
                    style={{
                      padding: "3px 6px", fontSize: 11, fontWeight: 500, fontFamily: OS.font,
                      background: "none", color: dk(darkMode, 'rgba(255,255,255,0.35)', OS.muted),
                      border: `1px solid ${dk(darkMode, 'rgba(255,255,255,0.08)', OS.border)}`, borderRadius: 4, cursor: "pointer",
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
        padding: "10px 24px", display: "flex", alignItems: "center", justifyContent: "space-between",
        fontSize: 11, color: dk(darkMode, 'rgba(255,255,255,0.35)', OS.muted),
      }}>
        <span>
          Generated {new Date(brief.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
          {brief.calendarEvents ? " \u00B7 Calendar synced via ICS feed" : ""}
        </span>
        <button
          onClick={onSnooze}
          style={{
            fontSize: 11, color: dk(darkMode, 'rgba(255,255,255,0.35)', OS.muted), background: "none", border: "none",
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
    <div style={{ fontFamily: OS.font, paddingTop: 0 }}>
      {/* Auto-generating indicator when no brief exists */}
      {!todayBrief && generating && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: "16px", background: OS.white, borderBottom: `1px solid ${OS.border}`,
          fontSize: 13, color: OS.muted, gap: 8,
        }}>
          ✦ Generating your morning brief...
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
            <div style={{ marginBottom: 10, color: OS.muted, display: "inline-flex" }}><IconLoader size={28} /></div>
            <div style={{ fontSize: 14, fontWeight: 600, color: OS.text, marginBottom: 6 }}>
              No brief yet
            </div>
            <div style={{ fontSize: 13, color: OS.muted, lineHeight: 1.6 }}>
              Check your API key in settings and try again.
            </div>
          </div>
        ) : (
          <div style={{ textAlign: "center", padding: "52px 16px" }}>
            <div style={{ marginBottom: 10, color: OS.muted, display: "inline-flex" }}><IconLoader size={28} /></div>
            <div style={{ fontSize: 14, fontWeight: 600, color: OS.text, marginBottom: 6 }}>
              ✦ Building your brief...
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

// ─── Top Bar ───

function TopBar({
  viewMode,
  setViewMode,
  developerMode,
  engStatsEnabled,
  hasGithubToken,
  onOpenSettings,
  scanning,
  onRescan,
  scanAgo,
  demoMode,
  displaySettings,
  onUpdateDisplay,
  privacyMode,
  onTogglePrivacy,
  darkMode,
  onToggleDark,
}: {
  viewMode: ViewMode;
  setViewMode: (v: ViewMode) => void;
  developerMode: boolean;
  engStatsEnabled: boolean;
  hasGithubToken: boolean;
  onOpenSettings: () => void;
  scanning: boolean;
  onRescan: () => void;
  scanAgo: string | null;
  demoMode: boolean;
  displaySettings: DisplaySettings;
  onUpdateDisplay: (patch: Partial<DisplaySettings>) => void;
  privacyMode: boolean;
  onTogglePrivacy: () => void;
  darkMode: boolean;
  onToggleDark: () => void;
}) {
  const [showTopBarSettings, setShowTopBarSettings] = useState(false);
  const settingsRef = useRef<HTMLButtonElement>(null) as React.RefObject<HTMLButtonElement>;

  const navItems: Array<{ key: ViewMode; label: string; show: boolean }> = [
    { key: "focus", label: "Focus", show: true },
    { key: "board", label: "Board", show: true },
    { key: "people", label: "People", show: true },
    { key: "pr-inbox", label: "PRs", show: hasGithubToken || demoMode },
    { key: "eng-stats", label: "Eng Stats", show: engStatsEnabled },
    { key: "ai-news", label: "AI News", show: true },
    { key: "devlog", label: "Dev Log", show: developerMode },
  ];

  const visibleItems = navItems.filter((i) => i.show);

  // Sliding indicator positioning
  const itemRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [slider, setSlider] = useState({ left: 0, width: 0 });

  useEffect(() => {
    const el = itemRefs.current[viewMode];
    if (el) {
      setSlider({ left: el.offsetLeft, width: el.offsetWidth });
    }
  }, [viewMode, developerMode, engStatsEnabled, hasGithubToken]);

  return (
    <div
      style={{
        height: 52,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        padding: "0 20px",
        borderBottom: `0.5px solid ${darkMode ? "rgba(255,255,255,0.08)" : OS.border}`,
        background: darkMode ? "#1c1c1e" : OS.white,
        position: "relative",
        zIndex: 10,
      }}
    >
      {/* Wordmark — left */}
      <div style={{ flex: 1, fontSize: 14, fontWeight: 500, color: darkMode ? "rgba(255,255,255,0.85)" : OS.text, letterSpacing: "-0.04em", fontFamily: OS.font }}>
        clyde
      </div>

      {/* Pill nav — center */}
      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          background: darkMode ? "rgba(255,255,255,0.06)" : OS.bg,
          borderRadius: 999,
          padding: 3,
        }}
      >
        {/* Sliding pill indicator */}
        <div
          style={{
            position: "absolute",
            top: 3,
            left: slider.left,
            width: slider.width,
            height: "calc(100% - 6px)",
            background: darkMode ? "rgba(255,255,255,0.10)" : OS.white,
            borderRadius: 999,
            border: `0.5px solid ${darkMode ? "rgba(255,255,255,0.12)" : OS.border}`,
            boxShadow: darkMode ? "none" : "0 1px 3px rgba(0,0,0,0.06)",
            transition: `left 300ms cubic-bezier(0.34, 1.2, 0.64, 1), width 250ms cubic-bezier(0.34, 1.2, 0.64, 1)`,
            zIndex: 0,
            pointerEvents: "none",
          }}
        />
        {visibleItems.map(({ key, label }) => (
          <button
            key={key}
            ref={(el) => { itemRefs.current[key] = el; }}
            onClick={() => setViewMode(key)}
            style={{
              position: "relative",
              zIndex: 1,
              padding: "5px 14px",
              borderRadius: 999,
              border: "none",
              background: "transparent",
              fontSize: 13,
              fontWeight: viewMode === key ? 500 : 400,
              color: viewMode === key ? (darkMode ? "rgba(255,255,255,0.95)" : OS.text) : (darkMode ? "rgba(255,255,255,0.45)" : OS.secondary),
              cursor: "pointer",
              fontFamily: OS.font,
              transition: "color 0.2s ease",
              whiteSpace: "nowrap" as const,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Right controls */}
      <div style={{ flex: 1, display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 6 }}>
        <button
          onClick={onRescan}
          disabled={scanning}
          title={scanning ? "Scanning..." : scanAgo ? `Scanned ${demoMode ? "just now" : scanAgo}` : "Scan now"}
          style={{
            width: 32, height: 32, borderRadius: "50%",
            display: "flex", alignItems: "center", justifyContent: "center",
            border: `0.5px solid ${darkMode ? "rgba(255,255,255,0.10)" : OS.border}`,
            background: darkMode ? "rgba(255,255,255,0.04)" : OS.white,
            color: scanning ? (darkMode ? "rgba(255,255,255,0.25)" : OS.muted) : (darkMode ? "rgba(255,255,255,0.45)" : OS.secondary),
            cursor: scanning ? "default" : "pointer",
          }}
        >
          {scanning ? <IconLoader size={12} /> : <IconRefresh size={12} />}
        </button>
        <div style={{ position: "relative" }}>
          <button
            ref={settingsRef}
            onClick={() => setShowTopBarSettings(!showTopBarSettings)}
            title="Settings"
            style={{
              width: 32, height: 32, borderRadius: "50%",
              display: "flex", alignItems: "center", justifyContent: "center",
              border: `0.5px solid ${showTopBarSettings ? OS.blue : (darkMode ? "rgba(255,255,255,0.10)" : OS.border)}`,
              background: showTopBarSettings ? OS.blueBg : (darkMode ? "rgba(255,255,255,0.04)" : OS.white),
              color: showTopBarSettings ? OS.blue : (darkMode ? "rgba(255,255,255,0.45)" : OS.secondary),
              cursor: "pointer",
            }}
          >
            <IconSettings size={14} />
          </button>
          {showTopBarSettings && (
            <SettingsPopover
              display={displaySettings}
              onUpdateDisplay={onUpdateDisplay}
              onClose={() => setShowTopBarSettings(false)}
              onOpenFullSettings={() => { setShowTopBarSettings(false); onOpenSettings(); }}
              anchorRef={settingsRef}
              style={{
                position: "fixed",
                top: 58,
                right: 16,
                left: "auto",
                marginTop: 0,
              }}
              privacyMode={privacyMode}
              onTogglePrivacy={onTogglePrivacy}
              darkMode={darkMode}
              onToggleDark={onToggleDark}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Demo Mode Banner ───

function DemoModeBanner() {
  const darkMode = useDarkModeContext();
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "7px 14px",
      background: dk(darkMode, 'rgba(180,120,0,0.18)', OS.yellowBg),
      border: `1px solid ${dk(darkMode, 'rgba(180,120,0,0.35)', OS.yellowBorder)}`,
      borderRadius: 6,
      margin: "8px 16px 0",
      fontSize: 12,
      color: dk(darkMode, 'rgba(255,190,80,0.85)', OS.yellowText),
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
  );
}

// ─── Main App ───

export default function App() {
  const { commitments: realCommitments, dismissalPatterns: realDismissalPatterns, counts: realCounts } = useCommitments();
  const realActions = useActions();
  const [boardSearch, setBoardSearch] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [toast, setToast] = useState<{ message: string; variant?: "success" | "error" | "warning" | "info" } | null>(null);
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null);
  const [isFirstRun, setIsFirstRun] = useState<boolean | null>(null);
  const [showSmartTags, setShowSmartTags] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [isWide, setIsWide] = useState(false);
  const isNarrow = !isWide;
  const [viewMode, setViewMode] = useState<ViewMode>("focus");
  const [activeDraftId, setActiveDraftId] = useState<number | null>(null);
  // Clear draft state when user navigates away from draft view
  useEffect(() => {
    if (viewMode !== "draft") setActiveDraftId(null);
  }, [viewMode]);
  const [developerMode, setDeveloperMode] = useState(false);
  const [engStatsEnabled, setEngStatsEnabled] = useState(false);
  const [hasGithubToken, setHasGithubToken] = useState(false);
  const [demoMode, setDemoMode] = useState(false);
  const [privacyMode, setPrivacyMode] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [proactiveMsg, setProactiveMsg] = useState<string | null>(null);
  const todoOverflowFiredRef = useRef(false);
  const { scanAgo } = useScanStatus();
  const realKanban = useKanban("all");
  const { isNew: isNewCommitment, markVisible, markHidden } = useSeenCommitments();
  const { settings: displaySettings, update: updateDisplay } = useDisplaySettings();
  const { darkMode, toggleDarkMode } = useDarkMode();

  const tags = useLiveQuery(() => db.tags.orderBy("name").toArray(), []) ?? [];
  const [boardSelectedTags, setBoardSelectedTags] = useState<number[]>([]);
  const toggleBoardTag = useCallback((id: number) => {
    setBoardSelectedTags((prev) => prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]);
  }, []);

  const realPendingSuggestions = useLiveQuery(
    () => db.completion_suggestions.where("status").equals("pending").toArray(),
    []
  ) ?? [];

  // Phase 2: set of commitment IDs that have an active follow-up rule (for CommitmentCard badges)
  const followUpRuleIds = useLiveQuery(
    () => demoMode
      ? Promise.resolve(new Set<number>())
      : db.follow_up_rules.where("status").equals("active").toArray()
          .then((rules) => new Set(rules.map((r) => r.commitmentId))),
    [demoMode],
  ) ?? new Set<number>();

  useEffect(() => {
    chrome.storage.local.get(["anthropicApiKey", "userName", "developerMode", "demoMode", "engStatsEnabled", "githubToken"]).then((result) => {
      setHasApiKey(!!result.anthropicApiKey);
      setDeveloperMode(result.developerMode === true);
      setEngStatsEnabled(result.engStatsEnabled === true);
      setHasGithubToken(!!result.githubToken);
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
      if (changes.engStatsEnabled) {
        setEngStatsEnabled(changes.engStatsEnabled.newValue === true);
      }
      if (changes.demoMode) {
        setDemoMode(changes.demoMode.newValue === true);
      }
      if (changes.anthropicApiKey) {
        setHasApiKey(!!changes.anthropicApiKey.newValue);
      }
      if (changes.githubToken) {
        setHasGithubToken(!!changes.githubToken.newValue);
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  // ─── Demo mode: shadow real data with fixtures ───
  const commitments = demoMode ? DEMO_ACTIVE : realCommitments;
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

  const onFollowUp = useCallback(async (id: number) => {
    if (demoMode) { showToast("Follow-up set (demo)"); return; }
    await chrome.runtime.sendMessage({ type: "SET_FOLLOW_UP", commitmentId: id });
    showToast("Following up in 48 hours");
  }, [demoMode, showToast]);

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

  // ─── Board view: apply search to kanban columns ───

  const matchesBoardTag = (c: Commitment) => boardSelectedTags.length === 0 || (c.tag_id != null && boardSelectedTags.includes(c.tag_id));
  const boardTodo = kanban.todo.filter((c) => matchesSearch(c, boardSearch) && matchesBoardTag(c));
  const boardInProgress = kanban.inProgress.filter((c) => matchesSearch(c, boardSearch) && matchesBoardTag(c));
  const boardDone = kanban.done.filter((c) => matchesSearch(c, boardSearch) && matchesBoardTag(c));

  // Resolve selected item for the detail panel
  const allItems = [...kanban.todo, ...kanban.inProgress, ...kanban.done];
  const selectedItem = selectedId != null ? allItems.find((c) => c.id === selectedId) ?? null : null;
  const showPanel = selectedItem != null && !isNarrow;

  const dismissWizard = () => {
    setIsFirstRun(false);
    if (!demoMode) setHasApiKey(true);
  };

  // Wait for storage read before rendering to avoid wizard flash
  if (isFirstRun === null) return null;

  return (
    <DarkModeContext.Provider value={{ darkMode, toggleDarkMode }}>
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
        flexDirection: "column",
        overflow: "hidden",
        fontFamily: OS.font,
        color: OS.text,
        background: darkMode ? '#111113' : OS.bg,
      }}
    >
      {showPanel && (
        <style>{`@keyframes slideInPanel { from { opacity: 0; transform: translateX(16px); } to { opacity: 1; transform: translateX(0); } }`}</style>
      )}

      <TopBar
        viewMode={viewMode}
        setViewMode={setViewMode}
        developerMode={developerMode}
        engStatsEnabled={engStatsEnabled}
        hasGithubToken={hasGithubToken}
        onOpenSettings={() => setViewMode("settings")}
        scanning={scanning}
        onRescan={onRescan}
        scanAgo={scanAgo}
        demoMode={demoMode}
        displaySettings={displaySettings}
        onUpdateDisplay={updateDisplay}
        privacyMode={privacyMode}
        onTogglePrivacy={() => setPrivacyMode((p) => !p)}
        darkMode={darkMode}
        onToggleDark={toggleDarkMode}
      />

      <WarningBanner onOpenSettings={() => setViewMode("settings")} demoMode={demoMode} />
      {demoMode && <DemoModeBanner />}

      <div style={{ flex: 1, overflowY: "auto", display: "flex" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ padding: (viewMode === "focus" || viewMode === "board" || viewMode === "devlog" || viewMode === "eng-stats" || viewMode === "ai-news" || viewMode === "pr-inbox") ? "12px 16px" : 0 }}>

            {/* Focus view */}
            {viewMode === "focus" && <FocusView darkMode={darkMode} demoMode={demoMode} />}

            {/* Board view */}
            {viewMode === "board" && (
              <>
                {hasApiKey === false && (
                  <div style={{
                    margin: "0 0 10px 0", padding: "10px 14px",
                    background: darkMode ? "rgba(255,200,0,0.08)" : OS.yellowBg,
                    border: `1px solid ${darkMode ? "rgba(255,200,0,0.2)" : OS.yellowBorder}`,
                    borderRadius: 8, display: "flex", alignItems: "center",
                    justifyContent: "space-between", gap: 10,
                  }}>
                    <span style={{ fontSize: 12, color: darkMode ? "#e8c84a" : OS.yellowText, fontFamily: OS.font }}>
                      No API key — new items won't be extracted.
                    </span>
                    <button
                      onClick={() => setViewMode("settings")}
                      style={{
                        fontSize: 11, fontWeight: 600, fontFamily: OS.font,
                        padding: "4px 10px", borderRadius: 6, cursor: "pointer",
                        background: "transparent",
                        border: `1px solid ${darkMode ? "rgba(255,200,0,0.3)" : OS.yellowBorder}`,
                        color: darkMode ? "#e8c84a" : OS.yellowText,
                        whiteSpace: "nowrap",
                      }}
                    >
                      Add key →
                    </button>
                  </div>
                )}
                <FilterBubbles
                  search={boardSearch}
                  onSearchChange={setBoardSearch}
                  tags={effectiveTags}
                  selectedTags={boardSelectedTags}
                  onTagToggle={toggleBoardTag}
                  darkMode={darkMode}
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
                  isNewFn={isNewCommitment}
                  onMarkVisible={markVisible}
                  onMarkHidden={markHidden}
                  darkMode={darkMode}
                />
              </>
            )}

            {/* People view */}
            {viewMode === "people" && (
              <PeoplePanel
                demoMode={demoMode}
                showToast={showToast}
                onNavigateToDraft={(draftId) => {
                  setActiveDraftId(draftId);
                  setViewMode("draft");
                }}
                onSelectCommitment={(id) => setSelectedId(id)}
              />
            )}

            {/* PR Inbox view */}
            {viewMode === "pr-inbox" && <PRInboxView darkMode={darkMode} demoMode={demoMode} />}

            {/* Eng Stats view */}
            {viewMode === "eng-stats" && <EngStatsView darkMode={darkMode} />}

            {/* AI News view */}
            {viewMode === "ai-news" && <AINewsView darkMode={darkMode} demoMode={demoMode} />}

            {/* Dev Log view */}
            {viewMode === "devlog" && <DevLogView demoMode={demoMode} demoEntries={demoMode ? DEMO_DECISION_LOG : undefined} />}

            {/* Draft Composer view (reachable from Chat) */}
            {viewMode === "draft" && activeDraftId !== null && (
              <DraftComposer
                draftId={activeDraftId}
                demoMode={demoMode}
                onBack={() => setViewMode("board")}
                onSent={() => { setActiveDraftId(null); setViewMode("board"); }}
                showToast={showToast}
              />
            )}

            {/* Settings view */}
            {viewMode === "settings" && (
              <SettingsPanel onBack={() => setViewMode("board")} />
            )}

          </div>
        </div>

        {/* Transcript detail panel */}
        {showPanel && (
          <div style={{
            width: 420,
            flexShrink: 0,
            borderLeft: `1px solid ${dk(darkMode, 'rgba(255,255,255,0.08)', OS.border)}`,
            height: "100%",
            overflowY: "auto",
            background: dk(darkMode, '#161618', OS.white),
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
      </div>

      {showSmartTags && <SmartTagsModal onClose={() => setShowSmartTags(false)} demoMode={demoMode} />}

      {toast && <Toast message={toast.message} variant={toast.variant} onClose={() => setToast(null)} />}
      <ClydeChat showToast={showToast} sidePanelOpen={showPanel} proactiveMessage={proactiveMsg} onProactiveHandled={() => setProactiveMsg(null)} demoMode={demoMode} hasApiKey={hasApiKey === true} onNavigateToDraft={(draftId) => { setActiveDraftId(draftId); setViewMode("draft"); }} />
    </div>
    </>
    </DarkModeContext.Provider>
  );
}
