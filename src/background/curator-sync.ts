import { db } from "@shared/db";
import { logStatus } from "@shared/status";
import type { CuratorOp, CuratorOpsFile } from "@shared/types";
import { sendNative } from "./granola-local";

/**
 * Reads recommended changes the external curator (Cowork skill) writes to
 * ~/.commitment-tracker/curator-ops.json and applies them to IndexedDB.
 *
 * Invariants (see skills/clyde-curate/CLAUDE_CODE_PROMPT.md):
 *   1. Idempotent — `applied_curator_ops.id` short-circuits replays.
 *   2. Freshness guard — a stale op never overwrites a fresh local edit.
 *   3. Atomic — each op is applied inside a single Dexie transaction.
 *   4. Non-regressive — only open → done | dismissed | suggestion.
 */

const CURATOR_SYNC_ENABLED_KEY = "curatorSyncEnabled";
const LAST_SEEN_MTIME_KEY = "curator_last_seen_mtime";

export interface CuratorSyncResult {
  read: boolean;
  applied: number;
  skippedAlreadyApplied: number;
  skippedFresherLocal: number;
  skippedUnknownHash: number;
  errors: string[];
}

export type ApplyOutcome =
  | "applied"
  | "already-applied"
  | "fresher-local"
  | "unknown-hash";

interface CuratorOpsNativeResponse {
  ok?: boolean;
  error?: string;
  exists?: boolean;
  unchanged?: boolean;
  malformed?: boolean;
  mtime?: number;
  data?: CuratorOpsFile;
}

interface DropDirReadResponse {
  ok?: boolean;
  error?: string;
  /** Each entry: one drop file's contents */
  files?: Array<{
    filename: string;
    operations?: CuratorOp[];
    malformed?: boolean;
    error?: string;
  }>;
}

interface DropDirConsumeResponse {
  ok?: boolean;
  error?: string;
  consumed?: number;
}

function emptyResult(): CuratorSyncResult {
  return {
    read: false,
    applied: 0,
    skippedAlreadyApplied: 0,
    skippedFresherLocal: 0,
    skippedUnknownHash: 0,
    errors: [],
  };
}

async function isCuratorSyncEnabled(): Promise<boolean> {
  const r = await chrome.storage.local.get(CURATOR_SYNC_ENABLED_KEY);
  // Default to true if the user has never touched the toggle
  return r[CURATOR_SYNC_ENABLED_KEY] !== false;
}

async function getLastSeenMtime(): Promise<number | null> {
  const row = await db.settings.get(LAST_SEEN_MTIME_KEY);
  if (!row) return null;
  return typeof row.value === "number" ? row.value : null;
}

async function setLastSeenMtime(mtime: number): Promise<void> {
  await db.settings.put({ key: LAST_SEEN_MTIME_KEY, value: mtime });
}

/**
 * Apply a single curator op atomically. Exported for unit tests.
 *
 * Returns the outcome so the caller can keep counters without inspecting the
 * DB. Throws on unexpected DB errors so the caller can record them per-op
 * without stopping the batch.
 */
