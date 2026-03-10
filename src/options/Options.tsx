import React, { useState, useEffect, useCallback, useRef } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { OS } from "@shared/tokens";
import { db, ensureGeneralTag, getNextTagColor } from "@shared/db";
import { DEFAULTS } from "@shared/constants";
import { IconChevronRight, IconChevronLeft, IconLogo } from "../popup/components/Icons";
import { USER_PROFILE_DEFAULTS } from "@shared/user-profile";
import { ToastContainer, useToast } from "../popup/components/Toast";
import { retagAll, reanalyzeSensitivity } from "../background/tag-backfill";

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
  confidenceAutoTune: boolean;
  morningDigestTime: string;
  uiMode: "popup" | "sidepanel";
  developerMode: boolean;
  demoMode: boolean;
  morningBriefEnabled: boolean;
  calendarIcsUrl: string;
  voiceInboxEnabled: boolean;
  googleDocsEnabled: boolean;
  gmailEnabled: boolean;
  slackEnabled: boolean;
  granolaEnabled: boolean;
  calendarEnabled: boolean;
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
  confidenceAutoTune: false,
  morningDigestTime: `${String(DEFAULTS.morningDigestHour).padStart(2, "0")}:${String(DEFAULTS.morningDigestMinute).padStart(2, "0")}`,
  uiMode: DEFAULTS.uiMode,
  developerMode: false,
  demoMode: false,
  morningBriefEnabled: true,
  calendarIcsUrl: "",
  voiceInboxEnabled: false,
  googleDocsEnabled: false,
  gmailEnabled: false,
  slackEnabled: true,
  granolaEnabled: true,
  calendarEnabled: true,
};

type SettingsTab = "profile" | "integrations" | "detection" | "advanced";

