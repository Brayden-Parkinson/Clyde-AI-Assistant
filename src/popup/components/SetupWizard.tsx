import React, { useState, useEffect } from "react";
import { OS } from "@shared/tokens";
import { IconLogo, IconCheck, IconX } from "./Icons";
import { USER_PROFILE_DEFAULTS } from "@shared/user-profile";

interface SetupWizardProps {
  onComplete: () => void;
  onDismiss?: () => void;
  demoMode?: boolean;
}

type Step = "welcome" | "profile" | "apiKey" | "slack" | "done";

const STEPS: Step[] = ["welcome", "profile", "apiKey", "slack", "done"];

export function SetupWizard({ onComplete, onDismiss, demoMode }: SetupWizardProps) {
  const [step, setStep] = useState<Step>("welcome");
  const [userName, setUserName] = useState("");
  const [userTitle, setUserTitle] = useState("");
  const [userCompany, setUserCompany] = useState("");
  const [timezone, setTimezone] = useState(USER_PROFILE_DEFAULTS.timezone);
  const [apiKey, setApiKey] = useState("");
  const [slackNames, setSlackNames] = useState("");
  const [backupFound, setBackupFound] = useState(false);
  const [restoringBackup, setRestoringBackup] = useState(false);
  const [backupRestored, setBackupRestored] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Restore wizard state from storage on mount
  useEffect(() => {
    if (demoMode) { setLoaded(true); return; }
    chrome.storage.local.get([
      "setupWizardStep",
      "userName", "userTitle", "userCompany", "timezone",
      "anthropicApiKey", "slackDisplayNames",
    ]).then((result) => {
      if (result.setupWizardStep && STEPS.includes(result.setupWizardStep)) {
        setStep(result.setupWizardStep as Step);
      }
      if (result.userName) setUserName(result.userName);
      if (result.userTitle) setUserTitle(result.userTitle);
      if (result.userCompany) setUserCompany(result.userCompany);
      if (result.timezone) setTimezone(result.timezone);
      if (result.anthropicApiKey) setApiKey(result.anthropicApiKey);
      if (result.slackDisplayNames) setSlackNames(result.slackDisplayNames);
      setLoaded(true);
    }).catch(() => { setLoaded(true); });
  }, [demoMode]);

  // Persist current step whenever it changes
  useEffect(() => {
    if (!loaded || demoMode) return;
    chrome.storage.local.set({ setupWizardStep: step });
  }, [step, loaded, demoMode]);

  // Auto-check for existing backups on mount
  useEffect(() => {
    if (demoMode) return;
    chrome.runtime.sendMessage({ type: "RESTORE_BACKUP" }).then((res) => {
      if (res?.ok) {
        setBackupFound(true);
        setBackupRestored(true);
      }
    }).catch(() => {
      // Native host not installed — no backup available
    });
  }, [demoMode]);

  const stepIndex = STEPS.indexOf(step);
  const totalSteps = STEPS.length;

  const next = () => {
    const i = STEPS.indexOf(step);
    if (i < STEPS.length - 1) setStep(STEPS[i + 1]);
  };

  const back = () => {
    const i = STEPS.indexOf(step);
    if (i > 0) setStep(STEPS[i - 1]);
  };

  const saveProfile = () => {
    if (!demoMode) {
      chrome.storage.local.set({
        userName: userName.trim(),
        userTitle: userTitle.trim(),
        userCompany: userCompany.trim(),
        timezone: timezone.trim() || USER_PROFILE_DEFAULTS.timezone,
      });
    }
    next();
  };

  const saveApiKey = () => {
    if (!demoMode && apiKey.trim()) {
      chrome.storage.local.set({ anthropicApiKey: apiKey.trim() });
    }
    next();
  };

  const saveSlack = () => {
    if (!demoMode && slackNames.trim()) {
      chrome.storage.local.set({ slackDisplayNames: slackNames.trim() });
    }
    next();
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "10px 14px",
    borderRadius: 8,
    border: `1px solid ${OS.border}`,
    fontSize: 14,
    fontFamily: OS.font,
    color: OS.text,
    outline: "none",
    marginBottom: 12,
    boxSizing: "border-box",
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 12,
    fontWeight: 600,
    color: OS.text,
    marginBottom: 6,
    display: "block",
  };

  const subLabelStyle: React.CSSProperties = {
    fontSize: 11,
    color: OS.muted,
    marginBottom: 12,
    lineHeight: 1.5,
  };

  // Don't render until we've loaded persisted state
  if (!loaded) return null;

  return (
    <div style={{
      position: "fixed",
      inset: 0,
      zIndex: 9999,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "rgba(0,0,0,0.35)",
      backdropFilter: "blur(8px)",
      WebkitBackdropFilter: "blur(8px)",
      fontFamily: OS.font,
      color: OS.text,
      padding: 24,
    }}
      onClick={(e) => { if (e.target === e.currentTarget && onDismiss) onDismiss(); }}
    >
      <div style={{
        background: OS.white,
        border: `1px solid ${OS.border}`,
        borderRadius: 16,
        padding: "36px 32px",
        maxWidth: 440,
        width: "100%",
        boxShadow: "0 8px 40px rgba(0,0,0,0.18)",
        position: "relative",
      }}>
        {/* Dismiss button */}
        {onDismiss && (
          <button
            onClick={onDismiss}
            style={{
              position: "absolute",
              top: 12,
              right: 12,
              background: "none",
              border: "none",
              cursor: "pointer",
              color: OS.muted,
              padding: 4,
              display: "inline-flex",
              alignItems: "center",
            }}
            title="Dismiss"
          >
            <IconX size={16} />
          </button>
        )}

        {/* Demo mode badge */}
        {demoMode && (
          <div style={{
            position: "absolute",
            top: 12,
            left: 12,
            background: "#d97706",
            color: "#fff",
            fontSize: 10,
            fontWeight: 700,
            padding: "3px 8px",
            borderRadius: 6,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
          }}>
            Demo Mode
          </div>
        )}

        {/* Progress dots */}
        <div style={{
          display: "flex",
          justifyContent: "center",
          gap: 8,
          marginBottom: 28,
        }}>
          {STEPS.map((s, i) => (
            <div
              key={s}
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                background: i <= stepIndex ? OS.blue : OS.faint,
                transition: "background 0.2s",
              }}
            />
          ))}
        </div>

        {/* ─── Step: Welcome ─── */}
        {step === "welcome" && (
          <>
            <div style={{ textAlign: "center", marginBottom: 24 }}>
              <div style={{
                width: 48,
                height: 48,
                borderRadius: 14,
                background: `linear-gradient(135deg, ${OS.blue}, ${OS.darkBlue})`,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                color: OS.white,
                marginBottom: 16,
                boxShadow: "0 2px 12px rgba(43,103,219,0.3)",
              }}>
                <IconLogo size={24} />
              </div>
              <h1 style={{
                fontSize: 22,
                fontWeight: 800,
                color: OS.darkBlue,
                marginBottom: 8,
                letterSpacing: "-0.02em",
              }}>
                Welcome to Clyde
              </h1>
              <p style={{
                fontSize: 14,
                color: OS.secondary,
                lineHeight: 1.6,
                maxWidth: 340,
                margin: "0 auto",
              }}>
                Clyde watches your Slack conversations and meeting notes, then surfaces commitments you've made so nothing falls through the cracks.
              </p>
            </div>
            {backupRestored && (
              <div style={{
                padding: "10px 14px",
                marginBottom: 16,
                borderRadius: 8,
                background: `${OS.green}10`,
                border: `1px solid ${OS.green}40`,
                fontSize: 13,
                color: OS.green,
                fontWeight: 600,
                textAlign: "center",
              }}>
                Backup found and restored automatically
              </div>
            )}
            <button onClick={next} style={primaryBtnStyle}>
              Get Started
            </button>
          </>
        )}

        {/* ─── Step: Profile ─── */}
        {step === "profile" && (
          <>
            <h2 style={headingStyle}>Your Profile</h2>
            <p style={subLabelStyle}>
              Clyde uses your name to identify your commitments in conversations.
            </p>

            <label style={labelStyle}>Full Name *</label>
            <input
              type="text"
              style={inputStyle}
              value={userName}
              placeholder="Your Name"
              onChange={(e) => setUserName(e.target.value)}
              autoFocus
            />

            <label style={labelStyle}>Title / Role</label>
            <input
              type="text"
              style={inputStyle}
              value={userTitle}
              placeholder="e.g. Director of Engineering"
              onChange={(e) => setUserTitle(e.target.value)}
            />

            <label style={labelStyle}>Company</label>
            <input
              type="text"
              style={inputStyle}
              value={userCompany}
              placeholder="e.g. Acme Corp"
              onChange={(e) => setUserCompany(e.target.value)}
            />

            <label style={labelStyle}>Timezone</label>
            <input
              type="text"
              style={inputStyle}
              value={timezone}
              placeholder="America/Denver"
              onChange={(e) => setTimezone(e.target.value)}
            />

            <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
              <button onClick={back} style={secondaryBtnStyle}>Back</button>
              <button
                onClick={saveProfile}
                disabled={!demoMode && !userName.trim()}
                style={{
                  ...primaryBtnStyle,
                  flex: 1,
                  opacity: (demoMode || userName.trim()) ? 1 : 0.5,
                  cursor: (demoMode || userName.trim()) ? "pointer" : "default",
                }}
              >
                Continue
              </button>
            </div>
          </>
        )}

        {/* ─── Step: API Key ─── */}
        {step === "apiKey" && (
          <>
            <h2 style={headingStyle}>API Key</h2>
            <p style={subLabelStyle}>
              Clyde uses the Claude API to analyze messages. Your key is stored locally and never shared.
            </p>

            <label style={labelStyle}>Anthropic API Key</label>
            <input
              type="password"
              style={{ ...inputStyle, fontFamily: OS.mono }}
              value={apiKey}
              placeholder="sk-ant-..."
              onChange={(e) => setApiKey(e.target.value)}
              autoFocus
            />

            <p style={{ fontSize: 11, color: OS.muted, marginBottom: 16 }}>
              Get your key at{" "}
              <span
                onClick={() => chrome.tabs?.create({ url: "https://console.anthropic.com/settings/keys" })}
                style={{ color: OS.blue, cursor: "pointer", textDecoration: "underline" }}
              >
                console.anthropic.com
              </span>
            </p>

            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={back} style={secondaryBtnStyle}>Back</button>
              <button
                onClick={saveApiKey}
                disabled={!demoMode && !apiKey.trim()}
                style={{
                  ...primaryBtnStyle,
                  flex: 1,
                  opacity: (demoMode || apiKey.trim()) ? 1 : 0.5,
                  cursor: (demoMode || apiKey.trim()) ? "pointer" : "default",
                }}
              >
                Continue
              </button>
            </div>
          </>
        )}

        {/* ─── Step: Slack ─── */}
        {step === "slack" && (
          <>
            <h2 style={headingStyle}>Your Name in Slack</h2>
            <p style={subLabelStyle}>
              Clyde uses this to tell which messages are yours when scanning Slack.
              If you go by different names in different workspaces, separate them with commas.
              You can skip this and set it later in Settings.
            </p>

            <label style={labelStyle}>Slack Display Name(s)</label>
            <input
              type="text"
              style={inputStyle}
              value={slackNames}
              placeholder={userName || "Your Name, First Name"}
              onChange={(e) => setSlackNames(e.target.value)}
              autoFocus
            />

            <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
              <button onClick={back} style={secondaryBtnStyle}>Back</button>
              <button onClick={saveSlack} style={{ ...primaryBtnStyle, flex: 1 }}>
                {slackNames.trim() ? "Continue" : "Skip for now"}
              </button>
            </div>
          </>
        )}

        {/* ─── Step: Done ─── */}
        {step === "done" && (
          <>
            <div style={{ textAlign: "center", marginBottom: 24 }}>
              <div style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                color: OS.green,
                marginBottom: 12,
              }}>
                <IconCheck size={36} />
              </div>
              <h2 style={{
                ...headingStyle,
                textAlign: "center",
              }}>
                You're all set
              </h2>
              <p style={{
                fontSize: 14,
                color: OS.secondary,
                lineHeight: 1.6,
                marginBottom: 8,
              }}>
                Clyde is ready. Here's how to get the most out of it:
              </p>
              <div style={{
                background: OS.bg,
                borderRadius: 8,
                padding: "14px 16px",
                fontSize: 13,
                color: OS.secondary,
                lineHeight: 1.6,
                textAlign: "left",
                marginBottom: 8,
              }}>
                <div style={{ fontWeight: 600, color: OS.text, marginBottom: 8 }}>Getting started:</div>
                <div style={{ marginBottom: 6 }}>
                  <strong style={{ color: OS.text }}>Slack</strong> — open{" "}
                  <span style={{ fontFamily: OS.mono, fontSize: 12, background: OS.white, padding: "1px 5px", borderRadius: 4, border: `1px solid ${OS.border}` }}>slack.com</span>
                  {" "}in Chrome. Clyde watches the conversations you open automatically.
                </div>
                <div style={{ marginBottom: 6 }}>
                  <strong style={{ color: OS.text }}>Say "Clyde"</strong> in any Slack message to explicitly flag something as a commitment.
                </div>
                <div style={{ marginBottom: 6 }}>
                  <strong style={{ color: OS.text }}>Granola</strong> — extracts commitments from your meeting transcripts. One-time setup in Settings → Integrations.
                </div>
                <div style={{
                  marginTop: 10, paddingTop: 10,
                  borderTop: `1px solid ${OS.border}`,
                  fontSize: 12, color: OS.muted,
                }}>
                  <strong>Optional integrations</strong> (enable in Settings → Integrations):{" "}
                  Google Docs <span style={{ fontSize: 10, color: "#7c3aed", fontWeight: 700 }}>BETA</span>,{" "}
                  Voice Inbox <span style={{ fontSize: 10, color: "#7c3aed", fontWeight: 700 }}>BETA</span>
                </div>
              </div>
            </div>
            <button onClick={() => {
              chrome.storage.local.remove("setupWizardStep");
              onComplete();
            }} style={primaryBtnStyle}>
              Open Clyde
            </button>

            {/* Demo mode option — only shown during real first-time setup */}
            {!demoMode && (
              <button
                onClick={() => {
                  chrome.storage.local.set({ demoMode: true });
                  chrome.storage.local.remove("setupWizardStep");
                  onComplete();
                }}
                style={{
                  ...secondaryBtnStyle,
                  width: "100%",
                  marginTop: 10,
                  textAlign: "center",
                }}
              >
                Try demo mode with example data
              </button>
            )}
          </>
        )}

        {/* Step counter */}
        <div style={{
          textAlign: "center",
          marginTop: 16,
          fontSize: 11,
          color: OS.faint,
        }}>
          Step {stepIndex + 1} of {totalSteps}
        </div>
      </div>
    </div>
  );
}

// ─── Shared Styles ───

const headingStyle: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 700,
  color: OS.text,
  marginBottom: 4,
};

const primaryBtnStyle: React.CSSProperties = {
  width: "100%",
  padding: "11px 0",
  borderRadius: 8,
  background: `linear-gradient(135deg, ${OS.blue}, ${OS.darkBlue})`,
  border: "none",
  color: OS.white,
  fontSize: 14,
  fontWeight: 700,
  fontFamily: OS.font,
  cursor: "pointer",
  boxShadow: "0 2px 8px rgba(43,103,219,0.25)",
  transition: "all 0.15s ease",
};

const secondaryBtnStyle: React.CSSProperties = {
  padding: "11px 20px",
  borderRadius: 8,
  background: OS.bg,
  border: `1px solid ${OS.border}`,
  color: OS.secondary,
  fontSize: 14,
  fontWeight: 600,
  fontFamily: OS.font,
  cursor: "pointer",
};
