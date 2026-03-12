import React, { useState, useEffect, useRef } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { OS } from "@shared/tokens";
import { db } from "@shared/db";
import type { Commitment, MorningBrief, CalendarEvent, DailyReview } from "@shared/types";
import { DEMO_BRIEFS } from "@shared/demo-data";

// ─── Action Badge Colors ───

const ACTION_COLORS: Record<string, { bg: string; text: string }> = {
  calendar: { bg: OS.blueBg, text: OS.blue },
  do: { bg: "#f0fdf4", text: OS.green },
  delegate: { bg: OS.yellowBg, text: OS.yellowText },
  prep: { bg: "#faf5ff", text: "#7c3aed" },
};

// ─── Helper: format time from ISO string ───

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  } catch {
    return iso;
  }
}

function formatTimeRange(start: string, end: string): string {
  return `${formatTime(start)} - ${formatTime(end)}`;
}

// ─── Demo calendar events ───

const DEMO_CALENDAR_EVENTS: Array<{ title: string; startTime: string; endTime: string }> = (() => {
  const now = new Date();
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return [
    {
      title: "Team Standup",
      startTime: new Date(base.getTime() + 9 * 3600000).toISOString(),
      endTime: new Date(base.getTime() + 9.5 * 3600000).toISOString(),
    },
    {
      title: "Focus Block",
      startTime: new Date(base.getTime() + 10 * 3600000).toISOString(),
      endTime: new Date(base.getTime() + 12 * 3600000).toISOString(),
    },
    {
      title: "1:1 with Jordan",
      startTime: new Date(base.getTime() + 14 * 3600000).toISOString(),
      endTime: new Date(base.getTime() + 14.5 * 3600000).toISOString(),
    },
  ];
})();

// ─── DailyPlanner Component ───

