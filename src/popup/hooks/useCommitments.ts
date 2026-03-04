import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@shared/db";
import type { Commitment, Dismissal } from "@shared/types";

export interface CommitmentsData {
  commitments: Commitment[];
  dismissalPatterns: Dismissal[];
  counts: { all: number; high: number };
  stats: { actioned: number; dismissed: number };
  loading: boolean;
}

export function useCommitments(): CommitmentsData {
  const now = new Date().toISOString();

  const commitments = useLiveQuery(
    () =>
      db.commitments
        .where("status")
        .anyOf("new", "snoozed")
        .filter((c) => {
          if (c.status === "snoozed" && c.snooze_until) {
            return c.snooze_until <= now;
          }
          return true;
        })
        .toArray(),
    [],
    undefined,
  );

  const dismissalPatterns = useLiveQuery(
    () => db.dismissals.orderBy("count").reverse().toArray(),
    [],
    undefined,
  );

  const actionedCount = useLiveQuery(
    () => db.commitments.where("status").anyOf("actioned", "done").count(),
    [],
    undefined,
  );

  const dismissedCount = useLiveQuery(
    () => db.commitments.where("status").equals("dismissed").count(),
    [],
    undefined,
  );

  const loading =
    commitments === undefined ||
    dismissalPatterns === undefined ||
    actionedCount === undefined ||
    dismissedCount === undefined;

  const items = commitments ?? [];
  const patterns = dismissalPatterns ?? [];

  return {
    commitments: items,
    dismissalPatterns: patterns,
    counts: {
      all: items.length,
      high: items.filter((c) => c.urgency === "high").length,
    },
    stats: {
      actioned: actionedCount ?? 0,
      dismissed: dismissedCount ?? 0,
    },
    loading,
  };
}
