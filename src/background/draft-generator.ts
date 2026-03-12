/**
 * draft-generator.ts
 * Claude-powered message draft generation.
 * Creates DraftMessage records for user review — never auto-sends.
 */

import { db } from "@shared/db";
import type { DraftPlatform, DraftTone } from "@shared/types";
import { CLAUDE_MODEL, API_TIMEOUT_MS, API_MAX_RETRIES, API_RETRY_DELAY_MS } from "@shared/constants";
import { logStatus } from "@shared/status";
import { getUserProfile } from "@shared/user-profile";

// ─── Types ───

export interface GenerateDraftInput {
  commitmentId: number;
  proposalId: number | null;
  platform: DraftPlatform;
  recipient: string;
  subject: string | null;
  tone: DraftTone;
  instruction: string | null;
}

export interface GenerateDraftResult {
  draftId: number;
  body: string;
}

// ─── Claude Helper (standalone — does not import extractor.ts) ───

async function callClaude(system: string, userMessage: string): Promise<string> {
  const stored = await chrome.storage.local.get("anthropicApiKey");
  const apiKey = stored.anthropicApiKey as string | undefined;
  if (!apiKey) throw new Error("No API key configured");

  for (let attempt = 0; attempt <= API_MAX_RETRIES; attempt++) {
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: CLAUDE_MODEL,
          max_tokens: 1024,
          system,
          messages: [{ role: "user", content: userMessage }],
        }),
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      });

      if (response.status === 429 && attempt < API_MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, API_RETRY_DELAY_MS * (attempt + 1)));
        continue;
      }

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`Claude API error (${response.status}): ${err.slice(0, 200)}`);
      }

      const data = await response.json() as { content?: Array<{ type: string; text: string }> };
      const text = data.content?.find((b) => b.type === "text")?.text;
      if (!text) throw new Error("Empty Claude response");
      return text.trim();
    } catch (err) {
      if (err instanceof DOMException && err.name === "TimeoutError" && attempt < API_MAX_RETRIES) {
        continue;
      }
      throw err;
    }
  }
  throw new Error("Claude API failed after all retries");
}

// ─── Main ───

export async function generateDraft(input: GenerateDraftInput): Promise<GenerateDraftResult> {
  const commitment = await db.commitments.get(input.commitmentId);
  if (!commitment) throw new Error(`Commitment ${input.commitmentId} not found`);

  const profile = await getUserProfile();
  const userName = profile.userName || "me";

  const contextStr = commitment.context_summary
    ? `Context: ${commitment.context_summary}`
    : `Original quote: "${commitment.original_quote}"`;

  const toneGuide: Record<DraftTone, string> = {
    professional: "Clear, businesslike, respectful. No slang.",
    casual: "Friendly and direct. Conversational tone. Short sentences.",
    brief: "3 sentences maximum. Get to the point immediately.",
    apologetic: "Acknowledge the delay or issue. Empathetic but still action-oriented.",
  };

  const platformGuide = input.platform === "slack"
    ? "Slack message: no formal greeting needed, conversational, use line breaks for readability."
    : "Email: include brief professional greeting and sign-off. Use proper paragraphs.";

  const system = `You are drafting a message on behalf of ${userName}.

COMMITMENT TO ADDRESS:
${commitment.text}
${contextStr}

RECIPIENT: ${input.recipient}
PLATFORM: ${input.platform} (${platformGuide})
TONE: ${input.tone} — ${toneGuide[input.tone]}
${input.instruction ? `\nUSER INSTRUCTION: ${input.instruction}` : ""}

Write a message that directly addresses this commitment. Be genuine, specific, and appropriately brief.

Return ONLY the message body. No preamble, no quotes, no explanations.`;

  const body = await callClaude(system, "Generate the draft message now.");

  if (!body) throw new Error("Claude returned empty draft");

  const now = new Date().toISOString();
  const draftId = await db.drafts.add({
    commitmentId: input.commitmentId,
    proposalId: input.proposalId,
    platform: input.platform,
    recipient: input.recipient,
    subject: input.subject,
    body,
    tone: input.tone,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  });

  await logStatus("success", "worker", `Draft generated for "${commitment.text.slice(0, 40)}..."`);
  return { draftId: draftId as number, body };
}

/** Regenerate the body of an existing draft with updated tone/instruction. */
export async function regenerateDraft(
  draftId: number,
  tone: DraftTone,
  instruction: string | null,
): Promise<string> {
  const draft = await db.drafts.get(draftId);
  if (!draft) throw new Error("Draft not found");

  const result = await generateDraft({
    commitmentId: draft.commitmentId,
    proposalId: draft.proposalId,
    platform: draft.platform,
    recipient: draft.recipient,
    subject: draft.subject,
    tone,
    instruction,
  });

  // Update the existing draft record with new body
  await db.drafts.update(draftId, {
    body: result.body,
    tone,
    updatedAt: new Date().toISOString(),
  });

  // Clean up the extra record generated by generateDraft
  if (result.draftId !== draftId) {
    await db.drafts.delete(result.draftId);
  }

  return result.body;
}
