import React, { useState } from "react";
import { OS } from "@shared/tokens";
import { dk } from "../../DarkModeContext";

interface Props {
  title: string;
  count?: number;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  darkMode: boolean;
  children: React.ReactNode;
}

export function SectionHeader({ title, count, collapsible = false, defaultCollapsed = false, darkMode, children }: Props) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  return (
    <section style={{ marginBottom: 24 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginBottom: collapsed ? 0 : 12,
          cursor: collapsible ? "pointer" : "default",
          userSelect: "none",
        }}
        onClick={() => collapsible && setCollapsed(!collapsed)}
      >
        {collapsible && (
          <span
            style={{
              color: dk(darkMode, "rgba(255,255,255,0.25)", OS.faint),
              fontSize: 9,
              transition: "transform 150ms",
              transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)",
              display: "inline-block",
            }}
          >
            ▼
          </span>
        )}
        <h2
          style={{
            fontSize: 11,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: dk(darkMode, "rgba(255,255,255,0.35)", OS.muted),
            margin: 0,
            fontFamily: OS.font,
          }}
        >
          {title}
        </h2>
        {count !== undefined && (
          <span style={{ fontSize: 11, color: dk(darkMode, "rgba(255,255,255,0.20)", OS.faint), fontWeight: 400 }}>
            {count}
          </span>
        )}
      </div>
      {!collapsed && children}
    </section>
  );
}
