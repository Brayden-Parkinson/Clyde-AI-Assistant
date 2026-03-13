import React, { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { OS } from "@shared/tokens";
import { db } from "@shared/db";
import type { ActionProposal, Commitment } from "@shared/types";

// ─── Icons ───

function IconSend(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

function IconCalendarBlock(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function IconLinear(): React.ReactElement {
  return <span style={{ fontWeight: 700, fontSize: 11, letterSpacing: "-0.05em" }}>L</span>;
}

function IconX(): React.ReactElement {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function IconCheck(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function IconEdit(): React.ReactElement {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

// ─── Helpers ───

function getActionMeta(type: ActionProposal["type"]): { icon: React.ReactElement; label: string; color: string } {
  switch (type) {
    case "send_message": return { icon: <IconSend />, label: "Send Message", color: OS.blue };
    case "block_time": return { icon: <IconCalendarBlock />, label: "Block Time", color: OS.green };
    case "create_meeting": return { icon: <IconCalendarBlock />, label: "Create Meeting", color: "#7C3AED" };
    case "create_linear_task": return { icon: <IconLinear />, label: "Push to Linear", color: "#5E6AD2" };
  }
}

function getSourceLabel(source: ActionProposal["source"]): string {
  switch (source) {
    case "follow_up_engine": return "Follow-up nudge";
    case "clyde_chat": return "Clyde suggested";
    case "manual": return "Manual";
  }
}

// ─── Status Badge ───

function StatusBadge({ status }: { status: ActionProposal["status"] }): React.ReactElement {
  const map: Record<string, { label: string; bg: string; color: string }> = {
    pending:   { label: "Pending",   bg: OS.bg, color: OS.secondary },
    approved:  { label: "Approved",  bg: "#D1FAE5", color: "#065F46" },
    executing: { label: "Running…",  bg: "#FEF9C3", color: "#713F12" },
    completed: { label: "Done",      bg: "#D1FAE5", color: "#065F46" },
    failed:    { label: "Failed",    bg: "#FEE2E2", color: "#991B1B" },
    dismissed: { label: "Dismissed", bg: OS.bg, color: OS.secondary },
  };
  const m = map[status] ?? map.pending;
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, letterSpacing: "0.04em",
      textTransform: "uppercase", padding: "2px 6px", borderRadius: 4,
      background: m.bg, color: m.color,
    }}>
      {m.label}
    </span>
  );
}

// ─── ProposalCard ───

interface ProposalCardProps {
  proposal: ActionProposal;
  commitment: Commitment | undefined;
  demoMode: boolean;
  onNavigateToDraft: (draftId: number) => void;
}

function ProposalCard({ proposal, commitment, demoMode, onNavigateToDraft }: ProposalCardProps): React.ReactElement | null {
  const [executing, setExecuting] = useState(false);
  const [localStatus, setLocalStatus] = useState<ActionProposal["status"] | null>(null);

  const status = localStatus ?? proposal.status;
  const meta = getActionMeta(proposal.type);

  const hasDraft = proposal.type === "send_message";
  const draftId = hasDraft
    ? (() => { try { return (JSON.parse(proposal.payload) as { draftId?: number }).draftId; } catch { return undefined; } })()
    : undefined;

  if (status === "dismissed") return null;

  async function handleApprove(): Promise<void> {
    if (demoMode) { setLocalStatus("completed"); return; }
    setExecuting(true);
    setLocalStatus("executing");
    try {
      const result = await chrome.runtime.sendMessage({
        type: "EXECUTE_ACTION",
        proposalId: proposal.id,
      }) as { ok: boolean; message: string };
      setLocalStatus(result.ok ? "completed" : "failed");
    } catch {
      setLocalStatus("failed");
    } finally {
      setExecuting(false);
    }
  }

  async function handleDismiss(): Promise<void> {
    if (demoMode) { setLocalStatus("dismissed"); return; }
    if (proposal.id) {
      await db.action_proposals.update(proposal.id, {
        status: "dismissed",
        updatedAt: new Date().toISOString(),
      });
    }
    setLocalStatus("dismissed");
  }

  const canAct = status === "pending" || status === "approved";

  return (
    <div style={{
      background: OS.white,
      border: `1px solid ${OS.border}`,
      borderRadius: 10,
      padding: "12px 14px",
      marginBottom: 10,
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 6 }}>
        <div style={{
          width: 28, height: 28, borderRadius: 6,
          background: OS.bg,
          display: "flex", alignItems: "center", justifyContent: "center",
          color: meta.color, flexShrink: 0, marginTop: 1,
        }}>
          {meta.icon}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 2 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: meta.color }}>{meta.label}</span>
            <StatusBadge status={status} />
          </div>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: OS.text, lineHeight: 1.4 }}>
            {proposal.description}
          </p>
        </div>
      </div>

      {commitment && (
        <div style={{
          padding: "5px 8px",
          background: OS.bg,
          borderRadius: 6, marginBottom: 8,
          fontSize: 11, color: OS.secondary,
        }}>
          Re: <span style={{ color: OS.text }}>{commitment.text}</span>
          {" · "}
          <span>{getSourceLabel(proposal.source)}</span>
        </div>
      )}

      {status === "failed" && proposal.errorMessage && (
        <div style={{
          padding: "5px 8px", background: "#FEF2F2",
          border: "1px solid #FCA5A5", borderRadius: 6,
          marginBottom: 8, fontSize: 11, color: "#991B1B",
        }}>
          Error: {proposal.errorMessage}
        </div>
      )}

      {status === "completed" && proposal.resultMessage && (
        <div style={{
          padding: "5px 8px", background: "#F0FDF4",
          border: "1px solid #86EFAC", borderRadius: 6,
          marginBottom: 8, fontSize: 11, color: "#15803D",
        }}>
          {proposal.resultMessage}
        </div>
      )}

      {canAct && (
        <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
          <button
            onClick={handleApprove}
            disabled={executing}
            style={{
              display: "flex", alignItems: "center", gap: 4,
              padding: "5px 10px", background: OS.blue,
              color: "#fff", border: "none", borderRadius: 6,
              fontSize: 12, fontWeight: 600,
              cursor: executing ? "not-allowed" : "pointer",
              opacity: executing ? 0.6 : 1,
            }}
          >
            <IconCheck />
            {executing ? "Running…" : "Approve & Run"}
          </button>

          {hasDraft && draftId !== undefined && (
            <button
              onClick={() => onNavigateToDraft(draftId)}
              style={{
                display: "flex", alignItems: "center", gap: 4,
                padding: "5px 10px",
                background: OS.bg,
                color: OS.text,
                border: `1px solid ${OS.border}`,
                borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: "pointer",
              }}
            >
              <IconEdit />
              Edit Draft
            </button>
          )}

          <button
            onClick={handleDismiss}
            style={{
              display: "flex", alignItems: "center", gap: 4,
              padding: "5px 8px", background: "transparent",
              color: OS.secondary,
              border: `1px solid ${OS.border}`,
              borderRadius: 6, fontSize: 12, cursor: "pointer",
              marginLeft: "auto",
            }}
          >
            <IconX />
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───

interface ActionQueueProps {
  demoMode: boolean;
  demoProposals?: ActionProposal[];
  onNavigateToDraft: (draftId: number) => void;
}

export function ActionQueue({ demoMode, demoProposals = [], onNavigateToDraft }: ActionQueueProps): React.ReactElement {
  const liveProposals = useLiveQuery(
    () => demoMode
      ? Promise.resolve([] as ActionProposal[])
      : db.action_proposals
          .where("status")
          .anyOf("pending", "approved", "executing", "failed")
          .reverse()
          .toArray(),
    [demoMode],
  ) ?? [];

  const proposals = demoMode ? demoProposals : liveProposals;

  const commitmentIds = [...new Set(proposals.map((p) => p.commitmentId))];
  const commitments = useLiveQuery(
    () => demoMode || commitmentIds.length === 0
      ? Promise.resolve([] as Commitment[])
      : db.commitments.where("id").anyOf(commitmentIds).toArray(),
    [demoMode, commitmentIds.join(",")],
  ) ?? [];
  const commitmentMap = new Map(commitments.map((c) => [c.id!, c]));

  if (proposals.length === 0) {
    return (
      <div style={{
        display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", padding: "48px 24px",
        textAlign: "center", color: OS.secondary,
      }}>
        <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.4 }}>✅</div>
        <p style={{ margin: 0, fontSize: 14, fontWeight: 500, color: OS.text }}>
          No pending actions
        </p>
        <p style={{ margin: "4px 0 0", fontSize: 12 }}>
          Clyde will suggest actions here when it spots follow-up opportunities.
        </p>
      </div>
    );
  }

  return (
    <div style={{ padding: "12px 16px" }}>
      <p style={{
        margin: "0 0 12px",
        fontSize: 11, color: OS.secondary,
        fontWeight: 500, letterSpacing: "0.04em", textTransform: "uppercase",
      }}>
        {proposals.length} pending action{proposals.length !== 1 ? "s" : ""}
      </p>
      {proposals.map((proposal) => (
        <ProposalCard
          key={proposal.id}
          proposal={proposal}
          commitment={commitmentMap.get(proposal.commitmentId)}
          demoMode={demoMode}
          onNavigateToDraft={onNavigateToDraft}
        />
      ))}
    </div>
  );
}

/** Count of pending + executing action proposals for badge display */
export function usePendingProposalCount(demoMode: boolean, demoCount = 0): number {
  return useLiveQuery(
    () => demoMode
      ? Promise.resolve(demoCount)
      : db.action_proposals.where("status").anyOf("pending", "approved", "executing").count(),
    [demoMode, demoCount],
  ) ?? 0;
}
