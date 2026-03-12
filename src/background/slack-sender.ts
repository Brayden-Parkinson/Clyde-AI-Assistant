/**
 * slack-sender.ts
 * Sends messages to Slack via the Bot Token API.
 *
 * SECURITY: This file ONLY sends messages when explicitly called by an
 * approved ActionProposal. The slackBotToken is read from chrome.storage.local
 * and is never logged.
 *
 * Requires: Slack Bot Token with chat:write scope.
 * Token key: chrome.storage.local "slackBotToken"
 */

import { API_TIMEOUT_MS } from "@shared/constants";

export interface SlackSendResult {
  ok: boolean;
  messageTs: string | null;
  error: string | null;
}

export interface SlackConnectionResult {
  connected: boolean;
  workspaceName: string | null;
  error: string | null;
}

/** Send a message to a Slack channel via chat.postMessage */
export async function sendSlackMessage(
  channel: string,
  text: string,
): Promise<SlackSendResult> {
  const stored = await chrome.storage.local.get("slackBotToken");
  const token = stored.slackBotToken as string | undefined;

  if (!token) {
    return { ok: false, messageTs: null, error: "Slack Bot Token not configured — add it in Settings → Integrations" };
  }

  try {
    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({ channel, text }),
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });

    const data = await response.json() as { ok: boolean; ts?: string; error?: string };

    if (!data.ok) {
      return { ok: false, messageTs: null, error: data.error ?? "Slack API returned error" };
    }

    return { ok: true, messageTs: data.ts ?? null, error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, messageTs: null, error: `Slack request failed: ${msg}` };
  }
}

/** Check if the configured Slack bot token is valid. */
export async function checkSlackConnection(): Promise<SlackConnectionResult> {
  const stored = await chrome.storage.local.get("slackBotToken");
  const token = stored.slackBotToken as string | undefined;

  if (!token) {
    return { connected: false, workspaceName: null, error: "No Slack Bot Token configured" };
  }

  try {
    const response = await fetch("https://slack.com/api/auth.test", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(10_000),
    });

    const data = await response.json() as { ok: boolean; team?: string; error?: string };

    if (!data.ok) {
      return { connected: false, workspaceName: null, error: data.error ?? "Token validation failed" };
    }

    return { connected: true, workspaceName: data.team ?? null, error: null };
  } catch (err) {
    return { connected: false, workspaceName: null, error: err instanceof Error ? err.message : String(err) };
  }
}
