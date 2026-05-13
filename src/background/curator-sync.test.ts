import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "@shared/db";
import type {
  Commitment,
  CuratorOp,
  CuratorOpsFile,
  MarkDoneOp,
  FlagReviewOp,
  MergeDuplicateOp,
  DismissOp,
} from "@shared/types";
import { clearStorageLocal, setStorageLocal } from "../test-utils/chrome-mock";

// `runCuratorSync` reads via `sendNative`. Mock that one entry point so the
// test never actually talks to a Chrome native messaging host.
vi.mock("./granola-local", () => ({
  sendNative: vi.fn(),
}));

import { sendNative } from "./granola-local";
import { applyOp, runCuratorSync, undoAppliedOp } from "./curator-sync";

const sendNativeMock = sendNative as unknown as ReturnType<typeof vi.fn>;

// ─── Fixtures ────────────────────────────────────────────────────────────

function makeCommitment(overrides: Partial<Commitment> = {}): Commitment {
  const now = new Date("2026-04-01T00:00:00Z").toISOString();
  return {
    hash: "h-default",
    text: "Send the report",
    original_quote: "I'll send the report",
    deadline: null,
    urgency: "medium",
    context: "engineering",
    source_type: "slack",
    confidence: 0.9,
    status: "new",
    direction: "by_me",
    likely_completed: false,
    completion_signal: null,
    message_timestamp: now,
    snooze_until: null,
    context_summary: null,
    conversation_messages: [],
    slack_link: null,
    triggered: false,
    sensitive: false,
    tag_id: null,
    createdAt: now,
    lastModifiedAt: now,
    ...overrides,
  };
}

function makeMarkDone(overrides: Partial<MarkDoneOp> = {}): MarkDoneOp {
  return {
    id: "op:done-1",
    type: "mark_done",
    commitment_hash: "h-default",
    snapshot_at: "2026-04-02T00:00:00Z",
    confidence: 0.9,
    evidence: "Sent the report at 14:00",
    evidence_url: "https://slack.example/p123",
    generated_at: "2026-04-02T00:01:00Z",
    ...overrides,
  };
}

function makeFlagReview(overrides: Partial<FlagReviewOp> = {}): FlagReviewOp {
  return {
    id: "op:flag-1",
    type: "flag_review",
    commitment_hash: "h-default",
    snapshot_at: "2026-04-02T00:00:00Z",
    confidence: 0.6,
    evidence: "Possibly done — saw a related message",
    generated_at: "2026-04-02T00:01:00Z",
    ...overrides,
  };
}

function makeMergeDup(overrides: Partial<MergeDuplicateOp> = {}): MergeDuplicateOp {
  return {
    id: "op:merge-1",
    type: "merge_duplicate",
    commitment_hash: "h-dup",
    snapshot_at: "2026-04-02T00:00:00Z",
    primary_hash: "h-canon",
    rationale: "Identical text in same channel within an hour",
    generated_at: "2026-04-02T00:01:00Z",
    ...overrides,
  };
}

function makeDismiss(overrides: Partial<DismissOp> = {}): DismissOp {
  return {
    id: "op:dismiss-1",
    type: "dismiss",
    commitment_hash: "h-default",
    snapshot_at: "2026-04-02T00:00:00Z",
    generated_at: "2026-04-02T00:01:00Z",
    rationale: "No longer relevant",
    ...overrides,
  };
}

function makeFile(operations: CuratorOp[]): CuratorOpsFile {
  return {
    version: 1,
    generated_at: "2026-04-02T00:01:00Z",
    snapshot_source: "backup-test.json",
    snapshot_lastSaved: "2026-04-02T00:00:00Z",
    summary: {},
    operations,
  };
}

// ─── Setup ───────────────────────────────────────────────────────────────

beforeEach(async () => {
  // Restore any spies the previous test left behind (e.g. db.transaction).
  vi.restoreAllMocks();
  clearStorageLocal();
  // Clear all tables touched by curator-sync between tests.
  await db.commitments.clear();
  await db.completion_suggestions.clear();
  await db.applied_curator_ops.clear();
  await db.settings.clear();
  sendNativeMock.mockReset();
});

// ─── applyOp — direct unit tests ─────────────────────────────────────────

