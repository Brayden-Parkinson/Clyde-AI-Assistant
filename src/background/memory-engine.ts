/**
 * Long-term memory extraction engine.
 *
 * Analyzes commitment history to build durable knowledge about the user —
 * preferences, patterns, facts, relationships — that persists across sessions.
 *
 * Runs weekly or on manual trigger. Uses Claude to extract memories from
 * commitment data, deduplicates via Jaccard similarity, and manages decay.
 */

import { db } from "@shared/db";
import {
  CLAUDE_MODEL,
  API_TIMEOUT_MS,
  API_MAX_RETRIES,
  API_RETRY_DELAY_MS,
  MEMORY_TTL_MS,
  MEMORY_DECAY_DAYS,
} from "@shared/constants";
import type { MemoryCategory, MemoryEntry } from "@shared/types";
import { logStatus } from "@shared/status";

// ─── Dedup Helpers ───

function wordSetJaccard(a: string, b: string): number {
  const setA = new Set(a.toLowerCase().replace(/[^\w\s]/g, "").split(/\s+/));
  const setB = new Set(b.toLowerCase().replace(/[^\w\s]/g, "").split(/\s+/));
  const intersection = new Set([...setA].filter((x) => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

// ─── Claude API ───

interface MemoryAction {
  action: "new" | "reinforce" | "update";
  existing_id: number | null;
  content: string;
  category: MemoryCategory;
  importance: number;
  evidence_ids: number[];
  expires_at: string | null;
}

interface MemoryExtractionResponse {
  memories: MemoryAction[];
}

async function callClaudeForMemory(
  system: string,
  userMessage: string,
): Promise<MemoryExtractionResponse> {
  const result = await chrome.storage.local.get("anthropicApiKey");
  const apiKey = result.anthropicApiKey as string | undefined;
  if (!apiKey) throw new Error("No API key configured");

  let response: Response | undefined;
  for (let attempt = 0; attempt <= API_MAX_RETRIES; attempt++) {
    try {
      response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: CLAUDE_MODEL,
          max_tokens: 2048,
          system,
          messages: [{ role: "user", content: userMessage }],
        }),
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      });
      if (response.status === 429 && attempt < API_MAX_RETRIES) {
        await new Promise((r) =>
          setTimeout(r, API_RETRY_DELAY_MS * (attempt + 1)),
        );
        continue;
      }
      break;
    } catch (err) {
      if (
        err instanceof DOMException &&
        err.name === "TimeoutError" &&
        attempt < API_MAX_RETRIES
      ) {
        continue;
      }
      throw err;
    }
  }
  if (!response) throw new Error("API failed after retries");
  if (!response.ok) throw new Error(`API ${response.status}`);

  const data = await response.json();
  const text = data.content?.find(
    (b: { type: string }) => b.type === "text",
  )?.text;
  if (!text) throw new Error("No text in response");

  let cleaned = text.trim().replace(/^```json?\s*/, "").replace(/\s*```$/, "");
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first > 0 && last > first) cleaned = cleaned.slice(first, last + 1);

  const parsed = JSON.parse(cleaned) as MemoryExtractionResponse;
  if (!Array.isArray(parsed.memories)) {
    throw new Error("Invalid response — missing memories array");
  }
  return parsed;
}

// ─── Prompt Building ───

function formatExistingMemories(memories: MemoryEntry[]): string {
  if (memories.length === 0) return "(none yet)";
  return memories
    .map(
      (m) =>
        `[ID:${m.id}] [${m.category}] ${m.content} (importance: ${m.importance}, reinforced: ${m.reinforceCount}x)`,
    )
    .join("\n");
}

function groupCommitmentsByWeek(
  commitments: Array<{ id?: number; text: string; context: string; createdAt: string; status: string }>,
): string {
  const weeks = new Map<string, typeof commitments>();
  for (const c of commitments) {
    const date = new Date(c.createdAt);
    // Week key: ISO week start (Monday)
    const dayOfWeek = date.getDay();
    const monday = new Date(date);
    monday.setDate(date.getDate() - ((dayOfWeek + 6) % 7));
    const weekKey = monday.toISOString().split("T")[0];
    const existing = weeks.get(weekKey) ?? [];
    existing.push(c);
    weeks.set(weekKey, existing);
  }

  const sections: string[] = [];
  const sortedWeeks = [...weeks.entries()].sort(([a], [b]) => a.localeCompare(b));
  for (const [weekStart, items] of sortedWeeks) {
    const lines = items.map(
      (c) => `  - [ID:${c.id}] ${c.text} (${c.context}, ${c.status})`,
    );
    sections.push(`Week of ${weekStart}:\n${lines.join("\n")}`);
  }
  return sections.join("\n\n");
}

