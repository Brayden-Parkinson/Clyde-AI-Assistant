import React, { useState, useEffect, useCallback, useRef } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { OS } from "@shared/tokens";
import { db } from "@shared/db";
import { DEFAULTS } from "@shared/constants";
import { IconChevronRight, IconChevronLeft, IconLogo } from "../popup/components/Icons";
import { USER_PROFILE_DEFAULTS } from "@shared/user-profile";
import { ToastContainer, useToast } from "../popup/components/Toast";

interface FormState {
  anthropicApiKey: string;
  userName: string;
  userTitle: string;
  userCompany: string;
  timezone: string;
  slackDisplayNames: string;
  slackScanFrequency: number;
  granolaPollFrequency: number;
  confidenceThreshold: number;
  morningDigestTime: string;
  uiMode: "popup" | "sidepanel";
  developerMode: boolean;
  demoMode: boolean;
  morningBriefEnabled: boolean;
  calendarIcsUrl: string;
}

const DEFAULT_FORM: FormState = {
  anthropicApiKey: "",
  userName: "",
  userTitle: "",
  userCompany: "",
  timezone: USER_PROFILE_DEFAULTS.timezone,
  slackDisplayNames: "",
  slackScanFrequency: DEFAULTS.slackScanFrequencyMin,
  granolaPollFrequency: DEFAULTS.granolaPollFrequencyMin,
  confidenceThreshold: Math.round(DEFAULTS.confidenceThreshold * 100),
  morningDigestTime: `${String(DEFAULTS.morningDigestHour).padStart(2, "0")}:${String(DEFAULTS.morningDigestMinute).padStart(2, "0")}`,
  uiMode: DEFAULTS.uiMode,
  developerMode: false,
  demoMode: false,
  morningBriefEnabled: true,
  calendarIcsUrl: "",
};

type SettingsTab = "profile" | "integrations" | "detection" | "advanced";

const TABS: { key: SettingsTab; label: string }[] = [
  { key: "profile", label: "Profile" },
  { key: "integrations", label: "Integrations" },
  { key: "detection", label: "Detection" },
  { key: "advanced", label: "Advanced" },
];

// ─── Styles ───

const sectionStyle: React.CSSProperties = {
  background: OS.white,
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
  color: OS.text,
};

const subLabel: React.CSSProperties = {
  fontSize: 11,
  color: OS.muted,
  marginTop: 2,
};

const inputStyle: React.CSSProperties = {
  padding: "8px 12px",
  border: `1px solid ${OS.border}`,
  borderRadius: 8,
  fontSize: 13,
  fontFamily: OS.font,
  color: OS.text,
  background: OS.white,
  outline: "none",
  width: 260,
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  width: 160,
  cursor: "pointer",
};

// ─── Disclosure / Accordion ───

function Disclosure({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: 14 }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          background: "none", border: "none", padding: 0,
          color: OS.blue, fontSize: 12, fontWeight: 600,
          cursor: "pointer", fontFamily: OS.font,
        }}
      >
        <span style={{ display: "inline-flex", transform: open ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}><IconChevronRight size={12} /></span> {label}
      </button>
      {open && (
        <div style={{
          marginTop: 10, padding: "12px 14px", borderRadius: 8,
          background: OS.bg, border: `1px solid ${OS.border}`,
          fontSize: 12, color: OS.secondary, lineHeight: 1.8,
        }}>
          {children}
        </div>
      )}
    </div>
  );
}

// ─── Toggle switch ───

function Toggle({ value, onChange, color }: { value: boolean; onChange: () => void; color?: string }) {
  const bg = color ?? OS.blue;
  return (
    <button
      onClick={onChange}
      style={{
        width: 48, height: 26, borderRadius: 13, border: "none",
        background: value ? bg : OS.faint,
        cursor: "pointer", position: "relative", transition: "background 0.2s",
        flexShrink: 0,
      }}
    >
      <div style={{
        width: 20, height: 20, borderRadius: 10, background: OS.white,
        position: "absolute", top: 3,
        left: value ? 25 : 3,
        transition: "left 0.2s ease",
        boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
      }} />
    </button>
  );
}

