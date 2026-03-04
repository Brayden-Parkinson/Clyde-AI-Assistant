# Commitment Tracker — Chrome Extension

## What This Is

A Chrome browser extension that passively watches my Slack messages and Granola meeting notes, uses Claude to extract commitments I've made or been asked to do, and presents them in a triage inbox where I decide what to do with each one. All data stays local on my machine. No server. No backend. Just a browser extension.

---

## Who I Am (Context for Prompt Tuning)

I'm Brayden Parkinson, Director of Product Engineering at OpenSpace (construction tech). I manage ~50 engineers across frontend, backend, mobile, and QA. My direct reports are Molly, MJ, Wes, Gabe Jr, and Michaela. I report to VP-level leadership (Jack, Robert Shear is VP of Strategy). I'm constantly in meetings, Slack conversations, and 1:1s where I make commitments I forget about.

My commitment patterns:
- Meetings (Granola): "I'll send that over", "Let me schedule something", "I'll follow up with [person]"
- Slack messages I send: "I'll look into that", "Let me circle back", "I'll get that to you by [time]"
- Slack messages directed at me: "Can you review this?", "Brayden can you take a look?"

---

## Architecture

This is a single Chrome extension with four layers:

```
CONTENT SCRIPT (Slack)          BACKGROUND SERVICE WORKER         POPUP / SIDE PANEL UI
Injected into app.slack.com     Orchestrates everything           React triage inbox
Reads messages via DOM ───────► Batches messages (5 min)          Reads from IndexedDB
MutationObserver                Pre-filters with regex            Shows commitment cards
                                Calls Claude API                  User takes actions
                                Deduplicates                      Dismissals train prompt
API POLLER (Granola)            Stores to IndexedDB
fetch() from service worker ──► Fires chrome.notifications
Polls every 60 min              Updates badge count

                    ┌─────────────────────────┐
                    │   IndexedDB (Dexie.js)   │
                    │   All data stays local   │
                    └─────────────────────────┘
```

### Why This Architecture

- **Content script for Slack**: I'll use Slack in a Chrome tab (not the desktop app). The content script reads the DOM directly — no bot token, no IT approval, no API key needed.
- **API polling for Granola**: I use the Granola desktop app for meetings. Notes sync to their backend after meetings end. The service worker polls the Granola API to pull recent notes. This way I don't need Granola open in a browser tab.
- **No server**: Everything runs inside Chrome. IndexedDB for storage, chrome.alarms for scheduling, chrome.notifications for alerts.
- **Claude API is the only external call**: Raw text goes to Claude, structured JSON comes back. That's the only thing leaving my machine.

---

## Data Ingestion

### Slack Content Script (`content/slack.ts`)

Injected into `app.slack.com/*`. Uses MutationObserver to watch for new messages in the active view.

**What it captures:**
- Messages I send (match by my display name / avatar in the DOM)
- Messages that @mention me
- DMs directed at me
- The channel name (from URL path or header element)
- Message timestamp

**What it does NOT do:**
- Scroll or paginate to find old messages
- Modify the DOM in any way
- Capture messages from channels not visible on screen

**Key DOM selectors** (use `data-qa` attributes as primary, class names as fallback — `data-qa` is more stable across Slack updates):
```
Message container: [data-qa="virtual-list-item"]
Message text:      [data-qa="message-text"] or .c-message_kit__text
Sender name:       [data-qa="message_sender_name"] or .c-message_kit__sender
Timestamp:         [data-qa="message_timestamp"] or datetime attribute
Channel:           URL path segment or header element
```

**Resilience**: Include multiple fallback selectors. Log a warning to console when primary selectors don't match (signals a Slack DOM update). Don't crash — just skip unreadable messages.

**Sends to background**: `chrome.runtime.sendMessage({ type: "SLACK_MESSAGES", messages: [...] })` batched every 2-3 minutes via debounce.

### Granola API Poller (in background service worker)

Polls Granola's API every 60 minutes via `chrome.alarms`. Also polls once on extension startup.

**Implementation**: 
- Use `fetch()` from the service worker to hit the Granola API
- Auth via API key stored in `chrome.storage.local` (configured in options page)
- Pull notes updated since last poll timestamp
- Extract the note title, date, and full text/transcript
- Track processed note IDs to avoid re-ingestion

**Note**: I need to figure out the exact Granola API endpoint and auth method. The extension options page should have a field for the Granola API key. If Granola doesn't have a public REST API, fall back to: (a) check if MCP connector exposes a fetchable endpoint, or (b) add a manual paste option in the popup where I can paste meeting notes directly.

