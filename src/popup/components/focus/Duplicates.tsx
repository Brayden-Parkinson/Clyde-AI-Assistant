import React, { useState } from "react";
import { OS } from "@shared/tokens";
import { dk } from "../../DarkModeContext";
import { SectionHeader } from "./SectionHeader";
import type { DuplicateGroup } from "./dedup";

interface Props {
  groups: DuplicateGroup[];
  darkMode: boolean;
  onMerge: (groupId: string) => void;
  onIgnore: (groupId: string) => void;
}

export function Duplicates({ groups, darkMode, onMerge, onIgnore }: Props) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const visible = groups.filter((g) => !dismissed.has(g.id));

  if (visible.length === 0) return null;

  return (
    <SectionHeader title="Possible duplicates" count={visible.length} collapsible darkMode={darkMode}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {visible.map((group) => (
          <div
            key={group.id}
            style={{
              background: dk(darkMode, "rgba(255,255,255,0.03)", OS.white),
              borderRadius: 12,
              border: `1px solid ${dk(darkMode, "rgba(255,255,255,0.06)", OS.border)}`,
              padding: 12,
            }}
          >
            <div
              style={{
                fontSize: 11,
                color: dk(darkMode, "rgba(255,255,255,0.40)", OS.muted),
                marginBottom: 8,
                fontFamily: OS.font,
              }}
            >
              {group.reason}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 10 }}>
              {group.commitments.map((c) => (
                <div
                  key={c.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "5px 8px",
                    background: dk(darkMode, "rgba(255,255,255,0.02)", OS.bg),
                    borderRadius: 6,
                  }}
                >
                  <span
                    style={{
                      fontSize: 12,
                      color: dk(darkMode, "rgba(255,255,255,0.55)", OS.secondary),
                      flex: 1,
                      fontFamily: OS.font,
                    }}
                  >
                    {c.text}
                  </span>
                  <span
                    style={{
                      fontSize: 10,
                      color: dk(darkMode, "rgba(255,255,255,0.25)", OS.faint),
                      background: dk(darkMode, "rgba(255,255,255,0.04)", "rgba(0,0,0,0.04)"),
                      padding: "1px 6px",
                      borderRadius: 9999,
                      fontFamily: OS.font,
                    }}
                  >
                    {c.source_type}
                  </span>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", gap: 6 }}>
              <button
                onClick={() => {
                  setDismissed((s) => new Set(s).add(group.id));
                  setTimeout(() => onMerge(group.id), 150);
                }}
                style={{
                  background: dk(darkMode, "rgba(94,106,210,0.15)", OS.blueBg),
                  border: "none",
                  borderRadius: 6,
                  color: OS.blue,
                  fontSize: 11,
                  fontWeight: 500,
                  padding: "4px 12px",
                  cursor: "pointer",
                  transition: "opacity 150ms",
                  fontFamily: OS.font,
                }}
              >
                Merge
              </button>
              <button
                onClick={() => {
                  setDismissed((s) => new Set(s).add(group.id));
                  setTimeout(() => onIgnore(group.id), 150);
                }}
                style={{
                  background: "transparent",
                  border: `1px solid ${dk(darkMode, "rgba(255,255,255,0.08)", OS.border)}`,
                  borderRadius: 6,
                  color: dk(darkMode, "rgba(255,255,255,0.35)", OS.muted),
                  fontSize: 11,
                  padding: "4px 12px",
                  cursor: "pointer",
                  transition: "opacity 150ms",
                  fontFamily: OS.font,
                }}
              >
                Ignore
              </button>
            </div>
          </div>
        ))}
      </div>
    </SectionHeader>
  );
}
