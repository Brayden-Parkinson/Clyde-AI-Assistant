import React from "react";
import { OS } from "@shared/tokens";
import { IconSearch } from "./Icons";
import type { FilterKey } from "./FilterBar";
import type { Commitment } from "@shared/types";

interface ViewToolbarProps {
  filter: FilterKey;
  onFilterChange: (key: FilterKey) => void;
  search: string;
  onSearchChange: (q: string) => void;
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

export function ViewToolbar({ filter, onFilterChange, search, onSearchChange }: ViewToolbarProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 0",
        marginBottom: 8,
      }}
    >
      {/* Filter dropdown */}
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
          onChange={(e) => onFilterChange(e.target.value as FilterKey)}
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

      {/* Search input */}
      <div style={{ flex: 1, position: "relative" }}>
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search commitments..."
          style={{
            width: "100%",
            fontSize: 12,
            fontFamily: OS.font,
            color: OS.text,
            background: OS.white,
            border: `1px solid ${OS.border}`,
            borderRadius: 6,
            padding: "5px 28px 5px 10px",
            outline: "none",
            boxSizing: "border-box",
          }}
        />
        <span
          style={{
            position: "absolute",
            right: 8,
            top: "50%",
            transform: "translateY(-50%)",
            color: OS.muted,
            pointerEvents: "none",
            display: "inline-flex",
            alignItems: "center",
          }}
        >
          <IconSearch size={13} />
        </span>
      </div>
    </div>
  );
}

export function matchesSearch(c: Commitment, q: string): boolean {
  if (!q) return true;
  const lower = q.toLowerCase();
  return (
    c.text.toLowerCase().includes(lower) ||
    c.context.toLowerCase().includes(lower) ||
    c.original_quote.toLowerCase().includes(lower)
  );
}
