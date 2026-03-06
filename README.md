# Clyde — AI Commitment Tracker

Chrome extension that watches your Slack conversations and meeting notes, uses Claude AI to extract commitments, and organizes them in a kanban board. All data stays local.

## Prerequisites

- **Google Chrome**
- **Anthropic API Key** — get one at [console.anthropic.com](https://console.anthropic.com/settings/keys)

## Install

1. Click the green **Code** button above, then **Download ZIP**. Unzip it anywhere.
2. Open `chrome://extensions` in Chrome
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** → select the **`dist`** folder inside the unzipped folder
5. Pin Clyde from the puzzle piece icon in Chrome's toolbar

Open Clyde and the setup wizard will walk you through the rest.

## Development

```bash
npm install
npm run dev          # Vite watch mode (hot reload)
npm run build        # Type-check + production build
npm run test         # Run test suite
```
