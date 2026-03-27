import React from "react";

const TIER_COLORS: Record<string, string> = {
  manager: "#c084fc",
  report: "#60a5fa",
  peer: "#a1a1aa",
  stakeholder: "#f59e0b",
  external: "#71717a",
};

interface Props {
  name: string;
  relationship?: string | null;
  size?: number;
}

export function Avatar({ name, relationship, size = 26 }: Props) {
  const parts = name.split(" ");
  const initials = parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase();
  const color = TIER_COLORS[relationship ?? ""] ?? "#71717a";

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: color,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size * 0.38,
        fontWeight: 600,
        color: "#fff",
        flexShrink: 0,
        opacity: 0.9,
      }}
    >
      {initials}
    </div>
  );
}
