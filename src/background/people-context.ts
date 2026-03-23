import { db } from "@shared/db";
import type { Commitment, PersonContext } from "@shared/types";
import { logStatus } from "@shared/status";

/**
 * Get commitments related to a person (by sender match or context mention).
 * Shared logic extracted from PeoplePanel's inline version.
 */
export function getPersonCommitments(personName: string, allCommitments: Commitment[]): Commitment[] {
  const nameLower = personName.toLowerCase();
  return allCommitments.filter(c =>
    c.conversation_messages?.some(m => m.sender.toLowerCase() === nameLower) ||
    c.context.toLowerCase().includes(nameLower)
  );
}

/**
 * Compute PersonContext for all people in the DB.
 * Called on PEOPLE_CONTEXT alarm (every 4h) and after SCAN_PEOPLE.
 */
export async function computePeopleContext(): Promise<void> {
  const people = await db.people.toArray();
  if (people.length === 0) return;

  const allCommitments = await db.commitments.toArray();
  const actionLog = await db.action_log.toArray();
  const now = new Date().toISOString();

  // Build a map of first action timestamp per commitment for response time calc
  const firstActionMap = new Map<number, string>();
  for (const entry of actionLog) {
    const existing = firstActionMap.get(entry.commitmentId);
    if (!existing || entry.createdAt < existing) {
      firstActionMap.set(entry.commitmentId, entry.createdAt);
    }
  }

  const contexts: PersonContext[] = [];

  for (const person of people) {
    if (person.id == null) continue;

    const commitments = getPersonCommitments(person.name, allCommitments);
    if (commitments.length === 0) continue;

    const completed = commitments.filter(c => c.status === "done");
    const dismissed = commitments.filter(c => c.status === "dismissed");
    const open = commitments.filter(c => ["new", "snoozed", "actioned"].includes(c.status));

    // Completion rate: done / (done + dismissed + open) — excludes dismissed from "success"
    const total = commitments.length;
    const completionRate = total > 0 ? completed.length / total : 0;

    // Overdue rate: commitments past deadline that aren't done/dismissed
    const overdueCount = commitments.filter(c => {
      if (!c.deadline) return false;
      if (c.status === "done" || c.status === "dismissed") return false;
      return new Date(c.deadline).getTime() < Date.now();
    }).length;
    const overdueRate = total > 0 ? overdueCount / total : 0;

    // Avg response days: from commitment creation to first action_log entry
    const responseDays: number[] = [];
    for (const c of commitments) {
      if (c.id == null) continue;
      const firstAction = firstActionMap.get(c.id);
      if (firstAction) {
        const created = new Date(c.createdAt).getTime();
        const acted = new Date(firstAction).getTime();
        const days = (acted - created) / (1000 * 60 * 60 * 24);
        if (days >= 0) responseDays.push(days);
      }
    }
    const avgResponseDays = responseDays.length > 0
      ? Math.round((responseDays.reduce((a, b) => a + b, 0) / responseDays.length) * 10) / 10
      : null;

    // Top channels by frequency
    const channelCounts = new Map<string, number>();
    for (const c of commitments) {
      if (c.context) {
        channelCounts.set(c.context, (channelCounts.get(c.context) || 0) + 1);
      }
    }
    const topChannels = [...channelCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([ch]) => ch);

    // Most recent commitment text
    const sorted = [...commitments].sort((a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    const lastInteractionSummary = sorted[0]?.text ?? null;

    contexts.push({
      personId: person.id,
      completionRate: Math.round(completionRate * 100) / 100,
      overdueRate: Math.round(overdueRate * 100) / 100,
      avgResponseDays,
      totalCommitments: total,
      openCommitments: open.length,
      completedCommitments: completed.length,
      dismissedCommitments: dismissed.length,
      topChannels,
      lastInteractionSummary,
      computedAt: now,
    });
  }

  // Bulk upsert
  await db.people_context.bulkPut(contexts);
  await logStatus("info", "people", `Computed context for ${contexts.length} people`);
}
