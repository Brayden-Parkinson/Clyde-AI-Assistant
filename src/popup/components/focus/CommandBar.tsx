import React, { useState, useEffect } from "react";
import { OS } from "@shared/tokens";
import { dk } from "../../DarkModeContext";

const placeholders = [
  "What did I promise Sarah?",
  "Anything overdue?",
  "Show commitments for Marcus",
  "What's on my plate today?",
  "Items from #engineering",
];

interface Props {
  darkMode: boolean;
  onSearch: (query: string) => void;
}

export function CommandBar({ darkMode, onSearch }: Props) {
  const [query, setQuery] = useState("");
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setPlaceholderIndex((i) => (i + 1) % placeholders.length);
    }, 3500);
    return () => clearInterval(interval);
  }, []);

  return (
    <div style={{ marginBottom: 24 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "9px 14px",
          background: dk(darkMode, "rgba(255,255,255,0.04)", OS.white),
          border: `1px solid ${focused ? dk(darkMode, "rgba(255,255,255,0.15)", OS.blue) : dk(darkMode, "rgba(255,255,255,0.08)", OS.border)}`,
          borderRadius: 10,
          transition: "border-color 150ms",
        }}
      >
        <span style={{ color: dk(darkMode, "rgba(255,255,255,0.25)", OS.faint), fontSize: 13, flexShrink: 0 }}>
          /
        </span>
        <input
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); onSearch(e.target.value); }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={`Ask Clyde... "${placeholders[placeholderIndex]}"`}
          style={{
            flex: 1,
            background: "transparent",
            border: "none",
            outline: "none",
            color: dk(darkMode, "rgba(255,255,255,0.90)", OS.text),
            fontSize: 13,
            fontFamily: OS.font,
          }}
        />
        {query && (
          <button
            onClick={() => { setQuery(""); onSearch(""); }}
            style={{
              background: "transparent",
              border: "none",
              color: dk(darkMode, "rgba(255,255,255,0.35)", OS.muted),
              cursor: "pointer",
              fontSize: 11,
              padding: "2px 6px",
              fontFamily: OS.font,
            }}
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
