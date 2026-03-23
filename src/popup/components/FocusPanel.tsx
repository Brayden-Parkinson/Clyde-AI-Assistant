import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { OS } from "@shared/tokens";
import { db } from "@shared/db";
import type { FocusSession, Commitment } from "@shared/types";
import { FOCUS_PRESETS, FOCUS_DEFAULT_MINUTES } from "@shared/constants";
import { DEMO_FOCUS_SESSIONS, DEMO_COMMITMENTS } from "@shared/demo-data";
import { useDarkMode, dk } from "../DarkModeContext";

// ─── Helpers ───

function formatMinutes(mins: number): string {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatTimer(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ─── Timer Display ───

function TimerRing({
  elapsed,
  total,
  darkMode,
}: {
  elapsed: number;
  total: number;
  darkMode: boolean;
}) {
  const radius = 80;
  const stroke = 6;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.min(elapsed / total, 1);
  const dashOffset = circumference * (1 - progress);

  return (
    <svg width={200} height={200} style={{ display: "block", margin: "0 auto" }}>
      {/* Background ring */}
      <circle
        cx={100} cy={100} r={radius}
        fill="none"
        stroke={dk(darkMode, "rgba(255,255,255,0.06)", OS.bg)}
        strokeWidth={stroke}
      />
      {/* Progress ring */}
      <circle
        cx={100} cy={100} r={radius}
        fill="none"
        stroke={progress >= 1 ? OS.green : OS.blue}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={dashOffset}
        transform="rotate(-90 100 100)"
        style={{ transition: "stroke-dashoffset 1s linear, stroke 0.3s ease" }}
      />
      {/* Timer text */}
      <text
        x={100} y={96}
        textAnchor="middle"
        style={{
          fontSize: 36,
          fontWeight: 600,
          fontFamily: OS.mono,
          fill: dk(darkMode, "rgba(255,255,255,0.90)", OS.text),
        }}
      >
        {formatTimer(Math.max(0, total - elapsed))}
      </text>
      <text
        x={100} y={120}
        textAnchor="middle"
        style={{
          fontSize: 12,
          fill: dk(darkMode, "rgba(255,255,255,0.35)", OS.muted),
          fontFamily: OS.font,
        }}
      >
        {progress >= 1 ? "done!" : "remaining"}
      </text>
    </svg>
  );
}

// ─── Preset Selector ───

function PresetPicker({
  selected,
  onSelect,
  darkMode,
}: {
  selected: number;
  onSelect: (mins: number) => void;
  darkMode: boolean;
}) {
  return (
    <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
      {FOCUS_PRESETS.map((mins) => (
        <button
          key={mins}
          onClick={() => onSelect(mins)}
          style={{
            padding: "6px 16px",
            borderRadius: 999,
            border: `1px solid ${selected === mins ? OS.blue : dk(darkMode, "rgba(255,255,255,0.10)", OS.border)}`,
            background: selected === mins ? (darkMode ? OS.blue + "22" : OS.blueBg) : "transparent",
            color: selected === mins ? OS.blue : dk(darkMode, "rgba(255,255,255,0.55)", OS.secondary),
            fontSize: 13,
            fontWeight: selected === mins ? 600 : 400,
            fontFamily: OS.font,
            cursor: "pointer",
            transition: "all 0.15s ease",
          }}
        >
          {formatMinutes(mins)}
        </button>
      ))}
    </div>
  );
}

// ─── Commitment Selector ───

function CommitmentPicker({
  commitments,
  selected,
  onSelect,
  darkMode,
}: {
  commitments: Commitment[];
  selected: number | null;
  onSelect: (id: number | null) => void;
  darkMode: boolean;
}) {
  if (commitments.length === 0) return null;

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{
        fontSize: 11,
        fontWeight: 600,
        textTransform: "uppercase" as const,
        letterSpacing: "0.05em",
        color: dk(darkMode, "rgba(255,255,255,0.35)", OS.muted),
        marginBottom: 8,
        fontFamily: OS.font,
      }}>
        Focus on
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <button
          onClick={() => onSelect(null)}
          style={{
            textAlign: "left" as const,
            padding: "8px 12px",
            borderRadius: 8,
            border: `1px solid ${selected === null ? OS.blue : dk(darkMode, "rgba(255,255,255,0.06)", "transparent")}`,
            background: selected === null ? (darkMode ? OS.blue + "12" : OS.blueBg) : "transparent",
            color: dk(darkMode, "rgba(255,255,255,0.55)", OS.secondary),
            fontSize: 12,
            fontFamily: OS.font,
            cursor: "pointer",
          }}
        >
          No specific commitment
        </button>
        {commitments.slice(0, 8).map((c) => (
          <button
            key={c.id}
            onClick={() => onSelect(c.id ?? null)}
            style={{
              textAlign: "left" as const,
              padding: "8px 12px",
              borderRadius: 8,
              border: `1px solid ${selected === c.id ? OS.blue : dk(darkMode, "rgba(255,255,255,0.06)", "transparent")}`,
              background: selected === c.id ? (darkMode ? OS.blue + "12" : OS.blueBg) : "transparent",
              color: dk(darkMode, "rgba(255,255,255,0.85)", OS.text),
              fontSize: 12,
              fontFamily: OS.font,
              cursor: "pointer",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap" as const,
            }}
          >
            <span style={{
              display: "inline-block",
              width: 6, height: 6, borderRadius: 3,
              background: c.urgency === "high" ? OS.red : c.urgency === "medium" ? OS.warning : OS.muted,
              marginRight: 8,
              flexShrink: 0,
            }} />
            {c.text}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Session History ───

function SessionRow({
  session,
  commitmentText,
  darkMode,
}: {
  session: FocusSession;
  commitmentText: string | null;
  darkMode: boolean;
}) {
  const isAbandoned = session.status === "abandoned";
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "8px 0",
      borderBottom: `1px solid ${dk(darkMode, "rgba(255,255,255,0.06)", OS.border + "60")}`,
    }}>
      <div style={{
        width: 8, height: 8, borderRadius: 4,
        background: isAbandoned ? OS.warning : OS.green,
        flexShrink: 0,
      }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 12,
          color: dk(darkMode, "rgba(255,255,255,0.85)", OS.text),
          fontFamily: OS.font,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap" as const,
        }}>
          {commitmentText || "General focus"}
        </div>
        {session.note && (
          <div style={{
            fontSize: 11,
            color: dk(darkMode, "rgba(255,255,255,0.40)", OS.muted),
            marginTop: 2,
            fontFamily: OS.font,
          }}>
            {session.note}
          </div>
        )}
      </div>
      <div style={{
        fontSize: 11,
        color: dk(darkMode, "rgba(255,255,255,0.35)", OS.muted),
        fontFamily: OS.mono,
        whiteSpace: "nowrap" as const,
      }}>
        {session.actualMinutes != null ? formatMinutes(session.actualMinutes) : "—"}
      </div>
      <div style={{
        fontSize: 11,
        color: dk(darkMode, "rgba(255,255,255,0.25)", OS.faint),
        fontFamily: OS.font,
        whiteSpace: "nowrap" as const,
      }}>
        {relativeTime(session.startedAt)}
      </div>
    </div>
  );
}

// ─── Stats Summary ───

function FocusStats({
  sessions,
  darkMode,
}: {
  sessions: FocusSession[];
  darkMode: boolean;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const todaySessions = sessions.filter(
    (s) => s.status === "completed" && s.startedAt.slice(0, 10) === today,
  );
  const todayMinutes = todaySessions.reduce((sum, s) => sum + (s.actualMinutes ?? 0), 0);
  const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
  const weekSessions = sessions.filter(
    (s) => s.status === "completed" && s.startedAt >= weekAgo,
  );
  const weekMinutes = weekSessions.reduce((sum, s) => sum + (s.actualMinutes ?? 0), 0);
  const streak = todaySessions.length;

  const stats = [
    { label: "Today", value: formatMinutes(todayMinutes) },
    { label: "This week", value: formatMinutes(weekMinutes) },
    { label: "Sessions today", value: String(streak) },
    { label: "Completed", value: String(weekSessions.length) },
  ];

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "1fr 1fr 1fr 1fr",
      gap: 8,
      marginBottom: 20,
    }}>
      {stats.map((s) => (
        <div
          key={s.label}
          style={{
            textAlign: "center" as const,
            padding: "10px 4px",
            borderRadius: 8,
            background: dk(darkMode, "rgba(255,255,255,0.04)", OS.white),
            border: `1px solid ${dk(darkMode, "rgba(255,255,255,0.06)", OS.border)}`,
          }}
        >
          <div style={{
            fontSize: 18,
            fontWeight: 700,
            color: dk(darkMode, "rgba(255,255,255,0.90)", OS.text),
            fontFamily: OS.mono,
          }}>
            {s.value}
          </div>
          <div style={{
            fontSize: 10,
            color: dk(darkMode, "rgba(255,255,255,0.35)", OS.muted),
            fontFamily: OS.font,
            marginTop: 2,
          }}>
            {s.label}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Main Component ───

export function FocusPanel({
  demoMode,
  showToast,
}: {
  demoMode: boolean;
  showToast: (msg: string, variant?: "success" | "error" | "info") => void;
}) {
  const darkMode = useDarkMode();

  // Active session from DB
  const activeSession = useLiveQuery(
    () => demoMode ? undefined : db.focus_sessions.where("status").equals("active").first(),
    [demoMode],
  );

  // All sessions for history/stats
  const allSessions = useLiveQuery(
    () => demoMode
      ? DEMO_FOCUS_SESSIONS
      : db.focus_sessions.orderBy("startedAt").reverse().limit(50).toArray(),
    [demoMode],
  ) ?? [];

  // Active commitments for the picker
  const commitments = useLiveQuery(
    () => demoMode
      ? DEMO_COMMITMENTS.filter((c) => c.status === "new" || c.status === "actioned")
      : db.commitments.where("status").anyOf("new", "actioned").toArray(),
    [demoMode],
  ) ?? [];

  // Build a commitmentId → text map for history display
  const commitmentMap = useMemo(() => {
    const map = new Map<number, string>();
    for (const c of commitments) {
      if (c.id != null) map.set(c.id, c.text);
    }
    return map;
  }, [commitments]);

  // Local state
  const [targetMinutes, setTargetMinutes] = useState(FOCUS_DEFAULT_MINUTES);
  const [selectedCommitment, setSelectedCommitment] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0); // seconds elapsed in active session

  // Timer tick for active session
  useEffect(() => {
    if (!activeSession) {
      setElapsed(0);
      return;
    }
    const startTime = new Date(activeSession.startedAt).getTime();
    const tick = () => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [activeSession]);

  const isActive = !!activeSession;
  const totalSeconds = isActive ? activeSession!.targetMinutes * 60 : targetMinutes * 60;

  const handleStart = useCallback(async () => {
    if (demoMode) {
      showToast("Focus sessions are disabled in demo mode", "info");
      return;
    }
    try {
      await chrome.runtime.sendMessage({
        type: "FOCUS_START",
        commitmentId: selectedCommitment,
        targetMinutes,
      });
      showToast(`Focus session started — ${formatMinutes(targetMinutes)}`, "success");
    } catch (err) {
      showToast("Failed to start session", "error");
    }
  }, [demoMode, selectedCommitment, targetMinutes, showToast]);

  const handleStop = useCallback(async () => {
    if (demoMode) return;
    try {
      await chrome.runtime.sendMessage({ type: "FOCUS_STOP" });
      showToast("Focus session completed!", "success");
    } catch {
      showToast("Failed to stop session", "error");
    }
  }, [demoMode, showToast]);

  const handleAbandon = useCallback(async () => {
    if (demoMode) return;
    try {
      await chrome.runtime.sendMessage({ type: "FOCUS_ABANDON" });
      showToast("Session abandoned", "info");
    } catch {
      showToast("Failed to abandon session", "error");
    }
  }, [demoMode, showToast]);

  const completedSessions = allSessions.filter((s) => s.status !== "active");

  return (
    <div style={{ padding: "16px 20px", fontFamily: OS.font }}>
      {/* Stats */}
      <FocusStats sessions={allSessions} darkMode={darkMode} />

      {/* Timer / Start Section */}
      <div style={{
        background: dk(darkMode, "rgba(255,255,255,0.03)", OS.white),
        border: `1px solid ${dk(darkMode, "rgba(255,255,255,0.06)", OS.border)}`,
        borderRadius: 12,
        padding: "24px 20px",
        marginBottom: 20,
      }}>
        {isActive ? (
          <>
            {/* Active timer */}
            <TimerRing elapsed={elapsed} total={totalSeconds} darkMode={darkMode} />

            {activeSession!.commitmentId != null && (
              <div style={{
                textAlign: "center" as const,
                marginTop: 12,
                fontSize: 12,
                color: dk(darkMode, "rgba(255,255,255,0.55)", OS.secondary),
              }}>
                {commitmentMap.get(activeSession!.commitmentId!) ?? "Commitment"}
              </div>
            )}

            <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 20 }}>
              <button
                onClick={handleStop}
                style={{
                  padding: "8px 24px",
                  borderRadius: 8,
                  border: "none",
                  background: OS.green,
                  color: "#fff",
                  fontSize: 13,
                  fontWeight: 600,
                  fontFamily: OS.font,
                  cursor: "pointer",
                }}
              >
                Complete
              </button>
              <button
                onClick={handleAbandon}
                style={{
                  padding: "8px 16px",
                  borderRadius: 8,
                  border: `1px solid ${dk(darkMode, "rgba(255,255,255,0.10)", OS.border)}`,
                  background: "transparent",
                  color: dk(darkMode, "rgba(255,255,255,0.45)", OS.muted),
                  fontSize: 13,
                  fontFamily: OS.font,
                  cursor: "pointer",
                }}
              >
                Abandon
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Setup — pick duration and commitment */}
            <div style={{
              textAlign: "center" as const,
              fontSize: 13,
              fontWeight: 600,
              color: dk(darkMode, "rgba(255,255,255,0.85)", OS.text),
              marginBottom: 16,
            }}>
              Start a focus session
            </div>

            <PresetPicker
              selected={targetMinutes}
              onSelect={setTargetMinutes}
              darkMode={darkMode}
            />

            <CommitmentPicker
              commitments={commitments}
              selected={selectedCommitment}
              onSelect={setSelectedCommitment}
              darkMode={darkMode}
            />

            <div style={{ textAlign: "center" as const, marginTop: 20 }}>
              <button
                onClick={handleStart}
                style={{
                  padding: "10px 40px",
                  borderRadius: 999,
                  border: "none",
                  background: OS.blue,
                  color: "#fff",
                  fontSize: 14,
                  fontWeight: 600,
                  fontFamily: OS.font,
                  cursor: "pointer",
                  letterSpacing: "-0.01em",
                }}
              >
                Start {formatMinutes(targetMinutes)} session
              </button>
            </div>
          </>
        )}
      </div>

      {/* Session History */}
      {completedSessions.length > 0 && (
        <div>
          <div style={{
            fontSize: 11,
            fontWeight: 600,
            textTransform: "uppercase" as const,
            letterSpacing: "0.05em",
            color: dk(darkMode, "rgba(255,255,255,0.35)", OS.muted),
            marginBottom: 10,
            fontFamily: OS.font,
          }}>
            Recent sessions
          </div>
          {completedSessions.slice(0, 15).map((s) => (
            <SessionRow
              key={s.id}
              session={s}
              commitmentText={s.commitmentId != null ? commitmentMap.get(s.commitmentId) ?? null : null}
              darkMode={darkMode}
            />
          ))}
        </div>
      )}

      {completedSessions.length === 0 && !isActive && (
        <div style={{
          textAlign: "center" as const,
          padding: "24px 0",
          color: dk(darkMode, "rgba(255,255,255,0.25)", OS.faint),
          fontSize: 12,
          fontFamily: OS.font,
        }}>
          No sessions yet — start your first focus block above
        </div>
      )}
    </div>
  );
}
