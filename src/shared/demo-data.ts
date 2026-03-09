/**
 * Demo mode fixtures — realistic fake data for presentations.
 * All IDs are negative to avoid collisions with Dexie auto-increment.
 * Dates use relative helpers so data always looks fresh.
 */

import type {
  Commitment,
  Dismissal,
  CompletionSuggestion,
  MorningBrief,
  DecisionLogEntry,
  ConversationMessage,
  Tag,
} from "./types";

// ─── Date helpers ───

function hoursAgo(n: number): string {
  return new Date(Date.now() - n * 3600_000).toISOString();
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86400_000).toISOString();
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function futureHours(n: number): string {
  return new Date(Date.now() + n * 3600_000).toISOString();
}

// ─── Conversation message factories ───

function msgs(...items: [string, string, boolean][]): ConversationMessage[] {
  return items.map(([sender, text, isMine], i) => ({
    sender,
    text,
    timestamp: hoursAgo(items.length - i),
    isMine,
  }));
}

// ─── Demo Tags ───

export const DEMO_TAGS: Tag[] = [
  { id: -1, name: "General", color: "#6B7280", createdAt: daysAgo(7) },
  { id: -2, name: "Engineering", color: "#2563EB", createdAt: daysAgo(7) },
  { id: -3, name: "Sales & Partnerships", color: "#EA580C", createdAt: daysAgo(7) },
  { id: -4, name: "1:1 Follow-ups", color: "#7C3AED", createdAt: daysAgo(7) },
  { id: -5, name: "Platform & Infra", color: "#0891B2", createdAt: daysAgo(7) },
  { id: -6, name: "People & Ops", color: "#DB2777", createdAt: daysAgo(7) },
];

// ─── Demo Commitments ───

