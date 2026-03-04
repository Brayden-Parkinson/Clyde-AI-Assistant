import React, { useState, useEffect, useCallback } from "react";
import { OS } from "@shared/tokens";
import { db } from "@shared/db";
import { DEFAULTS } from "@shared/constants";

interface FormState {
  anthropicApiKey: string;
  granolaApiKey: string;
  slackScanFrequency: number;
  granolaPollFrequency: number;
  confidenceThreshold: number;
  morningDigestTime: string;
  uiMode: "popup" | "sidepanel";
}

const DEFAULT_FORM: FormState = {
  anthropicApiKey: "",
  granolaApiKey: "",
  slackScanFrequency: DEFAULTS.slackScanFrequencyMin,
  granolaPollFrequency: DEFAULTS.granolaPollFrequencyMin,
  confidenceThreshold: Math.round(DEFAULTS.confidenceThreshold * 100),
  morningDigestTime: `${String(DEFAULTS.morningDigestHour).padStart(2, "0")}:${String(DEFAULTS.morningDigestMinute).padStart(2, "0")}`,
  uiMode: DEFAULTS.uiMode,
};

// ─── Styles ───

const sectionStyle: React.CSSProperties = {
  background: OS.cardBg,
  borderRadius: 12,
  padding: "24px 28px",
  marginBottom: 20,
  border: `1px solid ${OS.border}`,
};

const sectionTitle: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 700,
  color: OS.darkBlue,
  marginBottom: 18,
  letterSpacing: "-0.01em",
};

const fieldRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: 16,
};

const labelStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: OS.textPrimary,
};

const subLabel: React.CSSProperties = {
  fontSize: 11,
  color: OS.textMuted,
  marginTop: 2,
};

const inputStyle: React.CSSProperties = {
  padding: "8px 12px",
  border: `1px solid ${OS.border}`,
  borderRadius: 8,
  fontSize: 13,
  fontFamily: OS.font,
  color: OS.textPrimary,
  background: OS.white,
  outline: "none",
  width: 260,
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  width: 160,
  cursor: "pointer",
};

