import React, { useState } from "react";
import { OS } from "@shared/tokens";
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
        background: OS.cardBg,
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
              background: OS.lightestBlue,
              fontSize: 14,
            }}
          >
            {"🧠"}
          </span>
          <span
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: OS.textPrimary,
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
              color: OS.textMuted,
              padding: "2px 8px",
              borderRadius: 8,
            }}
          >
            {patterns.length} suppressed
          </span>
        </div>
        <span
          style={{
            color: OS.textMuted,
            fontSize: 16,
            lineHeight: 1,
            transition: "transform 0.2s ease",
            transform: open ? "rotate(180deg)" : "none",
          }}
        >
          {"▾"}
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
                <span style={{ color: "#dc2626", fontSize: 12 }}>
                  {"✕"}
                </span>
                <span
                  style={{
                    fontSize: 12,
                    color: OS.textSecondary,
                    fontStyle: "italic",
                  }}
                >
                  &ldquo;{p.pattern}&rdquo;
                </span>
                <span style={{ fontSize: 11, color: OS.textMuted }}>
                  {"— "}
                  {p.reason}
                </span>
              </div>
              <span
                style={{
                  fontSize: 11,
                  fontFamily: "monospace",
                  color: OS.textMuted,
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
