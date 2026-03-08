import { db, getNewCommitmentCount } from "@shared/db";
import {
  ALARMS,
  DEFAULTS,
  RAW_MESSAGE_TTL_MS,
  COMPLETED_COMMITMENT_TTL_MS,
  ACTION_LOG_TTL_MS,
  BRIEFS_TTL_MS,
  COMPLETION_SUGGESTION_TTL_MS,
  DISMISSED_COMPLETION_TTL_MS,
} from "@shared/constants";
import type { SlackMessagePayload } from "@shared/types";
import { logStatus, updateStatus } from "@shared/status";
import { getUserProfile } from "@shared/user-profile";
import { addMessages, flush } from "./batcher";
import { pollGranola } from "./granola-poller";
import { pollVoiceInbox } from "./voice-inbox";
import { isGranolaConnected, sendNative } from "./granola-local";
import { restoreFromBackup, executeBackupSave, requestBackupSave, BACKUP_SAVE_ALARM } from "./backup-sync";
import { generateMorningBrief } from "./morning-brief";
import { backfillTags } from "./tag-backfill";
import { runConfidenceTuner } from "./confidence-tuner";

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

  // Raw messages: 7 days
  const rawCutoff = new Date(now - RAW_MESSAGE_TTL_MS).toISOString();
  await db.raw_messages.where("capturedAt").below(rawCutoff).delete();

  // Done/dismissed commitments: 30 days
  const commitmentCutoff = new Date(now - COMPLETED_COMMITMENT_TTL_MS).toISOString();
  const deletedCommitmentIds: number[] = [];
  await db.commitments
    .where("status")
    .anyOf("done", "dismissed")
    .filter((c) => c.createdAt < commitmentCutoff)
    .each((c) => { if (c.id !== undefined) deletedCommitmentIds.push(c.id); });
  if (deletedCommitmentIds.length > 0) {
    await db.commitments.bulkDelete(deletedCommitmentIds);
    // Clean up orphaned kanban assignments for deleted commitments
    await db.kanban_assignments.where("commitment_id").anyOf(deletedCommitmentIds).delete();
  }

  // Action log: 90 days
  const actionLogCutoff = new Date(now - ACTION_LOG_TTL_MS).toISOString();
  await db.action_log.where("createdAt").below(actionLogCutoff).delete();

  // Morning briefs: 30 days
  const briefsCutoff = new Date(now - BRIEFS_TTL_MS).toISOString();
  await db.briefs.where("createdAt").below(briefsCutoff).delete();

  // Resolved completion suggestions: 30 days
  const completionCutoff = new Date(now - COMPLETION_SUGGESTION_TTL_MS).toISOString();
  await db.completion_suggestions
    .where("status")
    .anyOf("accepted", "dismissed")
    .filter((s) => s.createdAt < completionCutoff)
    .delete();

  // Dismissed completion tracking: 90 days
  const dismissedCompletionCutoff = new Date(now - DISMISSED_COMPLETION_TTL_MS).toISOString();
  await db.dismissed_completions
    .where("lastDismissedAt")
    .below(dismissedCompletionCutoff)
    .delete();

  await logStatus("info", "worker", "Daily cleanup completed");

  // Run confidence auto-tuner after cleanup (needs recent action_log)
  await runConfidenceTuner().catch((err) =>
    console.warn("[CT:worker] Confidence tuner failed:", err),
  );
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


// ─── Restore backup on every service worker start (covers reload) ───

(async () => {
  try {
    const count = await db.commitments.count();
    if (count === 0) {
      await restoreFromBackup();
      await updateBadge();
    }
  } catch {
    // DB not ready yet — onInstalled will handle it
  }
})();

// ─── Content Script Re-injection ───

/**
 * Re-inject content scripts into already-open Slack/Google Docs tabs.
 * This is needed after extension install/reload — manifest content_scripts
 * only inject on new page loads, not into tabs that are already open.
 */
