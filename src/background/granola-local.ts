import type { MeetingNote, TranscriptResponse } from "@shared/types";

/**
 * Drop-in replacement for granola-mcp.ts.
 * Reads Granola meeting data from the local cache via Chrome Native Messaging
 * instead of OAuth + MCP API calls.
 */

const HOST_NAME = "com.commitment_tracker.granola_reader";

// ─── Native Messaging Helper ───

interface NativeResponse {
  ok: boolean;
  error?: string;
  truncated?: boolean;
  source?: "api" | "cache";
  // ping
  cache_file?: string;
  cache_size_mb?: number;
  last_modified?: string;
  api_reachable?: boolean;
  has_token?: boolean;
  // list_meetings
  meetings?: Array<Record<string, unknown>>;
  // get_transcript (plain)
  transcript?: string | null;
  // get_transcript (rich format)
  segments?: Array<{ text: string; source: string; start?: string }>;
  creator?: string;
  attendees?: string[];
  // list_meetings
  has_transcript?: boolean;
  // voice inbox
  lines?: string[];
}

export function sendNative(message: Record<string, unknown>): Promise<NativeResponse> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendNativeMessage(HOST_NAME, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response as NativeResponse);
    });
  });
}

// ─── Exported API (same signatures as granola-mcp.ts) ───

export async function isGranolaConnected(): Promise<boolean> {
  try {
    const res = await sendNative({ command: "ping" });
    console.log("[CT:granola] ping result:", res);
    return res.ok === true;
  } catch (err) {
    console.warn("[CT:granola] Native messaging ping failed:", err);
    return false;
  }
}

export async function fetchRecentMeetings(since?: string): Promise<MeetingNote[]> {
  const msg: Record<string, unknown> = { command: "list_meetings" };
  if (since) msg.since = since;

  const res = await sendNative(msg);
  console.log("[CT:granola] list_meetings response:", res.ok, `${res.meetings?.length ?? 0} meeting(s)`);

  if (!res.ok || !res.meetings) {
    if (res.error) console.warn("[CT:granola]", res.error);
    return [];
  }

  return res.meetings.map((m) => ({
    id: String(m.id ?? ""),
    title: String(m.title ?? "Untitled Meeting"),
    date: String(m.date ?? new Date().toISOString()),
    attendees: Array.isArray(m.attendees)
      ? m.attendees.map((a: unknown) =>
          typeof a === "string" ? a : String((a as Record<string, unknown>).name ?? a),
        )
      : [],
    summary: String(m.summary ?? ""),
    has_transcript: Boolean(m.has_transcript),
    creator: m.creator ? String(m.creator) : undefined,
  }));
}

export async function fetchTranscript(meetingId: string): Promise<string | null> {
  try {
    const res = await sendNative({ command: "get_transcript", meeting_id: meetingId });
    if (!res.ok) {
      console.warn("[CT:granola] get_transcript error:", res.error);
      return null;
    }
    return res.transcript || null;
  } catch (err) {
    console.warn("[CT:granola] Failed to fetch transcript:", err);
    return null;
  }
}

export async function fetchRichTranscript(meetingId: string): Promise<TranscriptResponse | null> {
  try {
    const res = await sendNative({ command: "get_transcript", meeting_id: meetingId });
    if (!res.ok) {
      console.warn("[CT:granola] get_transcript error:", res.error);
      return null;
    }
    if (res.segments && res.segments.length > 0) {
      return {
        segments: res.segments.map(s => ({
          text: s.text,
          source: (s.source === "microphone" ? "microphone" : "system") as "microphone" | "system",
          start: s.start,
        })),
        creator: res.creator,
        attendees: res.attendees ?? [],
        transcript: res.transcript ?? "",
      };
    }
    // Fallback for old format
    if (res.transcript) {
      return { segments: [], creator: undefined, attendees: [], transcript: res.transcript };
    }
    return null;
  } catch (err) {
    console.warn("[CT:granola] Failed to fetch rich transcript:", err);
    return null;
  }
}
