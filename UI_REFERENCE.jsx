import { useState, useEffect, useCallback } from "react";

const MOCK_COMMITMENTS = [
  {
    id: 1,
    text: "Send updated RICE framework to Gabe",
    original_quote: "Yeah I'll send over the updated RICE framework after this call",
    deadline: "2026-03-03T17:00:00",
    urgency: "high",
    context: "Weekly Engineering Sync",
    source_type: "meeting",
    timestamp: "2026-03-03T10:32:00",
    confidence: 0.94,
  },
  {
    id: 2,
    text: "Review Michaela's performance doc",
    original_quote: "I'll take a look at Michaela's self-review before our 1:1 Thursday",
    deadline: "2026-03-05T10:00:00",
    urgency: "medium",
    context: "DM with MJ",
    source_type: "slack",
    timestamp: "2026-03-03T09:14:00",
    confidence: 0.91,
  },
  {
    id: 3,
    text: "Schedule meeting with Autodesk team re: Forge API changes",
    original_quote: "Let me get something on the calendar with the Autodesk folks about the Forge deprecation timeline",
    deadline: null,
    urgency: "medium",
    context: "Product Strategy Review",
    source_type: "meeting",
    timestamp: "2026-03-03T11:05:00",
    confidence: 0.88,
  },
  {
    id: 4,
    text: "Look into PR cycle time spike from last week",
    original_quote: "I'll dig into why PR cycle times spiked, might be the new lint rules",
    deadline: null,
    urgency: "low",
    context: "#engineering-leads",
    source_type: "slack",
    timestamp: "2026-03-03T08:47:00",
    confidence: 0.85,
  },
  {
    id: 5,
    text: "Double-check velocity metrics for board deck",
    original_quote: "Can you double-check the velocity metrics before I send this to the board?",
    deadline: "2026-03-04T12:00:00",
    urgency: "high",
    context: "DM with Robert Shear",
    source_type: "slack",
    timestamp: "2026-03-02T16:22:00",
    confidence: 0.92,
  },
  {
    id: 6,
    text: "Think about the reorg proposal",
    original_quote: "Let me think about that and get back to you",
    deadline: null,
    urgency: "low",
    context: "1:1 with Wes",
    source_type: "meeting",
    timestamp: "2026-03-03T14:10:00",
    confidence: 0.52,
  },
  {
    id: 7,
    text: "Share CodeRabbit eval results with the team",
    original_quote: "I'll post the CodeRabbit results in the channel once I've had a chance to write it up",
    deadline: null,
    urgency: "medium",
    context: "#ai-tooling",
    source_type: "slack",
    timestamp: "2026-03-02T11:33:00",
    confidence: 0.89,
  },
];

const DISMISSED_PATTERNS = [
  { quote: "Let me think about that", reason: "Hedging / stalling", count: 4 },
  { quote: "I'll try to get to it", reason: "Low confidence language", count: 2 },
  { quote: "Yeah maybe", reason: "Non-committal agreement", count: 3 },
];

// OpenSpace brand tokens
const OS = {
  blue: "#2b67db",
  darkBlue: "#163B83",
  yellow: "#fde13c",
  lightBlue: "#bfd1f4",
  lightestBlue: "#d5e0f8",
  lightGray: "#dcdcdc",
  darkGray: "#323232",
  white: "#ffffff",
  bg: "#f7f8fc",
  cardBg: "#ffffff",
  border: "#e4e7f0",
  textPrimary: "#1a1d2e",
  textSecondary: "#5c6078",
  textMuted: "#8e92a8",
  font: "'Arial', 'Helvetica Neue', sans-serif",
};

function formatTime(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  const now = new Date("2026-03-03T15:00:00");
  const diff = d - now;
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (hours < 0) return "Overdue";
  if (hours < 1) return "< 1 hr";
  if (hours < 24) return `${hours}h`;
  return `${days}d`;
}

function formatDate(iso) {
  if (!iso) return "No deadline";
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

function ConfidencePill({ value }) {
  const pct = Math.round(value * 100);
  const color = value >= 0.85 ? "#16a34a" : value >= 0.7 ? "#ca8a04" : "#dc2626";
  const bg = value >= 0.85 ? "#dcfce7" : value >= 0.7 ? "#fef9c3" : "#fee2e2";
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, fontFamily: "monospace",
      color, background: bg,
      padding: "2px 8px", borderRadius: 10,
    }}>
      {pct}%
    </span>
  );
}

function SourceBadge({ type }) {
  const isSlack = type === "slack";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      fontSize: 11, fontWeight: 600,
      color: isSlack ? "#611f69" : OS.blue,
      background: isSlack ? "#f4ecf7" : OS.lightestBlue,
      padding: "2px 8px", borderRadius: 10,
      letterSpacing: "0.01em",
    }}>
      {isSlack ? "💬" : "🎙"} {isSlack ? "Slack" : "Meeting"}
    </span>
  );
}

