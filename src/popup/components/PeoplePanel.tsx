import React, { useState, useEffect, useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { OS } from "@shared/tokens";
import { db } from "@shared/db";
import type { Person, Commitment, PersonContext } from "@shared/types";
import { DEMO_PEOPLE, DEMO_ACTIVE, DEMO_PEOPLE_CONTEXT } from "@shared/demo-data";
import { useDarkMode, dk } from "../DarkModeContext";

// ─── Helpers ───

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}

function formatDeadline(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const RELATIONSHIP_COLORS: Record<string, { bg: string; text: string }> = {
  manager:     { bg: OS.blue + "18",     text: OS.blue },
  report:      { bg: OS.green + "18",    text: OS.green },
  peer:        { bg: "#7C3AED18",        text: "#7C3AED" },
  stakeholder: { bg: OS.warning + "18",  text: OS.warning },
  external:    { bg: OS.faint + "18",    text: OS.secondary },
};

type Relationship = "manager" | "report" | "peer" | "stakeholder" | "external";
const RELATIONSHIPS: Relationship[] = ["manager", "report", "peer", "stakeholder", "external"];

function IconRefresh({ spinning }: { spinning?: boolean }): React.ReactElement {
  return (
    <svg
      width="13" height="13" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2.5"
      style={spinning ? { animation: "spin 0.8s linear infinite" } : undefined}
    >
      <polyline points="1 4 1 10 7 10" />
      <path d="M3.51 15a9 9 0 1 0 .49-5" />
    </svg>
  );
}

// ─── Types ───

interface PersonData {
  person: Person;
  commitments: Commitment[];
  openCommitments: Commitment[];
  openCount: number;
  commitmentCount: number;
  hasOverdue: boolean;
  oldestOverdueDeadline: number | null;
}

function getPersonCommitments(person: Person, allCommitments: Commitment[]): Commitment[] {
  return allCommitments.filter(c =>
    c.conversation_messages?.some(m => m.sender.toLowerCase() === person.name.toLowerCase()) ||
    c.context.toLowerCase().includes(person.name.toLowerCase())
  );
}

function isOpenStatus(status: string): boolean {
  return status === "new" || status === "snoozed" || status === "actioned";
}

function isOverdue(c: Commitment): boolean {
  if (!c.deadline) return false;
  return new Date(c.deadline).getTime() < Date.now() && c.status !== "done" && c.status !== "dismissed";
}

// ─── Component ───

interface PeoplePanelProps {
  demoMode: boolean;
  showToast: (msg: string, variant?: "success" | "error" | "info" | "warning") => void;
  /** Called after a draft is generated — navigates to DraftComposer */
  onNavigateToDraft?: (draftId: number) => void;
  /** Called when user clicks a commitment text to open the detail panel */
  onSelectCommitment?: (id: number) => void;
}

export function PeoplePanel({ demoMode, showToast, onNavigateToDraft, onSelectCommitment }: PeoplePanelProps) {
  const darkMode = useDarkMode();

  const livePeople = useLiveQuery(
    () => db.people.orderBy("commitmentCount").reverse().toArray(),
    [],
  );

  const allLiveCommitments = useLiveQuery(
    () => demoMode ? Promise.resolve([] as Commitment[]) : db.commitments.toArray(),
    [demoMode]
  ) ?? [];

  const liveContextMap = useLiveQuery(async () => {
    if (demoMode) {
      const map = new Map<number, PersonContext>();
      for (const ctx of DEMO_PEOPLE_CONTEXT) map.set(ctx.personId, ctx);
      return map;
    }
    const all = await db.people_context.toArray();
    const map = new Map<number, PersonContext>();
    for (const ctx of all) map.set(ctx.personId, ctx);
    return map;
  }, [demoMode]) ?? new Map<number, PersonContext>();

  // Load user name to filter self out of display
  const [selfName, setSelfName] = useState("");
  useEffect(() => {
    chrome.storage.local.get("userName").then((r) => {
      setSelfName(((r.userName as string) || "").toLowerCase());
    });
  }, []);

  // Count open (non-done, non-dismissed) commitments per person (kept for badge compat)
  const openCommitmentMap = useLiveQuery(async () => {
    if (demoMode) return new Map<string, number>();
    const open = await db.commitments.where("status").anyOf("new", "snoozed", "actioned").toArray();
    const counts = new Map<string, number>();
    for (const c of open) {
      for (const msg of (c.conversation_messages ?? [])) {
        const n = msg.sender.toLowerCase();
        if (n && n !== "you") counts.set(n, (counts.get(n) ?? 0) + 1);
      }
    }
    return counts;
  }, [demoMode]) ?? new Map<string, number>();

  const rawPeople: Person[] = demoMode ? DEMO_PEOPLE : (livePeople ?? []);
  const BOT_DISPLAY_PATTERN = /^(slackbot|workflow|github|linear|jira|figma|notion|zapier|app|integration|automation|bot|alert|notification|webhook|deploy|ci|cd|jenkins|travis|circleci|datadog|pagerduty|sentry|slack app)/i;
  const people: Person[] = demoMode
    ? rawPeople
    : rawPeople.filter((p) =>
        (!selfName || p.name.toLowerCase() !== selfName) &&
        !BOT_DISPLAY_PATTERN.test(p.name)
      );

  const allCommitments: Commitment[] = demoMode ? DEMO_ACTIVE : (allLiveCommitments ?? []);

  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [editRelationship, setEditRelationship] = useState<string | null>(null);
  const [editNotes, setEditNotes] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newRelationship, setNewRelationship] = useState<Relationship | "">("");
  const [scanning, setScanning] = useState(false);
  const [followUpLoading, setFollowUpLoading] = useState<string | null>(null);
  // Per-person "show all" toggle: Set of person IDs that have all commitments expanded
  const [showAllCommitmentsFor, setShowAllCommitmentsFor] = useState<Set<number>>(new Set());
  // Hover state for commitment circle buttons
  const [hoveredCircleId, setHoveredCircleId] = useState<number | null>(null);

  // Auto-backfill on first open if people table is empty (real mode only)
  useEffect(() => {
    if (demoMode || livePeople === undefined) return;
    if (livePeople.length === 0) {
      chrome.runtime.sendMessage({ type: "SCAN_PEOPLE" }).catch(() => {});
    }
  }, [demoMode, livePeople]);

  // Compute rich person data with memoization
  const personData: PersonData[] = useMemo(() => {
    return people.map((person) => {
      const commitments = getPersonCommitments(person, allCommitments);
      const openCommitments = commitments.filter(c => isOpenStatus(c.status));

      // Sort open commitments: overdue first (by oldest deadline), then by recency
      const sorted = [...openCommitments].sort((a, b) => {
        const aOverdue = isOverdue(a);
        const bOverdue = isOverdue(b);
        if (aOverdue && !bOverdue) return -1;
        if (!aOverdue && bOverdue) return 1;
        if (aOverdue && bOverdue && a.deadline && b.deadline) {
          return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
        }
        // Both not overdue: sort by createdAt desc
        const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return bTime - aTime;
      });

      const overdueItems = openCommitments.filter(isOverdue);
      const oldestOverdueDeadline = overdueItems.length > 0
        ? Math.min(...overdueItems.map(c => new Date(c.deadline!).getTime()))
        : null;

      return {
        person,
        commitments,
        openCommitments: sorted,
        openCount: openCommitments.length,
        commitmentCount: commitments.length,
        hasOverdue: overdueItems.length > 0,
        oldestOverdueDeadline,
      };
    });
  }, [people, allCommitments]);

  const filtered = search
    ? personData.filter(
        ({ person }) =>
          person.name.toLowerCase().includes(search.toLowerCase()) ||
          (person.email && person.email.toLowerCase().includes(search.toLowerCase())),
      )
    : personData;

  // Split into two sections
  const needsAttention = filtered
    .filter(d => d.openCount > 0)
    .sort((a, b) => {
      // Overdue people first (by oldest overdue deadline)
      if (a.hasOverdue && !b.hasOverdue) return -1;
      if (!a.hasOverdue && b.hasOverdue) return 1;
      if (a.hasOverdue && b.hasOverdue && a.oldestOverdueDeadline && b.oldestOverdueDeadline) {
        return a.oldestOverdueDeadline - b.oldestOverdueDeadline;
      }
      return b.openCount - a.openCount;
    });

  const allClear = filtered.filter(d => d.openCount === 0 && d.commitmentCount > 0);

  function handleExpand(person: Person) {
    if (expandedId === person.id) {
      setExpandedId(null);
    } else {
      setExpandedId(person.id ?? null);
      setEditRelationship(person.relationship ?? null);
      setEditNotes(person.notes ?? "");
    }
  }

  async function handleSave(person: Person) {
    if (demoMode) { showToast("Demo mode — changes not saved", "error"); return; }
    if (person.id == null) return;
    await db.people.update(person.id, {
      relationship: (editRelationship as Relationship) || null,
      notes: editNotes || null,
    });
    showToast("Contact updated", "success");
    setExpandedId(null);
  }

  async function handleAdd() {
    if (demoMode) { showToast("Demo mode — changes not saved", "error"); return; }
    const trimName = newName.trim();
    if (!trimName) return;
    await db.people.add({
      name: trimName,
      email: newEmail.trim() || null,
      relationship: (newRelationship as Relationship) || null,
      notes: null,
      commitmentCount: 0,
      lastSeenAt: new Date().toISOString(),
      channels: [],
      createdAt: new Date().toISOString(),
    });
    showToast("Contact added", "success");
    setNewName(""); setNewEmail(""); setNewRelationship("");
    setShowAddForm(false);
  }

  async function handleScan() {
    if (demoMode) { showToast("Scan unavailable in demo mode"); return; }
    setScanning(true);
    try {
      const result = await chrome.runtime.sendMessage({ type: "SCAN_PEOPLE" }) as { ok: boolean; error?: string };
      if (result.ok) {
        showToast("Contacts updated from your commitments", "success");
      } else {
        showToast(result.error ?? "Scan failed", "error");
      }
    } catch {
      showToast("Scan failed — background worker not ready", "error");
    } finally {
      setScanning(false);
    }
  }

  async function handleFollowUp(person: Person) {
    if (demoMode) { showToast("Draft unavailable in demo mode", "info"); return; }
    if (!onNavigateToDraft) return;

    setFollowUpLoading(person.name);
    try {
      const all = await db.commitments
        .where("status").anyOf("new", "actioned")
        .toArray();
      const theirs = all.filter((c) =>
        c.conversation_messages?.some((m) => m.sender.toLowerCase() === person.name.toLowerCase()) ||
        c.context.toLowerCase().includes(person.name.toLowerCase())
      ).sort((a, b) => {
        const u: Record<string, number> = { high: 0, medium: 1, low: 2 };
        return (u[a.urgency] ?? 1) - (u[b.urgency] ?? 1);
      });

      if (theirs.length === 0) {
        showToast(`No open commitments involving ${person.name}`, "info");
        return;
      }

      const primary = theirs[0];
      const additionalCtx = theirs.length > 1
        ? `Other open commitments: ${theirs.slice(1, 4).map((c) => c.text).join("; ")}`
        : null;

      const result = await chrome.runtime.sendMessage({
        type: "GENERATE_DRAFT",
        input: {
          commitmentId: primary.id,
          proposalId: null,
          platform: "slack",
          recipient: person.name,
          subject: null,
          tone: "professional",
          instruction: additionalCtx ?? null,
        },
      }) as { ok: boolean; draftId?: number; error?: string };

      if (result.ok && result.draftId) {
        onNavigateToDraft(result.draftId);
      } else {
        showToast(result.error ?? "Draft generation failed", "error");
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to generate draft", "error");
    } finally {
      setFollowUpLoading(null);
    }
  }

  async function handleMarkDone(id: number) {
    if (demoMode) { showToast("Demo — not saved"); return; }
    if (id == null) return;
    await db.commitments.update(id, { status: "done" });
    await db.action_log.add({ commitmentId: id, action: "done", createdAt: new Date().toISOString() });
  }

  function toggleShowAll(personId: number) {
    setShowAllCommitmentsFor(prev => {
      const next = new Set(prev);
      if (next.has(personId)) {
        next.delete(personId);
      } else {
        next.add(personId);
      }
      return next;
    });
  }

  // ─── Sub-renderers ───

  const inputStyle: React.CSSProperties = {
    padding: "7px 10px",
    fontSize: 13,
    fontFamily: OS.font,
    border: `1px solid ${dk(darkMode, "rgba(255,255,255,0.08)", OS.border)}`,
    borderRadius: 5,
    outline: "none",
    background: dk(darkMode, "rgba(255,255,255,0.06)", OS.white),
    color: dk(darkMode, "rgba(255,255,255,0.90)", OS.text),
  };

  function renderCommitmentRow(c: Commitment, isLast: boolean) {
    const overdue = isOverdue(c);
    const isHovered = hoveredCircleId === c.id;

    const circleStyle: React.CSSProperties = {
      width: 14,
      height: 14,
      borderRadius: "50%",
      border: overdue
        ? "1.5px solid #E24B4A"
        : isHovered
          ? "1.5px solid #7C3AED"
          : `1.5px solid ${dk(darkMode, "rgba(255,255,255,0.20)", "rgba(0,0,0,0.20)")}`,
      background: isHovered ? "rgba(94,106,210,0.10)" : "transparent",
      cursor: "pointer",
      flexShrink: 0,
      transition: "border 0.1s ease, background 0.1s ease",
    };

    const textColor = overdue
      ? dk(darkMode, "#F09595", "#A32D2D")
      : dk(darkMode, "rgba(255,255,255,0.85)", OS.text);

    const dateColor = overdue
      ? dk(darkMode, "#F09595", "#A32D2D")
      : dk(darkMode, "rgba(255,255,255,0.30)", OS.faint);

    return (
      <div
        key={c.id}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          marginLeft: 38,
          paddingRight: 16,
          padding: "4px 16px 4px 0",
          marginBottom: 0,
          borderBottom: isLast ? "none" : `0.5px solid ${dk(darkMode, "rgba(255,255,255,0.06)", "rgba(0,0,0,0.06)")}`,
        }}
      >
        {/* Indent spacer */}
        <div style={{ width: 38, flexShrink: 0 }} />
        {/* Status circle */}
        <div
          style={circleStyle}
          onMouseEnter={() => setHoveredCircleId(c.id ?? null)}
          onMouseLeave={() => setHoveredCircleId(null)}
          onClick={(e) => {
            e.stopPropagation();
            if (c.id != null) handleMarkDone(c.id);
          }}
          title="Mark done"
        />
        {/* Commitment text */}
        <span
          style={{
            fontSize: 12,
            fontWeight: 400,
            color: textColor,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            flex: 1,
            cursor: "pointer",
          }}
          onClick={(e) => {
            e.stopPropagation();
            if (c.id != null) onSelectCommitment?.(c.id);
          }}
          onMouseEnter={(e) => { e.currentTarget.style.textDecoration = "underline"; }}
          onMouseLeave={(e) => { e.currentTarget.style.textDecoration = "none"; }}
          title={c.text}
        >
          {c.text}
        </span>
        {/* Deadline */}
        {c.deadline && (
          <span style={{ fontSize: 11, fontWeight: 400, color: dateColor, flexShrink: 0 }}>
            {formatDeadline(c.deadline)}
          </span>
        )}
      </div>
    );
  }

  function renderPersonRow(pd: PersonData, inAllClear: boolean) {
    const { person, openCommitments, openCount, commitmentCount } = pd;
    const isExpanded = expandedId === person.id;
    const showAll = person.id != null && showAllCommitmentsFor.has(person.id);
    const displayedCommitments = showAll ? openCommitments : openCommitments.slice(0, 3);
    const hasMore = openCommitments.length > 3 && !showAll;
    const extraCount = openCommitments.length - 3;

    return (
      <div key={person.id ?? person.name}>
        {/* Person header row */}
        <div
          onClick={() => handleExpand(person)}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = dk(darkMode, "rgba(255,255,255,0.04)", "rgba(0,0,0,0.02)");
            if (inAllClear) e.currentTarget.style.opacity = "0.7";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            if (inAllClear) e.currentTarget.style.opacity = "1";
          }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "8px 16px",
            cursor: "pointer",
            borderRadius: 6,
            background: isExpanded ? dk(darkMode, "rgba(255,255,255,0.04)", "rgba(0,0,0,0.02)") : "transparent",
            transition: "background 0.1s ease",
          }}
        >
          {/* Avatar */}
          <div style={{
            width: 22,
            height: 22,
            borderRadius: "50%",
            background: dk(darkMode, "rgba(255,255,255,0.06)", OS.bg),
            border: `1px solid ${dk(darkMode, "rgba(255,255,255,0.10)", OS.border)}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 11,
            fontWeight: 500,
            color: dk(darkMode, "rgba(255,255,255,0.55)", OS.secondary),
            flexShrink: 0,
          }}>
            {person.name.charAt(0).toUpperCase()}
          </div>

          {/* Name */}
          <span style={{
            fontSize: 13,
            fontWeight: 500,
            color: dk(darkMode, "rgba(255,255,255,0.90)", OS.text),
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}>
            {person.name}
          </span>

          {/* Badge */}
          {openCount > 0 ? (
            <span style={{
              fontSize: 11,
              fontWeight: 500,
              padding: "1px 7px",
              borderRadius: 999,
              background: dk(darkMode, "#501313", "#FCEBEB"),
              color: dk(darkMode, "#F7C1C1", "#A32D2D"),
              flexShrink: 0,
            }}>
              {openCount}
            </span>
          ) : commitmentCount > 0 ? (
            <span style={{
              fontSize: 11,
              fontWeight: 500,
              padding: "1px 7px",
              borderRadius: 999,
              background: dk(darkMode, "rgba(255,255,255,0.08)", OS.border),
              color: dk(darkMode, "rgba(255,255,255,0.35)", OS.muted),
              flexShrink: 0,
            }}>
              {commitmentCount}
            </span>
          ) : null}
        </div>

        {/* Commitment rows (only shown for needs-attention section, not all-clear) */}
        {!inAllClear && openCount > 0 && (
          <div>
            {displayedCommitments.map((c, i) =>
              renderCommitmentRow(c, i === displayedCommitments.length - 1 && !hasMore)
            )}
            {hasMore && (
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  if (person.id != null) toggleShowAll(person.id);
                }}
                style={{
                  marginLeft: 38 + 38 + 7 + 14 + 7, // align with text
                  padding: "3px 0",
                  fontSize: 11.5,
                  color: OS.blue,
                  cursor: "pointer",
                }}
              >
                + {extraCount} more
              </div>
            )}
          </div>
        )}

        {/* Expanded detail panel */}
        {isExpanded && (
          <div
            style={{ marginLeft: 38, paddingBottom: 12, paddingRight: 16 }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Context insights row */}
            {(() => {
              const ctx = person.id != null ? liveContextMap.get(person.id) : undefined;
              if (!ctx) return null;
              const completionColor = ctx.completionRate >= 0.70
                ? dk(darkMode, "#4ADE80", "#16A34A")
                : ctx.completionRate >= 0.40
                  ? dk(darkMode, "rgba(255,255,255,0.55)", OS.secondary)
                  : dk(darkMode, "#FBBF24", "#D97706");
              const overdueColor = ctx.overdueRate > 0.20
                ? dk(darkMode, "#FBBF24", "#D97706")
                : dk(darkMode, "rgba(255,255,255,0.55)", OS.secondary);
              return (
                <div style={{ marginBottom: 10, marginTop: 4 }}>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                    <span style={{
                      fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 999,
                      background: dk(darkMode, "rgba(255,255,255,0.06)", OS.bg),
                      border: `0.5px solid ${dk(darkMode, "rgba(255,255,255,0.10)", OS.border)}`,
                      color: completionColor,
                    }}>
                      Completion {Math.round(ctx.completionRate * 100)}%
                    </span>
                    {ctx.avgResponseDays != null && (
                      <span style={{
                        fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 999,
                        background: dk(darkMode, "rgba(255,255,255,0.06)", OS.bg),
                        border: `0.5px solid ${dk(darkMode, "rgba(255,255,255,0.10)", OS.border)}`,
                        color: dk(darkMode, "rgba(255,255,255,0.55)", OS.secondary),
                      }}>
                        Response ~{ctx.avgResponseDays}d
                      </span>
                    )}
                    <span style={{
                      fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 999,
                      background: dk(darkMode, "rgba(255,255,255,0.06)", OS.bg),
                      border: `0.5px solid ${dk(darkMode, "rgba(255,255,255,0.10)", OS.border)}`,
                      color: overdueColor,
                    }}>
                      Overdue {Math.round(ctx.overdueRate * 100)}%
                    </span>
                  </div>
                  {ctx.topChannels.length > 0 && (
                    <div style={{
                      fontSize: 11,
                      color: dk(darkMode, "rgba(255,255,255,0.35)", OS.muted),
                      marginTop: 2,
                    }}>
                      Active in: {ctx.topChannels.join(", ")}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Relationship select */}
            <div style={{ marginBottom: 8, marginTop: 6 }}>
              <label style={{
                fontSize: 11,
                fontWeight: 500,
                color: dk(darkMode, "rgba(255,255,255,0.35)", OS.secondary),
                display: "block",
                marginBottom: 4,
              }}>
                Relationship
              </label>
              <select
                value={editRelationship ?? ""}
                onChange={(e) => setEditRelationship(e.target.value || null)}
                style={{ width: "100%", padding: "6px 8px", fontSize: 12, fontFamily: OS.font, border: `1px solid ${dk(darkMode, "rgba(255,255,255,0.08)", OS.border)}`, borderRadius: 5, background: dk(darkMode, "rgba(255,255,255,0.06)", OS.white), color: dk(darkMode, "rgba(255,255,255,0.90)", OS.text), cursor: "pointer" }}
              >
                <option value="">None</option>
                {RELATIONSHIPS.map((r) => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
              </select>
            </div>

            {/* Notes textarea */}
            <div style={{ marginBottom: 10 }}>
              <label style={{
                fontSize: 11,
                fontWeight: 500,
                color: dk(darkMode, "rgba(255,255,255,0.35)", OS.secondary),
                display: "block",
                marginBottom: 4,
              }}>
                Notes
              </label>
              <textarea
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                placeholder="Add notes about this person..."
                rows={3}
                style={{ width: "100%", padding: "6px 8px", fontSize: 12, fontFamily: OS.font, border: `1px solid ${dk(darkMode, "rgba(255,255,255,0.08)", OS.border)}`, borderRadius: 5, background: dk(darkMode, "rgba(255,255,255,0.06)", OS.white), color: dk(darkMode, "rgba(255,255,255,0.90)", OS.text), resize: "vertical", outline: "none", boxSizing: "border-box" }}
              />
            </div>

            {/* Action buttons */}
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button
                onClick={() => handleSave(person)}
                style={{
                  padding: "6px 14px",
                  fontSize: 12,
                  fontWeight: 500,
                  fontFamily: OS.font,
                  background: dk(darkMode, "rgba(94,106,210,0.18)", OS.blueBg),
                  color: OS.blue,
                  border: `0.5px solid ${dk(darkMode, "rgba(94,106,210,0.30)", OS.blue)}`,
                  borderRadius: 999,
                  cursor: "pointer",
                }}
              >
                Save
              </button>
              {onNavigateToDraft && (
                <button
                  onClick={() => handleFollowUp(person)}
                  disabled={followUpLoading === person.name}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                    padding: "6px 12px",
                    fontSize: 12,
                    fontWeight: 500,
                    fontFamily: OS.font,
                    border: `0.5px solid ${dk(darkMode, "rgba(255,255,255,0.10)", "rgba(0,0,0,0.12)")}`,
                    borderRadius: 999,
                    background: "transparent",
                    color: dk(darkMode, "rgba(255,255,255,0.55)", OS.secondary),
                    cursor: followUpLoading === person.name ? "default" : "pointer",
                    opacity: followUpLoading === person.name ? 0.6 : 1,
                  }}
                >
                  {followUpLoading === person.name ? "Drafting…" : "✉ Draft Follow-Up"}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  const sectionLabelStyle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 500,
    color: dk(darkMode, "rgba(255,255,255,0.35)", OS.muted),
    padding: "12px 16px 6px",
  };

  return (
    <div style={{ fontFamily: OS.font, background: dk(darkMode, "#111113", OS.white) }}>
      {/* Spin animation keyframes */}
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

      {/* Top bar */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "10px 16px",
        borderBottom: `1px solid ${dk(darkMode, "rgba(255,255,255,0.08)", OS.border)}`,
        background: dk(darkMode, "#111113", OS.white),
      }}>
        {/* Search pill */}
        <input
          type="text"
          placeholder="Search contacts…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            flex: 1,
            borderRadius: 999,
            border: `0.5px solid ${dk(darkMode, "rgba(255,255,255,0.10)", "rgba(0,0,0,0.08)")}`,
            padding: "7px 12px",
            fontSize: 12,
            fontFamily: OS.font,
            color: dk(darkMode, "rgba(255,255,255,0.85)", OS.text),
            background: dk(darkMode, "rgba(255,255,255,0.06)", OS.white),
            outline: "none",
          }}
        />

        {/* Scan button */}
        <button
          onClick={handleScan}
          disabled={scanning}
          title="Re-scan all commitments to update contacts"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            padding: "6px 11px",
            fontSize: 12,
            fontWeight: 500,
            fontFamily: OS.font,
            border: `0.5px solid ${dk(darkMode, "rgba(255,255,255,0.10)", "rgba(0,0,0,0.12)")}`,
            borderRadius: 999,
            background: "transparent",
            color: scanning ? dk(darkMode, "rgba(255,255,255,0.35)", OS.muted) : dk(darkMode, "rgba(255,255,255,0.55)", OS.secondary),
            cursor: scanning ? "default" : "pointer",
            opacity: scanning ? 0.7 : 1,
            whiteSpace: "nowrap",
          }}
        >
          <IconRefresh spinning={scanning} />
          {scanning ? "Scanning…" : "Scan"}
        </button>

        {/* Add button */}
        <button
          onClick={() => setShowAddForm((v) => !v)}
          style={{
            padding: "6px 11px",
            fontSize: 12,
            fontWeight: 500,
            fontFamily: OS.font,
            background: dk(darkMode, "rgba(94,106,210,0.18)", OS.blueBg),
            color: OS.blue,
            border: `0.5px solid ${dk(darkMode, "rgba(94,106,210,0.30)", OS.blue)}`,
            borderRadius: 999,
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          {showAddForm ? "Cancel" : "+ Add"}
        </button>
      </div>

      {/* Add person form */}
      {showAddForm && (
        <div style={{
          padding: "12px 16px",
          borderBottom: `1px solid ${dk(darkMode, "rgba(255,255,255,0.08)", OS.border)}`,
          background: dk(darkMode, "rgba(255,255,255,0.04)", OS.bg),
        }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <input
              type="text" placeholder="Name" value={newName}
              onChange={(e) => setNewName(e.target.value)}
              style={inputStyle}
            />
            <input
              type="email" placeholder="Email (optional)" value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              style={inputStyle}
            />
            <select
              value={newRelationship}
              onChange={(e) => setNewRelationship(e.target.value as Relationship | "")}
              style={{ ...inputStyle, cursor: "pointer" }}
            >
              <option value="">Relationship (optional)</option>
              {RELATIONSHIPS.map((r) => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
            </select>
            <button
              onClick={handleAdd}
              disabled={!newName.trim()}
              style={{
                padding: "7px 14px",
                fontSize: 12,
                fontWeight: 500,
                fontFamily: OS.font,
                background: newName.trim() ? dk(darkMode, "rgba(94,106,210,0.18)", OS.blueBg) : dk(darkMode, "rgba(255,255,255,0.06)", OS.faint),
                color: newName.trim() ? OS.blue : dk(darkMode, "rgba(255,255,255,0.20)", OS.white),
                border: newName.trim() ? `0.5px solid ${dk(darkMode, "rgba(94,106,210,0.30)", OS.blue)}` : "none",
                borderRadius: 999,
                cursor: newName.trim() ? "pointer" : "not-allowed",
                alignSelf: "flex-start",
              }}
            >
              Add Contact
            </button>
          </div>
        </div>
      )}

      {/* Empty state */}
      {filtered.length === 0 && (
        <div style={{ padding: "40px 24px", textAlign: "center" }}>
          {search ? (
            <div style={{ color: dk(darkMode, "rgba(255,255,255,0.30)", OS.muted), fontSize: 14 }}>
              No contacts match "{search}"
            </div>
          ) : (
            <>
              <div style={{ fontSize: 28, marginBottom: 10, opacity: 0.4 }}>👥</div>
              <div style={{ fontSize: 14, fontWeight: 500, color: dk(darkMode, "rgba(255,255,255,0.90)", OS.text), marginBottom: 6 }}>
                No contacts yet
              </div>
              <div style={{ fontSize: 13, color: dk(darkMode, "rgba(255,255,255,0.55)", OS.secondary), lineHeight: 1.6, maxWidth: 280, margin: "0 auto 16px" }}>
                Clyde builds this list automatically from senders in your Slack conversations and meeting attendees.
                Click <strong>Scan</strong> to build from your existing commitments.
              </div>
              <button
                onClick={handleScan}
                disabled={scanning}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "8px 16px",
                  fontSize: 13,
                  fontWeight: 500,
                  fontFamily: OS.font,
                  background: dk(darkMode, "rgba(94,106,210,0.18)", OS.blueBg),
                  color: OS.blue,
                  border: `0.5px solid ${dk(darkMode, "rgba(94,106,210,0.30)", OS.blue)}`,
                  borderRadius: 999,
                  cursor: scanning ? "default" : "pointer",
                  opacity: scanning ? 0.7 : 1,
                }}
              >
                <IconRefresh spinning={scanning} />
                {scanning ? "Scanning…" : "Scan Contacts"}
              </button>
            </>
          )}
        </div>
      )}

      {/* People list */}
      {filtered.length > 0 && (
        <div>
          {/* Needs attention section */}
          {needsAttention.length > 0 && (
            <div>
              <div style={sectionLabelStyle}>Needs attention</div>
              {needsAttention.map(pd => renderPersonRow(pd, false))}
            </div>
          )}

          {/* All clear section */}
          {allClear.length > 0 && (
            <div style={{ opacity: 0.45 }}>
              <div style={{
                ...sectionLabelStyle,
                borderTop: needsAttention.length > 0
                  ? `0.5px solid ${dk(darkMode, "rgba(255,255,255,0.08)", OS.border)}`
                  : "none",
                marginTop: needsAttention.length > 0 ? 4 : 0,
              }}>
                All clear
              </div>
              {allClear.map(pd => renderPersonRow(pd, true))}
            </div>
          )}

          {/* People with no commitments at all (in search results) */}
          {filtered.filter(d => d.commitmentCount === 0).length > 0 && (
            <div>
              {filtered.filter(d => d.commitmentCount === 0).map(pd => renderPersonRow(pd, false))}
            </div>
          )}
        </div>
      )}

      {/* Footer count */}
      {filtered.length > 0 && (
        <div style={{ padding: "10px 16px", fontSize: 11, color: dk(darkMode, "rgba(255,255,255,0.35)", OS.muted), borderTop: `1px solid ${dk(darkMode, "rgba(255,255,255,0.08)", OS.border)}` }}>
          {filtered.length} contact{filtered.length !== 1 ? "s" : ""}
          {!search && " · sorted by open commitments"}
        </div>
      )}
    </div>
  );
}
