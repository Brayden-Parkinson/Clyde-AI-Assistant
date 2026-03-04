import { getSetting, setSetting } from "@shared/db";
import { extractCommitments } from "./extractor";

/** Set of note IDs already processed, to avoid re-ingestion */
const processedNoteIds = new Set<string>();

/**
 * Poll Granola API for new meeting notes since the last poll.
 * Extracts title, date, and full text from each note, then
 * passes them directly to the extractor with source_type "meeting".
 *
 * Unlike Slack messages, meeting notes don't need batching/debounce --
 * each note is already a complete unit, so we call the extractor directly.
 */
export async function pollGranola(): Promise<void> {
  try {
    const result = await chrome.storage.local.get("granolaApiKey");
    const apiKey = result.granolaApiKey as string | undefined;

    // If no API key configured, skip silently
    if (!apiKey) return;

    const lastPoll = await getSetting<string>("granolaLastPoll", "");
    const params = new URLSearchParams();
    if (lastPoll) {
      params.set("updated_since", lastPoll);
    }

    const url = `https://api.granola.so/v1/notes${params.toString() ? "?" + params.toString() : ""}`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      console.error(
        `[CommitmentTracker] Granola API error ${response.status}:`,
        await response.text(),
      );
      return;
    }

    const data = await response.json();
    const notes: Array<{
      id: string;
      title?: string;
      date?: string;
      text?: string;
      transcript?: string;
    }> = Array.isArray(data) ? data : data.notes ?? [];

    // Update last poll timestamp
    await setSetting("granolaLastPoll", new Date().toISOString());

    for (const note of notes) {
      if (!note.id || processedNoteIds.has(note.id)) continue;
      processedNoteIds.add(note.id);

      const noteText = note.text || note.transcript || "";
      if (!noteText.trim()) continue;

      const title = note.title || "Untitled Meeting";
      const noteDate = note.date || new Date().toISOString();

      // Pass meeting text directly to extractor (no batching needed)
      await extractCommitments(
        [
          {
            text: noteText,
            sender: "Brayden Parkinson",
            channel: title,
            timestamp: noteDate,
          },
        ],
        "meeting",
      );
    }
  } catch (err) {
    console.error("[CommitmentTracker] Granola poll failed:", err);
  }
}
