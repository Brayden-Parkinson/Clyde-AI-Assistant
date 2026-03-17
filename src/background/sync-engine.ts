/**
 * Sync engine foundation — outbox tracking via Dexie hooks.
 * No actual server communication yet; envelopes are encrypted and logged.
 */

import { db } from "@shared/db";
import { logStatus } from "@shared/status";
import type { SyncEnvelope } from "@shared/types";
import { deriveKey, encrypt, generateSalt } from "./sync-crypto";

// ─── Cached sync-enabled flag ─────────────────────────────────────────

let syncEnabledCache = false;

/** Read sync enabled state from chrome.storage.local */
async function refreshSyncEnabled(): Promise<void> {
  const result = await chrome.storage.local.get("syncEnabled");
  syncEnabledCache = result.syncEnabled === true;
}

/** Check if sync is enabled (reads from storage, not cache) */
async function isSyncEnabled(): Promise<boolean> {
  const result = await chrome.storage.local.get("syncEnabled");
  return result.syncEnabled === true;
}

/** Get or generate a stable device ID for this browser */
async function getDeviceId(): Promise<string> {
  const result = await chrome.storage.local.get("syncDeviceId");
  if (result.syncDeviceId) return result.syncDeviceId as string;
  const id = crypto.randomUUID();
  await chrome.storage.local.set({ syncDeviceId: id });
  return id;
}

// ─── Outbox writer ────────────────────────────────────────────────────

/** Maximum outbox entries before evicting oldest — prevents unbounded growth if push fails */
const MAX_OUTBOX_SIZE = 1000;

/**
 * Queue a change to the sync outbox. Called from Dexie hooks.
 * Runs async but hooks are fire-and-forget — errors are logged.
 * Caps outbox to MAX_OUTBOX_SIZE entries to prevent unbounded storage growth.
 */
function logSyncChange(
  table: string,
  op: "put" | "delete",
  obj: Record<string, unknown>,
): void {
  // Dexie hooks are synchronous; we fire-and-forget the async write
  (async () => {
    try {
      const deviceId = await getDeviceId();
      const envelope: SyncEnvelope = {
        op,
        table,
        payload: obj,
        timestamp: new Date().toISOString(),
        deviceId,
      };
      await db.table("sync_outbox").add(envelope);

      // Evict oldest entries if outbox exceeds cap
      const count = await db.table("sync_outbox").count();
      if (count > MAX_OUTBOX_SIZE) {
        const excess = count - MAX_OUTBOX_SIZE;
        const oldestIds = await db.table("sync_outbox")
          .orderBy("id")
          .limit(excess)
          .primaryKeys();
        await db.table("sync_outbox").bulkDelete(oldestIds);
      }
    } catch (err) {
      console.error("[Sync] Failed to write outbox envelope:", err);
    }
  })();
}

// ─── Hook registration ────────────────────────────────────────────────

/**
 * Register Dexie hooks on key tables to capture changes into the sync outbox.
 * Must be called once at service worker startup, before any DB writes.
 */
export function initSyncHooks(): void {
  // Initialize the cached flag
  refreshSyncEnabled();

  // Listen for storage changes to keep the cache fresh
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.syncEnabled != null) {
      syncEnabledCache = changes.syncEnabled.newValue === true;
    }
  });

  // --- commitments ---
  db.commitments.hook("creating", function (_primKey, obj) {
    if (!syncEnabledCache) return;
    logSyncChange("commitments", "put", obj as unknown as Record<string, unknown>);
  });
  db.commitments.hook("updating", function (_modifications, _primKey, obj) {
    if (!syncEnabledCache) return;
    logSyncChange("commitments", "put", obj as unknown as Record<string, unknown>);
  });
  db.commitments.hook("deleting", function (_primKey, obj) {
    if (!syncEnabledCache) return;
    logSyncChange("commitments", "delete", obj as unknown as Record<string, unknown>);
  });

  // --- memories ---
  db.table("memories").hook("creating", function (_primKey: unknown, obj: Record<string, unknown>) {
    if (!syncEnabledCache) return;
    logSyncChange("memories", "put", obj);
  });
  db.table("memories").hook("updating", function (_modifications: unknown, _primKey: unknown, obj: Record<string, unknown>) {
    if (!syncEnabledCache) return;
    logSyncChange("memories", "put", obj);
  });
  db.table("memories").hook("deleting", function (_primKey: unknown, obj: Record<string, unknown>) {
    if (!syncEnabledCache) return;
    logSyncChange("memories", "delete", obj);
  });

  // --- okrs ---
  db.table("okrs").hook("creating", function (_primKey: unknown, obj: Record<string, unknown>) {
    if (!syncEnabledCache) return;
    logSyncChange("okrs", "put", obj);
  });
  db.table("okrs").hook("updating", function (_modifications: unknown, _primKey: unknown, obj: Record<string, unknown>) {
    if (!syncEnabledCache) return;
    logSyncChange("okrs", "put", obj);
  });
  db.table("okrs").hook("deleting", function (_primKey: unknown, obj: Record<string, unknown>) {
    if (!syncEnabledCache) return;
    logSyncChange("okrs", "delete", obj);
  });

  logStatus("info", "worker" as never, "[Sync] Hooks registered on commitments, memories, okrs");
}

// ─── Push stub ────────────────────────────────────────────────────────

/**
 * Read sync outbox, encrypt envelopes, and log (no server yet).
 * Clears processed entries from the outbox after "pushing".
 */
export async function syncPush(): Promise<void> {
  const enabled = await isSyncEnabled();
  if (!enabled) return;

  const envelopes: SyncEnvelope[] = await db.table("sync_outbox").toArray();
  if (envelopes.length === 0) return;

  // Read passphrase from storage
  const { syncPassphrase } = await chrome.storage.local.get("syncPassphrase");
  if (!syncPassphrase) {
    logStatus("warn", "worker" as never, "[Sync] No passphrase configured — skipping push");
    return;
  }

  try {
    // Read or generate salt
    let { syncSalt } = await chrome.storage.local.get("syncSalt");
    if (!syncSalt) {
      const salt = generateSalt();
      // Store as base64 for persistence
      syncSalt = btoa(String.fromCharCode(...salt));
      await chrome.storage.local.set({ syncSalt });
    }

    // Decode salt from base64
    const saltBytes = Uint8Array.from(atob(syncSalt as string), (c) => c.charCodeAt(0));

    // Derive encryption key
    const key = await deriveKey(syncPassphrase as string, saltBytes);

    // Encrypt each envelope (stub — just proves encryption works)
    const encrypted: string[] = [];
    for (const envelope of envelopes) {
      const json = JSON.stringify(envelope);
      const enc = await encrypt(json, key);
      encrypted.push(enc);
    }

    // Stub: log instead of sending to server
    logStatus(
      "info",
      "worker" as never,
      `[Sync] Would push ${encrypted.length} changes (server not connected)`,
    );

    // Clear processed outbox entries
    const ids = envelopes.map((e) => e.id).filter((id): id is number => id != null);
    await db.table("sync_outbox").bulkDelete(ids);
  } catch (err) {
    logStatus(
      "error",
      "worker" as never,
      `[Sync] Push failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ─── Pull stub ────────────────────────────────────────────────────────

/** Pull changes from server (not yet implemented). */
export async function syncPull(): Promise<void> {
  logStatus("info", "worker" as never, "[Sync] Pull not yet implemented");
}
