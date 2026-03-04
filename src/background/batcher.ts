import { db } from "@shared/db";
import { COMMITMENT_REGEX, BATCH_DEBOUNCE_MS } from "@shared/constants";
import type { SlackMessagePayload } from "@shared/types";
import { extractCommitments } from "./extractor";

type BufferedMessage = SlackMessagePayload["messages"][number];

/** In-memory buffer of messages that passed the pre-filter */
let buffer: BufferedMessage[] = [];

/** Handle for the debounce timer */
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Add messages to the buffer. Each message is pre-filtered against
 * COMMITMENT_REGEX --- only matches are kept. Non-matches go to
 * db.raw_messages for potential manual review.
 */
export function addMessages(
  messages: SlackMessagePayload["messages"],
): void {
  for (const msg of messages) {
    if (COMMITMENT_REGEX.test(msg.text)) {
      buffer.push(msg);
    } else {
      // Store non-matching messages for manual review (fire and forget)
      db.raw_messages.add({
        source_type: "slack",
        sourceId: `${msg.channel}-${msg.timestamp}`,
        text: msg.text,
        sender: msg.sender,
        context: msg.channel,
        timestamp: msg.timestamp,
        capturedAt: new Date().toISOString(),
      });
    }
  }

  // Reset the debounce timer
  resetDebounce();
}

/**
 * Flush the buffer: take all buffered messages, clear the buffer,
 * and pass them to the extractor for Claude processing.
 */
export async function flush(): Promise<void> {
  if (buffer.length === 0) return;

  const toProcess = [...buffer];
  buffer = [];

  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }

  const formatted = toProcess.map((m) => ({
    text: m.text,
    sender: m.sender,
    channel: m.channel,
    timestamp: m.timestamp,
  }));

  await extractCommitments(formatted, "slack");
}

/** Get the current number of buffered messages */
export function getBufferSize(): number {
  return buffer.length;
}

/** Reset (or start) the debounce timer. When it fires, auto-flush. */
function resetDebounce(): void {
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    flush();
  }, BATCH_DEBOUNCE_MS);
}