export default function Options() {
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [saved, setSaved] = useState(false);
  const [dailyCost, setDailyCost] = useState("$0.00");
  const [loaded, setLoaded] = useState(false);

  // ─── Load settings from chrome.storage.local ───

  useEffect(() => {
    chrome.storage.local.get(
      [
        "anthropicApiKey",
        "granolaApiKey",
        "slackScanFrequency",
        "granolaPollFrequency",
        "confidenceThreshold",
        "morningDigestTime",
        "uiMode",
      ],
      (result) => {
        setForm((prev) => ({
          ...prev,
          anthropicApiKey: result.anthropicApiKey ?? prev.anthropicApiKey,
          granolaApiKey: result.granolaApiKey ?? prev.granolaApiKey,
          slackScanFrequency:
            result.slackScanFrequency ?? prev.slackScanFrequency,
          granolaPollFrequency:
            result.granolaPollFrequency ?? prev.granolaPollFrequency,
          confidenceThreshold:
            result.confidenceThreshold ?? prev.confidenceThreshold,
          morningDigestTime:
            result.morningDigestTime ?? prev.morningDigestTime,
          uiMode: result.uiMode ?? prev.uiMode,
        }));
        setLoaded(true);
      },
    );
  }, []);

  // ─── Estimate daily API cost from action_log count ───

  useEffect(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayIso = today.toISOString();

    db.action_log
      .where("createdAt")
      .aboveOrEqual(todayIso)
      .count()
      .then((count) => {
        // Rough estimate: ~$0.003 per extraction call
        const cost = (count * 0.003).toFixed(2);
        setDailyCost(`$${cost}`);
      });
  }, []);

  // ─── Field change handler ───

  const update = useCallback(
    <K extends keyof FormState>(key: K, value: FormState[K]) => {
      setForm((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  // ─── Save all settings ───

  const save = useCallback(() => {
    chrome.storage.local.set(
      {
        anthropicApiKey: form.anthropicApiKey,
        granolaApiKey: form.granolaApiKey,
        slackScanFrequency: form.slackScanFrequency,
        granolaPollFrequency: form.granolaPollFrequency,
        confidenceThreshold: form.confidenceThreshold,
        morningDigestTime: form.morningDigestTime,
        uiMode: form.uiMode,
      },
      () => {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      },
    );
  }, [form]);

  // ─── Clear all data ───

  const clearAllData = useCallback(async () => {
    const ok = window.confirm(
      "This will permanently delete ALL commitments, messages, and settings. Are you sure?",
    );
    if (!ok) return;
    await db.delete();
    await db.open();
    chrome.storage.local.clear();
    setForm(DEFAULT_FORM);
    window.alert("All data cleared.");
  }, []);

  // ─── Export data as JSON ───

  const exportData = useCallback(async () => {
    const commitments = await db.commitments.toArray();
    const raw_messages = await db.raw_messages.toArray();
    const dismissals = await db.dismissals.toArray();
    const action_log = await db.action_log.toArray();

    const data = { commitments, raw_messages, dismissals, action_log };
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `commitment-tracker-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  if (!loaded) return null;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: OS.bg,
        fontFamily: OS.font,
        color: OS.textPrimary,
        padding: "32px 0",
      }}
    >
      <div style={{ maxWidth: 600, margin: "0 auto", padding: "0 24px" }}>
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 28,
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: `linear-gradient(135deg, ${OS.blue}, ${OS.darkBlue})`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: OS.white,
              fontSize: 18,
              fontWeight: 900,
              boxShadow: "0 2px 8px rgba(43,103,219,0.25)",
            }}
          >
            {"\u25C9"}
          </div>
          <div>
            <h1
              style={{
                fontSize: 20,
                fontWeight: 900,
                color: OS.darkBlue,
                letterSpacing: "-0.01em",
              }}
            >
              Settings
            </h1>
            <span style={{ fontSize: 12, color: OS.textMuted }}>
              Commitment Tracker
            </span>
          </div>
        </div>

        {/* API Keys */}
        <div style={sectionStyle}>
          <h2 style={sectionTitle}>API Keys</h2>

          <div style={fieldRow}>
            <div>
              <div style={labelStyle}>Anthropic API Key</div>
              <div style={subLabel}>Required for commitment extraction</div>
            </div>
            <input
              type="password"
              style={inputStyle}
              value={form.anthropicApiKey}
              placeholder="sk-ant-..."
              onChange={(e) => update("anthropicApiKey", e.target.value)}
            />
          </div>

          <div style={{ ...fieldRow, marginBottom: 0 }}>
            <div>
              <div style={labelStyle}>Granola API Key</div>
              <div style={subLabel}>For meeting note polling</div>
            </div>
            <input
              type="password"
              style={inputStyle}
              value={form.granolaApiKey}
              placeholder="grnl-..."
              onChange={(e) => update("granolaApiKey", e.target.value)}
            />
          </div>
        </div>

        {/* Scan Frequencies */}
        <div style={sectionStyle}>
          <h2 style={sectionTitle}>Scan Frequencies</h2>

          <div style={fieldRow}>
            <div>
              <div style={labelStyle}>Slack Scan Frequency</div>
              <div style={subLabel}>How often to batch Slack messages</div>
            </div>
            <select
              style={selectStyle}
              value={form.slackScanFrequency}
              onChange={(e) =>
                update("slackScanFrequency", Number(e.target.value))
              }
            >
              <option value={2}>Every 2 minutes</option>
              <option value={5}>Every 5 minutes</option>
              <option value={10}>Every 10 minutes</option>
            </select>
          </div>

          <div style={{ ...fieldRow, marginBottom: 0 }}>
            <div>
              <div style={labelStyle}>Granola Poll Frequency</div>
              <div style={subLabel}>How often to check for new meeting notes</div>
            </div>
            <select
              style={selectStyle}
              value={form.granolaPollFrequency}
              onChange={(e) =>
                update("granolaPollFrequency", Number(e.target.value))
              }
            >
              <option value={30}>Every 30 minutes</option>
              <option value={60}>Every 60 minutes</option>
              <option value={120}>Every 2 hours</option>
            </select>
          </div>
        </div>

        {/* Detection & Schedule */}
        <div style={sectionStyle}>
          <h2 style={sectionTitle}>Detection &amp; Schedule</h2>

          <div style={fieldRow}>
            <div>
              <div style={labelStyle}>Confidence Threshold</div>
              <div style={subLabel}>
                Minimum confidence to show: {form.confidenceThreshold}%
              </div>
            </div>
            <input
              type="range"
              min={50}
              max={95}
              step={5}
              value={form.confidenceThreshold}
              onChange={(e) =>
                update("confidenceThreshold", Number(e.target.value))
              }
              style={{ width: 160, cursor: "pointer" }}
            />
          </div>

          <div style={{ ...fieldRow, marginBottom: 0 }}>
            <div>
              <div style={labelStyle}>Morning Digest Time</div>
              <div style={subLabel}>Daily summary notification</div>
            </div>
            <input
              type="time"
              style={{ ...inputStyle, width: 160 }}
              value={form.morningDigestTime}
              onChange={(e) => update("morningDigestTime", e.target.value)}
            />
          </div>
        </div>

        {/* UI Mode */}
        <div style={sectionStyle}>
          <h2 style={sectionTitle}>Display</h2>

          <div style={{ ...fieldRow, marginBottom: 0 }}>
            <div>
              <div style={labelStyle}>UI Mode</div>
              <div style={subLabel}>
                How the extension opens when you click the icon
              </div>
            </div>
            <div style={{ display: "flex", gap: 0 }}>
              {(["popup", "sidepanel"] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => update("uiMode", mode)}
                  style={{
                    padding: "7px 16px",
                    fontSize: 13,
                    fontWeight: 600,
                    fontFamily: OS.font,
                    border: `1px solid ${OS.border}`,
                    cursor: "pointer",
                    background:
                      form.uiMode === mode ? OS.blue : OS.white,
                    color:
                      form.uiMode === mode ? OS.white : OS.textPrimary,
                    borderRadius:
                      mode === "popup" ? "8px 0 0 8px" : "0 8px 8px 0",
                    borderLeft:
                      mode === "sidepanel"
                        ? "none"
                        : `1px solid ${OS.border}`,
                  }}
                >
                  {mode === "popup" ? "Popup" : "Side Panel"}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Usage & Data */}
        <div style={sectionStyle}>
          <h2 style={sectionTitle}>Usage &amp; Data</h2>

          <div style={fieldRow}>
            <div>
              <div style={labelStyle}>Daily API Cost (estimate)</div>
              <div style={subLabel}>Based on today's extraction calls</div>
            </div>
            <div
              style={{
                padding: "7px 16px",
                background: OS.bg,
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 700,
                color: OS.darkBlue,
                fontFamily: "monospace",
              }}
            >
              {dailyCost}
            </div>
          </div>

          <div style={fieldRow}>
            <div>
              <div style={labelStyle}>Export Data</div>
              <div style={subLabel}>
                Download all commitments as JSON
              </div>
            </div>
            <button
              onClick={exportData}
              style={{
                padding: "8px 20px",
                fontSize: 13,
                fontWeight: 600,
                fontFamily: OS.font,
                border: `1px solid ${OS.border}`,
                borderRadius: 8,
                background: OS.white,
                color: OS.blue,
                cursor: "pointer",
              }}
            >
              Export JSON
            </button>
          </div>

          <div style={{ ...fieldRow, marginBottom: 0 }}>
            <div>
              <div style={{ ...labelStyle, color: "#dc2626" }}>
                Clear All Data
              </div>
              <div style={subLabel}>
                Permanently delete everything
              </div>
            </div>
            <button
              onClick={clearAllData}
              style={{
                padding: "8px 20px",
                fontSize: 13,
                fontWeight: 600,
                fontFamily: OS.font,
                border: "1px solid #fca5a5",
                borderRadius: 8,
                background: OS.white,
                color: "#dc2626",
                cursor: "pointer",
              }}
            >
              Clear All Data
            </button>
          </div>
        </div>

        {/* Save Button */}
        <button
          onClick={save}
          style={{
            width: "100%",
            padding: "12px 0",
            fontSize: 15,
            fontWeight: 700,
            fontFamily: OS.font,
            border: "none",
            borderRadius: 10,
            background: saved
              ? "#16a34a"
              : `linear-gradient(135deg, ${OS.blue}, ${OS.darkBlue})`,
            color: OS.white,
            cursor: "pointer",
            boxShadow: "0 2px 8px rgba(43,103,219,0.25)",
            transition: "background 0.2s",
          }}
        >
          {saved ? "Saved!" : "Save Settings"}
        </button>

        <div
          style={{
            textAlign: "center",
            marginTop: 20,
            fontSize: 11,
            color: OS.textMuted,
          }}
        >
          Settings are stored locally in Chrome
        </div>
      </div>
    </div>
  );
}
