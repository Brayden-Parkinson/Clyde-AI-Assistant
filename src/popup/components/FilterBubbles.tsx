import React, { useEffect, useRef, useState } from "react";
import { OS } from "@shared/tokens";
import { dk } from "../DarkModeContext";
import type { Tag } from "@shared/types";
import { IconSearch, IconX } from "./Icons";

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
  const [searchOpen, setSearchOpen] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  const hasTags = tags && tags.length > 0 && onTagToggle;
  const activeCount = selectedTags?.length ?? 0;
  const hasSearch = search.length > 0;

  // Auto-open search if there's a value (e.g. restored from state)
  useEffect(() => {
    if (hasSearch && !searchOpen) setSearchOpen(true);
  }, []);

  // Focus input when search opens
  useEffect(() => {
    if (searchOpen) {
      const t = setTimeout(() => inputRef.current?.focus(), 60);
      return () => clearTimeout(t);
    }
  }, [searchOpen]);

  /* ── shared pill styles ── */
  const pillContainer: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    position: "relative",
    background: dk(darkMode, "rgba(255,255,255,0.06)", "rgba(0,0,0,0.03)"),
    borderRadius: 999,
    padding: 3,
  };

  const btnBase: React.CSSProperties = {
    position: "relative",
    zIndex: 1,
    display: "flex",
    alignItems: "center",
    gap: 5,
    height: 26,
    padding: "0 12px",
    borderRadius: 999,
    border: "none",
    background: "transparent",
    fontSize: 12,
    fontWeight: 500,
    fontFamily: OS.font,
    cursor: "pointer",
    transition: "color 0.2s ease",
    whiteSpace: "nowrap",
    flexShrink: 0,
  };

  const btnColor = (active: boolean) =>
    active
      ? dk(darkMode, "rgba(255,255,255,0.90)", OS.text)
      : dk(darkMode, "rgba(255,255,255,0.45)", OS.secondary);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2, flexWrap: "wrap" }}>

      {/* ── Search pill ── */}
      <div style={pillContainer}>
        {!searchOpen ? (
          <button
            onClick={() => setSearchOpen(true)}
            style={{ ...btnBase, color: btnColor(hasSearch) }}
          >
            <IconSearch size={12} />
            {hasSearch ? (
              <span style={{ maxWidth: 80, overflow: "hidden", textOverflow: "ellipsis", fontSize: 11, opacity: 0.7 }}>
                "{search}"
              </span>
            ) : (
              "Search"
            )}
          </button>
        ) : (
          <div style={{
            position: "relative",
            zIndex: 1,
            display: "flex",
            alignItems: "center",
            height: 26,
            padding: "0 6px 0 10px",
            gap: 5,
            minWidth: 150,
            maxWidth: 240,
          }}>
            <span style={{
              color: dk(darkMode, "rgba(255,255,255,0.35)", OS.muted),
              display: "flex", flexShrink: 0,
            }}>
              <IconSearch size={12} />
            </span>
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search…"
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  if (search) onSearchChange("");
                  else setSearchOpen(false);
                }
              }}
              style={{
                flex: 1,
                minWidth: 0,
                border: "none",
                outline: "none",
                background: "transparent",
                fontSize: 12,
                fontFamily: OS.font,
                color: dk(darkMode, "rgba(255,255,255,0.85)", OS.text),
                padding: 0,
              }}
            />
            <button
              onClick={() => { onSearchChange(""); setSearchOpen(false); }}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 16, height: 16,
                borderRadius: 999,
                border: "none",
                background: dk(darkMode, "rgba(255,255,255,0.08)", "rgba(0,0,0,0.06)"),
                color: dk(darkMode, "rgba(255,255,255,0.4)", OS.muted),
                cursor: "pointer",
                padding: 0,
                flexShrink: 0,
              }}
            >
              <IconX size={8} />
            </button>
          </div>
        )}
      </div>

      {/* ── Tags pill ── */}
      {hasTags && (
        <div style={pillContainer}>
          {/* Tags toggle — always visible */}
          <button
            onClick={() => setTagsOpen((o) => !o)}
            style={{ ...btnBase, color: btnColor(tagsOpen || activeCount > 0) }}
          >
            Tags
            {activeCount > 0 && (
              <span style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                minWidth: 15,
                height: 15,
                borderRadius: 999,
                background: OS.blue,
                color: "#fff",
                fontSize: 9,
                fontWeight: 600,
                padding: "0 4px",
                lineHeight: 1,
              }}>
                {activeCount}
              </span>
            )}
          </button>

          {/* Expanded tag pills — to the right of toggle */}
          {tagsOpen && (
            <>
              {/* Thin separator */}
              <div style={{
                width: 1,
                height: 14,
                background: dk(darkMode, "rgba(255,255,255,0.10)", "rgba(0,0,0,0.08)"),
                flexShrink: 0,
                margin: "0 2px",
              }} />
              {tags!.map((tag) => {
                const active = selectedTags?.includes(tag.id!) ?? false;
                return (
                  <button
                    key={tag.id}
                    onClick={() => onTagToggle!(tag.id!)}
                    style={{
                      ...btnBase,
                      fontSize: 11,
                      fontWeight: active ? 600 : 400,
                      padding: "0 10px",
                      color: active ? OS.blue : dk(darkMode, "rgba(255,255,255,0.45)", OS.secondary),
                    }}
                  >
                    {active && (
                      <span style={{
                        width: 6, height: 6, borderRadius: 999,
                        background: OS.blue, flexShrink: 0,
                      }} />
                    )}
                    {tag.name}
                  </button>
                );
              })}
              {activeCount > 0 && (
                <button
                  onClick={() => selectedTags?.forEach((id) => onTagToggle!(id))}
                  style={{
                    ...btnBase,
                    padding: "0 8px",
                    fontSize: 11,
                    fontWeight: 400,
                    color: dk(darkMode, "rgba(255,255,255,0.30)", OS.faint),
                  }}
                >
                  Clear
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
