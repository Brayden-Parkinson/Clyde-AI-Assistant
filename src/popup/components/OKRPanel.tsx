import React, { useState, useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { OS } from "@shared/tokens";
import { db } from "@shared/db";
import type { OKR, KeyResult, CommitmentOKRLink, Commitment } from "@shared/types";
import { IconCheck, IconX, IconChevronDown, IconChevronUp } from "./Icons";

interface OKRPanelProps {
  demoMode: boolean;
  demoOKRs?: OKR[];
  demoLinks?: CommitmentOKRLink[];
}

// ─── Quarter helpers ───

function getCurrentQuarter(): string {
  const now = new Date();
  const q = Math.ceil((now.getMonth() + 1) / 3);
  return `${now.getFullYear()}-Q${q}`;
}

function getNextQuarter(): string {
  const now = new Date();
  const q = Math.ceil((now.getMonth() + 1) / 3);
  if (q === 4) return `${now.getFullYear() + 1}-Q1`;
  return `${now.getFullYear()}-Q${q + 1}`;
}

// ─── Suggested OKR type ───

interface SuggestedOKR {
  objective: string;
  keyResults: KeyResult[];
  evidenceIds: number[];
}

export function OKRPanel({ demoMode, demoOKRs, demoLinks }: OKRPanelProps) {
  // ─── Live data ───
  const liveOKRs = useLiveQuery(() => db.okrs.where("active").equals(1).sortBy("rank"), []);
  const liveLinks = useLiveQuery(() => db.commitment_okr_links.toArray(), []);
  const liveCommitments = useLiveQuery(
    () => db.commitments.where("status").anyOf("new", "snoozed", "actioned").toArray(),
    [],
  );

  const okrs = demoMode ? (demoOKRs ?? []) : (liveOKRs ?? []);
  const links = demoMode ? (demoLinks ?? []) : (liveLinks ?? []);
  const commitments = liveCommitments ?? [];

  // ─── Form state ───
  const [showForm, setShowForm] = useState(false);
  const [objective, setObjective] = useState("");
  const [krTexts, setKrTexts] = useState<string[]>([""]);
  const [period, setPeriod] = useState(getCurrentQuarter());
  const [rank, setRank] = useState(1);

  // ─── Suggestion state ───
  const [suggestions, setSuggestions] = useState<SuggestedOKR[]>([]);
  const [suggestLoading, setSuggestLoading] = useState(false);

  // ─── Delete confirmation ───
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  // ─── Computed ───
  const linkedCommitmentIds = useMemo(
    () => new Set(links.map((l) => l.commitmentId)),
    [links],
  );

  const unalignedCommitments = useMemo(
    () => commitments.filter((c) => c.id !== undefined && !linkedCommitmentIds.has(c.id)),
    [commitments, linkedCommitmentIds],
  );

  const linkCountByOkr = useMemo(() => {
    const map = new Map<number, number>();
    for (const link of links) {
      map.set(link.okrId, (map.get(link.okrId) ?? 0) + 1);
    }
    return map;
  }, [links]);

  // ─── Handlers ───

  async function handleCreateOKR() {
    if (demoMode) return;
    if (!objective.trim()) return;

    const keyResults: KeyResult[] = krTexts
      .filter((t) => t.trim())
      .map((text) => ({ text: text.trim(), progress: 0 }));

    if (keyResults.length === 0) return;

    try {
      // Direct DB write (same pattern as other popup components)
      await db.okrs.add({
        objective: objective.trim(),
        keyResults,
        period,
        rank,
        alignedCount: 0,
        source: "user",
        active: true,
        createdAt: new Date().toISOString(),
      });

      // Reset form
      setObjective("");
      setKrTexts([""]);
      setRank(1);
      setShowForm(false);
    } catch (err) {
      console.error("Failed to create OKR:", err);
    }
  }

  async function handleSuggestOKRs() {
    if (demoMode) return;
    setSuggestLoading(true);
    try {
      // Send message to service worker to run suggestOKRs
      const response = await chrome.runtime.sendMessage({ type: "SUGGEST_OKRS" });
      if (response?.suggestions) {
        setSuggestions(response.suggestions);
      }
    } catch (err) {
      console.error("Failed to suggest OKRs:", err);
    } finally {
      setSuggestLoading(false);
    }
  }

  async function handleAcceptSuggestion(s: SuggestedOKR) {
    if (demoMode) return;
    try {
      await db.okrs.add({
        objective: s.objective,
        keyResults: s.keyResults,
        period: getCurrentQuarter(),
        rank: okrs.length + 1,
        alignedCount: 0,
        source: "ai_suggested",
        active: true,
        createdAt: new Date().toISOString(),
      });
      setSuggestions((prev) => prev.filter((p) => p.objective !== s.objective));
    } catch (err) {
      console.error("Failed to accept suggestion:", err);
    }
  }

  async function handleDeleteOKR(id: number) {
    if (demoMode) return;
    try {
      await db.okrs.update(id, { active: false });
      await db.commitment_okr_links.where("okrId").equals(id).delete();
      setConfirmDeleteId(null);
    } catch (err) {
      console.error("Failed to delete OKR:", err);
    }
  }

  async function handleToggleActive(okr: OKR) {
    if (demoMode) return;
    if (okr.id === undefined) return;
    try {
      await db.okrs.update(okr.id, { active: !okr.active });
    } catch (err) {
      console.error("Failed to toggle OKR:", err);
    }
  }

  async function handleManualAssign(commitmentId: number, okrId: number) {
    if (demoMode) return;
    try {
      // Remove existing link for this commitment
      await db.commitment_okr_links.where("commitmentId").equals(commitmentId).delete();
      // Add new link
      await db.commitment_okr_links.add({
        commitmentId,
        okrId,
        alignment: "directly_supports",
        source: "user",
        createdAt: new Date().toISOString(),
      });
      // Update aligned count
      const count = await db.commitment_okr_links.where("okrId").equals(okrId).count();
      await db.okrs.update(okrId, { alignedCount: count });
    } catch (err) {
      console.error("Failed to assign commitment:", err);
    }
  }

  // ─── Key result input management ───

  function addKR() {
    if (krTexts.length < 3) setKrTexts([...krTexts, ""]);
  }

  function removeKR(index: number) {
    if (krTexts.length <= 1) return;
    setKrTexts(krTexts.filter((_, i) => i !== index));
  }

  function updateKR(index: number, value: string) {
    const updated = [...krTexts];
    updated[index] = value;
    setKrTexts(updated);
  }

  // ─── Render ───

  return (
    <div style={{ fontFamily: OS.font }}>
      {/* Header + Actions */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 700, color: OS.text }}>
          Objectives & Key Results
        </span>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            onClick={() => setShowForm(!showForm)}
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: OS.blue,
              background: "none",
              border: `1px solid ${OS.blue}`,
              borderRadius: 6,
              padding: "4px 10px",
              cursor: "pointer",
              fontFamily: OS.font,
            }}
          >
            {showForm ? "Cancel" : "+ Add Objective"}
          </button>
          <button
            onClick={handleSuggestOKRs}
            disabled={suggestLoading}
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: OS.white,
              background: OS.blue,
              border: "none",
              borderRadius: 6,
              padding: "4px 10px",
              cursor: suggestLoading ? "wait" : "pointer",
              opacity: suggestLoading ? 0.6 : 1,
              fontFamily: OS.font,
            }}
          >
            {suggestLoading ? "Thinking..." : "AI Suggest"}
          </button>
        </div>
      </div>

      {/* Add OKR Form */}
      {showForm && (
        <div
          style={{
            background: OS.white,
            border: `1.5px solid ${OS.border}`,
            borderRadius: 10,
            padding: 14,
            marginBottom: 12,
          }}
        >
          <input
            type="text"
            placeholder="Objective — what do you want to achieve?"
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            style={{
              width: "100%",
              padding: "8px 10px",
              fontSize: 12,
              border: `1px solid ${OS.border}`,
              borderRadius: 6,
              fontFamily: OS.font,
              color: OS.text,
              boxSizing: "border-box",
              marginBottom: 8,
              outline: "none",
            }}
          />

          {krTexts.map((kr, i) => (
            <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
              <input
                type="text"
                placeholder={`Key result ${i + 1}`}
                value={kr}
                onChange={(e) => updateKR(i, e.target.value)}
                style={{
                  flex: 1,
                  padding: "6px 10px",
                  fontSize: 11,
                  border: `1px solid ${OS.border}`,
                  borderRadius: 6,
                  fontFamily: OS.font,
                  color: OS.text,
                  outline: "none",
                }}
              />
              {krTexts.length > 1 && (
                <button
                  onClick={() => removeKR(i)}
                  style={{
                    background: "none",
                    border: "none",
                    color: OS.red,
                    cursor: "pointer",
                    padding: 2,
                    display: "inline-flex",
                  }}
                >
                  <IconX size={12} />
                </button>
              )}
            </div>
          ))}

          {krTexts.length < 3 && (
            <button
              onClick={addKR}
              style={{
                fontSize: 11,
                color: OS.muted,
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "2px 0",
                fontFamily: OS.font,
                marginBottom: 8,
              }}
            >
              + Add key result
            </button>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              style={{
                flex: 1,
                padding: "6px 8px",
                fontSize: 11,
                border: `1px solid ${OS.border}`,
                borderRadius: 6,
                fontFamily: OS.font,
                color: OS.text,
                background: OS.white,
                outline: "none",
              }}
            >
              <option value={getCurrentQuarter()}>{getCurrentQuarter()}</option>
              <option value={getNextQuarter()}>{getNextQuarter()}</option>
            </select>
            <input
              type="number"
              min={1}
              max={10}
              value={rank}
              onChange={(e) => setRank(Number(e.target.value))}
              placeholder="Rank"
              style={{
                width: 60,
                padding: "6px 8px",
                fontSize: 11,
                border: `1px solid ${OS.border}`,
                borderRadius: 6,
                fontFamily: OS.font,
                color: OS.text,
                textAlign: "center",
                outline: "none",
              }}
            />
            <button
              onClick={handleCreateOKR}
              disabled={!objective.trim() || !krTexts.some((t) => t.trim())}
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: OS.white,
                background: OS.blue,
                border: "none",
                borderRadius: 6,
                padding: "6px 14px",
                cursor: "pointer",
                fontFamily: OS.font,
                opacity: !objective.trim() || !krTexts.some((t) => t.trim()) ? 0.5 : 1,
              }}
            >
              Save
            </button>
          </div>
        </div>
      )}

      {/* AI Suggestions */}
      {suggestions.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: OS.muted,
              display: "block",
              marginBottom: 6,
            }}
          >
            AI Suggestions
          </span>
          {suggestions.map((s, i) => (
            <div
              key={i}
              style={{
                background: OS.white,
                border: `1.5px dashed ${OS.blue}`,
                borderRadius: 10,
                padding: 12,
                marginBottom: 8,
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: OS.text, flex: 1 }}>
                  {s.objective}
                </span>
                <button
                  onClick={() => handleAcceptSuggestion(s)}
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    color: OS.green,
                    background: "none",
                    border: `1px solid ${OS.green}`,
                    borderRadius: 5,
                    padding: "3px 8px",
                    cursor: "pointer",
                    fontFamily: OS.font,
                    marginLeft: 8,
                    whiteSpace: "nowrap",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 3,
                  }}
                >
                  <IconCheck size={10} /> Accept
                </button>
              </div>
              <div style={{ marginTop: 6 }}>
                {s.keyResults.map((kr, ki) => (
                  <div
                    key={ki}
                    style={{ fontSize: 11, color: OS.secondary, marginTop: 2, paddingLeft: 8 }}
                  >
                    - {kr.text}
                  </div>
                ))}
              </div>
              {s.evidenceIds.length > 0 && (
                <div style={{ fontSize: 10, color: OS.faint, marginTop: 4 }}>
                  Based on {s.evidenceIds.length} commitment{s.evidenceIds.length !== 1 ? "s" : ""}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* OKR Cards */}
      {okrs.length === 0 && suggestions.length === 0 && (
        <div
          style={{
            textAlign: "center",
            padding: "24px 0",
            color: OS.muted,
            fontSize: 12,
          }}
        >
          No objectives yet. Add one or let AI suggest based on your commitments.
        </div>
      )}

      {okrs.map((okr) => (
        <OKRCard
          key={okr.id}
          okr={okr}
          linkCount={linkCountByOkr.get(okr.id!) ?? 0}
          confirmDeleteId={confirmDeleteId}
          onConfirmDelete={setConfirmDeleteId}
          onDelete={handleDeleteOKR}
          onToggle={handleToggleActive}
          demoMode={demoMode}
        />
      ))}

      {/* Unaligned Commitments */}
      {!demoMode && unalignedCommitments.length > 0 && (
        <UnalignedSection
          commitments={unalignedCommitments}
          okrs={okrs}
          onAssign={handleManualAssign}
        />
      )}
    </div>
  );
}

