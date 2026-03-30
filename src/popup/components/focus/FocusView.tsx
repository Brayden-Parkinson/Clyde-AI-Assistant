import React, { useState, useMemo, useCallback } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@shared/db";
import { OS } from "@shared/tokens";
import type { Commitment, Person, CalendarEvent } from "@shared/types";
import {
  DEMO_ACTIVE,
  DEMO_PEOPLE,
  DEMO_CALENDAR_EVENTS,
  DEMO_SUGGESTIONS,
  DEMO_COMMITMENTS,
} from "@shared/demo-data";
import { dk } from "../../DarkModeContext";
import { Overdue, classifyOverdue } from "./Overdue";
import { RightNow } from "./RightNow";
import { UpcomingPrep } from "./UpcomingPrep";
import { Duplicates } from "./Duplicates";
import { CommandBar } from "./CommandBar";
import { rankCommitments, type RankedItem } from "./ranking";
import { detectDuplicates, type DuplicateGroup } from "./dedup";
import { generateMeetingPreps, type MeetingPrep } from "./prep";

interface Props {
  darkMode: boolean;
  demoMode: boolean;
}

export function FocusView({ darkMode, demoMode }: Props) {
  const [searchQuery, setSearchQuery] = useState("");
  const [mergedGroups, setMergedGroups] = useState<Set<string>>(new Set());
  const [markedDone, setMarkedDone] = useState<Set<number>>(new Set());

  // ── Data sources ──

  const liveCommitments = useLiveQuery(
    () => db.commitments.where("status").noneOf(["dismissed"]).toArray(),
    []
  );
  const livePeople = useLiveQuery(() => db.people.toArray(), []);
  const liveCalendar = useLiveQuery(() => db.calendar_cache.toArray(), []);

  const commitments: Commitment[] = demoMode
    ? [...DEMO_COMMITMENTS]
    : (liveCommitments ?? []);
  const people: Person[] = demoMode ? DEMO_PEOPLE : (livePeople ?? []);
  const calendar: CalendarEvent[] = demoMode ? DEMO_CALENDAR_EVENTS : (liveCalendar ?? []);

  const peopleByEmail = useMemo(
    () => new Map(people.filter((p) => p.email).map((p) => [p.email!, p])),
    [people]
  );

  // ── Computed sections ──

  const openCommitments = useMemo(
    () => commitments.filter((c) => c.status !== "done" && c.status !== "dismissed" && !markedDone.has(c.id!)),
    [commitments, markedDone]
  );

  const overdueItems = useMemo(
    () => classifyOverdue(openCommitments, people),
    [openCommitments, people]
  );

  // IDs already shown in overdue — exclude from "Coming up"
  const overdueIds = useMemo(
    () => new Set(overdueItems.map((i) => i.commitment.id!)),
    [overdueItems]
  );

  const nonOverdue = useMemo(
    () => openCommitments.filter((c) => !overdueIds.has(c.id!)),
    [openCommitments, overdueIds]
  );

  const ranked: RankedItem[] = useMemo(
    () => rankCommitments(nonOverdue, people, calendar, peopleByEmail, 5),
    [nonOverdue, people, calendar, peopleByEmail]
  );

  const preps: MeetingPrep[] = useMemo(
    () => generateMeetingPreps(calendar, openCommitments, people, peopleByEmail),
    [calendar, openCommitments, people, peopleByEmail]
  );

  const duplicates: DuplicateGroup[] = useMemo(
    () => detectDuplicates(openCommitments).filter((g) => !mergedGroups.has(g.id)),
    [openCommitments, mergedGroups]
  );

  const totalOpen = openCommitments.length;

  // ── Filter for search ──

  const filteredOverdue = searchQuery
    ? overdueItems.filter(
        (i) =>
          i.commitment.text.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (i.person?.name ?? "").toLowerCase().includes(searchQuery.toLowerCase()) ||
          i.commitment.context.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : overdueItems;

  const filteredRanked = searchQuery
    ? ranked.filter(
        (r) =>
          r.commitment.text.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (r.person?.name ?? "").toLowerCase().includes(searchQuery.toLowerCase()) ||
          r.commitment.context.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : ranked;

  // ── Actions ──

  const handleMarkDone = useCallback(
    async (id: number) => {
      setMarkedDone((s) => new Set(s).add(id));
      if (!demoMode) {
        await db.commitments.update(id, { status: "done" });
      }
    },
    [demoMode]
  );

  const handleMerge = useCallback((groupId: string) => {
    setMergedGroups((s) => new Set(s).add(groupId));
  }, []);

  const handleIgnore = useCallback((groupId: string) => {
    setMergedGroups((s) => new Set(s).add(groupId));
  }, []);

  return (
    <div
      style={{
        padding: "16px 20px",
        maxWidth: 720,
        margin: "0 auto",
        fontFamily: OS.font,
      }}
    >
      <CommandBar darkMode={darkMode} onSearch={setSearchQuery} />

      <Overdue
        items={filteredOverdue}
        darkMode={darkMode}
        onMarkDone={handleMarkDone}
      />

      <Duplicates
        groups={duplicates}
        darkMode={darkMode}
        onMerge={handleMerge}
        onIgnore={handleIgnore}
      />

      <RightNow
        items={filteredRanked}
        darkMode={darkMode}
        onMarkDone={handleMarkDone}
      />

      <UpcomingPrep preps={preps} darkMode={darkMode} />

      {/* Backlog footer */}
      <div
        style={{
          textAlign: "center",
          padding: "20px 0 12px",
          borderTop: `1px solid ${dk(darkMode, "rgba(255,255,255,0.06)", OS.border)}`,
          marginTop: 8,
        }}
      >
        <span
          style={{
            fontSize: 12,
            color: dk(darkMode, "rgba(255,255,255,0.30)", OS.muted),
          }}
        >
          {totalOpen} remaining items
        </span>
      </div>
    </div>
  );
}
