import React, { useState } from "react";
import { OS } from "@shared/tokens";

export type ActionButtonVariant =
  | "default"
  | "primary"
  | "danger"
  | "success"
  | "yellow";

interface ActionButtonProps {
  icon: string;
  label: string;
  onClick: (e: React.MouseEvent) => void;
  variant?: ActionButtonVariant;
}

export function ActionButton({
  icon,
  label,
  onClick,
  variant = "default",
}: ActionButtonProps) {
  const [hovered, setHovered] = useState(false);

  const styles: Record<
    ActionButtonVariant,
    { bg: string; border: string; color: string }
  > = {
    default: {
      bg: hovered ? "#f0f2f8" : OS.white,
      border: OS.border,
      color: OS.textSecondary,
    },
    primary: {
      bg: hovered ? OS.darkBlue : OS.blue,
      border: OS.blue,
      color: OS.white,
    },
    danger: {
      bg: hovered ? "#fef2f2" : OS.white,
      border: hovered ? "#fca5a5" : "#fecaca",
      color: "#dc2626",
    },
    success: {
      bg: hovered ? "#f0fdf4" : OS.white,
      border: hovered ? "#86efac" : "#bbf7d0",
      color: "#16a34a",
    },
    yellow: {
      bg: hovered ? "#fef9c3" : OS.white,
      border: hovered ? "#fde047" : "#fef08a",
      color: "#a16207",
    },
  };

  const s = styles[variant];

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "7px 14px",
        borderRadius: 8,
        background: s.bg,
        border: `1.5px solid ${s.border}`,
        color: s.color,
        fontSize: 12,
        fontWeight: 600,
        cursor: "pointer",
        fontFamily: OS.font,
        transition: "all 0.15s ease",
        whiteSpace: "nowrap",
        boxShadow: hovered ? "0 1px 3px rgba(0,0,0,0.06)" : "none",
      }}
    >
      <span style={{ fontSize: 14, lineHeight: 1 }}>{icon}</span>
      {label}
    </button>
  );
}
