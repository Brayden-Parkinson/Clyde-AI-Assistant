import { db } from "@shared/db";
import { CLAUDE_MODEL, API_TIMEOUT_MS, API_MAX_RETRIES, API_RETRY_DELAY_MS } from "@shared/constants";
import type { MorningBrief, BriefPriority, BriefSuggestedMove, BriefHeadsUpItem } from "@shared/types";
import { logStatus } from "@shared/status";
import { getUserProfile } from "@shared/user-profile";

// ─── ICS Parsing ───

interface CalendarEvent {
  title: string;
  start: string; // ISO or time string
  end: string;
}

function parseIcsEvents(icsText: string): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  const eventBlocks = icsText.split("BEGIN:VEVENT");

  const today = new Date().toISOString().slice(0, 10).replace(/-/g, ""); // YYYYMMDD

  for (let i = 1; i < eventBlocks.length; i++) {
    const block = eventBlocks[i];

    // Extract SUMMARY
    const summaryMatch = block.match(/^SUMMARY[^:]*:(.*)/m);
    const title = summaryMatch ? summaryMatch[1].trim().replace(/\\n/g, " ").replace(/\\/g, "") : "Untitled";

    // Extract DTSTART (handles DTSTART:, DTSTART;TZID=...:, DTSTART;VALUE=DATE:)
    const startMatch = block.match(/^DTSTART[^:]*:(.*)/m);
    const endMatch = block.match(/^DTEND[^:]*:(.*)/m);

    if (!startMatch) continue;

    const startRaw = startMatch[1].trim();
    const endRaw = endMatch ? endMatch[1].trim() : startRaw;

    // Check if this event is today
    const startDate = startRaw.slice(0, 8); // YYYYMMDD
    if (startDate !== today) continue;

    // Format start time for display
    let startFormatted = startRaw;
    let endFormatted = endRaw;
    if (startRaw.length >= 15) {
      // Has time: YYYYMMDDTHHMMSSZ or YYYYMMDDTHHMMSS
      const hour = parseInt(startRaw.slice(9, 11), 10);
      const minute = startRaw.slice(11, 13);
      const period = hour >= 12 ? "PM" : "AM";
      const h12 = hour % 12 || 12;
      startFormatted = `${h12}:${minute} ${period}`;

      if (endRaw.length >= 15) {
        const eHour = parseInt(endRaw.slice(9, 11), 10);
        const eMinute = endRaw.slice(11, 13);
        const ePeriod = eHour >= 12 ? "PM" : "AM";
        const e12 = eHour % 12 || 12;
        endFormatted = `${e12}:${eMinute} ${ePeriod}`;
      }
    } else {
      // All-day event
      startFormatted = "All day";
      endFormatted = "All day";
    }

    events.push({ title, start: startFormatted, end: endFormatted });
  }

  return events;
}

// ─── Calendar Fetch ───

