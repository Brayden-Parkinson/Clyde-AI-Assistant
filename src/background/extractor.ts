import { db, getDismissalPatterns, getNewCommitmentCount } from "@shared/db";
import { CLAUDE_MODEL } from "@shared/constants";
import type { SourceType, ExtractionResponse, ExtractedCommitment } from "@shared/types";
import { computeHash, isDuplicate } from "./dedup";

/**
 * Build the dynamic dismissal section for the Claude prompt.
 * Pulls all dismissed patterns from the DB and formats them
 * so Claude learns what to skip.
 */
async function buildDismissalBlock(): Promise<string> {
  const dismissals = await getDismissalPatterns();
  if (dismissals.length === 0) return "";

  const lines = dismissals.map(
    (d) => `- Dismissed ${d.count}x: "${d.pattern}" -- user says this is ${d.reason}`,
  );
  return "\n" + lines.join("\n");
}

/**
 * Build the full extraction prompt with dynamic dismissal patterns.
 */
async function buildPrompt(
  messages: Array<{ text: string; sender: string; channel: string; timestamp: string }>,
  sourceType: SourceType,
): Promise<string> {
  const dismissalBlock = await buildDismissalBlock();

  const sourceLabel = sourceType === "meeting" ? "meeting notes" : "Slack messages";
  const messagesText = messages
    .map((m) => `[${m.sender} in ${m.channel} at ${m.timestamp}]: ${m.text}`)
    .join("\n");

  return `You are analyzing ${sourceLabel} sent by or directed at Brayden Parkinson, Director of Product Engineering at OpenSpace.

Extract commitments -- things Brayden agreed to do, or was asked to do by someone else.

INCLUDE patterns:
- "I'll [verb]..." -- committing to an action
- "Let me [verb]..." -- taking ownership
- "I can [do something] by [time]" -- commitment with deadline
- "Can you [verb]..." / "Could you [verb]..." -- someone asking Brayden
- "Action item: [something]" -- explicit assignment
- "[Brayden] to [verb]..." -- meeting notes assignment

EXCLUDE (do NOT flag these):
- Generic politeness: "I'll let you know", "let me know if you need anything"
- Hedging or stalling: "let me think about that", "I'll try", "yeah maybe"
- Information sharing: "I'll explain", "let me walk you through this"
- Past tense: "I already sent", "I looked into it yesterday"
- Questions: "Should I...?", "Do you want me to...?"
${dismissalBlock}

For each commitment found, return this JSON structure:
{
  "commitments": [
    {
      "text": "Brief, actionable description",
      "original_quote": "Exact words from the source text",
      "deadline": "ISO 8601 datetime if mentioned, null if not",
      "urgency": "high | medium | low",
      "context": "Channel name, meeting title, or person name",
      "source_type": "${sourceType}",
      "confidence": 0.0 to 1.0
    }
  ]
}

Confidence scoring:
- 0.9+  : Unambiguous commitment with a clear action verb and ownership
- 0.7-0.9: Likely commitment, slightly ambiguous
- 0.5-0.7: Could go either way -- might be hedging
- Below 0.5: Do NOT include

Only return items with confidence >= 0.5.
Return ONLY valid JSON. No markdown fences. No preamble.

--- MESSAGES ---
${messagesText}`;
}

/**
 * Call the Anthropic API directly via fetch (works in Chrome service workers,
 * unlike the SDK which may have issues in non-Node environments).
 */
async function callClaude(prompt: string): Promise<ExtractionResponse> {
  const result = await chrome.storage.local.get("anthropicApiKey");
  const apiKey = result.anthropicApiKey as string | undefined;
  if (!apiKey) {
    throw new Error("Anthropic API key not configured. Set it in the extension options.");
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
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Claude API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();

  // Extract text from the response content blocks
  const textBlock = data.content?.find(
    (block: { type: string }) => block.type === "text",
  );
  if (!textBlock?.text) {
    throw new Error("No text content in Claude response");
  }

  // Parse the JSON response, stripping any accidental markdown fences
  const cleaned = textBlock.text.trim().replace(/^```json?\s*/, "").replace(/\s*```$/, "");
  const parsed: ExtractionResponse = JSON.parse(cleaned);

  // Validate structure
  if (!Array.isArray(parsed.commitments)) {
    throw new Error("Invalid extraction response: missing commitments array");
  }

  return parsed;
}

/**
 * Validate that an extracted commitment has the required fields and valid values.
 */
function isValidCommitment(c: ExtractedCommitment): boolean {
  return (
    typeof c.text === "string" &&
    c.text.length > 0 &&
    typeof c.original_quote === "string" &&
    c.original_quote.length > 0 &&
    ["high", "medium", "low"].includes(c.urgency) &&
    typeof c.confidence === "number" &&
    c.confidence >= 0.5 &&
    c.confidence <= 1.0 &&
    typeof c.context === "string"
  );
}

/**
 * Main extraction pipeline:
 * 1. Build prompt with dynamic dismissals
 * 2. Call Claude API
 * 3. Deduplicate and store new commitments
 * 4. Fire notifications for high-urgency items
 */
export async function extractCommitments(
  messages: Array<{ text: string; sender: string; channel: string; timestamp: string }>,
  sourceType: SourceType,
): Promise<void> {
  if (messages.length === 0) return;

  try {
    const prompt = await buildPrompt(messages, sourceType);
    const result = await callClaude(prompt);

    let newCount = 0;

    for (const commitment of result.commitments) {
      if (!isValidCommitment(commitment)) continue;

      const hash = await computeHash(
        commitment.original_quote,
        commitment.source_type || sourceType,
        commitment.context,
      );

      if (await isDuplicate(hash)) continue;

      await db.commitments.add({
        hash,
        text: commitment.text,
        original_quote: commitment.original_quote,
        deadline: commitment.deadline,
        urgency: commitment.urgency,
        context: commitment.context,
        source_type: commitment.source_type || sourceType,
        confidence: commitment.confidence,
        status: "new",
        snooze_until: null,
        createdAt: new Date().toISOString(),
      });

      newCount++;

      // Immediately notify for high urgency commitments
      if (commitment.urgency === "high") {
        chrome.notifications.create({
          type: "basic",
          iconUrl: chrome.runtime.getURL("assets/icon-128.png"),
          title: "Commitment Tracker",
          message: commitment.text,
          priority: 2,
        });
      }
    }

    if (newCount > 0) {
      // Update badge directly (avoids circular import with service-worker)
      const count = await getNewCommitmentCount();
      const text = count > 0 ? String(count) : "";
      chrome.action.setBadgeText({ text });
      chrome.action.setBadgeBackgroundColor({ color: "#2b67db" });
    }
  } catch (err) {
    console.error("[CommitmentTracker] Extraction failed:", err);
  }
}
