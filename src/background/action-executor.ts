/**
 * action-executor.ts
 * Central dispatcher for executing approved ActionProposals.
 *
 * SECURITY: Nothing sends to external systems without an approved ActionProposal.
 * Status flow: pending → executing → completed | failed
 * All tokens read from chrome.storage.local, never logged.
 */

import { db } from "@shared/db";
import type { ActionProposal, ActionType } from "@shared/types";
import { logStatus } from "@shared/status";
import { sendSlackMessage } from "./slack-sender";
import { createGmailDraft } from "./gmail-sender";
import { createTimeBlock, createMeeting } from "./calendar-writer";

// ─── Payload Types ───

export interface SendMessagePayload {
  platform: "slack" | "gmail";
  recipient: string;
  subject: string | null;
  draftId: number;
}

export interface BlockTimePayload {
  commitmentId: number;
  commitmentText: string;
  deadline: string | null;
  durationMinutes: number;
}

export interface CreateMeetingPayload {
  title: string;
  startIso: string;
  durationMinutes: number;
  attendeeEmails: string[];
  description: string;
}

export type ActionPayload = SendMessagePayload | BlockTimePayload | CreateMeetingPayload;

// ─── Public API ───

/** Create a new ActionProposal record. Returns the new proposal's id. */
export async function createProposal(
  commitmentId: number,
  type: ActionType,
  description: string,
  payload: ActionPayload,
  source: "follow_up_engine" | "clyde_chat" | "manual",
): Promise<number> {
  const now = new Date().toISOString();
  const id = await db.action_proposals.add({
    commitmentId,
    type,
    status: "pending",
    description,
    payload: JSON.stringify(payload),
    resultMessage: null,
    errorMessage: null,
    source,
    createdAt: now,
    updatedAt: now,
  });
  return id as number;
}

/** Execute an approved proposal. Updates DB status throughout. */
export async function executeAction(
  proposalId: number,
): Promise<{ ok: boolean; message: string }> {
  const proposal = await db.action_proposals.get(proposalId);
  if (!proposal) {
    return { ok: false, message: "Proposal not found" };
  }
  if (proposal.status !== "pending" && proposal.status !== "approved") {
    return { ok: false, message: `Cannot execute proposal with status: ${proposal.status}` };
  }

  const now = new Date().toISOString();
  await db.action_proposals.update(proposalId, { status: "executing", updatedAt: now });

  try {
    const result = await routeToExecutor(proposal);

    await db.action_proposals.update(proposalId, {
      status: "completed",
      resultMessage: result,
      updatedAt: new Date().toISOString(),
    });

    await db.action_log.add({
      commitmentId: proposal.commitmentId,
      action: proposal.type,
      createdAt: new Date().toISOString(),
    });

    await logStatus("success", "worker", `Action executed: ${proposal.description}`);
    return { ok: true, message: result };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await db.action_proposals.update(proposalId, {
      status: "failed",
      errorMessage: errMsg,
      updatedAt: new Date().toISOString(),
    });
    await logStatus("error", "worker", `Action failed: ${proposal.description} — ${errMsg}`);
    return { ok: false, message: errMsg };
  }
}

// ─── Router ───

async function routeToExecutor(proposal: ActionProposal): Promise<string> {
  let payload: ActionPayload;
  try {
    payload = JSON.parse(proposal.payload) as ActionPayload;
  } catch {
    throw new Error(`Malformed payload for proposal #${proposal.id}: invalid JSON`);
  }

  switch (proposal.type) {
    case "send_message":
      return executeSendMessage(proposal.id!, payload as SendMessagePayload);
    case "block_time":
      return executeBlockTime(payload as BlockTimePayload);
    case "create_meeting":
      return executeCreateMeeting(payload as CreateMeetingPayload);
    default: {
      const _exhaustive: never = proposal.type;
      throw new Error(`Unknown action type: ${_exhaustive as string}`);
    }
  }
}

// ─── Sub-Executors ───

async function executeSendMessage(
  proposalId: number,
  payload: SendMessagePayload,
): Promise<string> {
  const draft = await db.drafts.get(payload.draftId);
  if (!draft) throw new Error("Draft not found");

  if (payload.platform === "slack") {
    const result = await sendSlackMessage(payload.recipient, draft.body);
    if (!result.ok) throw new Error(result.error ?? "Slack send failed");
    await db.drafts.update(payload.draftId, { status: "sent", updatedAt: new Date().toISOString() });
    return `Sent to ${payload.recipient}`;
  }

  if (payload.platform === "gmail") {
    const result = await createGmailDraft(
      payload.recipient,
      payload.subject ?? "(no subject)",
      draft.body,
    );
    if (!result.ok) throw new Error(result.error ?? "Gmail draft creation failed");
    await db.drafts.update(payload.draftId, { status: "sent", updatedAt: new Date().toISOString() });
    if (result.draftUrl) {
      await db.action_proposals.update(proposalId, { resultMessage: result.draftUrl });
    }
    return result.draftUrl ? `Gmail draft created — ${result.draftUrl}` : "Gmail draft created — open Gmail to review";
  }

  throw new Error(`Unknown platform: ${payload.platform}`);
}

async function executeBlockTime(payload: BlockTimePayload): Promise<string> {
  const commitment = await db.commitments.get(payload.commitmentId);
  const description = commitment?.context_summary ?? commitment?.original_quote ?? "";
  const result = await createTimeBlock(
    payload.commitmentText,
    description,
    payload.deadline,
    payload.durationMinutes,
  );
  if (!result.ok) throw new Error(result.error ?? "Calendar block failed");
  return result.eventUrl ? `Time blocked — ${result.eventUrl}` : "Time block created";
}

async function executeCreateMeeting(payload: CreateMeetingPayload): Promise<string> {
  const endIso = new Date(
    new Date(payload.startIso).getTime() + payload.durationMinutes * 60_000,
  ).toISOString();
  const result = await createMeeting({
    title: payload.title,
    description: payload.description,
    startIso: payload.startIso,
    endIso,
    attendeeEmails: payload.attendeeEmails,
  });
  if (!result.ok) throw new Error(result.error ?? "Meeting creation failed");
  return result.eventUrl ? `Meeting created — ${result.eventUrl}` : "Meeting created";
}

