import { useCallback } from "react";
import { db } from "@shared/db";
import type { Commitment } from "@shared/types";

export interface Actions {
  handleDismiss: (id: number) => Promise<string>;
  handleClose: (id: number) => Promise<string>;
  handleDone: (id: number) => Promise<string>;
  handleSnooze: (id: number) => Promise<string>;
  handleCalendar: (commitment: Commitment) => Promise<string>;
  handleSlack: (commitment: Commitment) => Promise<string>;
  handleReminder: (id: number, minutes: number) => Promise<string>;
  handleStartWorking: (id: number) => Promise<string>;
  handleReopen: (id: number) => Promise<string>;
}

function formatCalendarDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export function useActions(): Actions {
  const handleDismiss = useCallback(async (id: number): Promise<string> => {
    const commitment = await db.commitments.get(id);
    if (!commitment) return "Commitment not found";

    await db.commitments.update(id, { status: "dismissed" });

    // Save or increment dismissal pattern
    const existing = await db.dismissals
      .where("pattern")
      .equals(commitment.original_quote)
      .first();

    if (existing && existing.id != null) {
      await db.dismissals.update(existing.id, { count: existing.count + 1 });
    } else {
      await db.dismissals.add({
        pattern: commitment.original_quote,
        reason: "User dismissed",
        count: 1,
        createdAt: new Date().toISOString(),
      });
    }

    await db.action_log.add({
      commitmentId: id,
      action: "dismissed",
      createdAt: new Date().toISOString(),
    });

    const snippet = commitment.original_quote.slice(0, 35);
    return `Dismissed — learning from "${snippet}..."`;
  }, []);

  const handleClose = useCallback(async (id: number): Promise<string> => {
    await db.commitments.update(id, { status: "dismissed" });
    await db.action_log.add({
      commitmentId: id,
      action: "dismissed",
      createdAt: new Date().toISOString(),
    });
    return "Closed";
  }, []);

  const handleDone = useCallback(async (id: number): Promise<string> => {
    await db.commitments.update(id, { status: "done" });
    await db.action_log.add({
      commitmentId: id,
      action: "done",
      createdAt: new Date().toISOString(),
    });
    return "Marked complete";
  }, []);

  const handleSnooze = useCallback(async (id: number): Promise<string> => {
    const snoozeUntil = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await db.commitments.update(id, {
      status: "snoozed",
      snooze_until: snoozeUntil,
    });
    await db.action_log.add({
      commitmentId: id,
      action: "snooze",
      createdAt: new Date().toISOString(),
    });
    return "Snoozed for 1 hour";
  }, []);

  const handleCalendar = useCallback(
    async (commitment: Commitment): Promise<string> => {
      let start: Date;
      if (commitment.deadline) {
        start = new Date(
          new Date(commitment.deadline).getTime() - 30 * 60 * 1000,
        );
      } else {
        const now = new Date();
        const minutes = now.getMinutes();
        const roundUp = minutes <= 30 ? 30 - minutes : 60 - minutes;
        start = new Date(now.getTime() + roundUp * 60 * 1000);
      }
      const end = new Date(start.getTime() + 30 * 60 * 1000);

      const details = `${commitment.original_quote}\n\nSource: ${commitment.context}`;
      const url =
        `https://calendar.google.com/calendar/render?action=TEMPLATE` +
        `&text=${encodeURIComponent(commitment.text)}` +
        `&details=${encodeURIComponent(details)}` +
        `&dates=${formatCalendarDate(start)}/${formatCalendarDate(end)}`;

      window.open(url, "_blank");

      if (commitment.id != null) {
        await db.commitments.update(commitment.id, { status: "actioned" });
        await db.action_log.add({
          commitmentId: commitment.id,
          action: "calendar",
          createdAt: new Date().toISOString(),
        });
      }

      return "Calendar event created";
    },
    [],
  );

  const handleSlack = useCallback(
    async (commitment: Commitment): Promise<string> => {
      // Try to open the relevant Slack channel
      const channel = commitment.context.replace(/^#/, "");
      const url = `https://app.slack.com/client/T00000000/${channel}`;
      window.open(url, "_blank");

      if (commitment.id != null) {
        await db.commitments.update(commitment.id, { status: "actioned" });
        await db.action_log.add({
          commitmentId: commitment.id,
          action: "slack",
          createdAt: new Date().toISOString(),
        });
      }

      return "Opening Slack...";
    },
    [],
  );

  const handleReminder = useCallback(
    async (id: number, minutes: number): Promise<string> => {
      if (typeof chrome !== "undefined" && chrome.alarms) {
        await chrome.alarms.create(`reminder-${id}`, {
          delayInMinutes: minutes,
        });
      }

      await db.commitments.update(id, { status: "actioned" });
      await db.action_log.add({
        commitmentId: id,
        action: "reminder",
        createdAt: new Date().toISOString(),
      });

      return `Reminder set for ${minutes} min`;
    },
    [],
  );

  const handleStartWorking = useCallback(async (id: number): Promise<string> => {
    await db.commitments.update(id, { status: "actioned" });
    await db.action_log.add({
      commitmentId: id,
      action: "started",
      createdAt: new Date().toISOString(),
    });
    return "Moved to In Progress";
  }, []);

  const handleReopen = useCallback(async (id: number): Promise<string> => {
    await db.commitments.update(id, { status: "new" });
    return "Moved back to Todo";
  }, []);

  return {
    handleDismiss,
    handleClose,
    handleDone,
    handleSnooze,
    handleCalendar,
    handleSlack,
    handleReminder,
    handleStartWorking,
    handleReopen,
  };
}