export async function applyOp(op: CuratorOp): Promise<ApplyOutcome> {
  // 1. Idempotency
  const already = await db.applied_curator_ops.get(op.id);
  if (already) return "already-applied";

  // 2. Resolve commitment by hash
  const commitment = await db.commitments
    .where("hash")
    .equals(op.commitment_hash)
    .first();
  if (!commitment || commitment.id === undefined) return "unknown-hash";

  // 3. Freshness guard — user's manual action always wins.
  const lastMod = commitment.lastModifiedAt ?? commitment.createdAt;
  if (lastMod > op.snapshot_at) return "fresher-local";

  const cid = commitment.id;
  const now = new Date().toISOString();

  await db.transaction(
    "rw",
    [db.commitments, db.completion_suggestions, db.applied_curator_ops],
    async () => {
      if (op.type === "mark_done") {
        await db.commitments.update(cid, {
          status: "done",
          completion_signal: op.evidence,
          lastModifiedAt: now,
        });
      } else if (op.type === "flag_review") {
        // Suggestion only — let the existing CompletionSuggestion UI surface it.
        await db.completion_suggestions.add({
          commitmentId: cid,
          confidence: op.confidence,
          evidence: op.evidence,
          sourceMessage: op.evidence,
          status: "pending",
          createdAt: now,
        });
      } else if (op.type === "merge_duplicate") {
        await db.commitments.update(cid, {
          status: "dismissed",
          lastModifiedAt: now,
          merge_metadata: {
            merged_into: op.primary_hash,
            reason: "duplicate",
            rationale: op.rationale,
          },
        });
      } else if (op.type === "dismiss") {
        await db.commitments.update(cid, {
          status: "dismissed",
          completion_signal: op.rationale,
          lastModifiedAt: now,
        });
      } else {
        // Unknown op type — refuse to mark applied so a future SW that
        // understands the type can still process it. The op stays in the
        // drop directory (or curator-ops.json) until consumed by a build
        // that recognises it.
        throw new Error(
          `Unknown curator op type: ${(op as { type?: string }).type ?? "(missing)"}`,
        );
      }

      await db.applied_curator_ops.add({
        id: op.id,
        opType: op.type,
        commitmentHash: op.commitment_hash,
        appliedAt: now,
      });
    },
  );

  return "applied";
}

/**
 * Reverse an applied op. Used by the popup "Undo" button.
 *
 * Sets the commitment back to "new" (non-destructive — the user can re-do it)
 * and removes the applied_curator_ops row so the next sync would re-apply it
 * if the curator still recommends it. Errors silently if the op or commitment
 * no longer exists.
 */
export async function undoAppliedOp(id: string): Promise<boolean> {
  const applied = await db.applied_curator_ops.get(id);
  if (!applied) return false;

  await db.transaction(
    "rw",
    [db.commitments, db.applied_curator_ops, db.completion_suggestions],
    async () => {
      const commitment = await db.commitments
        .where("hash")
        .equals(applied.commitmentHash)
        .first();
      if (commitment?.id !== undefined) {
        if (applied.opType === "flag_review") {
          // The suggestion was a side effect; status was never changed.
          // Best-effort: dismiss any pending suggestions tied to this commitment.
          await db.completion_suggestions
            .where("commitmentId")
            .equals(commitment.id)
            .filter((s) => s.status === "pending")
            .modify({ status: "dismissed" });
        } else {
          await db.commitments.update(commitment.id, {
            status: "new",
            lastModifiedAt: new Date().toISOString(),
          });
        }
      }
      await db.applied_curator_ops.delete(id);
    },
  );

  return true;
}

/**
 * Read the curator ops file via the native messaging host and apply any new
 * operations. Cheap to call repeatedly — the host short-circuits when the
 * file's mtime hasn't advanced since the last run.
 */
export async function runCuratorSync(opts?: {
  force?: boolean;
}): Promise<CuratorSyncResult> {
  const result = emptyResult();

  if (!opts?.force && !(await isCuratorSyncEnabled())) {
    return result;
  }

  // Two independent passes — both always run so a missing/empty curator-ops.json
  // never stops the drop-dir from being scanned.
  await runSingleFilePass(result, opts?.force);
  await runDropDirPass(result);

  if (result.applied > 0 || result.errors.length > 0) {
    await logStatus(
      result.errors.length > 0 ? "warn" : "info",
      "worker",
      `Curator sync: applied=${result.applied}, alreadyApplied=${result.skippedAlreadyApplied}, fresherLocal=${result.skippedFresherLocal}, unknownHash=${result.skippedUnknownHash}, errors=${result.errors.length}`,
    );
  }

  return result;
}