export function SettingsPanel({ onBack }: { onBack?: () => void }) {
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const { toasts, showToast, dismissToast } = useToast();
  const [dailyCost, setDailyCost] = useState("$0.00");
  const [loaded, setLoaded] = useState(false);
  const [activeTab, setActiveTab] = useState<SettingsTab>("profile");
  const [granolaConnected, setGranolaConnected] = useState(false);
  const [granolaTestLoading, setGranolaTestLoading] = useState(false);
  const [extensionId, setExtensionId] = useState("");
  const [copiedInstall, setCopiedInstall] = useState(false);
  const [channelFilter, setChannelFilter] = useState<Record<string, boolean>>({});
  const [discoveredChannels, setDiscoveredChannels] = useState<string[]>([]);

  // ─── Load settings from chrome.storage.local ───

  useEffect(() => {
    chrome.storage.local.get(
      [
        "anthropicApiKey",
        "userName",
        "userTitle",
        "userCompany",
        "timezone",
        "slackDisplayNames",
        "slackScanFrequency",
        "granolaPollFrequency",
        "confidenceThreshold",
        "morningDigestTime",
        "uiMode",
        "developerMode",
        "demoMode",
        "morningBriefEnabled",
        "calendarIcsUrl",
      ],
      (result) => {
        setForm((prev) => ({
          ...prev,
          anthropicApiKey: result.anthropicApiKey ?? prev.anthropicApiKey,
          userName: result.userName ?? prev.userName,
          userTitle: result.userTitle ?? prev.userTitle,
          userCompany: result.userCompany ?? prev.userCompany,
          timezone: result.timezone ?? prev.timezone,
          slackDisplayNames: result.slackDisplayNames ?? prev.slackDisplayNames,
          slackScanFrequency:
            result.slackScanFrequency ?? prev.slackScanFrequency,
          granolaPollFrequency:
            result.granolaPollFrequency ?? prev.granolaPollFrequency,
          confidenceThreshold:
            result.confidenceThreshold ?? prev.confidenceThreshold,
          morningDigestTime:
            result.morningDigestTime ?? prev.morningDigestTime,
          uiMode: result.uiMode ?? prev.uiMode,
          developerMode: result.developerMode === true,
          demoMode: result.demoMode === true,
          morningBriefEnabled: result.morningBriefEnabled !== false,
          calendarIcsUrl: result.calendarIcsUrl ?? "",
        }));
        setLoaded(true);
      },
    );

    // Load channel filter + discover channels from raw messages
    chrome.storage.local.get("slackChannelFilter").then((cfResult) => {
      if (cfResult.slackChannelFilter) {
        setChannelFilter(cfResult.slackChannelFilter as Record<string, boolean>);
      }
    });
    db.raw_messages
      .where("source_type")
      .equals("slack")
      .uniqueKeys()
      .then(() => {
        // Get distinct channels from raw messages
        db.raw_messages.orderBy("context").uniqueKeys().then((keys) => {
          setDiscoveredChannels(keys.filter((k): k is string => typeof k === "string").sort());
        });
      })
      .catch(() => {});

    // Check Granola local connection status
    setExtensionId(chrome.runtime.id);
    chrome.runtime.sendMessage({ type: "GRANOLA_STATUS" }).then((res) => {
      if (res?.connected) setGranolaConnected(true);
    }).catch(() => {});
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

  // ─── Auto-save with debounce ───

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persistForm = useCallback((formData: FormState) => {
    chrome.storage.local.set(
      {
        anthropicApiKey: formData.anthropicApiKey,
        userName: formData.userName,
        userTitle: formData.userTitle,
        userCompany: formData.userCompany,
        timezone: formData.timezone,
        slackDisplayNames: formData.slackDisplayNames,
        slackScanFrequency: formData.slackScanFrequency,
        granolaPollFrequency: formData.granolaPollFrequency,
        confidenceThreshold: formData.confidenceThreshold,
        morningDigestTime: formData.morningDigestTime,
        uiMode: formData.uiMode,
        developerMode: formData.developerMode,
        demoMode: formData.demoMode,
        morningBriefEnabled: formData.morningBriefEnabled,
        calendarIcsUrl: formData.calendarIcsUrl,
      },
      () => {
        showToast("Settings saved", "success");
      },
    );
  }, [showToast]);

  const update = useCallback(
    <K extends keyof FormState>(key: K, value: FormState[K]) => {
      setForm((prev) => {
        const next = { ...prev, [key]: value };
        // Debounce save — 800ms after last change
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => persistForm(next), 800);
        return next;
      });
    },
    [persistForm],
  );

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
    showToast("All data cleared", "success");
  }, [showToast]);

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
    a.download = `clyde-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  // ─── Board columns (reactive from IndexedDB) ───

  const allColDefs = useLiveQuery(() => db.kanban_columns.orderBy("position").toArray(), []) ?? [];

  const [colDragId, setColDragId] = useState<string | null>(null);
  const [colDragOverId, setColDragOverId] = useState<string | null>(null);
  const [editingColId, setEditingColId] = useState<string | null>(null);
  const [editingColLabel, setEditingColLabel] = useState("");
  const [newColLabel, setNewColLabel] = useState("");
  const [addingCol, setAddingCol] = useState(false);

  // Ensure "inProgress" entry exists (idempotent)
  useEffect(() => {
    db.kanban_columns.get("inProgress").then((existing) => {
      if (!existing) {
        db.kanban_columns.get("inProgress").then(async (stillMissing) => {
          if (stillMissing === undefined) {
            const allCols = await db.kanban_columns.toArray();
            const minPos = allCols.length > 0 ? Math.min(...allCols.map((c) => c.position)) - 1 : 0;
            await db.kanban_columns.add({ id: "inProgress", label: "In Progress", position: minPos });
          }
        });
      }
    });
  }, []);

  const handleColReorder = useCallback(async (sourceId: string, targetId: string) => {
    if (sourceId === targetId) return;
    const cols = [...allColDefs];
    const fromIdx = cols.findIndex((c) => c.id === sourceId);
    const toIdx = cols.findIndex((c) => c.id === targetId);
    if (fromIdx === -1 || toIdx === -1) return;
    const reordered = [...cols];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);
    await db.transaction("rw", db.kanban_columns, async () => {
      for (let i = 0; i < reordered.length; i++) {
        await db.kanban_columns.update(reordered[i].id, { position: i });
      }
    });
  }, [allColDefs]);

  const handleColRename = useCallback(async (id: string, label: string) => {
    const trimmed = label.trim();
    if (trimmed) await db.kanban_columns.update(id, { label: trimmed });
    setEditingColId(null);
  }, []);

  const handleColDelete = useCallback(async (id: string) => {
    if (id === "inProgress") return;
    if (!window.confirm(`Delete this column? Items will return to their natural column.`)) return;
    await db.kanban_assignments.where("column_id").equals(id).delete();
    await db.kanban_columns.delete(id);
  }, []);

  const handleColAdd = useCallback(async (label: string) => {
    const trimmed = label.trim();
    if (!trimmed) return;
    const maxPos = allColDefs.reduce((m, c) => Math.max(m, c.position), -1);
    await db.kanban_columns.add({ id: Date.now().toString(), label: trimmed, position: maxPos + 1 });
    setNewColLabel("");
    setAddingCol(false);
  }, [allColDefs]);

  if (!loaded) return null;

  // ─── Tab Content Renderers ───

  const renderProfileTab = () => (
    <>
      {/* Identity */}
      <div style={sectionStyle}>
        <h2 style={sectionTitle}>Identity</h2>

        <div style={fieldRow}>
          <div>
            <div style={labelStyle}>Full Name</div>
            <div style={subLabel}>Used in AI prompts to identify your commitments</div>
          </div>
          <input
            type="text"
            style={inputStyle}
            value={form.userName}
            placeholder="Your Name"
            onChange={(e) => update("userName", e.target.value)}
          />
        </div>

        <div style={fieldRow}>
          <div>
            <div style={labelStyle}>Title / Role</div>
            <div style={subLabel}>Optional — adds context for the AI</div>
          </div>
          <input
            type="text"
            style={inputStyle}
            value={form.userTitle}
            placeholder="e.g. Director of Engineering"
            onChange={(e) => update("userTitle", e.target.value)}
          />
        </div>

        <div style={fieldRow}>
          <div>
            <div style={labelStyle}>Company</div>
            <div style={subLabel}>Optional</div>
          </div>
          <input
            type="text"
            style={inputStyle}
            value={form.userCompany}
            placeholder="e.g. Acme Corp"
            onChange={(e) => update("userCompany", e.target.value)}
          />
        </div>

        <div style={fieldRow}>
          <div>
            <div style={labelStyle}>Timezone</div>
            <div style={subLabel}>Auto-detected from your browser. Used for morning brief scheduling.</div>
          </div>
          <input
            type="text"
            style={inputStyle}
            value={form.timezone}
            placeholder="America/Denver"
            onChange={(e) => update("timezone", e.target.value)}
          />
        </div>

        <div style={{ ...fieldRow, marginBottom: 0 }}>
          <div>
            <div style={labelStyle}>Slack Display Name(s)</div>
            <div style={subLabel}>
              Comma-separated. Used to identify your messages.
              Falls back to auto-detection if empty.
            </div>
          </div>
          <input
            type="text"
            style={inputStyle}
            value={form.slackDisplayNames}
            placeholder="Your Name, First Name"
            onChange={(e) => update("slackDisplayNames", e.target.value)}
          />
        </div>
      </div>

      {/* Display */}
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
                    form.uiMode === mode ? OS.white : OS.text,
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
    </>
  );

  const renderIntegrationsTab = () => (
    <>
      {/* API Keys */}
      <div style={sectionStyle}>
        <h2 style={sectionTitle}>Anthropic API</h2>

        <div style={{ ...fieldRow, marginBottom: 0 }}>
          <div>
            <div style={labelStyle}>API Key</div>
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
      </div>

      {/* Granola */}
      <div style={sectionStyle}>
        <h2 style={sectionTitle}>Granola Meetings</h2>

        <div style={{ ...fieldRow, marginBottom: 0, alignItems: "flex-start" }}>
          <div style={{ flex: 1 }}>
            <div style={labelStyle}>Meeting Notes</div>
            <div style={subLabel}>Reads from local Granola cache via native messaging</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
            <span style={{
              fontSize: 12, fontWeight: 700,
              color: granolaConnected ? OS.green : OS.red,
              background: OS.bg,
              padding: "5px 12px", borderRadius: 8,
              border: `1px solid ${OS.border}`,
            }}>
              {granolaConnected ? "Connected (Local)" : "Not Connected"}
            </span>
            <button
              onClick={async () => {
                setGranolaTestLoading(true);
                try {
                  const res = await chrome.runtime.sendMessage({ type: "GRANOLA_STATUS" });
                  setGranolaConnected(!!res?.connected);
                  if (res?.connected) {
                    showToast("Granola connected", "success");
                  } else {
                    showToast(res?.error || "Native host not responding. Install it first.", "error");
                  }
                } catch (err) {
                  showToast(err instanceof Error ? err.message : "Connection test failed", "error");
                }
                setGranolaTestLoading(false);
              }}
              disabled={granolaTestLoading}
              style={{
                padding: "5px 12px", fontSize: 11, fontWeight: 600,
                fontFamily: OS.font, border: `1px solid ${OS.border}`,
                borderRadius: 8, background: OS.white,
                color: OS.secondary, cursor: "pointer",
              }}
            >
              {granolaTestLoading ? "Testing..." : "Test Connection"}
            </button>
          </div>
        </div>
        <Disclosure label="Setup instructions">
          <div style={{ fontWeight: 600, color: OS.text, marginBottom: 6 }}>Install the native host:</div>
          <div>1. Open Terminal</div>
          <div>2. Navigate to the extension's native-host directory</div>
          <div>3. Run the install command:</div>
          <div style={{
            margin: "8px 0", padding: "8px 10px", borderRadius: 6,
            background: OS.white, border: `1px solid ${OS.border}`,
            fontFamily: OS.mono, fontSize: 11, display: "flex",
            alignItems: "center", justifyContent: "space-between", gap: 8,
          }}>
            <code style={{ flex: 1, overflowX: "auto" }}>
              cd native-host && ./install.sh {extensionId}
            </code>
            <button
              onClick={() => {
                navigator.clipboard.writeText(`cd native-host && ./install.sh ${extensionId}`);
                setCopiedInstall(true);
                setTimeout(() => setCopiedInstall(false), 2000);
              }}
              style={{
                padding: "3px 8px", fontSize: 10, fontWeight: 600,
                fontFamily: OS.font, border: `1px solid ${OS.border}`,
                borderRadius: 4, background: copiedInstall ? OS.green : OS.white,
                color: copiedInstall ? OS.white : OS.secondary, cursor: "pointer",
                flexShrink: 0, transition: "all 0.15s ease",
              }}
            >
              {copiedInstall ? "Copied!" : "Copy"}
            </button>
          </div>
          <div>4. Click "Test Connection" above</div>
          <div style={{ marginTop: 6, fontSize: 11, color: OS.muted }}>
            Your extension ID: <code style={{ background: OS.white, padding: "1px 4px", borderRadius: 3 }}>{extensionId}</code>
          </div>
        </Disclosure>
      </div>

      {/* Google Docs */}
      <div style={sectionStyle}>
        <h2 style={sectionTitle}>Google Docs</h2>

        <div style={{ ...fieldRow, marginBottom: 0, alignItems: "flex-start" }}>
          <div style={{ flex: 1 }}>
            <div style={labelStyle}>Document Scanning</div>
            <div style={subLabel}>Extracts commitments from document text and comments</div>
          </div>
          <span style={{
            fontSize: 12, fontWeight: 700,
            color: OS.green,
            background: OS.bg,
            padding: "5px 12px", borderRadius: 8,
            border: `1px solid ${OS.border}`,
          }}>
            Active
          </span>
        </div>

        <Disclosure label="How it works">
          <div style={{ fontWeight: 600, color: OS.text, marginBottom: 4 }}>How it works</div>
          <div>Clyde automatically scans any Google Doc you have open. It reads both the document body and comment threads to find commitments and action items.</div>
          <div style={{ marginTop: 8 }}>
            <span style={{ fontWeight: 600, color: OS.text }}>What gets scanned:</span>
          </div>
          <div style={{ paddingLeft: 12 }}>
            &bull; Document text (re-scanned every 30s for changes){"\n"}
            &bull; Comments and reply threads{"\n"}
            &bull; Flushed to the extractor every 3 minutes
          </div>
          <div style={{ marginTop: 8, fontSize: 11, color: OS.muted }}>
            No setup required. Just open a Google Doc and Clyde will pick it up. Commitments from docs show the document title as the source context.
          </div>
        </Disclosure>
      </div>

      {/* Google Calendar */}
      <div style={sectionStyle}>
        <h2 style={sectionTitle}>Google Calendar</h2>

        <div style={{ ...fieldRow, marginBottom: 0, alignItems: "flex-start" }}>
          <div style={{ flex: 1, marginRight: 16 }}>
            <div style={labelStyle}>ICS Feed URL</div>
            <div style={subLabel}>
              Calendar &rarr; Settings &rarr; [your calendar] &rarr; Integrate calendar &rarr; "Secret address in iCal format"
            </div>
          </div>
          <input
            type="password"
            style={{ ...inputStyle, width: 260 }}
            value={form.calendarIcsUrl}
            placeholder="https://calendar.google.com/calendar/ical/..."
            onChange={(e) => update("calendarIcsUrl", e.target.value)}
          />
        </div>
      </div>

      {/* Voice Inbox */}
      <div style={sectionStyle}>
        <h2 style={sectionTitle}>Voice Inbox</h2>

        <div style={{ ...fieldRow, marginBottom: 0, alignItems: "flex-start" }}>
          <div style={{ flex: 1 }}>
            <div style={labelStyle}>Dictate Tasks by Voice</div>
            <div style={subLabel}>Say a task via Siri and Clyde picks it up automatically</div>
          </div>
          <span style={{
            fontSize: 12, fontWeight: 700,
            color: OS.green,
            background: OS.bg,
            padding: "5px 12px", borderRadius: 8,
            border: `1px solid ${OS.border}`,
          }}>
            Ready
          </span>
        </div>

        <Disclosure label="How it works">
          <div style={{ fontWeight: 600, color: OS.text, marginBottom: 6 }}>How it works</div>
          <div>Say <strong>&quot;Hey Siri, Clyde task&quot;</strong> from anywhere on your Mac. Dictate your task, and Clyde will pick it up within 2 minutes and extract the commitment (deadline, urgency, etc).</div>

          <div style={{ fontWeight: 600, color: OS.text, marginTop: 12, marginBottom: 6 }}>One-time setup: Create an Apple Shortcut</div>
          <div>1. Open the <strong>Shortcuts</strong> app on your Mac</div>
          <div>2. Click <strong>+</strong> to create a new Shortcut</div>
          <div>3. Name it <strong>&quot;Clyde Task&quot;</strong> (this becomes the Siri trigger)</div>
          <div>4. Add these 3 actions:</div>
          <div style={{ paddingLeft: 16, marginTop: 4 }}>
            <div><strong>a.</strong> <em>Dictate Text</em> &mdash; set language to English, stop listening &quot;After Pause&quot;</div>
            <div><strong>b.</strong> <em>Append to File</em> &mdash; set file path to:</div>
            <div style={{
              margin: "6px 0", padding: "6px 10px", borderRadius: 6,
              background: OS.white, border: `1px solid ${OS.border}`,
              fontFamily: OS.mono, fontSize: 11,
            }}>
              ~/Documents/clyde-inbox.txt
            </div>
            <div style={{ fontSize: 11, color: OS.muted, marginBottom: 4 }}>
              Set &quot;Make New Line&quot; to On. Pass &quot;Dictated Text&quot; as input.
            </div>
            <div><strong>c.</strong> <em>Show Notification</em> &mdash; &quot;Task added to Clyde&quot; (optional)</div>
          </div>
          <div style={{ marginTop: 8 }}>5. Done! Say <strong>&quot;Hey Siri, Clyde task&quot;</strong> to test it.</div>

          <div style={{ fontWeight: 600, color: OS.text, marginTop: 12, marginBottom: 4 }}>Also works with</div>
          <div style={{ paddingLeft: 12 }}>
            &bull; <strong>Wispr Flow</strong> or any dictation tool &mdash; just focus a text field and dictate{"\n"}
            &bull; <strong>Keyboard shortcut</strong> &mdash; assign one in Shortcuts &gt; right-click &gt; &quot;Add Keyboard Shortcut&quot;{"\n"}
            &bull; <strong>Manual typing</strong> &mdash; add a line to ~/Documents/clyde-inbox.txt
          </div>

          <div style={{ marginTop: 10, fontSize: 11, color: OS.muted }}>
            Clyde checks the inbox file every 2 minutes via native messaging. Tasks are processed through Claude to extract deadlines, urgency, and direction, then cleared from the file.
          </div>
        </Disclosure>
      </div>

      {/* Channel Filters */}
      {discoveredChannels.length > 0 && (
        <div style={sectionStyle}>
          <h2 style={sectionTitle}>Slack Channel Filters</h2>
          <p style={{ fontSize: 12, color: OS.muted, marginBottom: 16, lineHeight: 1.5 }}>
            Toggle channels on/off. Disabled channels won't be scanned for commitments.
            New channels default to enabled.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {discoveredChannels.map((ch) => {
              const enabled = channelFilter[ch] ?? true;
              return (
                <div key={ch} style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "8px 10px", background: OS.bg, borderRadius: 6,
                  border: `1px solid ${OS.border}`,
                }}>
                  <span style={{ fontSize: 13, fontWeight: 500, color: OS.text }}>
                    #{ch}
                  </span>
                  <button
                    onClick={() => {
                      const updated = { ...channelFilter, [ch]: !enabled };
                      setChannelFilter(updated);
                      chrome.storage.local.set({ slackChannelFilter: updated });
                    }}
                    style={{
                      width: 48, height: 26, borderRadius: 13, border: "none",
                      background: enabled ? OS.blue : OS.faint,
                      cursor: "pointer", position: "relative", transition: "background 0.2s",
                      flexShrink: 0,
                    }}
                  >
                    <div style={{
                      width: 20, height: 20, borderRadius: 10, background: OS.white,
                      position: "absolute", top: 3,
                      left: enabled ? 25 : 3,
                      transition: "left 0.2s ease",
                      boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                    }} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );

  const renderDetectionTab = () => (
    <>
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

      {/* Detection */}
      <div style={sectionStyle}>
        <h2 style={sectionTitle}>Detection</h2>

        <div style={{ ...fieldRow, marginBottom: 0 }}>
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
      </div>

      {/* Morning Brief */}
      <div style={sectionStyle}>
        <h2 style={sectionTitle}>Morning Brief</h2>

        <div style={fieldRow}>
          <div>
            <div style={labelStyle}>Enable Morning Brief</div>
            <div style={subLabel}>Auto-generates when you open the Brief tab</div>
          </div>
          <Toggle value={form.morningBriefEnabled} onChange={() => update("morningBriefEnabled", !form.morningBriefEnabled)} />
        </div>

        <div style={{ ...fieldRow, marginBottom: 0, alignItems: "flex-start" }}>
          <div style={{ flex: 1, marginRight: 16 }}>
            <div style={labelStyle}>Google Calendar ICS URL</div>
            <div style={subLabel}>
              Used by the brief to schedule priorities around your meetings
            </div>
          </div>
          <input
            type="password"
            style={{ ...inputStyle, width: 260 }}
            value={form.calendarIcsUrl}
            placeholder="https://calendar.google.com/calendar/ical/..."
            onChange={(e) => update("calendarIcsUrl", e.target.value)}
          />
        </div>
      </div>

      {/* Board Columns */}
      <div style={sectionStyle}>
        <h2 style={sectionTitle}>Board Columns</h2>
        <p style={{ fontSize: 12, color: OS.muted, marginBottom: 16, lineHeight: 1.5 }}>
          Drag &#x2807; to reorder. Double-click a name to rename. "Todo" and "Done" are fixed.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
          {allColDefs.map((col) => {
            const isIP = col.id === "inProgress";
            const isEditing = editingColId === col.id;
            const isDragging = colDragId === col.id;
            const isDragOver = colDragOverId === col.id;

            return (
              <div
                key={col.id}
                onDragOver={(e) => { e.preventDefault(); setColDragOverId(col.id); }}
                onDragLeave={() => setColDragOverId(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  const src = e.dataTransfer.getData("application/x-column-id");
                  setColDragOverId(null);
                  setColDragId(null);
                  if (src) handleColReorder(src, col.id);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 10px",
                  background: isDragOver ? "#eef4ff" : OS.bg,
                  border: `1px solid ${isDragOver ? OS.blue : OS.border}`,
                  borderRadius: 8,
                  opacity: isDragging ? 0.4 : 1,
                  transition: "all 0.12s ease",
                }}
              >
                {/* Drag handle */}
                <span
                  draggable
                  onDragStart={(e) => {
                    setColDragId(col.id);
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("application/x-column-id", col.id);
                  }}
                  onDragEnd={() => { setColDragId(null); setColDragOverId(null); }}
                  style={{ cursor: "grab", color: OS.faint, fontSize: 14, userSelect: "none", flexShrink: 0 }}
                  title="Drag to reorder"
                >
                  &#x2807;
                </span>

                {/* Label */}
                {isEditing ? (
                  <input
                    autoFocus
                    value={editingColLabel}
                    onChange={(e) => setEditingColLabel(e.target.value)}
                    onBlur={() => handleColRename(col.id, editingColLabel)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleColRename(col.id, editingColLabel);
                      if (e.key === "Escape") setEditingColId(null);
                    }}
                    style={{
                      flex: 1, fontSize: 13, padding: "2px 6px",
                      border: `1px solid ${OS.blue}`, borderRadius: 4,
                      fontFamily: OS.font, outline: "none",
                    }}
                  />
                ) : (
                  <span
                    style={{ flex: 1, fontSize: 13, fontWeight: 500, color: OS.text }}
                    onDoubleClick={() => { setEditingColId(col.id); setEditingColLabel(col.label); }}
                    title="Double-click to rename"
                  >
                    {col.label}
                    {isIP && (
                      <span style={{ fontSize: 10, color: OS.faint, marginLeft: 6 }}>(built-in)</span>
                    )}
                  </span>
                )}

                {/* Rename button */}
                {!isEditing && (
                  <button
                    onClick={() => { setEditingColId(col.id); setEditingColLabel(col.label); }}
                    style={{
                      padding: "2px 8px", fontSize: 11, fontFamily: OS.font,
                      border: `1px solid ${OS.border}`, borderRadius: 4,
                      background: OS.white, color: OS.secondary, cursor: "pointer",
                    }}
                  >
                    Rename
                  </button>
                )}

                {/* Delete — custom only */}
                {!isIP && !isEditing && (
                  <button
                    onClick={() => handleColDelete(col.id)}
                    style={{
                      padding: "2px 8px", fontSize: 11, fontFamily: OS.font,
                      border: "1px solid #fca5a5", borderRadius: 4,
                      background: OS.white, color: OS.red, cursor: "pointer",
                    }}
                  >
                    Delete
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* Add column */}
        {addingCol ? (
          <div style={{ display: "flex", gap: 6 }}>
            <input
              autoFocus
              value={newColLabel}
              onChange={(e) => setNewColLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleColAdd(newColLabel);
                if (e.key === "Escape") { setAddingCol(false); setNewColLabel(""); }
              }}
              placeholder="Column name..."
              style={{
                flex: 1, padding: "7px 10px",
                border: `1px solid ${OS.blue}`, borderRadius: 6,
                fontSize: 13, fontFamily: OS.font, outline: "none",
              }}
            />
            <button
              onClick={() => handleColAdd(newColLabel)}
              style={{
                padding: "7px 16px", background: OS.blue, color: OS.white,
                border: "none", borderRadius: 6, fontSize: 13,
                fontWeight: 600, cursor: "pointer", fontFamily: OS.font,
              }}
            >
              Add
            </button>
            <button
              onClick={() => { setAddingCol(false); setNewColLabel(""); }}
              style={{
                padding: "7px 12px", background: OS.bg, color: OS.muted,
                border: `1px solid ${OS.border}`, borderRadius: 6,
                fontSize: 13, cursor: "pointer", fontFamily: OS.font,
              }}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setAddingCol(true)}
            style={{
              width: "100%", padding: "8px 0",
              background: "transparent", color: OS.secondary,
              border: `1px dashed ${OS.border}`, borderRadius: 6,
              fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: OS.font,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = OS.blue; e.currentTarget.style.color = OS.blue; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = OS.border; e.currentTarget.style.color = OS.secondary; }}
          >
            + Add column
          </button>
        )}
      </div>
    </>
  );

  const renderAdvancedTab = () => (
    <>
      {/* Developer Mode */}
      <div style={sectionStyle}>
        <h2 style={sectionTitle}>Developer</h2>

        <div style={{ ...fieldRow, marginBottom: 0 }}>
          <div>
            <div style={labelStyle}>Developer Mode</div>
            <div style={subLabel}>
              Logs what the AI decides is NOT a commitment so you can tune detection.
              Visible in the "Dev Log" tab in the popup.
            </div>
          </div>
          <Toggle value={form.developerMode} onChange={() => update("developerMode", !form.developerMode)} />
        </div>
      </div>

      {/* Demo Mode */}
      <div style={sectionStyle}>
        <h2 style={{ ...sectionTitle, color: "#92400e" }}>Demo Mode</h2>

        <div style={{ ...fieldRow, marginBottom: 0 }}>
          <div>
            <div style={labelStyle}>Demo Mode</div>
            <div style={subLabel}>
              Replace all data with sample data for presentations.
              Your real data is preserved and will return when demo mode is off.
            </div>
          </div>
          <Toggle value={form.demoMode} onChange={() => update("demoMode", !form.demoMode)} color="#b08d33" />
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

        <div style={{ ...fieldRow, marginBottom: 0 }}>
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
      </div>

      {/* Danger Zone */}
      <div style={{
        ...sectionStyle,
        border: "1px solid #fca5a5",
        background: "#fef2f2",
      }}>
        <h2 style={{ ...sectionTitle, color: OS.red }}>Danger Zone</h2>

        <div style={{ ...fieldRow, marginBottom: 0 }}>
          <div>
            <div style={{ ...labelStyle, color: OS.red }}>
              Clear All Data
            </div>
            <div style={subLabel}>
              Permanently delete all commitments, messages, and settings
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
              color: OS.red,
              cursor: "pointer",
            }}
          >
            Clear All Data
          </button>
        </div>
      </div>
    </>
  );

  return (
    <>
      <div style={{ maxWidth: 600, margin: "0 auto", padding: "16px 24px 0" }}>
        {/* Back link */}
        <button
          onClick={() => {
            if (onBack) {
              onBack();
            } else {
              const popupUrl = chrome.runtime.getURL("src/sidepanel/index.html");
              window.location.href = popupUrl;
            }
          }}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            background: "none",
            border: "none",
            color: OS.blue,
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
            padding: 0,
            marginBottom: 16,
            fontFamily: OS.font,
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><IconChevronLeft size={14} /> {onBack ? "Back" : "Back to Clyde"}</span>
        </button>

        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 20,
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
            <IconLogo size={18} />
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
            <span style={{ fontSize: 12, color: OS.muted }}>
              Clyde
            </span>
          </div>
        </div>

        {/* Tab Bar */}
        <div style={{
          display: "flex",
          gap: 0,
          marginBottom: 24,
          borderBottom: `2px solid ${OS.border}`,
        }}>
          {TABS.map((tab) => {
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                style={{
                  padding: "10px 18px",
                  fontSize: 13,
                  fontWeight: isActive ? 700 : 500,
                  fontFamily: OS.font,
                  color: isActive ? OS.blue : OS.muted,
                  background: "none",
                  border: "none",
                  borderBottom: isActive ? `2px solid ${OS.blue}` : "2px solid transparent",
                  marginBottom: -2,
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Tab Content */}
        {activeTab === "profile" && renderProfileTab()}
        {activeTab === "integrations" && renderIntegrationsTab()}
        {activeTab === "detection" && renderDetectionTab()}
        {activeTab === "advanced" && renderAdvancedTab()}

        {/* Footer */}
        <div style={{ height: 16 }} />
        <div
          style={{
            textAlign: "center",
            marginTop: 20,
            fontSize: 11,
            color: OS.muted,
          }}
        >
          Settings are stored locally in Chrome
        </div>
      </div>
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}

export default function Options() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: OS.bg,
        fontFamily: OS.font,
        color: OS.text,
        padding: "32px 0",
      }}
    >
      <SettingsPanel />
    </div>
  );
}
