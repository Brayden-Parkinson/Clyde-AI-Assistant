/** Pre-filter regex to avoid sending non-commitment messages to Claude */
export const COMMITMENT_REGEX =
  /clyde|I'll|I will|let me|I can|I could|action item|can you|could you|follow up|circle back|send (you|over|along)|get back to|schedule|set up|look into|take a look|check on|review|get that to you|by (end of day|EOD|tomorrow|Friday|Monday|next week)/i;

/** Default settings values */
export const DEFAULTS = {
  slackScanFrequencyMin: 5,
  granolaPollFrequencyMin: 10,
  confidenceThreshold: 0.6,
  morningDigestHour: 8,
  morningDigestMinute: 0,
  uiMode: "popup" as "popup" | "sidepanel",
  voiceInboxEnabled: false,
  googleDocsEnabled: false,
  gmailEnabled: false,
  slackEnabled: true,
  granolaEnabled: true,
  calendarEnabled: true,
} as const;

/** Chrome alarm names */
export const ALARMS = {
  GRANOLA_POLL: "granola-poll",
  VOICE_INBOX: "voice-inbox-poll",
  MORNING_DIGEST: "morning-digest",
  CLEANUP: "daily-cleanup",
  PERIODIC_BACKUP: "periodic-backup",
  SNOOZE_PREFIX: "snooze-",
  CONFIDENCE_TUNE: "confidence-tune",
} as const;

/** How long to keep raw messages (7 days in ms) */
export const RAW_MESSAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** How long to keep done/dismissed commitments (30 days in ms) */
export const COMPLETED_COMMITMENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** How long to keep action log entries (90 days in ms) */
export const ACTION_LOG_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/** How long to keep morning briefs (30 days in ms) */
export const BRIEFS_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** How long to keep resolved completion suggestions (30 days in ms) */
export const COMPLETION_SUGGESTION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** How long to keep dismissed completion tracking (90 days in ms) */
export const DISMISSED_COMPLETION_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/** Debounce delay for batching Slack messages (ms) */
export const BATCH_DEBOUNCE_MS = 5 * 60 * 1000;

/** Maximum dismissal patterns to include in Claude prompt (prevents bloat) */
export const MAX_DISMISSAL_PATTERNS = 15;

/** Claude model for extraction and morning briefs (quality-sensitive) */
export const CLAUDE_MODEL = "claude-sonnet-4-6";

/** Cheaper model for simple tasks (completion detection, pattern matching) */
export const CLAUDE_MODEL_FAST = "claude-haiku-4-5-20251001";

/** API timeout for Claude calls (60 seconds) */
export const API_TIMEOUT_MS = 60_000;

/** Max retries on 429 rate limit */
export const API_MAX_RETRIES = 2;

/** Base delay between retries (ms) — multiplied by attempt number */
export const API_RETRY_DELAY_MS = 5_000;

/** Default: allow messages from channels not in the filter map */
export const CHANNEL_FILTER_DEFAULT_ALLOW = true;
