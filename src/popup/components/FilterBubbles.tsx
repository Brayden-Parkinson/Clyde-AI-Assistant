import React, { useRef } from "react";
import { OS } from "@shared/tokens";
import { dk } from "../DarkModeContext";
import type { Tag } from "@shared/types";
import { IconSearch } from "./Icons";

interface FilterBubblesProps {
  search: string;
  onSearchChange: (q: string) => void;
  tags?: Tag[];
  selectedTags?: number[];
  onTagToggle?: (id: number) => void;
  darkMode: boolean;
}

export function FilterBubbles({ search, onSearchChange, tags, selectedTags, onTagToggle, darkMode }: FilterBubblesProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const hasTags = tags && tags.length > 0 && onTagToggle;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {/* Search input */}
      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
        }}
        onClick={() => inputRef.current?.focus()}
      >
        <span style={{
          position: "absolute",
          left: 10,
          color: dk(darkMode, "rgba(255,255,255,0.35)", OS.muted),
          display: "flex",
          alignItems: "center",
          pointerEvents: "none",
        }}>
          <IconSearch size={13} />
        </span>
        <input
          ref={inputRef}
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search…"
          style={{
            width: "100%",
            paddingLeft: 30,
            paddingRight: 10,
            paddingTop: 6,
            paddingBottom: 6,
            fontSize: 12,
            fontFamily: OS.font,
            color: dk(darkMode, "rgba(255,255,255,0.85)", OS.text),
            background: dk(darkMode, "rgba(255,255,255,0.06)", OS.white),
            border: `1px solid ${dk(darkMode, "rgba(255,255,255,0.10)", OS.border)}`,
            borderRadius: 8,
            outline: "none",
          }}
        />
      </div>

      {/* Tag bubbles */}
      {hasTags && (
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          {tags!.map((tag) => {
            const active = selectedTags?.includes(tag.id!) ?? false;
            return (
              <button
                key={tag.id}
                onClick={() => onTagToggle!(tag.id!)}
                style={{
                  fontSize: 11,
                  fontWeight: active ? 600 : 500,
                  fontFamily: OS.font,
                  padding: "3px 10px",
                  borderRadius: 20,
                  cursor: "pointer",
                  border: `1px solid ${active ? OS.blue : dk(darkMode, "rgba(255,255,255,0.12)", OS.border)}`,
                  background: active ? OS.blue : dk(darkMode, "rgba(255,255,255,0.04)", "transparent"),
                  color: active ? "#fff" : dk(darkMode, "rgba(255,255,255,0.65)", OS.secondary),
                  transition: "all 0.12s ease",
                }}
              >
                {tag.name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
