import { db, getDismissalPatterns, getNewCommitmentCount, getActiveCommitments } from "@shared/db";
import { CLAUDE_MODEL, MAX_DISMISSAL_PATTERNS } from "@shared/constants";
import type { SourceType, ExtractionResponse, ExtractedCommitment, RejectedCandidate, SlackMessagePayload, DecisionLogEntry, ConversationMessage, SlackWatermarks } from "@shared/types";
import { logStatus, updateStatus, getStatus } from "@shared/status";
import { getUserProfile } from "@shared/user-profile";
import { computeHash, isDuplicate } from "./dedup";
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

async function buildSystemPrompt(): Promise<string> {
  const dismissalBlock = await buildDismissalBlock();
  const devMode = await isDevModeEnabled();
  const profile = await getUserProfile();
  const userName = profile.userName || "the user";
  const userTitle = profile.userTitle ? `, ${profile.userTitle}` : "";
  const userCompany = profile.userCompany ? ` at ${profile.userCompany}` : "";

  const rejectionBlock = devMode ? `

DECISION LOG (Developer Mode is ON):
In addition to the "commitments" array, also return a "rejections" array listing every candidate message you considered but decided NOT to extract as a commitment. For each rejection include:
- "original_text": the exact message text
- "sender": who sent it
- "channel": which channel
- "reason": a brief, plain-English explanation of why it's not a commitment (e.g. "Delegation to someone else, not ${userName}'s commitment", "Past tense — already done", "Hedging/uncertain — 'I'll try'")
- "category": one of "not_commitment", "third_party", "hedging", "past_tense", "delegation", "politeness", "low_confidence", "acknowledgment"

Only include messages that matched commitment-like patterns but were ruled out. Don't include completely irrelevant context messages.` : "";

  return `You are analyzing Slack messages for ${userName}${userTitle}${userCompany}.

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

CONTEXT SUMMARY:
For each commitment, also return a "context_summary" field: 1-3 sentences summarizing the conversation that led to the commitment. Focus on: what was being discussed, who was involved, and why the commitment arose. If there's not enough surrounding context, set it to null.

EXAMPLES:

Example 1 — Completed commitment:
Messages:
[ME] [[User] in #engineering at 9:00 AM]: I'll send over the API spec after lunch
[Sarah in #engineering at 2:00 PM]: @[User] did you get a chance to send that spec?
[ME] [[User] in #engineering at 2:05 PM]: Just sent it! [reactions: ✅]
Output: {"commitments":[{"text":"Send API spec to Sarah","original_quote":"I'll send over the API spec after lunch","deadline":null,"urgency":"low","context":"#engineering","source_type":"slack","confidence":0.85,"direction":"by_me","likely_completed":true,"completion_signal":"Just sent it!","message_timestamp":"9:00 AM","context_summary":"Sarah asked about the API spec. [User] committed to sending it after lunch and followed up later confirming it was sent.","triggered":false}]}

Example 2 — Valid assignment:
Messages:
[Sarah in #engineering at 10:00 AM]: @[User] can you review the PRD for the new dashboard? Need it by Friday
Output: {"commitments":[{"text":"Review PRD for new dashboard","original_quote":"@[User] can you review the PRD for the new dashboard? Need it by Friday","deadline":"<next Friday ISO>","urgency":"medium","context":"#engineering","source_type":"slack","confidence":0.9,"direction":"assigned_to_me","likely_completed":false,"completion_signal":null,"message_timestamp":"10:00 AM","context_summary":"Sarah asked [User] to review the PRD for the new dashboard feature, with a Friday deadline.","triggered":false}]}

Example 3 — Empty result (delegation + hedging):
Messages:
[ME] [[User] in #engineering at 11:00 AM]: Alice, can you handle the deploy today?
[ME] [[User] in #engineering at 11:05 AM]: I'll try to look at it if I get time
Output: {"commitments":[]}

Return ONLY valid JSON. No markdown fences. No preamble.${rejectionBlock}${dismissalBlock}`;
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

  // Sort each channel chronologically
  for (const msgs of byChannel.values()) {
    msgs.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  // Build output
  const sections: string[] = [];
  for (const [channel, msgs] of byChannel) {
    const lines: string[] = [`## #${channel}`, ""];
    for (const msg of msgs) {
      let prefix: string;
      if (msg.isMine) {
        prefix = "[ME]";
      } else if (msg.mentionsMe && msg.tag === "candidate") {
        prefix = "[MENTIONS ME]";
      } else if (msg.tag === "context") {
        prefix = "[context]";
      } else {
        // Non-mine candidate that doesn't mention me
        prefix = "[MENTIONS ME]";
      }

      let line = `${prefix} [${msg.sender} in #${msg.channel} at ${msg.timestamp}]: ${msg.text}`;
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

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      system: system,
      messages: [
        { role: "user", content: userMessage },
      ],
    }),
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

  const raw = textBlock.text.trim();
  // Strip markdown fences
  let cleaned = raw.replace(/^```json?\s*/, "").replace(/\s*```$/, "");
  // If Claude added preamble, find the first { and last }
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace > 0 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }
  const parsed: ExtractionResponse = JSON.parse(cleaned);

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
    const system = await buildSystemPrompt();
    const userMessage = buildUserMessage(candidates, contextMessages);
    const result = await callClaude(system, userMessage);

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

      const hash = await computeHash(
        commitment.original_quote,
        commitment.source_type || sourceType,
        commitment.context,
      );

      if (await isDuplicate(hash)) {
        dupeCount++;
        continue;
      }

      const allBatchMessages = [...candidates, ...contextMessages];
      const { messages: conversationMessages, slackLink } = buildConversationMessages(commitment, allBatchMessages);

      const isTriggered = commitment.triggered === true;

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
        createdAt: new Date().toISOString(),
      });

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
): Promise<unknown> {
  const result = await chrome.storage.local.get("anthropicApiKey");
  const apiKey = result.anthropicApiKey as string | undefined;
  if (!apiKey) {
    throw new Error("No API key configured");
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
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
      system: system,
      messages: [{ role: "user", content: userMessage }],
    }),
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

  const raw = textBlock.text.trim();
  let cleaned = raw.replace(/^```json?\s*/, "").replace(/\s*```$/, "");
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace > 0 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }

  return JSON.parse(cleaned);
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

Be conservative — only flag completions you're fairly confident about.
False positives (marking something done that isn't) are worse than false negatives (missing a completion).

Return ONLY valid JSON (no markdown fences):
{ "completions": [ { "commitment_id": 123, "confidence": 0.85, "evidence": "brief description of evidence", "source_message": "exact message text that triggered this" } ] }
If no completions detected, return: { "completions": [] }`;

  try {
    const raw = await callClaudeRaw(
      systemPrompt,
      "Check the messages above against the open commitments.",
    );

    const parsed = raw as { completions?: CompletionResult[] };
    const completions = parsed.completions;
    if (!Array.isArray(completions)) {
      await logStatus("warn", "extractor", "Completion detection returned invalid format");
      return;
    }

    let suggestedCount = 0;

    for (const completion of completions) {
      if (completion.confidence < 0.7) continue;

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
      const commitment = capped.find((c) => c.id === completion.commitment_id);
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

    await logStatus(
      suggestedCount > 0 ? "success" : "info",
      "extractor",
      `Completion detection: ${suggestedCount} suggestions from ${completions.length} results`,
    );
  } catch (err) {
    await logStatus(
      "warn",
      "extractor",
      `Completion detection failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