describe("applyOp — mark_done", () => {
  it("flips status to done, records evidence, bumps lastModifiedAt", async () => {
    await db.commitments.add(makeCommitment({ hash: "h-mark" }));
    const op = makeMarkDone({ commitment_hash: "h-mark", evidence: "shipped at 14:00" });

    const outcome = await applyOp(op);

    expect(outcome).toBe("applied");
    const c = await db.commitments.where("hash").equals("h-mark").first();
    expect(c?.status).toBe("done");
    expect(c?.completion_signal).toBe("shipped at 14:00");
    expect(c?.lastModifiedAt && c.lastModifiedAt > "2026-04-02T00:00:00Z").toBe(true);
    const applied = await db.applied_curator_ops.get(op.id);
    expect(applied?.opType).toBe("mark_done");
  });
});

describe("applyOp — flag_review", () => {
  it("adds a pending completion_suggestion and leaves status untouched", async () => {
    await db.commitments.add(makeCommitment({ hash: "h-flag", status: "new" }));
    const op = makeFlagReview({ commitment_hash: "h-flag" });

    const outcome = await applyOp(op);

    expect(outcome).toBe("applied");
    const c = await db.commitments.where("hash").equals("h-flag").first();
    expect(c?.status).toBe("new");
    const sugs = await db.completion_suggestions
      .where("commitmentId").equals(c!.id!).toArray();
    expect(sugs).toHaveLength(1);
    expect(sugs[0].status).toBe("pending");
    expect(sugs[0].evidence).toBe(op.evidence);
  });
});

describe("applyOp — merge_duplicate", () => {
  it("dismisses the duplicate and stamps merge metadata", async () => {
    await db.commitments.add(makeCommitment({ hash: "h-dup" }));
    const op = makeMergeDup({
      commitment_hash: "h-dup",
      primary_hash: "h-canon",
      rationale: "duplicate within 1h",
    });

    const outcome = await applyOp(op);

    expect(outcome).toBe("applied");
    const c = await db.commitments.where("hash").equals("h-dup").first();
    expect(c?.status).toBe("dismissed");
    expect(c?.merge_metadata).toEqual({
      merged_into: "h-canon",
      reason: "duplicate",
      rationale: "duplicate within 1h",
    });
  });
});

describe("applyOp — idempotency", () => {
  it("returns already-applied on second invocation, no extra rows", async () => {
    await db.commitments.add(makeCommitment({ hash: "h-id" }));
    const op = makeMarkDone({ id: "op:id-1", commitment_hash: "h-id" });

    expect(await applyOp(op)).toBe("applied");
    expect(await applyOp(op)).toBe("already-applied");
    expect(await db.applied_curator_ops.count()).toBe(1);
  });
});

describe("applyOp — freshness guard", () => {
  it("skips when commitment.lastModifiedAt is newer than op.snapshot_at", async () => {
    await db.commitments.add(
      makeCommitment({
        hash: "h-fresh",
        status: "new",
        lastModifiedAt: "2026-04-03T00:00:00Z",
      }),
    );
    const op = makeMarkDone({
      id: "op:fresh-1",
      commitment_hash: "h-fresh",
      snapshot_at: "2026-04-02T00:00:00Z",
    });

    const outcome = await applyOp(op);

    expect(outcome).toBe("fresher-local");
    const c = await db.commitments.where("hash").equals("h-fresh").first();
    expect(c?.status).toBe("new");
    expect(await db.applied_curator_ops.get(op.id)).toBeUndefined();
  });

  it("falls back to createdAt when lastModifiedAt is missing", async () => {
    // Simulate a pre-migration row by deleting lastModifiedAt after insert.
    const id = await db.commitments.add(
      makeCommitment({ hash: "h-fb", createdAt: "2026-04-03T00:00:00Z" }),
    );
    await db.commitments.update(id, { lastModifiedAt: undefined });

    const op = makeMarkDone({
      id: "op:fb-1",
      commitment_hash: "h-fb",
      snapshot_at: "2026-04-02T00:00:00Z",
    });

    const outcome = await applyOp(op);
    expect(outcome).toBe("fresher-local");
  });
});

describe("applyOp — unknown hash", () => {
  it("returns unknown-hash without throwing or writing", async () => {
    const op = makeMarkDone({ id: "op:unk-1", commitment_hash: "h-missing" });

    const outcome = await applyOp(op);

    expect(outcome).toBe("unknown-hash");
    expect(await db.applied_curator_ops.count()).toBe(0);
  });
});

// ─── runCuratorSync — integration ───────────────────────────────────────

