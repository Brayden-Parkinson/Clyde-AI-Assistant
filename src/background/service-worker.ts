import { db, getNewCommitmentCount } from "@shared/db";
import {
  ALARMS,
  DEFAULTS,
  RAW_MESSAGE_TTL_MS,
  COMPLETED_COMMITMENT_TTL_MS,
} from "@shared/constants";
import type { SlackMessagePayload } from "@shared/types";
import { logStatus, updateStatus } from "@shared/status";
import { getUserProfile } from "@shared/user-profile";
import { addMessages, flush } from "./batcher";
import { pollGranola } from "./granola-poller";
import { isGranolaConnected } from "./granola-local";
import { restoreFromBackup, executeBackupSave, requestBackupSave, BACKUP_SAVE_ALARM } from "./backup-sync";
import { generateMorningBrief } from "./morning-brief";

// ─── Badge ───

export async function updateBadge(): Promise<void> {
  const count = await getNewCommitmentCount();
  const text = count > 0 ? String(count) : "";
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color: "#2b67db" });
}

// ─── Cleanup ───

async function runCleanup(): Promise<void> {
  const now = Date.now();
  const rawCutoff = new Date(now - RAW_MESSAGE_TTL_MS).toISOString();
  await db.raw_messages.where("capturedAt").below(rawCutoff).delete();

  const commitmentCutoff = new Date(now - COMPLETED_COMMITMENT_TTL_MS).toISOString();
  await db.commitments
    .where("status")
    .anyOf("done", "dismissed")
    .filter((c) => c.createdAt < commitmentCutoff)
    .delete();

  await logStatus("info", "worker", "Daily cleanup completed");
}

// ─── Snooze Wakeup ───

async function handleSnoozeWakeup(alarmName: string): Promise<void> {
  const idStr = alarmName.replace(ALARMS.SNOOZE_PREFIX, "");
  const commitmentId = parseInt(idStr, 10);
  if (isNaN(commitmentId)) return;

  const commitment = await db.commitments.get(commitmentId);
  if (!commitment || commitment.status !== "snoozed") return;

  await db.commitments.update(commitmentId, {
    status: "new",
    snooze_until: null,
  });

  chrome.notifications.create(`snooze-wake-${commitmentId}`, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("assets/icon-128.png"),
    title: "Snoozed",
    message: commitment.text,
    priority: 1,
  });

  await updateBadge();
  await logStatus("info", "worker", `Snooze expired: "${commitment.text}"`);
}

// ─── Reminder Wakeup ───

async function handleReminderWakeup(alarmName: string): Promise<void> {
  const idStr = alarmName.replace("reminder-", "");
  const commitmentId = parseInt(idStr, 10);
  if (isNaN(commitmentId)) return;

  const commitment = await db.commitments.get(commitmentId);
  if (!commitment) return;

  chrome.notifications.create(`reminder-${commitmentId}`, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("assets/icon-128.png"),
    title: "Reminder",
    message: commitment.text,
    priority: 2,
  });

  await logStatus("info", "worker", `Reminder fired: "${commitment.text}"`);
}

// ─── Alarm Scheduling ───

async function scheduleMorningDigestAlarm(): Promise<void> {
  const now = new Date();
  const profile = await getUserProfile();
  const tz = profile.timezone;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const currentHour = parseInt(parts.find((p) => p.type === "hour")!.value, 10);
  const currentMinute = parseInt(parts.find((p) => p.type === "minute")!.value, 10);

  // Read user-configured time from chrome.storage (saved as "HH:MM" by Options.tsx)
  const result = await chrome.storage.local.get("morningDigestTime");
  const timeString = result.morningDigestTime as string | undefined;
  let targetHour: number;
  let targetMinute: number;
  if (timeString && timeString.includes(":")) {
    [targetHour, targetMinute] = timeString.split(":").map(Number);
  } else {
    targetHour = DEFAULTS.morningDigestHour;
    targetMinute = DEFAULTS.morningDigestMinute;
  }

  let delayMinutes: number;
  const currentTotalMinutes = currentHour * 60 + currentMinute;
  const targetTotalMinutes = targetHour * 60 + targetMinute;

  if (currentTotalMinutes < targetTotalMinutes) {
    delayMinutes = targetTotalMinutes - currentTotalMinutes;
  } else {
    delayMinutes = 24 * 60 - currentTotalMinutes + targetTotalMinutes;
  }

  chrome.alarms.create(ALARMS.MORNING_DIGEST, {
    delayInMinutes: delayMinutes,
    periodInMinutes: 24 * 60,
  });
}

// ─── UI Mode: popup vs side panel ───

async function applyUiMode(): Promise<void> {
  const result = await chrome.storage.local.get("uiMode");
  const mode = result.uiMode ?? DEFAULTS.uiMode;

  if (mode === "sidepanel") {
    await chrome.sidePanel.setOptions({ enabled: true, path: "src/sidepanel/index.html" });
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } else {
    // Disable the side panel entirely so action.onClicked fires instead
    await chrome.sidePanel.setOptions({ enabled: false });
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
  }
}

