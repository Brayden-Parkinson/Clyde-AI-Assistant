import { describe, it, expect, beforeEach } from "vitest";
import { setStorageLocal, clearStorageLocal } from "../test-utils/chrome-mock";
import { getUserProfile } from "@shared/user-profile";

describe("getUserProfile", () => {
  beforeEach(() => {
    clearStorageLocal();
  });

  it("returns defaults when storage is empty", async () => {
    const profile = await getUserProfile();
    expect(profile.userName).toBe("");
    expect(profile.userTitle).toBe("");
    expect(profile.userCompany).toBe("");
    expect(profile.timezone).toBeTruthy(); // auto-detected
  });

  it("returns stored values", async () => {
    setStorageLocal({
      userName: "Jane Doe",
      userTitle: "VP Engineering",
      userCompany: "Acme Corp",
      timezone: "America/New_York",
    });
    const profile = await getUserProfile();
    expect(profile.userName).toBe("Jane Doe");
    expect(profile.userTitle).toBe("VP Engineering");
    expect(profile.userCompany).toBe("Acme Corp");
    expect(profile.timezone).toBe("America/New_York");
  });

  it("falls back to defaults for missing fields", async () => {
    setStorageLocal({ userName: "Jane Doe" });
    const profile = await getUserProfile();
    expect(profile.userName).toBe("Jane Doe");
    expect(profile.userTitle).toBe("");
    expect(profile.userCompany).toBe("");
  });
});

describe("parseClaudeJson (via import)", () => {
  // Test the JSON parsing logic inline since it's not exported
  // We test the pattern that parseClaudeJson implements
  function parseClaudeJson(raw: string): unknown {
    let cleaned = raw.trim().replace(/^```json?\s*/, "").replace(/\s*```$/, "");
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace > 0 && lastBrace > firstBrace) {
      cleaned = cleaned.slice(firstBrace, lastBrace + 1);
    }
    return JSON.parse(cleaned);
  }

  it("parses clean JSON", () => {
    const result = parseClaudeJson('{"commitments":[]}');
    expect(result).toEqual({ commitments: [] });
  });

  it("strips markdown fences", () => {
    const result = parseClaudeJson('```json\n{"commitments":[]}\n```');
    expect(result).toEqual({ commitments: [] });
  });

  it("strips preamble text before JSON", () => {
    const result = parseClaudeJson('Here is the result:\n{"commitments":[]}');
    expect(result).toEqual({ commitments: [] });
  });

  it("handles nested JSON", () => {
    const input = '{"commitments":[{"text":"Send report","confidence":0.9}]}';
    const result = parseClaudeJson(input) as { commitments: Array<{ text: string; confidence: number }> };
    expect(result.commitments).toHaveLength(1);
    expect(result.commitments[0].text).toBe("Send report");
    expect(result.commitments[0].confidence).toBe(0.9);
  });
});
