/** Pre-filter regex to avoid sending non-commitment messages to Claude */
export const COMMITMENT_REGEX =
  /clyde|I'll|I will|let me|I can|I could|action item|can you|could you|follow up|circle back|send (you|over|along)|get back to|schedule|set up|look into|take a look|check on|review|get that to you|by (end of day|EOD|tomorrow|Friday|Monday|next week)/i;

/** Default settings values */
export const DEFAULTS = {
  slackScanFrequencyMin: 5,
  granolaPollFrequencyMin: 60,
  confidenceThreshold: 0.6,
  morningDigestHour: 8,
  morningDigestMinute: 0,
  uiMode: "popup" as "popup" | "sidepanel",
} as const;

/** Chrome alarm names */
export const ALARMS = {
  GRANOLA_POLL: "granola-poll",
  MORNING_DIGEST: "morning-digest",
  CLEANUP: "daily-cleanup",
  SNOOZE_PREFIX: "snooze-",
} as const;

/** How long to keep raw messages (7 days in ms) */
export const RAW_MESSAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** How long to keep done/dismissed commitments (30 days in ms) */
export const COMPLETED_COMMITMENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Debounce delay for batching Slack messages (ms) */
export const BATCH_DEBOUNCE_MS = 5 * 60 * 1000;

/** Maximum dismissal patterns to include in Claude prompt (prevents bloat) */
export const MAX_DISMISSAL_PATTERNS = 15;

/** Claude model to use for extraction */
export const CLAUDE_MODEL = "claude-sonnet-4-6";

/** API timeout for Claude calls (30 seconds) */
export const API_TIMEOUT_MS = 30_000;

/** Max retries on 429 rate limit */
export const API_MAX_RETRIES = 2;

/** Base delay between retries (ms) — multiplied by attempt number */
export const API_RETRY_DELAY_MS = 5_000;