function UrgencyIndicator({ urgency }) {
  const styles = {
    high: { color: "#dc2626", bg: "#fee2e2", label: "Urgent" },
    medium: { color: "#ca8a04", bg: "#fef9c3", label: "Medium" },
    low: { color: "#16a34a", bg: "#dcfce7", label: "Low" },
  };
  const s = styles[urgency];
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em",
      color: s.color, background: s.bg,
      padding: "2px 8px", borderRadius: 10,
    }}>
      {s.label}
    </span>
  );
}

function ActionBtn({ icon, label, onClick, variant = "default" }) {
  const [hovered, setHovered] = useState(false);
  const base = {
    default: {
      bg: hovered ? "#f0f2f8" : OS.white,
      border: OS.border,
      color: OS.textSecondary,
    },
    primary: {
      bg: hovered ? OS.darkBlue : OS.blue,
      border: OS.blue,
      color: OS.white,
    },
    danger: {
      bg: hovered ? "#fef2f2" : OS.white,
      border: hovered ? "#fca5a5" : "#fecaca",
      color: "#dc2626",
    },
    success: {
      bg: hovered ? "#f0fdf4" : OS.white,
      border: hovered ? "#86efac" : "#bbf7d0",
      color: "#16a34a",
    },
    yellow: {
      bg: hovered ? "#fef9c3" : OS.white,
      border: hovered ? "#fde047" : "#fef08a",
      color: "#a16207",
    },
  };
  const s = base[variant];
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        padding: "7px 14px", borderRadius: 8,
        background: s.bg, border: `1.5px solid ${s.border}`, color: s.color,
        fontSize: 12, fontWeight: 600, cursor: "pointer",
        fontFamily: OS.font,
        transition: "all 0.15s ease",
        whiteSpace: "nowrap",
        boxShadow: hovered ? "0 1px 3px rgba(0,0,0,0.06)" : "none",
      }}
    >
      <span style={{ fontSize: 14, lineHeight: 1 }}>{icon}</span>
      {label}
    </button>
  );
}

function CommitmentCard({ item, isExpanded, onToggle, onDismiss, onAction }) {
  const timeLeft = formatTime(item.deadline);
  const isOverdue = timeLeft === "Overdue";
  const borderColor = item.urgency === "high" ? "#dc2626" : item.urgency === "medium" ? "#eab308" : OS.border;

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
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Metadata row */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
            <UrgencyIndicator urgency={item.urgency} />
            <SourceBadge type={item.source_type} />
            <span style={{ fontSize: 12, color: OS.textMuted }}>{item.context}</span>
            <ConfidencePill value={item.confidence} />
          </div>

          {/* Main text */}
          <div style={{
            fontSize: 15, fontWeight: 700, color: OS.textPrimary,
            fontFamily: OS.font,
            lineHeight: 1.45,
          }}>
            {item.text}
          </div>
        </div>

        {/* Deadline */}
        <div style={{ textAlign: "right", flexShrink: 0, minWidth: 80 }}>
          {item.deadline ? (
            <>
              <div style={{
                fontSize: 13, fontWeight: 700,
                color: isOverdue ? "#dc2626" : timeLeft === "< 1 hr" ? "#ea580c" : OS.textSecondary,
                fontFamily: "monospace",
              }}>
                {isOverdue ? "⚠ Overdue" : `⏱ ${timeLeft}`}
              </div>
              <div style={{ fontSize: 11, color: OS.textMuted, marginTop: 2 }}>
                {formatDate(item.deadline)}
              </div>
            </>
          ) : (
            <span style={{ fontSize: 11, color: OS.textMuted, fontStyle: "italic" }}>No deadline</span>
          )}
        </div>
      </div>

      {/* Expanded */}
      {isExpanded && (
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: `1px solid ${OS.border}` }}>
          {/* Original quote */}
          <div style={{
            background: OS.lightestBlue,
            borderRadius: 8, padding: "12px 16px",
            borderLeft: `3px solid ${OS.blue}`,
            marginBottom: 16,
          }}>
            <div style={{
              fontSize: 10, fontWeight: 700, color: OS.blue,
              textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4,
            }}>
              Original quote
            </div>
            <div style={{ fontSize: 13, color: OS.darkBlue, fontStyle: "italic", lineHeight: 1.55 }}>
              "{item.original_quote}"
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <ActionBtn icon="📅" label="Calendar event" onClick={e => { e.stopPropagation(); onAction(item.id, "calendar"); }} variant="primary" />
            <ActionBtn icon="🔔" label="Set reminder" onClick={e => { e.stopPropagation(); onAction(item.id, "reminder"); }} variant="yellow" />
            <ActionBtn icon="💬" label="Slack message" onClick={e => { e.stopPropagation(); onAction(item.id, "slack"); }} />
            <ActionBtn icon="⏰" label="Snooze 1h" onClick={e => { e.stopPropagation(); onAction(item.id, "snooze"); }} />
            <ActionBtn icon="✅" label="Already done" onClick={e => { e.stopPropagation(); onAction(item.id, "done"); }} variant="success" />
            <ActionBtn icon="✕" label="Not a commitment" onClick={e => { e.stopPropagation(); onDismiss(item.id); }} variant="danger" />
          </div>
        </div>
      )}
    </div>
  );
}

