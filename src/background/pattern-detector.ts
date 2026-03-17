import { db } from "@shared/db";
import {
  CLAUDE_MODEL_FAST,
  API_TIMEOUT_MS,
  API_MAX_RETRIES,
  API_RETRY_DELAY_MS,
  WORK_PATTERN_TTL_MS,
} from "@shared/constants";
import type { WorkPattern, WorkPatternType } from "@shared/types";
import { logStatus } from "@shared/status";

// ─── Types ───

export interface WorkStats {
  commitmentsByWeek: Map<string, number>;
  avgNewPerWeek: number;
  thisWeekNew: number;
  completionRate: number;
  completionRateByDirection: { by_me: number; assigned_to_me: number };
  commitmentsBySource: Map<string, number>;
  commitmentsByContext: Map<string, number>;
  deadlineHitRate: number;
  overdueCount: number;
  avgTimeInNewMs: number;
  topAssigners: Array<{ person: string; count: number }>;
}

// ─── Week helpers ───

/** Return ISO week string YYYY-WW for a given date */
function getISOWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-${String(weekNo).padStart(2, "0")}`;
}

/** Get date N weeks ago as ISO string */
function weeksAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n * 7);
  return d.toISOString();
}

// ─── Step 1: Pure stat computation ───

export async function computeWorkStats(lookbackWeeks = 4): Promise<WorkStats> {
  const cutoff = weeksAgo(lookbackWeeks);
  const allCommitments = await db.commitments
    .where("createdAt")
    .above(cutoff)
    .toArray();

  const now = new Date();
  const thisWeek = getISOWeek(now);

  // Commitments by week
  const commitmentsByWeek = new Map<string, number>();
  for (const c of allCommitments) {
    const week = getISOWeek(new Date(c.createdAt));
    commitmentsByWeek.set(week, (commitmentsByWeek.get(week) ?? 0) + 1);
  }

  // Average new per week
  const weekCounts = [...commitmentsByWeek.values()];
  const avgNewPerWeek = weekCounts.length > 0
    ? weekCounts.reduce((a, b) => a + b, 0) / weekCounts.length
    : 0;

  // This week's new count
  const thisWeekNew = commitmentsByWeek.get(thisWeek) ?? 0;

  // Completion rate (overall)
  const completed = allCommitments.filter(c => c.status === "done").length;
  const completionRate = allCommitments.length > 0 ? completed / allCommitments.length : 0;

  // Completion rate by direction
  const byMe = allCommitments.filter(c => c.direction === "by_me");
  const assignedToMe = allCommitments.filter(c => c.direction === "assigned_to_me");
  const completionRateByDirection = {
    by_me: byMe.length > 0 ? byMe.filter(c => c.status === "done").length / byMe.length : 0,
    assigned_to_me: assignedToMe.length > 0
      ? assignedToMe.filter(c => c.status === "done").length / assignedToMe.length
      : 0,
  };

  // By source
  const commitmentsBySource = new Map<string, number>();
  for (const c of allCommitments) {
    commitmentsBySource.set(c.source_type, (commitmentsBySource.get(c.source_type) ?? 0) + 1);
  }

  // By context
  const commitmentsByContext = new Map<string, number>();
  for (const c of allCommitments) {
    commitmentsByContext.set(c.context, (commitmentsByContext.get(c.context) ?? 0) + 1);
  }

  // Deadline hit rate
  const withDeadline = allCommitments.filter(c => c.deadline != null);
  const deadlineMet = withDeadline.filter(c => {
    if (c.status !== "done") return false;
    // Check if completed action_log entry exists before deadline
    // Approximate: if status is "done" and deadline hasn't passed, count as met
    return new Date(c.deadline!) >= new Date(c.createdAt);
  });
  const deadlineHitRate = withDeadline.length > 0
    ? deadlineMet.length / withDeadline.length
    : 0;

  // Overdue count (active commitments past deadline)
  const nowIso = now.toISOString();
  const overdueCount = allCommitments.filter(
    c => c.deadline != null && c.deadline < nowIso && c.status !== "done" && c.status !== "dismissed"
  ).length;

  // Average time in "new" status (for items that have moved out of "new")
  const movedFromNew = allCommitments.filter(
    c => c.status !== "new" && c.status !== "dismissed"
  );
  let avgTimeInNewMs = 0;
  if (movedFromNew.length > 0) {
    // Approximate using action_log for status transitions
    const actionLog = await db.action_log
      .where("createdAt")
      .above(cutoff)
      .toArray();

    const firstActionByCommitment = new Map<number, string>();
    for (const a of actionLog) {
      if (a.action === "started" || a.action === "done") {
        const existing = firstActionByCommitment.get(a.commitmentId);
        if (!existing || a.createdAt < existing) {
          firstActionByCommitment.set(a.commitmentId, a.createdAt);
        }
      }
    }

    let totalMs = 0;
    let count = 0;
    for (const c of movedFromNew) {
      if (c.id == null) continue;
      const actionTime = firstActionByCommitment.get(c.id);
      if (actionTime) {
        totalMs += new Date(actionTime).getTime() - new Date(c.createdAt).getTime();
        count++;
      }
    }
    avgTimeInNewMs = count > 0 ? totalMs / count : 0;
  }

  // Top assigners (from context field for assigned_to_me commitments)
  const assignerCounts = new Map<string, number>();
  for (const c of allCommitments.filter(c => c.direction === "assigned_to_me")) {
    assignerCounts.set(c.context, (assignerCounts.get(c.context) ?? 0) + 1);
  }
  const topAssigners = [...assignerCounts.entries()]
    .map(([person, count]) => ({ person, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return {
    commitmentsByWeek,
    avgNewPerWeek,
    thisWeekNew,
    completionRate,
    completionRateByDirection,
    commitmentsBySource,
    commitmentsByContext,
    deadlineHitRate,
    overdueCount,
    avgTimeInNewMs,
    topAssigners,
  };
}

// ─── Format stats for Claude prompt ───

function formatStatsForPrompt(stats: WorkStats): string {
  const lines: string[] = [];

  lines.push(`New commitments this week: ${stats.thisWeekNew}`);
  lines.push(`Average new per week: ${stats.avgNewPerWeek.toFixed(1)}`);
  lines.push(`Overall completion rate: ${(stats.completionRate * 100).toFixed(0)}%`);
  lines.push(`Completion rate (my commitments): ${(stats.completionRateByDirection.by_me * 100).toFixed(0)}%`);
  lines.push(`Completion rate (assigned to me): ${(stats.completionRateByDirection.assigned_to_me * 100).toFixed(0)}%`);
  lines.push(`Deadline hit rate: ${(stats.deadlineHitRate * 100).toFixed(0)}%`);
  lines.push(`Currently overdue: ${stats.overdueCount}`);
  lines.push(`Avg time in 'new' status: ${stats.avgTimeInNewMs > 0 ? `${(stats.avgTimeInNewMs / 3600000).toFixed(1)} hours` : "N/A"}`);

  if (stats.commitmentsBySource.size > 0) {
    lines.push(`\nBy source:`);
    for (const [src, count] of stats.commitmentsBySource) {
      lines.push(`  ${src}: ${count}`);
    }
  }

  if (stats.commitmentsByContext.size > 0) {
    const topContexts = [...stats.commitmentsByContext.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
    lines.push(`\nTop contexts:`);
    for (const [ctx, count] of topContexts) {
      lines.push(`  ${ctx}: ${count}`);
    }
  }

  if (stats.topAssigners.length > 0) {
    lines.push(`\nTop people assigning to me:`);
    for (const { person, count } of stats.topAssigners) {
      lines.push(`  ${person}: ${count}`);
    }
  }

  const weekEntries = [...stats.commitmentsByWeek.entries()].sort();
  if (weekEntries.length > 1) {
    lines.push(`\nWeekly trend:`);
    for (const [week, count] of weekEntries) {
      lines.push(`  ${week}: ${count} new`);
    }
  }

  return lines.join("\n");
}

// ─── Claude API call ───

async function callClaudeForPatterns(prompt: string): Promise<unknown> {
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
        await logStatus("warn", "worker", `Pattern detection rate limited — retrying in ${delay / 1000}s`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      break;
    } catch (err) {
      if (err instanceof DOMException && err.name === "TimeoutError" && attempt < API_MAX_RETRIES) {
        await logStatus("warn", "worker", `Pattern detection timed out — retrying (attempt ${attempt + 1})`);
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

// ─── Validation ───

const VALID_TYPES: WorkPatternType[] = [
  "time_allocation", "completion_rate", "deadline_adherence",
  "procrastination", "overcommitment", "bottleneck", "priority_mismatch",
];

const VALID_SENTIMENTS = ["positive", "neutral", "concerning"] as const;

interface RawPattern {
  description?: string;
  type?: string;
  confidence?: number;
  sentiment?: string;
  suggestion?: string | null;
  evidence_ids?: number[];
  reinforces_id?: number | null;
}

function validatePattern(raw: RawPattern): Omit<WorkPattern, "id" | "createdAt"> | null {
  if (!raw.description || typeof raw.description !== "string") return null;
  if (!raw.type || !VALID_TYPES.includes(raw.type as WorkPatternType)) return null;

  const confidence = typeof raw.confidence === "number"
    ? Math.max(0, Math.min(1, raw.confidence))
    : 0.5;

  const sentiment = VALID_SENTIMENTS.includes(raw.sentiment as typeof VALID_SENTIMENTS[number])
    ? (raw.sentiment as "positive" | "neutral" | "concerning")
    : "neutral";

  const thisWeek = getISOWeek(new Date());

  return {
    description: raw.description,
    type: raw.type as WorkPatternType,
    evidenceIds: Array.isArray(raw.evidence_ids) ? raw.evidence_ids.filter(id => typeof id === "number") : [],
    confidence,
    sentiment,
    suggestion: typeof raw.suggestion === "string" ? raw.suggestion : null,
    acknowledged: false,
    detectedWeek: thisWeek,
  };
}

// ─── Step 2: Main detection function ───

export async function detectPatterns(): Promise<WorkPattern[]> {
  await logStatus("info", "worker", "Starting pattern detection...");

  try {
    // Compute stats over 4 weeks
    const stats = await computeWorkStats(4);

    // Check if we have enough data
    const totalCommitments = [...stats.commitmentsByWeek.values()].reduce((a, b) => a + b, 0);
    if (totalCommitments < 3) {
      await logStatus("info", "worker", "Not enough data for pattern detection (need 3+ commitments)");
      return [];
    }

    // Load existing active patterns
    const existingPatterns = await db.work_patterns
      .where("acknowledged")
      .equals(0) // Dexie stores booleans as 0/1
      .toArray()
      .catch(() =>
        // Fallback: get all and filter in JS if index doesn't exist on acknowledged
        db.work_patterns.toArray().then(all => all.filter(p => !p.acknowledged))
      );

    const existingList = existingPatterns.map(p => ({
      id: p.id,
      description: p.description,
      type: p.type,
      confidence: p.confidence,
      sentiment: p.sentiment,
    }));

    const formattedStats = formatStatsForPrompt(stats);

    const prompt = `You are analyzing 4 weeks of work statistics for a professional.