async function reinjectContentScripts(): Promise<void> {
  const manifest = chrome.runtime.getManifest();
  if (!manifest.content_scripts) return;

  for (const cs of manifest.content_scripts) {
    if (!cs.js?.length || !cs.matches?.length) continue;

    let tabs: chrome.tabs.Tab[];
    try {
      tabs = await chrome.tabs.query({ url: cs.matches });
    } catch {
      continue;
    }

    for (const tab of tabs) {
      if (!tab.id || tab.id === chrome.tabs.TAB_ID_NONE) continue;
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: cs.js,
        });
        console.log(`[CT:worker] Re-injected content script into tab ${tab.id} (${tab.url?.slice(0, 60)})`);
      } catch (err) {
        // Tab may be discarded, internal page, etc. — safe to ignore
        console.warn(`[CT:worker] Could not inject into tab ${tab.id}:`, err);
      }
    }
  }
}

// ─── Extension Lifecycle ───

chrome.runtime.onInstalled.addListener(async () => {
  // Restore backup before anything else — data may be needed for alarms/badge
  await restoreFromBackup();
  await applyUiMode();

  chrome.alarms.create(ALARMS.GRANOLA_POLL, {
    delayInMinutes: 1,
    periodInMinutes: DEFAULTS.granolaPollFrequencyMin,
  });

  chrome.alarms.create(ALARMS.VOICE_INBOX, {
    delayInMinutes: 1,
    periodInMinutes: 2, // Check every 2 minutes
  });

  chrome.alarms.create(ALARMS.CLEANUP, {
    delayInMinutes: 5,
    periodInMinutes: 24 * 60,
  });

  chrome.alarms.create(ALARMS.PERIODIC_BACKUP, {
    delayInMinutes: 15,
    periodInMinutes: 15,
  });

  await scheduleMorningDigestAlarm();
  updateBadge();

  // Check API key status
  const result = await chrome.storage.local.get("anthropicApiKey");
  const hasKey = !!result.anthropicApiKey;
  await updateStatus({ hasApiKey: hasKey });
  await logStatus("info", "worker", `Extension installed/updated. API key: ${hasKey ? "configured" : "NOT SET"}`);

  // Re-inject content scripts into already-open Slack/Docs tabs
  reinjectContentScripts();

  // Run one-time tag backfill for existing commitments (non-blocking)
  backfillTags().catch((err) =>
    console.warn("[CT:worker] Tag backfill failed:", err),
  );
});