// ─── OKR Card sub-component ───

interface OKRCardProps {
  okr: OKR;
  linkCount: number;
  confirmDeleteId: number | null;
  onConfirmDelete: (id: number | null) => void;
  onDelete: (id: number) => void;
  onToggle: (okr: OKR) => void;
  demoMode: boolean;
}

function OKRCard({
  okr,
  linkCount,
  confirmDeleteId,
  onConfirmDelete,
  onDelete,
  onToggle,
  demoMode,
}: OKRCardProps) {
  const [expanded, setExpanded] = useState(true);
  const isConfirming = confirmDeleteId === okr.id;

  return (
    <div
      style={{
        background: OS.white,
        border: `1.5px solid ${OS.border}`,
        borderRadius: 10,
        padding: "12px 14px",
        marginBottom: 8,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: "pointer",
        }}
        onClick={() => setExpanded(!expanded)}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
          <span style={{ color: OS.muted, display: "inline-flex" }}>
            {expanded ? <IconChevronUp size={12} /> : <IconChevronDown size={12} />}
          </span>
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: OS.text,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {okr.objective}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, marginLeft: 8 }}>
          {/* Rank badge */}
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              fontFamily: OS.mono,
              background: OS.bg,
              color: OS.muted,
              padding: "2px 6px",
              borderRadius: 4,
            }}
          >
            #{okr.rank}
          </span>
          {/* Alignment count badge */}
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: linkCount > 0 ? OS.green : OS.faint,
              background: linkCount > 0 ? "#e8f5e9" : OS.bg,
              padding: "2px 6px",
              borderRadius: 4,
            }}
          >
            {linkCount} aligned
          </span>
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div style={{ marginTop: 10 }}>
          {/* Key Results */}
          {okr.keyResults.map((kr, i) => (
            <div key={i} style={{ marginBottom: 6 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 3,
                }}
              >
                <span style={{ fontSize: 11, color: OS.secondary }}>{kr.text}</span>
                <span
                  style={{
                    fontSize: 10,
                    fontFamily: OS.mono,
                    color: OS.muted,
                    marginLeft: 8,
                    flexShrink: 0,
                  }}
                >
                  {kr.progress}%
                </span>
              </div>
              {/* Progress bar */}
              <div
                style={{
                  height: 3,
                  background: OS.bg,
                  borderRadius: 2,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${Math.min(100, Math.max(0, kr.progress))}%`,
                    background: kr.progress >= 70 ? OS.green : OS.blue,
                    borderRadius: 2,
                    transition: "width 0.3s ease",
                  }}
                />
              </div>
            </div>
          ))}

          {/* Period + actions */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginTop: 8,
              paddingTop: 8,
              borderTop: `1px solid ${OS.border}`,
            }}
          >
            <span style={{ fontSize: 10, color: OS.faint }}>
              {okr.period}
              {okr.source === "ai_suggested" && " (AI suggested)"}
            </span>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (!demoMode) onToggle(okr);
                }}
                style={{
                  fontSize: 10,
                  color: okr.active ? OS.green : OS.muted,
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  fontFamily: OS.font,
                  padding: "2px 4px",
                }}
              >
                {okr.active ? "Active" : "Inactive"}
              </button>
              {isConfirming ? (
                <span style={{ display: "flex", gap: 4, alignItems: "center" }}>
                  <span style={{ fontSize: 10, color: OS.red }}>Delete?</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (okr.id !== undefined) onDelete(okr.id);
                    }}
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      color: OS.white,
                      background: OS.red,
                      border: "none",
                      borderRadius: 4,
                      padding: "2px 6px",
                      cursor: "pointer",
                      fontFamily: OS.font,
                    }}
                  >
                    Yes
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onConfirmDelete(null);
                    }}
                    style={{
                      fontSize: 10,
                      color: OS.muted,
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      fontFamily: OS.font,
                      padding: "2px 4px",
                    }}
                  >
                    No
                  </button>
                </span>
              ) : (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (okr.id !== undefined) onConfirmDelete(okr.id);
                  }}
                  style={{
                    fontSize: 10,
                    color: OS.red,
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    fontFamily: OS.font,
                    padding: "2px 4px",
                    display: "inline-flex",
                    alignItems: "center",
                  }}
                >
                  <IconX size={10} />
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Unaligned Commitments Section ───

interface UnalignedSectionProps {
  commitments: Commitment[];
  okrs: OKR[];
  onAssign: (commitmentId: number, okrId: number) => void;
}

function UnalignedSection({ commitments, okrs, onAssign }: UnalignedSectionProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      style={{
        marginTop: 12,
        borderTop: `1px solid ${OS.border}`,
        paddingTop: 10,
      }}
    >
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: "pointer",
          marginBottom: expanded ? 8 : 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: OS.text }}>
            Unaligned Commitments
          </span>
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              fontFamily: OS.mono,
              background: OS.bg,
              color: OS.muted,
              padding: "2px 6px",
              borderRadius: 6,
            }}
          >
            {commitments.length}
          </span>
        </div>
        <span style={{ color: OS.muted, display: "inline-flex" }}>
          {expanded ? <IconChevronUp size={12} /> : <IconChevronDown size={12} />}
        </span>
      </div>

      {expanded &&
        commitments.slice(0, 20).map((c) => (
          <div
            key={c.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 0",
              borderBottom: `1px solid ${OS.border}`,
            }}
          >
            <span
              style={{
                fontSize: 11,
                color: OS.secondary,
                flex: 1,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {c.text}
            </span>
            {okrs.length > 0 && c.id !== undefined && (
              <select
                defaultValue=""
                onChange={(e) => {
                  const okrId = Number(e.target.value);
                  if (okrId && c.id !== undefined) onAssign(c.id, okrId);
                }}
                style={{
                  fontSize: 10,
                  padding: "3px 6px",
                  border: `1px solid ${OS.border}`,
                  borderRadius: 4,
                  fontFamily: OS.font,
                  color: OS.muted,
                  background: OS.white,
                  flexShrink: 0,
                  outline: "none",
                  maxWidth: 120,
                }}
              >
                <option value="">Assign...</option>
                {okrs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.objective.length > 25 ? o.objective.slice(0, 25) + "..." : o.objective}
                  </option>
                ))}
              </select>
            )}
          </div>
        ))}

      {expanded && commitments.length > 20 && (
        <div style={{ fontSize: 10, color: OS.faint, padding: "6px 0", textAlign: "center" }}>
          + {commitments.length - 20} more
        </div>
      )}
    </div>
  );
}
