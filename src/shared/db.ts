import Dexie, { type EntityTable } from "dexie";
import type {
  Commitment,
  RawMessage,
  Dismissal,
  ActionLogEntry,
  Settings,
} from "./types";

class CommitmentTrackerDB extends Dexie {
  commitments!: EntityTable<Commitment, "id">;
  raw_messages!: EntityTable<RawMessage, "id">;
  dismissals!: EntityTable<Dismissal, "id">;
  action_log!: EntityTable<ActionLogEntry, "id">;
  settings!: EntityTable<Settings, "key">;

  constructor() {
    super("CommitmentTracker");

    this.version(1).stores({
      commitments: "++id, hash, urgency, status, source_type, confidence, createdAt",
      raw_messages: "++id, source_type, sourceId, capturedAt",
      dismissals: "++id, pattern, reason, count, createdAt",
      action_log: "++id, commitmentId, action, createdAt",
      settings: "key",
    });
  }
}

export const db = new CommitmentTrackerDB();

// ─── Helper functions ───

/** Get a setting value with a typed default */
export async function getSetting<T extends string | number | boolean>(
  key: string,
  defaultValue: T,
): Promise<T> {
  const row = await db.settings.get(key);
  return row ? (row.value as T) : defaultValue;
}

/** Set a setting value */
export async function setSetting(
  key: string,
  value: string | number | boolean,
): Promise<void> {
  await db.settings.put({ key, value });
}

/** Get all active (non-dismissed, non-done) commitments */
export async function getActiveCommitments(): Promise<Commitment[]> {
  const now = new Date().toISOString();
  return db.commitments
    .where("status")
    .anyOf("new", "snoozed", "actioned")
    .filter((c) => {
      // If snoozed, only show if snooze has expired
      if (c.status === "snoozed" && c.snooze_until) {
        return c.snooze_until <= now;
      }
      return true;
    })
    .toArray();
}

/** Get all dismissal patterns for Claude prompt injection */
export async function getDismissalPatterns(): Promise<Dismissal[]> {
  return db.dismissals.orderBy("count").reverse().toArray();
}

/** Count commitments with status 'new' for badge */
export async function getNewCommitmentCount(): Promise<number> {
  return db.commitments.where("status").equals("new").count();
}
