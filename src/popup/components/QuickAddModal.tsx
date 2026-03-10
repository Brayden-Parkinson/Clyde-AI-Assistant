import React, { useState, useRef, useEffect, useCallback } from "react";
import { OS } from "@shared/tokens";
import { db } from "@shared/db";
import { CLAUDE_MODEL, API_TIMEOUT_MS } from "@shared/constants";
import { computeHash } from "../../background/dedup";
import { IconX, IconCheck } from "./Icons";
import type { Urgency, CommitmentDirection } from "@shared/types";

// ─── Types ───

interface ParsedCommitment {
  text: string;
  urgency: Urgency;
  deadline: string | null;
  direction: CommitmentDirection;
  context: string;
}

interface DuplicateMatch {
  id: number;
  text: string;
  urgency: string;
  deadline: string | null;
  context: string;
}

type Step = "input" | "interpreting" | "preview" | "dupe_warn" | "creating";

// ─── Helpers ───

/** Word-overlap similarity — returns 0–1 */
function similarity(a: string, b: string): number {
  const words = (s: string) =>
    new Set(s.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
  const wa = words(a);
  const wb = words(b);
  if (wa.size === 0 || wb.size === 0) return 0;
  let overlap = 0;
  for (const w of wa) if (wb.has(w)) overlap++;
  return overlap / Math.min(wa.size, wb.size);
}

function urgencyColor(u: string) {
  if (u === "high") return OS.red;
  if (u === "medium") return OS.warning;
  return OS.muted;
}

function urgencyLabel(u: string) {
  if (u === "high") return "High urgency";
  if (u === "medium") return "Medium urgency";
  return "Low urgency";
}

const MAX_DESCRIPTION_LENGTH = 2000;
const VALID_URGENCIES: Urgency[] = ["high", "medium", "low"];
const VALID_DIRECTIONS: CommitmentDirection[] = ["by_me", "assigned_to_me"];

// ─── Claude call ───

async function interpretCommitment(description: string, signal: AbortSignal): Promise<ParsedCommitment> {
  const { anthropicApiKey: apiKey } = await chrome.storage.local.get("anthropicApiKey");
  if (!apiKey) throw new Error("No API key configured");

  const system = `You are extracting commitment details from a user's plain-language description.
Return ONLY valid JSON — no markdown, no preamble:
{
  "text": "brief actionable description starting with a verb",
  "urgency": "high|medium|low",
  "deadline": "ISO 8601 datetime or null",
  "direction": "by_me|assigned_to_me",
  "context": "person, project, or channel name. Use 'manual' if none mentioned"
}

Rules:
- "text": concise and actionable, e.g. "Review Sarah's design proposal"
- "urgency": high = today/urgent/ASAP, medium = this week/soon, low = whenever
- "deadline": extract from phrases like "by Friday", "end of day", "next Monday". Use current year. null if absent.
- "direction": by_me if the user committed to do something; assigned_to_me if someone asked them
- "context": who or what this is about`;

  const truncated = description.slice(0, MAX_DESCRIPTION_LENGTH);
  const userMsg = `Description: "${truncated}"\nCurrent time: ${new Date().toISOString()}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 256,
      system,
      messages: [{ role: "user", content: userMsg }],
    }),
    signal,
  });

  if (!res.ok) throw new Error(`Claude API error (${res.status})`);

  const data = await res.json();
  const text = data.content?.find((b: { type: string }) => b.type === "text")?.text ?? "";
  const cleaned = text.trim().replace(/^```json?\s*/, "").replace(/\s*```$/, "");
  const parsed = JSON.parse(cleaned) as ParsedCommitment;

  if (!parsed.text) throw new Error("Claude returned an empty commitment");

  // Sanitize enum fields against valid values
  if (!VALID_URGENCIES.includes(parsed.urgency)) parsed.urgency = "medium";
  if (!VALID_DIRECTIONS.includes(parsed.direction)) parsed.direction = "by_me";

  return parsed;
}

// ─── Component ───

interface QuickAddModalProps {
  onClose: () => void;
  showToast: (msg: string, variant?: "success" | "error" | "warning" | "info") => void;
  demoMode: boolean;
  hasApiKey: boolean;
}

export function QuickAddModal({ onClose, showToast, demoMode, hasApiKey }: QuickAddModalProps) {
  const [step, setStep] = useState<Step>("input");
  const [description, setDescription] = useState("");
  const [parsed, setParsed] = useState<ParsedCommitment | null>(null);
  const [dupes, setDupes] = useState<DuplicateMatch[]>([]);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Focus textarea on open
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Close on Escape — also abort any in-flight fetch
  const handleClose = useCallback(() => {
    abortRef.current?.abort();
    onClose();
  }, [onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") handleClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [handleClose]);

  async function handleInterpret() {
    if (!description.trim()) return;

    if (demoMode) {
      showToast("Can't add commitments in demo mode", "warning");
      onClose();
      return;
    }
    if (!hasApiKey) {
      showToast("Add your Anthropic API key in Settings first", "warning");
      onClose();
      return;
    }

    setError(null);
    setStep("interpreting");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const result = await interpretCommitment(description.trim(), controller.signal);
      setParsed(result);

      // Check for duplicates
      const active = await db.commitments
        .where("status").anyOf("new", "snoozed", "actioned")
        .toArray();
      const matches = active.filter(
        (c) => similarity(c.text, result.text) >= 0.5
      ).map((c) => ({
        id: c.id!,
        text: c.text,
        urgency: c.urgency,
        deadline: c.deadline,
        context: c.context,
      }));

      setDupes(matches);
      setStep(matches.length > 0 ? "dupe_warn" : "preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setStep("input");
    }
  }

  async function handleCreate() {
    if (!parsed) return;
    setStep("creating");

    const now = new Date().toISOString();
    const sourceType = "voice" as const; // manual adds use voice type
    const hash = await computeHash(parsed.text, sourceType, parsed.context);

    try {
      await db.commitments.add({
        hash,
        text: parsed.text,
        original_quote: description,
        deadline: parsed.deadline ?? null,
        urgency: parsed.urgency ?? "medium",
        context: parsed.context,
        source_type: sourceType,
        confidence: 1.0,
        status: "new",
        direction: parsed.direction ?? "by_me",
        likely_completed: false,
        completion_signal: null,
        message_timestamp: now,
        snooze_until: null,
        context_summary: null,
        conversation_messages: [],
        slack_link: null,
        triggered: false,
        sensitive: false,
        tag_id: null,
        createdAt: now,
      });
      showToast("Commitment added", "success");
      onClose();
    } catch (err) {
      const msg = err instanceof Error && err.name === "ConstraintError"
        ? "This commitment already exists"
        : "Failed to save — try again";
      showToast(msg, "error");
      onClose();
    }
  }

  // ─── Overlay styles ───

  const overlay: React.CSSProperties = {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.45)",
    zIndex: 10000,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: OS.font,
  };

  const modal: React.CSSProperties = {
    background: OS.white,
    borderRadius: 14,
    width: 440,
    maxWidth: "calc(100vw - 32px)",
    boxShadow: "0 16px 48px rgba(0,0,0,0.18)",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
  };

  const header: React.CSSProperties = {
    padding: "18px 20px 14px",
    borderBottom: `1px solid ${OS.border}`,
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  };

  const body: React.CSSProperties = {
    padding: "20px 20px 8px",
    display: "flex",
    flexDirection: "column",
    gap: 16,
  };

  const footer: React.CSSProperties = {
    padding: "12px 20px 18px",
    display: "flex",
    gap: 8,
    justifyContent: "flex-end",
  };

  const primaryBtn = (disabled = false): React.CSSProperties => ({
    padding: "9px 18px",
    background: disabled ? OS.faint : OS.blue,
    color: disabled ? OS.muted : OS.white,
    border: "none",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    fontFamily: OS.font,
    display: "flex",
    alignItems: "center",
    gap: 6,
  });

  const ghostBtn: React.CSSProperties = {
    padding: "9px 14px",
    background: "none",
    color: OS.secondary,
    border: `1px solid ${OS.border}`,
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 500,
    cursor: "pointer",
    fontFamily: OS.font,
  };

  // ─── Rendering helpers ───

  function AiBadge() {
    return (
      <span style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        fontSize: 10, fontWeight: 700, color: OS.blue,
        background: OS.blueBg, padding: "2px 7px", borderRadius: 4,
        letterSpacing: "0.03em",
      }}>
        ✦ AI
      </span>
    );
  }

  function DeadlinePill({ deadline }: { deadline: string | null }) {
    if (!deadline) return <span style={{ color: OS.muted, fontSize: 12 }}>No deadline</span>;
    const d = new Date(deadline);
    return (
      <span style={{ color: OS.secondary, fontSize: 12 }}>
        Due {d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
      </span>
    );
  }

  function CommitmentPreviewCard({ c, dim }: { c: ParsedCommitment | DuplicateMatch; dim?: boolean }) {
    const urgency = c.urgency;
    return (
      <div style={{
        padding: "12px 14px",
        background: dim ? "#fafafa" : OS.bg,
        border: `1px solid ${OS.border}`,
        borderRadius: 8,
        opacity: dim ? 0.7 : 1,
      }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: OS.text, marginBottom: 6 }}>
          {c.text}
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: urgencyColor(urgency) }}>
            {urgencyLabel(urgency)}
          </span>
          <DeadlinePill deadline={c.deadline ?? null} />
          {c.context && c.context !== "manual" && (
            <span style={{ fontSize: 11, color: OS.muted }}>via {c.context}</span>
          )}
        </div>
      </div>
    );
  }

  // ─── Step renders ───

  function renderInput() {
    return (
      <>
        <div style={body}>
          <div style={{ fontSize: 13, color: OS.secondary, lineHeight: 1.6 }}>
            Describe the commitment in your own words — <strong>AI will figure out the urgency, deadline, and who owns it.</strong>
          </div>
          <textarea
            ref={textareaRef}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleInterpret();
            }}
            placeholder={"e.g. \"I told Sarah I'd review her design proposal by end of Friday\""}
            rows={3}
            style={{
              width: "100%",
              padding: "10px 12px",
              border: `1px solid ${OS.border}`,
              borderRadius: 8,
              fontSize: 13,
              fontFamily: OS.font,
              color: OS.text,
              background: OS.white,
              resize: "none",
              outline: "none",
              lineHeight: 1.5,
              boxSizing: "border-box",
            }}
          />
          {error && (
            <div style={{ fontSize: 12, color: OS.red, padding: "8px 12px", background: "#fff5f5", borderRadius: 6 }}>
              {error}
            </div>
          )}
          <div style={{ fontSize: 11, color: OS.faint }}>
            ⌘ + Enter to submit
          </div>
        </div>
        <div style={footer}>
          <button style={ghostBtn} onClick={handleClose}>Cancel</button>
          <button
            style={primaryBtn(!description.trim())}
            disabled={!description.trim()}
            onClick={handleInterpret}
          >
            <span>✦</span> Interpret & Add
          </button>
        </div>
      </>
    );
  }

  function renderInterpreting() {
    return (
      <div style={{ padding: "40px 20px", display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
        <div style={{
          width: 40, height: 40, borderRadius: "50%",
          background: OS.blueBg,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 20,
          animation: "spin 1.2s linear infinite",
        }}>
          ✦
        </div>
        <div style={{ fontSize: 13, color: OS.secondary, fontWeight: 500 }}>
          AI is interpreting your commitment…
        </div>
        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  function renderPreview() {
    if (!parsed) return null;
    return (
      <>
        <div style={body}>
          <div style={{ fontSize: 13, color: OS.secondary }}>
            Here's what <AiBadge /> will create:
          </div>
          <CommitmentPreviewCard c={parsed} />
          <div style={{ fontSize: 11, color: OS.muted, fontStyle: "italic" }}>
            Your original: "{description}"
          </div>
        </div>
        <div style={footer}>
          <button style={ghostBtn} onClick={() => setStep("input")}>Edit</button>
          <button style={primaryBtn()} onClick={handleCreate}>
            <IconCheck size={13} /> Add commitment
          </button>
        </div>
      </>
    );
  }

  function renderDupeWarn() {
    if (!parsed) return null;
    return (
      <>
        <div style={body}>
          <div style={{
            padding: "10px 14px",
            background: OS.yellowBg,
            border: `1px solid ${OS.yellowBorder}`,
            borderRadius: 8,
            fontSize: 13,
            color: OS.yellowText,
            fontWeight: 500,
            display: "flex",
            gap: 8,
            alignItems: "flex-start",
          }}>
            <span style={{ fontSize: 16, flexShrink: 0 }}>⚠️</span>
            <span>
              <strong>Looks like a duplicate.</strong> You already have {dupes.length === 1 ? "something similar" : `${dupes.length} similar items`}:
            </span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {dupes.map((d) => (
              <CommitmentPreviewCard key={d.id} c={d} dim />
            ))}
          </div>

          <div style={{ fontSize: 13, color: OS.secondary }}>
            The new commitment AI interpreted:
          </div>
          <CommitmentPreviewCard c={parsed} />
        </div>
        <div style={footer}>
          <button style={ghostBtn} onClick={handleClose}>Cancel</button>
          <button
            style={{ ...primaryBtn(), background: OS.warning }}
            onClick={handleCreate}
          >
            Add anyway
          </button>
        </div>
      </>
    );
  }

  function renderCreating() {
    return (
      <div style={{ padding: "40px 20px", display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
        <div style={{ fontSize: 20 }}>✦</div>
        <div style={{ fontSize: 13, color: OS.secondary }}>Saving…</div>
      </div>
    );
  }

  function ModalHeader() {
    const titles: Record<Step, string> = {
      input: "Add a commitment",
      interpreting: "Interpreting…",
      preview: "Review before adding",
      dupe_warn: "Possible duplicate",
      creating: "Adding…",
    };
    return (
      <div style={header}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: OS.text }}>{titles[step]}</span>
            <AiBadge />
          </div>
          {step === "input" && (
            <div style={{ fontSize: 11, color: OS.muted }}>
              Powered by Claude · never stores your description
            </div>
          )}
        </div>
        <button
          onClick={handleClose}
          style={{
            background: "none", border: "none", cursor: "pointer",
            color: OS.muted, padding: 4, borderRadius: 6,
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <IconX size={16} />
        </button>
      </div>
    );
  }

  return (
    <div style={overlay} onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}>
      <div style={modal}>
        <ModalHeader />
        {step === "input" && renderInput()}
        {step === "interpreting" && renderInterpreting()}
        {step === "preview" && renderPreview()}
        {step === "dupe_warn" && renderDupeWarn()}
        {step === "creating" && renderCreating()}
      </div>
    </div>
  );
}
