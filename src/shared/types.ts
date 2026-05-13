/** Commitment urgency levels */
export type Urgency = "high" | "medium" | "low";

/** Commitment lifecycle statuses */
export type CommitmentStatus = "new" | "snoozed" | "actioned" | "done" | "dismissed";

/** Where the commitment was captured from */
export type SourceType = "meeting" | "slack" | "gdoc" | "voice" | "gmail";

/** A smart tag for grouping commitments by theme */
export interface Tag {
  id?: number;
  /** Display name, e.g. "AI Tooling", "1:1 Follow-ups" */
  name: string;
  /** Hex color for UI pill */
  color: string;
  createdAt: string;
}

/** Who owes the action */
export type CommitmentDirection = "by_me" | "assigned_to_me";

/** A single message from the conversation surrounding a commitment */
export interface ConversationMessage {
  sender: string;
  text: string;
  timestamp: string;
  isMine: boolean;
}

/** A detected commitment stored in IndexedDB */
export interface Commitment {
  id?: number;
  /** SHA-256 hash of original_quote + source_type + context for dedup */
  hash: string;
  /** Brief, actionable description */
  text: string;
  /** Exact words from the source */
  original_quote: string;
  /** ISO 8601 datetime if mentioned, null if not */
  deadline: string | null;
  urgency: Urgency;
  /** Channel name, meeting title, or person name */
  context: string;
  source_type: SourceType;
  confidence: number;
  status: CommitmentStatus;
  /** Whether the user committed or was assigned */
  direction: CommitmentDirection;
  /** Claude thinks this commitment is already done */
  likely_completed: boolean;
  /** Quote from conversation indicating completion, null if none */
  completion_signal: string | null;
  /** ISO timestamp of the original source message */
  message_timestamp: string;
  /** ISO timestamp when snoozed until (null if not snoozed) */
  snooze_until: string | null;
  /** AI-generated summary of the conversation that led to this commitment */
  context_summary: string | null;
  /** Raw messages from the batch window surrounding the commitment */
  conversation_messages: ConversationMessage[];
  /** Permalink to the original Slack message */
  slack_link: string | null;
  /** Whether this was explicitly triggered by the "Clyde" keyword */
  triggered: boolean;
  /** Whether this commitment contains sensitive/personal content */
  sensitive: boolean;
  /** FK to tags table, null if untagged */
  tag_id: number | null;
  /** ISO timestamp when created */
  createdAt: string;
  /**
   * ISO timestamp of the most recent local modification. Used by the curator
   * sync freshness guard so a stale curator op cannot overwrite a fresh local
   * edit. Backfilled to `createdAt` for pre-curator rows.
   */
  lastModifiedAt?: string;
  /**
   * Set when a `merge_duplicate` curator op dismisses this commitment as a
   * duplicate of another. `merged_into` is the canonical hash that survived.
   */
  merge_metadata?: {
    merged_into: string;
    reason: "duplicate";
    rationale: string;
  } | null;
}

/** Raw ingested message before Claude extraction */
export interface RawMessage {
  id?: number;
  source_type: SourceType;
  /** Unique ID from source (e.g., Slack message ts, Granola note ID) */
  sourceId: string;
  /** The raw message text */
  text: string;
  /** Who sent it */
  sender: string;
  /** Channel or meeting name */
  context: string;
  /** ISO timestamp */
  timestamp: string;
  /** ISO timestamp when captured */
  capturedAt: string;
}

/** Dismissed pattern that trains the extraction prompt */
export interface Dismissal {
  id?: number;
  /** The original_quote pattern that was dismissed */
  pattern: string;
  /** User-inferred reason */
  reason: string;
  /** Number of times this pattern was dismissed */
  count: number;
  createdAt: string;
}

/** Log of actions taken on commitments */
export interface ActionLogEntry {
  id?: number;
  commitmentId: number;
  action: "calendar" | "reminder" | "slack" | "snooze" | "done" | "dismissed" | "started" | "send_message" | "block_time" | "create_meeting";
  createdAt: string;
}

/** Extension settings stored in IndexedDB */
export interface Settings {
  key: string;
  value: string | number | boolean;
}

/** Message payload sent from content script to background */
export interface SlackMessagePayload {
  type: "SLACK_MESSAGES";
  messages: Array<{
    text: string;
    sender: string;
    channel: string;
    timestamp: string;
    isMine: boolean;
    mentionsMe: boolean;
    reactions: string[];
    channel_id: string | null;
    message_ts: string | null;
    slack_link: string | null;
    /** Timestamp of parent thread message (null for channel messages) */
    thread_ts: string | null;
    /** True if this message is a reply in a thread */
    is_thread_reply: boolean;
  }>;
}

