/** Commitment urgency levels */
export type Urgency = "high" | "medium" | "low";

/** Commitment lifecycle statuses */
export type CommitmentStatus = "new" | "snoozed" | "actioned" | "done" | "dismissed";

/** Where the commitment was captured from */
export type SourceType = "meeting" | "slack";

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
  /** ISO timestamp when snoozed until (null if not snoozed) */
  snooze_until: string | null;
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
  action: "calendar" | "reminder" | "slack" | "snooze" | "done" | "dismissed";
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
}

/** Claude API response shape */
export interface ExtractionResponse {
  commitments: ExtractedCommitment[];
}