const TABS: { key: SettingsTab; label: string }[] = [
  { key: "profile", label: "Profile" },
  { key: "integrations", label: "Integrations" },
  { key: "detection", label: "Preferences" },
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

/** Restore backup state directly into IndexedDB (runs in Options/popup context) */
async function doRestore(state: Record<string, unknown>): Promise<void> {
  const commitments = (state.commitments ?? []) as Array<Record<string, unknown>>;

  if (commitments.length > 0) {
    // Deduplicate by hash
    const byHash = new Map<string, Record<string, unknown>>();
    for (const c of commitments) {
      const hash = c.hash as string;
      if (hash && !byHash.has(hash)) byHash.set(hash, c);
    }
    const unique = [...byHash.values()];

    // Snapshot existing data so we can roll back if the write fails
    const existingCommitments = await db.commitments.toArray();
    try {
      // Wipe and re-add — keep original IDs so kanban assignments still match
      await db.delete();
      await db.open();
      await db.commitments.bulkPut(unique as unknown as Parameters<typeof db.commitments.bulkPut>[0]);
    } catch (err) {
      // Write failed — attempt to restore original data before re-throwing
      try {
        await db.delete();
        await db.open();
        if (existingCommitments.length > 0) {
          await db.commitments.bulkPut(existingCommitments as unknown as Parameters<typeof db.commitments.bulkPut>[0]);
        }
      } catch {
        // Best-effort rollback; original error is more important
      }
      throw err;
    }
  }

  // Tags — must be restored before commitments reference them via tag_id
  const tags = (state.tags ?? []) as Array<Record<string, unknown>>;
  if (tags.length > 0) {
    await db.tags.bulkPut(tags as unknown as Parameters<typeof db.tags.bulkPut>[0]);
  }

  // Kanban columns
  const columns = (state.kanban_columns ?? []) as Array<Record<string, unknown>>;
  if (columns.length > 0 && (await db.kanban_columns.count()) === 0) {
    await db.kanban_columns.bulkAdd(columns as unknown as Parameters<typeof db.kanban_columns.bulkAdd>[0]);
  }

  // Kanban assignments
  const assignments = (state.kanban_assignments ?? []) as Array<Record<string, unknown>>;
  if (assignments.length > 0) {
    await db.kanban_assignments.bulkPut(assignments as unknown as Parameters<typeof db.kanban_assignments.bulkPut>[0]);
  }

  // Dismissals
  const dismissals = (state.dismissals ?? []) as Array<Record<string, unknown>>;
  if (dismissals.length > 0 && (await db.dismissals.count()) === 0) {
    const cleaned = dismissals.map(({ id: _id, ...rest }) => rest);
    await db.dismissals.bulkAdd(cleaned as unknown as Parameters<typeof db.dismissals.bulkAdd>[0]);
  }

  // Chrome storage settings — strip API key to prevent malicious backup from overwriting it
  const chromeStorage = state.chrome_storage as Record<string, unknown> | undefined;
  if (chromeStorage) {
    const { anthropicApiKey: _drop, ...safeStorage } = chromeStorage;
    await chrome.storage.local.set(safeStorage);
  }
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
  const [restoring, setRestoring] = useState(false);
  const [channelFilter, setChannelFilter] = useState<Record<string, boolean>>({});
  const [discoveredChannels, setDiscoveredChannels] = useState<string[]>([]);
  const [tuneInfo, setTuneInfo] = useState<{ lastChecked: string; dismissRate: number; totalSamples: number } | null>(null);
  const [deleteColConfirm, setDeleteColConfirm] = useState<{ id: string; label: string; itemCount: number } | null>(null);
  const [deleteMoveTarget, setDeleteMoveTarget] = useState<string>("todo");
  const [retagging, setRetagging] = useState(false);
  const [retagResult, setRetagResult] = useState<string | null>(null);
  const [recheckingSensitivity, setRecheckingSensitivity] = useState(false);
  const [recheckSensitivityResult, setRecheckSensitivityResult] = useState<string | null>(null);
  const [newTagLabel, setNewTagLabel] = useState("");
  const [editingTagId, setEditingTagId] = useState<number | null>(null);
  const [editingTagLabel, setEditingTagLabel] = useState("");

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
        "confidenceAutoTune",
        "confidenceTuneInfo",
        "morningDigestTime",
        "uiMode",
        "developerMode",
        "demoMode",
        "morningBriefEnabled",
        "calendarIcsUrl",
        "voiceInboxEnabled",
        "googleDocsEnabled",
        "gmailEnabled",
        "slackEnabled",
        "granolaEnabled",
        "calendarEnabled",
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
          confidenceThreshold: (() => {
            const stored = result.confidenceThreshold as number | undefined;
            if (stored == null) return prev.confidenceThreshold;
            // Handle old format (stored as integer %, e.g. 60) vs new format (decimal, e.g. 0.6)
            return stored > 1 ? stored : Math.round(stored * 100);
          })(),
          confidenceAutoTune:
            result.confidenceAutoTune ?? prev.confidenceAutoTune,
          morningDigestTime:
            result.morningDigestTime ?? prev.morningDigestTime,
          uiMode: result.uiMode ?? prev.uiMode,
          developerMode: result.developerMode === true,
          demoMode: result.demoMode === true,
          morningBriefEnabled: result.morningBriefEnabled !== false,
          calendarIcsUrl: result.calendarIcsUrl ?? "",
          voiceInboxEnabled: result.voiceInboxEnabled === true,
          googleDocsEnabled: result.googleDocsEnabled === true,
          gmailEnabled: result.gmailEnabled === true,
          slackEnabled: result.slackEnabled !== false,
          granolaEnabled: result.granolaEnabled !== false,
          calendarEnabled: result.calendarEnabled !== false,
        }));
        if (result.confidenceTuneInfo) {
          setTuneInfo(result.confidenceTuneInfo as { lastChecked: string; dismissRate: number; totalSamples: number });
        }
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
        confidenceThreshold: formData.confidenceThreshold / 100,
        confidenceAutoTune: formData.confidenceAutoTune,
        morningDigestTime: formData.morningDigestTime,
        uiMode: formData.uiMode,
        developerMode: formData.developerMode,
        demoMode: formData.demoMode,
        morningBriefEnabled: formData.morningBriefEnabled,
        calendarIcsUrl: formData.calendarIcsUrl,
        voiceInboxEnabled: formData.voiceInboxEnabled,
        googleDocsEnabled: formData.googleDocsEnabled,
        gmailEnabled: formData.gmailEnabled,
        slackEnabled: formData.slackEnabled,
        granolaEnabled: formData.granolaEnabled,
        calendarEnabled: formData.calendarEnabled,
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
    const tags = await db.tags.toArray();

    const data = { commitments, raw_messages, dismissals, action_log, tags };
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

  // ─── Tags (reactive from IndexedDB) ───

  const allTagDefs = useLiveQuery(() => db.tags.orderBy("name").toArray(), []) ?? [];

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

  // ─── Tag management ───

  const handleTagAdd = useCallback(async (label: string) => {
    const trimmed = label.trim();
    if (!trimmed) return;
    const existingCount = await db.tags.count();
    await db.tags.add({ name: trimmed, color: getNextTagColor(existingCount), createdAt: new Date().toISOString() });
    setNewTagLabel("");
  }, []);

  const handleTagRename = useCallback(async (id: number, label: string) => {
    const trimmed = label.trim();
    if (trimmed) await db.tags.update(id, { name: trimmed });
    setEditingTagId(null);
  }, []);

  const handleTagDelete = useCallback(async (id: number) => {
    const generalTagId = await ensureGeneralTag();
    if (id === generalTagId) return; // can't delete General
    // Move all commitments using this tag to General
    await db.commitments.where("tag_id").equals(id).modify({ tag_id: generalTagId });
    await db.tags.delete(id);
  }, []);

  const handleRecheckSensitivity = useCallback(async () => {
    setRecheckingSensitivity(true);
    setRecheckSensitivityResult(null);
    try {
      const { updated, total } = await reanalyzeSensitivity();
      setRecheckSensitivityResult(`Done — ${updated} of ${total} commitments evaluated`);
    } catch (e) {
      setRecheckSensitivityResult("Error: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setRecheckingSensitivity(false);
    }
  }, []);

  const handleRetagAll = useCallback(async () => {
    setRetagging(true);
    setRetagResult(null);
    try {
      const { tagCount, commitmentCount } = await retagAll();
      setRetagResult(`Done — ${commitmentCount} commitments re-tagged across ${tagCount} tags`);
    } catch (err) {
      setRetagResult(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRetagging(false);
    }
  }, []);

  // ─── Column management ───

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

  const handleColDeleteRequest = useCallback(async (id: string) => {
    if (id === "inProgress") return;
    const col = allColDefs.find((c) => c.id === id);
    if (!col) return;
    const itemCount = await db.kanban_assignments.where("column_id").equals(id).count();
    setDeleteMoveTarget("todo");
    setDeleteColConfirm({ id, label: col.label, itemCount });
  }, [allColDefs]);

  const handleColDeleteConfirm = useCallback(async () => {
    if (!deleteColConfirm) return;
    const { id } = deleteColConfirm;
    if (deleteMoveTarget === "todo") {
      // Drop assignments — cards return to Todo naturally
      await db.kanban_assignments.where("column_id").equals(id).delete();
    } else {
      // Move assignments to the chosen column
      const toMove = await db.kanban_assignments.where("column_id").equals(id).toArray();
      await db.transaction("rw", db.kanban_assignments, async () => {
        for (const a of toMove) {
          await db.kanban_assignments.put({ ...a, column_id: deleteMoveTarget });
        }
      });
    }
    await db.kanban_columns.delete(id);
    setDeleteColConfirm(null);
  }, [deleteColConfirm, deleteMoveTarget]);

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
      {/* About You */}
      <div style={sectionStyle}>
        <h2 style={sectionTitle}>About You</h2>
        <p style={{ fontSize: 12, color: OS.muted, marginBottom: 16, lineHeight: 1.5 }}>
          Clyde uses this to personalize AI prompts and identify which commitments are yours.
        </p>

        <div style={fieldRow}>
          <div>
            <div style={labelStyle}>Full Name</div>
            <div style={subLabel}>How Clyde identifies you in conversations</div>
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
            <div style={subLabel}>Helps Clyde flag sensitive topics appropriately (e.g. HR, leadership)</div>
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
            <div style={subLabel}>Optional — used for context in the morning brief</div>
          </div>
          <input
            type="text"
            style={inputStyle}
            value={form.userCompany}
            placeholder="e.g. Acme Corp"
            onChange={(e) => update("userCompany", e.target.value)}
          />
        </div>

        <div style={{ ...fieldRow, marginBottom: 0 }}>
          <div>
            <div style={labelStyle}>Timezone</div>
            <div style={subLabel}>Used to schedule your morning brief at the right time</div>
          </div>
          <input
            type="text"
            style={inputStyle}
            value={form.timezone}
            placeholder="America/Denver"
            onChange={(e) => update("timezone", e.target.value)}
          />
        </div>
      </div>

      {/* Appearance */}
      <div style={sectionStyle}>
        <h2 style={sectionTitle}>Appearance</h2>

        <div style={{ ...fieldRow, marginBottom: 0 }}>
          <div>
            <div style={labelStyle}>Open As</div>
            <div style={subLabel}>
              How the extension opens when you click the toolbar icon
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
      {/* AI Setup — required, goes first */}
      <div style={{ ...sectionStyle, border: `1.5px solid ${OS.blue}` }}>
        <h2 style={sectionTitle}>AI Setup <span style={{ fontSize: 11, fontWeight: 600, color: OS.red, marginLeft: 6 }}>Required</span></h2>
        <p style={{ fontSize: 12, color: OS.muted, marginBottom: 14, lineHeight: 1.5 }}>
          Clyde uses Claude (Anthropic) to read your messages and find commitments. You need an API key to use Clyde.
        </p>

        <div style={{ ...fieldRow, marginBottom: 0 }}>
          <div>
            <div style={labelStyle}>Anthropic API Key</div>
            <div style={subLabel}>Get one at console.anthropic.com — costs ~$0.003 per extraction</div>
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

      {/* Slack */}
      <div style={sectionStyle}>
        <h2 style={sectionTitle}>Slack</h2>

        <div style={{ ...fieldRow, alignItems: "flex-start" }}>
          <div style={{ flex: 1 }}>
            <div style={labelStyle}>Monitor Slack</div>
            <div style={subLabel}>Watches messages you view in Slack for commitments and action items</div>
          </div>
          <Toggle value={form.slackEnabled} onChange={() => update("slackEnabled", !form.slackEnabled)} />
        </div>

        {form.slackEnabled && (
          <div style={{ ...fieldRow, alignItems: "flex-start" }}>
            <div style={{ flex: 1 }}>
              <div style={labelStyle}>Your Slack Display Name(s)</div>
              <div style={subLabel}>
                Comma-separated. Clyde uses this to find messages <em>you</em> sent.
                Defaults to your profile name if empty.
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
        )}

        <Disclosure label="How Slack monitoring works">
          <div style={{ fontWeight: 600, color: OS.text, marginBottom: 6 }}>Browser-based — no Slack API or admin access needed</div>
          <div>Clyde reads Slack as you browse it in Chrome. It only sees the conversations you actually open — it never reads your entire Slack workspace in the background.</div>
          <div style={{ marginTop: 8 }}>
            <span style={{ fontWeight: 600, color: OS.text }}>To use it:</span>
          </div>
          <div style={{ paddingLeft: 12, marginTop: 4, lineHeight: 1.8 }}>
            &bull; Open <strong>Slack in Chrome</strong> (slack.com) — the desktop app is not supported{"\n"}
            &bull; Clyde captures messages from <strong>channels and DMs you open</strong>{"\n"}
            &bull; Messages batch every ~5 minutes, then Claude scans for commitments{"\n"}
            &bull; Only commitment-like messages are extracted (not every message)
          </div>
          <div style={{ marginTop: 8, fontSize: 11, color: OS.muted }}>
            Tip: Keep Slack pinned as a tab in Chrome so Clyde captures messages throughout the day.
          </div>
        </Disclosure>
      </div>

      {/* Granola */}
      <div style={sectionStyle}>
        <h2 style={sectionTitle}>Granola Meetings</h2>
        <p style={{ fontSize: 12, color: OS.muted, marginBottom: 14, lineHeight: 1.5 }}>
          Reads your meeting notes from Granola and extracts commitments from transcripts.
        </p>

        <div style={{ ...fieldRow, alignItems: "flex-start" }}>
          <div style={{ flex: 1 }}>
            <div style={labelStyle}>Enable Granola</div>
            <div style={subLabel}>Scans new meetings automatically in the background</div>
          </div>
          <Toggle value={form.granolaEnabled} onChange={() => update("granolaEnabled", !form.granolaEnabled)} />
        </div>

        <div style={{ ...fieldRow, marginBottom: 0, alignItems: "flex-start" }}>
          <div style={{ flex: 1 }}>
            <div style={labelStyle}>Native Host</div>
            <div style={subLabel}>Reads from local Granola cache — requires a one-time install</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
            <span style={{
              fontSize: 12, fontWeight: 700,
              color: granolaConnected ? OS.green : OS.red,
              background: OS.bg,
              padding: "5px 12px", borderRadius: 8,
              border: `1px solid ${OS.border}`,
            }}>
              {granolaConnected ? "Connected" : "Not Connected"}
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
        <Disclosure label="First-time setup">
          <div style={{ fontWeight: 600, color: OS.text, marginBottom: 6 }}>Run this once in Terminal:</div>
          <div style={{
            margin: "8px 0", padding: "8px 10px", borderRadius: 6,
            background: OS.white, border: `1px solid ${OS.border}`,
            fontFamily: OS.mono, fontSize: 11, display: "flex",
            alignItems: "center", justifyContent: "space-between", gap: 8,
          }}>
            <code style={{ flex: 1, overflowX: "auto", whiteSpace: "nowrap" }}>
              cd ~/Clyde-AI-Assistant/native-host && ./install.sh {extensionId}
            </code>
            <button
              onClick={() => {
                navigator.clipboard.writeText(`cd ~/Clyde-AI-Assistant/native-host && ./install.sh ${extensionId}`);
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
          <div style={{ marginTop: 8, lineHeight: 1.6 }}>
            After running the command:<br />
            1. <strong>Quit Chrome completely</strong> (Cmd+Q / Ctrl+Q) and reopen it<br />
            2. Come back here and click <strong>Test Connection</strong>
          </div>
        </Disclosure>
      </div>

      {/* Google Docs */}
      <div style={sectionStyle}>
        <h2 style={{ ...sectionTitle, display: "flex", alignItems: "center", gap: 8 }}>
          Google Docs
          <span style={{
            fontSize: 10, fontWeight: 700, color: "#7c3aed",
            background: "#ede9fe", padding: "2px 7px", borderRadius: 4,
            letterSpacing: "0.03em",
          }}>BETA</span>
        </h2>

        <div style={{ ...fieldRow, marginBottom: 0, alignItems: "flex-start" }}>
          <div style={{ flex: 1 }}>
            <div style={labelStyle}>Document Scanning</div>
            <div style={subLabel}>Extracts commitments from document text and comments</div>
          </div>
          <Toggle
            value={form.googleDocsEnabled}
            onChange={() => update("googleDocsEnabled", !form.googleDocsEnabled)}
          />
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
          <div style={{ marginTop: 6, fontSize: 11, color: "#b08d33" }}>
            Note: toggling this on/off takes effect on the next page load — reload any open Google Docs tabs after changing this setting.
          </div>
        </Disclosure>
      </div>

      {/* Gmail */}
      <div style={sectionStyle}>
        <h2 style={{ ...sectionTitle, display: "flex", alignItems: "center", gap: 8 }}>
          Gmail
          <span style={{
            fontSize: 10, fontWeight: 700, color: OS.blue,
            background: OS.blueBg, padding: "2px 7px", borderRadius: 4,
            letterSpacing: "0.03em",
          }}>BETA</span>
        </h2>

        <div style={{ ...fieldRow, marginBottom: 0, alignItems: "flex-start" }}>
          <div style={{ flex: 1 }}>
            <div style={labelStyle}>Scan Gmail for Commitments</div>
            <div style={subLabel}>Reads emails you open and extracts commitments</div>
          </div>
          <Toggle
            value={form.gmailEnabled}
            onChange={() => update("gmailEnabled", !form.gmailEnabled)}
          />
        </div>

        <Disclosure label="How it works">
          <div style={{ fontWeight: 600, color: OS.text, marginBottom: 4 }}>How it works</div>
          <div>When you open an email thread in Gmail, Clyde reads the message body and looks for commitments. Quoted replies and forwarded history are stripped before analysis.</div>
          <div style={{ marginTop: 8 }}>
            <span style={{ fontWeight: 600, color: OS.text }}>What's scanned:</span>
          </div>
          <div style={{ paddingLeft: 12 }}>
            <div>&bull; Emails you open in the main inbox view</div>
            <div>&bull; New messages in threads (not previously seen)</div>
            <div>&bull; Flushed to the extractor every 3 minutes</div>
          </div>
          <div style={{ marginTop: 8 }}>
            <span style={{ fontWeight: 600, color: OS.text }}>What's skipped:</span>
          </div>
          <div style={{ paddingLeft: 12 }}>
            <div>&bull; Promotions, Social, Spam, and Trash tabs</div>
            <div>&bull; Quoted/forwarded history in replies</div>
            <div>&bull; Compose windows (your drafts)</div>
            <div>&bull; Emails without commitment-like language</div>
          </div>
          <div style={{ marginTop: 8, fontSize: 11, color: OS.yellowText }}>
            First-time setup: Gmail requires a new host permission. Remove and re-add the extension as unpacked once — after that, toggling this setting takes effect immediately.
          </div>
        </Disclosure>
      </div>

      {/* Google Calendar */}
      <div style={sectionStyle}>
        <h2 style={sectionTitle}>Google Calendar</h2>

        <div style={{ ...fieldRow, alignItems: "flex-start" }}>
          <div style={{ flex: 1 }}>
            <div style={labelStyle}>Enable Calendar</div>
            <div style={subLabel}>Uses your calendar to schedule priorities in the morning brief</div>
          </div>
          <Toggle value={form.calendarEnabled} onChange={() => update("calendarEnabled", !form.calendarEnabled)} />
        </div>

        {form.calendarEnabled && (
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
        )}
      </div>

      {/* Voice Inbox */}
      <div style={sectionStyle}>
        <h2 style={{ ...sectionTitle, display: "flex", alignItems: "center", gap: 8 }}>
          Voice Inbox
          <span style={{
            fontSize: 10, fontWeight: 700, color: "#7c3aed",
            background: "#ede9fe", padding: "2px 7px", borderRadius: 4,
            letterSpacing: "0.03em",
          }}>BETA</span>
        </h2>

        <div style={{ ...fieldRow, marginBottom: 0, alignItems: "flex-start" }}>
          <div style={{ flex: 1 }}>
            <div style={labelStyle}>Dictate Tasks by Voice</div>
            <div style={subLabel}>Say a task via Siri and Clyde picks it up automatically</div>
          </div>
          <Toggle
            value={form.voiceInboxEnabled}
            onChange={() => update("voiceInboxEnabled", !form.voiceInboxEnabled)}
          />
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
          <h2 style={sectionTitle}>Slack: Filter by Channel</h2>
          <p style={{ fontSize: 12, color: OS.muted, marginBottom: 16, lineHeight: 1.5 }}>
            Turn off channels you don't want Clyde to scan. New channels default to on.
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
      {/* Inbox Sensitivity */}
      <div style={sectionStyle}>
        <h2 style={sectionTitle}>Inbox Sensitivity</h2>
        <p style={{ fontSize: 12, color: OS.muted, marginBottom: 16, lineHeight: 1.5 }}>
          Controls how confident Claude needs to be before showing something in your inbox. Lower = more items, higher = fewer but more accurate.
        </p>

        <div style={fieldRow}>
          <div>
            <div style={labelStyle}>Confidence Threshold</div>
            <div style={subLabel}>
              Currently showing items at {form.confidenceThreshold}% confidence or above
              {form.confidenceAutoTune && (
                <span style={{ color: OS.blue, marginLeft: 8, fontSize: 11, fontWeight: 600 }}>AUTO</span>
              )}
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
            disabled={form.confidenceAutoTune}
            style={{ width: 160, cursor: form.confidenceAutoTune ? "not-allowed" : "pointer", opacity: form.confidenceAutoTune ? 0.5 : 1 }}
          />
        </div>

        <div style={{ ...fieldRow, marginBottom: 0 }}>
          <div>
            <div style={labelStyle}>Auto-adjust Threshold</div>
            <div style={subLabel}>
              Clyde learns from what you dismiss and tunes the threshold daily
              {tuneInfo && (
                <span style={{ display: "block", marginTop: 2, color: OS.secondary, fontSize: 11 }}>
                  Last check: {tuneInfo.dismissRate}% dismissed ({tuneInfo.totalSamples} actions)
                </span>
              )}
            </div>
          </div>
          <Toggle
            value={form.confidenceAutoTune}
            onChange={() => update("confidenceAutoTune", !form.confidenceAutoTune)}
          />
        </div>
      </div>

      {/* Morning Brief */}
      <div style={sectionStyle}>
        <h2 style={sectionTitle}>Morning Brief</h2>

        <div style={{ ...fieldRow, marginBottom: 0 }}>
          <div>
            <div style={labelStyle}>Enable Morning Brief</div>
            <div style={subLabel}>Clyde generates a daily priority summary when you open the Brief tab</div>
          </div>
          <Toggle value={form.morningBriefEnabled} onChange={() => update("morningBriefEnabled", !form.morningBriefEnabled)} />
        </div>
      </div>

      {/* Smart Tags */}
      <div style={sectionStyle}>
        <h2 style={sectionTitle}>Smart Tags</h2>
        <p style={{ fontSize: 12, color: OS.muted, marginBottom: 16, lineHeight: 1.5 }}>
          Claude auto-assigns tags to every commitment. Add or rename tags here, then use "Re-tag all" to apply changes across your inbox.
          The "General" tag is the default catch-all and cannot be deleted.
        </p>

        {/* Tag list */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
          {allTagDefs.map((tag) => {
            const isGeneral = tag.name === "General";
            const isEditing = editingTagId === tag.id;
            return (
              <div key={tag.id} style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "8px 10px",
                background: OS.bg, border: `1px solid ${OS.border}`, borderRadius: 8,
              }}>
                {/* Color swatch */}
                <span style={{
                  width: 10, height: 10, borderRadius: "50%",
                  background: tag.color, flexShrink: 0,
                }} />

                {/* Label */}
                {isEditing ? (
                  <input
                    autoFocus
                    value={editingTagLabel}
                    onChange={(e) => setEditingTagLabel(e.target.value)}
                    onBlur={() => handleTagRename(tag.id!, editingTagLabel)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleTagRename(tag.id!, editingTagLabel);
                      if (e.key === "Escape") setEditingTagId(null);
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
                    onDoubleClick={() => { if (!isGeneral) { setEditingTagId(tag.id!); setEditingTagLabel(tag.name); } }}
                    title={isGeneral ? undefined : "Double-click to rename"}
                  >
                    {tag.name}
                    {isGeneral && <span style={{ fontSize: 10, color: OS.faint, marginLeft: 6 }}>(built-in)</span>}
                  </span>
                )}

                {/* Rename button */}
                {!isGeneral && !isEditing && (
                  <button
                    onClick={() => { setEditingTagId(tag.id!); setEditingTagLabel(tag.name); }}
                    style={{
                      padding: "2px 8px", fontSize: 11, fontFamily: OS.font,
                      border: `1px solid ${OS.border}`, borderRadius: 4,
                      background: OS.white, color: OS.secondary, cursor: "pointer",
                    }}
                  >
                    Rename
                  </button>
                )}

                {/* Delete — non-General only */}
                {!isGeneral && !isEditing && (
                  <button
                    onClick={() => handleTagDelete(tag.id!)}
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

        {/* Add tag */}
        <div style={{ display: "flex", gap: 6, marginBottom: 20 }}>
          <input
            value={newTagLabel}
            onChange={(e) => setNewTagLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleTagAdd(newTagLabel);
              if (e.key === "Escape") setNewTagLabel("");
            }}
            placeholder="New tag name..."
            style={{
              flex: 1, padding: "7px 10px",
              border: `1px solid ${OS.border}`, borderRadius: 6,
              fontSize: 13, fontFamily: OS.font, outline: "none",
            }}
          />
          <button
            onClick={() => handleTagAdd(newTagLabel)}
            disabled={!newTagLabel.trim()}
            style={{
              padding: "7px 16px", background: newTagLabel.trim() ? OS.blue : OS.faint,
              color: OS.white, border: "none", borderRadius: 6,
              fontSize: 13, fontFamily: OS.font, cursor: newTagLabel.trim() ? "pointer" : "default",
            }}
          >
            Add
          </button>
        </div>

        {/* Re-tag all */}
        <div style={{
          padding: "14px 16px",
          background: OS.bg,
          border: `1px solid ${OS.border}`,
          borderRadius: 8,
          marginBottom: 10,
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: OS.text, marginBottom: 4 }}>Re-tag all commitments</div>
          <div style={{ fontSize: 12, color: OS.secondary, marginBottom: 12, lineHeight: 1.5 }}>
            Uses Claude to re-assign tags across all your commitments based on the current tag list.
            Useful after adding or renaming tags.
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button
              onClick={handleRetagAll}
              disabled={retagging}
              style={{
                padding: "8px 18px", fontSize: 13, fontWeight: 600,
                background: retagging ? OS.faint : OS.blue,
                color: OS.white, border: "none", borderRadius: 6,
                fontFamily: OS.font, cursor: retagging ? "default" : "pointer",
              }}
            >
              {retagging ? "✦ Re-tagging…" : "✦ Re-tag all commitments"}
            </button>
            {retagResult && (
              <span style={{ fontSize: 12, color: retagResult.startsWith("Error") ? OS.red : OS.green }}>
                {retagResult}
              </span>
            )}
          </div>
        </div>

        {/* Re-check sensitivity */}
        <div style={{
          padding: "14px 16px",
          background: OS.bg,
          border: `1px solid ${OS.border}`,
          borderRadius: 8,
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: OS.text, marginBottom: 4 }}>Re-check sensitivity</div>
          <div style={{ fontSize: 12, color: OS.secondary, marginBottom: 12, lineHeight: 1.5 }}>
            Re-evaluates all existing commitments against the current privacy rules, including your role and title.
            Run this after updating your profile or if you want stricter privacy detection applied retroactively.
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button
              onClick={handleRecheckSensitivity}
              disabled={recheckingSensitivity}
              style={{
                padding: "8px 18px", fontSize: 13, fontWeight: 600,
                background: recheckingSensitivity ? OS.faint : "#7c3aed",
                color: OS.white, border: "none", borderRadius: 6,
                fontFamily: OS.font, cursor: recheckingSensitivity ? "default" : "pointer",
              }}
            >
              {recheckingSensitivity ? "✦ Checking…" : "✦ Re-check sensitivity"}
            </button>
            {recheckSensitivityResult && (
              <span style={{ fontSize: 12, color: recheckSensitivityResult.startsWith("Error") ? OS.red : OS.green }}>
                {recheckSensitivityResult}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Kanban Board */}
      <div style={sectionStyle}>
        <h2 style={sectionTitle}>Kanban Board Columns</h2>
        <p style={{ fontSize: 12, color: OS.muted, marginBottom: 16, lineHeight: 1.5 }}>
          Customize the columns in your board view. Drag &#x2807; to reorder, double-click to rename. "In Progress" is built-in and can be renamed but not deleted.
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
                    onClick={() => handleColDeleteRequest(col.id)}
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

        {/* Delete confirmation dialog */}
        {deleteColConfirm && (
          <div style={{
            marginBottom: 14,
            padding: "14px 16px",
            background: "#fff8f8",
            border: `1px solid #fca5a5`,
            borderRadius: 8,
          }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: OS.red, marginBottom: 6 }}>
              Delete "{deleteColConfirm.label}"?
            </div>
            <div style={{ fontSize: 12, color: OS.secondary, marginBottom: 12, lineHeight: 1.5 }}>
              {deleteColConfirm.itemCount > 0
                ? `${deleteColConfirm.itemCount} card${deleteColConfirm.itemCount === 1 ? "" : "s"} will be moved. Choose where:`
                : "This column is empty. It will be permanently removed."}
            </div>

            {deleteColConfirm.itemCount > 0 && (
              <div style={{ marginBottom: 12 }}>
                <select
                  value={deleteMoveTarget}
                  onChange={(e) => setDeleteMoveTarget(e.target.value)}
                  style={{
                    width: "100%", padding: "6px 10px", fontSize: 13,
                    border: `1px solid ${OS.border}`, borderRadius: 6,
                    fontFamily: OS.font, background: OS.white, color: OS.text,
                    cursor: "pointer",
                  }}
                >
                  <option value="todo">Todo (default)</option>
                  {allColDefs
                    .filter((c) => c.id !== deleteColConfirm.id)
                    .map((c) => (
                      <option key={c.id} value={c.id}>{c.label}</option>
                    ))}
                </select>
              </div>
            )}

            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={handleColDeleteConfirm}
                style={{
                  padding: "6px 14px", fontSize: 12, fontWeight: 600,
                  background: OS.red, color: OS.white,
                  border: "none", borderRadius: 6,
                  fontFamily: OS.font, cursor: "pointer",
                }}
              >
                Delete column
              </button>
              <button
                onClick={() => setDeleteColConfirm(null)}
                style={{
                  padding: "6px 14px", fontSize: 12,
                  background: OS.white, color: OS.secondary,
                  border: `1px solid ${OS.border}`, borderRadius: 6,
                  fontFamily: OS.font, cursor: "pointer",
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

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
        <h2 style={sectionTitle}>Developer Tools</h2>

        <div style={{ ...fieldRow, marginBottom: 0 }}>
          <div>
            <div style={labelStyle}>Developer Mode</div>
            <div style={subLabel}>
              Shows a "Dev Log" tab in the popup that logs everything Claude rejects — useful for tuning what gets detected.
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
            <div style={labelStyle}>Show Sample Data</div>
            <div style={subLabel}>
              Replaces your inbox with realistic-looking sample commitments for demos and presentations.
              Your real data is untouched and comes back when you turn this off.
            </div>
          </div>
          <Toggle value={form.demoMode} onChange={() => update("demoMode", !form.demoMode)} color="#b08d33" />
        </div>
      </div>

      {/* Usage & Data */}
      <div style={sectionStyle}>
        <h2 style={sectionTitle}>Data &amp; Backup</h2>

        <div style={fieldRow}>
          <div>
            <div style={labelStyle}>Estimated API Cost Today</div>
            <div style={subLabel}>Based on extraction calls made today — roughly $0.003 per call</div>
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
            <div style={labelStyle}>Export All Data</div>
            <div style={subLabel}>
              Download a JSON file of all your commitments, dismissals, and action log
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
            <div style={labelStyle}>Restore from Local Backup</div>
            <div style={subLabel}>
              Recover your data from the automatic backup saved on your Mac (requires Granola native host)
            </div>
          </div>
          <button
            onClick={async () => {
              setRestoring(true);
              try {
                // Step 1: Load backup via native host (through service worker)
                const pingRes = await chrome.runtime.sendMessage({ type: "GRANOLA_STATUS" });
                if (!pingRes?.connected) {
                  showToast("Native host not connected — install it first", "error");
                  setRestoring(false);
                  return;
                }

                // Step 2: Load backup directly via native messaging
                const loadRes = await new Promise<Record<string, unknown>>((resolve, reject) => {
                  chrome.runtime.sendNativeMessage(
                    "com.commitment_tracker.granola_reader",
                    { command: "load_state", extension_id: chrome.runtime.id },
                    (response) => {
                      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                      else resolve(response as Record<string, unknown>);
                    }
                  );
                });

                const state = loadRes.state as Record<string, unknown> | null;
                if (!state) {
                  // Try latest
                  const latestRes = await new Promise<Record<string, unknown>>((resolve, reject) => {
                    chrome.runtime.sendNativeMessage(
                      "com.commitment_tracker.granola_reader",
                      { command: "load_latest_state" },
                      (response) => {
                        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                        else resolve(response as Record<string, unknown>);
                      }
                    );
                  });
                  const latestState = latestRes.state as Record<string, unknown> | null;
                  if (!latestState) {
                    showToast("No backup found on disk", "error");
                    setRestoring(false);
                    return;
                  }
                  await doRestore(latestState);
                } else {
                  await doRestore(state);
                }

                showToast("Backup restored successfully!", "success");
              } catch (err) {
                console.error("[Clyde:Settings] Restore error:", err);
                showToast(`Restore failed: ${err instanceof Error ? err.message : String(err)}`, "error");
              } finally {
                setRestoring(false);
              }
            }}
            disabled={restoring}
            style={{
              padding: "8px 20px",
              fontSize: 13,
              fontWeight: 600,
              fontFamily: OS.font,
              border: `1px solid ${OS.border}`,
              borderRadius: 8,
              background: OS.white,
              color: OS.green,
              cursor: restoring ? "wait" : "pointer",
              opacity: restoring ? 0.6 : 1,
            }}
          >
            {restoring ? "Restoring..." : "Restore"}
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
