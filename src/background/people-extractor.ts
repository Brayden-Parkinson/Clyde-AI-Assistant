import { db } from "@shared/db";
import type { Commitment, CalendarEvent } from "@shared/types";
import { logStatus } from "@shared/status";
import { getUserProfile } from "@shared/user-profile";

// Known bot/system names to skip — these are never actionable contacts
const BOT_NAME_PATTERN = /^(slackbot|workflow|github|linear|jira|figma|notion|zapier|app|integration|automation|bot|alert|notification|webhook|deploy|ci|cd|jenkins|travis|circleci|datadog|pagerduty|sentry|slack app)/i;

/**
 * Extract people from a commitment's conversation_messages senders.
 * Upserts into people table: name match (case-insensitive), increment commitmentCount,
 * update lastSeenAt, add channel to channels[] if not present.
 */
export async function extractPeopleFromCommitment(commitment: Commitment): Promise<void> {
  const now = new Date().toISOString();
  const messages = commitment.conversation_messages ?? [];
  const profile = await getUserProfile();
  const selfName = (profile.userName || "").toLowerCase();

  // Collect unique senders — skip self, "You", and known bots
  const senders = new Set<string>();
  for (const msg of messages) {
    const name = msg.sender.trim();
    if (!name) continue;
    if (name.toLowerCase() === "you") continue;
    if (selfName && name.toLowerCase() === selfName) continue;
    if (BOT_NAME_PATTERN.test(name)) continue;
    senders.add(name);
  }

  for (const name of senders) {
    const existing = await db.people.where("name").equalsIgnoreCase(name).first();

    if (existing && existing.id != null) {
      // Update existing person
      const channels = existing.channels ?? [];
      if (commitment.context && !channels.includes(commitment.context)) {
        channels.push(commitment.context);
      }
      await db.people.update(existing.id, {
        commitmentCount: existing.commitmentCount + 1,
        lastSeenAt: now,
        channels,
      });
    } else {
      // Create new person
      await db.people.add({
        name,
        email: null,
        relationship: null,
        notes: null,
        commitmentCount: 1,
        lastSeenAt: now,
        channels: commitment.context ? [commitment.context] : [],
        createdAt: now,
      });
    }
  }
}

/**
 * Extract people from calendar event attendees.
 */
export async function extractPeopleFromCalendar(events: CalendarEvent[]): Promise<void> {
  const now = new Date().toISOString();
  const profile = await getUserProfile();
  const selfName = (profile.userName || "").toLowerCase();

  for (const event of events) {
    for (const attendeeEmail of event.attendees) {
      const email = attendeeEmail.trim().toLowerCase();
      if (!email) continue;
      if (BOT_NAME_PATTERN.test(email.split("@")[0] ?? "")) continue;

      // Try to find by email first
      const byEmail = await db.people.where("email").equals(email).first();
      if (byEmail && byEmail.id != null) {
        const channels = byEmail.channels ?? [];
        if (event.title && !channels.includes(event.title)) {
          channels.push(event.title);
        }
        await db.people.update(byEmail.id, {
          commitmentCount: byEmail.commitmentCount + 1,
          lastSeenAt: now,
          channels,
        });
        continue;
      }

      // Try to extract a name from the email prefix (e.g. "sarah.chen" -> "Sarah Chen")
      const prefix = email.split("@")[0] ?? "";
      const nameParts = prefix.split(/[._-]/).filter(Boolean);
      const derivedName = nameParts
        .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
        .join(" ");

      if (!derivedName) continue;
      if (selfName && derivedName.toLowerCase() === selfName) continue;

      // Try to find by derived name
      const byName = await db.people.where("name").equalsIgnoreCase(derivedName).first();
      if (byName && byName.id != null) {
        const channels = byName.channels ?? [];
        if (event.title && !channels.includes(event.title)) {
          channels.push(event.title);
        }
        await db.people.update(byName.id, {
          commitmentCount: byName.commitmentCount + 1,
          lastSeenAt: now,
          channels,
          // Backfill email if missing
          ...(byName.email ? {} : { email }),
        });
        continue;
      }

      // Create new person
      await db.people.add({
        name: derivedName,
        email,
        relationship: null,
        notes: null,
        commitmentCount: 1,
        lastSeenAt: now,
        channels: event.title ? [event.title] : [],
        createdAt: now,
      });
    }
  }
}

/**
 * One-time backfill: scan all commitments to seed the people table.
 */
export async function backfillPeopleFromHistory(): Promise<void> {
  const commitments = await db.commitments.toArray();
  for (const c of commitments) {
    await extractPeopleFromCommitment(c).catch(() => {});
  }
  await logStatus("info", "people", `People backfill complete: scanned ${commitments.length} commitments`);
}
