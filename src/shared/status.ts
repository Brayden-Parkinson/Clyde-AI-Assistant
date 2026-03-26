/**
 * Status log system — background writes, UI reads.
 * Stored in chrome.storage.session so it survives SW restarts
 * but clears on browser restart.
 */

export interface StatusEntry {
  timestamp: string;
  level: "info" | "warn" | "error" | "success";
  source: "content" | "batcher" | "extractor" | "granola" | "worker" | "backup" | "morning-brief" | "daily-review" | "voice-inbox" | "tags" | "sensitivity" | "calendar" | "people" | "news";
  message: string;
}

export interface PipelineStatus {
  /** Is the content script connected to any Slack tab? */
  slackConnected: boolean;
  /** Is Granola OAuth connected? */
  granolaConnected: boolean;
  /** Last time content script sent messages */
  lastContentPing: string | null;
  /** Messages currently in the batcher buffer */
  bufferedMessages: number;
  /** Last time extraction ran */
  lastExtraction: string | null;
  /** Last extraction error (null if last was success) */
  lastError: string | null;
  /** Is API key configured? */
  hasApiKey: boolean;
  /** Total messages received this session */
  totalMessagesReceived: number;
  /** Total commitments extracted this session */
  totalCommitmentsExtracted: number;
  /** Rolling log of recent events (last 30) */
  log: StatusEntry[];
}

const STATUS_KEY = "pipelineStatus";

const DEFAULT_STATUS: PipelineStatus = {
  slackConnected: false,
  granolaConnected: false,
  lastContentPing: null,
  bufferedMessages: 0,
  lastExtraction: null,
  lastError: null,
  hasApiKey: false,
  totalMessagesReceived: 0,
  totalCommitmentsExtracted: 0,
  log: [],
};

/** Get current pipeline status */
export async function getStatus(): Promise<PipelineStatus> {
  const result = await chrome.storage.session.get(STATUS_KEY);
  return { ...DEFAULT_STATUS, ...(result[STATUS_KEY] as Partial<PipelineStatus> ?? {}) };
}

/** Update pipeline status (partial merge) */
export async function updateStatus(updates: Partial<PipelineStatus>): Promise<void> {
  const current = await getStatus();
  await chrome.storage.session.set({ [STATUS_KEY]: { ...current, ...updates } });
}

/** Append a log entry (keeps last 30) */
export async function logStatus(
  level: StatusEntry["level"],
  source: StatusEntry["source"],
  message: string,
): Promise<void> {
  const current = await getStatus();
  const entry: StatusEntry = {
    timestamp: new Date().toISOString(),
    level,
    source,
    message,
  };
  const log = [...current.log, entry].slice(-30);
  await chrome.storage.session.set({ [STATUS_KEY]: { ...current, log } });

  // Also console.log for devtools visibility
  const prefix = `[CT:${source}]`;
  if (level === "error") console.error(prefix, message);
  else if (level === "warn") console.warn(prefix, message);
  else console.log(prefix, message);
}
