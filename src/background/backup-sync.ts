import { db } from "@shared/db";
import type { BackupState, SlackWatermarks } from "@shared/types";
import { COMPLETED_COMMITMENT_TTL_MS } from "@shared/constants";
import { logStatus } from "@shared/status";
import { sendNative } from "./granola-local";

const BACKUP_ALARM = "backup-save";

/** Sensitive keys that must NEVER be written to disk or restored from backup */
const SENSITIVE_STORAGE_KEYS = new Set([
  "anthropicApiKey",
  "slackBotToken",
  "googleAuthTokens",
]);

/** Chrome storage keys that should be backed up */
const BACKED_UP_STORAGE_KEYS = [
  "userName",
  "userTitle",
  "userCompany",
  "timezone",
  "slackDisplayNames",
  "slackScanFrequency",
  "slackScanFrequencyMin",
  "granolaPollFrequency",
  "granolaPollFrequencyMin",
  "uiMode",
  "developerMode",
  "demoMode",
  "morningDigestTime",
  "morningBriefEnabled",
  "confidenceThreshold",
  "calendarIcsUrl",
  "slackChannelIgnoreList",
  "voiceInboxEnabled",
  "googleDocsEnabled",
  "slackEnabled",
  "granolaEnabled",
  "calendarEnabled",
] as const;

// ─── Public API ───

/**
 * Debounced backup trigger — creates a 10-second alarm.
 * Multiple calls within 10s collapse into one save.
 */
export function requestBackupSave(): void {
  chrome.alarms.create(BACKUP_ALARM, { delayInMinutes: 10 / 60 });
}

/**
 * Actually gather state and send it to the native host for persistence.
 * Called by the alarm handler when the backup-save alarm fires.
 */
export async function executeBackupSave(): Promise<void> {
  try {
    const extensionId = chrome.runtime.id;
    if (!extensionId) return;

    const state = await gatherState();

    // Pre-send size check — 1MB is the native messaging limit
    const stateJson = JSON.stringify(state);
    if (stateJson.length > 900_000) {
      // Prune conversation_messages from commitments to fit
      for (const c of state.commitments) {
        (c as unknown as Record<string, unknown>).conversation_messages = [];
      }
      await logStatus("warn", "backup", "Backup too large — stripped conversation_messages to fit");
    }

    const result = await sendNative({
      command: "save_state",
      state,
      extension_id: extensionId,
    });

    if (result.ok) {
      await logStatus("info", "backup", `Backup saved (${(result as unknown as Record<string, unknown>).size_kb}KB)`);
    } else {
      await logStatus("warn", "backup", `Backup save failed: ${result.error}`);
    }
  } catch (err) {
    // Native host not installed or unavailable — silent no-op
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[CT:backup] Save failed (native host unavailable?):", msg);
  }
}

/**
 * Restore data from a backup file on disk.
 * Called on install/startup. Only restores data that's missing locally.
 */
export async function restoreFromBackup(): Promise<void> {
  try {
    const extensionId = chrome.runtime.id;
    if (!extensionId) return;

    const result = await sendNative({
      command: "load_state",
      extension_id: extensionId,
    });

    // SECURITY: Only load backups for this exact extension ID.
    // Loading from arbitrary IDs would let a malicious extension plant a poisoned backup.
    const state = (result as unknown as Record<string, unknown>).state as BackupState | null;

    if (!result.ok) {
      await logStatus("warn", "backup", `Backup load failed: ${result.error}`);
      return;
    }

    if (!state) {
      await logStatus("info", "backup", "No backup found on disk — starting fresh");
      return;
    }

    if (state.version !== 1) {
      await logStatus("warn", "backup", `Unknown backup version ${state.version} — skipping restore`);
      return;
    }

    await logStatus("info", "backup", `Restoring from backup (saved ${state.lastSaved})`);
    await mergeState(state);
    await logStatus("success", "backup", "Backup restore complete");
  } catch (err) {
    // Native host not installed — extension works as normal
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[CT:backup] Restore failed (native host unavailable?):", msg);
  }
}

/** Name of the backup alarm, for use in service-worker alarm routing */
export const BACKUP_SAVE_ALARM = BACKUP_ALARM;

// ─── Internal ───

