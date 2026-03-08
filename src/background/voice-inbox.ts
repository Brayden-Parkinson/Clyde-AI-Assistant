import { COMMITMENT_REGEX } from "@shared/constants";
import { logStatus } from "@shared/status";
import { getUserProfile } from "@shared/user-profile";
import { extractCommitments } from "./extractor";
import { sendNative } from "./granola-local";
import type { SlackMessagePayload } from "@shared/types";

type BufferedMessage = SlackMessagePayload["messages"][number];

/**
 * Poll ~/Documents/clyde-inbox.txt via native messaging.
 * Each non-empty line is treated as a voice-dictated task.
 * Lines are sent through the standard extraction pipeline so Claude
 * can parse deadlines, urgency, and direction.
 */
export async function pollVoiceInbox(): Promise<void> {
  try {
    const res = await sendNative({ command: "read_inbox" });
    if (!res.ok || !res.lines || (res.lines as string[]).length === 0) {
      return; // Nothing to process — silent return
    }

    const lines = res.lines as string[];
    await logStatus("info", "voice-inbox", `Found ${lines.length} task(s) in voice inbox`);

    const profile = await getUserProfile();
    const userName = profile.userName || "Me";
    const now = new Date().toISOString();

    // Build messages in the same format the extractor expects
    const candidates: BufferedMessage[] = lines.map((line) => ({
      text: line,
      sender: userName,
      channel: "Voice Inbox",
      timestamp: now,
      isMine: true,
      mentionsMe: false,
      reactions: [],
      channel_id: null,
      message_ts: null,
      slack_link: null,
      thread_ts: null,
      is_thread_reply: false,
    }));

    // All voice inbox lines are candidates (user explicitly dictated them as tasks)
    const context: BufferedMessage[] = [];

    await extractCommitments(candidates, context, "voice");

    // Clear the inbox after successful extraction
    await sendNative({ command: "clear_inbox" });
    await logStatus("success", "voice-inbox", `Processed ${lines.length} voice task(s)`);
  } catch (err) {
    // If native messaging isn't available, silently skip
    if (err instanceof Error && err.message.includes("not found")) return;
    const msg = err instanceof Error ? err.message : String(err);
    await logStatus("warn", "voice-inbox", `Voice inbox poll failed: ${msg}`);
  }
}
