/**
 * follow-up-engine.ts
 * Proactive follow-up detection and scheduling.
 *
 * Runs on FOLLOW_UP_CHECK alarm (every 2 hours).
 * Creates ActionProposals for stale commitments — never sends anything automatically.
 */

import { db } from "@shared/db";
import { createProposal } from "./action-executor";
import { generateDraft } from "./draft-generator";
import { logStatus } from "@shared/status";
import { getSetting } from "@shared/db";

// ─── Configuration defaults ───

const DEFAULT_FOLLOW_UP_DAYS_ASSIGNED = 3; // days before nudging on "assigned_to_me" commitments
const DEFAULT_FOLLOW_UP_DAYS_PROMISED = 5; // days before nudging on "by_me" commitments

// ─── Main ───

/** Run the follow-up check. Called by the FOLLOW_UP_CHECK alarm. */
export async function runFollowUpCheck(): Promise<void> {
  const nudgeEnabled = await getSetting<boolean>("nudgeEnabled", true);
  if (!nudgeEnabled) return;

  const now = new Date();

  // 1. Fire scheduled follow-up rules that are past their checkAt
  await fireScheduledRules(now);

  // 2. Detect stale commitments and create proactive proposals
  const assignedDays = await getSetting<number>("followUpDaysAssigned", DEFAULT_FOLLOW_UP_DAYS_ASSIGNED);
  const promisedDays = await getSetting<number>("followUpDaysPromised", DEFAULT_FOLLOW_UP_DAYS_PROMISED);

  await detectStaleCommitments(now, assignedDays, promisedDays);

  await logStatus("info", "worker", "Follow-up check complete");
}

/** Create or update a follow-up rule for a commitment. Returns the rule id. */
export async function setFollowUpRule(
  commitmentId: number,
  checkAt?: string,
): Promise<number> {
  const existing = await db.follow_up_rules
    .where("commitmentId")
    .equals(commitmentId)
    .filter((r) => r.status === "active")
    .first();

  const defaultCheckAt = new Date(Date.now() + 48 * 3600_000).toISOString();
  const resolvedCheckAt = checkAt ?? defaultCheckAt;

  if (existing?.id != null) {
    await db.follow_up_rules.update(existing.id, {
      checkAt: resolvedCheckAt,
    });
    return existing.id;
  }

  const id = await db.follow_up_rules.add({
    commitmentId,
    checkAt: resolvedCheckAt,
    fireCount: 0,
    status: "active",
    createdAt: new Date().toISOString(),
  });
  return id as number;
}

/** Mark a follow-up rule as completed for a commitment. */
export async function clearFollowUpRule(commitmentId: number): Promise<void> {
  await db.follow_up_rules
    .where("commitmentId")
    .equals(commitmentId)
    .filter((r) => r.status === "active")
    .modify({ status: "completed" });
}

// ─── Private helpers ───

async function fireScheduledRules(now: Date): Promise<void> {
  const nowIso = now.toISOString();
  const rules = await db.follow_up_rules
    .where("status")
    .equals("active")
    .filter((r) => r.checkAt <= nowIso)
    .toArray();

  for (const rule of rules) {
    const commitment = await db.commitments.get(rule.commitmentId);
    if (!commitment || commitment.status === "done" || commitment.status === "dismissed") {
      // Commitment is resolved — mark rule completed
      if (rule.id) await db.follow_up_rules.update(rule.id, { status: "completed" });
      continue;
    }

    // Avoid creating duplicate pending proposals for the same commitment
    const existingProposal = await db.action_proposals
      .where("commitmentId")
      .equals(rule.commitmentId)
      .filter((p) => p.status === "pending" && p.source === "follow_up_engine")
      .first();
    if (existingProposal) continue;

    // Generate a draft for the follow-up
    try {
      const draftResult = await generateDraft({
        commitmentId: rule.commitmentId,
        proposalId: null,
        platform: "slack",
        recipient: commitment.context,
        subject: null,
        tone: "professional",
        instruction: "Follow up on this commitment — check in on status or provide an update.",
      });

      const proposalId = await createProposal(
        rule.commitmentId,
        "send_message",
        `Follow up on "${commitment.text.slice(0, 50)}"`,
        {
          platform: "slack",
          recipient: commitment.context,
          subject: null,
          draftId: draftResult.draftId,
        },
        "follow_up_engine",
      );

      // Update draft's proposalId
      await db.drafts.update(draftResult.draftId, {
        proposalId,
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      await logStatus("warn", "worker", `Follow-up draft generation failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Update rule: increment fireCount, set next check in 48h
    if (rule.id) {
      await db.follow_up_rules.update(rule.id, {
        fireCount: rule.fireCount + 1,
        checkAt: new Date(Date.now() + 48 * 3600_000).toISOString(),
      });
    }
  }
}

async function detectStaleCommitments(
  now: Date,
  assignedDays: number,
  promisedDays: number,
): Promise<void> {
  const assignedCutoff = new Date(now.getTime() - assignedDays * 86_400_000).toISOString();
  const promisedCutoff = new Date(now.getTime() - promisedDays * 86_400_000).toISOString();

  const stale = await db.commitments
    .where("status")
    .equals("new")
    .filter((c) => {
      if (c.direction === "assigned_to_me") return c.createdAt < assignedCutoff;
      if (c.direction === "by_me") return c.createdAt < promisedCutoff;
      return false;
    })
    .toArray();

  for (const commitment of stale) {
    if (!commitment.id) continue;

    // Skip if there's already a follow-up rule or pending proposal
    const hasRule = await db.follow_up_rules
      .where("commitmentId").equals(commitment.id)
      .filter((r) => r.status === "active")
      .count();
    if (hasRule > 0) continue;

    const hasPendingProposal = await db.action_proposals
      .where("commitmentId").equals(commitment.id)
      .filter((p) => p.status === "pending")
      .count();
    if (hasPendingProposal > 0) continue;

    const daysOld = Math.round((now.getTime() - new Date(commitment.createdAt).getTime()) / 86_400_000);
    const description = commitment.direction === "assigned_to_me"
      ? `You were assigned this ${daysOld} days ago — want to start or delegate?`
      : `You promised this ${daysOld} days ago — want to send an update?`;

    try {
      const draftResult = await generateDraft({
        commitmentId: commitment.id,
        proposalId: null,
        platform: "slack",
        recipient: commitment.context,
        subject: null,
        tone: "professional",
        instruction: description,
      });

      const proposalId = await createProposal(
        commitment.id,
        "send_message",
        description,
        {
          platform: "slack",
          recipient: commitment.context,
          subject: null,
          draftId: draftResult.draftId,
        },
        "follow_up_engine",
      );

      await db.drafts.update(draftResult.draftId, {
        proposalId,
        updatedAt: new Date().toISOString(),
      });

      // Create a follow-up rule to track this
      await setFollowUpRule(commitment.id, new Date(Date.now() + 48 * 3600_000).toISOString());
    } catch (err) {
      await logStatus("warn", "worker", `Stale commitment follow-up failed for ${commitment.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