export function DailyPlanner({
  commitments,
  demoMode,
  showToast,
}: {
  commitments: Commitment[];
  demoMode: boolean;
  showToast: (msg: string, variant?: "success" | "error") => void;
}) {
  const todayDateStr = new Date().toISOString().slice(0, 10);

  // ─── Data queries ───

  const liveBriefs = useLiveQuery(
    () => db.briefs.where("date").equals(todayDateStr).first(),
    [todayDateStr]
  );
  const todayBrief: MorningBrief | undefined = demoMode
    ? DEMO_BRIEFS.find(b => b.date === todayDateStr) ?? DEMO_BRIEFS[0]
    : liveBriefs ?? undefined;

  const liveCalendar = useLiveQuery(
    () => db.calendar_cache.toArray(),
    []
  ) ?? [];
  const todayCalendarEvents = demoMode
    ? DEMO_CALENDAR_EVENTS
    : liveCalendar
        .filter((e: CalendarEvent) => e.startTime.startsWith(todayDateStr))
        .sort((a: CalendarEvent, b: CalendarEvent) => a.startTime.localeCompare(b.startTime))
        .map((e: CalendarEvent) => ({ title: e.title, startTime: e.startTime, endTime: e.endTime }));

  const liveReview = useLiveQuery(
    () => db.daily_reviews.where("date").equals(todayDateStr).first(),
    [todayDateStr]
  );
  const todayReview: DailyReview | undefined = demoMode ? undefined : liveReview ?? undefined;

  // ─── Local state ───

  const [dayIntention, setDayIntention] = useState("");
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [reviewGenerating, setReviewGenerating] = useState(false);
  const [userNotes, setUserNotes] = useState("");
  const autoGenTriggered = useRef(false);

  // Load day intention from brief if available
  useEffect(() => {
    if (todayBrief?.dayIntention) {
      setDayIntention(todayBrief.dayIntention);
    }
  }, [todayBrief?.dayIntention]);

  // Load user notes from review if available
  useEffect(() => {
    if (todayReview?.userNotes) {
      setUserNotes(todayReview.userNotes);
    }
  }, [todayReview?.userNotes]);

  // Auto-generate brief when viewing this tab if none exists
  useEffect(() => {
    if (demoMode || todayBrief || autoGenTriggered.current) return;
    autoGenTriggered.current = true;
    handleGenerateBrief();
  }, [todayBrief, demoMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Handlers ───

  const handleGenerateBrief = async () => {
    if (demoMode) return;
    setGenerating(true);
    setGenError(null);
    try {
      const response = await chrome.runtime.sendMessage({ type: "GENERATE_MORNING_BRIEF" });
      if (!response?.ok) setGenError(response?.error ?? "Generation failed — check API key and try again");
    } catch (err) {
      setGenError(err instanceof Error ? err.message : "Failed to reach background worker");
    } finally {
      setGenerating(false);
    }
  };

  const handleSaveIntention = async () => {
    if (demoMode) {
      showToast("Demo mode — changes not saved", "error");
      return;
    }
    if (todayBrief?.id != null) {
      await db.briefs.update(todayBrief.id, { dayIntention, planningState: "planned" });
      showToast("Intention saved", "success");
    }
  };

  const handleStartReview = async () => {
    if (demoMode) {
      showToast("Demo mode — review not generated", "error");
      return;
    }
    setReviewGenerating(true);
    try {
      const response = await chrome.runtime.sendMessage({ type: "GENERATE_DAILY_REVIEW" });
      if (!response?.ok) {
        showToast(response?.error ?? "Review generation failed", "error");
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to reach background worker", "error");
    } finally {
      setReviewGenerating(false);
    }
  };

  const handleSaveUserNotes = async () => {
    if (demoMode) {
      showToast("Demo mode — changes not saved", "error");
      return;
    }
    if (todayReview?.id != null) {
      await db.daily_reviews.update(todayReview.id, { userNotes: userNotes || null });
      showToast("Notes saved", "success");
    }
  };

  // ─── Render ───

  return (
    <div style={{ fontFamily: OS.font, paddingTop: 0 }}>

      {/* Auto-generating indicator */}
      {!todayBrief && generating && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: "16px", background: OS.white, borderBottom: `1px solid ${OS.border}`,
          fontSize: 13, color: OS.muted, gap: 8,
        }}>
          Building your daily plan...
        </div>
      )}

      {genError && (
        <div style={{
          margin: "12px 16px 0", padding: "8px 12px",
          background: OS.bg, color: OS.red, fontSize: 12, borderRadius: 6,
          border: `1px solid ${OS.border}`,
        }}>
          {genError}
        </div>
      )}

      {/* No brief + not generating */}
      {!todayBrief && !generating && (
        <div style={{ textAlign: "center", padding: "52px 16px" }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: OS.text, marginBottom: 6 }}>
            No brief yet
          </div>
          <div style={{ fontSize: 13, color: OS.muted, lineHeight: 1.6, marginBottom: 16 }}>
            Check your API key in settings and try again.
          </div>
          <button
            onClick={handleGenerateBrief}
            style={{
              padding: "6px 14px", fontSize: 12, fontWeight: 600,
              background: OS.blue, color: OS.white, border: "none",
              borderRadius: 6, cursor: "pointer",
            }}
          >
            Generate Brief
          </button>
        </div>
      )}

      {/* Main planner content */}
      {todayBrief && (
        <>
          {/* Section 1: Day Header */}
          <div style={{
            padding: "16px 16px 12px", background: OS.white,
            borderBottom: `1px solid ${OS.border}`,
          }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: OS.text, marginBottom: 8 }}>
              {todayBrief.greeting}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="text"
                placeholder="What's your focus today?"
                value={dayIntention}
                onChange={(e) => setDayIntention(e.target.value)}
                onBlur={handleSaveIntention}
                onKeyDown={(e) => { if (e.key === "Enter") handleSaveIntention(); }}
                style={{
                  flex: 1, padding: "7px 10px", fontSize: 13,
                  border: `1px solid ${OS.border}`, borderRadius: 6,
                  fontFamily: OS.font, color: OS.text,
                  background: OS.bg, outline: "none",
                }}
              />
            </div>
          </div>

          {/* Section 2: Calendar Timeline */}
          {todayCalendarEvents.length > 0 && (
            <div style={{ padding: "12px 16px", background: OS.white, borderBottom: `1px solid ${OS.border}` }}>
              <div style={{
                fontSize: 11, fontWeight: 600, color: OS.muted,
                textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8,
              }}>
                Calendar
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {todayCalendarEvents.map((event, i) => (
                  <div key={i} style={{
                    display: "flex", alignItems: "flex-start", gap: 10,
                  }}>
                    <div style={{
                      fontSize: 11, color: OS.muted, fontFamily: OS.mono,
                      minWidth: 72, flexShrink: 0, paddingTop: 2,
                    }}>
                      {formatTime(event.startTime)}
                    </div>
                    <div style={{
                      flex: 1, padding: "6px 10px",
                      background: OS.blueBg, borderRadius: 6,
                      borderLeft: `3px solid ${OS.blue}`,
                    }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: OS.text }}>
                        {event.title}
                      </div>
                      <div style={{ fontSize: 11, color: OS.muted, marginTop: 2 }}>
                        {formatTimeRange(event.startTime, event.endTime)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {todayCalendarEvents.length === 0 && (
            <div style={{
              padding: "10px 16px", background: OS.white,
              borderBottom: `1px solid ${OS.border}`,
              fontSize: 12, color: OS.faint,
            }}>
              No calendar events for today
            </div>
          )}

          {/* Section 3: Priorities */}
          {todayBrief.priorities.length > 0 && (
            <div style={{ padding: "12px 16px", background: OS.white, borderBottom: `1px solid ${OS.border}` }}>
              <div style={{
                fontSize: 11, fontWeight: 600, color: OS.muted,
                textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8,
              }}>
                Priorities
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {todayBrief.priorities.map((priority, i) => {
                  const actionStyle = ACTION_COLORS[priority.action] ?? ACTION_COLORS.do;
                  return (
                    <div key={i} style={{
                      padding: "10px 12px", background: OS.bg,
                      borderRadius: 8, border: `1px solid ${OS.border}`,
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: OS.text, flex: 1 }}>
                          {priority.text}
                        </span>
                        <span style={{
                          fontSize: 10, fontWeight: 600, padding: "2px 6px",
                          borderRadius: 4, background: actionStyle.bg, color: actionStyle.text,
                          textTransform: "uppercase", letterSpacing: "0.03em", flexShrink: 0,
                        }}>
                          {priority.action}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: OS.secondary, lineHeight: 1.5 }}>
                        {priority.reason}
                      </div>
                      {priority.suggestedTime && (
                        <div style={{ fontSize: 11, color: OS.muted, marginTop: 4 }}>
                          Suggested: {priority.suggestedTime}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Section 4: Schedule Suggestion */}
          {todayBrief.scheduleSuggestion && (
            <div style={{ padding: "12px 16px", background: OS.white, borderBottom: `1px solid ${OS.border}` }}>
              <div style={{
                fontSize: 11, fontWeight: 600, color: OS.muted,
                textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8,
              }}>
                Suggested Schedule
              </div>
              <div style={{
                fontSize: 13, color: OS.secondary, lineHeight: 1.6,
                padding: "10px 12px", background: OS.bg, borderRadius: 6,
                border: `1px solid ${OS.border}`,
              }}>
                {todayBrief.scheduleSuggestion}
              </div>
            </div>
          )}

          {/* Section 5: EOD Review */}
          <div style={{ padding: "12px 16px", background: OS.white, borderBottom: `1px solid ${OS.border}` }}>
            <div style={{
              fontSize: 11, fontWeight: 600, color: OS.muted,
              textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8,
            }}>
              End of Day Review
            </div>

            {todayReview ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {/* Completed count */}
                <div style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "8px 12px", background: "#f0fdf4", borderRadius: 6,
                  border: `1px solid ${OS.green}20`,
                }}>
                  <span style={{ fontSize: 20, fontWeight: 700, color: OS.green }}>
                    {todayReview.completedItems.length}
                  </span>
                  <span style={{ fontSize: 12, color: OS.secondary }}>
                    {todayReview.completedItems.length === 1 ? "item completed" : "items completed"} today
                  </span>
                </div>

                {/* Reflection */}
                <div style={{
                  fontSize: 13, color: OS.secondary, lineHeight: 1.6,
                  padding: "10px 12px", background: OS.bg, borderRadius: 6,
                  border: `1px solid ${OS.border}`, whiteSpace: "pre-line",
                }}>
                  {todayReview.reflection}
                </div>

                {/* User notes */}
                <textarea
                  placeholder="Add your own notes about today..."
                  value={userNotes}
                  onChange={(e) => setUserNotes(e.target.value)}
                  onBlur={handleSaveUserNotes}
                  style={{
                    width: "100%", minHeight: 60, padding: "8px 10px",
                    fontSize: 12, fontFamily: OS.font, color: OS.text,
                    border: `1px solid ${OS.border}`, borderRadius: 6,
                    background: OS.white, outline: "none", resize: "vertical",
                    boxSizing: "border-box",
                  }}
                />
              </div>
            ) : (
              <div style={{ textAlign: "center", padding: "16px 0" }}>
                <div style={{ fontSize: 12, color: OS.muted, marginBottom: 10 }}>
                  Reflect on what you accomplished today
                </div>
                <button
                  onClick={handleStartReview}
                  disabled={reviewGenerating}
                  style={{
                    padding: "6px 14px", fontSize: 12, fontWeight: 600,
                    background: reviewGenerating ? OS.faint : OS.blue,
                    color: OS.white, border: "none", borderRadius: 6,
                    cursor: reviewGenerating ? "default" : "pointer",
                    opacity: reviewGenerating ? 0.7 : 1,
                  }}
                >
                  {reviewGenerating ? "Generating..." : "Start Review"}
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