---

## Commitment Extraction

### Pre-filter (saves ~70% of API costs)

Before sending anything to Claude, run a regex check. Only send messages that match commitment-like language:

```javascript
const COMMITMENT_REGEX = /I'll|I will|let me|I can|I could|action item|can you|could you|follow up|circle back|send (you|over|along)|get back to|schedule|set up|look into|take a look|check on|review|get that to you|by (end of day|EOD|tomorrow|Friday|Monday|next week)/i;
```

Messages that don't match get stored in `raw_messages` (for potential manual review) but never hit Claude.

### Claude API Call

Use the Anthropic SDK. Model: `claude-sonnet-4-5-20250514`. API key stored in `chrome.storage.local`, configured in options page.

**Extraction prompt:**

```
You are analyzing messages sent by or directed at Brayden Parkinson, Director of Product Engineering at OpenSpace.

Extract commitments — things Brayden agreed to do, or was asked to do by someone else.

INCLUDE patterns:
- "I'll [verb]..." — committing to an action
- "Let me [verb]..." — taking ownership
- "I can [do something] by [time]" — commitment with deadline
- "Can you [verb]..." / "Could you [verb]..." — someone asking Brayden
- "Action item: [something]" — explicit assignment
- "[Brayden] to [verb]..." — meeting notes assignment

EXCLUDE (do NOT flag these):
- Generic politeness: "I'll let you know", "let me know if you need anything"
- Hedging or stalling: "let me think about that", "I'll try", "yeah maybe"
- Information sharing: "I'll explain", "let me walk you through this"
- Past tense: "I already sent", "I looked into it yesterday"
- Questions: "Should I...?", "Do you want me to...?"
${DYNAMIC_DISMISSAL_PATTERNS}

For each commitment found, return this JSON structure:
{
  "commitments": [
    {
      "text": "Brief, actionable description",
      "original_quote": "Exact words from the source text",
      "deadline": "ISO 8601 datetime if mentioned, null if not",
      "urgency": "high | medium | low",
      "context": "Channel name, meeting title, or person name",
      "source_type": "meeting | slack",
      "confidence": 0.0 to 1.0
    }
  ]
}

Confidence scoring:
- 0.9+  : Unambiguous commitment with a clear action verb and ownership
- 0.7-0.9: Likely commitment, slightly ambiguous
- 0.5-0.7: Could go either way — might be hedging
- Below 0.5: Do NOT include

Only return items with confidence >= 0.5.
Return ONLY valid JSON. No markdown fences. No preamble.
```

**The `${DYNAMIC_DISMISSAL_PATTERNS}` variable**: Every time I tap "Not a commitment" in the triage UI, the original_quote gets saved to the `dismissals` table. Before each Claude call, query all dismissal patterns and inject them into the EXCLUDE section of the prompt. Example:

```
- Dismissed 4x: "Let me think about that" — user says this is hedging
- Dismissed 3x: "Yeah maybe" — user says this is non-committal
- Dismissed 2x: "I'll try to get to it" — user says this is low-confidence language
```

This is the learning loop. Over time, Claude gets better at only showing me real commitments.

---

## Storage (IndexedDB via Dexie.js)

All local. All in the browser. Dexie.js wraps IndexedDB for a cleaner API.

```javascript
import Dexie from "dexie";

const db = new Dexie("CommitmentTracker");

db.version(1).stores({
  // Detected commitments
  commitments: "++id, hash, urgency, status, sourceType, confidence, createdAt",

  // Raw ingested messages (auto-expire after 7 days)
  raw_messages: "++id, sourceType, sourceId, capturedAt",

  // Dismissed patterns that train the extraction prompt
  dismissals: "++id, pattern, reason, count, createdAt",

  // Log of what I did with each commitment
  action_log: "++id, commitmentId, action, createdAt",

  // Settings (API keys, thresholds, preferences)
  settings: "key",
});
```

**Commitment statuses:** `new` | `snoozed` | `actioned` | `done` | `dismissed`

**Cleanup**: Run a daily job (chrome.alarms) to delete `raw_messages` older than 7 days and `commitments` with status `done` or `dismissed` older than 30 days.

---

## UI — Triage Inbox

The popup/side panel is a React app that reads from IndexedDB and renders commitment cards.

### Design System (OpenSpace Brand)

