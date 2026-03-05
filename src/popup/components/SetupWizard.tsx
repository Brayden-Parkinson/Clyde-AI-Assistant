import React, { useState } from "react";
import { OS } from "@shared/tokens";
import { USER_PROFILE_DEFAULTS } from "@shared/user-profile";

interface SetupWizardProps {
  onComplete: () => void;
}

type Step = "welcome" | "profile" | "apiKey" | "slack" | "done";

const STEPS: Step[] = ["welcome", "profile", "apiKey", "slack", "done"];

export function SetupWizard({ onComplete }: SetupWizardProps) {
  const [step, setStep] = useState<Step>("welcome");
  const [userName, setUserName] = useState("");
  const [userTitle, setUserTitle] = useState("");
  const [userCompany, setUserCompany] = useState("");
  const [timezone, setTimezone] = useState(USER_PROFILE_DEFAULTS.timezone);
  const [apiKey, setApiKey] = useState("");
  const [slackNames, setSlackNames] = useState("");

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
    chrome.storage.local.set({
      userName: userName.trim(),
      userTitle: userTitle.trim(),
      userCompany: userCompany.trim(),
      timezone: timezone.trim() || USER_PROFILE_DEFAULTS.timezone,
    });
    next();
  };

  const saveApiKey = () => {
    if (apiKey.trim()) {
      chrome.storage.local.set({ anthropicApiKey: apiKey.trim() });
    }
    next();
  };

  const saveSlack = () => {
    if (slackNames.trim()) {
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

  return (
    <div style={{
      height: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: OS.bg,
      fontFamily: OS.font,
      color: OS.text,
      padding: 24,
    }}>
      <div style={{
        background: OS.white,
        border: `1px solid ${OS.border}`,
        borderRadius: 16,
        padding: "36px 32px",
        maxWidth: 440,
        width: "100%",
        boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
      }}>
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
                fontSize: 24,
                fontWeight: 900,
                marginBottom: 16,
                boxShadow: "0 2px 12px rgba(43,103,219,0.3)",
              }}>
                {"\u25C9"}
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
                disabled={!userName.trim()}
                style={{
                  ...primaryBtnStyle,
                  flex: 1,
                  opacity: userName.trim() ? 1 : 0.5,
                  cursor: userName.trim() ? "pointer" : "default",
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
                disabled={!apiKey.trim()}
                style={{
                  ...primaryBtnStyle,
                  flex: 1,
                  opacity: apiKey.trim() ? 1 : 0.5,
                  cursor: apiKey.trim() ? "pointer" : "default",
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
            <h2 style={headingStyle}>Slack Identity</h2>
            <p style={subLabelStyle}>
              Enter the display name(s) you use in Slack so Clyde can tell which messages are yours.
              If you go by different names in different workspaces, separate them with commas.
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
                {slackNames.trim() ? "Continue" : "Skip"}
              </button>
            </div>
          </>
        )}

        {/* ─── Step: Done ─── */}
        {step === "done" && (
          <>
            <div style={{ textAlign: "center", marginBottom: 24 }}>
              <div style={{
                fontSize: 36,
                marginBottom: 12,
              }}>
                {"\u2713"}
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
                Clyde is ready to track your commitments.
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
                <div style={{ fontWeight: 600, color: OS.text, marginBottom: 6 }}>Next steps:</div>
                <div style={{ marginBottom: 4 }}>1. Open Slack in any tab — Clyde will start scanning automatically</div>
                <div style={{ marginBottom: 4 }}>2. Say "Clyde" in any message to explicitly flag a commitment</div>
                <div>3. Come back here to triage what Clyde finds</div>
              </div>
            </div>
            <button onClick={onComplete} style={primaryBtnStyle}>
              Open Clyde
            </button>
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
