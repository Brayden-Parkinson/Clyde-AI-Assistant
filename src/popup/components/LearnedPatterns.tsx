import React, { useState } from "react";
import { OS } from "@shared/tokens";
import { IconBrain, IconChevronDown, IconX } from "./Icons";
import type { Dismissal } from "@shared/types";

interface LearnedPatternsProps {
  patterns: Dismissal[];
}

export function LearnedPatterns({ patterns }: LearnedPatternsProps) {
  const [open, setOpen] = useState(false);

  if (patterns.length === 0) return null;

  return (
    <div
      style={{
        background: OS.white,
        border: `1.5px solid ${OS.border}`,
        borderRadius: 10,
        padding: "14px 18px",
        marginBottom: 12,
      }}
    >
      <div
        onClick={() => setOpen(!open)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: "pointer",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 28,
              height: 28,
              borderRadius: 8,
              background: "#e8eef9",
              color: OS.blue,
            }}
          >
            <IconBrain size={15} />
          </span>
          <span
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: OS.text,
              fontFamily: OS.font,
            }}
          >
            Learned patterns
          </span>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              fontFamily: "monospace",
              background: OS.bg,
              color: OS.muted,
              padding: "2px 8px",
              borderRadius: 8,
            }}
          >
            {patterns.length} suppressed
          </span>
        </div>
        <span
          style={{
            color: OS.muted,
            display: "inline-flex",
            transition: "transform 0.2s ease",
            transform: open ? "rotate(180deg)" : "none",
          }}
        >
          <IconChevronDown size={14} />
        </span>
      </div>
      {open && (
        <div style={{ marginTop: 12 }}>
          {patterns.map((p) => (
            <div
              key={p.id ?? p.pattern}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "10px 0",
                borderTop: `1px solid ${OS.border}`,
              }}
            >
              <div
                style={{ display: "flex", alignItems: "center", gap: 8 }}
              >
                <span style={{ color: "#dc2626", display: "inline-flex", alignItems: "center" }}>
                  <IconX size={12} />
                </span>
                <span
                  style={{
                    fontSize: 12,
                    color: OS.secondary,
                    fontStyle: "italic",
                  }}
                >
                  &ldquo;{p.pattern}&rdquo;
                </span>
                <span style={{ fontSize: 11, color: OS.muted }}>
                  {"— "}
                  {p.reason}
                </span>
              </div>
              <span
                style={{
                  fontSize: 11,
                  fontFamily: "monospace",
                  color: OS.muted,
                  background: OS.bg,
                  padding: "2px 8px",
                  borderRadius: 6,
                }}
              >
                {p.count}x
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
