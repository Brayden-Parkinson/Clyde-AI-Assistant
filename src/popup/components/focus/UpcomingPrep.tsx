import React from "react";
import { OS } from "@shared/tokens";
import { dk } from "../../DarkModeContext";
import { Avatar } from "./Avatar";
import { SectionHeader } from "./SectionHeader";
import type { MeetingPrep } from "./prep";

interface Props {
  preps: MeetingPrep[];
  darkMode: boolean;
}

const MAX_VISIBLE = 4;
const PURPLE = "#a78bfa";

export function UpcomingPrep({ preps, darkMode }: Props) {
  if (preps.length === 0) return null;

  return (
    <SectionHeader title="Upcoming prep" count={preps.length} darkMode={darkMode}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {preps.map((prep) => {
          const time = new Date(prep.event.startTime).toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
          });
          const visible = prep.openItems.slice(0, MAX_VISIBLE);
          const remaining = prep.openItems.length - MAX_VISIBLE;

          return (
            <div
              key={prep.event.id}
              style={{
                flex: "1 1 280px",
                maxWidth: 380,
                background: dk(darkMode, "rgba(255,255,255,0.03)", OS.white),
                borderRadius: 12,
                border: `1px solid ${dk(darkMode, "rgba(255,255,255,0.06)", OS.border)}`,
                borderTop: `3px solid ${PURPLE}`,
                padding: 14,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <Avatar name={prep.attendee.name} relationship={prep.attendee.relationship} size={28} />
                <div>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      color: dk(darkMode, "rgba(255,255,255,0.90)", OS.text),
                      fontFamily: OS.font,
                    }}
                  >
                    {prep.event.title}
                  </div>
                  <div style={{ fontSize: 11, color: PURPLE, fontFamily: OS.font }}>
                    {time}
                    {prep.overdueCount > 0 && (
                      <span style={{ color: OS.red, marginLeft: 8 }}>
                        {prep.overdueCount} overdue
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {visible.map((item) => {
                  const isOverdue =
                    (item.deadline && new Date(item.deadline).getTime() < Date.now()) ||
                    ((Date.now() - new Date(item.createdAt).getTime()) / 86400000 > 5 && item.status === "new");
                  return (
                    <div
                      key={item.id}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 6,
                        fontSize: 12,
                        lineHeight: 1.4,
                      }}
                    >
                      <span
                        style={{
                          color: isOverdue ? OS.red : dk(darkMode, "rgba(255,255,255,0.20)", OS.faint),
                          fontSize: 7,
                          marginTop: 5,
                          flexShrink: 0,
                        }}
                      >
                        ●
                      </span>
                      <span
                        style={{
                          color: isOverdue ? OS.red : dk(darkMode, "rgba(255,255,255,0.55)", OS.secondary),
                          fontWeight: isOverdue ? 500 : 400,
                          fontFamily: OS.font,
                        }}
                      >
                        {item.text}
                      </span>
                    </div>
                  );
                })}
                {remaining > 0 && (
                  <div style={{ fontSize: 11, color: dk(darkMode, "rgba(255,255,255,0.20)", OS.faint), paddingLeft: 13, fontFamily: OS.font }}>
                    +{remaining} more
                  </div>
                )}
                {prep.openItems.length === 0 && (
                  <div style={{ fontSize: 12, color: dk(darkMode, "rgba(255,255,255,0.25)", OS.faint), fontStyle: "italic", fontFamily: OS.font }}>
                    No open items — you're all set
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </SectionHeader>
  );
}