chrome.runtime.onStartup.addListener(async () => {
  await restoreFromBackup();
  await applyUiMode();
  updateBadge();

  reinjectContentScripts();

  // Re-create alarms — they may not survive browser restarts
  chrome.alarms.create(ALARMS.GRANOLA_POLL, {
    delayInMinutes: 1,
    periodInMinutes: DEFAULTS.granolaPollFrequencyMin,
  });
  chrome.alarms.create(ALARMS.CLEANUP, {
    delayInMinutes: 5,
    periodInMinutes: 24 * 60,
  });
  chrome.alarms.create(ALARMS.VOICE_INBOX, {
    delayInMinutes: 1,
    periodInMinutes: 2,
  });
  chrome.alarms.create(ALARMS.PERIODIC_BACKUP, {
    delayInMinutes: 15,
    periodInMinutes: 15,
  });
  await scheduleMorningDigestAlarm();

  const result = await chrome.storage.local.get("anthropicApiKey");
  await updateStatus({ hasApiKey: !!result.anthropicApiKey });
  await logStatus("info", "worker", "Service worker started — alarms scheduled");

  // Run one-time tag backfill (non-blocking)
  backfillTags().catch((err) =>
    console.warn("[CT:worker] Tag backfill failed:", err),
  );
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
      Promise.all([flush(), pollGranola(true), pollVoiceInbox()]).then(() => {
        updateBadge();
        requestBackupSave();
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
    } else if (message.type === "RESTORE_BACKUP") {
      (async () => {
        const steps: string[] = [];
        try {
          steps.push(`ext_id: ${chrome.runtime.id}`);

          // Test native host first
          const ping = await sendNative({ command: "ping" });
          steps.push(`ping: ok=${ping.ok}`);

          // Load backup
          const loadResult = await sendNative({
            command: "load_state",
            extension_id: chrome.runtime.id,
          });
          const state = (loadResult as unknown as Record<string, unknown>).state as Record<string, unknown> | null;
          steps.push(`load: ok=${loadResult.ok}, hasState=${!!state}, commitments=${(state?.commitments as unknown[])?.length ?? 0}`);

          if (state) {
            // Direct DB import — bypass mergeState to avoid any dedup issues
            const commitments = (state.commitments ?? []) as Array<Record<string, unknown>>;
            const existingCount = await db.commitments.count();
            steps.push(`db_before: ${existingCount}`);

            if (commitments.length > 0) {
              // Deduplicate by hash — keep the first entry for each hash
              const byHash = new Map<string, Record<string, unknown>>();
              for (const c of commitments) {
                const hash = c.hash as string;
                if (hash && !byHash.has(hash)) byHash.set(hash, c);
              }
              const unique = [...byHash.values()];
              steps.push(`deduped: ${unique.length} from ${commitments.length}`);

              // Delete the entire database and re-open to guarantee clean state
              await db.delete();
              await db.open();
              steps.push("db wiped and reopened");

              // Now bulk-add with clean IDs
              const cleaned = unique.map(({ id: _id, ...rest }) => rest);
              await db.commitments.bulkAdd(cleaned as unknown as Parameters<typeof db.commitments.bulkAdd>[0]);
              steps.push(`added: ${cleaned.length}`);
            }

            // Restore chrome.storage settings
            const chromeStorage = state.chrome_storage as Record<string, unknown> | undefined;
            if (chromeStorage) {
              await chrome.storage.local.set(chromeStorage);
              steps.push(`storage: ${Object.keys(chromeStorage).length} keys`);
            }

            // Kanban columns
            const columns = (state.kanban_columns ?? []) as Array<Record<string, unknown>>;
            if (columns.length > 0 && (await db.kanban_columns.count()) === 0) {
              await db.kanban_columns.bulkAdd(columns as unknown as Parameters<typeof db.kanban_columns.bulkAdd>[0]);
              steps.push(`columns: ${columns.length}`);
            }

            // Kanban assignments
            const assignments = (state.kanban_assignments ?? []) as Array<Record<string, unknown>>;
            if (assignments.length > 0) {
              await db.kanban_assignments.bulkPut(assignments as unknown as Parameters<typeof db.kanban_assignments.bulkPut>[0]);
              steps.push(`assignments: ${assignments.length}`);
            }

            // Dismissals
            const dismissals = (state.dismissals ?? []) as Array<Record<string, unknown>>;
            if (dismissals.length > 0 && (await db.dismissals.count()) === 0) {
              const cleanedD = dismissals.map(({ id: _id, ...rest }) => rest);
              await db.dismissals.bulkAdd(cleanedD as unknown as Parameters<typeof db.dismissals.bulkAdd>[0]);
              steps.push(`dismissals: ${cleanedD.length}`);
            }
          }

          const finalCount = await db.commitments.count();
          steps.push(`db_after: ${finalCount}`);
          updateBadge();
          sendResponse({ ok: finalCount > 0, steps });
        } catch (err) {
          steps.push(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
          sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err), steps });
        }
      })();
      return true;
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
    } else if (message.type === "GDOCS_CONTENT_SCRIPT_READY") {
      const gdocs = message as unknown as { url: string; title: string };
      logStatus("success", "content", `Google Docs content script loaded: "${gdocs.title}" (${gdocs.url?.slice(0, 60)})`);
      sendResponse({ ok: true });
      return false;
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
    case ALARMS.VOICE_INBOX:
      pollVoiceInbox();
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
    case ALARMS.PERIODIC_BACKUP:
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
