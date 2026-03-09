import { db, getDismissalPatterns, getNewCommitmentCount, getActiveCommitments, getAllTags, ensureGeneralTag, getNextTagColor } from "@shared/db";
import { CLAUDE_MODEL, CLAUDE_MODEL_FAST, MAX_DISMISSAL_PATTERNS, API_TIMEOUT_MS, API_MAX_RETRIES, API_RETRY_DELAY_MS, DEFAULTS } from "@shared/constants";
import type { SourceType, ExtractionResponse, ExtractedCommitment, RejectedCandidate, SlackMessagePayload, DecisionLogEntry, ConversationMessage, SlackWatermarks } from "@shared/types";
import { logStatus, updateStatus, getStatus } from "@shared/status";
import { getUserProfile } from "@shared/user-profile";
import { computeHash, isDuplicate, isFuzzyDuplicate } from "./dedup";
import { requestBackupSave } from "./backup-sync";

type BufferedMessage = SlackMessagePayload["messages"][number];

// ─── Prompt Building ───

async function buildDismissalBlock(): Promise<string> {
  const dismissals = await getDismissalPatterns();
  if (dismissals.length === 0) return "";

  const capped = dismissals.slice(0, MAX_DISMISSAL_PATTERNS);
  const lines = capped.map(
    (d) => `- Dismissed ${d.count}x: "${d.pattern}" -- user says this is ${d.reason}`,
  );
  return `

PREVIOUSLY DISMISSED (do NOT extract these patterns again):
${lines.join("\n")}`;
}

async function isDevModeEnabled(): Promise<boolean> {
  const result = await chrome.storage.local.get("developerMode");
  return result.developerMode === true;
}

async function buildTagBlock(): Promise<string> {
  const tags = await getAllTags();
  if (tags.length === 0) return "";
  const tagLines = tags.map((t) => `  - ID ${t.id}: "${t.name}"`).join("\n");
  return `

SMART TAGS — assign exactly one tag to each commitment:
Available tags:
${tagLines}

Rules:
- Set "tag_id" to the ID of the best-matching tag.
- If no existing tag fits well, set "tag_id" to null and add "suggested_tag" with a short theme name (e.g. "Hackathon", "AI Tooling").
- Prefer existing tags over suggesting new ones. Default to "General" when unsure.
- Only suggest a new tag if it represents a clear recurring theme.`;
}