Your job is to identify notable PATTERNS — both positive trends and concerning signals.

COMPUTED STATISTICS:
${formattedStats}

PREVIOUSLY DETECTED PATTERNS (still active):
${existingList.length > 0 ? JSON.stringify(existingList, null, 2) : "None yet."}

INSTRUCTIONS:
Identify 2-5 notable patterns. For each:
{
  "description": "Clear, specific observation",
  "type": "time_allocation|completion_rate|deadline_adherence|procrastination|overcommitment|bottleneck|priority_mismatch",
  "confidence": 0.0-1.0,
  "sentiment": "positive|neutral|concerning",
  "suggestion": "One concrete action (or null)",
  "evidence_ids": [],
  "reinforces_id": null
}

If a pattern matches an existing one above, set "reinforces_id" to its id instead of creating a duplicate.

RULES:
- Only flag patterns with real evidence from the statistics
- Confidence based on evidence strength (more weeks of data = higher confidence)
- Suggestions must be specific and actionable
- Do NOT invent patterns that aren't supported by the numbers
Return ONLY valid JSON: { "patterns": [...] }`;

    const rawResponse = await callClaudeForPatterns(prompt) as {
      patterns?: RawPattern[];
    };

    if (!rawResponse.patterns || !Array.isArray(rawResponse.patterns)) {
      await logStatus("warn", "worker", "Pattern detection returned invalid response shape");
      return [];
    }

    const thisWeek = getISOWeek(new Date());
    const now = new Date().toISOString();
    const newPatterns: WorkPattern[] = [];

    for (const raw of rawResponse.patterns) {
      // Handle reinforcement of existing pattern
      if (raw.reinforces_id != null) {
        const existing = existingPatterns.find(p => p.id === raw.reinforces_id);
        if (existing?.id != null) {
          const newConfidence = Math.min(1, existing.confidence + 0.1);
          await db.work_patterns.update(existing.id, { confidence: newConfidence });
          await logStatus("info", "worker", `Reinforced pattern #${existing.id}: confidence → ${newConfidence.toFixed(2)}`);
          continue;
        }
      }

      // Validate and insert new pattern
      const validated = validatePattern(raw);
      if (!validated) continue;

      const pattern: WorkPattern = {
        ...validated,
        detectedWeek: thisWeek,
        createdAt: now,
      };

      const id = await db.work_patterns.add(pattern);
      newPatterns.push({ ...pattern, id: id as number });
    }

    // Cleanup: delete patterns older than TTL
    const ttlCutoff = new Date(Date.now() - WORK_PATTERN_TTL_MS).toISOString();
    const staleCount = await db.work_patterns
      .where("createdAt")
      .below(ttlCutoff)
      .delete();

    if (staleCount > 0) {
      await logStatus("info", "worker", `Cleaned up ${staleCount} stale patterns`);
    }

    await logStatus("success", "worker", `Pattern detection complete: ${newPatterns.length} new patterns`);
    return newPatterns;
  } catch (err) {
    await logStatus("error", "worker", `Pattern detection failed: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}