/** Message payload sent from Gmail content script to background */
export interface GmailMessagePayload {
  type: "GMAIL_MESSAGES";
  messages: Array<{
    text: string;
    sender: string;
    subject: string;
    timestamp: string;
    isMine: boolean;
    mentionsMe: boolean;
    reactions: string[];
    threadId: string;
    messageId: string;
    gmail_link: string | null;
  }>;
}

/** Claude extraction result for a single commitment */
export interface ExtractedCommitment {
  text: string;
  original_quote: string;
  deadline: string | null;
  urgency: Urgency;
  context: string;
  source_type: SourceType;
  confidence: number;
  direction: CommitmentDirection;
  likely_completed: boolean;
  completion_signal: string | null;
  message_timestamp: string;
  context_summary: string | null;
  triggered?: boolean;
  sensitive?: boolean;
  tag_id?: number | null;
  suggested_tag?: string | null;
}

/** A candidate that Claude considered but rejected */
export interface RejectedCandidate {
  original_text: string;
  sender: string;
  channel: string;
  reason: string;
  category: "not_commitment" | "third_party" | "hedging" | "past_tense" | "delegation" | "politeness" | "low_confidence" | "acknowledgment";
}

/** Claude API response shape */
export interface ExtractionResponse {
  commitments: ExtractedCommitment[];
  rejections?: RejectedCandidate[];
}

/** A single transcript segment from Granola's cache */
export interface TranscriptSegment {
  text: string;
  source: "microphone" | "system";
  start?: string;
}

/** Rich transcript response from native host */
export interface TranscriptResponse {
  segments: TranscriptSegment[];
  creator?: string;
  attendees: string[];
  transcript: string;
}

/** A meeting note retrieved from Granola via MCP */
export interface MeetingNote {
  id: string;
  title: string;
  date: string;
  attendees: string[];
  summary: string;
  transcript?: string;
  creator?: string;
  has_transcript?: boolean;
}

/** A user-defined kanban column */
export interface CustomColumn {
  id: string;
  label: string;
  position: number;
}

/** Maps a commitment to a custom kanban column */
export interface KanbanAssignment {
  commitment_id: number;
  column_id: string;
}

/** Per-channel Slack message watermarks for dedup across reloads */
export type SlackWatermarks = { [channel: string]: { lastMessageTs: string } };

/** Full backup state persisted to disk via native messaging */
export interface BackupState {
  version: 1;
  lastSaved: string;
  commitments: Commitment[];
  dismissals: Dismissal[];
  action_log: ActionLogEntry[];
  settings_db: Settings[];
  kanban_columns?: CustomColumn[];
  kanban_assignments?: KanbanAssignment[];
  tags?: Tag[];
  briefs?: MorningBrief[];
  chrome_storage: Record<string, unknown>;
  watermarks: {
    granolaProcessedNoteIds: string[];
    granolaLastPoll: string | null;
    granolaScannedThrough: string | null;
    slackChannelWatermarks: SlackWatermarks;
  };
}

/** A decision log entry stored in IndexedDB */
export interface DecisionLogEntry {
  id?: number;
  /** "accepted" or "rejected" */
  decision: "accepted" | "rejected";
  /** The original message text */
  original_text: string;
  /** Who sent it */
  sender: string;
  /** Channel or meeting context */
  channel: string;
  /** For rejections: why it was excluded. For accepted: the extracted commitment text */
  reason: string;
  /** Category tag for rejections */
  category: string;
  /** Confidence if accepted, null if rejected */
  confidence: number | null;
  /** The extraction batch ID (groups decisions from same Claude call) */
  batchId: string;
  /** ISO timestamp */
  createdAt: string;
}

/** A detected completion suggestion from the auto-detect pipeline */
export interface CompletionSuggestion {
  id?: number;
  commitmentId: number;
  confidence: number;
  evidence: string;
  sourceMessage: string;
  status: "pending" | "accepted" | "dismissed";
  createdAt: string;
}

/** Tracks how many times user dismissed a completion suggestion for a commitment */
export interface DismissedCompletion {
  commitmentId: number;
  dismissCount: number;
  lastDismissedAt: string;
}

/** A priority item inside a morning brief */
export interface BriefPriority {
  commitmentId: number;
  text: string;
  reason: string;
  suggestedTime: string | null;
  action: "calendar" | "do" | "delegate" | "prep";
}