async function buildSystemPrompt(sourceType: SourceType = "slack"): Promise<string> {
  const dismissalBlock = await buildDismissalBlock();
  const tagBlock = await buildTagBlock();
  const devMode = await isDevModeEnabled();
  const profile = await getUserProfile();
  const userName = profile.userName || "the user";
  const userTitle = profile.userTitle ? `, ${profile.userTitle}` : "";
  const userCompany = profile.userCompany ? ` at ${profile.userCompany}` : "";

  // Title-aware sensitivity hints: if we know the user's role, we can give Claude
  // better guidance about what categories of info are sensitive for that person.
  const titleLower = (profile.userTitle || "").toLowerCase();
  const isLeadership = /\b(vp|ceo|cto|coo|cfo|chief|director|head of|president|founder|partner)\b/.test(titleLower);
  const isPeopleManager = /\b(manager|lead|head|principal|staff|director|senior manager|eng manager|em)\b/.test(titleLower);
  const isHR = /\b(hr|people|talent|recruiting|recruiter|people ops|human resources)\b/.test(titleLower);
  const sensitivityTitleHint = isLeadership
    ? `${userName} is in a leadership role (${profile.userTitle}). Commitments involving strategy, roadmap, headcount, budget, org changes, exec decisions, or anything about specific employees are highly likely to be sensitive.`
    : isPeopleManager
    ? `${userName} manages people (${profile.userTitle}). Commitments involving individual team members (performance, comp, promotions, PIPs, terminations, hiring decisions) or internal team dynamics should be marked sensitive.`
    : isHR
    ? `${userName} works in People/HR (${profile.userTitle}). The vast majority of their commitments touch confidential people data — err strongly on the side of marking sensitive.`
    : profile.userTitle
    ? `${userName}'s title is ${profile.userTitle}. Use this context to help judge whether a commitment would be considered confidential for someone in that role.`
    : "";

  const rejectionBlock = devMode ? `

DECISION LOG (Developer Mode is ON):
In addition to the "commitments" array, also return a "rejections" array listing every candidate message you considered but decided NOT to extract as a commitment. For each rejection include:
- "original_text": the exact message text
- "sender": who sent it
- "channel": which channel
- "reason": a brief, plain-English explanation of why it's not a commitment (e.g. "Delegation to someone else, not ${userName}'s commitment", "Past tense — already done", "Hedging/uncertain — 'I'll try'")
- "category": one of "not_commitment", "third_party", "hedging", "past_tense", "delegation", "politeness", "low_confidence", "acknowledgment", "stale_document"

Only include messages that matched commitment-like patterns but were ruled out. Don't include completely irrelevant context messages.` : "";

  const gdocBlock = sourceType === "gdoc" ? `

GOOGLE DOCS SOURCE — SPECIAL RULES:
This content comes from a Google Doc, not a live Slack conversation. Apply these extra rules:

RECENCY IS CRITICAL:
- The current time is provided below. Use it to judge whether content is recent.
- Prefer commitments from content that references dates within the last ~2 weeks.
- If a section references dates, deadlines, or meetings clearly older than 2 weeks, do NOT extract commitments from it — these are likely stale.
- If no dates are present, use contextual clues: "next week", "tomorrow", "this sprint" suggest recency. "Last quarter", "back in January" (if months ago), etc. suggest staleness.

HIGHER CONFIDENCE THRESHOLD:
- Only return items with confidence >= 0.75 (instead of the usual 0.6).
- Documents often contain old action items that were never cleaned up. Be skeptical of undated action items in document body text.

HIGH CONFIDENCE SIGNALS (boost to 0.85+):
- Explicit "Action item:" or "TODO:" labels with recent dates
- Comments/replies (these are usually recent and active discussions)
- Text near the top of a document titled like meeting notes with a recent date
- Items explicitly mentioning ${userName} by name with future deadlines

LOW CONFIDENCE / SKIP:
- Undated action items buried in long document body text
- Items in sections with old dates (more than 2 weeks ago)
- Generic "we should..." or "we need to..." without clear ownership
- Historical notes about what was discussed or decided (not action items)
` : "";

  const sourceLabel = sourceType === "gdoc" ? "Google Docs content" : "Slack messages";

  return `You are analyzing ${sourceLabel} for ${userName}${userTitle}${userCompany}.${gdocBlock}

TASK: Extract commitments — things ${userName} agreed to do, or that were assigned to them by someone else.

DIRECTION RULES:
- "by_me": ${userName}'s own messages where they commit to an action ("I'll send that over", "Let me look into it")
- "assigned_to_me": Someone else asks/assigns ${userName} to do something ("Can you review this?", "${userName} to follow up on X")
- EXCLUDE: Third-party commitments (Alice telling Bob she'll do something). If ${userName} delegates TO someone ("Hey Alice, can you handle X?"), that is NOT a commitment for ${userName}.

COMPLETION DETECTION:
- Check if later messages in the conversation indicate the task was already done
- Look for: ✅ reactions, "done", "sent", "completed", "handled", "finished", past-tense follow-ups
- Set likely_completed=true and quote the completion signal if found

INCLUDE patterns:
- "I'll [verb]..." — committing to an action
- "Let me [verb]..." — taking ownership
- "I can [do something] by [time]" — commitment with deadline
- "Can you [verb]..." / "Could you [verb]..." — someone asking ${userName}
- "Action item: [something]" — explicit assignment
- "[${userName}] to [verb]..." — meeting notes assignment

TRIGGER WORD — "CLYDE":
If a message contains "Clyde" (case-insensitive), treat it as an explicit commitment signal.
Extract the actual task from context — not the trigger phrase.
- Set confidence to 0.95.
- Set triggered to true.
- Examples:
  "We need to review the security audit. Clyde, add that." → "Review the security audit"
  "I'll send the timeline by Friday. That's one for Clyde." → "Send the timeline by Friday"
  "Clyde, remind me to prep for the board meeting." → "Prep for the board meeting"

EXCLUDE (do NOT flag these):
- Generic politeness: "I'll let you know", "let me know if you need anything"
- Hedging or stalling: "let me think about that", "I'll try", "yeah maybe"
- Information sharing: "I'll explain", "let me walk you through this"
- Past tense: "I already sent", "I looked into it yesterday"
- Questions without commitment: "Should I...?", "Do you want me to...?"
- Acknowledgments without action: "will do", "got it", "sounds good"
- ${userName} delegating TO others: "Can you handle X?", "Alice, can you review this?"

Confidence scoring:
- 0.9+: Unambiguous commitment with clear action verb and ownership
- 0.7-0.9: Likely commitment, slightly ambiguous
- 0.6-0.7: Could go either way
- Below 0.6: Do NOT include

Only return items with confidence >= 0.6.

SENSITIVITY TAGGING:
For each commitment, return a "sensitive" boolean. The goal is: would seeing this commitment on someone's screen be awkward, embarrassing, or risky — for the person, for a colleague, or for the company?

Mark sensitive=true for ANY of the following:

PEOPLE & HR:
- Hiring, firing, layoffs, RIFs, headcount changes
- Performance reviews, PIPs, ratings, improvement plans
- Salary, comp, equity, bonuses, raises, budget for people
- Promotions, demotions, title changes, role changes
- Complaints, HR investigations, conduct issues
- References, background checks, offer negotiations
- Specific individuals' performance or behavior ("follow up with Alex about their attendance")

INTERNAL / CONFIDENTIAL BUSINESS:
- Unreleased product plans, roadmap, launch dates, feature flags
- Revenue numbers, financial projections, burn rate, fundraising
- M&A activity, partnerships, acquisitions, due diligence
- Legal matters, contracts under NDA, disputes, settlements
- Pricing strategy, deal terms, customer contract specifics
- Security vulnerabilities, incidents, internal postmortems

INTERPERSONAL / POLITICAL:
- Conflicts between colleagues or teams
- Anything that names a specific person negatively
- Personal favors, health, family, or non-work matters
- Manager/report dynamics (feedback, coaching, skip-levels)
- Anything discussed in a private 1:1 that wasn't meant for a wider audience

"WOULDN'T WANT THIS SEEN" TEST:
If you can imagine someone minimizing their laptop when a colleague walks by while this commitment is visible — mark it sensitive. This includes things like discussions about org changes, internal politics, strategic bets, or anything that would embarrass the company if posted publicly.
${sensitivityTitleHint ? `\nROLE CONTEXT:\n${sensitivityTitleHint}` : ""}
Default: routine work tasks (code reviews, docs, meetings, tickets, external deliverables) should be sensitive=false.

CONTEXT SUMMARY:
For each commitment, also return a "context_summary" field: 1-3 sentences summarizing the conversation that led to the commitment. Focus on: what was being discussed, who was involved, and why the commitment arose. If there's not enough surrounding context, set it to null.

EXAMPLES:

Example 1 — Completed commitment:
Messages:
[ME] [[User] in #engineering at 9:00 AM]: I'll send over the API spec after lunch
[Sarah in #engineering at 2:00 PM]: @[User] did you get a chance to send that spec?
[ME] [[User] in #engineering at 2:05 PM]: Just sent it! [reactions: ✅]
Output: {"commitments":[{"text":"Send API spec to Sarah","original_quote":"I'll send over the API spec after lunch","deadline":null,"urgency":"low","context":"#engineering","source_type":"slack","confidence":0.85,"direction":"by_me","likely_completed":true,"completion_signal":"Just sent it!","message_timestamp":"9:00 AM","context_summary":"Sarah asked about the API spec. [User] committed to sending it after lunch and followed up later confirming it was sent.","triggered":false,"sensitive":false}]}

Example 2 — Valid assignment:
Messages:
[Sarah in #engineering at 10:00 AM]: @[User] can you review the PRD for the new dashboard? Need it by Friday
Output: {"commitments":[{"text":"Review PRD for new dashboard","original_quote":"@[User] can you review the PRD for the new dashboard? Need it by Friday","deadline":"<next Friday ISO>","urgency":"medium","context":"#engineering","source_type":"slack","confidence":0.9,"direction":"assigned_to_me","likely_completed":false,"completion_signal":null,"message_timestamp":"10:00 AM","context_summary":"Sarah asked [User] to review the PRD for the new dashboard feature, with a Friday deadline.","triggered":false,"sensitive":false}]}

Example 3 — Empty result (delegation + hedging):
Messages:
[ME] [[User] in #engineering at 11:00 AM]: Alice, can you handle the deploy today?
[ME] [[User] in #engineering at 11:05 AM]: I'll try to look at it if I get time
Output: {"commitments":[]}

Return ONLY valid JSON. No markdown fences. No preamble.${tagBlock}${rejectionBlock}${dismissalBlock}`;
}