async function gatherState(): Promise<BackupState> {
  // Prune: skip done/dismissed older than 30 days
  const cutoff = new Date(Date.now() - COMPLETED_COMMITMENT_TTL_MS).toISOString();
  // Only load active commitments + recently completed ones (not entire table)
  const activeCommitments = await db.commitments
    .where("status").anyOf("new", "started", "blocked", "waiting")
    .toArray();
  const recentCompleted = await db.commitments
    .where("createdAt").aboveOrEqual(cutoff)
    .toArray()
    .then((all) => all.filter((c) => c.status === "done" || c.status === "dismissed"));
  const prunedCommitments = [...activeCommitments, ...recentCompleted];

  const dismissals = await db.dismissals.orderBy("count").reverse().limit(100).toArray();
  const actionLog = await db.action_log.where("createdAt").aboveOrEqual(cutoff).toArray();
  const settings = await db.settings.toArray();
  const kanbanColumns = await db.kanban_columns.toArray();
  const kanbanAssignments = await db.kanban_assignments.toArray();
  const tags = await db.tags.toArray();

  // Keep last 7 briefs
  const allBriefs = await db.briefs.orderBy("createdAt").reverse().limit(7).toArray();
  const briefs = allBriefs.reverse(); // restore chronological order

  // Gather chrome.storage.local keys
  const storageResult = await chrome.storage.local.get([
    ...BACKED_UP_STORAGE_KEYS,
    "granolaLastPoll",
    "granolaProcessedNoteIds",
    "granolaScannedThrough",
    "slackChannelWatermarks",
  ]);

  const chromeStorage: Record<string, unknown> = {};
  for (const key of BACKED_UP_STORAGE_KEYS) {
    if (storageResult[key] !== undefined) {
      chromeStorage[key] = storageResult[key];
    }
  }

  return {
    version: 1,
    lastSaved: new Date().toISOString(),
    commitments: prunedCommitments,
    dismissals,
    action_log: actionLog,
    settings_db: settings,
    kanban_columns: kanbanColumns,
    kanban_assignments: kanbanAssignments,
    tags,
    briefs,
    chrome_storage: chromeStorage,
    watermarks: {
      granolaProcessedNoteIds: (storageResult.granolaProcessedNoteIds as string[]) ?? [],
      granolaLastPoll: (storageResult.granolaLastPoll as string) ?? null,
      granolaScannedThrough: (storageResult.granolaScannedThrough as string) ?? null,
      slackChannelWatermarks: (storageResult.slackChannelWatermarks as SlackWatermarks) ?? {},
    },
  };
}