export const DEMO_COMMITMENTS: Commitment[] = [
  // ── 5 status "new" ──

  // 3 high urgency → "Needs attention"
  {
    id: -1,
    hash: "demo-001",
    text: "Send revised proposal to Acme Corp by end of day",
    original_quote: "I'll get the revised proposal over to Acme by EOD today",
    deadline: futureHours(4),
    urgency: "high",
    context: "#acme-partnership",
    source_type: "slack",
    confidence: 0.94,
    status: "new",
    direction: "by_me",
    likely_completed: false,
    completion_signal: null,
    message_timestamp: hoursAgo(3),
    snooze_until: null,
    context_summary: "Discussing updated pricing terms for the Acme Corp deal",
    conversation_messages: msgs(
      ["Jordan Lee", "Hey, any update on the Acme proposal? They're asking.", false],
      ["You", "I'll get the revised proposal over to Acme by EOD today", true],
      ["Jordan Lee", "Perfect, they're expecting it before their 5pm meeting", false],
    ),
    slack_link: null,
    triggered: false,
    sensitive: false,
    tag_id: -3,
    createdAt: hoursAgo(3),
  },
  {
    id: -2,
    hash: "demo-002",
    text: "Review and approve the Q2 budget spreadsheet",
    original_quote: "I'll review the Q2 budget and approve it before the board meeting",
    deadline: futureHours(6),
    urgency: "high",
    context: "#finance",
    source_type: "slack",
    confidence: 0.91,
    status: "new",
    direction: "assigned_to_me",
    likely_completed: false,
    completion_signal: null,
    message_timestamp: hoursAgo(5),
    snooze_until: null,
    context_summary: "Finance team needs budget sign-off before Thursday board meeting",
    conversation_messages: msgs(
      ["Maria Chen", "Budget spreadsheet is in the shared drive — can you review before Thursday?", false],
      ["You", "I'll review the Q2 budget and approve it before the board meeting", true],
    ),
    slack_link: null,
    triggered: false,
    sensitive: false,
    tag_id: -1,
    createdAt: hoursAgo(5),
  },
  {
    id: -3,
    hash: "demo-003",
    text: "Fix the authentication bug blocking the staging deploy",
    original_quote: "I'll dig into the auth bug right after standup — it's blocking staging",
    deadline: null,
    urgency: "high",
    context: "#engineering",
    source_type: "slack",
    confidence: 0.88,
    status: "new",
    direction: "by_me",
    likely_completed: false,
    completion_signal: null,
    message_timestamp: hoursAgo(2),
    snooze_until: null,
    context_summary: "Auth token refresh fails intermittently on staging",
    conversation_messages: msgs(
      ["Sam Torres", "Staging deploy is stuck — the auth middleware is throwing 401s on token refresh", false],
      ["You", "I'll dig into the auth bug right after standup — it's blocking staging", true],
      ["Sam Torres", "Thanks, QA is waiting on this one", false],
    ),
    slack_link: null,
    triggered: true,
    sensitive: false,
    tag_id: -2,
    createdAt: hoursAgo(2),
  },

  // 2 medium urgency → "Open"
  {
    id: -4,
    hash: "demo-004",
    text: "Share the competitive analysis deck with the sales team",
    original_quote: "Let me put the competitive analysis together and share it with sales by Friday",
    deadline: daysAgo(-2), // 2 days from now
    urgency: "medium",
    context: "Q2 Planning Offsite",
    source_type: "meeting",
    confidence: 0.85,
    status: "new",
    direction: "by_me",
    likely_completed: false,
    completion_signal: null,
    message_timestamp: daysAgo(1),
    snooze_until: null,
    context_summary: "Discussed go-to-market strategy for Q2 at the offsite",
    conversation_messages: msgs(
      ["Dana Park", "We need a competitive landscape overview for the sales team", false],
      ["You", "Let me put the competitive analysis together and share it with sales by Friday", true],
      ["Dana Park", "That would be great — they have a big pitch next week", false],
    ),
    slack_link: null,
    triggered: false,
    sensitive: false,
    tag_id: -3,
    createdAt: daysAgo(1),
  },
  {
    id: -5,
    hash: "demo-005",
    text: "Set up the new monitoring dashboard for production",
    original_quote: "I can set up the Grafana dashboard for the new service this week",
    deadline: null,
    urgency: "medium",
    context: "#platform-eng",
    source_type: "slack",
    confidence: 0.82,
    status: "new",
    direction: "by_me",
    likely_completed: false,
    completion_signal: null,
    message_timestamp: daysAgo(2),
    snooze_until: null,
    context_summary: "Platform team discussing observability for the new microservice",
    conversation_messages: msgs(
      ["Alex Rivera", "We're missing monitoring on the new payment service — anyone have bandwidth?", false],
      ["You", "I can set up the Grafana dashboard for the new service this week", true],
    ),
    slack_link: null,
    triggered: false,
    sensitive: false,
    tag_id: -5,
    createdAt: daysAgo(2),
  },

  // ── 1 status "snoozed" with expired snooze ──
  {
    id: -6,
    hash: "demo-006",
    text: "Follow up with the design team about the onboarding flow",
    original_quote: "I'll follow up with design about the onboarding mockups",
    deadline: null,
    urgency: "medium",
    context: "#product",
    source_type: "slack",
    confidence: 0.79,
    status: "snoozed",
    direction: "by_me",
    likely_completed: false,
    completion_signal: null,
    message_timestamp: daysAgo(2),
    snooze_until: hoursAgo(1), // expired — should show in active list
    context_summary: "Waiting on new user onboarding flow mockups from the design team",
    conversation_messages: msgs(
      ["Casey Kim", "Design is finishing the onboarding mockups — can someone follow up?", false],
      ["You", "I'll follow up with design about the onboarding mockups", true],
    ),
    slack_link: null,
    triggered: false,
    sensitive: false,
    tag_id: -6,
    createdAt: daysAgo(2),
  },

  // ── 3 status "actioned" (In Progress) ──
  {
    id: -7,
    hash: "demo-007",
    text: "Write the API documentation for the new endpoints",
    original_quote: "I'll write up the API docs for v2 endpoints this sprint",
    deadline: null,
    urgency: "medium",
    context: "#engineering",
    source_type: "slack",
    confidence: 0.90,
    status: "actioned",
    direction: "by_me",
    likely_completed: false,
    completion_signal: null,
    message_timestamp: daysAgo(3),
    snooze_until: null,
    context_summary: "API v2 launch requires developer documentation",
    conversation_messages: msgs(
      ["Pat Johnson", "Do we have docs for the new v2 endpoints?", false],
      ["You", "I'll write up the API docs for v2 endpoints this sprint", true],
      ["Pat Johnson", "Thanks — external partners are asking for them", false],
    ),
    slack_link: null,
    triggered: false,
    sensitive: false,
    tag_id: -2,
    createdAt: daysAgo(3),
  },
  {
    id: -8,
    hash: "demo-008",
    text: "Prepare the customer success presentation for Thursday",
    original_quote: "I'll have the customer success deck ready for the Thursday all-hands",
    deadline: futureHours(28),
    urgency: "medium",
    context: "1:1 with Jordan",
    source_type: "meeting",
    confidence: 0.87,
    status: "actioned",
    direction: "assigned_to_me",
    likely_completed: false,
    completion_signal: null,
    message_timestamp: daysAgo(2),
    snooze_until: null,
    context_summary: "Jordan asked for a customer success overview for the all-hands",
    conversation_messages: msgs(
      ["Jordan Lee", "Can you put together a quick customer success overview for Thursday's all-hands?", false],
      ["You", "I'll have the customer success deck ready for the Thursday all-hands", true],
    ),
    slack_link: null,
    triggered: false,
    sensitive: false,
    tag_id: -4,
    createdAt: daysAgo(2),
  },
  {
    id: -9,
    hash: "demo-009",
    text: "Migrate the user table to the new schema",
    original_quote: "I'll handle the user table migration — should be done by Wednesday",
    deadline: null,
    urgency: "high",
    context: "#engineering",
    source_type: "slack",
    confidence: 0.93,
    status: "actioned",
    direction: "by_me",
    likely_completed: false,
    completion_signal: null,
    message_timestamp: daysAgo(1),
    snooze_until: null,
    context_summary: "Database migration for new user profile fields",
    conversation_messages: msgs(
      ["Sam Torres", "We need the user table migrated before the profile feature ships", false],
      ["You", "I'll handle the user table migration — should be done by Wednesday", true],
    ),
    slack_link: null,
    triggered: false,
    sensitive: false,
    tag_id: -2,
    createdAt: daysAgo(1),
  },

  // ── 3 status "done" (this week) ──
  {
    id: -10,
    hash: "demo-010",
    text: "Merge the accessibility fixes into main",
    original_quote: "I'll get the a11y fixes merged today",
    deadline: null,
    urgency: "medium",
    context: "#engineering",
    source_type: "slack",
    confidence: 0.92,
    status: "done",
    direction: "by_me",
    likely_completed: true,
    completion_signal: "Just merged the a11y PR — all checks pass",
    message_timestamp: daysAgo(1),
    snooze_until: null,
    context_summary: "Accessibility audit follow-up items",
    conversation_messages: msgs(
      ["Casey Kim", "Are the a11y fixes ready to go?", false],
      ["You", "I'll get the a11y fixes merged today", true],
      ["You", "Just merged the a11y PR — all checks pass", true],
    ),
    slack_link: null,
    triggered: false,
    sensitive: false,
    tag_id: -2,
    createdAt: daysAgo(1),
  },
  {
    id: -11,
    hash: "demo-011",
    text: "Send meeting notes from the product sync to stakeholders",
    original_quote: "I'll send the notes out to everyone after this call",
    deadline: null,
    urgency: "low",
    context: "Product Sync",
    source_type: "meeting",
    confidence: 0.86,
    status: "done",
    direction: "by_me",
    likely_completed: true,
    completion_signal: null,
    message_timestamp: daysAgo(2),
    snooze_until: null,
    context_summary: "Weekly product sync — discussed roadmap priorities",
    conversation_messages: msgs(
      ["Dana Park", "Can someone share the notes?", false],
      ["You", "I'll send the notes out to everyone after this call", true],
    ),
    slack_link: null,
    triggered: false,
    sensitive: false,
    tag_id: -1,
    createdAt: daysAgo(2),
  },
  {
    id: -12,
    hash: "demo-012",
    text: "Update the CI pipeline to include the new linting rules",
    original_quote: "I'll update the CI config to run the new ESLint rules",
    deadline: null,
    urgency: "low",
    context: "#platform-eng",
    source_type: "slack",
    confidence: 0.68, // low confidence → "Might be commitments"
    status: "done",
    direction: "by_me",
    likely_completed: true,
    completion_signal: null,
    message_timestamp: daysAgo(3),
    snooze_until: null,
    context_summary: "Discussion about adding stricter lint rules to CI",
    conversation_messages: msgs(
      ["Alex Rivera", "Should we enforce the new lint rules in CI?", false],
      ["You", "I'll update the CI config to run the new ESLint rules", true],
    ),
    slack_link: null,
    triggered: false,
    sensitive: false,
    tag_id: -5,
    createdAt: daysAgo(3),
  },
];

