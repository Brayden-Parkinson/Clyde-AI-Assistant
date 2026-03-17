import React, { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { OS } from "@shared/tokens";
import { db } from "@shared/db";
import type { WorkPattern, WeeklyDigest, WorkPatternType } from "@shared/types";
import { IconBrain, IconChevronDown, IconChevronRight, IconCheck, IconRefresh } from "./Icons";

// ─── Props ───

interface InsightsPanelProps {
  demoMode: boolean;
  demoPatterns?: WorkPattern[];
  demoDigests?: WeeklyDigest[];
}

// ─── Sentiment colors ───

function sentimentColor(sentiment: WorkPattern["sentiment"]): string {
  switch (sentiment) {
    case "concerning": return OS.red;
    case "positive": return OS.green;
    case "neutral": return OS.muted;
  }
}

// ─── Type badge colors ───

const TYPE_COLORS: Record<WorkPatternType, string> = {
  time_allocation: OS.blue,
  completion_rate: OS.green,
  deadline_adherence: "#D97706",
  procrastination: OS.red,
  overcommitment: OS.red,
  bottleneck: "#D97706",
  priority_mismatch: OS.blue,
};

function typeLabel(type: WorkPatternType): string {
  return type.replace(/_/g, " ");
}

// ─── Format week start ───

function formatWeekStart(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

// ─── Pattern Card ───

function PatternCard({
  pattern,
  demoMode,
}: {
  pattern: WorkPattern;
  demoMode: boolean;
}) {
  const color = sentimentColor(pattern.sentiment);
  const typeColor = TYPE_COLORS[pattern.type] ?? OS.muted;

  async function handleAcknowledge() {
    if (demoMode) return;
    if (pattern.id == null) return;
    await db.work_patterns.update(pattern.id, { acknowledged: true });
  }

  return (
    <div
      style={{
        background: OS.white,
        border: `1.5px solid ${OS.border}`,
        borderLeft: `3px solid ${color}`,
        borderRadius: 8,
        padding: "12px 14px",
        marginBottom: 8,
      }}
    >
      {/* Type badge */}
      <div style={{ marginBottom: 6 }}>
        <span
          style={{
            display: "inline-block",
            fontSize: 10,
            fontWeight: 600,
            fontFamily: OS.font,
            color: typeColor,
            background: `${typeColor}14`,
            padding: "2px 8px",
            borderRadius: 10,
            textTransform: "capitalize",
          }}
        >
          {typeLabel(pattern.type)}
        </span>
      </div>

      {/* Description */}
      <p
        style={{
          margin: 0,
          fontSize: 13,
          fontFamily: OS.font,
          color: OS.text,
          lineHeight: 1.4,
        }}
      >
        {pattern.description}
      </p>

      {/* Confidence bar */}
      <div
        style={{
          marginTop: 8,
          height: 3,
          background: OS.border,
          borderRadius: 2,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${pattern.confidence * 100}%`,
            background: color,
            borderRadius: 2,
            transition: "width 0.3s ease",
          }}
        />
      </div>

      {/* Suggestion */}
      {pattern.suggestion && (
        <div
          style={{
            marginTop: 8,
            padding: "6px 10px",
            background: OS.bg,
            borderRadius: 6,
            fontSize: 12,
            fontFamily: OS.font,
            color: OS.secondary,
            lineHeight: 1.4,
          }}
        >
          {pattern.suggestion}
        </div>
      )}

      {/* Acknowledge button */}
      {!pattern.acknowledged && (
        <button
          onClick={handleAcknowledge}
          style={{
            marginTop: 8,
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "4px 10px",
            fontSize: 11,
            fontFamily: OS.font,
            fontWeight: 500,
            color: OS.muted,
            background: "transparent",
            border: `1px solid ${OS.border}`,
            borderRadius: 6,
            cursor: "pointer",
          }}
        >
          <IconCheck size={12} />
          Acknowledge
        </button>
      )}
    </div>
  );
}

// ─── Digest Card ───

function DigestCard({ digest }: { digest: WeeklyDigest }) {
  return (
    <div
      style={{
        background: OS.white,
        border: `1.5px solid ${OS.border}`,
        borderRadius: 8,
        padding: "12px 14px",
        marginBottom: 8,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 6,
        }}
      >
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            fontFamily: OS.font,
            color: OS.text,
          }}
        >
          Week of {formatWeekStart(digest.weekStart)}
        </span>
        <div style={{ display: "flex", gap: 8 }}>
          <span style={{ fontSize: 11, fontFamily: OS.font, color: OS.green }}>
            {digest.completed} done
          </span>
          <span style={{ fontSize: 11, fontFamily: OS.font, color: OS.blue }}>
            {digest.added} new
          </span>
          {digest.overdue > 0 && (
            <span style={{ fontSize: 11, fontFamily: OS.font, color: OS.red }}>
              {digest.overdue} overdue
            </span>
          )}
        </div>
      </div>

      <p
        style={{
          margin: 0,
          fontSize: 12,
          fontFamily: OS.font,
          color: OS.secondary,
          lineHeight: 1.5,
        }}
      >
        {digest.summary}
      </p>

      {digest.suggestedFocus.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              fontFamily: OS.font,
              color: OS.muted,
              textTransform: "uppercase",
              letterSpacing: 0.5,
            }}
          >
            Focus areas
          </span>
          <ul
            style={{
              margin: "4px 0 0",
              paddingLeft: 16,
              fontSize: 12,
              fontFamily: OS.font,
              color: OS.text,
              lineHeight: 1.5,
            }}
          >
            {digest.suggestedFocus.map((focus, i) => (
              <li key={i}>{focus}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─── Main Panel ───

export function InsightsPanel({ demoMode, demoPatterns, demoDigests }: InsightsPanelProps) {
  const [digestsOpen, setDigestsOpen] = useState(false);
  const [detecting, setDetecting] = useState(false);

  // Live data from DB (or demo data)
  const livePatterns = useLiveQuery(
    () => demoMode ? ([] as WorkPattern[]) : db.work_patterns.orderBy("createdAt").reverse().toArray(),
    [demoMode]
  );
  const liveDigests = useLiveQuery(
    () => demoMode ? ([] as WeeklyDigest[]) : db.weekly_digests.orderBy("createdAt").reverse().limit(8).toArray(),
    [demoMode]
  );

  const patterns: WorkPattern[] = demoMode ? (demoPatterns ?? []) : (livePatterns ?? []);
  const digests: WeeklyDigest[] = demoMode ? (demoDigests ?? []) : (liveDigests ?? []);

  // Filter out acknowledged patterns
  const activePatterns = patterns.filter(p => !p.acknowledged);

  // Group by sentiment
  const concerning = activePatterns.filter(p => p.sentiment === "concerning");
  const neutral = activePatterns.filter(p => p.sentiment === "neutral");
  const positive = activePatterns.filter(p => p.sentiment === "positive");

  async function handleDetectPatterns() {
    if (demoMode) return;
    setDetecting(true);
    try {
      await chrome.runtime.sendMessage({ type: "DETECT_PATTERNS" });
    } catch {
      // Message port closed — background might still process
    }
    // Give the background a moment then let useLiveQuery pick up results
    setTimeout(() => setDetecting(false), 3000);
  }

  const hasPatterns = activePatterns.length > 0;

  return (
    <div>
      {/* Header with detect button */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 28,
              height: 28,
              borderRadius: 8,
              background: `${OS.blue}14`,
              color: OS.blue,
            }}
          >
            <IconBrain size={15} />
          </span>
          <span
            style={{
              fontSize: 14,
              fontWeight: 600,
              fontFamily: OS.font,
              color: OS.text,
            }}
          >
            Work Insights
          </span>
        </div>
        <button
          onClick={handleDetectPatterns}
          disabled={detecting}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "5px 10px",
            fontSize: 11,
            fontWeight: 500,
            fontFamily: OS.font,
            color: detecting ? OS.muted : OS.blue,
            background: "transparent",
            border: `1px solid ${detecting ? OS.border : OS.blue}`,
            borderRadius: 6,
            cursor: detecting ? "default" : "pointer",
            opacity: detecting ? 0.6 : 1,
          }}
        >
          <IconRefresh size={12} />
          {detecting ? "Detecting..." : "Detect Patterns"}
        </button>
      </div>

      {/* Empty state */}
      {!hasPatterns && (
        <div
          style={{
            textAlign: "center",
            padding: "20px 16px",
            color: OS.muted,
            fontSize: 12,
            fontFamily: OS.font,
          }}
        >
          No patterns detected yet. Click "Detect Patterns" or wait for the weekly scan.
        </div>
      )}

      {/* Concerning patterns */}
      {concerning.length > 0 && (
        <div style={{ marginBottom: 4 }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              fontFamily: OS.font,
              color: OS.red,
              textTransform: "uppercase",
              letterSpacing: 0.5,
            }}
          >
            Needs Attention
          </span>
          <div style={{ marginTop: 6 }}>
            {concerning.map(p => (
              <PatternCard key={p.id ?? p.description} pattern={p} demoMode={demoMode} />
            ))}
          </div>
        </div>
      )}

      {/* Neutral patterns */}
      {neutral.length > 0 && (
        <div style={{ marginBottom: 4 }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              fontFamily: OS.font,
              color: OS.muted,
              textTransform: "uppercase",
              letterSpacing: 0.5,
            }}
          >
            Observations
          </span>
          <div style={{ marginTop: 6 }}>
            {neutral.map(p => (
              <PatternCard key={p.id ?? p.description} pattern={p} demoMode={demoMode} />
            ))}
          </div>
        </div>
      )}

      {/* Positive patterns */}
      {positive.length > 0 && (
        <div style={{ marginBottom: 4 }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              fontFamily: OS.font,
              color: OS.green,
              textTransform: "uppercase",
              letterSpacing: 0.5,
            }}
          >
            Going Well
          </span>
          <div style={{ marginTop: 6 }}>
            {positive.map(p => (
              <PatternCard key={p.id ?? p.description} pattern={p} demoMode={demoMode} />
            ))}
          </div>
        </div>
      )}

      {/* Weekly Digests — collapsible */}
      <div
        style={{
          marginTop: hasPatterns ? 12 : 0,
          borderTop: hasPatterns ? `1px solid ${OS.border}` : "none",
          paddingTop: hasPatterns ? 12 : 0,
        }}
      >
        <div
          onClick={() => setDigestsOpen(!digestsOpen)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            cursor: "pointer",
            marginBottom: digestsOpen ? 8 : 0,
          }}
        >
          {digestsOpen ? (
            <IconChevronDown size={14} />
          ) : (
            <IconChevronRight size={14} />
          )}
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              fontFamily: OS.font,
              color: OS.text,
            }}
          >
            Weekly Digests
          </span>
          {digests.length > 0 && (
            <span
              style={{
                fontSize: 11,
                fontFamily: OS.font,
                color: OS.muted,
              }}
            >
              ({digests.length})
            </span>
          )}
        </div>

        {digestsOpen && (
          <div>
            {digests.length === 0 ? (
              <div
                style={{
                  textAlign: "center",
                  padding: "12px 16px",
                  color: OS.muted,
                  fontSize: 12,
                  fontFamily: OS.font,
                }}
              >
                No weekly digests yet. The first one generates on Sunday evening.
              </div>
            ) : (
              digests.map(d => (
                <DigestCard key={d.id ?? d.weekStart} digest={d} />
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