describe("runCuratorSync — applies ops via native bridge", () => {
  it("returns early when the file hasn't changed", async () => {
    sendNativeMock.mockResolvedValueOnce({ ok: true, exists: true, unchanged: true, mtime: 100 });

    const r = await runCuratorSync();

    expect(r.applied).toBe(0);
    expect(r.read).toBe(false);
  });

  it("returns early when the file does not exist", async () => {
    sendNativeMock.mockResolvedValueOnce({ ok: true, exists: false });

    const r = await runCuratorSync();

    expect(r.read).toBe(false);
    expect(r.errors).toEqual([]);
  });

  it("applies all ops, persists mtime, and is idempotent on replay", async () => {
    await db.commitments.add(makeCommitment({ hash: "h-a" }));
    await db.commitments.add(makeCommitment({ hash: "h-b" }));
    const ops: CuratorOp[] = [
      makeMarkDone({ id: "op:a", commitment_hash: "h-a" }),
      makeFlagReview({ id: "op:b", commitment_hash: "h-b" }),
    ];
    const file = makeFile(ops);
    sendNativeMock.mockResolvedValue({
      ok: true,
      exists: true,
      malformed: false,
      mtime: 200,
      data: file,
    });

    const r1 = await runCuratorSync();
    expect(r1.applied).toBe(2);
    expect(r1.errors).toEqual([]);
    const mtimeRow = await db.settings.get("curator_last_seen_mtime");
    expect(mtimeRow?.value).toBe(200);

    // Replay — every op should be skipped as already-applied.
    const r2 = await runCuratorSync();
    expect(r2.applied).toBe(0);
    expect(r2.skippedAlreadyApplied).toBe(2);
  });

  it("records per-op errors but continues with subsequent ops", async () => {
    // Two distinct commitments — otherwise the second op would be skipped
    // by the freshness guard once the first applyOp bumps lastModifiedAt.
    await db.commitments.add(makeCommitment({ hash: "h-good" }));
    await db.commitments.add(makeCommitment({ hash: "h-fail" }));
    const goodOp = makeMarkDone({ id: "op:good", commitment_hash: "h-good" });
    const failingOp = makeMarkDone({ id: "op:fails", commitment_hash: "h-fail" });

    // Force the *second* applyOp call to throw inside the transaction.
    const realTx = db.transaction.bind(db);
    let callCount = 0;
    const txSpy = vi
      .spyOn(db, "transaction")
      // @ts-expect-error overload signature is permissive
      .mockImplementation((...args: unknown[]) => {
        callCount++;
        if (callCount === 2) return Promise.reject(new Error("boom"));
        // @ts-expect-error pass through
        return realTx(...args);
      });

    const file = makeFile([goodOp, failingOp]);
    sendNativeMock.mockResolvedValue({
      ok: true,
      exists: true,
      malformed: false,
      mtime: 300,
      data: file,
    });

    try {
      const r = await runCuratorSync();
      expect(r.applied).toBe(1);
      expect(r.errors).toHaveLength(1);
      expect(r.errors[0]).toMatch(/op:fails/);
    } finally {
      txSpy.mockRestore();
    }
  });

  it("respects the curatorSyncEnabled toggle (default true, can disable)", async () => {
    setStorageLocal({ curatorSyncEnabled: false });

    const r = await runCuratorSync();

    expect(r.read).toBe(false);
    expect(sendNativeMock).not.toHaveBeenCalled();
  });

  it("reports malformed file via errors array", async () => {
    sendNativeMock.mockResolvedValueOnce({
      ok: true,
      exists: true,
      malformed: true,
      error: "JSON parse error",
      mtime: 400,
    });

    const r = await runCuratorSync();

    expect(r.read).toBe(false);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatch(/malformed/);
  });
});

// ─── New op types + safety guards ───────────────────────────────────────

describe("applyOp — dismiss", () => {
  it("flips status to dismissed, records rationale, bumps lastModifiedAt", async () => {
    await db.commitments.add(makeCommitment({ hash: "h-dismiss" }));
    const op = makeDismiss({
      commitment_hash: "h-dismiss",
      rationale: "no longer relevant — staffing decision changed",
    });

    const outcome = await applyOp(op);

    expect(outcome).toBe("applied");
    const c = await db.commitments.where("hash").equals("h-dismiss").first();
    expect(c?.status).toBe("dismissed");
    expect(c?.completion_signal).toBe("no longer relevant — staffing decision changed");
    expect(c?.lastModifiedAt && c.lastModifiedAt > "2026-04-02T00:00:00Z").toBe(true);
    // dismiss is distinct from merge_duplicate — no merge_metadata stamped
    expect(c?.merge_metadata).toBeUndefined();
    const applied = await db.applied_curator_ops.get(op.id);
    expect(applied?.opType).toBe("dismiss");
  });

  it("can be undone — reverts status to 'new' (mirrors mark_done semantics)", async () => {
    await db.commitments.add(makeCommitment({ hash: "h-dismiss-undo" }));
    const op = makeDismiss({ id: "op:dismiss-undo", commitment_hash: "h-dismiss-undo" });
    expect(await applyOp(op)).toBe("applied");

    const undone = await undoAppliedOp(op.id);

    expect(undone).toBe(true);
    const c = await db.commitments.where("hash").equals("h-dismiss-undo").first();
    expect(c?.status).toBe("new");
  });
});