async function runSingleFilePass(
  result: CuratorSyncResult,
  force?: boolean,
): Promise<void> {
  const lastMtime = force ? null : await getLastSeenMtime();
  const cmd: Record<string, unknown> = { command: "get_curator_ops_since" };
  if (lastMtime !== null) cmd.mtime = lastMtime;

  let resp: CuratorOpsNativeResponse;
  try {
    resp = (await sendNative(cmd)) as unknown as CuratorOpsNativeResponse;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.errors.push(`native messaging failed: ${msg}`);
    await logStatus("warn", "worker", `Curator sync: native messaging failed (${msg})`);
    return;
  }

  if (resp.ok === false) {
    result.errors.push(resp.error ?? "unknown native error");
    return;
  }
  if (resp.exists === false) return;
  if (resp.unchanged) return;
  if (resp.malformed) {
    result.errors.push(`malformed curator-ops.json: ${resp.error ?? "unknown"}`);
    await logStatus("warn", "worker", `Curator sync: malformed curator-ops.json — ${resp.error ?? "unknown"}`);
    return;
  }

  const file = resp.data;
  if (!file || !Array.isArray(file.operations)) {
    result.errors.push("curator-ops.json missing operations array");
    return;
  }

  result.read = true;

  for (const op of file.operations) {
    if (!op || typeof op.id !== "string" || typeof op.type !== "string") {
      result.errors.push(`malformed op (missing id/type): ${JSON.stringify(op)?.slice(0, 80)}`);
      continue;
    }
    try {
      const outcome = await applyOp(op);
      switch (outcome) {
        case "applied":
          result.applied++;
          break;
        case "already-applied":
          result.skippedAlreadyApplied++;
          break;
        case "fresher-local":
          result.skippedFresherLocal++;
          break;
        case "unknown-hash":
          result.skippedUnknownHash++;
          break;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`op ${op.id}: ${msg}`);
    }
  }

  if (typeof resp.mtime === "number") {
    await setLastSeenMtime(resp.mtime);
  }
}

async function runDropDirPass(result: CuratorSyncResult): Promise<void> {
  let resp: DropDirReadResponse | undefined;
  try {
    resp = (await sendNative({ command: "read_op_files" })) as unknown as
      | DropDirReadResponse
      | undefined;
  } catch (err) {
    // Native host doesn't know this command yet (older install) — silent skip.
    // The host's main() returns ok:false for unknown commands, which falls through below.
    const msg = err instanceof Error ? err.message : String(err);
    result.errors.push(`drop-dir read failed: ${msg}`);
    return;
  }

  if (!resp) return;
  if (resp.ok === false) {
    // Real error from the host (permission denied, mid-rename, etc.). The
    // "missing dir" case returns `{ok: true, files: []}` — see
    // handle_read_op_files in granola_reader.py.
    result.errors.push(`drop-dir read failed: ${resp.error ?? "unknown"}`);
    return;
  }

  const files = resp.files ?? [];
  if (files.length === 0) return;

  const consumed: string[] = [];

  for (const file of files) {
    if (file.malformed || !Array.isArray(file.operations)) {
      result.errors.push(
        `malformed drop file ${file.filename}: ${file.error ?? "missing operations array"}`,
      );
      // Don't consume — leave on disk so the user can inspect / delete.
      continue;
    }

    let fileSucceeded = true;
    for (const op of file.operations) {
      if (!op || typeof op.id !== "string" || typeof op.type !== "string") {
        result.errors.push(
          `malformed op in ${file.filename}: ${JSON.stringify(op)?.slice(0, 80)}`,
        );
        fileSucceeded = false;
        continue;
      }
      try {
        const outcome = await applyOp(op);
        switch (outcome) {
          case "applied":
            result.applied++;
            break;
          case "already-applied":
            result.skippedAlreadyApplied++;
            break;
          case "fresher-local":
            result.skippedFresherLocal++;
            break;
          case "unknown-hash":
            result.skippedUnknownHash++;
            fileSucceeded = false;
            // Leave on disk — user may restore the commitment and want the op re-applied.
            break;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push(`op ${op.id} (${file.filename}): ${msg}`);
        fileSucceeded = false;
      }
    }

    // Only consume if every op in the file applied (or was a no-op already-applied).
    // unknown-hash + thrown errors keep the file on disk.
    if (fileSucceeded) consumed.push(file.filename);
  }

  if (consumed.length === 0) return;

  try {
    const consumeResp = (await sendNative({
      command: "consume_op_files",
      filenames: consumed,
    })) as unknown as DropDirConsumeResponse;
    if (consumeResp.ok === false) {
      result.errors.push(`consume_op_files failed: ${consumeResp.error ?? "unknown"}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.errors.push(`consume_op_files failed: ${msg}`);
  }

  result.read = true;
}