function buildUserMessage(
  candidates: BufferedMessage[],
  contextMessages: BufferedMessage[],
): string {
  // Collect all messages, tag them by role
  type TaggedMessage = BufferedMessage & { tag: "candidate" | "context" };
  const allMessages: TaggedMessage[] = [
    ...candidates.map((m) => ({ ...m, tag: "candidate" as const })),
    ...contextMessages.map((m) => ({ ...m, tag: "context" as const })),
  ];

  // Group by channel
  const byChannel = new Map<string, TaggedMessage[]>();
  for (const msg of allMessages) {
    const existing = byChannel.get(msg.channel) ?? [];
    existing.push(msg);
    byChannel.set(msg.channel, existing);
  }

  // Sort each channel: channel messages first (chronological), then thread replies (chronological)
  for (const msgs of byChannel.values()) {
    msgs.sort((a, b) => {
      const aIsThread = a.is_thread_reply ? 1 : 0;
      const bIsThread = b.is_thread_reply ? 1 : 0;
      if (aIsThread !== bIsThread) return aIsThread - bIsThread;
      return a.timestamp.localeCompare(b.timestamp);
    });
  }

  // Build output
  const sections: string[] = [];
  for (const [channel, msgs] of byChannel) {
    const lines: string[] = [`## #${channel}`, ""];
    let inThreadSection = false;

    for (const msg of msgs) {
      // Insert a separator when we transition from channel messages to thread replies
      if (msg.is_thread_reply && !inThreadSection) {
        inThreadSection = true;
        lines.push("");
        lines.push(`--- Thread replies in #${channel} ---`);
        lines.push("");
      }

      let prefix: string;
      if (msg.isMine) {
        prefix = msg.is_thread_reply ? "[ME in thread]" : "[ME]";
      } else if (msg.mentionsMe && msg.tag === "candidate") {
        prefix = msg.is_thread_reply ? "[MENTIONS ME in thread]" : "[MENTIONS ME]";
      } else if (msg.tag === "context") {
        prefix = msg.is_thread_reply ? "[context in thread]" : "[context]";
      } else {
        prefix = msg.is_thread_reply ? "[MENTIONS ME in thread]" : "[MENTIONS ME]";
      }

      const location = msg.is_thread_reply
        ? `replying in #${msg.channel}`
        : `in #${msg.channel}`;
      let line = `${prefix} [${msg.sender} ${location} at ${msg.timestamp}]: ${msg.text}`;
      if (msg.reactions && msg.reactions.length > 0) {
        line += ` [reactions: ${msg.reactions.join(", ")}]`;
      }
      lines.push(line);
    }
    sections.push(lines.join("\n"));
  }

  return `Current time: ${new Date().toISOString()}

--- MESSAGES BY CHANNEL ---

${sections.join("\n\n")}`;
}

