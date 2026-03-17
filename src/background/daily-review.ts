import { db } from "@shared/db";
import { CLAUDE_MODEL_FAST, API_TIMEOUT_MS, API_MAX_RETRIES, API_RETRY_DELAY_MS } from "@shared/constants";
import type { DailyReview } from "@shared/types";
import { logStatus } from "@shared/status";
import { getUserProfile } from "@shared/user-profile";

// ─── Claude API Call ───

async function callClaudeForReview(prompt: string): Promise<unknown> {
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
        await logStatus("warn", "daily-review", `Rate limited — retrying in ${delay / 1000}s`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      break;
    } catch (err) {
      if (err instanceof DOMException && err.name === "TimeoutError") {
        if (attempt < API_MAX_RETRIES) {
          await logStatus("warn", "daily-review", `Timed out — retrying (attempt ${attempt + 1})`);
          continue;
        }
        throw new Error(`Claude API timed out after ${API_TIMEOUT_MS / 1000}s`);
      }
      throw err;
    }
  }

  if (!response) throw new Error("Claude API failed after all retries");

  if (!response.ok) {
    const errorText = await response.text();
    if (response.status === 401) {
      throw new Error("Invalid API key — check your Anthropic API key in Settings");
    }
    if (response.status === 429) {
      throw new Error("Claude API rate limit — too many requests");
    }
    throw new Error(`Claude API error (${response.status}): ${errorText.slice(0, 200)}`);
  }

  const data = await response.json();
  const textBlock = data.content?.find((b: { type: string }) => b.type === "text");
  if (!textBlock?.text) throw new Error("No text content in response");

  let cleaned = textBlock.text.trim().replace(/^```json?\s*/, "").replace(/\s*```$/, "");
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace > 0 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }
  return JSON.parse(cleaned);
}

// ─── Main Review Generator ───

export async function generateDailyReview(): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);

  // Check if review already exists for today
  const existing = await db.daily_reviews.where("date").equals(today).first();
  if (existing) return;

  // Check if API key is available
  const settings = await chrome.storage.local.get("anthropicApiKey");
  if (!settings.anthropicApiKey) {
    await logStatus("warn", "daily-review", "Cannot generate review — no API key");
    return;
  }

  await logStatus("info", "daily-review", "Generating end-of-day review...");

  try {
    // Get commitments marked done today
    const todayStart = new Date(today + "T00:00:00").toISOString();
    const todayEnd = new Date(today + "T23:59:59").toISOString();
    const doneToday = await db.action_log
      .where("action").equals("done")
      .filter(a => a.createdAt >= todayStart && a.createdAt <= todayEnd)
      .toArray();

    const completedIds = doneToday.map(a => a.commitmentId);
    const completedCommitments = completedIds.length > 0
      ? await db.commitments.where("id").anyOf(completedIds).toArray()
      : [];

    // Get today's morning brief for comparison
    const brief = await db.briefs.where("date").equals(today).first();

    // Build prompt
    const profile = await getUserProfile();
    const userName = profile.userName || "the user";

    const plannedSection = brief?.priorities && brief.priorities.length > 0
      ? brief.priorities.map(p => `- ${p.text} (${p.action}${p.suggestedTime ? `, suggested: ${p.suggestedTime}` : ""})`).join("\n")
      : "No morning brief was generated today.";

    const completedSection = completedCommitments.length > 0
      ? completedCommitments.map(c => `- ${c.text} (${c.context}, ${c.urgency} urgency)`).join("\n")
      : "No commitments were completed today.";

    // Count remaining open items
    const openCount = await db.commitments
      .where("status")
      .anyOf("new", "snoozed", "actioned")
      .count();

    const prompt = `You are a personal productivity assistant for ${userName}. It's the end of the day on ${today}.

Here is what was PLANNED for today (from the morning brief):
${plannedSection}

Here is what was COMPLETED today:
${completedSection}

Open commitments remaining: ${openCount}

Generate an end-of-day reflection. Compare what was planned vs. what was actually completed. Note any patterns you observe (e.g., always finishing early, consistently deferring certain types of tasks, tackling unplanned items instead of planned ones, etc.).

Return ONLY valid JSON (no markdown fences):
{
  "reflection": "A 2-3 sentence reflection comparing planned vs actual, written in second person (you/your). Be honest but encouraging.",
  "patterns": ["Optional array of 1-2 observed patterns, or empty array if nothing notable"]
}`;

    const rawResponse = await callClaudeForReview(prompt) as {
      reflection: string;
      patterns?: string[];
    };

    // Validate response shape
    if (typeof rawResponse.reflection !== "string" || !rawResponse.reflection) {
      throw new Error("Invalid response: missing reflection field");
    }

    // Include patterns in the reflection if provided
    let reflection = rawResponse.reflection;
    if (rawResponse.patterns && rawResponse.patterns.length > 0) {
      reflection += "\n\nPatterns noticed: " + rawResponse.patterns.join("; ");
    }

    const review: DailyReview = {
      date: today,
      completedItems: completedIds,
      reflection,
      userNotes: null,
      createdAt: new Date().toISOString(),
    };
    await db.daily_reviews.add(review);

    await logStatus("success", "daily-review", `EOD review generated: ${completedIds.length} items completed`);
  } catch (err) {
    await logStatus("error", "daily-review", `Review generation failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
