import React, { useState } from "react";
import { OS } from "@shared/tokens";
import { dk } from "../../DarkModeContext";
import { Avatar } from "./Avatar";
import { SectionHeader } from "./SectionHeader";
import type { Commitment, Person } from "@shared/types";

export interface OverdueItem {
  commitment: Commitment;
  person: Person | undefined;
  reason: string;
}

interface Props {
  items: OverdueItem[];
  darkMode: boolean;
  onMarkDone: (id: number) => void;
}

const MS_PER_DAY = 86400000;

export function classifyOverdue(
  commitments: Commitment[],
  people: Person[]
): OverdueItem[] {
  const now = Date.now();
  const results: OverdueItem[] = [];

  for (const c of commitments) {
    const person = people.find((p) => {
      const firstName = p.name.toLowerCase().split(" ")[0];
      return (
        c.context.toLowerCase().includes(firstName) ||
        c.context.toLowerCase().includes(p.name.toLowerCase())
      );
    });

    // Past explicit deadline
    if (c.deadline) {
      const dl = new Date(c.deadline).getTime();
      if (dl < now) {
        const daysOver = Math.round((now - dl) / MS_PER_DAY);
        results.push({
          commitment: c,
          person,
          reason:
            daysOver === 0
              ? "Due today"
              : daysOver === 1
                ? "1 day overdue"
                : `${daysOver} days overdue`,
        });
        continue;
      }
    }

    // Stale: no deadline but old and no activity
    const ageDays = (now - new Date(c.createdAt).getTime()) / MS_PER_DAY;
    const staleDays =
      (now - new Date(c.message_timestamp).getTime()) / MS_PER_DAY;

    if (ageDays > 7 && staleDays > 5) {
      results.push({
        commitment: c,
        person,
        reason: `No activity in ${Math.round(staleDays)} days`,
      });
    }
  }

  // Sort: explicit deadline overdue first, then by staleness
  results.sort((a, b) => {
    const aHasDeadline = a.commitment.deadline ? 1 : 0;
    const bHasDeadline = b.commitment.deadline ? 1 : 0;
    if (aHasDeadline !== bHasDeadline) return bHasDeadline - aHasDeadline;
    return (
      new Date(a.commitment.message_timestamp).getTime() -
      new Date(b.commitment.message_timestamp).getTime()
    );
  });

  return results;
}

export function Overdue({ items, darkMode, onMarkDone }: Props) {
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());
  const visible = items.filter((i) => !dismissed.has(i.commitment.id!));

  if (visible.length === 0) return null;

  return (
    <SectionHeader title="Overdue" count={visible.length} darkMode={darkMode}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {visible.map((item) => (
          <div
            key={item.commitment.id}
            style={{
              display: "flex",
              gap: 10,
              padding: "12px 14px",
              background: dk(darkMode, "rgba(255,255,255,0.03)", OS.white),
              borderRadius: 12,
              border: `1px solid ${dk(darkMode, "rgba(255,255,255,0.06)", OS.border)}`,
              borderLeft: `3px solid ${OS.red}`,
            }}
          >
            {item.person && (
              <Avatar
                name={item.person.name}
                relationship={item.person.relationship}
              />
            )}

            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: dk(darkMode, "rgba(255,255,255,0.90)", OS.text),
                  marginBottom: 3,
                  lineHeight: 1.3,
                  fontFamily: OS.font,
                }}
              >
                {item.commitment.text}
              </div>

              <div
                style={{
                  fontSize: 11,
                  color: OS.red,
                  fontWeight: 500,
                  marginBottom: 5,
                  fontFamily: OS.font,
                }}
              >
                {item.reason}
              </div>

              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {item.person && (
                  <span
                    style={{
                      fontSize: 10,
                      color: dk(darkMode, "rgba(255,255,255,0.35)", OS.muted),
                      background: dk(
                        darkMode,
                        "rgba(255,255,255,0.05)",
                        OS.bg
                      ),
                      padding: "1px 7px",
                      borderRadius: 9999,
                      fontFamily: OS.font,
                    }}
                  >
                    {item.person.name}
                  </span>
                )}
                <span
                  style={{
                    fontSize: 10,
                    color: dk(darkMode, "rgba(255,255,255,0.25)", OS.faint),
                    background: dk(
                      darkMode,
                      "rgba(255,255,255,0.03)",
                      "rgba(0,0,0,0.03)"
                    ),
                    padding: "1px 7px",
                    borderRadius: 9999,
                    fontFamily: OS.font,
                  }}
                >
                  {item.commitment.context}
                </span>
              </div>
            </div>

            <button
              onClick={() => {
                setDismissed((s) => new Set(s).add(item.commitment.id!));
                setTimeout(() => onMarkDone(item.commitment.id!), 200);
              }}
              style={{
                alignSelf: "flex-start",
                background: "transparent",
                border: `1px solid ${dk(darkMode, "rgba(255,255,255,0.08)", OS.border)}`,
                borderRadius: 6,
                color: dk(darkMode, "rgba(255,255,255,0.35)", OS.muted),
                fontSize: 11,
                padding: "3px 9px",
                cursor: "pointer",
                whiteSpace: "nowrap",
                transition: "all 150ms",
                fontFamily: OS.font,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = OS.green;
                e.currentTarget.style.color = OS.green;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = dk(
                  darkMode,
                  "rgba(255,255,255,0.08)",
                  OS.border
                );
                e.currentTarget.style.color = dk(
                  darkMode,
                  "rgba(255,255,255,0.35)",
                  OS.muted
                );
              }}
            >
              Done
            </button>
          </div>
        ))}
      </div>
    </SectionHeader>
  );
}
