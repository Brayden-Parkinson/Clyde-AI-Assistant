import { db } from "@shared/db";
import {
  CLAUDE_MODEL_FAST,
  API_TIMEOUT_MS,
  API_MAX_RETRIES,
  API_RETRY_DELAY_MS,
} from "@shared/constants";
import type { WeeklyDigest, WorkPattern } from "@shared/types";
import { logStatus } from "@shared/status";
import { computeWorkStats } from "./pattern-detector";

// ─── Week helpers ───

/** Get Monday 00:00:00Z of the current week as ISO string */
export function getWeekStart(): string {
  const now = new Date();
  const day = now.getUTCDay(); // 0=Sun, 1=Mon, ...
  const diff = day === 0 ? 6 : day - 1; // days since Monday
  const monday = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - diff,
    0, 0, 0, 0
  ));
  return monday.toISOString();
}

/** Format a week start date for display (e.g. "Mar 10, 2026") */
function formatWeekLabel(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ─── Claude API call ───

async function callClaudeForDigest(prompt: string): Promise<unknown> {
  const result = await chrome.storage.local.get("anthropicApiKey");
  const apiKey = result.anthropicApiKey as string | undefined;
  if (!apiKey) throw new Error("No API key configured");

  let response: Response | undefined;
  for (let attempt = 0; attempt <= API_MAX_RETRIES; attempt++) {
    try {
      response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: CLAUDE_MODEL_FAST,
          max_tokens: 1024,
          messages: [{ role: "user", content: prompt }],
        }),
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      });

      if (response.status === 429 && attempt < API_MAX_RETRIES) {
        const delay = API_RETRY_DELAY_MS * (attempt + 1);
        await logStatus("warn", "worker", `Weekly digest rate limited — retrying in ${delay / 1000}s`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      break;
    } catch (err) {
      if (err instanceof DOMException && err.name === "TimeoutError" && attempt < API_MAX_RETRIES) {
        await logStatus("warn", "worker", `Weekly digest timed out — retrying (attempt ${attempt + 1})`);
        continue;
      }
      throw err;
    }
  }

  if (!response) throw new Error("API failed after retries");
  if (!response.ok) {
    const errorText = await response.text();
    if (response.status === 401) throw new Error("Invalid API key");
    if (response.status === 429) throw new Error("Rate limited");
    throw new Error(`API ${response.status}: ${errorText.slice(0, 200)}`);
  }

  const data = await response.json();
  const text = data.content?.find((b: { type: string }) => b.type === "text")?.text;
  if (!text) throw new Error("No text in response");

  let cleaned = text.trim().replace(/^```json?\s*/, "").replace(/\s*```$/, "");
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first > 0 && last > first) cleaned = cleaned.slice(first, last + 1);
  return JSON.parse(cleaned);
}

// ─── Main digest generator ───

export async function generateWeeklyDigest(): Promise<WeeklyDigest | null> {
  const weekStart = getWeekStart();

  // Check if digest already exists for this week
  const existing = await db.weekly_digests
    .where("weekStart")
    .equals(weekStart)
    .first();
  if (existing) {
    await logStatus("info", "worker", `Weekly digest already exists for week of ${formatWeekLabel(weekStart)}`);
    return existing;
  }

  await logStatus("info", "worker", "Generating weekly digest...");

  try {
    // Compute this week's stats
    const stats = await computeWorkStats(1);
    const totalThisWeek = [...stats.commitmentsByWeek.values()].reduce((a, b) => a + b, 0);

    // Also get last week's stats for comparison
    const prevStats = await computeWorkStats(2);

    // Get the week cutoff
    const weekCutoff = weekStart;
    const nowIso = new Date().toISOString();

    // Count completed/added/overdue this week
    const thisWeekCommitments = await db.commitments
      .where("createdAt")
      .between(weekCutoff, nowIso)
      .toArray();

    const completed = thisWeekCommitments.filter(c => c.status === "done").length;
    const added = thisWeekCommitments.length;
    const overdue = thisWeekCommitments.filter(
      c => c.deadline != null && c.deadline < nowIso && c.status !== "done" && c.status !== "dismissed"
    ).length;

    // Get patterns detected this week
    const thisWeekPatterns = await db.work_patterns.toArray().then(all =>
      all.filter(p => new Date(p.createdAt) >= new Date(weekCutoff))
    );

    // Format stats for Claude
    const statsLines: string[] = [
      `Completed: ${completed}`,
      `Added: ${added}`,
      `Overdue: ${overdue}`,
      `Completion rate: ${(stats.completionRate * 100).toFixed(0)}%`,
      `Previous week completion rate: ${(prevStats.completionRate * 100).toFixed(0)}%`,
      `Total active this week: ${totalThisWeek}`,
    ];

    if (stats.commitmentsBySource.size > 0) {
      statsLines.push(`Sources: ${[...stats.commitmentsBySource.entries()].map(([k, v]) => `${k}(${v})`).join(", ")}`);
    }

    const patternSummaries = thisWeekPatterns.map(p => `- [${p.sentiment}] ${p.description}`);

    const prompt = `Summarize this week's work in 3-4 sentences for a busy professional.

Stats:
${statsLines.join("\n")}

Patterns detected:
${patternSummaries.length > 0 ? patternSummaries.join("\n") : "None detected yet."}

Focus on what changed from last week and what needs attention next week.
Be specific and concise. No fluff.
Return JSON: { "summary": "...", "suggested_focus": ["...", "..."] }`;

    const rawResponse = await callClaudeForDigest(prompt) as {
      summary?: string;
      suggested_focus?: string[];
    };

    // Validate response
    const summary = typeof rawResponse.summary === "string"
      ? rawResponse.summary
      : `${completed} completed, ${added} new, ${overdue} overdue this week.`;

    const suggestedFocus = Array.isArray(rawResponse.suggested_focus)
      ? rawResponse.suggested_focus.filter((s): s is string => typeof s === "string").slice(0, 5)
      : [];

    const digest: WeeklyDigest = {
      weekStart,
      completed,
      added,
      overdue,
      patterns: thisWeekPatterns,
      summary,
      suggestedFocus,
      createdAt: new Date().toISOString(),
    };

    const id = await db.weekly_digests.add(digest);
    const stored = { ...digest, id: id as number };

    await logStatus("success", "worker", `Weekly digest generated for week of ${formatWeekLabel(weekStart)}`);
    return stored;
  } catch (err) {
    await logStatus("error", "worker", `Weekly digest failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

// ─── Query helper ───

export async function getRecentDigests(limit = 4): Promise<WeeklyDigest[]> {
  return db.weekly_digests
    .orderBy("createdAt")
    .reverse()
    .limit(limit)
    .toArray();
}
