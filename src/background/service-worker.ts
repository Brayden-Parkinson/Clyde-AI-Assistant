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
  MEMORY_TTL_MS,
  WORK_PATTERN_TTL_MS,
  WEEKLY_DIGEST_TTL_MS,
  CALENDAR_CACHE_TTL_MS,
  CHAT_HISTORY_TTL_MS,
  DAILY_REVIEW_TTL_MS,
  ACTION_PROPOSAL_TTL_MS,
  DRAFT_TTL_MS,
  FOLLOW_UP_RULE_TTL_MS,
  SYNC_OUTBOX_TTL_MS,
  FOCUS_SESSION_TTL_MS,
} from "@shared/constants";
import type { SlackMessagePayload, GmailMessagePayload } from "@shared/types";
import { logStatus, updateStatus } from "@shared/status";
import { getUserProfile } from "@shared/user-profile";
import { addMessages, flush, addGmailMessages, flushGmail } from "./batcher";
import { pollGranola } from "./granola-poller";
import { pollVoiceInbox } from "./voice-inbox";
import { isGranolaConnected, sendNative } from "./granola-local";
import { restoreFromBackup, executeBackupSave, requestBackupSave, BACKUP_SAVE_ALARM } from "./backup-sync";
import { generateMorningBrief } from "./morning-brief";
import { backfillTags } from "./tag-backfill";
import { backfillPeopleFromHistory } from "./people-extractor";
import { runConfidenceTuner } from "./confidence-tuner";
import { extractMemories, decayMemories } from "./memory-engine";
import { detectPatterns } from "./pattern-detector";
import { generateWeeklyDigest } from "./weekly-digest";
import { initSyncHooks, syncPush } from "./sync-engine";
import { fetchAndCacheCalendarEvents } from "./google-calendar";
import { initiateGoogleOAuth, disconnectGoogle } from "./google-auth";
import { syncGitHubData } from "./githubSync";
import { syncJiraData, linkPRsToJira } from "./jiraSync";

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
    // Clean up all related records for deleted commitments
    await db.kanban_assignments.where("commitment_id").anyOf(deletedCommitmentIds).delete();
    await db.action_log.where("commitmentId").anyOf(deletedCommitmentIds).delete();
    await db.completion_suggestions.where("commitmentId").anyOf(deletedCommitmentIds).delete();
    await db.follow_up_rules.where("commitmentId").anyOf(deletedCommitmentIds).delete();
    await db.commitment_okr_links.where("commitmentId").anyOf(deletedCommitmentIds).delete();
    // Clean up action_proposals and their linked drafts
    const orphanedProposals: number[] = [];
    await db.action_proposals
      .where("commitmentId").anyOf(deletedCommitmentIds)
      .each((p) => { if (p.id != null) orphanedProposals.push(p.id); });
    if (orphanedProposals.length > 0) {
      await db.drafts.where("proposalId").anyOf(orphanedProposals).delete();
      await db.action_proposals.bulkDelete(orphanedProposals);
    }
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

  // Phase 3: Memories — decay + TTL cleanup
  await decayMemories().catch((err) =>
    console.warn("[CT:worker] Memory decay failed:", err),
  );
  const memoryCutoff = new Date(now - MEMORY_TTL_MS).toISOString();
  await db.memories.where("lastReinforced").below(memoryCutoff).delete();

  // Phase 3: Work patterns — TTL cleanup
  const patternCutoff = new Date(now - WORK_PATTERN_TTL_MS).toISOString();
  await db.work_patterns.where("createdAt").below(patternCutoff).delete();

  // Phase 3: Weekly digests — TTL cleanup
  const digestCutoff = new Date(now - WEEKLY_DIGEST_TTL_MS).toISOString();
  await db.weekly_digests.where("createdAt").below(digestCutoff).delete();

  // Calendar cache: 7 days
  const calendarCutoff = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  await db.calendar_cache.where("fetchedAt").below(calendarCutoff).delete();

  // Chat messages: 90 days
  const chatCutoff = new Date(now - CHAT_HISTORY_TTL_MS).toISOString();
  await db.chat_messages.where("createdAt").below(chatCutoff).delete();
  // Orphaned chat sessions: sessions with no remaining messages (including empty sessions)
  const allSessions = await db.chat_sessions.toArray();
  for (const session of allSessions) {
    if (session.id == null) continue;
    const msgCount = await db.chat_messages.where("sessionId").equals(session.id).count();
    if (msgCount === 0) await db.chat_sessions.delete(session.id);
  }

  // Daily reviews: 90 days
  const reviewCutoff = new Date(now - DAILY_REVIEW_TTL_MS).toISOString();
  await db.daily_reviews.where("createdAt").below(reviewCutoff).delete();

  // Phase 2: ActionProposals — 30 days for completed/dismissed
  const proposalCutoff = new Date(now - ACTION_PROPOSAL_TTL_MS).toISOString();
  await db.action_proposals
    .where('status').anyOf('completed', 'dismissed')
    .filter((p) => p.updatedAt < proposalCutoff)
    .delete();

  // Phase 2: Drafts — 7 days for sent/discarded
  const draftCutoff = new Date(now - DRAFT_TTL_MS).toISOString();
  await db.drafts
    .where('status').anyOf('sent', 'discarded')
    .filter((d) => d.updatedAt < draftCutoff)
    .delete();

  // Phase 2: Follow-up rules — 90 days for completed
  const followUpCutoff = new Date(now - FOLLOW_UP_RULE_TTL_MS).toISOString();
  await db.follow_up_rules
    .where('status').equals('completed')
    .filter((r) => r.createdAt < followUpCutoff)
    .delete();

  // Sync outbox: 7 days
  const syncCutoff = new Date(now - SYNC_OUTBOX_TTL_MS).toISOString();
  await db.sync_outbox.where("timestamp").below(syncCutoff).delete();

  // Focus sessions: 90 days for completed/abandoned
  const focusCutoff = new Date(now - FOCUS_SESSION_TTL_MS).toISOString();
  await db.focus_sessions
    .where("status").anyOf("completed", "abandoned")
    .filter((s) => s.createdAt < focusCutoff)
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

  chrome.alarms.create(ALARMS.CALENDAR_SYNC, {
    delayInMinutes: 1,
    periodInMinutes: 15,
  });

  // Phase 3: Weekly alarms for memory, patterns, digest
  chrome.alarms.create(ALARMS.MEMORY_EXTRACTION, {
    delayInMinutes: 60,
    periodInMinutes: 7 * 24 * 60, // weekly
  });
  chrome.alarms.create(ALARMS.PATTERN_DETECTION, {
    delayInMinutes: 120,
    periodInMinutes: 7 * 24 * 60, // weekly
  });
  chrome.alarms.create(ALARMS.WEEKLY_DIGEST, {
    delayInMinutes: 180,
    periodInMinutes: 7 * 24 * 60, // weekly
  });
  // Phase 2: Follow-up check every 2 hours
  chrome.alarms.create(ALARMS.FOLLOW_UP_CHECK, {
    delayInMinutes: 5,
    periodInMinutes: 120,
  });

  // Eng Stats: GitHub sync every 6 hours
  chrome.alarms.create(ALARMS.GITHUB_SYNC, {
    delayInMinutes: 10,
    periodInMinutes: 360,
  });
  // Eng Stats: Jira sync every 6 hours
  chrome.alarms.create(ALARMS.JIRA_SYNC, {
    delayInMinutes: 15,
    periodInMinutes: 360,
  });

  await scheduleMorningDigestAlarm();
  updateBadge();

  // Initialize sync hooks (registers Dexie table hooks for outbox)
  initSyncHooks();

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

  // Seed the people table from commitment history (non-blocking, idempotent via name-match upsert)
  backfillPeopleFromHistory().catch((err) =>
    console.warn("[CT:worker] People backfill failed:", err),
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
  chrome.alarms.create(ALARMS.CALENDAR_SYNC, {
    delayInMinutes: 1,
    periodInMinutes: 15,
  });
  // Phase 3 weekly alarms
  chrome.alarms.create(ALARMS.MEMORY_EXTRACTION, { delayInMinutes: 60, periodInMinutes: 7 * 24 * 60 });
  chrome.alarms.create(ALARMS.PATTERN_DETECTION, { delayInMinutes: 120, periodInMinutes: 7 * 24 * 60 });
  chrome.alarms.create(ALARMS.WEEKLY_DIGEST, { delayInMinutes: 180, periodInMinutes: 7 * 24 * 60 });
  // Phase 2: Follow-up check every 2 hours
  chrome.alarms.create(ALARMS.FOLLOW_UP_CHECK, { delayInMinutes: 5, periodInMinutes: 120 });
  // Eng Stats: GitHub sync every 6 hours
  chrome.alarms.create(ALARMS.GITHUB_SYNC, { delayInMinutes: 10, periodInMinutes: 360 });
  // Eng Stats: Jira sync every 6 hours
  chrome.alarms.create(ALARMS.JIRA_SYNC, { delayInMinutes: 15, periodInMinutes: 360 });
  await scheduleMorningDigestAlarm();

  initSyncHooks();

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
    // SECURITY: Restrict sensitive actions to extension pages only (popup, options, sidepanel, newtab).
    // Content scripts run inside web page tabs (sender.tab is defined), so they must not
    // be able to trigger actions that send messages, restore backups, or execute proposals.
    const PRIVILEGED_TYPES = new Set([
      "EXECUTE_ACTION", "RESTORE_BACKUP", "SEND_DRAFT", "GENERATE_DRAFT",
      "REGENERATE_DRAFT", "SET_FOLLOW_UP", "GOOGLE_OAUTH_START", "GOOGLE_DISCONNECT",
    ]);
    if (PRIVILEGED_TYPES.has(message.type) && sender.tab) {
      sendResponse({ ok: false, error: "Privileged action rejected — request must originate from extension page, not content script" });
      logStatus("warn", "worker", `Rejected privileged message "${message.type}" from tab ${sender.tab.url?.slice(0, 60)}`);
      return false;
    }

    if (message.type === "SLACK_MESSAGES") {
      const tabInfo = sender.tab ? ` (tab: ${sender.tab.url?.slice(0, 50)})` : "";
      logStatus("info", "worker", `Received ${message.messages.length} messages from content script${tabInfo}`);
      updateStatus({ slackConnected: true, lastContentPing: new Date().toISOString() });

      addMessages(message.messages).then((result) => {
        sendResponse({ ok: true, ...(result as object) });
      });
      return true;
    } else if (message.type === "GMAIL_MESSAGES") {
      const gmailMsg = message as unknown as GmailMessagePayload;
      logStatus("info", "worker", `Received ${gmailMsg.messages.length} Gmail messages from content script`);
      addGmailMessages(gmailMsg.messages).then(() => {
        sendResponse({ ok: true });
      }).catch((err: unknown) => {
        sendResponse({ ok: false, error: String(err) });
      });
      return true;
    } else if (message.type === "GMAIL_CONTENT_SCRIPT_READY") {
      logStatus("success", "content", `Gmail content script loaded on ${sender.tab?.url?.slice(0, 60) ?? "unknown tab"}`);
      sendResponse({ ok: true });
      return false;
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

            // Restore chrome.storage settings — strip sensitive keys to prevent backup poisoning
            const chromeStorage = state.chrome_storage as Record<string, unknown> | undefined;
            if (chromeStorage) {
              const SENSITIVE_KEYS = new Set(["anthropicApiKey", "slackBotToken", "googleAuthTokens", "githubToken"]);
              const safeStorage: Record<string, unknown> = {};
              for (const [k, v] of Object.entries(chromeStorage)) {
                if (!SENSITIVE_KEYS.has(k)) safeStorage[k] = v;
              }
              await chrome.storage.local.set(safeStorage);
              steps.push(`storage: ${Object.keys(safeStorage).length} keys (${Object.keys(chromeStorage).length - Object.keys(safeStorage).length} sensitive stripped)`);
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
    } else if (message.type === "SCAN_PEOPLE") {
      backfillPeopleFromHistory()
        .then(() => sendResponse({ ok: true }))
        .catch((err) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }));
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
    } else if (message.type === "EXTRACT_MEMORIES") {
      extractMemories()
        .then(() => sendResponse({ ok: true }))
        .catch((err) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }));
      return true;
    } else if (message.type === "DETECT_PATTERNS") {
      detectPatterns()
        .then(() => sendResponse({ ok: true }))
        .catch((err) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }));
      return true;
    } else if (message.type === "GENERATE_DIGEST") {
      generateWeeklyDigest()
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
    } else if (message.type === "GOOGLE_OAUTH_START") {
      initiateGoogleOAuth()
        .then(() => sendResponse({ ok: true }))
        .catch((err) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }));
      return true;
    } else if (message.type === "GOOGLE_DISCONNECT") {
      disconnectGoogle()
        .then(() => sendResponse({ ok: true }))
        .catch((err) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }));
      return true;
    } else if (message.type === "EXECUTE_ACTION") {
      const { proposalId } = (message as unknown) as { proposalId: number; type: string };
      import("./action-executor").then(({ executeAction }) => executeAction(proposalId))
        .then((result) => sendResponse(result))
        .catch((err) => sendResponse({ ok: false, message: err instanceof Error ? err.message : String(err) }));
      return true;
    } else if (message.type === "GENERATE_DRAFT") {
      const { input } = (message as unknown) as { input: Record<string, unknown>; type: string };
      import("./draft-generator").then(({ generateDraft }) => generateDraft(input as unknown as Parameters<typeof generateDraft>[0]))
        .then((result) => sendResponse({ ok: true, ...result }))
        .catch((err) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }));
      return true;
    } else if (message.type === "REGENERATE_DRAFT") {
      const { draftId, tone, instruction } = (message as unknown) as { draftId: number; tone: string; instruction: string | null; type: string };
      import("./draft-generator").then(({ regenerateDraft }) => regenerateDraft(draftId, tone as import("@shared/types").DraftTone, instruction))
        .then((body) => sendResponse({ ok: true, body }))
        .catch((err) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }));
      return true;
    } else if (message.type === "SET_FOLLOW_UP") {
      const { commitmentId, checkAt } = (message as unknown) as { commitmentId: number; checkAt?: string; type: string };
      import("./follow-up-engine").then(({ setFollowUpRule }) => setFollowUpRule(commitmentId, checkAt))
        .then((ruleId) => sendResponse({ ok: true, ruleId }))
        .catch((err) => sendResponse({ ok: false, error: String(err) }));
      return true;
    } else if (message.type === "GITHUB_SYNC") {
      syncGitHubData()
        .then((result) => {
          // After GitHub sync, run the PR-Jira linker too
          linkPRsToJira().catch(() => {});
          sendResponse({ ok: true, ...result });
        })
        .catch((err) => sendResponse({ ok: false, error: String(err) }));
      return true;
    } else if (message.type === "JIRA_SYNC") {
      syncJiraData()
        .then((result) => sendResponse({ ok: true, ...result }))
        .catch((err) => sendResponse({ ok: false, error: String(err) }));
      return true;
    } else if (message.type === "SEND_DRAFT") {
      const { draftId } = (message as unknown) as { draftId: number; type: string };
      (async () => {
        const draft = await db.drafts.get(draftId);
        if (!draft) { sendResponse({ ok: false, error: "Draft not found" }); return; }
        const { createProposal, executeAction } = await import("./action-executor");
        const proposalId = await createProposal(
          draft.commitmentId, "send_message",
          `Send ${draft.platform === "slack" ? "Slack message" : "email"} to ${draft.recipient}`,
          { platform: draft.platform, recipient: draft.recipient, subject: draft.subject, draftId },
          "manual",
        );
        const result = await executeAction(proposalId);
        sendResponse(result);
      })().catch((err) => sendResponse({ ok: false, message: err instanceof Error ? err.message : String(err) }));
      return true;
    } else if (message.type === "FOCUS_START") {
      const { commitmentId, targetMinutes } = (message as unknown) as { commitmentId: number | null; targetMinutes: number; type: string };
      (async () => {
        // Abandon any existing active session
        const existing = await db.focus_sessions.where("status").equals("active").first();
        if (existing?.id) {
          const elapsed = Math.round((Date.now() - new Date(existing.startedAt).getTime()) / 60_000);
          await db.focus_sessions.update(existing.id, {
            status: "abandoned",
            endedAt: new Date().toISOString(),
            actualMinutes: elapsed,
          });
        }
        const now = new Date().toISOString();
        const id = await db.focus_sessions.add({
          commitmentId,
          targetMinutes,
          startedAt: now,
          endedAt: null,
          actualMinutes: null,
          status: "active",
          note: null,
          createdAt: now,
        });
        // Set alarm for when session ends
        chrome.alarms.create(ALARMS.FOCUS_TIMER, { delayInMinutes: targetMinutes });
        logStatus("info", "worker", `Focus session started: ${targetMinutes}min${commitmentId ? ` (commitment ${commitmentId})` : ""}`);
        sendResponse({ ok: true, sessionId: id });
      })().catch((err) => sendResponse({ ok: false, error: String(err) }));
      return true;
    } else if (message.type === "FOCUS_STOP") {
      const { note } = (message as unknown) as { note?: string; type: string };
      (async () => {
        const active = await db.focus_sessions.where("status").equals("active").first();
        if (!active?.id) { sendResponse({ ok: false, error: "No active session" }); return; }
        const elapsed = Math.round((Date.now() - new Date(active.startedAt).getTime()) / 60_000);
        await db.focus_sessions.update(active.id, {
          status: "completed",
          endedAt: new Date().toISOString(),
          actualMinutes: Math.min(elapsed, active.targetMinutes),
          note: note || null,
        });
        chrome.alarms.clear(ALARMS.FOCUS_TIMER);
        logStatus("info", "worker", `Focus session stopped after ${elapsed}min`);
        sendResponse({ ok: true, actualMinutes: elapsed });
      })().catch((err) => sendResponse({ ok: false, error: String(err) }));
      return true;
    } else if (message.type === "FOCUS_ABANDON") {
      (async () => {
        const active = await db.focus_sessions.where("status").equals("active").first();
        if (!active?.id) { sendResponse({ ok: false, error: "No active session" }); return; }
        const elapsed = Math.round((Date.now() - new Date(active.startedAt).getTime()) / 60_000);
        await db.focus_sessions.update(active.id, {
          status: "abandoned",
          endedAt: new Date().toISOString(),
          actualMinutes: elapsed,
        });
        chrome.alarms.clear(ALARMS.FOCUS_TIMER);
        logStatus("info", "worker", `Focus session abandoned after ${elapsed}min`);
        sendResponse({ ok: true });
      })().catch((err) => sendResponse({ ok: false, error: String(err) }));
      return true;
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
    case "gmail-batcher-flush":
      logStatus("info", "batcher", "Gmail batch flush alarm fired");
      flushGmail();
      break;
    case BACKUP_SAVE_ALARM:
      executeBackupSave();
      break;
    case ALARMS.PERIODIC_BACKUP:
      executeBackupSave();
      break;
    case ALARMS.CALENDAR_SYNC:
      fetchAndCacheCalendarEvents().catch((err) =>
        console.warn("[CT:worker] Calendar sync failed:", err),
      );
      break;
    case ALARMS.MEMORY_EXTRACTION:
      extractMemories().catch((err) => console.warn("[CT:worker] Memory extraction failed:", err));
      break;
    case ALARMS.PATTERN_DETECTION:
      detectPatterns().catch((err) => console.warn("[CT:worker] Pattern detection failed:", err));
      break;
    case ALARMS.WEEKLY_DIGEST:
      generateWeeklyDigest().catch((err) => console.warn("[CT:worker] Weekly digest failed:", err));
      break;
    case ALARMS.SYNC_PUSH:
      syncPush().catch((err) => console.warn("[CT:worker] Sync push failed:", err));
      break;
    case ALARMS.FOLLOW_UP_CHECK:
      import("./follow-up-engine").then(({ runFollowUpCheck }) => runFollowUpCheck())
        .catch((err) => console.warn("[CT:worker] Follow-up check failed:", err));
      break;
    case ALARMS.GITHUB_SYNC:
      syncGitHubData()
        .then(() => linkPRsToJira())
        .catch((err) => console.warn("[CT:worker] GitHub sync failed:", err));
      break;
    case ALARMS.JIRA_SYNC:
      syncJiraData()
        .catch((err) => console.warn("[CT:worker] Jira sync failed:", err));
      break;
    case ALARMS.FOCUS_TIMER:
      // Focus session timer expired — complete the active session
      (async () => {
        const active = await db.focus_sessions.where("status").equals("active").first();
        if (!active || !active.id) return;
        const now = new Date().toISOString();
        await db.focus_sessions.update(active.id, {
          status: "completed",
          endedAt: now,
          actualMinutes: active.targetMinutes,
        });
        // Notify user
        chrome.notifications.create(`focus-done-${active.id}`, {
          type: "basic",
          iconUrl: chrome.runtime.getURL("assets/icon-128.png"),
          title: "Focus session complete",
          message: `${active.targetMinutes} minutes of deep work — nice!`,
          priority: 2,
        });
        logStatus("info", "worker", `Focus session ${active.id} completed (${active.targetMinutes}min)`);
      })().catch((err) => console.warn("[CT:worker] Focus timer handler failed:", err));
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