/** A suggested kanban column move inside a morning brief */
export interface BriefSuggestedMove {
  commitmentId: number;
  from: string;
  to: string;
  reason: string;
}

/** A typed heads-up alert inside a morning brief */
export interface BriefHeadsUpItem {
  text: string;
  severity: "warning" | "info" | "due_soon" | "duplicate";
}

/** A generated morning brief stored in IndexedDB */
export interface MorningBrief {
  id?: number;
  /** YYYY-MM-DD */
  date: string;
  greeting: string;
  priorities: BriefPriority[];
  scheduleSuggestion: string;
  headsUp: string[];
  headsUpTyped?: BriefHeadsUpItem[];
  calendarEvents?: Array<{ title: string; start: string; end: string }>;
  suggestedMoves: BriefSuggestedMove[];
  dismissed: boolean;
  snoozedUntil: string | null;
  /** People context for attendees in today's meetings */
  peopleContext?: BriefPersonContext[];
  /** Planning state: user's intention for the day */
  planningState?: "pending" | "planned" | "reviewed";
  /** User's stated intention for the day */
  dayIntention?: string | null;
  /** Reference to the EOD review for this day */
  eodReview?: number | null;
  createdAt: string;
}

// ─── Phase 1: PA Smart Assistant ───

/** Person context included in a morning brief */
export interface BriefPersonContext {
  name: string;
  relationship: string | null;
  meetingTitle: string | null;
  openCommitments: number;
  /** Fraction of commitments completed (0-1) */
  completionRate?: number | null;
  /** Fraction of commitments that went past deadline (0-1) */
  overdueRate?: number | null;
}

/** Computed context about a person, derived from commitment data */
export interface PersonContext {
  /** FK to people.id */
  personId: number;
  /** Fraction of commitments in "done" state (0-1) */
  completionRate: number;
  /** Fraction that went past deadline (0-1) */
  overdueRate: number;
  /** Avg days from commitment creation to first status change */
  avgResponseDays: number | null;
  totalCommitments: number;
  openCommitments: number;
  completedCommitments: number;
  dismissedCommitments: number;
  /** Top 3 channels by frequency */
  topChannels: string[];
  /** Most recent commitment text */
  lastInteractionSummary: string | null;
  /** ISO timestamp when this was computed */
  computedAt: string;
}

/** Cached Google Calendar event */
export interface CalendarEvent {
  id?: number;
  /** Google Calendar event ID for dedup */
  googleEventId: string;
  title: string;
  startTime: string;
  endTime: string;
  attendees: string[];
  isAllDay: boolean;
  status: "confirmed" | "tentative" | "cancelled";
  fetchedAt: string;
}

/** Contact graph node — a person the user interacts with */
export interface Person {
  id?: number;
  name: string;
  email: string | null;
  relationship: "manager" | "report" | "peer" | "stakeholder" | "external" | null;
  notes: string | null;
  commitmentCount: number;
  lastSeenAt: string;
  channels: string[];
  createdAt: string;
}

/** Chat conversation metadata */
export interface ChatSession {
  id?: number;
  title: string;
  createdAt: string;
  updatedAt: string;
}

/** Persisted chat message */
export interface ChatMessageRecord {
  id?: number;
  sessionId: number;
  role: "user" | "assistant";
  content: string;
  /** Serialized JSON string of snapshot data (tool results, etc.) */
  snapshots: string | null;
  createdAt: string;
}

/** EOD daily review */
export interface DailyReview {
  id?: number;
  /** YYYY-MM-DD */
  date: string;
  completedItems: number[];
  reflection: string;
  userNotes: string | null;
  createdAt: string;
}

/** Stored Google OAuth tokens */
export interface GoogleAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope: string;
}

// ─── Phase 3: Long-Term Memory ───

/** Categories for long-term memory entries */
export type MemoryCategory =
  | "preference"
  | "fact"
  | "pattern"
  | "project"
  | "relationship"
  | "lesson"
  | "context";

/** How a memory was created */
export type MemorySource = "ai_extraction" | "user_manual" | "pattern_detection";

/** A long-term memory entry distilled from commitment history */
export interface MemoryEntry {
  id?: number;
  content: string;
  category: MemoryCategory;
  importance: number;
  source: MemorySource;
  evidenceIds: number[];
  lastReinforced: string;
  reinforceCount: number;
  confirmed: boolean;
  expiresAt: string | null;
  createdAt: string;
}

