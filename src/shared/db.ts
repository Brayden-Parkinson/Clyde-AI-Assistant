import Dexie, { type EntityTable } from "dexie";
import type {
  Commitment,
  RawMessage,
  Dismissal,
  ActionLogEntry,
  Settings,
  DecisionLogEntry,
  CustomColumn,
  KanbanAssignment,
  CompletionSuggestion,
  DismissedCompletion,
  MorningBrief,
} from "./types";

class ClydeDB extends Dexie {
  commitments!: EntityTable<Commitment, "id">;
  raw_messages!: EntityTable<RawMessage, "id">;
  dismissals!: EntityTable<Dismissal, "id">;
  action_log!: EntityTable<ActionLogEntry, "id">;
  settings!: EntityTable<Settings, "key">;
  decision_log!: EntityTable<DecisionLogEntry, "id">;
  kanban_columns!: EntityTable<CustomColumn, "id">;
  kanban_assignments!: EntityTable<KanbanAssignment, "commitment_id">;
  completion_suggestions!: EntityTable<CompletionSuggestion, "id">;
  dismissed_completions!: EntityTable<DismissedCompletion, "commitmentId">;
  briefs!: EntityTable<MorningBrief, "id">;

  constructor() {
    super("CommitmentTracker");

    this.version(1).stores({
      commitments: "++id, hash, urgency, status, source_type, confidence, createdAt",
      raw_messages: "++id, source_type, sourceId, capturedAt",
      dismissals: "++id, pattern, reason, count, createdAt",
      action_log: "++id, commitmentId, action, createdAt",
      settings: "key",
    });

    this.version(2).stores({
      commitments: "++id, hash, urgency, status, source_type, confidence, direction, createdAt",
      raw_messages: "++id, source_type, sourceId, capturedAt",
      dismissals: "++id, pattern, reason, count, createdAt",
      action_log: "++id, commitmentId, action, createdAt",
      settings: "key",
    }).upgrade((tx) => {
      return tx.table("commitments").toCollection().modify((commitment) => {
        if (!commitment.direction) commitment.direction = "by_me";
        if (commitment.likely_completed === undefined) commitment.likely_completed = false;
        if (commitment.completion_signal === undefined) commitment.completion_signal = null;
        if (!commitment.message_timestamp) commitment.message_timestamp = commitment.createdAt;
      });
    });

    this.version(3).stores({
      commitments: "++id, hash, urgency, status, source_type, confidence, direction, createdAt",
      raw_messages: "++id, source_type, sourceId, capturedAt",
      dismissals: "++id, pattern, reason, count, createdAt",
      action_log: "++id, commitmentId, action, createdAt",
      settings: "key",
      decision_log: "++id, decision, category, batchId, createdAt",
    });

    this.version(4).stores({
      commitments: "++id, hash, urgency, status, source_type, confidence, direction, createdAt",
      raw_messages: "++id, source_type, sourceId, capturedAt",
      dismissals: "++id, pattern, reason, count, createdAt",
      action_log: "++id, commitmentId, action, createdAt",
      settings: "key",
      decision_log: "++id, decision, category, batchId, createdAt",
    }).upgrade((tx) => {
      return tx.table("commitments").toCollection().modify((commitment) => {
        if (commitment.context_summary === undefined) commitment.context_summary = null;
        if (commitment.conversation_messages === undefined) commitment.conversation_messages = [];
        if (commitment.slack_link === undefined) commitment.slack_link = null;
      });
    });

    this.version(5).stores({
      commitments: "++id, hash, urgency, status, source_type, confidence, direction, createdAt",
      raw_messages: "++id, source_type, sourceId, capturedAt",
      dismissals: "++id, pattern, reason, count, createdAt",
      action_log: "++id, commitmentId, action, createdAt",
      settings: "key",
      decision_log: "++id, decision, category, batchId, createdAt",
      kanban_columns: "&id, position",
      kanban_assignments: "&commitment_id, column_id",
    });

    this.version(6).stores({
      commitments: "++id, hash, urgency, status, source_type, confidence, direction, createdAt",
      raw_messages: "++id, source_type, sourceId, capturedAt",
      dismissals: "++id, pattern, reason, count, createdAt",
      action_log: "++id, commitmentId, action, createdAt",
      settings: "key",
      decision_log: "++id, decision, category, batchId, createdAt",
      kanban_columns: "&id, position",
      kanban_assignments: "&commitment_id, column_id",
      completion_suggestions: "++id, commitmentId, status, createdAt",
      dismissed_completions: "&commitmentId, lastDismissedAt",
      briefs: "++id, date, dismissed, createdAt",
    });

    this.version(7).stores({
      commitments: "++id, hash, urgency, status, source_type, confidence, direction, createdAt",
      raw_messages: "++id, source_type, sourceId, capturedAt",
      dismissals: "++id, pattern, reason, count, createdAt",
      action_log: "++id, commitmentId, action, createdAt",
      settings: "key",
      decision_log: "++id, decision, category, batchId, createdAt",
      kanban_columns: "&id, position",
      kanban_assignments: "&commitment_id, column_id",
      completion_suggestions: "++id, commitmentId, status, createdAt",
      dismissed_completions: "&commitmentId, lastDismissedAt",
      briefs: "++id, date, dismissed, createdAt",
    }).upgrade((tx) => {
      return tx.table("commitments").toCollection().modify((commitment) => {
        if (commitment.triggered === undefined) commitment.triggered = false;
      });
    });
  }
}

export const db = new ClydeDB();

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
