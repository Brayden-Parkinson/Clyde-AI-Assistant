import React from "react";
import { OS } from "@shared/tokens";
import { IconSearch } from "./Icons";
import type { FilterKey } from "./FilterBar";
import type { Commitment, Tag } from "@shared/types";

interface ViewToolbarProps {
  filter: FilterKey;
  onFilterChange: (key: FilterKey) => void;
  search: string;
  onSearchChange: (q: string) => void;
  tags?: Tag[];
  selectedTags?: number[];
  onTagToggle?: (id: number) => void;
  onSmartTags?: () => void;
}

const filters: Array<{ key: FilterKey; label: string }> = [
  { key: "all", label: "All" },
  { key: "overdue", label: "Overdue" },
  { key: "has_deadline", label: "Has deadline" },
  { key: "high", label: "High priority" },
  { key: "meetings", label: "Granola" },
  { key: "slack", label: "Slack" },
  { key: "gdoc", label: "Google Docs" },
];

export function ViewToolbar({ filter, onFilterChange, search, onSearchChange, tags, selectedTags, onTagToggle, onSmartTags }: ViewToolbarProps) {
  const hasTags = tags && tags.length > 1 && onTagToggle; // More than just "General"
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "8px 0", marginBottom: 8 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
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

      {/* Tag filter chips */}
      {hasTags && (
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {tags!.filter((t) => t.name !== "General").map((t) => {
            const isActive = selectedTags?.includes(t.id!);
            return (
              <button
                key={t.id}
                onClick={() => onTagToggle!(t.id!)}
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  fontFamily: OS.font,
                  padding: "2px 8px",
                  borderRadius: 10,
                  border: `1px solid ${isActive ? t.color : OS.border}`,
                  background: isActive ? t.color + "18" : OS.white,
                  color: isActive ? t.color : OS.secondary,
                  cursor: "pointer",
                  transition: "all 0.12s ease",
                  lineHeight: 1.6,
                  whiteSpace: "nowrap",
                }}
              >
                {t.name}
              </button>
            );
          })}
          {onSmartTags && (
            <button
              onClick={onSmartTags}
              style={{
                fontSize: 11, fontWeight: 600, fontFamily: OS.font,
                padding: "2px 8px", borderRadius: 10,
                border: `1px solid ${OS.border}`,
                background: OS.white, color: OS.secondary,
                cursor: "pointer", lineHeight: 1.6,
                whiteSpace: "nowrap" as const,
              }}
            >
              ✦ Smart Tags
            </button>
          )}
        </div>
      )}
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
