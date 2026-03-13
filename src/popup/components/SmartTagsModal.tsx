import React, { useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { OS } from "@shared/tokens";
import { db, ensureGeneralTag, getNextTagColor } from "@shared/db";
import { retagAll } from "../../background/tag-backfill";
import { IconX } from "./Icons";

interface SmartTagsModalProps {
  onClose: () => void;
  demoMode?: boolean;
}

export function SmartTagsModal({ onClose, demoMode }: SmartTagsModalProps) {
  const allTags = useLiveQuery(() => db.tags.orderBy("name").toArray(), []) ?? [];
  const [newLabel, setNewLabel] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingLabel, setEditingLabel] = useState("");
  const [retagging, setRetagging] = useState(false);
  const [retagResult, setRetagResult] = useState<string | null>(null);

  const handleAdd = useCallback(async (label: string) => {
    if (demoMode) return;
    const trimmed = label.trim();
    if (!trimmed) return;
    const count = await db.tags.count();
    await db.tags.add({ name: trimmed, color: getNextTagColor(count), createdAt: new Date().toISOString() });
    setNewLabel("");
  }, [demoMode]);

  const handleRename = useCallback(async (id: number, label: string) => {
    if (demoMode) return;
    const trimmed = label.trim();
    if (trimmed) await db.tags.update(id, { name: trimmed });
    setEditingId(null);
  }, [demoMode]);

  const handleDelete = useCallback(async (id: number) => {
    if (demoMode) return;
    const generalTagId = await ensureGeneralTag();
    if (id === generalTagId) return;
    await db.commitments.where("tag_id").equals(id).modify({ tag_id: generalTagId });
    await db.tags.delete(id);
  }, [demoMode]);

  const handleRetagAll = useCallback(async () => {
    if (demoMode) return;
    setRetagging(true);
    setRetagResult(null);
    try {
      const { tagCount, commitmentCount } = await retagAll();
      setRetagResult(`Done — ${commitmentCount} commitments across ${tagCount} tags`);
    } catch (e) {
      setRetagResult("Error: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setRetagging(false);
    }
  }, []);

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(0,0,0,0.4)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: OS.white, borderRadius: 10,
          border: `1px solid ${OS.border}`,
          boxShadow: "0 8px 32px rgba(0,0,0,0.22)",
          padding: "20px 22px",
          width: 340, maxWidth: "calc(100vw - 32px)",
          maxHeight: "80vh", overflowY: "auto",
          boxSizing: "border-box" as const,
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: OS.text }}>Smart Tags</span>
          <button
            onClick={onClose}
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: OS.muted, padding: "2px",
              display: "inline-flex", alignItems: "center",
            }}
          >
            <IconX size={14} />
          </button>
        </div>

        <p style={{ fontSize: 12, color: OS.muted, marginBottom: 14, lineHeight: 1.5 }}>
          Tags are auto-assigned by Claude. Add or rename tags here, then re-tag all commitments to apply your changes.
        </p>

        {/* Tag list */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
          {allTags.map((tag) => {
            const isGeneral = tag.name === "General";
            const isEditing = editingId === tag.id;
            return (
              <div key={tag.id} style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "7px 10px",
                background: OS.bg, border: `1px solid ${OS.border}`, borderRadius: 7,
              }}>
                <span style={{
                  width: 9, height: 9, borderRadius: "50%",
                  background: tag.color, flexShrink: 0,
                }} />

                {isEditing ? (
                  <input
                    autoFocus
                    value={editingLabel}
                    onChange={(e) => setEditingLabel(e.target.value)}
                    onBlur={() => handleRename(tag.id!, editingLabel)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleRename(tag.id!, editingLabel);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    style={{
                      flex: 1, fontSize: 13, padding: "2px 6px",
                      border: `1px solid ${OS.blue}`, borderRadius: 4,
                      fontFamily: OS.font, outline: "none",
                    }}
                  />
                ) : (
                  <span
                    style={{ flex: 1, fontSize: 13, fontWeight: 500, color: OS.text }}
                    onDoubleClick={() => { if (!isGeneral) { setEditingId(tag.id!); setEditingLabel(tag.name); } }}
                    title={isGeneral ? undefined : "Double-click to rename"}
                  >
                    {tag.name}
                    {isGeneral && <span style={{ fontSize: 10, color: OS.faint, marginLeft: 6 }}>(built-in)</span>}
                  </span>
                )}

                {!isGeneral && !isEditing && (
                  <button
                    onClick={() => { setEditingId(tag.id!); setEditingLabel(tag.name); }}
                    style={{
                      padding: "2px 7px", fontSize: 11, fontFamily: OS.font,
                      border: `1px solid ${OS.border}`, borderRadius: 4,
                      background: OS.white, color: OS.secondary, cursor: "pointer",
                    }}
                  >
                    Rename
                  </button>
                )}
                {!isGeneral && !isEditing && (
                  <button
                    onClick={() => handleDelete(tag.id!)}
                    style={{
                      padding: "3px 6px", fontFamily: OS.font,
                      border: "1px solid #fca5a5", borderRadius: 4,
                      background: OS.white, color: OS.red, cursor: "pointer",
                      display: "inline-flex", alignItems: "center",
                    }}
                  >
                    <IconX size={11} />
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* Add tag */}
        <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
          <input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { handleAdd(newLabel); }
              if (e.key === "Escape") setNewLabel("");
            }}
            placeholder="New tag name..."
            style={{
              flex: 1, padding: "6px 10px",
              border: `1px solid ${OS.border}`, borderRadius: 6,
              fontSize: 12, fontFamily: OS.font, outline: "none",
              boxSizing: "border-box" as const,
            }}
          />
          <button
            onClick={() => handleAdd(newLabel)}
            disabled={!newLabel.trim()}
            style={{
              padding: "6px 14px",
              background: newLabel.trim() ? OS.blue : OS.faint,
              color: OS.white, border: "none", borderRadius: 6,
              fontSize: 12, fontFamily: OS.font,
              cursor: newLabel.trim() ? "pointer" : "default",
            }}
          >
            Add
          </button>
        </div>

        {/* Re-tag all */}
        <div style={{
          padding: "12px 14px", background: OS.bg,
          border: `1px solid ${OS.border}`, borderRadius: 8,
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: OS.text, marginBottom: 3 }}>Re-tag all commitments</div>
          <div style={{ fontSize: 12, color: OS.secondary, marginBottom: 10, lineHeight: 1.5 }}>
            Uses Claude to re-assign tags based on the current tag list.
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button
              onClick={handleRetagAll}
              disabled={retagging}
              style={{
                padding: "7px 16px", fontSize: 12, fontWeight: 600,
                background: retagging ? OS.faint : OS.blue,
                color: OS.white, border: "none", borderRadius: 6,
                fontFamily: OS.font, cursor: retagging ? "default" : "pointer",
              }}
            >
              {retagging ? "✦ Re-tagging…" : "✦ Re-tag all"}
            </button>
            {retagResult && (
              <span style={{ fontSize: 11, color: retagResult.startsWith("Error") ? OS.red : OS.green }}>
                {retagResult}
              </span>
            )}
          </div>
        </div>

      </div>
    </div>,
    document.body,
  );
}