async function mergeState(state: BackupState): Promise<void> {
  // Commitments: merge by hash — skip if hash already exists locally
  if (state.commitments?.length) {
    const existingHashes = new Set(
      (await db.commitments.toArray()).map((c) => c.hash),
    );
    const toAdd = state.commitments.filter((c) => !existingHashes.has(c.hash));
    if (toAdd.length > 0) {
      // Strip auto-increment ids so Dexie assigns new ones
      const cleaned = toAdd.map(({ id: _id, ...rest }) => rest);
      await db.commitments.bulkAdd(cleaned as typeof toAdd);
      await logStatus("info", "backup", `Restored ${cleaned.length} commitments`);
    }
  }

  // Dismissals: merge by pattern — skip existing
  if (state.dismissals?.length) {
    const existingPatterns = new Set(
      (await db.dismissals.toArray()).map((d) => d.pattern),
    );
    const toAdd = state.dismissals.filter((d) => !existingPatterns.has(d.pattern));
    if (toAdd.length > 0) {
      const cleaned = toAdd.map(({ id: _id, ...rest }) => rest);
      await db.dismissals.bulkAdd(cleaned as typeof toAdd);
      await logStatus("info", "backup", `Restored ${cleaned.length} dismissals`);
    }
  }

  // Action log: bulkPut by id (idempotent)
  if (state.action_log?.length) {
    await db.action_log.bulkPut(state.action_log);
    await logStatus("info", "backup", `Restored ${state.action_log.length} action log entries`);
  }

  // Settings: bulkPut (overwrites — these are simple key-value pairs)
  if (state.settings_db?.length) {
    await db.settings.bulkPut(state.settings_db);
    await logStatus("info", "backup", `Restored ${state.settings_db.length} settings`);
  }

  // Kanban columns: restore if none exist locally
  if (state.kanban_columns?.length) {
    const existingColumns = await db.kanban_columns.count();
    if (existingColumns === 0) {
      await db.kanban_columns.bulkAdd(state.kanban_columns);
      await logStatus("info", "backup", `Restored ${state.kanban_columns.length} kanban columns`);
    }
  }

  // Kanban assignments: restore missing assignments
  if (state.kanban_assignments?.length) {
    const existingIds = new Set(
      (await db.kanban_assignments.toArray()).map((a) => a.commitment_id),
    );
    const toAdd = state.kanban_assignments.filter((a) => !existingIds.has(a.commitment_id));
    if (toAdd.length > 0) {
      await db.kanban_assignments.bulkAdd(toAdd);
      await logStatus("info", "backup", `Restored ${toAdd.length} kanban assignments`);
    }
  }

  // Tags: merge by name — skip if name already exists locally
  if (state.tags?.length) {
    const existingNames = new Set(
      (await db.tags.toArray()).map((t) => t.name),
    );
    const toAdd = state.tags.filter((t) => !existingNames.has(t.name));
    if (toAdd.length > 0) {
      const cleaned = toAdd.map(({ id: _id, ...rest }) => rest);
      await db.tags.bulkAdd(cleaned as typeof toAdd);
      await logStatus("info", "backup", `Restored ${cleaned.length} tags`);
    }
  }

  // Briefs: merge by date — skip if date already exists locally
  if (state.briefs?.length) {
    const existingDates = new Set(
      (await db.briefs.toArray()).map((b) => b.date),
    );
    const toAdd = state.briefs.filter((b) => !existingDates.has(b.date));
    if (toAdd.length > 0) {
      const cleaned = toAdd.map(({ id: _id, ...rest }) => rest);
      await db.briefs.bulkAdd(cleaned as typeof toAdd);
      await logStatus("info", "backup", `Restored ${cleaned.length} morning briefs`);
    }
  }

  // Chrome storage: only restore keys that are currently empty — never restore sensitive keys
  if (state.chrome_storage && Object.keys(state.chrome_storage).length > 0) {
    const current = await chrome.storage.local.get(Object.keys(state.chrome_storage));
    const toRestore: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(state.chrome_storage)) {
      if (SENSITIVE_STORAGE_KEYS.has(key)) continue;
      if (current[key] === undefined || current[key] === null || current[key] === "") {
        toRestore[key] = value;
      }
    }
    if (Object.keys(toRestore).length > 0) {
      await chrome.storage.local.set(toRestore);
      await logStatus("info", "backup", `Restored ${Object.keys(toRestore).length} chrome.storage keys`);
    }
  }

  // Watermarks: restore if currently empty
  if (state.watermarks) {
    const current = await chrome.storage.local.get([
      "granolaProcessedNoteIds",
      "granolaLastPoll",
      "granolaScannedThrough",
      "slackChannelWatermarks",
    ]);

    const watermarkRestore: Record<string, unknown> = {};
    if (!current.granolaProcessedNoteIds && state.watermarks.granolaProcessedNoteIds?.length) {
      watermarkRestore.granolaProcessedNoteIds = state.watermarks.granolaProcessedNoteIds;
    }
    if (!current.granolaLastPoll && state.watermarks.granolaLastPoll) {
      watermarkRestore.granolaLastPoll = state.watermarks.granolaLastPoll;
    }
    if (!current.granolaScannedThrough && state.watermarks.granolaScannedThrough) {
      watermarkRestore.granolaScannedThrough = state.watermarks.granolaScannedThrough;
    }
    if (!current.slackChannelWatermarks && state.watermarks.slackChannelWatermarks) {
      watermarkRestore.slackChannelWatermarks = state.watermarks.slackChannelWatermarks;
    }

    if (Object.keys(watermarkRestore).length > 0) {
      await chrome.storage.local.set(watermarkRestore);
      await logStatus("info", "backup", `Restored watermarks: ${Object.keys(watermarkRestore).join(", ")}`);
    }
  }
}