// ─── Phase 3: Work Patterns ───

export type WorkPatternType =
  | "time_allocation"
  | "completion_rate"
  | "deadline_adherence"
  | "procrastination"
  | "overcommitment"
  | "bottleneck"
  | "priority_mismatch";

export interface WorkPattern {
  id?: number;
  description: string;
  type: WorkPatternType;
  evidenceIds: number[];
  confidence: number;
  sentiment: "positive" | "neutral" | "concerning";
  suggestion: string | null;
  acknowledged: boolean;
  detectedWeek: string;
  createdAt: string;
}

export interface WeeklyDigest {
  id?: number;
  weekStart: string;
  completed: number;
  added: number;
  overdue: number;
  patterns: WorkPattern[];
  summary: string;
  suggestedFocus: string[];
  createdAt: string;
}

// ─── Phase 3: OKRs ───

export interface KeyResult {
  text: string;
  progress: number;
}

export interface OKR {
  id?: number;
  objective: string;
  keyResults: KeyResult[];
  period: string;
  rank: number;
  alignedCount: number;
  source: "user" | "ai_suggested";
  active: boolean;
  createdAt: string;
}

export type OKRAlignment = "directly_supports" | "indirectly_supports" | "blocks" | "unrelated";

export interface CommitmentOKRLink {
  id?: number;
  commitmentId: number;
  okrId: number;
  alignment: OKRAlignment;
  source: "ai" | "user";
  createdAt: string;
}

// ─── Phase 3: Sync Foundation ───

export interface SyncConfig {
  enabled: boolean;
  deviceId: string;
  serverUrl: string;
  authToken: string;
  lastSyncAt: string | null;
  syncScope: SyncScope;
}

export interface SyncScope {
  commitments: boolean;
  memories: boolean;
  okrs: boolean;
  contacts: boolean;
  settings: boolean;
}

export interface SyncEnvelope {
  id?: number;
  op: "put" | "delete";
  table: string;
  payload: Record<string, unknown>;
  timestamp: string;
  deviceId: string;
}

// ─── Phase 2: Action Execution Framework ───

/** The type of external action a proposal represents */
export type ActionType =
  | "send_message"        // Draft + send via Slack or Gmail
  | "block_time"          // Create a Google Calendar time block
  | "create_meeting";     // Create a Google Calendar event with attendees

/** Lifecycle state of an ActionProposal */
export type ActionProposalStatus =
  | "pending"    // Awaiting user approval — NOTHING has been sent
  | "approved"   // User approved, execution queued
  | "executing"  // Service worker is running it
  | "completed"  // Successfully executed
  | "failed"     // Execution error (see errorMessage)
  | "dismissed"; // User rejected it

/** A proposed external action awaiting user approval before execution */
export interface ActionProposal {
  id?: number;
  /** FK to commitments.id */
  commitmentId: number;
  type: ActionType;
  status: ActionProposalStatus;
  /** Human-readable description: "Send follow-up to Sarah in #engineering" */
  description: string;
  /** Serialized JSON payload — shape depends on ActionType */
  payload: string;
  /** Result message after successful execution */
  resultMessage: string | null;
  /** Error message if status === "failed" */
  errorMessage: string | null;
  /** What triggered this proposal */
  source: "follow_up_engine" | "clyde_chat" | "manual";
  createdAt: string;
  updatedAt: string;
}

// ─── Phase 2: Message Drafting ───

export type DraftPlatform = "slack" | "gmail";
export type DraftTone = "professional" | "casual" | "brief" | "apologetic";

/** A Claude-generated draft message stored before sending */
export interface DraftMessage {
  id?: number;
  /** FK to commitments.id */
  commitmentId: number;
  /** FK to action_proposals.id — null if standalone draft */
  proposalId: number | null;
  platform: DraftPlatform;
  /** Slack channel (e.g. #engineering) or email address */
  recipient: string;
  /** Email subject — null for Slack */
  subject: string | null;
  body: string;
  tone: DraftTone;
  /** "pending" = not sent, "sent" = executed, "discarded" = thrown away */
  status: "pending" | "sent" | "discarded";
  createdAt: string;
  updatedAt: string;
}

// ─── Phase 2: Follow-Up Rules ───

/** An entry in the channel ignore list (exact channel name or glob pattern) */
export interface ChannelIgnoreEntry {
  type: "exact" | "pattern";
  value: string; // e.g. "random" or "*-alerts"
}

