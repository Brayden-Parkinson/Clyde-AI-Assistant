import React, { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { OS } from "@shared/tokens";
import { db } from "@shared/db";
import type { AppliedCuratorOp, Commitment } from "@shared/types";
import { useDarkMode } from "../DarkModeContext";

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

/**
 * Header chip showing recently-applied curator updates. Hidden when there's
 * nothing to surface or the user is in demo mode. Clicking opens a modal that
 * lists the ops with their evidence and an Undo button per row.
 */
export function CuratorUpdatesChip({ demoMode }: { demoMode: boolean }) {
  const darkMode = useDarkMode();
  const [open, setOpen] = useState(false);

  const recentOps = useLiveQuery(async () => {
    if (demoMode) return [] as AppliedCuratorOp[];
    const cutoff = new Date(Date.now() - TWENTY_FOUR_HOURS_MS).toISOString();
    return db.applied_curator_ops
      .where("appliedAt")
      .above(cutoff)
      .reverse()
      .toArray();
  }, [demoMode]) ?? [];

  if (demoMode || recentOps.length === 0) return null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Curator updates"
        style={{
          height: 28,
          padding: "0 10px",
          borderRadius: 999,
          border: `0.5px solid ${darkMode ? "rgba(255,255,255,0.10)" : OS.border}`,
          background: darkMode ? "rgba(255,255,255,0.04)" : OS.white,
          color: darkMode ? "rgba(255,255,255,0.75)" : OS.text,
          fontSize: 12,
          fontFamily: OS.font,
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <span aria-hidden>🪄</span>
        <span>{recentOps.length} curator update{recentOps.length === 1 ? "" : "s"} applied</span>
      </button>
      {open && (
        <CuratorUpdatesModal
          ops={recentOps}
          onClose={() => setOpen(false)}
          darkMode={darkMode}
        />
      )}
    </>
  );
}

interface ModalProps {
  ops: AppliedCuratorOp[];
  onClose: () => void;
  darkMode: boolean;
}

function CuratorUpdatesModal({ ops, onClose, darkMode }: ModalProps) {
  const [pendingUndo, setPendingUndo] = useState<string | null>(null);

  const onUndo = async (id: string) => {
    setPendingUndo(id);
    try {
      await chrome.runtime.sendMessage({ type: "UNDO_CURATOR_OP", id });
    } finally {
      setPendingUndo(null);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        zIndex: 100,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: 64,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 420,
          maxHeight: "70vh",
          overflowY: "auto",
          background: darkMode ? "#1c1c1e" : OS.white,
          color: darkMode ? "rgba(255,255,255,0.85)" : OS.text,
          borderRadius: 12,
          border: `0.5px solid ${darkMode ? "rgba(255,255,255,0.08)" : OS.border}`,
          boxShadow: "0 10px 30px rgba(0,0,0,0.2)",
          padding: 16,
          fontFamily: OS.font,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Curator updates (last 24h)</div>
          <button
            onClick={onClose}
            style={{
              border: "none",
              background: "transparent",
              fontSize: 16,
              color: darkMode ? "rgba(255,255,255,0.55)" : OS.secondary,
              cursor: "pointer",
            }}
          >
            ×
          </button>
        </div>
        {ops.length === 0 ? (
          <div style={{ fontSize: 12, color: darkMode ? "rgba(255,255,255,0.45)" : OS.muted }}>
            No curator updates in the last 24 hours.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {ops.map((op) => (
              <CuratorOpRow
                key={op.id}
                op={op}
                pendingUndo={pendingUndo === op.id}
                onUndo={() => onUndo(op.id)}
                darkMode={darkMode}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CuratorOpRow({
  op,
  pendingUndo,
  onUndo,
  darkMode,
}: {
  op: AppliedCuratorOp;
  pendingUndo: boolean;
  onUndo: () => void;
  darkMode: boolean;
}) {
  const commitment = useLiveQuery<Commitment | undefined>(
    () => db.commitments.where("hash").equals(op.commitmentHash).first(),
    [op.commitmentHash],
  );

  const label =
    op.opType === "mark_done"
      ? "Marked done"
      : op.opType === "merge_duplicate"
        ? "Merged duplicate"
        : op.opType === "dismiss"
          ? "Dismissed"
          : "Flagged for review";

  const evidence =
    op.opType === "mark_done"
      ? commitment?.completion_signal ?? null
      : op.opType === "merge_duplicate"
        ? commitment?.merge_metadata?.rationale ?? null
        : op.opType === "dismiss"
          ? commitment?.completion_signal ?? null
          : null;

  return (
    <div
      style={{
        padding: "10px 12px",
        borderRadius: 8,
        border: `0.5px solid ${darkMode ? "rgba(255,255,255,0.08)" : OS.border}`,
        background: darkMode ? "rgba(255,255,255,0.03)" : OS.bg,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 500 }}>{label}</div>
          <div style={{ fontSize: 13, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis" }}>
            {commitment?.text ?? <em style={{ color: OS.muted }}>commitment not found</em>}
          </div>
          {evidence && (
            <div style={{ fontSize: 11, marginTop: 4, color: darkMode ? "rgba(255,255,255,0.55)" : OS.secondary }}>
              {evidence}
            </div>
          )}
        </div>
        <button
          onClick={onUndo}
          disabled={pendingUndo}
          style={{
            flexShrink: 0,
            padding: "4px 10px",
            fontSize: 11,
            fontWeight: 500,
            borderRadius: 999,
            border: `0.5px solid ${darkMode ? "rgba(255,255,255,0.10)" : OS.border}`,
            background: "transparent",
            color: darkMode ? "rgba(255,255,255,0.65)" : OS.secondary,
            cursor: pendingUndo ? "default" : "pointer",
            fontFamily: OS.font,
          }}
        >
          {pendingUndo ? "Undoing…" : "Undo"}
        </button>
      </div>
    </div>
  );
}