const SYSTEM_PROMPT = `You are analyzing a person's work activity to build a long-term knowledge base.
Your job is to extract DURABLE FACTS — things that will still be true weeks from now.`;

function buildUserMessage(
  existingMemories: MemoryEntry[],
  commitmentSummaries: string,
): string {
  return `EXISTING MEMORIES (avoid duplicates, reinforce if confirmed):
${formatExistingMemories(existingMemories)}

RECENT ACTIVITY (last 30 days):
${commitmentSummaries}

INSTRUCTIONS:
Extract new memories OR updates to existing ones. Categories:
- preference, fact, pattern, project, relationship, lesson, context

For each memory return JSON:
{
  "action": "new" | "reinforce" | "update",
  "existing_id": null | number,
  "content": "Concise factual statement, max 1 sentence",
  "category": "...",
  "importance": 1-5,
  "evidence_ids": [commitment IDs],
  "expires_at": null | "ISO date"
}

QUALITY RULES:
- Be SPECIFIC not generic
- One fact per memory
- Importance 5 = critical context. 1 = background trivia
- Max 10 new memories per extraction

Return ONLY valid JSON: { "memories": [...] }`;
}

// ─── Validation ───

const VALID_CATEGORIES: MemoryCategory[] = [
  "preference",
  "fact",
  "pattern",
  "project",
  "relationship",
  "lesson",
  "context",
];

function isValidMemoryAction(m: MemoryAction): boolean {
  return (
    typeof m.content === "string" &&
    m.content.length > 0 &&
    VALID_CATEGORIES.includes(m.category) &&
    typeof m.importance === "number" &&
    m.importance >= 1 &&
    m.importance <= 5 &&
    ["new", "reinforce", "update"].includes(m.action) &&
    Array.isArray(m.evidence_ids)
  );
}

// ─── Exported Functions ───

/**
 * Main extraction function — called weekly or manually.
 * Loads recent commitments, sends to Claude, deduplicates, and persists.
 */
