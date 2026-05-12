import { describe, expect, it } from "vitest";
import { formatTranscriptForExtraction } from "./granola-poller";
import type { TranscriptSegment } from "@shared/types";

const seg = (
  text: string,
  source: "microphone" | "system",
): TranscriptSegment => ({ text, source, start: "2026-05-12T00:00:00Z" });

describe("formatTranscriptForExtraction", () => {
  it("keeps the user's own (microphone) segments as candidates", () => {
    const { candidates, context } = formatTranscriptForExtraction(
      [seg("I'll send you the doc tomorrow", "microphone")],
      "Brayden Parkinson",
      [],
      "Drones Sync",
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0].isMine).toBe(true);
    expect(context).toHaveLength(0);
  });

  it("treats 'Other' segments without the user's name as context, not candidates", () => {
    const { candidates, context } = formatTranscriptForExtraction(
      [
        seg("I'll handle the deploy this afternoon", "system"),
        seg("Bob will send the report tomorrow", "system"),
      ],
      "Brayden Parkinson",
      [],
      "Drones Sync",
    );
    expect(candidates).toHaveLength(0);
    expect(context).toHaveLength(2);
    expect(context.every((m) => !m.isMine && !m.mentionsMe)).toBe(true);
  });

  it("promotes an 'Other' segment to a candidate when it explicitly names the user", () => {
    const { candidates, context } = formatTranscriptForExtraction(
      [
        seg("Brayden, can you review the PRD by Friday?", "system"),
        seg("And Alice should handle the QA pass", "system"),
      ],
      "Brayden Parkinson",
      [],
      "PRD review",
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0].text).toContain("Brayden, can you review");
    expect(candidates[0].mentionsMe).toBe(true);
    expect(candidates[0].isMine).toBe(false);
    expect(context).toHaveLength(1);
    expect(context[0].text).toContain("Alice should handle");
  });

  it("matches the user's first name case-insensitively, whole-word only", () => {
    const { candidates } = formatTranscriptForExtraction(
      [
        seg("BRAYDEN can you grab this?", "system"),
        seg("Braydenites are a kind of mineral", "system"), // substring, not whole word
      ],
      "Brayden Parkinson",
      [],
      "Geology Sync",
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0].text).toMatch(/^BRAYDEN/);
  });

  it("uses creator's first name (handles full-name input)", () => {
    const { candidates } = formatTranscriptForExtraction(
      [seg("Mary, can you review this?", "system")],
      "Mary Sue Anderson",
      [],
      "Review sync",
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0].mentionsMe).toBe(true);
  });

  it("falls back to context-only when creator name is empty", () => {
    const { candidates, context } = formatTranscriptForExtraction(
      [
        seg("I'll send the doc", "microphone"),
        seg("Bob will handle it", "system"),
      ],
      "",
      [],
      "Unknown meeting",
    );
    // Microphone segment still counts as mine
    expect(candidates).toHaveLength(1);
    expect(candidates[0].isMine).toBe(true);
    // No name to match against — system segments stay context
    expect(context).toHaveLength(1);
    expect(context[0].mentionsMe).toBe(false);
  });

  it("does not flip a microphone segment to mentionsMe even if the user names themselves", () => {
    const { candidates } = formatTranscriptForExtraction(
      [seg("Brayden here, I'll grab that", "microphone")],
      "Brayden Parkinson",
      [],
      "Self-intro sync",
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0].isMine).toBe(true);
    expect(candidates[0].mentionsMe).toBe(false);
  });

  it("escapes regex special characters in the user's name", () => {
    // Pathological but legal: a name with regex metacharacters
    const { candidates } = formatTranscriptForExtraction(
      [seg("regular sentence with no name", "system")],
      "B.r.a.y Parkinson",
      [],
      "Edge case sync",
    );
    expect(candidates).toHaveLength(0);
  });
});
