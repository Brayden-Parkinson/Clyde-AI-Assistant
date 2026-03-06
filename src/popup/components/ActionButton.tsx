import React, { useState } from "react";
import { OS } from "@shared/tokens";

export type ActionButtonVariant =
  | "default"
  | "primary"
  | "danger"
  | "success"
  | "yellow"
  | "muted";

interface ActionButtonProps {
  icon: React.ReactNode;
  label: string;
  onClick: (e: React.MouseEvent) => void;
  variant?: ActionButtonVariant;
  shortcut?: string;
}

export function ActionButton({
  icon,
  label,
  onClick,
  variant = "default",
  shortcut,
}: ActionButtonProps) {
  const [hovered, setHovered] = useState(false);

  const styles: Record<
    ActionButtonVariant,
    { bg: string; border: string; color: string }
  > = {
    default: {
      bg: hovered ? OS.bg : OS.white,
      border: OS.border,
      color: OS.text,
    },
    primary: {
      bg: hovered ? OS.blue : OS.white,
      border: hovered ? OS.blue : OS.border,
      color: hovered ? OS.white : OS.blue,
    },
    danger: {
      bg: hovered ? OS.bg : OS.white,
      border: OS.border,
      color: hovered ? OS.red : OS.secondary,
    },
    success: {
      bg: hovered ? OS.bg : OS.white,
      border: OS.border,
      color: hovered ? OS.green : OS.secondary,
    },
    yellow: {
      bg: hovered ? OS.bg : OS.white,
      border: OS.border,
      color: hovered ? "#b08d33" : OS.secondary,
    },
    muted: {
      bg: hovered ? OS.bg : OS.white,
      border: OS.border,
      color: OS.muted,
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
        padding: "6px 12px",
        borderRadius: 6,
        background: s.bg,
        border: `1px solid ${s.border}`,
        color: s.color,
        fontSize: 12,
        fontWeight: 500,
        cursor: "pointer",
        fontFamily: OS.font,
        transition: "all 0.12s ease",
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ fontSize: 12, lineHeight: 1 }}>{icon}</span>
      {label}
      {shortcut && (
        <span
          style={{
            fontSize: 10,
            color: hovered && variant === "primary" ? "rgba(255,255,255,0.6)" : OS.muted,
            marginLeft: 2,
            fontFamily: OS.mono,
          }}
        >
          {shortcut}
        </span>
      )}
    </button>
  );
}
