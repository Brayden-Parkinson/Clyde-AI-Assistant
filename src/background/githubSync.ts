/**
 * Orchestrates syncing GitHub PR data for all configured repos into IndexedDB.
 * Called by the service-worker alarm (every 6h) and manually from the popup.
 */

import { db } from "@shared/db";
import type { PRMetric, CopilotDailyMetric } from "@shared/types";
import {
  fetchMergedPRs,
  fetchPRDetails,
  fetchPRReviews,
  fetchPRCommits,
  fetchReleases,
  fetchCopilotMetrics,
  detectAITools,
} from "./githubClient";

/** How far back to look for PRs on a fresh sync (90 days) */
const DEFAULT_LOOKBACK_DAYS = 90;

/** Max PRs to enrich with detail/review/commit calls per sync (keeps it fast) */
const MAX_ENRICH_PER_SYNC = 30;

function daysAgoISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

/**
 * Sync GitHub PR data for all configured repos.
 * Returns a summary of what was synced or any errors.
 */
export async function syncGitHubData(): Promise<{
  synced: number;
  total: number;
  errors: string[];
}> {
  const result = await chrome.storage.local.get([
    "githubToken",
    "githubRepos",
    "githubOrg",
  ]);

  const token = result.githubToken as string | undefined;
  const repos = result.githubRepos as string[] | undefined;
  const org = result.githubOrg as string | undefined;

  if (!token) {
    return { synced: 0, total: 0, errors: ["No GitHub token configured"] };
  }
  if (!repos?.length) {
    return { synced: 0, total: 0, errors: ["No GitHub repos configured"] };
  }

  let synced = 0;
  let totalFound = 0;
  const errors: string[] = [];
  const syncedAt = new Date().toISOString();
  const since = daysAgoISO(DEFAULT_LOOKBACK_DAYS);

  for (const repo of repos) {
    try {
      const pulls = await fetchMergedPRs(token, repo, since);
      totalFound += pulls.length;

      // Filter out PRs we already have
      const newPulls: typeof pulls = [];
      for (const pull of pulls) {
        const existing = await db.pr_metrics
          .where("[repo+prNumber]")
          .equals([repo, pull.number])
          .first()
          .catch(() => undefined);
        if (!existing) newPulls.push(pull);
      }

      // Cap enrichment calls to keep sync fast
      const toEnrich = newPulls.slice(0, MAX_ENRICH_PER_SYNC);

      for (const pull of toEnrich) {
        try {
          // Fetch detail + reviews + commits in parallel
          const [detail, reviews, commits] = await Promise.all([
            fetchPRDetails(token, repo, pull.number),
            fetchPRReviews(token, repo, pull.number),
            fetchPRCommits(token, repo, pull.number),
          ]);

          const createdAt = pull.created_at;
          const mergedAt = pull.merged_at;

          const cycleTimeHours =
            mergedAt
              ? (new Date(mergedAt).getTime() - new Date(createdAt).getTime()) /
                (1000 * 60 * 60)
              : null;

          const reviewTimes = reviews
            .map((r) => new Date(r.submitted_at).getTime())
            .filter((t) => !isNaN(t));
          const firstReviewMs =
            reviewTimes.length > 0 ? Math.min(...reviewTimes) : null;
          const timeToFirstReviewHours =
            firstReviewMs !== null
              ? (firstReviewMs - new Date(createdAt).getTime()) /
                (1000 * 60 * 60)
              : null;

          const reviewDays = new Set(
            reviews.map((r) => r.submitted_at.slice(0, 10)),
          );

          const commitMessages = commits.map((c) => c.commit.message);
          const aiTools = detectAITools(pull.body, commitMessages);

          const metric: PRMetric = {
            repo,
            prNumber: pull.number,
            title: pull.title,
            branch: pull.head?.ref ?? null,
            createdAt,
            mergedAt,
            cycleTimeHours,
            timeToFirstReviewHours,
            reviewRounds: reviewDays.size,
            additions: detail.additions,
            deletions: detail.deletions,
            changedFiles: detail.changed_files,
            aiAssisted: aiTools.length > 0,
            aiTools,
            syncedAt,
          };

          await db.pr_metrics.add(metric);
          synced++;
        } catch (prErr) {
          errors.push(`PR #${pull.number}: ${String(prErr)}`);
          // Stop enriching if we hit rate limits
          if (String(prErr).includes("403") || String(prErr).includes("429")) {
            errors.push("Rate limited — will continue on next sync");
            break;
          }
        }
      }

      // For PRs beyond the enrichment cap, store basic metrics from the list data
      // (cycle time is still computable — just no size/review/AI data)
      for (const pull of newPulls.slice(MAX_ENRICH_PER_SYNC)) {
        try {
          const createdAt = pull.created_at;
          const mergedAt = pull.merged_at;
          const cycleTimeHours =
            mergedAt
              ? (new Date(mergedAt).getTime() - new Date(createdAt).getTime()) /
                (1000 * 60 * 60)
              : null;

          await db.pr_metrics.add({
            repo,
            prNumber: pull.number,
            title: pull.title,
            branch: pull.head?.ref ?? null,
            createdAt,
            mergedAt,
            cycleTimeHours,
            timeToFirstReviewHours: null,
            reviewRounds: 0,
            additions: 0,
            deletions: 0,
            changedFiles: 0,
            aiAssisted: false,
            aiTools: [],
            syncedAt,
          });
          synced++;
        } catch {
          // duplicate or other write error — skip silently
        }
      }
    } catch (repoErr) {
      errors.push(`${repo}: ${String(repoErr)}`);
    }
  }

  // Sync Copilot metrics if org is configured
  if (org) {
    try {
      const metrics = await fetchCopilotMetrics(token, org);
      for (const m of metrics) {
        const existing = await db.copilot_metrics
          .where("date")
          .equals(m.date)
          .first()
          .catch(() => undefined);

        const record: CopilotDailyMetric = {
          date: m.date,
          totalActiveUsers: m.total_active_users,
          totalEngagedUsers: m.total_engaged_users,
          totalChats: m.copilot_ide_chat?.total_chats ?? 0,
          syncedAt,
        };

        if (existing?.id != null) {
          await db.copilot_metrics.update(existing.id, record);
        } else {
          await db.copilot_metrics.add(record);
        }
      }
    } catch (copilotErr) {
      // Copilot API often 403s/404s without the right plan — don't treat as fatal
      const copilotErrStr = String(copilotErr);
      if (!copilotErrStr.includes("403") && !copilotErrStr.includes("404")) {
        errors.push(`Copilot: ${copilotErrStr}`);
      }
    }
  }

  await chrome.storage.local.set({ githubLastSynced: syncedAt });
  return { synced, total: totalFound, errors };
}

/**
 * Fetch releases for all configured repos and return releases/week over the
 * last 90 days. Used for the Deploy Frequency KPI card.
 */
export async function getDeployFrequency(): Promise<number> {
  const result = await chrome.storage.local.get([
    "githubToken",
    "githubRepos",
  ]);
  const token = result.githubToken as string | undefined;
  const repos = result.githubRepos as string[] | undefined;
  if (!token || !repos?.length) return 0;

  const since = new Date(daysAgoISO(90)).getTime();
  let totalReleases = 0;

  for (const repo of repos) {
    try {
      const releases = await fetchReleases(token, repo);
      totalReleases += releases.filter(
        (r) => new Date(r.published_at).getTime() >= since,
      ).length;
    } catch {
      // non-fatal
    }
  }

  return totalReleases / 13; // 90 days ≈ 13 weeks
}