```javascript
// Brand tokens — use these everywhere
const OS = {
  blue: "#2b67db",         // Primary action color, active filter, links
  darkBlue: "#163B83",     // Headers, logo mark, toast background
  yellow: "#fde13c",       // Accent (reminder button border)
  lightBlue: "#bfd1f4",    // Secondary backgrounds
  lightestBlue: "#d5e0f8", // Quote boxes, icon backgrounds, source badges
  lightGray: "#dcdcdc",    // Dividers
  darkGray: "#323232",     // Heavy text (sparingly)
  white: "#ffffff",        // Card backgrounds
  bg: "#f7f8fc",           // Page background — light, slightly blue-tinted
  border: "#e4e7f0",       // Card borders, dividers
  textPrimary: "#1a1d2e",  // Headings, commitment text
  textSecondary: "#5c6078",// Body text, metadata
  textMuted: "#8e92a8",    // Timestamps, hints, secondary labels
  font: "'Arial', 'Helvetica Neue', sans-serif",  // Brand fallback font
};
```

**Aesthetic**: Light, bright, clean. White cards on light gray-blue background. Colored left border on cards indicates urgency (red = high, yellow = medium, default = low). Subtle shadows. No dark mode (keep it simple for v1).

### Layout

**Sticky top bar** (white, bottom border):
- Logo mark: 32x32 rounded square, gradient from `blue` to `darkBlue`, white ◉ icon
- "Commitments" title in `darkBlue`, extra bold
- Date and item count subtitle in `textMuted`
- Urgent count badge (red pill) if any high-urgency items
- Stats on the right: actioned count, dismissed count, last scan time
- Filter bar below: All, Urgent, Meetings, Slack, High confidence — pill-style buttons, active state uses `blue` bg with white text

**Scrollable content area**:
- Learned patterns panel (collapsible, collapsed by default)
- Commitment cards sorted by urgency (high → medium → low), then by confidence (desc)

**Empty state**: Centered checkmark icon in `lightestBlue` circle, "All clear" heading, "No commitments to review right now." subtext.

### Commitment Card

Each card is a white rounded rectangle with:

**Collapsed state** (default):
- Left border: 4px solid, colored by urgency (red/yellow/default)
- Metadata row: urgency pill, source badge (💬 Slack or 🎙 Meeting with tinted backgrounds), context name, confidence percentage pill
- Commitment text: 15px, bold, `textPrimary`
- Deadline on the right: countdown (monospace, colored red if overdue, orange if < 1hr), full date below in `textMuted`
- Click anywhere to expand

**Expanded state** (card gets blue border, subtle blue shadow):
- Everything from collapsed, plus:
- Divider line
- Original quote box: `lightestBlue` background, left border in `blue`, "ORIGINAL QUOTE" label in small caps, italic quote text in `darkBlue`
- Action buttons row (wraps on narrow widths):

### Action Buttons

| Button | Icon | Variant | What It Does |
|--------|------|---------|-------------|
| Calendar event | 📅 | `primary` (blue bg, white text) | Opens a new tab with pre-filled Google Calendar URL (no auth needed) |
| Set reminder | 🔔 | `yellow` (yellow border on hover) | Creates a `chrome.alarm` + `chrome.notification` at chosen time |
| Slack message | 💬 | `default` (neutral) | Opens `app.slack.com/client/{workspace}/{channel}` in a new tab |
| Snooze 1h | ⏰ | `default` | Sets status to `snoozed`, hides card until `snooze_until` timestamp |
| Already done | ✅ | `success` (green border) | Sets status to `done`, logs to `action_log` |
| Not a commitment | ✕ | `danger` (red text/border) | Sets status to `dismissed`, saves pattern to `dismissals` table |

**Button styling**: Rounded (8px), 1.5px border, hover states with subtle background fill and shadow. All transitions 150ms ease.

### Calendar Event Action (URL-based, no Google auth)

When "Calendar event" is clicked, open this URL in a new tab:

```
https://calendar.google.com/calendar/render?action=TEMPLATE
  &text=🔔 {encodeURIComponent(commitment.text)}
  &details={encodeURIComponent(commitment.original_quote + "\n\nSource: " + commitment.context)}
  &dates={startISO}/{endISO}
```

If the commitment has a deadline, set start to 30 minutes before deadline. If no deadline, set start to the next round 30-minute slot from now. End = start + 30 min. Format dates as `YYYYMMDDTHHmmssZ`.

### Toast Notifications

When an action is taken, show a toast in the bottom-right corner:
- `darkBlue` background, white text, 10px rounded, drop shadow
- Auto-dismiss after 2.8 seconds
- Slide-up animation on appear

