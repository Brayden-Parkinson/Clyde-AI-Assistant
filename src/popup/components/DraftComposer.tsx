import React, { useState, useEffect, useCallback } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { OS } from "@shared/tokens";
import { db } from "@shared/db";
import type { DraftTone } from "@shared/types";

// ─── Icons ───

function IconArrowLeft(): React.ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  );
}

function IconSlack(): React.ReactElement {
  return <span style={{ fontWeight: 700, fontSize: 12 }}>S</span>;
}

function IconMail(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  );
}

function IconRefresh(): React.ReactElement {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="1 4 1 10 7 10" />
      <path d="M3.51 15a9 9 0 1 0 .49-5" />
    </svg>
  );
}

function IconSend(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

// ─── Tone Selector ───

const TONES: { value: DraftTone; label: string }[] = [
  { value: "professional", label: "Professional" },
  { value: "casual", label: "Casual" },
  { value: "brief", label: "Brief" },
  { value: "apologetic", label: "Apologetic" },
];

function ToneSelector({
  value,
  onChange,
}: {
  value: DraftTone;
  onChange: (tone: DraftTone) => void;
}): React.ReactElement {
  return (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
      {TONES.map((t) => (
        <button
          key={t.value}
          onClick={() => onChange(t.value)}
          style={{
            padding: "4px 10px",
            borderRadius: 6,
            fontSize: 12,
            fontWeight: value === t.value ? 600 : 400,
            background: value === t.value ? OS.blue ?? "#2563EB" : OS.bg,
            color: value === t.value ? "#fff" : OS.text ?? "#111827",
            border: "none",
            cursor: "pointer",
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ─── Main Component ───

interface DraftComposerProps {
  draftId: number;
  demoMode: boolean;
  onBack: () => void;
  onSent: () => void;
  showToast: (msg: string, variant?: "success" | "error" | "warning" | "info") => void;
}

export function DraftComposer({
  draftId,
  demoMode,
  onBack,
  onSent,
  showToast,
}: DraftComposerProps): React.ReactElement {
  const draft = useLiveQuery(() => db.drafts.get(draftId), [draftId]);
  const commitment = useLiveQuery(
    () => draft ? db.commitments.get(draft.commitmentId) : Promise.resolve(undefined),
    [draft?.commitmentId],
  );

  const [editedBody, setEditedBody] = useState<string>("");
  const [tone, setTone] = useState<DraftTone>("professional");
  const [regenerating, setRegenerating] = useState(false);
  const [sending, setSending] = useState(false);
  const [extraInstruction, setExtraInstruction] = useState("");
  const [showInstruction, setShowInstruction] = useState(false);

  // Sync body from DB when draft loads/changes
  useEffect(() => {
    if (draft && editedBody === "") {
      setEditedBody(draft.body);
      setTone(draft.tone);
    }
  }, [draft, editedBody]);

  // Handle missing draft (deleted/sent)
  useEffect(() => {
    if (draft === null) {
      onBack();
    }
  }, [draft, onBack]);

  const handleToneChange = useCallback(async (newTone: DraftTone) => {
    setTone(newTone);
    if (!demoMode) {
      await db.drafts.update(draftId, { tone: newTone, updatedAt: new Date().toISOString() });
    }
  }, [draftId, demoMode]);

  const handleSaveBody = useCallback(async () => {
    if (demoMode) return;
    await db.drafts.update(draftId, { body: editedBody, updatedAt: new Date().toISOString() });
  }, [draftId, editedBody, demoMode]);

  const handleRegenerate = useCallback(async () => {
    if (demoMode) { showToast("Regenerate unavailable in demo mode"); return; }
    setRegenerating(true);
    try {
      const result = await chrome.runtime.sendMessage({
        type: "REGENERATE_DRAFT",
        draftId,
        tone,
        instruction: extraInstruction || null,
      }) as { ok: boolean; body?: string; error?: string };

      if (result.ok && result.body) {
        setEditedBody(result.body);
        showToast("Draft regenerated");
      } else {
        showToast(result.error ?? "Regeneration failed", "error");
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed", "error");
    } finally {
      setRegenerating(false);
    }
  }, [draftId, tone, extraInstruction, demoMode, showToast]);

  const handleSend = useCallback(async () => {
    if (demoMode) { showToast("Send unavailable in demo mode"); return; }
    if (!draft) return;

    setSending(true);
    try {
      // First save any edits
      await db.drafts.update(draftId, { body: editedBody, updatedAt: new Date().toISOString() });

      // If there's a linked proposal, execute it
      if (draft.proposalId) {
        const result = await chrome.runtime.sendMessage({
          type: "EXECUTE_ACTION",
          proposalId: draft.proposalId,
        }) as { ok: boolean; message: string };

        if (result.ok) {
          showToast(draft.platform === "gmail" ? "Gmail draft created — check Gmail to send" : "Message sent!");
          onSent();
        } else {
          showToast(result.message, "error");
        }
      } else {
        // Standalone draft — create a proposal and execute it
        const proposalResult = await chrome.runtime.sendMessage({
          type: "SEND_DRAFT",
          draftId,
        }) as { ok: boolean; message?: string; error?: string };

        if (proposalResult.ok) {
          showToast(draft.platform === "gmail" ? "Gmail draft created" : "Message sent!");
          onSent();
        } else {
          showToast(proposalResult.error ?? "Send failed", "error");
        }
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Send failed", "error");
    } finally {
      setSending(false);
    }
  }, [draft, draftId, editedBody, demoMode, showToast, onSent]);

  if (draft === undefined) {
    return (
      <div style={{ padding: 24, textAlign: "center", color: OS.secondary }}>
        Loading draft…
      </div>
    );
  }

  if (!draft) return <></>;

  const platformIcon = draft.platform === "slack" ? <IconSlack /> : <IconMail />;
  const platformLabel = draft.platform === "slack" ? "Slack" : "Gmail";
  const sendLabel = draft.platform === "gmail" ? "Create Gmail Draft" : "Send in Slack";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: OS.bg ?? "#F9FAFB" }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "12px 16px",
        background: OS.white,
        borderBottom: `1px solid ${OS.border ?? "#E5E7EB"}`,
        flexShrink: 0,
      }}>
        <button
          onClick={onBack}
          style={{
            background: "none", border: "none",
            color: OS.secondary,
            cursor: "pointer", display: "flex", alignItems: "center",
            padding: 4,
          }}
        >
          <IconArrowLeft />
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ color: OS.blue ?? "#2563EB" }}>{platformIcon}</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: OS.text ?? "#111827" }}>
            Draft — {platformLabel}
          </span>
        </div>
        <div style={{
          marginLeft: "auto", fontSize: 11,
          color: OS.secondary,
          background: OS.bg,
          padding: "2px 8px", borderRadius: 4,
        }}>
          To: {draft.recipient}
        </div>
      </div>

      {/* Commitment context */}
      {commitment && (
        <div style={{
          padding: "8px 16px",
          background: OS.bg,
          borderBottom: `1px solid ${OS.border ?? "#E5E7EB"}`,
          fontSize: 11, color: OS.secondary,
          flexShrink: 0,
        }}>
          Re: <span style={{ color: OS.text ?? "#111827", fontWeight: 500 }}>{(commitment as { text?: string } | undefined)?.text}</span>
        </div>
      )}

      {/* Body */}
      <div style={{ flex: 1, padding: 16, display: "flex", flexDirection: "column", gap: 12, overflow: "auto" }}>
        {/* Subject (Gmail only) */}
        {draft.platform === "gmail" && draft.subject && (
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: OS.secondary, display: "block", marginBottom: 4 }}>
              Subject
            </label>
            <input
              type="text"
              defaultValue={draft.subject}
              style={{
                width: "100%", padding: "7px 10px",
                border: `1px solid ${OS.border ?? "#E5E7EB"}`,
                borderRadius: 6, fontSize: 13, fontFamily: OS.font,
                background: OS.white,
                color: OS.text ?? "#111827",
                boxSizing: "border-box",
              }}
            />
          </div>
        )}

        {/* Tone selector */}
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: OS.secondary, display: "block", marginBottom: 6 }}>
            Tone
          </label>
          <ToneSelector value={tone} onChange={handleToneChange} />
        </div>

        {/* Message body editor */}
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: OS.secondary, display: "block", marginBottom: 6 }}>
            Message
          </label>
          <textarea
            value={editedBody}
            onChange={(e) => setEditedBody(e.target.value)}
            onBlur={handleSaveBody}
            rows={10}
            style={{
              width: "100%",
              padding: "10px 12px",
              border: `1px solid ${OS.border ?? "#E5E7EB"}`,
              borderRadius: 8,
              fontSize: 13,
              lineHeight: 1.6,
              fontFamily: OS.font,
              color: OS.text ?? "#111827",
              background: OS.white,
              resize: "vertical",
              boxSizing: "border-box",
            }}
          />
        </div>

        {/* Extra instruction for regeneration */}
        {showInstruction && (
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: OS.secondary, display: "block", marginBottom: 4 }}>
              Instruction for regeneration
            </label>
            <input
              type="text"
              value={extraInstruction}
              onChange={(e) => setExtraInstruction(e.target.value)}
              placeholder="e.g. 'mention the April 15 deadline'"
              style={{
                width: "100%", padding: "7px 10px",
                border: `1px solid ${OS.border ?? "#E5E7EB"}`,
                borderRadius: 6, fontSize: 12, fontFamily: OS.font,
                background: OS.white,
                color: OS.text ?? "#111827",
                boxSizing: "border-box",
              }}
            />
          </div>
        )}

        {/* Regenerate */}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            onClick={handleRegenerate}
            disabled={regenerating}
            style={{
              display: "flex", alignItems: "center", gap: 5,
              padding: "6px 12px",
              background: OS.bg,
              color: OS.text ?? "#111827",
              border: `1px solid ${OS.border ?? "#E5E7EB"}`,
              borderRadius: 6, fontSize: 12, fontWeight: 500,
              cursor: regenerating ? "not-allowed" : "pointer",
              opacity: regenerating ? 0.6 : 1,
            }}
          >
            <IconRefresh />
            {regenerating ? "Regenerating…" : "Regenerate"}
          </button>
          <button
            onClick={() => setShowInstruction(!showInstruction)}
            style={{
              background: "none", border: "none",
              fontSize: 11, color: OS.secondary,
              cursor: "pointer", textDecoration: "underline",
            }}
          >
            {showInstruction ? "Hide" : "Add instruction"}
          </button>
        </div>
      </div>

      {/* Send bar */}
      <div style={{
        padding: "12px 16px",
        background: OS.white,
        borderTop: `1px solid ${OS.border ?? "#E5E7EB"}`,
        display: "flex", gap: 8,
        flexShrink: 0,
      }}>
        <button
          onClick={handleSave}
          style={{
            padding: "7px 14px",
            background: OS.bg,
            color: OS.text ?? "#111827",
            border: `1px solid ${OS.border ?? "#E5E7EB"}`,
            borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: "pointer",
          }}
        >
          Save
        </button>
        <button
          onClick={handleSend}
          disabled={sending}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "7px 16px",
            background: OS.blue ?? "#2563EB",
            color: "#fff",
            border: "none",
            borderRadius: 6, fontSize: 13, fontWeight: 600,
            cursor: sending ? "not-allowed" : "pointer",
            opacity: sending ? 0.6 : 1,
            flex: 1,
            justifyContent: "center",
          }}
        >
          <IconSend />
          {sending ? "Sending…" : sendLabel}
        </button>
        <button
          onClick={() => {
            if (!demoMode) void db.drafts.update(draftId, { status: "discarded", updatedAt: new Date().toISOString() });
            onBack();
          }}
          style={{
            padding: "7px 12px",
            background: "none",
            color: OS.secondary,
            border: `1px solid ${OS.border ?? "#E5E7EB"}`,
            borderRadius: 6, fontSize: 12, cursor: "pointer",
          }}
        >
          Discard
        </button>
      </div>
    </div>
  );

  async function handleSave() {
    if (demoMode) { showToast("Saved (demo)"); return; }
    await db.drafts.update(draftId, { body: editedBody, tone, updatedAt: new Date().toISOString() });
    showToast("Draft saved");
  }
}