/** A rule that triggers proactive follow-up nudges for a commitment */
export interface FollowUpRule {
  id?: number;
  /** FK to commitments.id */
  commitmentId: number;
  /** ISO datetime — when the follow-up engine should next check this */
  checkAt: string;
  /** How many times this rule has already fired */
  fireCount: number;
  /** "active" = monitoring, "paused" = suppressed, "completed" = commitment done */
  status: "active" | "paused" | "completed";
  createdAt: string;
}

// ─── AI News ───

/** Known news source identifiers */
export type NewsSourceType =
  | "anthropic-blog"
  | "hacker-news"
  | "arxiv"
  | "openai-blog"
  | "huggingface-blog"
  | "verge-ai"
  | "techcrunch-ai";

/** A fetched + summarized news item from any source */
export interface NewsPost {
  id?: number;
  /** Unique ID for dedup: "<source>:<item-id>" */
  sourceId: string;
  /** Source type enum */
  source: NewsSourceType;
  /** Human-readable source name, e.g. "Anthropic Blog" */
  sourceName: string;
  /** Author name if available (article byline), null otherwise */
  author: string | null;
  /** Article/post title */
  title: string;
  /** Raw content text (description or snippet) */
  rawText: string;
  /** Claude-generated 1-2 sentence summary */
  summary: string;
  /** Relevance score 1-10 */
  relevanceScore: number;
  /** Claude-assigned topic cluster */
  topicTag: string;
  /** ISO timestamp of the original publication */
  postedAt: string;
  /** Permalink to the original article */
  url: string;
  /** ISO timestamp when fetched */
  fetchedAt: string;
  /** ISO timestamp when user read/expanded this post (null = unread) */
  readAt?: string | null;
  /** Whether user bookmarked this post */
  bookmarked?: boolean;
}

/** Raw item from a news provider before Claude summarization */
export interface RawNewsItem {
  sourceId: string;
  source: NewsSourceType;
  sourceName: string;
  author: string | null;
  title: string;
  text: string;
  url: string;
  postedAt: string;
}

// ─── Curator Sync ───
//
// External curator (Cowork skill) writes recommended changes to
// ~/.commitment-tracker/curator-ops.json. Clyde reads + applies them.
// Schema mirrors skills/clyde-curate/SKILL.md — keep in sync.

export type CuratorOpType = "mark_done" | "flag_review" | "merge_duplicate" | "dismiss";

interface CuratorOpBase {
  /** Stable hash id (e.g. "op:abcd1234..."), used as the idempotency key */
  id: string;
  type: CuratorOpType;
  /** SHA-256 hash from the commitments table */
  commitment_hash: string;
  /** ISO 8601 — what the curator saw when generating this op */
  snapshot_at: string;
  /** ISO 8601 — when the op was generated */
  generated_at: string;
}

export interface MarkDoneOp extends CuratorOpBase {
  type: "mark_done";
  confidence: number;
  evidence: string;
  evidence_url: string | null;
}

export interface FlagReviewOp extends CuratorOpBase {
  type: "flag_review";
  confidence: number;
  evidence: string;
}

export interface MergeDuplicateOp extends CuratorOpBase {
  type: "merge_duplicate";
  /** Canonical hash that survives the merge */
  primary_hash: string;
  rationale: string;
}

/**
 * Mark a commitment as `dismissed` without implying it duplicates another.
 * Use this for things like "no longer relevant", "wrong extraction",
 * "decided not to do this" — distinct from `merge_duplicate` which
 * collapses duplicates.
 */
export interface DismissOp extends CuratorOpBase {
  type: "dismiss";
  rationale: string;
}

export type CuratorOp = MarkDoneOp | FlagReviewOp | MergeDuplicateOp | DismissOp;

/** Top-level shape of the curator-ops.json file. */
export interface CuratorOpsFile {
  version: 1;
  generated_at: string;
  snapshot_source: string;
  snapshot_lastSaved: string;
  summary: Record<string, unknown>;
  operations: CuratorOp[];
}

/** Idempotency record — one row per curator op that has been applied locally. */
export interface AppliedCuratorOp {
  id: string;
  opType: CuratorOpType;
  commitmentHash: string;
  appliedAt: string;
}

/** PR Inbox item — a PR the user needs to act on */
export interface PRInboxItem {
  id: number;
  number: number;
  title: string;
  html_url: string;
  repo: string;
  author: string;
  authorAvatar: string;
  createdAt: string;
  updatedAt: string;
  isDraft: boolean;
  labels: Array<{ name: string; color: string }>;
}


