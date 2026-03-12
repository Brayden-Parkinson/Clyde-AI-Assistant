/**
 * gmail-sender.ts
 * Creates email DRAFTS in Gmail via the Gmail API.
 *
 * SECURITY: This file only creates DRAFTS — it NEVER calls the Gmail send API.
 * The user must open Gmail and manually review and send the draft.
 * Uses Google OAuth tokens from google-auth.ts.
 *
 * Required OAuth scope: https://www.googleapis.com/auth/gmail.compose
 */

import { API_TIMEOUT_MS } from "@shared/constants";
import { getValidAccessToken } from "./google-auth";

export interface GmailDraftResult {
  ok: boolean;
  draftId: string | null;      // Gmail's draft ID
  draftUrl: string | null;
  error: string | null;
}

/**
 * Create a Gmail DRAFT (never sends — user reviews and sends from Gmail).
 * Body is treated as plain text.
 */
export async function createGmailDraft(
  to: string,
  subject: string,
  body: string,
): Promise<GmailDraftResult> {
  let accessToken: string;
  try {
    accessToken = await getValidAccessToken();
  } catch (err) {
    return {
      ok: false,
      draftId: null,
      draftUrl: null,
      error: `Google not connected — ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Build RFC 2822 MIME message
  const rawMessage = buildMimeMessage(to, subject, body);
  const encoded = btoa(rawMessage)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  try {
    const response = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/drafts",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message: { raw: encoded } }),
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      },
    );

    if (!response.ok) {
      const errText = await response.text();
      if (response.status === 403) {
        return {
          ok: false,
          draftId: null,
          draftUrl: null,
          error: "Gmail scope not authorized — reconnect Google with gmail.compose permission",
        };
      }
      return {
        ok: false,
        draftId: null,
        draftUrl: null,
        error: `Gmail API error (${response.status}): ${errText.slice(0, 200)}`,
      };
    }

    const data = await response.json() as { id: string; message: { id: string } };
    const draftUrl = `https://mail.google.com/mail/u/0/#drafts/${data.message.id}`;

    return { ok: true, draftId: data.id, draftUrl, error: null };
  } catch (err) {
    return {
      ok: false,
      draftId: null,
      draftUrl: null,
      error: `Gmail request failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ─── MIME Builder ───

function buildMimeMessage(to: string, subject: string, body: string): string {
  const lines = [
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 7bit",
    "",
    body,
  ];
  return lines.join("\r\n");
}