// ── Two items with confidence < 0.75 (added to active list as "Might be commitments") ──
// We'll create these as additional low-confidence "new" items
const LOW_CONFIDENCE_ITEMS: Commitment[] = [
  {
    id: -13,
    hash: "demo-013",
    text: "Look into the slow query on the dashboard page",
    original_quote: "I can take a look at that slow query if I get a chance",
    deadline: null,
    urgency: "low",
    context: "#engineering",
    source_type: "slack",
    confidence: 0.62,
    status: "new",
    direction: "by_me",
    likely_completed: false,
    completion_signal: null,
    message_timestamp: daysAgo(1),
    snooze_until: null,
    context_summary: "Dashboard page load times spiking due to unoptimized query",
    conversation_messages: msgs(
      ["Pat Johnson", "Dashboard is loading really slowly — some query is taking 3s", false],
      ["You", "I can take a look at that slow query if I get a chance", true],
    ),
    slack_link: null,
    triggered: false,
    sensitive: false,
    tag_id: -2,
    createdAt: daysAgo(1),
  },
  {
    id: -14,
    hash: "demo-014",
    text: "Maybe help with the new hire onboarding guide",
    original_quote: "I could probably help update the onboarding guide sometime",
    deadline: null,
    urgency: "low",
    context: "#people-ops",
    source_type: "slack",
    confidence: 0.55,
    status: "new",
    direction: "by_me",
    likely_completed: false,
    completion_signal: null,
    message_timestamp: daysAgo(3),
    snooze_until: null,
    context_summary: "People ops looking for volunteers to update new hire docs",
    conversation_messages: msgs(
      ["Maria Chen", "The onboarding guide is really outdated — any volunteers?", false],
      ["You", "I could probably help update the onboarding guide sometime", true],
    ),
    slack_link: null,
    triggered: false,
    sensitive: false,
    tag_id: -6,
    createdAt: daysAgo(3),
  },
];