export async function extractMemories(): Promise<void> {
  try {
    await logStatus("info", "worker", "Starting memory extraction...");

    // Load existing memories
    const existingMemories = await db.memories.toArray();

    // Load last 30 days of commitments
    const thirtyDaysAgo = new Date(
      Date.now() - 30 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const recentCommitments = await db.commitments
      .where("createdAt")
      .above(thirtyDaysAgo)
      .toArray();

    if (recentCommitments.length === 0) {
      await logStatus(
        "info",
        "worker",
        "No recent commitments — skipping memory extraction",
      );
      return;
    }

    const commitmentSummaries = groupCommitmentsByWeek(recentCommitments);
    const userMessage = buildUserMessage(existingMemories, commitmentSummaries);

    const result = await callClaudeForMemory(SYSTEM_PROMPT, userMessage);

    let newCount = 0;
    let reinforceCount = 0;
    let updateCount = 0;
    let skipCount = 0;
    const now = new Date().toISOString();

    for (const memory of result.memories) {
      if (!isValidMemoryAction(memory)) {
        skipCount++;
        continue;
      }

      // Clamp importance
      const importance = Math.max(1, Math.min(5, Math.round(memory.importance)));

      if (memory.action === "new") {
        // Dedup: check Jaccard similarity against existing memories
        const isDuplicate = existingMemories.some(
          (existing) => wordSetJaccard(existing.content, memory.content) > 0.6,
        );
        if (isDuplicate) {
          skipCount++;
          continue;
        }

        await db.memories.add({
          content: memory.content,
          category: memory.category,
          importance,
          source: "ai_extraction",
          evidenceIds: memory.evidence_ids,
          lastReinforced: now,
          reinforceCount: 0,
          confirmed: false,
          expiresAt: memory.expires_at ?? null,
          createdAt: now,
        });
        newCount++;
      } else if (memory.action === "reinforce" && memory.existing_id != null) {
        const existing = await db.memories.get(memory.existing_id);
        if (existing) {
          await db.memories.update(memory.existing_id, {
            lastReinforced: now,
            reinforceCount: (existing.reinforceCount || 0) + 1,
          });
          reinforceCount++;
        } else {
          skipCount++;
        }
      } else if (memory.action === "update" && memory.existing_id != null) {
        const existing = await db.memories.get(memory.existing_id);
        if (existing) {
          await db.memories.update(memory.existing_id, {
            content: memory.content,
            lastReinforced: now,
          });
          updateCount++;
        } else {
          skipCount++;
        }
      } else {
        skipCount++;
      }
    }

    const parts: string[] = [];
    if (newCount > 0) parts.push(`${newCount} new`);
    if (reinforceCount > 0) parts.push(`${reinforceCount} reinforced`);
    if (updateCount > 0) parts.push(`${updateCount} updated`);
    if (skipCount > 0) parts.push(`${skipCount} skipped`);

    await logStatus(
      newCount + reinforceCount + updateCount > 0 ? "success" : "info",
      "worker",
      `Memory extraction complete: ${parts.join(", ") || "no changes"}`,
    );
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await logStatus("error", "worker", `Memory extraction failed: ${errMsg}`);
  }
}

/**
 * Simple text search across memories.
 * Returns matches sorted by importance descending.
 */
export async function searchMemories(query: string): Promise<MemoryEntry[]> {
  const lowerQuery = query.toLowerCase();
  // Limit scan to top 500 by importance to avoid loading entire table
  const candidates = await db.memories.orderBy("importance").reverse().limit(500).toArray();
  return candidates
    .filter((m) => m.content.toLowerCase().includes(lowerQuery))
    .sort((a, b) => b.importance - a.importance);
}

/**
 * Save a user-created memory directly.
 */
export async function saveManualMemory(
  content: string,
  category: MemoryCategory,
  importance: number,
): Promise<void> {
  const now = new Date().toISOString();
  await db.memories.add({
    content,
    category,
    importance: Math.max(1, Math.min(5, Math.round(importance))),
    source: "user_manual",
    evidenceIds: [],
    lastReinforced: now,
    reinforceCount: 0,
    confirmed: true,
    expiresAt: null,
    createdAt: now,
  });
}

/**
 * Delete a memory by ID.
 */
export async function forgetMemory(id: number): Promise<void> {
  await db.memories.delete(id);
}

/**
 * Decay memories that haven't been reinforced recently.
 * - Reduce importance by 1 for memories not reinforced in MEMORY_DECAY_DAYS
 * - Delete memories with importance <= 0
 * - Delete expired context memories
 */
export async function decayMemories(): Promise<void> {
  const now = Date.now();
  const decayCutoff = new Date(
    now - MEMORY_DECAY_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const nowIso = new Date(now).toISOString();

  const allMemories = await db.memories.toArray();
  let decayedCount = 0;
  let deletedCount = 0;
  let expiredCount = 0;

  for (const memory of allMemories) {
    if (memory.id == null) continue;

    // Delete expired context memories
    if (memory.expiresAt && memory.expiresAt < nowIso) {
      await db.memories.delete(memory.id);
      expiredCount++;
      continue;
    }

    // Decay memories not reinforced recently
    if (memory.lastReinforced < decayCutoff) {
      const newImportance = memory.importance - 1;
      if (newImportance <= 0) {
        await db.memories.delete(memory.id);
        deletedCount++;
      } else {
        await db.memories.update(memory.id, { importance: newImportance });
        decayedCount++;
      }
    }
  }

  if (decayedCount + deletedCount + expiredCount > 0) {
    await logStatus(
      "info",
      "worker",
      `Memory decay: ${decayedCount} decayed, ${deletedCount} deleted (importance 0), ${expiredCount} expired`,
    );
  }
}

/**
 * Format top memories for injection into other Claude prompts.
 * Returns up to 20 memories sorted by importance, as formatted strings.
 */
export async function getMemoriesForPrompt(): Promise<string[]> {
  const allMemories = await db.memories
    .orderBy("importance")
    .reverse()
    .limit(20)
    .toArray();

  return allMemories.map(
    (m) => `[${m.category}] ${m.content} (importance: ${m.importance})`,
  );
}
