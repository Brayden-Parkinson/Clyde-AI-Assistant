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
  action: "calendar" | "reminder" | "slack" | "snooze" | "done" | "dismissed" | "started";
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
