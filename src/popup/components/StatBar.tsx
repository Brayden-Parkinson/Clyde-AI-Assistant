import React from "react";
import { OS } from "@shared/tokens";

interface StatBarProps {
  stats: { actioned: number; dismissed: number };
}

export function StatBar({ stats }: StatBarProps) {
  const items = [
    { label: "Actioned", value: String(stats.actioned), color: OS.green },
    { label: "Dismissed", value: String(stats.dismissed), color: OS.red },
    { label: "Last scan", value: "3m ago", color: OS.muted },
  ];

  return (
    <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
      {items.map((s) => (
        <div
          key={s.label}
          style={{ display: "flex", alignItems: "center", gap: 6 }}
        >
          <span
            style={{ fontSize: 11, color: OS.muted, fontFamily: OS.font }}
          >
            {s.label}
          </span>
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: s.color,
              fontFamily: "monospace",
            }}
          >
            {s.value}
          </span>
        </div>
      ))}
    </div>
  );
}
