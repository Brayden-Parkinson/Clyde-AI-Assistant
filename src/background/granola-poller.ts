import { COMMITMENT_REGEX } from "@shared/constants";
import { logStatus, updateStatus } from "@shared/status";
import type { TranscriptSegment, SlackMessagePayload } from "@shared/types";
import { getUserProfile } from "@shared/user-profile";
import { extractCommitments } from "./extractor";
import { isGranolaConnected, fetchRecentMeetings, fetchRichTranscript } from "./granola-local";
import { requestBackupSave } from "./backup-sync";

type BufferedMessage = SlackMessagePayload["messages"][number];

/** Chrome storage keys */
const PROCESSED_IDS_KEY = "granolaProcessedNoteIds";
const WATERMARK_KEY = "granolaScannedThrough";

// ─── Rich Transcript Formatting ───

/**
 * Convert structured transcript segments into tagged BufferedMessages
 * that the extractor already understands (same format as Slack pipeline).
 */
function formatTranscriptForExtraction(
  segments: TranscriptSegment[],
  creator: string,
  attendees: string[],
  title: string,
): { candidates: BufferedMessage[]; context: BufferedMessage[] } {
  const messages: BufferedMessage[] = segments.map((seg) => ({
    text: seg.text,
    sender: seg.source === "microphone" ? creator : "Other",
    channel: title,
    timestamp: seg.start ?? new Date().toISOString(),
    isMine: seg.source === "microphone",
    mentionsMe: false,
    reactions: [],
    channel_id: null,
    message_ts: null,
    slack_link: null,
  }));

  // Candidates = user's own speech + any segment matching commitment patterns
  const candidates = messages.filter(
    (m) => m.isMine || COMMITMENT_REGEX.test(m.text),
  );
  const context = messages.filter(
    (m) => !m.isMine && !COMMITMENT_REGEX.test(m.text),
  );

  return { candidates, context };
}

// ─── Main Poller ───

/**
 * Poll Granola for new meeting notes since the last poll.
 * Uses a date watermark + processed-ID set for efficient dedup.
 * Returns structured speaker-tagged transcripts to the extractor.
 */
