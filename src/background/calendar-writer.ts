/**
 * calendar-writer.ts
 * Google Calendar write operations — create events and time blocks.
 *
 * Requires: Google OAuth with calendar.events scope.
 * Uses getValidAccessToken() from google-auth.ts.
 * No window/DOM — service worker compatible.
 */

import { API_TIMEOUT_MS, GOOGLE_OAUTH } from "@shared/constants";
import { getValidAccessToken } from "./google-auth";

// ─── Types ───

export interface CalendarEventInput {
  title: string;
  description: string;
  startIso: string;
  endIso: string;
  attendeeEmails?: string[];
}

export interface CalendarWriteResult {
  ok: boolean;
  eventId: string | null;
  eventUrl: string | null;
  error: string | null;
}

// ─── Main API ───

/**
 * Create a time-block calendar event for working on a commitment.
 * Finds the next available round-hour slot if deadline isn't specified.
 */
export async function createTimeBlock(
  commitmentText: string,
  description: string,
  deadline: string | null,
  durationMinutes = 60,
): Promise<CalendarWriteResult> {
  let startIso: string;
  if (deadline) {
    // Block time before deadline
    const deadlineMs = new Date(deadline).getTime();
    startIso = new Date(deadlineMs - durationMinutes * 60_000).toISOString();
  } else {
    // Next round hour at least 30 min from now
    const now = new Date();
    const mins = now.getMinutes();
    const minsToRound = mins <= 30 ? 30 - mins : 60 - mins;
    startIso = new Date(now.getTime() + (minsToRound + 15) * 60_000).toISOString();
  }

  const endIso = new Date(new Date(startIso).getTime() + durationMinutes * 60_000).toISOString();

  return createMeeting({
    title: `Focus: ${commitmentText.slice(0, 60)}`,
    description: description || commitmentText,
    startIso,
    endIso,
  });
}

/** Create a general calendar event with optional attendees. */
export async function createMeeting(input: CalendarEventInput): Promise<CalendarWriteResult> {
  let accessToken: string;
  try {
    accessToken = await getValidAccessToken();
  } catch (err) {
    return {
      ok: false, eventId: null, eventUrl: null,
      error: `Google not connected — ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const body: Record<string, unknown> = {
    summary: input.title,
    description: input.description,
    start: { dateTime: input.startIso, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    end: { dateTime: input.endIso, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
  };

  if (input.attendeeEmails && input.attendeeEmails.length > 0) {
    body.attendees = input.attendeeEmails.map((email) => ({ email }));
  }

  try {
    const response = await fetch(
      `${GOOGLE_OAUTH.CALENDAR_API}/calendars/primary/events`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      },
    );

    if (!response.ok) {
      const errText = await response.text();
      if (response.status === 403) {
        return {
          ok: false, eventId: null, eventUrl: null,
          error: "Calendar write not authorized — reconnect Google with calendar.events permission",
        };
      }
      return {
        ok: false, eventId: null, eventUrl: null,
        error: `Google Calendar API error (${response.status}): ${errText.slice(0, 200)}`,
      };
    }

    const data = await response.json() as { id: string; htmlLink: string };
    return { ok: true, eventId: data.id, eventUrl: data.htmlLink, error: null };
  } catch (err) {
    return {
      ok: false, eventId: null, eventUrl: null,
      error: `Calendar request failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
