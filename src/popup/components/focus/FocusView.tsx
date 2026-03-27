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
import { RightNow } from "./RightNow";
import { AutoResolved } from "./AutoResolved";
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
  const liveSuggestions = useLiveQuery(
    () => db.completion_suggestions.where("status").equals("pending").toArray(),
    []
  );

  const commitments: Commitment[] = demoMode
    ? [...DEMO_COMMITMENTS]
    : (liveCommitments ?? []);
  const people: Person[] = demoMode ? DEMO_PEOPLE : (livePeople ?? []);
  const calendar: CalendarEvent[] = demoMode ? DEMO_CALENDAR_EVENTS : (liveCalendar ?? []);
  const suggestions = demoMode ? DEMO_SUGGESTIONS : (liveSuggestions ?? []);

  const peopleMap = useMemo(
    () => new Map(people.map((p) => [p.id!, p])),
    [people]
  );
  const peopleByEmail = useMemo(
    () => new Map(people.filter((p) => p.email).map((p) => [p.email!, p])),
    [people]
  );

  // ── Computed sections ──

  const openCommitments = useMemo(
    () => commitments.filter((c) => c.status !== "done" && c.status !== "dismissed" && !markedDone.has(c.id!)),
    [commitments, markedDone]
  );

  const ranked: RankedItem[] = useMemo(
    () => rankCommitments(openCommitments, people, calendar, peopleByEmail, 5),
    [openCommitments, people, calendar, peopleByEmail]
  );

  const autoResolved = useMemo(() => {
    // Items with completion suggestions or status=done
    const doneItems = commitments.filter((c) => c.status === "done" || c.likely_completed);
    return doneItems.slice(0, 5).map((c) => {
      // Try to find the matching person via context
      const person = people.find(
        (p) => c.context.toLowerCase().includes(p.name.toLowerCase().split(" ")[0])
      );
      const suggestion = suggestions.find((s) => s.commitmentId === c.id);
      return { commitment: c, person, evidence: suggestion?.evidence ?? c.completion_signal };
    });
  }, [commitments, people, suggestions]);

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

      <RightNow
        items={filteredRanked}
        darkMode={darkMode}
        onMarkDone={handleMarkDone}
      />

      <AutoResolved items={autoResolved} darkMode={darkMode} />

      <UpcomingPrep preps={preps} darkMode={darkMode} />

      <Duplicates
        groups={duplicates}
        darkMode={darkMode}
        onMerge={handleMerge}
        onIgnore={handleIgnore}
      />

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
