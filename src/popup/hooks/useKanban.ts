import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@shared/db";
import type { Commitment } from "@shared/types";
import type { FilterKey } from "../components/FilterBar";

export interface KanbanData {
  todo: Commitment[];
  inProgress: Commitment[];
  done: Commitment[];
  counts: { all: number; high: number };
  loading: boolean;
}

/** Returns ISO string of most recent Monday 00:00 local time */
function getMondayOfWeek(): string {
  const now = new Date();
  const day = now.getDay(); // 0=Sun, 1=Mon...
  const diff = day === 0 ? 6 : day - 1; // days since Monday
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diff);
  return monday.toISOString();
}

function applyFilter(items: Commitment[], filter: FilterKey): Commitment[] {
  return items.filter((c) => {
    if (filter === "all") return true;
    if (filter === "overdue") return c.deadline != null && new Date(c.deadline).getTime() < Date.now();
    if (filter === "has_deadline") return c.deadline != null;
    if (filter === "high") return c.urgency === "high";
    if (filter === "meetings") return c.source_type === "meeting";
    if (filter === "slack") return c.source_type === "slack";
    if (filter === "gdoc") return c.source_type === "gdoc";
    return true;
  });
}

export function useKanban(filter: FilterKey): KanbanData {
  const now = new Date().toISOString();
  const mondayISO = getMondayOfWeek();

  const todoRaw = useLiveQuery(
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

  const inProgressRaw = useLiveQuery(
    () =>
      db.commitments
        .where("status")
        .equals("actioned")
        .toArray(),
    [],
    undefined,
  );

  const doneRaw = useLiveQuery(
    () =>
      db.commitments
        .where("status")
        .equals("done")
        .filter((c) => c.createdAt >= mondayISO)
        .toArray(),
    [],
    undefined,
  );

  const loading =
    todoRaw === undefined ||
    inProgressRaw === undefined ||
    doneRaw === undefined;

  const todo = applyFilter(todoRaw ?? [], filter);
  const inProgress = applyFilter(inProgressRaw ?? [], filter);
  const done = applyFilter(doneRaw ?? [], filter);

  // Counts across all columns (unfiltered) for FilterBar compatibility
  const allItems = [...(todoRaw ?? []), ...(inProgressRaw ?? [])];

  return {
    todo,
    inProgress,
    done,
    counts: {
      all: allItems.length,
      high: allItems.filter((c) => c.urgency === "high").length,
    },
    loading,
  };
}