export async function pollGranola(): Promise<void> {
  try {
    const connected = await isGranolaConnected();
    await updateStatus({ granolaConnected: connected });
    if (!connected) {
      await logStatus("info", "granola", "Granola poll skipped — not connected");
      return;
    }

    await logStatus("info", "granola", "Granola poll starting...");

    // Load dedup state
    const storage = await chrome.storage.local.get([
      "granolaLastPoll",
      WATERMARK_KEY,
      PROCESSED_IDS_KEY,
    ]);
    const lastPoll = storage.granolaLastPoll as string | undefined;
    const watermark = storage[WATERMARK_KEY] as string | undefined;
    const processedIds: string[] = (storage[PROCESSED_IDS_KEY] as string[]) ?? [];
    const processedSet = new Set(processedIds);

    // Use the more recent of lastPoll and watermark as the `since` filter
    let since: string | undefined;
    if (lastPoll && watermark) {
      since = lastPoll > watermark ? lastPoll : watermark;
    } else {
      since = lastPoll || watermark || undefined;
    }
    await logStatus("info", "granola", `Since filter: ${since ?? "none"} (poll=${lastPoll ?? "never"}, watermark=${watermark ?? "never"})`);

    const meetings = await fetchRecentMeetings(since);
    await logStatus("info", "granola", `Fetched ${meetings.length} meeting(s) from Granola`);

    // Fix the storage bug: write lastPoll to chrome.storage.local (was going to IndexedDB via setSetting)
    await chrome.storage.local.set({ granolaLastPoll: new Date().toISOString() });

    const newlyProcessed: string[] = [];
    let newestMeetingDate: string | undefined;

    for (const meeting of meetings) {
      if (!meeting.id || processedSet.has(meeting.id)) {
        await logStatus("info", "granola", `Skipping already-processed: ${meeting.title || meeting.id}`);
        continue;
      }

      // Skip meetings without transcripts or summaries early
      if (!meeting.has_transcript && !meeting.summary) {
        await logStatus("info", "granola", `Skipping "${meeting.title}" — no transcript or summary yet`);
        continue;
      }

      await logStatus("info", "granola", `Processing: "${meeting.title || "Untitled"}" (${meeting.id})`);

      const title = meeting.title || "Untitled Meeting";
      const noteDate = meeting.date || new Date().toISOString();

      // Try rich transcript first
      const rich = meeting.has_transcript ? await fetchRichTranscript(meeting.id) : null;

      const profile = await getUserProfile();
      const fallbackName = profile.userName || "User";

      if (rich && rich.segments.length > 0) {
        // ── Rich path: speaker-tagged segments ──
        const creator = rich.creator || fallbackName;
        const attendeeNames = rich.attendees.length > 0 ? rich.attendees : meeting.attendees;

        await logStatus("info", "granola", `Rich transcript: ${rich.segments.length} segments, creator="${creator}", ${attendeeNames.length} attendees`);

        const { candidates, context } = formatTranscriptForExtraction(
          rich.segments,
          creator,
          attendeeNames,
          title,
        );

        if (candidates.length === 0) {
          await logStatus("info", "granola", `No candidate segments in "${title}" — skipping extraction`);
          newlyProcessed.push(meeting.id);
          continue;
        }

        // Prepend an attendee header as a context message so Claude knows who's in the meeting
        const headerMsg: BufferedMessage = {
          text: `Meeting: "${title}"\nAttendees: ${creator} (you)${attendeeNames.length > 0 ? ", " + attendeeNames.join(", ") : ""}`,
          sender: "system",
          channel: title,
          timestamp: noteDate,
          isMine: false,
          mentionsMe: false,
          reactions: [],
          channel_id: null,
          message_ts: null,
          slack_link: null,
        };

        await extractCommitments(candidates, [headerMsg, ...context], "meeting");
      } else {
        // ── Fallback path: flat transcript or summary ──
        const noteText = rich?.transcript || meeting.summary || "";
        if (!noteText.trim()) {
          await logStatus("warn", "granola", `Meeting "${title}" has no content — skipping`);
          continue;
        }

        await logStatus("info", "granola", `Flat transcript fallback for "${title}" (${noteText.length} chars)`);

        await extractCommitments(
          [
            {
              text: noteText,
              sender: fallbackName,
              channel: title,
              timestamp: noteDate,
              isMine: true,
              mentionsMe: false,
              reactions: [],
              channel_id: null,
              message_ts: null,
              slack_link: null,
            },
          ],
          [],
          "meeting",
        );
      }

      newlyProcessed.push(meeting.id);

      // Track the newest meeting date for watermark
      if (!newestMeetingDate || noteDate > newestMeetingDate) {
        newestMeetingDate = noteDate;
      }
    }

    // Persist updated state
    if (newlyProcessed.length > 0) {
      const updated = [...processedIds, ...newlyProcessed].slice(-100);
      const storageUpdate: Record<string, unknown> = {
        [PROCESSED_IDS_KEY]: updated,
      };
      // Advance watermark to newest meeting date
      if (newestMeetingDate) {
        const currentWatermark = watermark ?? "";
        if (newestMeetingDate > currentWatermark) {
          storageUpdate[WATERMARK_KEY] = newestMeetingDate;
        }
      }
      await chrome.storage.local.set(storageUpdate);
      requestBackupSave();
    }

    await logStatus("success", "granola", `Granola poll complete — ${newlyProcessed.length} new meeting(s) processed`);
  } catch (err) {
    if (err instanceof Error && err.message === "not_connected") {
      await logStatus("info", "granola", "Granola poll skipped — not connected");
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    await logStatus("error", "granola", `Granola poll failed: ${msg}`);
    console.error("[CommitmentTracker] Granola poll failed:", err);
  }
}
