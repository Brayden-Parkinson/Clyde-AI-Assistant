import React from "react";
import { OS } from "@shared/tokens";

export type FilterKey = "all" | "high" | "meetings" | "slack" | "confident";

interface FilterBarProps {
  filter: FilterKey;
  setFilter: (key: FilterKey) => void;
  counts: { all: number; high: number };
}

export function FilterBar({ filter, setFilter, counts }: FilterBarProps) {
  const filters: Array<{ key: FilterKey; label: string }> = [
    { key: "all", label: `All (${counts.all})` },
    { key: "high", label: `Urgent (${counts.high})` },
    { key: "meetings", label: "Meetings" },
    { key: "slack", label: "Slack" },
    { key: "confident", label: "High confidence" },
  ];

  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {filters.map((f) => {
        const active = filter === f.key;
        return (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            style={{
              padding: "6px 14px",
              borderRadius: 8,
              fontSize: 12,
              fontWeight: active ? 700 : 500,
              fontFamily: OS.font,
              background: active ? OS.blue : OS.white,
              border: `1.5px solid ${active ? OS.blue : OS.border}`,
              color: active ? OS.white : OS.textSecondary,
              cursor: "pointer",
              transition: "all 0.15s ease",
              boxShadow: active
                ? "0 1px 4px rgba(43,103,219,0.2)"
                : "none",
            }}
          >
            {f.label}
          </button>
        );
      })}
    </div>
  );
}
