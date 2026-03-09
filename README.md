# Clyde — AI Commitment Tracker

Chrome extension that watches your Slack conversations and meeting notes, uses Claude AI to extract commitments, and organizes them in a kanban board. All data stays local.

## Prerequisites

- **Google Chrome**
- **Anthropic API Key** — get one at [console.anthropic.com](https://console.anthropic.com/settings/keys)
- **Granola** (optional) — if you want meeting note scanning, install [Granola](https://granola.ai) and have at least one meeting recorded

## Install (2 minutes)

1. Click the green **Code** button above → **Download ZIP** → unzip it
2. Open `chrome://extensions` in Chrome
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** → select the **`dist`** folder inside the unzipped folder
5. Pin Clyde from the puzzle-piece icon in Chrome's toolbar

Open Clyde and the setup wizard will walk you through entering your name and API key.

## Connecting Sources

### Slack (automatic)
Just browse `app.slack.com` — Clyde starts scanning your visible messages automatically. No setup needed.

### Google Docs (automatic)
Open any Google Doc — Clyde reads document text and comments automatically. No setup needed.

### Granola Meetings (one-time setup)
1. Open Clyde's **Settings** page (gear icon)
2. Scroll to **Granola Meetings** → expand **Setup instructions**
3. Copy the terminal command, paste it in Terminal, hit Enter
4. **Quit Chrome completely** (Cmd+Q) and reopen it
5. Click **Test Connection** — should show "Connected (Local)"

Clyde checks for new meetings every 10 minutes. Only new, unprocessed meetings use API tokens.

## Development

```bash
npm install
npm run dev          # Vite watch mode (hot reload)
npm run build        # Type-check + production build
npm run typecheck    # TypeScript only
```