describe("applyOp — unknown op type", () => {
  it("throws and refuses to record applied_curator_ops (forward-compat guard)", async () => {
    await db.commitments.add(makeCommitment({ hash: "h-unknown" }));
    // Cast through unknown — the schema disallows this at compile time, which
    // is the whole point: an old SW seeing a future op type at runtime must
    // not silently mark it applied.
    const op = {
      id: "op:future-type-1",
      type: "future_unknown_op",
      commitment_hash: "h-unknown",
      snapshot_at: "2026-04-02T00:00:00Z",
      generated_at: "2026-04-02T00:01:00Z",
    } as unknown as CuratorOp;

    await expect(applyOp(op)).rejects.toThrow(/unknown curator op type/i);

    const c = await db.commitments.where("hash").equals("h-unknown").first();
    expect(c?.status).toBe("new"); // unchanged
    expect(await db.applied_curator_ops.get("op:future-type-1")).toBeUndefined();
  });
});

// ─── runCuratorSync — drop-directory pass ────────────────────────────────

describe("runCuratorSync — drop-dir scan", () => {
  // Command-aware mock helper. The drop-dir code path adds `read_op_files`
  // and `consume_op_files` calls AFTER the existing `get_curator_ops_since`,
  // so each test needs to dispatch by command.
  function setupNative(handlers: Record<string, unknown>) {
    sendNativeMock.mockImplementation((msg: { command?: string }) => {
      const cmd = msg.command ?? "";
      if (cmd in handlers) return Promise.resolve(handlers[cmd]);
      return Promise.resolve({ ok: false, error: `no mock for ${cmd}` });
    });
  }

  it("applies ops from drop files and consumes successful files", async () => {
    await db.commitments.add(makeCommitment({ hash: "h-drop-1" }));
    await db.commitments.add(makeCommitment({ hash: "h-drop-2" }));

    const consumed: string[] = [];
    setupNative({
      get_curator_ops_since: { ok: true, exists: false },
      read_op_files: {
        ok: true,
        files: [
          {
            filename: "1-1-a.json",
            operations: [makeMarkDone({ id: "op:dd-a", commitment_hash: "h-drop-1" })],
          },
          {
            filename: "2-1-b.json",
            operations: [makeDismiss({ id: "op:dd-b", commitment_hash: "h-drop-2" })],
          },
        ],
      },
      consume_op_files: ((req: { filenames: string[] }) => {
        consumed.push(...req.filenames);
        return { ok: true, consumed: req.filenames.length };
      }) as unknown,
    });
    // The consume_op_files handler above is a function; remap to a callback.
    sendNativeMock.mockImplementation((msg: { command?: string; filenames?: string[] }) => {
      if (msg.command === "get_curator_ops_since") return Promise.resolve({ ok: true, exists: false });
      if (msg.command === "read_op_files") {
        return Promise.resolve({
          ok: true,
          files: [
            {
              filename: "1-1-a.json",
              operations: [makeMarkDone({ id: "op:dd-a", commitment_hash: "h-drop-1" })],
            },
            {
              filename: "2-1-b.json",
              operations: [makeDismiss({ id: "op:dd-b", commitment_hash: "h-drop-2" })],
            },
          ],
        });
      }
      if (msg.command === "consume_op_files") {
        consumed.push(...(msg.filenames ?? []));
        return Promise.resolve({ ok: true, consumed: (msg.filenames ?? []).length });
      }
      return Promise.resolve({ ok: false, error: `no mock for ${msg.command}` });
    });

    const r = await runCuratorSync();

    expect(r.applied).toBe(2);
    expect(r.errors).toEqual([]);
    expect(consumed.sort()).toEqual(["1-1-a.json", "2-1-b.json"]);

    const c1 = await db.commitments.where("hash").equals("h-drop-1").first();
    expect(c1?.status).toBe("done");
    const c2 = await db.commitments.where("hash").equals("h-drop-2").first();
    expect(c2?.status).toBe("dismissed");
  });

  it("does NOT consume a drop file whose op hits unknown-hash", async () => {
    // Only h-known exists; h-missing is unknown.
    await db.commitments.add(makeCommitment({ hash: "h-known" }));

    const consumed: string[] = [];
    sendNativeMock.mockImplementation((msg: { command?: string; filenames?: string[] }) => {
      if (msg.command === "get_curator_ops_since") return Promise.resolve({ ok: true, exists: false });
      if (msg.command === "read_op_files") {
        return Promise.resolve({
          ok: true,
          files: [
            {
              filename: "good.json",
              operations: [makeMarkDone({ id: "op:good", commitment_hash: "h-known" })],
            },
            {
              filename: "stale.json",
              operations: [makeMarkDone({ id: "op:stale", commitment_hash: "h-missing" })],
            },
          ],
        });
      }
      if (msg.command === "consume_op_files") {
        consumed.push(...(msg.filenames ?? []));
        return Promise.resolve({ ok: true, consumed: (msg.filenames ?? []).length });
      }
      return Promise.resolve({ ok: false });
    });

    const r = await runCuratorSync();

    expect(r.applied).toBe(1);
    expect(r.skippedUnknownHash).toBe(1);
    // Only the good file is consumed — stale.json stays on disk for a future
    // sync (perhaps after the commitment gets re-extracted).
    expect(consumed).toEqual(["good.json"]);
  });

  it("reports a malformed drop file via errors and leaves it on disk", async () => {
    const consumed: string[] = [];
    sendNativeMock.mockImplementation((msg: { command?: string; filenames?: string[] }) => {
      if (msg.command === "get_curator_ops_since") return Promise.resolve({ ok: true, exists: false });
      if (msg.command === "read_op_files") {
        return Promise.resolve({
          ok: true,
          files: [
            {
              filename: "broken.json",
              malformed: true,
              error: "JSON parse error",
            },
          ],
        });
      }
      if (msg.command === "consume_op_files") {
        consumed.push(...(msg.filenames ?? []));
        return Promise.resolve({ ok: true });
      }
      return Promise.resolve({ ok: false });
    });

    const r = await runCuratorSync();

    expect(r.applied).toBe(0);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatch(/broken\.json/);
    expect(consumed).toEqual([]);
  });

  it("unknown op types in a drop file are NOT silently consumed (forward-compat)", async () => {
    await db.commitments.add(makeCommitment({ hash: "h-future" }));

    const consumed: string[] = [];
    sendNativeMock.mockImplementation((msg: { command?: string; filenames?: string[] }) => {
      if (msg.command === "get_curator_ops_since") return Promise.resolve({ ok: true, exists: false });
      if (msg.command === "read_op_files") {
        return Promise.resolve({
          ok: true,
          files: [
            {
              filename: "future-op.json",
              operations: [
                {
                  id: "op:from-the-future",
                  type: "future_unknown_op",
                  commitment_hash: "h-future",
                  snapshot_at: "2026-04-02T00:00:00Z",
                  generated_at: "2026-04-02T00:01:00Z",
                },
              ],
            },
          ],
        });
      }
      if (msg.command === "consume_op_files") {
        consumed.push(...(msg.filenames ?? []));
        return Promise.resolve({ ok: true });
      }
      return Promise.resolve({ ok: false });
    });

    const r = await runCuratorSync();

    expect(r.applied).toBe(0);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatch(/unknown curator op type/i);
    // CRITICAL: the file must NOT be consumed, so a future SW that knows the
    // op type can still pick it up.
    expect(consumed).toEqual([]);
    // And no applied row exists for the future op.
    expect(await db.applied_curator_ops.get("op:from-the-future")).toBeUndefined();
  });
});

// ─── undoAppliedOp ──────────────────────────────────────────────────────

describe("undoAppliedOp", () => {
  it("reverts a mark_done back to status 'new' and removes the applied row", async () => {
    await db.commitments.add(makeCommitment({ hash: "h-undo" }));
    const op = makeMarkDone({ id: "op:undo-1", commitment_hash: "h-undo" });
    expect(await applyOp(op)).toBe("applied");

    const undone = await undoAppliedOp(op.id);

    expect(undone).toBe(true);
    const c = await db.commitments.where("hash").equals("h-undo").first();
    expect(c?.status).toBe("new");
    expect(await db.applied_curator_ops.get(op.id)).toBeUndefined();
  });

  it("returns false when the applied op id is unknown", async () => {
    expect(await undoAppliedOp("op:nope")).toBe(false);
  });
});