// ─── Claude API ───

async function fetchClaudeWithRetry(
  apiKey: string,
  body: object,
): Promise<Response> {
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
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      });

      if (response.status === 429 && attempt < API_MAX_RETRIES) {
        const delay = API_RETRY_DELAY_MS * (attempt + 1);
        await logStatus("warn", "extractor", `Rate limited (429) — retrying in ${delay / 1000}s (attempt ${attempt + 1}/${API_MAX_RETRIES})`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      return response;
    } catch (err) {
      if (err instanceof DOMException && err.name === "TimeoutError") {
        if (attempt < API_MAX_RETRIES) {
          await logStatus("warn", "extractor", `Claude API timed out after ${API_TIMEOUT_MS / 1000}s — retrying (attempt ${attempt + 1}/${API_MAX_RETRIES})`);
          continue;
        }
        throw new Error(`Claude API timed out after ${API_TIMEOUT_MS / 1000}s`);
      }
      throw err;
    }
  }
  throw new Error("Claude API failed after all retries");
}

function parseClaudeJson(raw: string): unknown {
  let cleaned = raw.trim().replace(/^```json?\s*/, "").replace(/\s*```$/, "");
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace > 0 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }
  return JSON.parse(cleaned);
}

export async function callClaude(
  system: string,
  userMessage: string,
): Promise<ExtractionResponse> {
  const result = await chrome.storage.local.get("anthropicApiKey");
  const apiKey = result.anthropicApiKey as string | undefined;
  if (!apiKey) {
    throw new Error("No API key configured");
  }

  await logStatus("info", "extractor", `Calling Claude API (${CLAUDE_MODEL})...`);

  const response = await fetchClaudeWithRetry(apiKey, {
    model: CLAUDE_MODEL,
    max_tokens: 2048,
    system,
    messages: [{ role: "user", content: userMessage }],
  });

  if (!response.ok) {
    const errorText = await response.text();
    if (response.status === 401) {
      throw new Error("Invalid API key — check your Anthropic API key in Settings");
    }
    if (response.status === 429) {
      throw new Error("Claude API rate limit — too many requests, will retry soon");
    }
    throw new Error(`Claude API error (${response.status}): ${errorText.slice(0, 200)}`);
  }

  const data = await response.json();
  const textBlock = data.content?.find(
    (block: { type: string }) => block.type === "text",
  );
  if (!textBlock?.text) {
    throw new Error("Invalid response from Claude — no text content");
  }

  const parsed = parseClaudeJson(textBlock.text) as ExtractionResponse;

  if (!Array.isArray(parsed.commitments)) {
    throw new Error("Invalid response from Claude — missing commitments array");
  }

  await logStatus("success", "extractor", `Claude returned ${parsed.commitments.length} potential commitments`);
  return parsed;
}

// ─── Validation ───

function isValidCommitment(c: ExtractedCommitment): boolean {
  return (
    typeof c.text === "string" &&
    c.text.length > 0 &&
    typeof c.original_quote === "string" &&
    c.original_quote.length > 0 &&
    ["high", "medium", "low"].includes(c.urgency) &&
    typeof c.confidence === "number" &&
    c.confidence >= 0.6 &&
    c.confidence <= 1.0 &&
    typeof c.context === "string" &&
    ["by_me", "assigned_to_me"].includes(c.direction) &&
    typeof c.likely_completed === "boolean"
  );
}