// ─── Derived exports ───

/** Active commitments (new + snoozed with expired snooze) — replaces useCommitments().commitments */
export const DEMO_ACTIVE: Commitment[] = [
  ...DEMO_COMMITMENTS.filter(c => c.status === "new" || c.status === "snoozed"),
  ...LOW_CONFIDENCE_ITEMS,
];

/** Kanban buckets — replaces useKanban() */
export const DEMO_KANBAN = {
  todo: [...DEMO_COMMITMENTS.filter(c => c.status === "new" || c.status === "snoozed"), ...LOW_CONFIDENCE_ITEMS],
  inProgress: DEMO_COMMITMENTS.filter(c => c.status === "actioned"),
  done: DEMO_COMMITMENTS.filter(c => c.status === "done"),
  counts: {
    all: DEMO_COMMITMENTS.filter(c => c.status === "new" || c.status === "snoozed" || c.status === "actioned").length + LOW_CONFIDENCE_ITEMS.length,
    high: DEMO_COMMITMENTS.filter(c => (c.status === "new" || c.status === "snoozed" || c.status === "actioned") && c.urgency === "high").length,
  },
  loading: false,
};

/** Counts for LeftNav — replaces useCommitments().counts */
export const DEMO_COUNTS = {
  all: DEMO_ACTIVE.length,
  high: DEMO_ACTIVE.filter(c => c.urgency === "high").length,
  byMe: DEMO_ACTIVE.filter(c => c.direction === "by_me").length,
  assignedToMe: DEMO_ACTIVE.filter(c => c.direction === "assigned_to_me").length,
};

/** Dismissal patterns */
export const DEMO_DISMISSALS: Dismissal[] = [
  {
    id: -1,
    pattern: "sounds good, I'll take a look",
    reason: "Acknowledgment, not a commitment",
    count: 4,
    createdAt: daysAgo(7),
  },
  {
    id: -2,
    pattern: "let me think about that",
    reason: "Hedging, no concrete action",
    count: 3,
    createdAt: daysAgo(5),
  },
  {
    id: -3,
    pattern: "we should probably do that at some point",
    reason: "Vague aspiration, not actionable",
    count: 2,
    createdAt: daysAgo(3),
  },
];

/** Pending completion suggestions */
export const DEMO_SUGGESTIONS: CompletionSuggestion[] = [
  {
    id: -1,
    commitmentId: -7,
    confidence: 0.82,
    evidence: "Saw 'API docs PR is up for review' in #engineering",
    sourceMessage: "API docs PR is up for review — covers all v2 endpoints",
    status: "pending",
    createdAt: hoursAgo(1),
  },
  {
    id: -2,
    commitmentId: -9,
    confidence: 0.76,
    evidence: "Migration script merged to main",
    sourceMessage: "Migration script merged — running in staging now",
    status: "pending",
    createdAt: hoursAgo(2),
  },
];

