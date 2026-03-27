import React from "react";
import { OS } from "@shared/tokens";
import type { Commitment, Person } from "@shared/types";
import { dk } from "../../DarkModeContext";
import { SectionHeader } from "./SectionHeader";

interface ResolvedItem {
  commitment: Commitment;
  person: Person | undefined;
  evidence: string | null | undefined;
}

interface Props {
  items: ResolvedItem[];
  darkMode: boolean;
}

function resolutionLabel(item: ResolvedItem): { icon: string; text: string } {
  const c = item.commitment;
  if (c.completion_signal) {
    return { icon: "💬", text: c.completion_signal };
  }
  if (item.evidence) {
    return { icon: "✅", text: item.evidence };
  }
  return { icon: "✓", text: "Detected as complete" };
}

export function AutoResolved({ items, darkMode }: Props) {
  if (items.length === 0) return null;

  return (
    <SectionHeader title="Auto-resolved" count={items.length} collapsible darkMode={darkMode}>
      <div
        style={{
          background: dk(darkMode, "rgba(255,255,255,0.03)", OS.white),
          borderRadius: 12,
          border: `1px solid ${dk(darkMode, "rgba(255,255,255,0.06)", OS.border)}`,
          overflow: "hidden",
        }}
      >
        {items.map((item, i) => {
          const label = resolutionLabel(item);
          return (
            <div
              key={item.commitment.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "9px 14px",
                borderBottom:
                  i < items.length - 1
                    ? `1px solid ${dk(darkMode, "rgba(255,255,255,0.04)", "rgba(0,0,0,0.04)")}`
                    : "none",
              }}
            >
              <span style={{ fontSize: 12, flexShrink: 0, width: 16, textAlign: "center" }}>
                {label.icon}
              </span>

              <span
                style={{
                  flex: 1,
                  fontSize: 12,
                  color: dk(darkMode, "rgba(255,255,255,0.35)", OS.muted),
                  textDecoration: "line-through",
                  textDecorationColor: dk(darkMode, "rgba(255,255,255,0.15)", "rgba(0,0,0,0.15)"),
                  fontFamily: OS.font,
                }}
              >
                {item.commitment.text}
              </span>

              <span
                style={{
                  fontSize: 10,
                  color: OS.green,
                  background: dk(darkMode, "rgba(34,197,94,0.10)", "rgba(59,140,95,0.08)"),
                  padding: "2px 8px",
                  borderRadius: 9999,
                  whiteSpace: "nowrap",
                  maxWidth: 220,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  fontFamily: OS.font,
                }}
              >
                {label.text}
              </span>
            </div>
          );
        })}
      </div>
    </SectionHeader>
  );
}