// When side panel is disabled, icon click opens a tab
chrome.action.onClicked.addListener(async () => {
  await chrome.tabs.create({ url: chrome.runtime.getURL("src/newtab/index.html") });
});


// ─── Extension Lifecycle ───

chrome.runtime.onInstalled.addListener(async () => {
  // Restore backup before anything else — data may be needed for alarms/badge
  await restoreFromBackup();
  await applyUiMode();

  chrome.alarms.create(ALARMS.GRANOLA_POLL, {
    delayInMinutes: 1,
    periodInMinutes: DEFAULTS.granolaPollFrequencyMin,
  });

  chrome.alarms.create(ALARMS.CLEANUP, {
    delayInMinutes: 5,
    periodInMinutes: 24 * 60,
  });

  await scheduleMorningDigestAlarm();
  updateBadge();

  // Check API key status
  const result = await chrome.storage.local.get("anthropicApiKey");
  const hasKey = !!result.anthropicApiKey;
  await updateStatus({ hasApiKey: hasKey });
  await logStatus("info", "worker", `Extension installed/updated. API key: ${hasKey ? "configured" : "NOT SET"}`);
});

chrome.runtime.onStartup.addListener(async () => {
  await restoreFromBackup();
  await applyUiMode();
  updateBadge();
  const result = await chrome.storage.local.get("anthropicApiKey");
  await updateStatus({ hasApiKey: !!result.anthropicApiKey });
  await logStatus("info", "worker", "Service worker started");
});

// ─── Message Handling ───

chrome.runtime.onMessage.addListener(
  (
    message: SlackMessagePayload & { type: string },
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ) => {
    if (message.type === "SLACK_MESSAGES") {
      const tabInfo = sender.tab ? ` (tab: ${sender.tab.url?.slice(0, 50)})` : "";
      logStatus("info", "worker", `Received ${message.messages.length} messages from content script${tabInfo}`);
      updateStatus({ slackConnected: true, lastContentPing: new Date().toISOString() });

      addMessages(message.messages).then((result) => {
        sendResponse({ ok: true, ...(result as object) });
      });
      return true;
    } else if (message.type === "MANUAL_FLUSH") {
      logStatus("info", "worker", "Manual scan triggered");
      Promise.all([flush(), pollGranola()]).then(() => {
        updateBadge();
        sendResponse({ ok: true });
      });
      return true;
    } else if (message.type === "GET_STATUS") {
      // UI requesting pipeline status
      sendResponse({ ok: true });
      return false;
    } else if (message.type === "CONTENT_SCRIPT_READY") {
      logStatus("success", "content", `Slack content script loaded on ${sender.tab?.url?.slice(0, 60) ?? "unknown tab"}`);
      updateStatus({ slackConnected: true, lastContentPing: new Date().toISOString() });
      sendResponse({ ok: true });
      return false;
    } else if (message.type === "GRANOLA_STATUS") {
      isGranolaConnected()
        .then((connected) => sendResponse({ connected }))
        .catch((err) => sendResponse({
          connected: false,
          error: err instanceof Error ? err.message : "Native host not responding",
        }));
      return true;
    } else if (message.type === "GENERATE_MORNING_BRIEF") {
      generateMorningBrief(true)
        .then(() => sendResponse({ ok: true }))
        .catch((err) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }));
      return true;
    } else if (message.type === "CONTENT_DIAGNOSTICS") {
      const diag = message as unknown as { diagnostics: string[]; summary: string; displayName: string; url: string };
      logStatus("info", "content", `Diagnostics (${diag.displayName}): ${diag.summary}`);
      for (const line of diag.diagnostics) {
        const level = line.includes("NO SELECTORS") ? "warn" as const : "info" as const;
        logStatus(level, "content", line);
      }
      sendResponse({ ok: true });
      return false;
    }
    return false;
  },
);

// ─── Alarm Routing ───

chrome.alarms.onAlarm.addListener((alarm) => {
  switch (alarm.name) {
    case ALARMS.GRANOLA_POLL:
      logStatus("info", "granola", "Granola poll triggered");
      pollGranola();
      break;
    case ALARMS.MORNING_DIGEST:
      generateMorningBrief();
      break;
    case ALARMS.CLEANUP:
      runCleanup();
      break;
    case "batcher-flush":
      logStatus("info", "batcher", "Batch flush alarm fired");
      flush();
      break;
    case BACKUP_SAVE_ALARM:
      executeBackupSave();
      break;
    default:
      if (alarm.name.startsWith(ALARMS.SNOOZE_PREFIX)) {
        handleSnoozeWakeup(alarm.name);
      } else if (alarm.name.startsWith("reminder-")) {
        handleReminderWakeup(alarm.name);
      }
      break;
  }
});

// ─── Notification Click ───

chrome.notifications.onClicked.addListener((_notificationId) => {
  chrome.tabs.create({ url: chrome.runtime.getURL("src/newtab/index.html") });
});

// ─── Storage Change → Backup ───

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local") {
    requestBackupSave();
    if (changes.uiMode) {
      applyUiMode();
    }
  }
});