// ─── Conversation Context ───

function buildConversationMessages(
  commitment: ExtractedCommitment,
  allMessages: BufferedMessage[],
): { messages: ConversationMessage[]; slackLink: string | null } {
  // Filter to same-channel messages, sort chronologically
  const channelMessages = allMessages
    .filter((m) => m.channel === commitment.context || `#${m.channel}` === commitment.context)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const messages: ConversationMessage[] = channelMessages.map((m) => ({
    sender: m.sender,
    text: m.text,
    timestamp: m.timestamp,
    isMine: m.isMine,
  }));

  // Find the slack_link for the commitment message by matching original_quote text
  let slackLink: string | null = null;
  for (const m of channelMessages) {
    if (m.text.includes(commitment.original_quote) || commitment.original_quote.includes(m.text)) {
      slackLink = m.slack_link ?? null;
      break;
    }
  }

  return { messages, slackLink };
}

// ─── Confidence Floor ───

/**
 * Get the effective confidence floor for extraction.
 * Google Docs always uses 0.75 (stricter — docs are often stale).
 * Slack uses the user-configured threshold (default 0.6), which may be auto-tuned.
 */
async function getConfidenceFloor(sourceType: SourceType): Promise<number> {
  if (sourceType === "gdoc") return 0.75;
  const result = await chrome.storage.local.get("confidenceThreshold");
  const stored = result.confidenceThreshold;
  if (typeof stored === "number" && stored >= 0.5 && stored <= 0.95) {
    return stored;
  }
  return DEFAULTS.confidenceThreshold;
}

// ─── Main Extraction ───