### Side Panel Mode

Register a side panel in the manifest. Same React app as the popup, but rendered in Chrome's side panel (persistent, stays open alongside Slack). Let the user choose popup or side panel in options.

---

## Notifications

### Badge Count
Update `chrome.action.setBadgeText` with the count of `new` commitments. Badge background: `OS.blue`. Clears when all items are triaged.

### Chrome Notifications
Fire `chrome.notifications.create` immediately for `high` urgency commitments. Title: "Commitment Tracker", body: commitment text, icon: extension icon.

### Morning Digest
At 8:00 AM daily (via chrome.alarms), fire a single notification summarizing open commitments:
- "You have {n} open commitments ({high} urgent)"
- Clicking it opens the popup/side panel

---

## Extension File Structure

```
commitment-tracker-ext/
├── manifest.json
├── vite.config.ts
├── tsconfig.json
├── package.json
├── src/
│   ├── background/
│   │   ├── service-worker.ts      # Main orchestrator: alarms, message handling, badge
│   │   ├── extractor.ts           # Claude API call, prompt building, dynamic dismissals
│   │   ├── batcher.ts             # Message buffering, pre-filter regex, debounce timer
│   │   ├── granola-poller.ts      # Granola API fetch on alarm schedule
│   │   └── storage.ts             # Dexie.js database init, queries, cleanup
│   ├── content/
│   │   ├── slack.ts               # MutationObserver, DOM selectors, message extraction
│   │   └── selectors.ts           # Slack DOM selectors with fallbacks, health check
│   ├── popup/
│   │   ├── index.html
│   │   ├── App.tsx                # Main triage UI
│   │   ├── components/
│   │   │   ├── CommitmentCard.tsx
│   │   │   ├── ActionButton.tsx
│   │   │   ├── FilterBar.tsx
│   │   │   ├── LearnedPatterns.tsx
│   │   │   ├── StatBar.tsx
│   │   │   └── Toast.tsx
│   │   ├── hooks/
│   │   │   ├── useCommitments.ts  # Read/write commitments from IndexedDB
│   │   │   ├── useSettings.ts     # Read/write settings
│   │   │   └── useActions.ts      # Handle action button clicks
│   │   └── tokens.ts             # OpenSpace design tokens (colors, fonts)
│   ├── sidepanel/
│   │   └── index.html             # Same React app, rendered in side panel
│   └── options/
│       ├── index.html
│       └── Options.tsx            # API key inputs, threshold config, scan frequency
├── assets/
│   ├── icon-16.png
│   ├── icon-48.png
│   └── icon-128.png
└── README.md
```

---

## manifest.json

```json
{
  "manifest_version": 3,
  "name": "Commitment Tracker",
  "version": "0.1.0",
  "description": "Detects commitments from Slack and meetings. Keeps you honest.",
  "permissions": [
    "storage",
    "alarms",
    "notifications",
    "sidePanel"
  ],
  "host_permissions": [
    "https://app.slack.com/*",
    "https://*.slack.com/*",
    "https://api.anthropic.com/*",
    "https://*.granola.so/*",
    "https://api.granola.so/*"
  ],
  "background": {
    "service_worker": "src/background/service-worker.ts",
    "type": "module"
  },
  "content_scripts": [
    {
      "matches": ["https://app.slack.com/*", "https://*.slack.com/*"],
      "js": ["src/content/slack.ts"],
      "run_at": "document_idle"
    }
  ],
  "action": {
    "default_popup": "src/popup/index.html",
    "default_icon": {
      "16": "assets/icon-16.png",
      "48": "assets/icon-48.png",
      "128": "assets/icon-128.png"
    }
  },
  "side_panel": {
    "default_path": "src/sidepanel/index.html"
  },
  "options_ui": {
    "page": "src/options/index.html",
    "open_in_tab": true
  }
}
```

---

## Build Toolchain

- **Vite** + **CRXJS Vite Plugin** (`@crxjs/vite-plugin@beta`) — hot reload for Chrome extensions during dev
- **React 18** + **TypeScript** — popup and side panel UI
- **Dexie.js** — IndexedDB wrapper
- **@anthropic-ai/sdk** — Claude API calls
- **Tailwind CSS** (optional) — or keep inline styles matching the design tokens

### Setup Commands

```bash
npm create vite@latest commitment-tracker-ext -- --template react-ts
cd commitment-tracker-ext
npm install dexie @anthropic-ai/sdk
npm install -D @crxjs/vite-plugin@beta
```

