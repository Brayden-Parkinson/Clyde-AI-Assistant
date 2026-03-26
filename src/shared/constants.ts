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
  CALENDAR_SYNC: "calendar-sync",
  EOD_REVIEW: "eod-review",
  MEMORY_EXTRACTION: "memory-extraction",
  PATTERN_DETECTION: "pattern-detection",
  WEEKLY_DIGEST: "weekly-digest",
  SYNC_PUSH: "sync-push",
  FOLLOW_UP_CHECK: "follow-up-check",
  GITHUB_SYNC: "github-sync",
  JIRA_SYNC: "jira-sync",
  REVIEW_BACKFILL: "review-backfill",
  PEOPLE_CONTEXT: "people-context",
  AUTHOR_BACKFILL: "author-backfill",
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

/** How long to keep cached calendar events (15 min in ms) */
export const CALENDAR_CACHE_TTL_MS = 15 * 60 * 1000;

/** How long to keep chat history (90 days in ms) */
export const CHAT_HISTORY_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/** How long to keep daily reviews (90 days in ms) */
export const DAILY_REVIEW_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/** How long to keep memory entries without reinforcement (180 days in ms) */
export const MEMORY_TTL_MS = 180 * 24 * 60 * 60 * 1000;

/** How long to keep work patterns (90 days in ms) */
export const WORK_PATTERN_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/** How long to keep weekly digests (90 days in ms) */
export const WEEKLY_DIGEST_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/** Days without reinforcement before memory importance decays */
export const MEMORY_DECAY_DAYS = 90;

/** How long to keep completed/dismissed ActionProposals (30 days in ms) */
export const ACTION_PROPOSAL_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** How long to keep sent/discarded drafts (7 days in ms) */
export const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** How long to keep completed follow-up rules (90 days in ms) */
export const FOLLOW_UP_RULE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/** How long to keep external task links (90 days in ms) */
export const EXTERNAL_TASK_LINK_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/** How long to keep sync outbox entries (7 days in ms) */
export const SYNC_OUTBOX_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** How long to keep news posts (30 days in ms) */
export const NEWS_POST_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Max time to wait for X page scrape (30 seconds) */
export const NEWS_SCRAPE_TIMEOUT_MS = 30_000;

/** Default X accounts to scrape for AI news */
export const NEWS_DEFAULT_ACCOUNTS = ["bcherny"];

/** Google OAuth configuration */
export const GOOGLE_OAUTH = {
  AUTH_URL: "https://accounts.google.com/o/oauth2/v2/auth",
  TOKEN_URL: "https://oauth2.googleapis.com/token",
  CALENDAR_API: "https://www.googleapis.com/calendar/v3",
  SCOPES: "https://www.googleapis.com/auth/calendar.readonly",
} as const;
