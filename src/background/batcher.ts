import { db } from "@shared/db";
import { COMMITMENT_REGEX, CHANNEL_FILTER_DEFAULT_ALLOW } from "@shared/constants";
import type { SlackMessagePayload, SlackWatermarks } from "@shared/types";
import { logStatus, updateStatus, getStatus } from "@shared/status";
import { extractCommitments, detectCompletions } from "./extractor";

type BufferedMessage = SlackMessagePayload["messages"][number];

const BUFFER_KEY = "batcherBuffer";
const BATCH_ALARM = "batcher-flush";

export async function addMessages(
  messages: SlackMessagePayload["messages"],
): Promise<{ matched: number; total: number }> {
  // Filter out messages older than channel watermarks
  const wmResult = await chrome.storage.local.get(["slackChannelWatermarks", "slackChannelFilter"]);
  const watermarks = (wmResult.slackChannelWatermarks as SlackWatermarks) ?? {};
  const channelFilter = (wmResult.slackChannelFilter as Record<string, boolean>) ?? {};
  let skippedCount = 0;
  let channelFilteredCount = 0;

  const filtered = messages.filter((m) => {
    // Channel filter: check allow/deny list
    const channelAllowed = channelFilter[m.channel] ?? CHANNEL_FILTER_DEFAULT_ALLOW;
    if (!channelAllowed) {
      channelFilteredCount++;
      return false;
    }

    if (!m.message_ts) return true; // No timestamp → always pass through
    const wm = watermarks[m.channel];
    if (wm?.lastMessageTs && m.message_ts <= wm.lastMessageTs) {
      skippedCount++;
      return false;
    }
    return true;
  });

  if (skippedCount > 0) {
    await logStatus("info", "batcher", `Skipped ${skippedCount} messages older than channel watermarks`);
  }
  if (channelFilteredCount > 0) {
    await logStatus("info", "batcher", `Skipped ${channelFilteredCount} messages from excluded channels`);
  }

  const matched = filtered.filter((m) => COMMITMENT_REGEX.test(m.text)).length;

  // Buffer ALL messages (candidates + context)
  const existing = await getPersistedBuffer();
  existing.push(...filtered);
  await chrome.storage.session.set({ [BUFFER_KEY]: existing });

  // Update total received count
  const status = await getStatus();
  await updateStatus({
    totalMessagesReceived: status.totalMessagesReceived + filtered.length,
    bufferedMessages: existing.length,
  });

  await logStatus(
    "info",
    "batcher",
    `Buffered ${filtered.length} messages (${matched} match commitment patterns). Buffer now has ${existing.length} total.`,
  );

  // Still store raw messages for audit trail
  for (const msg of filtered) {
    const isGdoc = !msg.channel_id && msg.slack_link?.includes("docs.google.com");
    db.raw_messages.add({
      source_type: isGdoc ? "gdoc" : "slack",
      sourceId: `${msg.channel}-${msg.timestamp}`,
      text: msg.text,
      sender: msg.sender,
      context: msg.channel,
      timestamp: msg.timestamp,
      capturedAt: new Date().toISOString(),
    });
  }

  // Schedule flush
  const existingAlarm = await chrome.alarms.get(BATCH_ALARM);
  if (!existingAlarm) {
    chrome.alarms.create(BATCH_ALARM, { delayInMinutes: 1 });
  }

  return { matched, total: filtered.length };
}

export async function flush(): Promise<void> {
  const buffer = await getPersistedBuffer();

  if (buffer.length === 0) {
    await logStatus("info", "batcher", "Flush called but buffer is empty — nothing to extract");
    return;
  }

  // Separate candidates from context
  const candidates = buffer.filter((m) => COMMITMENT_REGEX.test(m.text));
  const contextMessages = buffer.filter((m) => !COMMITMENT_REGEX.test(m.text));

  await logStatus(
    "info",
    "batcher",
    `Flushing: ${candidates.length} candidates, ${contextMessages.length} context messages`,
  );

  await chrome.storage.session.remove(BUFFER_KEY);
  await chrome.alarms.clear(BATCH_ALARM);
  await updateStatus({ bufferedMessages: 0 });

  if (candidates.length === 0) {
    await logStatus("info", "batcher", "No commitment candidates in batch — skipping extraction");
    return;
  }

  // Determine source type: if any messages look like Google Docs, use "gdoc"
  const hasGdoc = candidates.some((m) => !m.channel_id && m.slack_link?.includes("docs.google.com"));
  const sourceType = hasGdoc ? "gdoc" as const : "slack" as const;
  await extractCommitments(candidates, contextMessages, sourceType);

  // Run completion detection every other flush to save API costs
  const cycleResult = await chrome.storage.session.get("completionCheckCycle");
  const cycle = ((cycleResult.completionCheckCycle as number) ?? 0) + 1;
  await chrome.storage.session.set({ completionCheckCycle: cycle });
  if (cycle % 2 === 0) {
    await detectCompletions(candidates, contextMessages);
  }
}

export async function getBufferSize(): Promise<number> {
  const buffer = await getPersistedBuffer();
  return buffer.length;
}

async function getPersistedBuffer(): Promise<BufferedMessage[]> {
  const result = await chrome.storage.session.get(BUFFER_KEY);
  return (result[BUFFER_KEY] as BufferedMessage[]) ?? [];
}
