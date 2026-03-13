import React, { useState, useEffect } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { OS } from "@shared/tokens";
import { db } from "@shared/db";
import type { Person, Commitment } from "@shared/types";
import { DEMO_PEOPLE } from "@shared/demo-data";

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

// ─── Component ───

interface PeoplePanelProps {
  demoMode: boolean;
  showToast: (msg: string, variant?: "success" | "error" | "info" | "warning") => void;
  onViewCommitments?: (name: string) => void;
}

export function PeoplePanel({ demoMode, showToast, onViewCommitments }: PeoplePanelProps) {
  const livePeople = useLiveQuery(
    () => db.people.orderBy("commitmentCount").reverse().toArray(),
    [],
  );

  // Load user name to filter self out of display
  const [selfName, setSelfName] = useState("");
  useEffect(() => {
    chrome.storage.local.get("userName").then((r) => {
      setSelfName(((r.userName as string) || "").toLowerCase());
    });
  }, []);

  // Count open (non-done, non-dismissed) commitments per person
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
  // Filter out the current user and obvious bots from display
  const BOT_DISPLAY_PATTERN = /^(slackbot|workflow|github|linear|jira|figma|notion|zapier|app|integration|automation|bot|alert|notification|webhook|deploy|ci|cd|jenkins|travis|circleci|datadog|pagerduty|sentry|slack app)/i;
  const people: Person[] = demoMode
    ? rawPeople
    : rawPeople.filter((p) =>
        (!selfName || p.name.toLowerCase() !== selfName) &&
        !BOT_DISPLAY_PATTERN.test(p.name)
      );

  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [editRelationship, setEditRelationship] = useState<string | null>(null);
  const [editNotes, setEditNotes] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newRelationship, setNewRelationship] = useState<Relationship | "">("");
  const [scanning, setScanning] = useState(false);
  const [expandedCommitments, setExpandedCommitments] = useState<Commitment[]>([]);

  // Auto-backfill on first open if people table is empty (real mode only)
  useEffect(() => {
    if (demoMode || livePeople === undefined) return;
    if (livePeople.length === 0) {
      chrome.runtime.sendMessage({ type: "SCAN_PEOPLE" }).catch(() => {});
    }
  }, [demoMode, livePeople]);

  const filtered = search
    ? people.filter(
        (p) =>
          p.name.toLowerCase().includes(search.toLowerCase()) ||
          (p.email && p.email.toLowerCase().includes(search.toLowerCase())),
      )
    : people;

  function handleExpand(person: Person) {
    if (expandedId === person.id) {
      setExpandedId(null);
      setExpandedCommitments([]);
    } else {
      setExpandedId(person.id ?? null);
      setEditRelationship(person.relationship);
      setEditNotes(person.notes ?? "");
      // Load this person's commitments
      if (person.id != null && !demoMode) {
        db.commitments.toArray().then((all) => {
          const theirs = all.filter((c) =>
            c.conversation_messages?.some(
              (m) => m.sender.toLowerCase() === person.name.toLowerCase(),
            ) || c.context.toLowerCase().includes(person.name.toLowerCase()),
          ).slice(0, 5);
          setExpandedCommitments(theirs);
        });
      }
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

  return (
    <div style={{ fontFamily: OS.font }}>
      {/* Spin animation keyframes */}
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

      {/* Header */}
      <div style={{
        padding: "14px 20px 12px",
        borderBottom: `1px solid ${OS.border}`,
        background: OS.white,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: OS.text, letterSpacing: "-0.02em" }}>
              People
            </div>
            <div style={{ fontSize: 12, color: OS.secondary, marginTop: 1 }}>
              Contacts Clyde has seen in your Slack conversations and meetings
            </div>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
            <button
              onClick={handleScan}
              disabled={scanning}
              title="Re-scan all commitments to update contacts"
              style={{
                display: "flex", alignItems: "center", gap: 5,
                padding: "6px 12px",
                fontSize: 12, fontWeight: 500, fontFamily: OS.font,
                border: `1px solid ${OS.border}`,
                borderRadius: 6,
                background: OS.bg,
                color: scanning ? OS.muted : OS.text,
                cursor: scanning ? "default" : "pointer",
                opacity: scanning ? 0.7 : 1,
              }}
            >
              <IconRefresh spinning={scanning} />
              {scanning ? "Scanning…" : "Scan"}
            </button>
            <button
              onClick={() => setShowAddForm((v) => !v)}
              style={{
                padding: "6px 12px",
                fontSize: 12, fontWeight: 600, fontFamily: OS.font,
                border: "none", borderRadius: 6,
                background: OS.blue, color: OS.white,
                cursor: "pointer",
              }}
            >
              {showAddForm ? "Cancel" : "+ Add"}
            </button>
          </div>
        </div>

        {/* Search */}
        <input
          type="text"
          placeholder="Search contacts…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            width: "100%",
            padding: "7px 12px",
            fontSize: 13, fontFamily: OS.font,
            border: `1px solid ${OS.border}`,
            borderRadius: 6, outline: "none",
            background: OS.white, color: OS.text,
            boxSizing: "border-box",
          }}
        />
      </div>

      {/* Add person form */}
      {showAddForm && (
        <div style={{
          padding: "12px 20px",
          borderBottom: `1px solid ${OS.border}`,
          background: OS.bg,
        }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <input
              type="text" placeholder="Name" value={newName}
              onChange={(e) => setNewName(e.target.value)}
              style={{ padding: "7px 10px", fontSize: 13, fontFamily: OS.font, border: `1px solid ${OS.border}`, borderRadius: 5, outline: "none", background: OS.white, color: OS.text }}
            />
            <input
              type="email" placeholder="Email (optional)" value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              style={{ padding: "7px 10px", fontSize: 13, fontFamily: OS.font, border: `1px solid ${OS.border}`, borderRadius: 5, outline: "none", background: OS.white, color: OS.text }}
            />
            <select
              value={newRelationship} onChange={(e) => setNewRelationship(e.target.value as Relationship | "")}
              style={{ padding: "7px 10px", fontSize: 13, fontFamily: OS.font, border: `1px solid ${OS.border}`, borderRadius: 5, background: OS.white, color: OS.text, cursor: "pointer" }}
            >
              <option value="">Relationship (optional)</option>
              {RELATIONSHIPS.map((r) => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
            </select>
            <button
              onClick={handleAdd} disabled={!newName.trim()}
              style={{
                padding: "7px 14px", fontSize: 12, fontWeight: 600, fontFamily: OS.font,
                border: "none", borderRadius: 6,
                background: newName.trim() ? OS.blue : OS.faint, color: OS.white,
                cursor: newName.trim() ? "pointer" : "not-allowed", alignSelf: "flex-start",
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
            <div style={{ color: OS.muted, fontSize: 14 }}>No contacts match "{search}"</div>
          ) : (
            <>
              <div style={{ fontSize: 28, marginBottom: 10, opacity: 0.4 }}>👥</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: OS.text, marginBottom: 6 }}>
                No contacts yet
              </div>
              <div style={{ fontSize: 13, color: OS.secondary, lineHeight: 1.6, maxWidth: 280, margin: "0 auto 16px" }}>
                Clyde builds this list automatically from senders in your Slack conversations and meeting attendees.
                Click <strong>Scan</strong> to build from your existing commitments.
              </div>
              <button
                onClick={handleScan} disabled={scanning}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  padding: "8px 16px", fontSize: 13, fontWeight: 600, fontFamily: OS.font,
                  border: "none", borderRadius: 6, background: OS.blue, color: OS.white,
                  cursor: scanning ? "default" : "pointer", opacity: scanning ? 0.7 : 1,
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
      <div>
        {filtered.map((person) => {
          const isExpanded = expandedId === person.id;
          const relColor = person.relationship ? RELATIONSHIP_COLORS[person.relationship] : null;

          return (
            <div
              key={person.id ?? person.name}
              onClick={() => handleExpand(person)}
              style={{
                padding: "12px 20px",
                borderBottom: `1px solid ${OS.border}`,
                cursor: "pointer",
                background: isExpanded ? OS.bg : OS.white,
                transition: "background 0.1s ease",
              }}
            >
              {/* Main row */}
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {/* Avatar */}
                <div style={{
                  width: 32, height: 32, borderRadius: 16,
                  background: OS.bg, border: `1px solid ${OS.border}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 13, fontWeight: 600, color: OS.secondary, flexShrink: 0,
                }}>
                  {person.name.charAt(0).toUpperCase()}
                </div>

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: OS.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {person.name}
                    </span>
                    {relColor && person.relationship && (
                      <span style={{
                        fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 3,
                        background: relColor.bg, color: relColor.text, lineHeight: 1.6, whiteSpace: "nowrap", flexShrink: 0,
                      }}>
                        {person.relationship}
                      </span>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2, fontSize: 12, color: OS.muted }}>
                    {person.email && (
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 180 }}>
                        {person.email}
                      </span>
                    )}
                    {person.email && <span style={{ color: OS.faint }}>&middot;</span>}
                    <span>{relativeTime(person.lastSeenAt)}</span>
                    {person.commitmentCount > 0 && (
                      <>
                        <span style={{ color: OS.faint }}>&middot;</span>
                        {(() => {
                          const openCount = openCommitmentMap.get(person.name.toLowerCase()) ?? 0;
                          return (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (onViewCommitments) onViewCommitments(person.name);
                              }}
                              style={{
                                background: "none", border: "none", padding: 0,
                                cursor: onViewCommitments ? "pointer" : "default",
                                color: openCount > 0 ? OS.blue : OS.muted,
                                fontSize: 12, fontFamily: OS.font, fontWeight: openCount > 0 ? 600 : 400,
                                textDecoration: onViewCommitments ? "underline" : "none",
                              }}
                              title={onViewCommitments ? "View in commitments list" : undefined}
                            >
                              {openCount > 0 ? `${openCount} open` : `${person.commitmentCount} done`}
                            </button>
                          );
                        })()}
                      </>
                    )}
                    {person.channels.length > 0 && (
                      <>
                        <span style={{ color: OS.faint }}>&middot;</span>
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 120 }}>
                          {person.channels.slice(0, 2).join(", ")}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Expanded section */}
              {isExpanded && (
                <div style={{ marginTop: 12, marginLeft: 42 }} onClick={(e) => e.stopPropagation()}>
                  {/* Related commitments */}
                  {expandedCommitments.length > 0 && (
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: OS.muted, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
                        Recent Commitments
                      </div>
                      {expandedCommitments.map((c) => (
                        <div key={c.id} style={{
                          padding: "5px 8px", marginBottom: 4,
                          background: OS.white, border: `1px solid ${OS.border}`,
                          borderRadius: 5, fontSize: 12, color: OS.text, lineHeight: 1.4,
                        }}>
                          <span style={{ color: c.urgency === "high" ? OS.red : c.urgency === "medium" ? OS.warning : OS.muted, marginRight: 4, fontWeight: 600 }}>
                            {c.urgency === "high" ? "!" : "·"}
                          </span>
                          {c.text}
                          <span style={{ color: OS.muted, marginLeft: 6, fontSize: 11 }}>{c.context}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Edit relationship */}
                  <div style={{ marginBottom: 8 }}>
                    <label style={{ fontSize: 11, fontWeight: 600, color: OS.muted, textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 4 }}>
                      Relationship
                    </label>
                    <select
                      value={editRelationship ?? ""}
                      onChange={(e) => setEditRelationship(e.target.value || null)}
                      style={{ width: "100%", padding: "6px 8px", fontSize: 12, fontFamily: OS.font, border: `1px solid ${OS.border}`, borderRadius: 5, background: OS.white, color: OS.text, cursor: "pointer" }}
                    >
                      <option value="">None</option>
                      {RELATIONSHIPS.map((r) => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
                    </select>
                  </div>

                  {/* Edit notes */}
                  <div style={{ marginBottom: 10 }}>
                    <label style={{ fontSize: 11, fontWeight: 600, color: OS.muted, textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 4 }}>
                      Notes
                    </label>
                    <textarea
                      value={editNotes}
                      onChange={(e) => setEditNotes(e.target.value)}
                      placeholder="Add notes about this person..."
                      rows={3}
                      style={{ width: "100%", padding: "6px 8px", fontSize: 12, fontFamily: OS.font, border: `1px solid ${OS.border}`, borderRadius: 5, background: OS.white, color: OS.text, resize: "vertical", outline: "none", boxSizing: "border-box" }}
                    />
                  </div>

                  <button
                    onClick={() => handleSave(person)}
                    style={{ padding: "6px 14px", fontSize: 12, fontWeight: 600, fontFamily: OS.font, border: "none", borderRadius: 5, background: OS.blue, color: OS.white, cursor: "pointer" }}
                  >
                    Save
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer count */}
      {filtered.length > 0 && (
        <div style={{ padding: "10px 20px", fontSize: 11, color: OS.muted, borderTop: `1px solid ${OS.border}` }}>
          {filtered.length} contact{filtered.length !== 1 ? "s" : ""}
          {!search && " · sorted by most commitments"}
        </div>
      )}
    </div>
  );
}
