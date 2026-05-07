import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "@shared/db";
import type {
  Commitment,
  CuratorOp,
  CuratorOpsFile,
  MarkDoneOp,
  FlagReviewOp,
  MergeDuplicateOp,
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
