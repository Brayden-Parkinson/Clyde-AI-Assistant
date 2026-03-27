import type { Commitment, Person, CalendarEvent } from "@shared/types";

export type HeatLevel = "hot" | "warm" | "neutral";

export interface RankedItem {
  commitment: Commitment;
  person: Person | undefined;
  score: number;
  heatLevel: HeatLevel;
  whyNow: string;
}

const TIER_WEIGHTS: Record<string, number> = {
  manager: 50,
  report: 35,
  peer: 15,
  stakeholder: 20,
  external: 5,
};

const MS_PER_DAY = 86400000;

function ageDays(c: Commitment): number {
  return (Date.now() - new Date(c.createdAt).getTime()) / MS_PER_DAY;
}

function staleDays(c: Commitment): number {
  return (Date.now() - new Date(c.message_timestamp).getTime()) / MS_PER_DAY;
}

function meetingProximityScore(
  person: Person | undefined,
  events: CalendarEvent[],
  peopleByEmail: Map<string, Person>
): { score: number; event: CalendarEvent | null } {
  if (!person?.email) return { score: 0, event: null };
  const now = Date.now();
  let best = { score: 0, event: null as CalendarEvent | null };

  for (const ev of events) {
    // Skip all-day events and large meetings (standup/planning)
    if (ev.isAllDay || ev.attendees.length > 3) continue;
    if (!ev.attendees.includes(person.email)) continue;

    const hoursUntil = (new Date(ev.startTime).getTime() - now) / 3600000;
    if (hoursUntil < -0.5 || hoursUntil > 24) continue;

    // Closer = higher score. Max 40 at 0 hours.
    const score = Math.max(0, 40 * (1 - hoursUntil / 24));
    if (score > best.score) best = { score, event: ev };
  }
  return best;
}

function urgencyScore(c: Commitment): number {
  let score = 0;
  if (c.urgency === "high") score += 25;
  if (c.urgency === "medium") score += 10;
  if (c.completion_signal) score += 5; // some activity
  return score;
}

function ageScore(c: Commitment): number {
  const age = ageDays(c);
  const stale = staleDays(c);
  return Math.min(25, age * 2 + stale * 1.5);
}

function findPersonForCommitment(
  c: Commitment,
  people: Person[]
): Person | undefined {
  // Match by context string containing person name
  const ctx = c.context.toLowerCase();
  return people.find((p) => {
    const firstName = p.name.toLowerCase().split(" ")[0];
    return ctx.includes(firstName) || ctx.includes(p.name.toLowerCase());
  });
}

function generateWhyNow(
  c: Commitment,
  person: Person | undefined,
  meetingEvent: CalendarEvent | null,
  scores: { tier: number; meeting: number; urgency: number; age: number }
): string {
  const firstName = person?.name.split(" ")[0] ?? "Someone";

  if (scores.meeting > 20 && meetingEvent) {
    const time = new Date(meetingEvent.startTime).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
    const label = meetingEvent.attendees.length <= 2 ? "1:1" : "sync";
    return `You have a ${label} with ${firstName} at ${time}`;
  }
  if (c.urgency === "high") {
    return `Marked high urgency`;
  }
  if (person?.relationship === "manager") {
    return `Your manager is waiting on this`;
  }
  if (ageDays(c) > 7) {
    return `Open for ${Math.round(ageDays(c))} days with no activity`;
  }
  if (staleDays(c) > 3) {
    return `No activity in ${Math.round(staleDays(c))} days`;
  }
  if (person) {
    const rel = person.relationship === "report" ? "direct report" : (person.relationship ?? "contact");
    return `Owed to ${firstName} (${rel})`;
  }
  return `From ${c.context}`;
}

function computeHeatLevel(score: number): HeatLevel {
  if (score >= 80) return "hot";
  if (score >= 50) return "warm";
  return "neutral";
}

export function rankCommitments(
  commitments: Commitment[],
  people: Person[],
  events: CalendarEvent[],
  peopleByEmail: Map<string, Person>,
  limit = 5
): RankedItem[] {
  const ranked = commitments.map((c) => {
    const person = findPersonForCommitment(c, people);
    const tier = TIER_WEIGHTS[person?.relationship ?? ""] ?? 10;
    const meeting = meetingProximityScore(person, events, peopleByEmail);
    const urgency = urgencyScore(c);
    const age = ageScore(c);
    const score = tier + meeting.score + urgency + age;

    return {
      commitment: c,
      person,
      score,
      heatLevel: computeHeatLevel(score),
      whyNow: generateWhyNow(c, person, meeting.event, {
        tier,
        meeting: meeting.score,
        urgency,
        age,
      }),
    };
  });

  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, limit);
}