function LearnedPatterns({ patterns }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{
      background: OS.cardBg, border: `1.5px solid ${OS.border}`, borderRadius: 10,
      padding: "14px 18px", marginBottom: 12,
    }}>
      <div
        onClick={() => setOpen(!open)}
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          cursor: "pointer",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 28, height: 28, borderRadius: 8,
            background: OS.lightestBlue, fontSize: 14,
          }}>🧠</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: OS.textPrimary, fontFamily: OS.font }}>
            Learned patterns
          </span>
          <span style={{
            fontSize: 11, fontWeight: 600, fontFamily: "monospace",
            background: OS.bg, color: OS.textMuted,
            padding: "2px 8px", borderRadius: 8,
          }}>
            {patterns.length} suppressed
          </span>
        </div>
        <span style={{
          color: OS.textMuted, fontSize: 16, lineHeight: 1,
          transition: "transform 0.2s ease",
          transform: open ? "rotate(180deg)" : "none",
        }}>▾</span>
      </div>
      {open && (
        <div style={{ marginTop: 12 }}>
          {patterns.map((p, i) => (
            <div key={i} style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "10px 0",
              borderTop: `1px solid ${OS.border}`,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ color: "#dc2626", fontSize: 12 }}>✕</span>
                <span style={{ fontSize: 12, color: OS.textSecondary, fontStyle: "italic" }}>
                  "{p.quote}"
                </span>
                <span style={{ fontSize: 11, color: OS.textMuted }}>— {p.reason}</span>
              </div>
              <span style={{
                fontSize: 11, fontFamily: "monospace", color: OS.textMuted,
                background: OS.bg, padding: "2px 8px", borderRadius: 6,
              }}>
                {p.count}x
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FilterBar({ filter, setFilter, counts }) {
  const filters = [
    { key: "all", label: `All (${counts.all})` },
    { key: "high", label: `Urgent (${counts.high})` },
    { key: "meetings", label: "Meetings" },
    { key: "slack", label: "Slack" },
    { key: "confident", label: "High confidence" },
  ];
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {filters.map(f => {
        const active = filter === f.key;
        return (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            style={{
              padding: "6px 14px", borderRadius: 8,
              fontSize: 12, fontWeight: active ? 700 : 500,
              fontFamily: OS.font,
              background: active ? OS.blue : OS.white,
              border: `1.5px solid ${active ? OS.blue : OS.border}`,
              color: active ? OS.white : OS.textSecondary,
              cursor: "pointer",
              transition: "all 0.15s ease",
              boxShadow: active ? "0 1px 4px rgba(43,103,219,0.2)" : "none",
            }}
          >
            {f.label}
          </button>
        );
      })}
    </div>
  );
}

function Toast({ message, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 2800);
    return () => clearTimeout(t);
  }, [onClose]);
  return (
    <div style={{
      position: "fixed", bottom: 24, right: 24,
      background: OS.darkBlue, color: OS.white,
      borderRadius: 10, padding: "12px 20px",
      fontSize: 13, fontWeight: 600,
      fontFamily: OS.font,
      boxShadow: "0 8px 32px rgba(22,59,131,0.25)",
      animation: "toastIn 0.3s ease",
      zIndex: 100,
      display: "flex", alignItems: "center", gap: 8,
    }}>
      {message}
    </div>
  );
}

