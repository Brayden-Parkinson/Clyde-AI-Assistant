import React, { useState, useEffect } from "react";
import { OS } from "@shared/tokens";
import type { PipelineStatus, StatusEntry } from "@shared/status";
import { IconInfo, IconWarning, IconX, IconCheck, IconSignal, IconChevronDown } from "./Icons";

const LEVEL_ICONS: Record<StatusEntry["level"], React.ReactNode> = {
  info: <IconInfo size={11} />,
  warn: <IconWarning size={11} />,
  error: <IconX size={11} />,
  success: <IconCheck size={11} />,
};

const LEVEL_COLORS: Record<StatusEntry["level"], string> = {
  info: OS.muted,
  warn: "#b08d33",
  error: OS.red,
  success: OS.green,
};

const SOURCE_LABELS: Record<StatusEntry["source"], string> = {
  content: "Slack",
  batcher: "Batcher",
  extractor: "Claude",
  granola: "Granola",
  worker: "System",
  backup: "Backup",
  "morning-brief": "Brief",
  "daily-review": "Review",
  "voice-inbox": "Voice",
  tags: "Tags",
  sensitivity: "Privacy",
  calendar: "Calendar",
  people: "People",
};

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

export function StatusPanel() {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<PipelineStatus | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const result = await chrome.storage.session.get("pipelineStatus");
        if (result.pipelineStatus) {
          setStatus(result.pipelineStatus as PipelineStatus);
        }
      } catch {
        // Not available
      }
    };
    load();
    const interval = setInterval(load, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div style={{
      background: OS.white, border: `1.5px solid ${OS.border}`, borderRadius: 10,
      padding: "14px 18px", marginBottom: 12,
    }}>
      <div
        onClick={() => setOpen(!open)}
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          cursor: "pointer",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 28, height: 28, borderRadius: 8,
            background: OS.bg, color: status?.lastError ? "#b08d33" : OS.muted,
          }}>
            {status?.lastError ? <IconWarning size={15} /> : <IconSignal size={15} />}
          </span>
          <span style={{ fontSize: 13, fontWeight: 700, color: OS.text, fontFamily: OS.font }}>
            Pipeline Status
          </span>

          {/* Quick status indicators */}
          <span style={{
            fontSize: 11, fontWeight: 600,
            color: status?.slackConnected ? OS.green : OS.red,
            background: status?.slackConnected ? OS.bg : OS.bg,
            padding: "2px 8px", borderRadius: 8,
          }}>
            Slack: {status?.slackConnected ? "connected" : "not connected"}
          </span>

          <span style={{
            fontSize: 11, fontWeight: 600,
            color: status?.hasApiKey ? OS.green : OS.red,
            background: status?.hasApiKey ? OS.bg : OS.bg,
            padding: "2px 8px", borderRadius: 8,
          }}>
            API Key: {status?.hasApiKey ? "set" : "missing"}
          </span>

          <span style={{
            fontSize: 11, fontWeight: 600,
            color: status?.granolaConnected ? OS.green : OS.muted,
            background: status?.granolaConnected ? OS.bg : OS.bg,
            padding: "2px 8px", borderRadius: 8,
          }}>
            Granola: {status?.granolaConnected ? "connected" : "not connected"}
          </span>
        </div>
        <span style={{
          color: OS.muted, display: "inline-flex",
          transition: "transform 0.2s ease",
          transform: open ? "rotate(180deg)" : "none",
        }}>
          <IconChevronDown size={14} />
        </span>
      </div>

      {open && status && (
        <div style={{ marginTop: 12 }}>
          {/* Stats grid */}
          <div style={{
            display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr",
            gap: 8, marginBottom: 12,
          }}>
            {[
              { label: "Messages received", value: status.totalMessagesReceived },
              { label: "Buffered", value: status.bufferedMessages },
              { label: "Commitments found", value: status.totalCommitmentsExtracted },
              { label: "Last extraction", value: timeAgo(status.lastExtraction) },
            ].map((s, i) => (
              <div key={i} style={{
                background: OS.bg, borderRadius: 8, padding: "8px 10px",
                textAlign: "center",
              }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: OS.text, fontFamily: "monospace" }}>
                  {s.value}
                </div>
                <div style={{ fontSize: 10, color: OS.muted, marginTop: 2 }}>
                  {s.label}
                </div>
              </div>
            ))}
          </div>

          {/* Error banner */}
          {status.lastError && (
            <div style={{
              background: OS.bg, border: `1px solid ${OS.border}`, borderRadius: 8,
              padding: "8px 12px", marginBottom: 12,
              fontSize: 12, color: OS.red, fontFamily: "monospace",
            }}>
              Last error: {status.lastError}
            </div>
          )}

          {/* Event log */}
          <div style={{
            fontSize: 11, fontWeight: 700, color: OS.muted,
            textTransform: "uppercase", letterSpacing: "0.04em",
            marginBottom: 6,
          }}>
            Event Log
          </div>
          <div style={{
            maxHeight: 240, overflowY: "auto",
            background: OS.bg, borderRadius: 8, padding: 8,
          }}>
            {status.log.length === 0 ? (
              <div style={{ fontSize: 12, color: OS.muted, textAlign: "center", padding: 16 }}>
                No events yet. Browse Slack in a Chrome tab to start capturing messages.
              </div>
            ) : (
              [...status.log].reverse().map((entry, i) => {
                return (
                  <div key={i} style={{
                    display: "flex", gap: 6, padding: "4px 0",
                    borderBottom: i < status.log.length - 1 ? `1px solid ${OS.border}` : "none",
                    alignItems: "flex-start",
                  }}>
                    <span style={{ color: LEVEL_COLORS[entry.level], display: "inline-flex", flexShrink: 0, marginTop: 1 }}>
                      {LEVEL_ICONS[entry.level]}
                    </span>
                    <span style={{
                      fontSize: 10, color: OS.muted, fontFamily: "monospace",
                      flexShrink: 0, width: 40,
                    }}>
                      {new Date(entry.timestamp).toLocaleTimeString("en-US", {
                        hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
                      })}
                    </span>
                    <span style={{
                      fontSize: 10, fontWeight: 700, color: OS.blue,
                      background: OS.bg, padding: "1px 5px",
                      borderRadius: 4, flexShrink: 0,
                    }}>
                      {SOURCE_LABELS[entry.source]}
                    </span>
                    <span style={{ fontSize: 11, color: OS.secondary, lineHeight: 1.4 }}>
                      {entry.message}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
