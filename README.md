# Clyde — Commitment Tracker

Chrome extension that watches your Slack conversations and Granola meeting notes, uses Claude AI to extract commitments you've made, and surfaces them in a triage inbox. Say "Clyde" in any message to explicitly flag a commitment.

All data is stored locally. Nothing leaves your browser except API calls to Anthropic.

## Installation

1. Clone this repo and install dependencies:
   ```bash
   git clone <repo-url>
   cd commitment-tracker-ext
   npm install
   ```

2. Build the extension:
   ```bash
   npm run build
   ```

3. Load in Chrome:
   - Open `chrome://extensions`
   - Enable **Developer mode** (toggle in top-right)
   - Click **Load unpacked** and select the `dist/` folder

## Setup

On first launch, Clyde shows a setup wizard. You can also configure everything in Settings (gear icon).

### Required
- **Anthropic API Key** — Get one at [console.anthropic.com](https://console.anthropic.com/settings/keys). Used for Claude API calls to analyze messages.
- **Full Name** — So Clyde knows which messages are yours.

### Recommended
- **Slack Display Name(s)** — Comma-separated names you use in Slack (e.g. "Jane Doe, Jane"). Falls back to auto-detection if empty.
- **Timezone** — Auto-detected from your browser. Used for morning brief scheduling.

### Optional
- **Title / Company** — Adds context for the AI analysis.
- **Google Calendar ICS URL** — Enables the Morning Brief to incorporate your calendar.

## Granola Setup (Optional)

Granola integration reads meeting transcripts from the local Granola cache via a native messaging host.

1. Open Terminal
2. Navigate to the extension's `native-host/` directory
3. Run: `./install.sh <your-extension-id>`
4. Go to Clyde Settings and click **Test Connection**

Your extension ID is shown in `chrome://extensions` and in Clyde Settings.

## Usage

### Automatic Detection
Open any Slack workspace in Chrome. Clyde's content script observes messages and sends them to the background for analysis every few minutes. Commitments are extracted by Claude and appear in the triage inbox.

### Explicit Flagging
Say **"Clyde"** in any Slack message to explicitly flag a commitment (e.g. "I'll send the report by Friday. Clyde."). These are extracted at 0.95 confidence.

### Triage Actions
- **Done** — Mark a commitment as completed
- **Dismiss** — Remove a false positive (Clyde learns from dismissals)
- **Snooze** — Hide for 24 hours
- **Calendar** — Create a Google Calendar event
- **Reminder** — Get a Chrome notification in 30 minutes

### Views
- **Board** — Kanban view with customizable columns
- **List** — Grouped by urgency (Needs Attention / Open / Maybe)
- **Brief** — AI-generated daily plan with priorities and schedule suggestions

## Privacy

- All data stored locally in Chrome (IndexedDB + chrome.storage)
- Raw messages are auto-deleted after 7 days
- Completed/dismissed commitments are cleaned up after 30 days
- Only Anthropic API calls leave the browser (messages sent for analysis)
- Your API key is stored locally and never shared with anyone

## Troubleshooting

**No commitments appearing?**
- Check that Slack is open in a Chrome tab (not the desktop app)
- Verify your API key is set in Settings
- Check the Status Panel (click the status bar at bottom of Clyde)
- Try "Scan Now" to trigger a manual extraction

**Granola not connecting?**
- Make sure you ran `./install.sh` with the correct extension ID
- The native host reads from `~/Library/Application Support/Granola/cache-v4.json`
- Click "Test Connection" in Settings for detailed error info

**API errors?**
- 401: Your API key is invalid — re-enter it in Settings
- 429: Rate limited — Clyde will automatically retry
- Timeout: Check your internet connection

## Development

```bash
npm run dev          # Vite watch mode (hot reload)
npm run build        # Type-check + production build
npm run typecheck    # TypeScript only
npm run test         # Run test suite
```

Architecture: `src/content/` (Slack observer) → `src/background/` (service worker, batcher, extractor) → `src/popup/` (React triage inbox). See `CLAUDE_CODE_SPEC.md` for the full product specification.