function StatBar({ stats }) {
  return (
    <div style={{
      display: "flex", gap: 20, alignItems: "center",
    }}>
      {[
        { label: "Actioned", value: stats.actioned, color: "#16a34a" },
        { label: "Dismissed", value: stats.dismissed, color: "#dc2626" },
        { label: "Last scan", value: "3m ago", color: OS.textMuted },
      ].map((s, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 11, color: OS.textMuted, fontFamily: OS.font }}>{s.label}</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: s.color, fontFamily: "monospace" }}>
            {typeof s.value === "number" ? s.value : s.value}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function CommitmentTriage() {
  const [commitments, setCommitments] = useState(MOCK_COMMITMENTS);
  const [expandedId, setExpandedId] = useState(null);
  const [filter, setFilter] = useState("all");
  const [toast, setToast] = useState(null);
  const [stats, setStats] = useState({ actioned: 3, dismissed: 9 });

  const showToast = useCallback((msg) => setToast(msg), []);

  const handleDismiss = (id) => {
    const item = commitments.find(c => c.id === id);
    setCommitments(prev => prev.filter(c => c.id !== id));
    setExpandedId(null);
    showToast(`✕ Dismissed — learning from "${item?.original_quote?.slice(0, 35)}…"`);
    setStats(s => ({ ...s, dismissed: s.dismissed + 1 }));
  };

  const handleAction = (id, action) => {
    const labels = {
      calendar: "📅 Calendar event created",
      reminder: "🔔 Reminder set",
      slack: "💬 Opening Slack…",
      snooze: "⏰ Snoozed for 1 hour",
      done: "✅ Marked complete",
    };
    setCommitments(prev => prev.filter(c => c.id !== id));
    setExpandedId(null);
    showToast(labels[action]);
    setStats(s => ({ ...s, actioned: s.actioned + 1 }));
  };

  const filtered = commitments.filter(c => {
    if (filter === "all") return true;
    if (filter === "high") return c.urgency === "high";
    if (filter === "meetings") return c.source_type === "meeting";
    if (filter === "slack") return c.source_type === "slack";
    if (filter === "confident") return c.confidence >= 0.85;
    return true;
  }).sort((a, b) => {
    const urg = { high: 0, medium: 1, low: 2 };
    if (urg[a.urgency] !== urg[b.urgency]) return urg[a.urgency] - urg[b.urgency];
    return b.confidence - a.confidence;
  });

  const counts = {
    all: commitments.length,
    high: commitments.filter(c => c.urgency === "high").length,
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: OS.bg,
      fontFamily: OS.font,
      color: OS.textPrimary,
    }}>
      <style>{`
        @keyframes toastIn {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
      `}</style>

      {/* Top bar */}
      <div style={{
        background: OS.white,
        borderBottom: `1.5px solid ${OS.border}`,
        padding: "16px 24px",
        position: "sticky", top: 0, zIndex: 10,
      }}>
        <div style={{ maxWidth: 760, margin: "0 auto" }}>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            marginBottom: 14,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {/* OpenSpace-style logomark */}
              <div style={{
                width: 32, height: 32, borderRadius: 8,
                background: `linear-gradient(135deg, ${OS.blue}, ${OS.darkBlue})`,
                display: "flex", alignItems: "center", justifyContent: "center",
                color: OS.white, fontSize: 16, fontWeight: 900,
                boxShadow: "0 2px 8px rgba(43,103,219,0.25)",
              }}>
                ◉
              </div>
              <div>
                <h1 style={{
                  fontSize: 18, fontWeight: 900, color: OS.darkBlue,
                  letterSpacing: "-0.01em", lineHeight: 1.2,
                }}>
                  Commitments
                </h1>
                <span style={{ fontSize: 11, color: OS.textMuted }}>
                  Tue, Mar 3 · {commitments.length} items to review
                </span>
              </div>
              {counts.high > 0 && (
                <span style={{
                  fontSize: 11, fontWeight: 700,
                  background: "#fee2e2", color: "#dc2626",
                  padding: "3px 10px", borderRadius: 10,
                  fontFamily: "monospace",
                }}>
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
        <LearnedPatterns patterns={DISMISSED_PATTERNS} />

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {filtered.length === 0 ? (
            <div style={{
              textAlign: "center", padding: "64px 0",
              color: OS.textMuted,
            }}>
              <div style={{
                width: 56, height: 56, borderRadius: 16,
                background: OS.lightestBlue,
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                fontSize: 28, marginBottom: 12,
              }}>✓</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: OS.textPrimary, marginBottom: 4 }}>
                All clear
              </div>
              <div style={{ fontSize: 13 }}>No commitments to review right now.</div>
            </div>
          ) : (
            filtered.map(item => (
              <CommitmentCard
                key={item.id}
                item={item}
                isExpanded={expandedId === item.id}
                onToggle={() => setExpandedId(expandedId === item.id ? null : item.id)}
                onDismiss={handleDismiss}
                onAction={handleAction}
              />
            ))
          )}
        </div>

        {filtered.length > 0 && (
          <div style={{
            textAlign: "center", marginTop: 24, padding: "16px 0",
            fontSize: 12, color: OS.textMuted,
            borderTop: `1px solid ${OS.border}`,
          }}>
            Click a card to expand · Dismissals train the AI filter over time
          </div>
        )}
      </div>

      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </div>
  );
}
