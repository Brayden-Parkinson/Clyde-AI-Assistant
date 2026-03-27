import React, { useState } from "react";
import { OS } from "@shared/tokens";
import { dk } from "../../DarkModeContext";
import { Avatar } from "./Avatar";
import { SectionHeader } from "./SectionHeader";
import type { RankedItem } from "./ranking";

interface Props {
  items: RankedItem[];
  darkMode: boolean;
  onMarkDone: (id: number) => void;
}

const accentColor = {
  hot: OS.red,
  warm: OS.warning,
  neutral: "transparent",
};

export function RightNow({ items, darkMode, onMarkDone }: Props) {
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());

  if (items.length === 0) {
    return (
      <SectionHeader title="Right now" count={0} darkMode={darkMode}>
        <div
          style={{
            padding: "32px 20px",
            textAlign: "center",
            background: dk(darkMode, "rgba(255,255,255,0.03)", OS.white),
            borderRadius: 12,
            border: `1px solid ${dk(darkMode, "rgba(255,255,255,0.06)", OS.border)}`,
          }}
        >
          <div style={{ fontSize: 20, marginBottom: 6 }}>✓</div>
          <div style={{ color: dk(darkMode, "rgba(255,255,255,0.55)", OS.secondary), fontSize: 13 }}>
            You're caught up
          </div>
          <div style={{ color: dk(darkMode, "rgba(255,255,255,0.25)", OS.faint), fontSize: 12, marginTop: 3 }}>
            Nothing urgent needs your attention right now
          </div>
        </div>
      </SectionHeader>
    );
  }

  return (
    <SectionHeader title="Right now" count={items.length} darkMode={darkMode}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {items.map((item) => {
          const isDismissed = dismissed.has(item.commitment.id!);
          return (
            <div
              key={item.commitment.id}
              style={{
                display: "flex",
                gap: 10,
                padding: "12px 14px",
                background: dk(darkMode, "rgba(255,255,255,0.03)", OS.white),
                borderRadius: 12,
                border: `1px solid ${dk(darkMode, "rgba(255,255,255,0.06)", OS.border)}`,
                borderLeft: `3px solid ${accentColor[item.heatLevel]}`,
                opacity: isDismissed ? 0 : 1,
                transform: isDismissed ? "translateX(20px)" : "translateX(0)",
                transition: "opacity 150ms, transform 150ms",
                maxHeight: isDismissed ? 0 : 200,
                overflow: "hidden",
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
                    color:
                      item.heatLevel === "hot"
                        ? OS.red
                        : item.heatLevel === "warm"
                          ? OS.warning
                          : dk(darkMode, "rgba(255,255,255,0.45)", OS.secondary),
                    fontWeight: item.heatLevel === "hot" ? 500 : 400,
                    marginBottom: 5,
                    fontFamily: OS.font,
                  }}
                >
                  {item.whyNow}
                </div>

                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {item.person && (
                    <span
                      style={{
                        fontSize: 10,
                        color: dk(darkMode, "rgba(255,255,255,0.35)", OS.muted),
                        background: dk(darkMode, "rgba(255,255,255,0.05)", OS.bg),
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
                      background: dk(darkMode, "rgba(255,255,255,0.03)", "rgba(0,0,0,0.03)"),
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
                  e.currentTarget.style.borderColor = dk(darkMode, "rgba(255,255,255,0.08)", OS.border);
                  e.currentTarget.style.color = dk(darkMode, "rgba(255,255,255,0.35)", OS.muted);
                }}
              >
                Done
              </button>
            </div>
          );
        })}
      </div>
    </SectionHeader>
  );
}