### Dev Workflow

```bash
npm run dev
# Load the dist/ folder as an unpacked extension in chrome://extensions (developer mode on)
# Changes hot-reload automatically
```

---

## Options Page

Simple settings form with:

- **Anthropic API Key**: password input, stored in `chrome.storage.local`
- **Granola API Key**: password input (or instructions if API isn't available)
- **Slack Scan Frequency**: dropdown — every 2 min, 5 min (default), 10 min
- **Granola Poll Frequency**: dropdown — every 30 min, 60 min (default), 2 hours
- **Confidence Threshold**: slider, 50%-95%, default 50% (show everything above this)
- **Morning Digest Time**: time picker, default 8:00 AM
- **UI Mode**: toggle between Popup and Side Panel
- **Daily API Cost**: read-only display showing estimated daily spend based on recent usage
- **Clear All Data**: danger button to wipe IndexedDB (fresh start)
- **Export Data**: download all commitments as JSON (for backup)

---

## Cost Estimate

With the pre-filter regex, most messages never hit Claude:
- ~20-30 messages/day contain commitment-like language
- Batched into ~6-8 Claude API calls/day
- ~500 tokens input + 300 tokens output per call
- **~$0.50-1.00/month** in Claude API costs

---

## Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| Slack DOM selectors break after Slack updates | Use `data-qa` attributes (most stable), multiple fallbacks, health check logging. Fixing is a quick Claude Code session when it breaks. |
| False positive overload kills trust in the tool | Pre-filter regex + confidence threshold + dismissal learning loop. System gets smarter over time. |
| Service worker goes idle (Manifest V3 limitation) | All state in IndexedDB, never in memory. Worker wakes on alarms and content script messages. |
| Granola API isn't publicly available | Fallback: manual paste textarea in the popup. Or parse Granola web UI if I open it in a tab occasionally. |
| Sensitive meeting content sent to Claude API | Add a "Pause ingestion" toggle in the popup for sensitive meetings. Data sent to Claude API is not stored by Anthropic on the standard API. |
| IT blocks unpacked Chrome extensions | Self-sign as .crx, or publish unlisted to Chrome Web Store (private, only I can install). |
| Calendar events created in wrong timezone | Hardcode `America/Denver` (Mountain Time, Fort Collins). Make configurable in options page. |

---

## Build Phases

### Phase 1 — MVP (this weekend)

Get the core loop working end-to-end:

- [ ] Scaffold project: Vite + CRXJS + React + TypeScript
- [ ] `manifest.json` with correct permissions and content script config
- [ ] Slack content script: MutationObserver, capture my messages, send to background
- [ ] Background service worker: receive messages, batch with debounce, pre-filter regex
- [ ] Claude extraction: build prompt, call API, parse JSON response
- [ ] IndexedDB storage layer with Dexie.js (commitments, dismissals, settings tables)
- [ ] Deduplication via SHA256 hash of original_quote + source
- [ ] Popup UI: the full triage inbox with OpenSpace branding (the React app we designed)
- [ ] Action: "Not a commitment" dismiss flow that saves to dismissals table
- [ ] Action: "Calendar event" that opens pre-filled Google Calendar URL
- [ ] Action: "Already done" that marks complete
- [ ] Badge count on extension icon
- [ ] Options page with Anthropic API key input
- [ ] Basic chrome.notifications for high-urgency items

### Phase 2 — Daily Driver (next week)

- [ ] Granola API poller in background service worker
- [ ] Dynamic dismissal patterns injected into Claude prompt
- [ ] Side panel mode (persistent, alongside Slack)
- [ ] Snooze functionality with chrome.alarms
- [ ] "Set reminder" action with time picker
- [ ] "Slack message" action that opens the relevant channel
- [ ] Morning digest notification at 8 AM
- [ ] Options page: all settings (scan frequency, confidence threshold, digest time)
- [ ] Auto-cleanup of old data (7-day raw messages, 30-day completed)
- [ ] Cost tracking in options page

### Phase 3 — Power Features (future)

- [ ] Gmail content script (capture sent messages)
- [ ] Jira content script (assigned tickets, comments I post)
- [ ] Weekly review: completed vs. dropped commitments
- [ ] Auto-tuning confidence threshold based on dismiss rate
- [ ] Keyboard shortcut (Cmd+Shift+C) to open triage
- [ ] Slack thread context awareness (read surrounding messages for better extraction)
- [ ] Export commitments as markdown
- [ ] Manual input: quick-add box to type a commitment directly
