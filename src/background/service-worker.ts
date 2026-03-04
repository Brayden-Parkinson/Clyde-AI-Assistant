import { db, getNewCommitmentCount } from "@shared/db";
import {
  ALARMS,
  DEFAULTS,
  RAW_MESSAGE_TTL_MS,
  COMPLETED_COMMITMENT_TTL_MS,
} from "@shared/constants";
import type { SlackMessagePayload } from "@shared/types";
import { addMessages, flush } from "./batcher";
import { pollGranola } from "./granola-poller";

// ─── Badge ───

/** Update the extension badge with the count of 'new' commitments */
export async function updateBadge(): Promise<void> {
  const count = await getNewCommitmentCount();
  const text = count > 0 ? String(count) : "";
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color: "#2b67db" });
}

// ─── Morning Digest ───

async function fireMorningDigest(): Promise<void> {
  const active = await db.commitments
    .where("status")
    .anyOf("new", "snoozed", "actioned")
    .toArray();

  if (active.length === 0) return;

  const highCount = active.filter((c) => c.urgency === "high").length;
  const urgentSuffix = highCount > 0 ? ` (${highCount} urgent)` : "";

  chrome.notifications.create("morning-digest", {
    type: "basic",
    iconUrl: chrome.runtime.getURL("assets/icon-128.png"),
    title: "Commitment Tracker - Morning Digest",
    message: `You have ${active.length} open commitment${active.length === 1 ? "" : "s"}${urgentSuffix}`,
    priority: 1,
  });
}

// ─── Cleanup ───

async function runCleanup(): Promise<void> {
  const now = Date.now();

  // Delete raw_messages older than 7 days
  const rawCutoff = new Date(now - RAW_MESSAGE_TTL_MS).toISOString();
  await db.raw_messages.where("capturedAt").below(rawCutoff).delete();

  // Delete done/dismissed commitments older than 30 days
  const commitmentCutoff = new Date(now - COMPLETED_COMMITMENT_TTL_MS).toISOString();
  await db.commitments
    .where("status")
    .anyOf("done", "dismissed")
    .filter((c) => c.createdAt < commitmentCutoff)
    .delete();
}

// ─── Snooze Wakeup ───

async function handleSnoozeWakeup(alarmName: string): Promise<void> {
  // Alarm name format: "snooze-{commitmentId}"
  const idStr = alarmName.replace(ALARMS.SNOOZE_PREFIX, "");
  const commitmentId = parseInt(idStr, 10);
  if (isNaN(commitmentId)) return;

  const commitment = await db.commitments.get(commitmentId);
  if (!commitment || commitment.status !== "snoozed") return;

  // Un-snooze: set back to "new" so it reappears
  await db.commitments.update(commitmentId, {
    status: "new",
    snooze_until: null,
  });

  chrome.notifications.create(`snooze-wake-${commitmentId}`, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("assets/icon-128.png"),
    title: "Snoozed Commitment",
    message: commitment.text,
    priority: 1,
  });

  await updateBadge();
}

// ─── Alarm Scheduling ───

function scheduleMorningDigestAlarm(): void {
  // Calculate ms until next 8:00 AM in configured timezone
  const now = new Date();
  const tz = DEFAULTS.timezone;

  // Get current time in the target timezone
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const currentHour = parseInt(parts.find((p) => p.type === "hour")!.value, 10);
  const currentMinute = parseInt(parts.find((p) => p.type === "minute")!.value, 10);

  const targetHour = DEFAULTS.morningDigestHour;
  const targetMinute = DEFAULTS.morningDigestMinute;

  let delayMinutes: number;
  const currentTotalMinutes = currentHour * 60 + currentMinute;
  const targetTotalMinutes = targetHour * 60 + targetMinute;

  if (currentTotalMinutes < targetTotalMinutes) {
    delayMinutes = targetTotalMinutes - currentTotalMinutes;
  } else {
    // Schedule for tomorrow
    delayMinutes = 24 * 60 - currentTotalMinutes + targetTotalMinutes;
  }

  chrome.alarms.create(ALARMS.MORNING_DIGEST, {
    delayInMinutes: delayMinutes,
    periodInMinutes: 24 * 60, // Repeat daily
  });
}

// ─── Extension Lifecycle ───

chrome.runtime.onInstalled.addListener(() => {
  // Set up recurring alarms
  chrome.alarms.create(ALARMS.GRANOLA_POLL, {
    delayInMinutes: 1, // First poll 1 minute after install
    periodInMinutes: DEFAULTS.granolaPollFrequencyMin,
  });

  chrome.alarms.create(ALARMS.CLEANUP, {
    delayInMinutes: 5,
    periodInMinutes: 24 * 60, // Once daily
  });

  scheduleMorningDigestAlarm();

  // Initial badge update
  updateBadge();
});

// Also update badge on startup (service worker wake)
chrome.runtime.onStartup.addListener(() => {
  updateBadge();
});

// ─── Message Handling ───

chrome.runtime.onMessage.addListener(
  (
    message: SlackMessagePayload,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ) => {
    if (message.type === "SLACK_MESSAGES") {
      addMessages(message.messages);
      sendResponse({ ok: true, buffered: message.messages.length });
    }
    // Return false for synchronous response
    return false;
  },
);

// ─── Alarm Routing ───

chrome.alarms.onAlarm.addListener((alarm) => {
  switch (alarm.name) {
    case ALARMS.GRANOLA_POLL:
      pollGranola();
      break;
    case ALARMS.MORNING_DIGEST:
      fireMorningDigest();
      break;
    case ALARMS.CLEANUP:
      runCleanup();
      break;
    default:
      // Check for snooze wakeup alarms
      if (alarm.name.startsWith(ALARMS.SNOOZE_PREFIX)) {
        handleSnoozeWakeup(alarm.name);
      }
      break;
  }
});

// ─── Notification Click ───

chrome.notifications.onClicked.addListener((_notificationId) => {
  // Open the popup/side panel when a notification is clicked
  chrome.action.openPopup();
});

// Flush any remaining batched messages when the service worker is about to stop
// (best-effort; service workers can be terminated at any time)
self.addEventListener("activate", () => {
  updateBadge();
});