export async function extractCommitments(
  candidates: BufferedMessage[],
  contextMessages: BufferedMessage[],
  sourceType: SourceType,
): Promise<void> {
  if (candidates.length === 0) return;

  await logStatus(
    "info",
    "extractor",
    `Starting extraction: ${candidates.length} candidates, ${contextMessages.length} context messages (${sourceType})`,
  );
  await updateStatus({ lastError: null });

  try {
    // Check API key
    const keyResult = await chrome.storage.local.get(["anthropicApiKey", "apiKeyMissingNotified"]);
    if (!keyResult.anthropicApiKey) {
      await logStatus("error", "extractor", "Cannot extract — no Anthropic API key configured. Add it in Settings (gear icon).");
      await updateStatus({ lastError: "API key not configured", hasApiKey: false });
      // Notify once so user knows setup is needed
      if (!keyResult.apiKeyMissingNotified) {
        chrome.notifications.create("api-key-missing", {
          type: "basic",
          iconUrl: chrome.runtime.getURL("assets/icon-128.png"),
          title: "Clyde — Setup Required",
          message: "Add your Anthropic API key in Clyde Settings to enable commitment detection.",
          priority: 2,
        });
        await chrome.storage.local.set({ apiKeyMissingNotified: true });
      }
      return;
    }
    await updateStatus({ hasApiKey: true });

    const devMode = await isDevModeEnabled();
    const system = await buildSystemPrompt(sourceType);
    const userMessage = buildUserMessage(candidates, contextMessages);
    const result = await callClaude(system, userMessage);

    // ─── Confidence floor (user-configurable for Slack, fixed for Google Docs) ───
    const confidenceFloor = await getConfidenceFloor(sourceType);

    // ─── Resolve tags ───
    const generalTagId = await ensureGeneralTag();
    const existingTags = await getAllTags();
    const tagIdSet = new Set(existingTags.map((t) => t.id));

    // Batch-create suggested tags: collect unique suggestions first
    const suggestedNames = new Set<string>();
    for (const c of result.commitments) {
      if (c.suggested_tag && !c.tag_id) {
        suggestedNames.add(c.suggested_tag);
      }
    }
    // Create any new suggested tags
    const newTagMap = new Map<string, number>();
    for (const name of suggestedNames) {
      // Check if tag already exists (case-insensitive)
      const existing = existingTags.find((t) => t.name.toLowerCase() === name.toLowerCase());
      if (existing?.id != null) {
        newTagMap.set(name, existing.id);
      } else {
        const tagCount = existingTags.length + newTagMap.size;
        const newId = await db.tags.add({
          name,
          color: getNextTagColor(tagCount),
          createdAt: new Date().toISOString(),
        }) as number;
        newTagMap.set(name, newId);
      }
    }

    const batchId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    let newCount = 0;
    let dupeCount = 0;
    let invalidCount = 0;

    for (const commitment of result.commitments) {
      if (!isValidCommitment(commitment)) {
        invalidCount++;
        await logStatus("warn", "extractor", `Skipping invalid commitment: "${commitment.text?.slice(0, 50)}..."`);
        continue;
      }

      // Apply source-specific confidence floor
      if (commitment.confidence < confidenceFloor) {
        invalidCount++;
        await logStatus("info", "extractor", `Below ${sourceType} confidence floor (${commitment.confidence.toFixed(2)} < ${confidenceFloor}): "${commitment.text.slice(0, 50)}..."`);
        continue;
      }

      const hash = await computeHash(
        commitment.original_quote,
        commitment.source_type || sourceType,
        commitment.context,
      );

      if (await isDuplicate(hash)) {
        dupeCount++;
        continue;
      }

      // Fuzzy dedup: catch near-identical commitments that differ only in minor wording
      if (await isFuzzyDuplicate(commitment.text, commitment.original_quote, commitment.context)) {
        dupeCount++;
        await logStatus("info", "extractor", `Fuzzy duplicate skipped: "${commitment.text.slice(0, 50)}..."`);
        continue;
      }

      const allBatchMessages = [...candidates, ...contextMessages];
      const { messages: conversationMessages, slackLink } = buildConversationMessages(commitment, allBatchMessages);

      const isTriggered = commitment.triggered === true;

      // Resolve tag_id
      let resolvedTagId: number = generalTagId;
      if (commitment.tag_id != null && tagIdSet.has(commitment.tag_id)) {
        resolvedTagId = commitment.tag_id;
      } else if (commitment.suggested_tag && newTagMap.has(commitment.suggested_tag)) {
        resolvedTagId = newTagMap.get(commitment.suggested_tag)!;
      }

      try {
        await db.commitments.add({
          hash,
          text: commitment.text,
          original_quote: commitment.original_quote,
          deadline: commitment.deadline,
          urgency: commitment.urgency,
          context: commitment.context,
          source_type: commitment.source_type || sourceType,
          confidence: isTriggered ? Math.max(commitment.confidence, 0.95) : commitment.confidence,
          direction: commitment.direction,
          likely_completed: commitment.likely_completed,
          completion_signal: commitment.completion_signal ?? null,
          message_timestamp: commitment.message_timestamp || new Date().toISOString(),
          status: commitment.likely_completed ? "done" : "new",
          snooze_until: null,
          context_summary: commitment.context_summary ?? null,
          conversation_messages: conversationMessages,
          slack_link: slackLink,
          triggered: isTriggered,
          sensitive: commitment.sensitive === true,
          tag_id: resolvedTagId,
          createdAt: new Date().toISOString(),
        });
      } catch (e) {
        // Unique hash constraint violation — another extraction already inserted this
        if (e instanceof Error && e.name === "ConstraintError") {
          dupeCount++;
          continue;
        }
        throw e;
      }

      newCount++;

      if (commitment.urgency === "high") {
        chrome.notifications.create({
          type: "basic",
          iconUrl: chrome.runtime.getURL("assets/icon-128.png"),
          title: "Clyde",
          message: commitment.text,
          priority: 2,
        });
      }
    }

    // ─── Completion reconciliation ───
    // Check if any newly extracted items with likely_completed match existing active commitments
    const completedNewItems = result.commitments.filter(
      (c) => isValidCommitment(c) && c.likely_completed && c.completion_signal,
    );
    if (completedNewItems.length > 0) {
      const activeCommitments = await getActiveCommitments();
      for (const newItem of completedNewItems) {
        for (const active of activeCommitments) {
          if (active.id == null) continue;
          // Fuzzy match: check if the new item's quote or text references the active commitment
          const newQuoteLower = newItem.original_quote.toLowerCase();
          const newTextLower = newItem.text.toLowerCase();
          const activeQuoteLower = active.original_quote.toLowerCase();
          const activeTextLower = active.text.toLowerCase();
          const matched =
            newQuoteLower.includes(activeTextLower) ||
            newTextLower.includes(activeTextLower) ||
            activeQuoteLower.includes(newTextLower) ||
            newQuoteLower.includes(activeQuoteLower);
          if (matched) {
            await db.commitments.update(active.id, { status: "done" });
            await db.action_log.add({
              commitmentId: active.id,
              action: "done",
              createdAt: new Date().toISOString(),
            });
            await logStatus(
              "info",
              "extractor",
              `AI detected completion: "${active.text.slice(0, 40)}..." auto-marked done`,
            );
          }
        }
      }
    }

    // Store decision log entries if dev mode is on
    if (devMode) {
      const now = new Date().toISOString();
      const entries: DecisionLogEntry[] = [];
      const profile = await getUserProfile();
      const logSender = profile.userName || "User";

      // Log accepted commitments
      for (const c of result.commitments) {
        if (isValidCommitment(c)) {
          entries.push({
            decision: "accepted",
            original_text: c.original_quote,
            sender: logSender,
            channel: c.context,
            reason: c.text,
            category: "accepted",
            confidence: c.confidence,
            batchId,
            createdAt: now,
          });
        }
      }

      // Log rejections
      if (result.rejections) {
        for (const r of result.rejections) {
          entries.push({
            decision: "rejected",
            original_text: r.original_text,
            sender: r.sender,
            channel: r.channel,
            reason: r.reason,
            category: r.category,
            confidence: null,
            batchId,
            createdAt: now,
          });
        }
      }

      if (entries.length > 0) {
        await db.decision_log.bulkAdd(entries);
        await logStatus("info", "extractor", `Decision log: ${entries.filter(e => e.decision === "accepted").length} accepted, ${entries.filter(e => e.decision === "rejected").length} rejected`);
      }

      // Keep decision log trimmed to last 500 entries
      const totalEntries = await db.decision_log.count();
      if (totalEntries > 500) {
        const oldest = await db.decision_log.orderBy("id").limit(totalEntries - 500).primaryKeys();
        await db.decision_log.bulkDelete(oldest);
      }
    }

    // Update status
    const status = await getStatus();
    await updateStatus({
      lastExtraction: new Date().toISOString(),
      totalCommitmentsExtracted: status.totalCommitmentsExtracted + newCount,
      lastError: null,
    });

    const summary = [`${newCount} new`];
    if (dupeCount > 0) summary.push(`${dupeCount} duplicates`);
    if (invalidCount > 0) summary.push(`${invalidCount} invalid`);
    await logStatus(
      newCount > 0 ? "success" : "info",
      "extractor",
      `Extraction complete: ${summary.join(", ")} from ${result.commitments.length} total`,
    );

    if (newCount > 0) {
      const count = await getNewCommitmentCount();
      const text = count > 0 ? String(count) : "";
      chrome.action.setBadgeText({ text });
      chrome.action.setBadgeBackgroundColor({ color: "#2b67db" });
    }

    // Update Slack channel watermarks with newest message_ts per channel
    if (sourceType === "slack") {
      const wmResult = await chrome.storage.local.get("slackChannelWatermarks");
      const watermarks: SlackWatermarks = (wmResult.slackChannelWatermarks as SlackWatermarks) ?? {};
      const allBatch = [...candidates, ...contextMessages];
      let updated = false;

      for (const msg of allBatch) {
        if (!msg.message_ts || !msg.channel) continue;
        const existing = watermarks[msg.channel];
        if (!existing || msg.message_ts > existing.lastMessageTs) {
          watermarks[msg.channel] = { lastMessageTs: msg.message_ts };
          updated = true;
        }
      }

      if (updated) {
        await chrome.storage.local.set({ slackChannelWatermarks: watermarks });
      }
    }

    // Trigger backup after storing new commitments
    if (newCount > 0) {
      requestBackupSave();
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await logStatus("error", "extractor", `Extraction failed: ${errMsg}`);
    await updateStatus({ lastError: errMsg, lastExtraction: new Date().toISOString() });
  }
}

// ─── Raw Claude call (untyped JSON response) ───

async function callClaudeRaw(
  system: string,
  userMessage: string,
  useFastModel = false,
): Promise<unknown> {
  const result = await chrome.storage.local.get("anthropicApiKey");
  const apiKey = result.anthropicApiKey as string | undefined;
  if (!apiKey) {
    throw new Error("No API key configured");
  }

  const model = useFastModel ? CLAUDE_MODEL_FAST : CLAUDE_MODEL;
  const response = await fetchClaudeWithRetry(apiKey, {
    model,
    max_tokens: 1024,
    system,
    messages: [{ role: "user", content: userMessage }],
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API ${response.status}: ${errorText.slice(0, 200)}`);
  }

  const data = await response.json();
  const textBlock = data.content?.find(
    (block: { type: string }) => block.type === "text",
  );
  if (!textBlock?.text) {
    throw new Error("No text content in Claude response");
  }

  return parseClaudeJson(textBlock.text);
}

// ─── Completion Detection ───

interface CompletionResult {
  commitment_id: number;
  confidence: number;
  evidence: string;
  source_message: string;
}

export async function detectCompletions(
  candidates: BufferedMessage[],
  contextMessages: BufferedMessage[],
): Promise<void> {
  const openCommitments = await db.commitments
    .where("status")
    .anyOf("new", "snoozed", "actioned")
    .toArray();

  if (openCommitments.length === 0) return;

  const capped = openCommitments
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 30);

  const allMessages = [...candidates, ...contextMessages];
  if (allMessages.length === 0) return;

  const commitmentsList = capped
    .map((c) => `[ID:${c.id}] ${c.text} (context: ${c.context})`)
    .join("\n");

  const messagesList = allMessages
    .map((m) => `[${m.sender} in #${m.channel}]: ${m.text}`)
    .join("\n");

  const profile = await getUserProfile();
  const completionUserName = profile.userName || "the user";

  const systemPrompt = `You are checking whether recent messages indicate that any of ${completionUserName}'s open commitments have been completed.

OPEN COMMITMENTS:
${commitmentsList}

RECENT MESSAGES:
${messagesList}

For each open commitment, check if any recent message indicates it was fulfilled. Look for:
- Direct completion: "I sent the hackathon invite" matches "Send out the Hackathon calendar invite"
- Implied completion: Context indicating the task was done
- Conversational signals: "Done", "Handled", "Taken care of", "Just sent that", "Already did this"

Confidence scoring:
- 0.9+: Unambiguous proof of completion (explicit "done", "sent it", past-tense confirmation). These will be auto-marked done.
- 0.7-0.9: Strong evidence but some ambiguity. User will be prompted to confirm.
- 0.5-0.7: Possible completion signal worth asking about. User will be prompted.
- Below 0.5: Do NOT include.

Include anything >= 0.5. Be honest with confidence scores — the system handles each tier differently.

Return ONLY valid JSON (no markdown fences):
{ "completions": [ { "commitment_id": 123, "confidence": 0.85, "evidence": "brief description of evidence", "source_message": "exact message text that triggered this" } ] }
If no completions detected, return: { "completions": [] }`;

  try {
    const raw = await callClaudeRaw(
      systemPrompt,
      "Check the messages above against the open commitments.",
      true, // use fast model — this is simple pattern matching
    );

    const parsed = raw as { completions?: CompletionResult[] };
    const completions = parsed.completions;
    if (!Array.isArray(completions)) {
      await logStatus("warn", "extractor", "Completion detection returned invalid format");
      return;
    }

    let suggestedCount = 0;

    let autoCompletedCount = 0;

    for (const completion of completions) {
      if (completion.confidence < 0.5) continue;

      const commitment = capped.find((c) => c.id === completion.commitment_id);

      // High confidence (>= 0.9): auto-mark done without prompting
      if (completion.confidence >= 0.9) {
        await db.commitments.update(completion.commitment_id, { status: "done" });
        await db.action_log.add({
          commitmentId: completion.commitment_id,
          action: "done",
          createdAt: new Date().toISOString(),
        });
        autoCompletedCount++;
        await logStatus(
          "success",
          "extractor",
          `Auto-completed (${Math.round(completion.confidence * 100)}%): "${commitment?.text.slice(0, 40) ?? "?"}..."`,
        );
        chrome.notifications.create(
          `auto-done-${completion.commitment_id}-${Date.now()}`,
          {
            type: "basic",
            iconUrl: chrome.runtime.getURL("assets/icon-128.png"),
            title: "Auto-completed",
            message: `Marked done: ${commitment?.text ?? "a commitment"}`,
            priority: 1,
          },
        );
        continue;
      }

      // Medium confidence (0.5–0.9): create a suggestion for the user to confirm

      // Check if dismissed too many times
      const dismissed = await db.dismissed_completions.get(completion.commitment_id);
      if (dismissed && dismissed.dismissCount >= 3) continue;

      // Check if a pending suggestion already exists
      const pendingCount = await db.completion_suggestions
        .where("commitmentId")
        .equals(completion.commitment_id)
        .filter((s) => s.status === "pending")
        .count();
      if (pendingCount > 0) continue;

      // Store the suggestion
      await db.completion_suggestions.add({
        commitmentId: completion.commitment_id,
        confidence: completion.confidence,
        evidence: completion.evidence,
        sourceMessage: completion.source_message,
        status: "pending",
        createdAt: new Date().toISOString(),
      });

      suggestedCount++;

      // Fire Chrome notification
      chrome.notifications.create(
        `completion-${completion.commitment_id}-${Date.now()}`,
        {
          type: "basic",
          iconUrl: chrome.runtime.getURL("assets/icon-128.png"),
          title: "Commitment completed?",
          message: `Looks like you finished: ${commitment?.text ?? "a commitment"}`,
          priority: 1,
        },
      );
    }

    const parts = [];
    if (autoCompletedCount > 0) parts.push(`${autoCompletedCount} auto-done`);
    if (suggestedCount > 0) parts.push(`${suggestedCount} suggestions`);
    await logStatus(
      (autoCompletedCount + suggestedCount) > 0 ? "success" : "info",
      "extractor",
      `Completion detection: ${parts.length > 0 ? parts.join(", ") : "none"} from ${completions.length} results`,
    );
  } catch (err) {
    await logStatus(
      "warn",
      "extractor",
      `Completion detection failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
