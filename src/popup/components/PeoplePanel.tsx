import React, { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { OS } from "@shared/tokens";
import { db } from "@shared/db";
import type { Person } from "@shared/types";
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
  manager: { bg: OS.blue + "18", text: OS.blue },
  report: { bg: OS.green + "18", text: OS.green },
  peer: { bg: "#7C3AED18", text: "#7C3AED" },
  stakeholder: { bg: OS.warning + "18", text: OS.warning },
  external: { bg: OS.faint + "18", text: OS.secondary },
};

type Relationship = "manager" | "report" | "peer" | "stakeholder" | "external";
const RELATIONSHIPS: Relationship[] = ["manager", "report", "peer", "stakeholder", "external"];

// ─── Component ───

interface PeoplePanelProps {
  demoMode: boolean;
  showToast: (msg: string, variant?: "success" | "error") => void;
}

export function PeoplePanel({ demoMode, showToast }: PeoplePanelProps) {
  const livePeople = useLiveQuery(
    () => db.people.orderBy("commitmentCount").reverse().toArray(),
    [],
  );
  const people: Person[] = demoMode ? DEMO_PEOPLE : (livePeople ?? []);

  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [editRelationship, setEditRelationship] = useState<string | null>(null);
  const [editNotes, setEditNotes] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newRelationship, setNewRelationship] = useState<Relationship | "">("");

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
    } else {
      setExpandedId(person.id ?? null);
      setEditRelationship(person.relationship);
      setEditNotes(person.notes ?? "");
    }
  }

  async function handleSave(person: Person) {
    if (demoMode) {
      showToast("Demo mode — changes not saved", "error");
      return;
    }
    if (person.id == null) return;
    await db.people.update(person.id, {
      relationship: (editRelationship as Relationship) || null,
      notes: editNotes || null,
    });
    showToast("Contact updated", "success");
    setExpandedId(null);
  }

  async function handleAdd() {
    if (demoMode) {
      showToast("Demo mode — changes not saved", "error");
      return;
    }
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
    setNewName("");
    setNewEmail("");
    setNewRelationship("");
    setShowAddForm(false);
  }

  return (
    <div style={{ fontFamily: OS.font, padding: "16px 20px" }}>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <input
          type="text"
          placeholder="Search contacts..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            flex: 1,
            padding: "8px 12px",
            fontSize: 13,
            fontFamily: OS.font,
            border: `1px solid ${OS.border}`,
            borderRadius: 6,
            outline: "none",
            background: OS.white,
            color: OS.text,
          }}
        />
        <button
          onClick={() => setShowAddForm((v) => !v)}
          style={{
            padding: "7px 14px",
            fontSize: 12,
            fontWeight: 600,
            fontFamily: OS.font,
            border: "none",
            borderRadius: 6,
            background: OS.blue,
            color: OS.white,
            cursor: "pointer",
          }}
        >
          {showAddForm ? "Cancel" : "+ Add"}
        </button>
      </div>

      {/* Add person inline form */}
      {showAddForm && (
        <div
          style={{
            padding: "12px 14px",
            marginBottom: 12,
            border: `1px solid ${OS.border}`,
            borderRadius: 8,
            background: OS.bg,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <input
              type="text"
              placeholder="Name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              style={{
                padding: "7px 10px",
                fontSize: 13,
                fontFamily: OS.font,
                border: `1px solid ${OS.border}`,
                borderRadius: 5,
                outline: "none",
                background: OS.white,
                color: OS.text,
              }}
            />
            <input
              type="email"
              placeholder="Email (optional)"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              style={{
                padding: "7px 10px",
                fontSize: 13,
                fontFamily: OS.font,
                border: `1px solid ${OS.border}`,
                borderRadius: 5,
                outline: "none",
                background: OS.white,
                color: OS.text,
              }}
            />
            <select
              value={newRelationship}
              onChange={(e) => setNewRelationship(e.target.value as Relationship | "")}
              style={{
                padding: "7px 10px",
                fontSize: 13,
                fontFamily: OS.font,
                border: `1px solid ${OS.border}`,
                borderRadius: 5,
                background: OS.white,
                color: OS.text,
                cursor: "pointer",
              }}
            >
              <option value="">Relationship (optional)</option>
              {RELATIONSHIPS.map((r) => (
                <option key={r} value={r}>
                  {r.charAt(0).toUpperCase() + r.slice(1)}
                </option>
              ))}
            </select>
            <button
              onClick={handleAdd}
              disabled={!newName.trim()}
              style={{
                padding: "7px 14px",
                fontSize: 12,
                fontWeight: 600,
                fontFamily: OS.font,
                border: "none",
                borderRadius: 6,
                background: newName.trim() ? OS.blue : OS.faint,
                color: OS.white,
                cursor: newName.trim() ? "pointer" : "not-allowed",
                alignSelf: "flex-start",
              }}
            >
              Add Contact
            </button>
          </div>
        </div>
      )}

      {/* People list */}
      {filtered.length === 0 && (
        <div
          style={{
            padding: "40px 24px",
            textAlign: "center",
            color: OS.muted,
            fontSize: 14,
          }}
        >
          {search ? "No contacts match your search." : "No contacts yet. They'll appear as Clyde detects people in your conversations."}
        </div>
      )}

      {filtered.map((person) => {
        const isExpanded = expandedId === person.id;
        const relColor = person.relationship ? RELATIONSHIP_COLORS[person.relationship] : null;

        return (
          <div
            key={person.id ?? person.name}
            onClick={() => handleExpand(person)}
            style={{
              padding: "12px 14px",
              borderBottom: `1px solid ${OS.border}`,
              cursor: "pointer",
              background: isExpanded ? OS.bg : OS.white,
              transition: "background 0.1s ease",
            }}
          >
            {/* Main row */}
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {/* Avatar circle */}
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  background: OS.bg,
                  border: `1px solid ${OS.border}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 13,
                  fontWeight: 600,
                  color: OS.secondary,
                  flexShrink: 0,
                }}
              >
                {person.name.charAt(0).toUpperCase()}
              </div>

              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      color: OS.text,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {person.name}
                  </span>
                  {relColor && person.relationship && (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        padding: "1px 6px",
                        borderRadius: 3,
                        background: relColor.bg,
                        color: relColor.text,
                        lineHeight: 1.6,
                        whiteSpace: "nowrap",
                        flexShrink: 0,
                      }}
                    >
                      {person.relationship}
                    </span>
                  )}
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginTop: 2,
                    fontSize: 12,
                    color: OS.muted,
                  }}
                >
                  {person.email && (
                    <span
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        maxWidth: 180,
                      }}
                    >
                      {person.email}
                    </span>
                  )}
                  {person.email && <span style={{ color: OS.faint }}>&middot;</span>}
                  <span>{relativeTime(person.lastSeenAt)}</span>
                  <span style={{ color: OS.faint }}>&middot;</span>
                  <span>
                    {person.commitmentCount} commitment{person.commitmentCount !== 1 ? "s" : ""}
                  </span>
                </div>
              </div>
            </div>

            {/* Expanded edit section */}
            {isExpanded && (
              <div
                style={{ marginTop: 12, marginLeft: 42 }}
                onClick={(e) => e.stopPropagation()}
              >
                <div style={{ marginBottom: 8 }}>
                  <label
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: OS.muted,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      display: "block",
                      marginBottom: 4,
                    }}
                  >
                    Relationship
                  </label>
                  <select
                    value={editRelationship ?? ""}
                    onChange={(e) => setEditRelationship(e.target.value || null)}
                    style={{
                      width: "100%",
                      padding: "6px 8px",
                      fontSize: 12,
                      fontFamily: OS.font,
                      border: `1px solid ${OS.border}`,
                      borderRadius: 5,
                      background: OS.white,
                      color: OS.text,
                      cursor: "pointer",
                    }}
                  >
                    <option value="">None</option>
                    {RELATIONSHIPS.map((r) => (
                      <option key={r} value={r}>
                        {r.charAt(0).toUpperCase() + r.slice(1)}
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{ marginBottom: 10 }}>
                  <label
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: OS.muted,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      display: "block",
                      marginBottom: 4,
                    }}
                  >
                    Notes
                  </label>
                  <textarea
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    placeholder="Add notes about this person..."
                    rows={3}
                    style={{
                      width: "100%",
                      padding: "6px 8px",
                      fontSize: 12,
                      fontFamily: OS.font,
                      border: `1px solid ${OS.border}`,
                      borderRadius: 5,
                      background: OS.white,
                      color: OS.text,
                      resize: "vertical",
                      outline: "none",
                      boxSizing: "border-box",
                    }}
                  />
                </div>

                <button
                  onClick={() => handleSave(person)}
                  style={{
                    padding: "6px 14px",
                    fontSize: 12,
                    fontWeight: 600,
                    fontFamily: OS.font,
                    border: "none",
                    borderRadius: 5,
                    background: OS.blue,
                    color: OS.white,
                    cursor: "pointer",
                  }}
                >
                  Save
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
