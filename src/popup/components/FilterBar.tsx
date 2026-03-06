import React from "react";
import { OS } from "@shared/tokens";

export type FilterKey = "all" | "overdue" | "has_deadline" | "high" | "meetings" | "slack" | "gdoc";

interface FilterBarProps {
  filter: FilterKey;
  setFilter: (key: FilterKey) => void;
}

const filters: Array<{ key: FilterKey; label: string }> = [
  { key: "all", label: "All" },
  { key: "overdue", label: "Overdue" },
  { key: "has_deadline", label: "Has deadline" },
  { key: "high", label: "High priority" },
  { key: "meetings", label: "Meetings" },
  { key: "slack", label: "Slack" },
  { key: "gdoc", label: "Google Docs" },
];

export function FilterBar({ filter, setFilter }: FilterBarProps) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <label
        style={{
          fontSize: 12,
          fontWeight: 500,
          fontFamily: OS.font,
          color: OS.muted,
          whiteSpace: "nowrap",
        }}
      >
        Filter:
      </label>
      <select
        value={filter}
        onChange={(e) => setFilter(e.target.value as FilterKey)}
        style={{
          fontSize: 12,
          fontWeight: 500,
          fontFamily: OS.font,
          color: OS.text,
          background: OS.white,
          border: `1px solid ${OS.border}`,
          borderRadius: 6,
          padding: "4px 8px",
          cursor: "pointer",
          outline: "none",
        }}
      >
        {filters.map((f) => (
          <option key={f.key} value={f.key}>
            {f.label}
          </option>
        ))}
      </select>
    </div>
  );
}
