import { db } from "@shared/db";
import { GOOGLE_OAUTH } from "@shared/constants";
import type { CalendarEvent } from "@shared/types";
import { logStatus } from "@shared/status";
import { getValidAccessToken } from "./google-auth";

/**
 * Fetch calendar events from Google Calendar API and cache them in IndexedDB.
 * Fetches events for the next 7 days.
 */
export async function fetchAndCacheCalendarEvents(): Promise<void> {
  let accessToken: string;
  try {
    accessToken = await getValidAccessToken();
  } catch {
    // Not connected — silently skip
    return;
  }

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endDate = new Date(startOfToday.getTime() + 7 * 24 * 60 * 60 * 1000);

  const params = new URLSearchParams({
    timeMin: startOfToday.toISOString(),
    timeMax: endDate.toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "100",
  });

  const url = `${GOOGLE_OAUTH.CALENDAR_API}/calendars/primary/events?${params}`;

  await logStatus("info", "calendar", "Fetching calendar events from Google...");

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Google Calendar API error (${response.status}): ${errorText.slice(0, 200)}`);
  }

  const data = await response.json() as {
    items?: Array<{
      id: string;
      summary?: string;
      start?: { dateTime?: string; date?: string };
      end?: { dateTime?: string; date?: string };
      attendees?: Array<{ email?: string; displayName?: string }>;
      status?: string;
    }>;
  };

  const events = data.items ?? [];
  const fetchedAt = new Date().toISOString();

  for (const event of events) {
    if (!event.id) continue;

    const isAllDay = !event.start?.dateTime;
    const startTime = event.start?.dateTime ?? event.start?.date ?? "";
    const endTime = event.end?.dateTime ?? event.end?.date ?? "";

    const attendees = (event.attendees ?? [])
      .map((a) => a.displayName || a.email || "")
      .filter(Boolean);

    const calEvent: Omit<CalendarEvent, "id"> = {
      googleEventId: event.id,
      title: event.summary ?? "Untitled",
      startTime,
      endTime,
      attendees,
      isAllDay,
      status: (event.status === "tentative" || event.status === "cancelled")
        ? event.status
        : "confirmed",
      fetchedAt,
    };

    // Upsert by googleEventId
    const existing = await db.calendar_cache
      .where("googleEventId")
      .equals(event.id)
      .first();

    if (existing?.id != null) {
      await db.calendar_cache.update(existing.id, calEvent);
    } else {
      await db.calendar_cache.add(calEvent as CalendarEvent);
    }
  }

  await logStatus("info", "calendar", `Cached ${events.length} calendar events for next 7 days`);
}

/**
 * Get cached calendar events, optionally filtered to a specific date.
 * @param date - Optional YYYY-MM-DD string to filter events for that day
 */
export async function getCachedEvents(date?: string): Promise<CalendarEvent[]> {
  const allEvents = await db.calendar_cache.toArray();

  if (!date) return allEvents;

  return allEvents.filter((event) => {
    // For all-day events, startTime is YYYY-MM-DD
    if (event.isAllDay) {
      return event.startTime === date;
    }
    // For timed events, startTime is ISO datetime — compare the date portion
    return event.startTime.slice(0, 10) === date;
  });
}
