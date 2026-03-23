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
  Tag,
  CalendarEvent,
  Person,
  PersonContext,
  ChatSession,
  ChatMessageRecord,
  DailyReview,
  MemoryEntry,
  WorkPattern,
  WeeklyDigest,
  OKR,
  CommitmentOKRLink,
  SyncEnvelope,
  ActionProposal,
  DraftMessage,
  FollowUpRule,
  PRMetric,
  CopilotDailyMetric,
  JiraTicket,
  PRJiraLink,
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
  tags!: EntityTable<Tag, "id">;
  calendar_cache!: EntityTable<CalendarEvent, "id">;
  people!: EntityTable<Person, "id">;
  chat_sessions!: EntityTable<ChatSession, "id">;
  chat_messages!: EntityTable<ChatMessageRecord, "id">;
  daily_reviews!: EntityTable<DailyReview, "id">;
  memories!: EntityTable<MemoryEntry, "id">;
  work_patterns!: EntityTable<WorkPattern, "id">;
  weekly_digests!: EntityTable<WeeklyDigest, "id">;
  okrs!: EntityTable<OKR, "id">;
  commitment_okr_links!: EntityTable<CommitmentOKRLink, "id">;
  sync_outbox!: EntityTable<SyncEnvelope, "id">;
  action_proposals!: EntityTable<ActionProposal, "id">;
  drafts!: EntityTable<DraftMessage, "id">;
  follow_up_rules!: EntityTable<FollowUpRule, "id">;
  pr_metrics!: EntityTable<PRMetric, "id">;
  copilot_metrics!: EntityTable<CopilotDailyMetric, "id">;
  jira_tickets!: EntityTable<JiraTicket, "id">;
  pr_jira_links!: EntityTable<PRJiraLink, "id">;
  people_context!: EntityTable<PersonContext, "personId">;

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

    this.version(8).stores({
      commitments: "++id, &hash, urgency, status, source_type, confidence, direction, createdAt",
    });

    this.version(9).stores({
      commitments: "++id, &hash, urgency, status, source_type, confidence, direction, tag_id, createdAt",
      tags: "++id, &name, createdAt",
    }).upgrade(async (tx) => {
      await tx.table("commitments").toCollection().modify((commitment) => {
        if (commitment.tag_id === undefined) commitment.tag_id = null;
      });
      // Seed the "General" catch-all tag
      await tx.table("tags").add({
        name: "General",
        color: "#6B7280",
        createdAt: new Date().toISOString(),
      });
    });

    // Phase 1: Calendar cache + people graph
    this.version(10).stores({
      calendar_cache: "++id, &googleEventId, startTime, endTime, fetchedAt",
      people: "++id, &name, email, relationship, lastSeenAt, createdAt",
    });

    // Phase 1: Chat persistence + daily reviews
    this.version(11).stores({
      chat_sessions: "++id, createdAt, updatedAt",
      chat_messages: "++id, sessionId, role, createdAt",
      daily_reviews: "++id, &date, createdAt",
    });

    // Phase 2: Action execution framework — proposals, drafts, follow-up rules
    this.version(12).stores({
      action_proposals: "++id, commitmentId, type, status, source, createdAt",
      drafts: "++id, commitmentId, proposalId, platform, status, createdAt",
      follow_up_rules: "++id, commitmentId, status, checkAt, createdAt",
    });

    // Phase 2: External integrations (legacy — kept for Dexie migration history)
    this.version(13).stores({
      integrations: "++id, &service, status, createdAt",
      external_task_links: "++id, commitmentId, service, externalId, createdAt",
    });

    // Phase 3: Long-term memory + work patterns + weekly digests
    this.version(14).stores({
      memories: "++id, category, importance, source, lastReinforced, createdAt",
      work_patterns: "++id, type, sentiment, detectedWeek, createdAt",
      weekly_digests: "++id, weekStart, createdAt",
    });

    // Phase 3: OKRs + commitment-OKR links + sync outbox
    this.version(15).stores({
      okrs: "++id, period, rank, active, createdAt",
      commitment_okr_links: "++id, commitmentId, okrId, createdAt",
      sync_outbox: "++id, table, timestamp",
    });

    // Fix: index commitmentCount on people for orderBy queries
    this.version(16).stores({
      people: "++id, &name, email, relationship, lastSeenAt, commitmentCount, createdAt",
    });

    // Fix: add missing indexes for fields used in orderBy/where queries
    this.version(17).stores({
      raw_messages: "++id, source_type, sourceId, capturedAt, context",
      work_patterns: "++id, type, sentiment, acknowledged, detectedWeek, createdAt",
    });

    // Eng Stats: GitHub PR metrics + Copilot daily metrics
    this.version(18).stores({
      pr_metrics: "++id, [repo+prNumber], repo, prNumber, mergedAt, syncedAt",
      copilot_metrics: "++id, &date, syncedAt",
    });

    // Eng Stats: Jira integration — tickets + PR-ticket links
    this.version(19).stores({
      jira_tickets: "++id, &key, component, projectKey, status, issueType, syncedAt",
      pr_jira_links: "++id, prMetricId, jiraTicketKey, linkedAt",
    }).upgrade((tx) => {
      // Add branch field to existing PR metrics
      return tx.table("pr_metrics").toCollection().modify((pr) => {
        if (pr.branch === undefined) pr.branch = null;
      });
    });

    // People Context: computed person insights derived from commitment data
    this.version(20).stores({
      people_context: "&personId, computedAt",
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

/** Get all tags ordered by name */
export async function getAllTags(): Promise<Tag[]> {
  return db.tags.orderBy("name").toArray();
}

/** Preset palette for auto-assigning tag colors */
const TAG_COLORS = [
  "#6B7280", // gray (General)
  "#2563EB", // blue
  "#7C3AED", // violet
  "#DB2777", // pink
  "#EA580C", // orange
  "#059669", // emerald
  "#D97706", // amber
  "#0891B2", // cyan
  "#4F46E5", // indigo
  "#DC2626", // red
];

/** Get the next color from the palette based on current tag count */
export function getNextTagColor(existingCount: number): string {
  return TAG_COLORS[existingCount % TAG_COLORS.length];
}

/** Ensure the General tag exists (idempotent, for startup) */
export async function ensureGeneralTag(): Promise<number> {
  const existing = await db.tags.where("name").equals("General").first();
  if (existing?.id != null) return existing.id;
  return db.tags.add({
    name: "General",
    color: TAG_COLORS[0],
    createdAt: new Date().toISOString(),
  }) as Promise<number>;
}
