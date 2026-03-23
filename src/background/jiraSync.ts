/**
 * Orchestrates syncing Jira ticket data and linking PRs to Jira tickets.
 * Called by the service-worker alarm (every 6h) and manually from the popup.
 */

import { db } from "@shared/db";
import type { JiraTicket, PRJiraLink } from "@shared/types";
import { searchJiraIssues, mapJiraFields } from "./jiraClient";

/** Regex to extract Jira ticket IDs like RAD-1234, ENG-567 */
const TICKET_ID_REGEX = /\b([A-Z]{2,10}-\d+)\b/g;

/** How far back to look for Jira tickets (90 days) */
const DEFAULT_LOOKBACK_DAYS = 90;

/** Broadcast sync progress to popup/UI */
function broadcastProgress(
  phase: "tickets" | "linking",
  current: number,
  total: number,
): void {
  chrome.runtime.sendMessage({
    type: "JIRA_SYNC_PROGRESS",
    phase,
    current,
    total,
  }).catch(() => {
    // No listeners — popup is closed, safe to ignore
  });
}

/**
 * Extract all ticket keys from a string.
 */
function extractTicketKeys(text: string | null): string[] {
  if (!text) return [];
  const matches = text.matchAll(TICKET_ID_REGEX);
  return Array.from(matches, (m) => m[1]);
}

/**
 * Sync Jira tickets for all configured projects.
 */
export async function syncJiraData(): Promise<{
  synced: number;
  total: number;
  linked: number;
  errors: string[];
}> {
  const result = await chrome.storage.local.get([
    "jiraToken",
    "jiraBaseUrl",
    "jiraEmail",
    "jiraProjects",
  ]);

  const token = result.jiraToken as string | undefined;
  const baseUrl = result.jiraBaseUrl as string | undefined;
  const email = result.jiraEmail as string | undefined;
  const projects = result.jiraProjects as string[] | undefined;

  if (!token || !email) {
    console.log("[CT:jira] No Jira credentials configured — skipping");
    return { synced: 0, total: 0, linked: 0, errors: ["No Jira credentials configured"] };
  }
  if (!baseUrl) {
    console.log("[CT:jira] No Jira URL configured — skipping");
    return { synced: 0, total: 0, linked: 0, errors: ["No Jira URL configured"] };
  }
  if (!projects?.length) {
    console.log("[CT:jira] No Jira projects configured — skipping");
    return { synced: 0, total: 0, linked: 0, errors: ["No Jira projects configured"] };
  }

  console.log(`[CT:jira] Starting sync for projects: ${projects.join(", ")}`);

  let synced = 0;
  let totalFound = 0;
  const errors: string[] = [];
  const syncedAt = new Date().toISOString();

  // Phase 1: Sync tickets
  for (const project of projects) {
    try {
      const jql = `project = ${project} AND updated >= "-${DEFAULT_LOOKBACK_DAYS}d" ORDER BY updated DESC`;
      console.log(`[CT:jira] Fetching: ${jql}`);

      const issues = await searchJiraIssues(email, token, baseUrl, jql, (current, total) => {
        if (current % 100 === 0 || current === total) {
          console.log(`[CT:jira] ${project}: ${current}/${total} tickets fetched`);
        }
        broadcastProgress("tickets", current, total);
      });

      totalFound += issues.length;
      console.log(`[CT:jira] ${project}: ${issues.length} tickets found`);

      for (const issue of issues) {
        try {
          const mapped = mapJiraFields(issue);
          const ticket: JiraTicket = { ...mapped, syncedAt };

          // Upsert by key
          const existing = await db.jira_tickets
            .where("key")
            .equals(ticket.key)
            .first()
            .catch(() => undefined);

          if (existing?.id != null) {
            await db.jira_tickets.update(existing.id, ticket);
          } else {
            await db.jira_tickets.add(ticket);
          }
          synced++;
        } catch (issueErr) {
          errors.push(`${issue.key}: ${String(issueErr)}`);
        }
      }
    } catch (projErr) {
      errors.push(`${project}: ${String(projErr)}`);
    }
  }

  console.log(`[CT:jira] Ticket sync done: ${synced} upserted, ${totalFound} total, ${errors.length} errors`);

  // Phase 2: Link PRs to Jira tickets
  console.log("[CT:jira] Starting PR-Jira linking...");
  const linked = await linkPRsToJira();
  console.log(`[CT:jira] Linking done: ${linked} new links created`);

  await chrome.storage.local.set({ jiraLastSynced: syncedAt });
  return { synced, total: totalFound, linked, errors };
}

/**
 * Scan PR metrics and create PR-Jira links based on ticket IDs in title/branch.
 * Only processes PRs that don't already have links.
 */
export async function linkPRsToJira(): Promise<number> {
  const allPRs = await db.pr_metrics.toArray();
  const existingLinks = await db.pr_jira_links.toArray();
  const linkedPRIds = new Set(existingLinks.map((l) => l.prMetricId));

  // Get all known Jira ticket keys for validation
  const allTickets = await db.jira_tickets.toArray();
  const knownKeys = new Set(allTickets.map((t) => t.key));

  const unlinkedPRs = allPRs.filter((pr) => pr.id != null && !linkedPRIds.has(pr.id));
  let linked = 0;

  console.log(`[CT:jira] Linker: ${allPRs.length} PRs total, ${existingLinks.length} already linked, ${unlinkedPRs.length} to scan, ${knownKeys.size} known Jira keys`);
  broadcastProgress("linking", 0, unlinkedPRs.length);

  for (let i = 0; i < unlinkedPRs.length; i++) {
    const pr = unlinkedPRs[i];
    if (pr.id == null) continue;

    const now = new Date().toISOString();

    // Extract from title (primary)
    const titleKeys = extractTicketKeys(pr.title);
    for (const key of titleKeys) {
      if (!knownKeys.has(key)) continue;
      try {
        await db.pr_jira_links.add({
          prMetricId: pr.id,
          jiraTicketKey: key,
          source: "title",
          linkedAt: now,
        });
        linked++;
      } catch {
        // duplicate or write error — skip
      }
    }

    // Extract from branch (secondary) — only add if not already linked from title
    const branchKeys = extractTicketKeys(pr.branch);
    const alreadyLinked = new Set(titleKeys);
    for (const key of branchKeys) {
      if (!knownKeys.has(key) || alreadyLinked.has(key)) continue;
      try {
        await db.pr_jira_links.add({
          prMetricId: pr.id,
          jiraTicketKey: key,
          source: "branch",
          linkedAt: now,
        });
        linked++;
      } catch {
        // duplicate or write error — skip
      }
    }

    if ((i + 1) % 50 === 0 || i === unlinkedPRs.length - 1) {
      broadcastProgress("linking", i + 1, unlinkedPRs.length);
    }
  }

  return linked;
}
