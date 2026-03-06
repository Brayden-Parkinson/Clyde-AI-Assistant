import { describe, it, expect } from "vitest";
import { computeHash } from "./dedup";

describe("computeHash", () => {
  it("produces a 64-character hex string", async () => {
    const hash = await computeHash("I'll send the report", "slack", "#engineering");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("same input produces same hash", async () => {
    const hash1 = await computeHash("I'll send the report", "slack", "#engineering");
    const hash2 = await computeHash("I'll send the report", "slack", "#engineering");
    expect(hash1).toBe(hash2);
  });

  it("different input produces different hash", async () => {
    const hash1 = await computeHash("I'll send the report", "slack", "#engineering");
    const hash2 = await computeHash("I'll review the PR", "slack", "#engineering");
    expect(hash1).not.toBe(hash2);
  });

  it("different source type changes hash", async () => {
    const hash1 = await computeHash("I'll send the report", "slack", "#engineering");
    const hash2 = await computeHash("I'll send the report", "meeting", "#engineering");
    expect(hash1).not.toBe(hash2);
  });

  it("different context changes hash", async () => {
    const hash1 = await computeHash("I'll send the report", "slack", "#engineering");
    const hash2 = await computeHash("I'll send the report", "slack", "#product");
    expect(hash1).not.toBe(hash2);
  });

  it("handles empty strings", async () => {
    const hash = await computeHash("", "", "");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("handles unicode input", async () => {
    const hash = await computeHash("I'll send the 📊 report", "slack", "#team-日本語");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("normalizes # prefix in context — '#engineering' matches 'engineering'", async () => {
    const hash1 = await computeHash("I'll send the report", "slack", "#engineering");
    const hash2 = await computeHash("I'll send the report", "slack", "engineering");
    expect(hash1).toBe(hash2);
  });

  it("normalizes extra whitespace in original_quote", async () => {
    const hash1 = await computeHash("I'll  send  the report", "slack", "engineering");
    const hash2 = await computeHash("I'll send the report", "slack", "engineering");
    expect(hash1).toBe(hash2);
  });

  it("normalizes trailing punctuation", async () => {
    const hash1 = await computeHash("I'll send the report.", "slack", "engineering");
    const hash2 = await computeHash("I'll send the report", "slack", "engineering");
    expect(hash1).toBe(hash2);
  });

  it("normalizes case differences", async () => {
    const hash1 = await computeHash("I'll Send The Report", "slack", "Engineering");
    const hash2 = await computeHash("i'll send the report", "slack", "engineering");
    expect(hash1).toBe(hash2);
  });
});
