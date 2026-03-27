import type { Commitment, Person, CalendarEvent } from "@shared/types";

export interface MeetingPrep {
  event: CalendarEvent;
  attendee: Person;
  openItems: Commitment[];
  overdueCount: number;
}

const MS_PER_DAY = 86400000;

function isOverdue(c: Commitment): boolean {
  if (c.deadline) {
    return new Date(c.deadline).getTime() < Date.now();
  }
  const age = (Date.now() - new Date(c.createdAt).getTime()) / MS_PER_DAY;
  return age > 5 && c.status === "new";
}

export function generateMeetingPreps(
  events: CalendarEvent[],
  commitments: Commitment[],
  people: Person[],
  peopleByEmail: Map<string, Person>
): MeetingPrep[] {
  const now = Date.now();

  // Only future 1:1s/small syncs within 8 hours
  const upcoming = events.filter((ev) => {
    if (ev.isAllDay) return false;
    if (ev.attendees.length > 3) return false; // skip large meetings
    const hoursUntil = (new Date(ev.startTime).getTime() - now) / 3600000;
    return hoursUntil > -0.5 && hoursUntil < 8;
  });

  return upcoming
    .map((event) => {
      // Find the attendee as a Person
      const attendee = event.attendees
        .map((email) => peopleByEmail.get(email))
        .find((p): p is Person => p !== undefined);

      if (!attendee) return null;

      const firstName = attendee.name.toLowerCase().split(" ")[0];

      // Find open commitments related to this person
      const openItems = commitments.filter((c) => {
        const ctx = c.context.toLowerCase();
        return ctx.includes(firstName) || ctx.includes(attendee.name.toLowerCase());
      });

      openItems.sort((a, b) => {
        const aOv = isOverdue(a) ? 1 : 0;
        const bOv = isOverdue(b) ? 1 : 0;
        if (aOv !== bOv) return bOv - aOv;
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      });

      return {
        event,
        attendee,
        openItems,
        overdueCount: openItems.filter(isOverdue).length,
      };
    })
    .filter((p): p is MeetingPrep => p !== null);
}