/** Today's morning brief */
export const DEMO_BRIEFS: MorningBrief[] = [
  {
    id: -1,
    date: todayDate(),
    greeting: "Good morning! You have 3 high-priority items and a busy afternoon ahead.",
    priorities: [
      {
        commitmentId: -1,
        text: "Send revised proposal to Acme Corp",
        reason: "Due today — Acme expects it before their 5pm meeting",
        suggestedTime: "10:00 AM",
        action: "do",
      },
      {
        commitmentId: -2,
        text: "Review Q2 budget spreadsheet",
        reason: "Board meeting is Thursday — needs sign-off",
        suggestedTime: "11:00 AM",
        action: "do",
      },
      {
        commitmentId: -3,
        text: "Fix authentication bug",
        reason: "Blocking the staging deploy — QA is waiting",
        suggestedTime: "After standup",
        action: "do",
      },
    ],
    scheduleSuggestion: "Tackle the auth bug first since it's blocking others. Then the Acme proposal during your focus block. Review the budget after lunch.",
    headsUp: [
      "The Acme proposal deadline is today at 5pm",
      "Jordan is expecting the customer success deck by Thursday",
    ],
    headsUpTyped: [
      { text: "The Acme proposal deadline is today at 5pm", severity: "due_soon" },
      { text: "Jordan is expecting the customer success deck by Thursday", severity: "warning" },
    ],
    calendarEvents: [
      { title: "Team Standup", start: futureHours(1), end: futureHours(1.5) },
      { title: "Focus Block", start: futureHours(2), end: futureHours(4) },
      { title: "1:1 with Jordan", start: futureHours(5), end: futureHours(5.5) },
    ],
    suggestedMoves: [],
    dismissed: false,
    snoozedUntil: null,
    createdAt: hoursAgo(6),
  },
];

/** Decision log entries */
export const DEMO_DECISION_LOG: DecisionLogEntry[] = [
  {
    id: -1,
    decision: "accepted",
    original_text: "I'll get the revised proposal over to Acme by EOD today",
    sender: "You",
    channel: "#acme-partnership",
    reason: "Send revised proposal to Acme Corp by end of day",
    category: "",
    confidence: 0.94,
    batchId: "demo-batch-1",
    createdAt: hoursAgo(3),
  },
  {
    id: -2,
    decision: "rejected",
    original_text: "Sounds good, will keep an eye on it",
    sender: "You",
    channel: "#engineering",
    reason: "Acknowledgment without concrete action",
    category: "acknowledgment",
    confidence: null,
    batchId: "demo-batch-1",
    createdAt: hoursAgo(3),
  },
  {
    id: -3,
    decision: "accepted",
    original_text: "I'll review the Q2 budget and approve it before the board meeting",
    sender: "You",
    channel: "#finance",
    reason: "Review and approve the Q2 budget spreadsheet",
    category: "",
    confidence: 0.91,
    batchId: "demo-batch-2",
    createdAt: hoursAgo(5),
  },
  {
    id: -4,
    decision: "rejected",
    original_text: "Yeah we should definitely think about that",
    sender: "You",
    channel: "#product",
    reason: "Vague agreement, no specific commitment made",
    category: "hedging",
    confidence: null,
    batchId: "demo-batch-2",
    createdAt: hoursAgo(5),
  },
  {
    id: -5,
    decision: "accepted",
    original_text: "I'll dig into the auth bug right after standup — it's blocking staging",
    sender: "You",
    channel: "#engineering",
    reason: "Fix the authentication bug blocking the staging deploy",
    category: "",
    confidence: 0.88,
    batchId: "demo-batch-3",
    createdAt: hoursAgo(2),
  },
  {
    id: -6,
    decision: "rejected",
    original_text: "Thanks for the heads up, noted",
    sender: "You",
    channel: "#platform-eng",
    reason: "Simple acknowledgment, not a commitment",
    category: "politeness",
    confidence: null,
    batchId: "demo-batch-3",
    createdAt: hoursAgo(2),
  },
  {
    id: -7,
    decision: "rejected",
    original_text: "Sarah mentioned she would update the docs",
    sender: "Pat Johnson",
    channel: "#engineering",
    reason: "Third-party reference — Sarah's commitment, not user's",
    category: "third_party",
    confidence: null,
    batchId: "demo-batch-4",
    createdAt: daysAgo(1),
  },
  {
    id: -8,
    decision: "accepted",
    original_text: "Let me put the competitive analysis together and share it with sales by Friday",
    sender: "You",
    channel: "Q2 Planning Offsite",
    reason: "Share the competitive analysis deck with the sales team",
    category: "",
    confidence: 0.85,
    batchId: "demo-batch-4",
    createdAt: daysAgo(1),
  },
];