async function fetchCalendarEvents(): Promise<CalendarEvent[]> {
  const result = await chrome.storage.local.get("calendarIcsUrl");
  const icsUrl = result.calendarIcsUrl as string | undefined;
  if (!icsUrl) return [];

  try {
    const response = await fetch(icsUrl, { signal: AbortSignal.timeout(API_TIMEOUT_MS) });
    if (!response.ok) {
      await logStatus("warn", "morning-brief", `Calendar fetch failed: ${response.status}`);
      return [];
    }
    const icsText = await response.text();
    return parseIcsEvents(icsText);
  } catch (err) {
    await logStatus("warn", "morning-brief", `Calendar fetch error: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

// ─── Claude API Call ───

async function callClaudeForBrief(prompt: string): Promise<unknown> {
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
          model: CLAUDE_MODEL,
          max_tokens: 2048,
          messages: [{ role: "user", content: prompt }],
        }),
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      });

      if (response.status === 429 && attempt < API_MAX_RETRIES) {
        const delay = API_RETRY_DELAY_MS * (attempt + 1);
        await logStatus("warn", "morning-brief", `Rate limited — retrying in ${delay / 1000}s`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      break;
    } catch (err) {
      if (err instanceof DOMException && err.name === "TimeoutError") {
        if (attempt < API_MAX_RETRIES) {
          await logStatus("warn", "morning-brief", `Timed out — retrying (attempt ${attempt + 1})`);
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

// ─── Main Brief Generator ───

export async function generateMorningBrief(force = false): Promise<void> {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  // Check if brief already generated today (skip when forced)
  if (!force) {
    const existing = await db.briefs.where("date").equals(today).first();
    if (existing && !existing.dismissed && !(existing.snoozedUntil && new Date(existing.snoozedUntil) <= new Date())) {
      return; // Already have a valid brief for today
    }
  }

  // Check if enabled
  const settings = await chrome.storage.local.get(["morningBriefEnabled", "anthropicApiKey"]);
  if (settings.morningBriefEnabled === false) return;
  if (!settings.anthropicApiKey) {
    await logStatus("warn", "morning-brief", "Cannot generate brief — no API key");
    return;
  }

  await logStatus("info", "morning-brief", "Generating morning brief...");

  try {
    // Get open commitments
    const openCommitments = await db.commitments
      .where("status")
      .anyOf("new", "snoozed", "actioned")
      .toArray();

    // Fetch calendar events
    const calendarEvents = await fetchCalendarEvents();

    const now = new Date();
    const dateStr = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
    const timeStr = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

    const calendarSection = calendarEvents.length > 0
      ? calendarEvents.map(e => `- ${e.start}${e.end !== e.start && e.end !== "All day" ? ` – ${e.end}` : ""}: ${e.title}`).join("\n")
      : "No calendar events found (or no calendar connected)";

    const commitmentsSection = openCommitments.length > 0
      ? openCommitments.map(c => `[ID:${c.id}] [${c.urgency}] ${c.text} (${c.context}, ${c.direction === "by_me" ? "I owe this" : "assigned to me"}${c.deadline ? `, due ${c.deadline.slice(0, 10)}` : ""})`).join("\n")
      : "No open commitments";

    const profile = await getUserProfile();
    const briefUserName = profile.userName || "the user";
    const briefTitle = profile.userTitle ? `, ${profile.userTitle}` : "";
    const briefCompany = profile.userCompany ? ` at ${profile.userCompany}` : "";

    const prompt = `You are a personal productivity assistant for ${briefUserName}${briefTitle}${briefCompany}. It's ${dateStr} at ${timeStr}.

Here is ${briefUserName}'s calendar for today:
${calendarSection}

Here are their open commitments:
${commitmentsSection}

Generate a morning brief that:

1. PRIORITIES: List the top 3-5 things to focus on today, considering both calendar commitments and open tasks. Prioritize by:
   - Overdue items (highest priority)
   - Items with today's deadline
   - Items that align with today's meetings (prep or follow-up)
   - Items that have been open the longest

2. SUGGESTED SCHEDULE: Look at gaps between calendar events and suggest when to tackle specific commitments.

3. HEADS UP: Flag anything concerning:
   - Commitments that are 3+ days old with no action
   - Multiple commitments related to the same person/meeting today
   - Anything that might need prep before a meeting

Return ONLY valid JSON (no markdown fences):
{
  "greeting": "Short, calm greeting with the day/date. No exclamation marks. Think competent EA. Examples: 'Wednesday, March 5.' or 'Here's your Wednesday.'",
  "priorities": [
    {
      "commitment_id": 123,
      "text": "Brief description",
      "reason": "Why this is a priority today",
      "suggested_time": "Between 10-11:30 AM or null",
      "action": "calendar"
    }
  ],
  "schedule_suggestion": "A 2-3 sentence natural language summary of how to structure the day",
  "heads_up": ["The QA team expectations talk has been open for 5 days"],
  "heads_up_typed": [
    { "text": "The QA team expectations talk has been open for 5 days", "severity": "warning" },
    { "text": "You have 2 commitments related to the design review meeting", "severity": "info" }
  ],
  "suggested_moves": [
    {
      "commitment_id": 456,
      "from": "todo",
      "to": "do_next",
      "reason": "Aligns with your 2pm meeting"
    }
  ]
}`;

    const rawResponse = await callClaudeForBrief(prompt) as {
      greeting: string;
      priorities: Array<{ commitment_id: number; text: string; reason: string; suggested_time: string | null; action: string }>;
      schedule_suggestion: string;
      heads_up: string[];
      heads_up_typed?: Array<{ text: string; severity: string }>;
      suggested_moves: Array<{ commitment_id: number; from: string; to: string; reason: string }>;
    };

    const priorities: BriefPriority[] = (rawResponse.priorities ?? []).map(p => ({
      commitmentId: p.commitment_id,
      text: p.text,
      reason: p.reason,
      suggestedTime: p.suggested_time ?? null,
      action: (["calendar", "do", "delegate", "prep"].includes(p.action) ? p.action : "do") as BriefPriority["action"],
    }));

    const suggestedMoves: BriefSuggestedMove[] = (rawResponse.suggested_moves ?? []).map(m => ({
      commitmentId: m.commitment_id,
      from: m.from,
      to: m.to,
      reason: m.reason,
    }));

    const validSeverities = ["warning", "info", "due_soon", "duplicate"] as const;
    const headsUpTyped: BriefHeadsUpItem[] = (rawResponse.heads_up_typed ?? []).map(h => ({
      text: h.text,
      severity: (validSeverities as readonly string[]).includes(h.severity)
        ? h.severity as BriefHeadsUpItem["severity"]
        : "info",
    }));

    const brief: MorningBrief = {
      date: today,
      greeting: rawResponse.greeting ?? dateStr,
      priorities,
      scheduleSuggestion: rawResponse.schedule_suggestion ?? "",
      headsUp: rawResponse.heads_up ?? [],
      headsUpTyped: headsUpTyped.length > 0 ? headsUpTyped : undefined,
      calendarEvents: calendarEvents.length > 0 ? calendarEvents : undefined,
      suggestedMoves,
      dismissed: false,
      snoozedUntil: null,
      createdAt: new Date().toISOString(),
    };

    // Delete any existing brief for today (e.g., from a snooze-expired re-generate)
    await db.briefs.where("date").equals(today).delete();
    await db.briefs.add(brief);

    // Fire notification
    chrome.notifications.create("morning-brief", {
      type: "basic",
      iconUrl: chrome.runtime.getURL("assets/icon-128.png"),
      title: "Morning Brief",
      message: `${openCommitments.length} open commitments${calendarEvents.length > 0 ? `, ${calendarEvents.length} meetings` : ""} today. ${priorities[0]?.text ?? "Check your commitments."}`,
      priority: 1,
    });

    await logStatus("success", "morning-brief", `Morning brief generated: ${priorities.length} priorities, ${calendarEvents.length} calendar events`);
  } catch (err) {
    await logStatus("error", "morning-brief", `Brief generation failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
