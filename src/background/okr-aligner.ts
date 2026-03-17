import { db } from "@shared/db";
import type { OKR, KeyResult, CommitmentOKRLink, OKRAlignment, Commitment } from "@shared/types";
import { logStatus } from "@shared/status";
import {
  CLAUDE_MODEL_FAST,
  API_TIMEOUT_MS,
  API_MAX_RETRIES,
  API_RETRY_DELAY_MS,
} from "@shared/constants";

// ─── Claude API helper ───

async function callClaudeForOKR(prompt: string): Promise<unknown> {
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
          model: CLAUDE_MODEL_FAST,
          max_tokens: 1024,
          messages: [{ role: "user", content: prompt }],
        }),
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      });
      if (response.status === 429 && attempt < API_MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, API_RETRY_DELAY_MS * (attempt + 1)));
        continue;
      }
      break;
    } catch (err) {
      if (err instanceof DOMException && err.name === "TimeoutError" && attempt < API_MAX_RETRIES)
        continue;
      throw err;
    }
  }
  if (!response) throw new Error("API failed after retries");
  if (!response.ok) throw new Error(`API ${response.status}`);

  const data = await response.json();
  const text = data.content?.find((b: { type: string }) => b.type === "text")?.text;
  if (!text) throw new Error("No text in response");

  let cleaned = text.trim().replace(/^```json?\s*/, "").replace(/\s*```$/, "");
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first > 0 && last > first) cleaned = cleaned.slice(first, last + 1);
  return JSON.parse(cleaned);
}

// ─── Alignment ───

interface AlignmentResult {
  commitment_id: number;
  okr_id: number | null;
  alignment: OKRAlignment;
}

interface AlignmentResponse {
  alignments: AlignmentResult[];
}

function isValidAlignment(a: unknown): a is AlignmentResult {
  if (!a || typeof a !== "object") return false;
  const obj = a as Record<string, unknown>;
  if (typeof obj.commitment_id !== "number") return false;
  if (obj.okr_id !== null && typeof obj.okr_id !== "number") return false;
  const validTypes: OKRAlignment[] = ["directly_supports", "indirectly_supports", "blocks", "unrelated"];
  if (!validTypes.includes(obj.alignment as OKRAlignment)) return false;
  return true;
}

/**
 * Batch-align commitments to active OKRs using Claude.
 * If commitmentIds provided, aligns those specific commitments.
 * Otherwise, aligns all commitments not yet linked to any OKR.
 */
export async function alignCommitmentsToOKRs(commitmentIds?: number[]): Promise<void> {
  const activeOKRs = await db.okrs.where("active").equals(1).sortBy("rank");
  if (activeOKRs.length === 0) {
    await logStatus("info", "worker", "OKR alignment skipped — no active OKRs");
    return;
  }

  let commitments: Commitment[];
  if (commitmentIds && commitmentIds.length > 0) {
    commitments = (await db.commitments.bulkGet(commitmentIds)).filter(
      (c): c is Commitment => c !== undefined,
    );
  } else {
    // Find all commitments without an existing link
    const allLinks = await db.commitment_okr_links.toArray();
    const linkedIds = new Set(allLinks.map((l) => l.commitmentId));
    commitments = (await db.commitments.toArray()).filter(
      (c) => c.id !== undefined && !linkedIds.has(c.id),
    );
  }

  if (commitments.length === 0) {
    await logStatus("info", "worker", "OKR alignment skipped — no unlinked commitments");
    return;
  }

  // Build the prompt
  const okrList = activeOKRs
    .map((o) => {
      const krs = o.keyResults.map((kr, i) => `  KR${i + 1}: ${kr.text} (${kr.progress}%)`).join("\n");
      return `OKR #${o.id} (rank ${o.rank}): ${o.objective}\n${krs}`;
    })
    .join("\n\n");

  const commitmentList = commitments
    .map((c) => `ID ${c.id}: "${c.text}" [${c.context}]`)
    .join("\n");

  const prompt = `Given these objectives and their key results:
${okrList}

And these commitments:
${commitmentList}

For each commitment, determine alignment:
{
  "commitment_id": number,
  "okr_id": number | null,
  "alignment": "directly_supports" | "indirectly_supports" | "blocks" | "unrelated"
}

Rules:
- "directly_supports": Clear, explicit connection
- "indirectly_supports": Tangential but helpful
- "blocks": Prevents progress on the OKR
- "unrelated": No meaningful connection
- Be conservative — default to "unrelated" if unsure
- A commitment can only align to ONE OKR (pick strongest)

Return ONLY valid JSON: { "alignments": [...] }`;

  try {
    const raw = (await callClaudeForOKR(prompt)) as AlignmentResponse;
    if (!raw.alignments || !Array.isArray(raw.alignments)) {
      throw new Error("Invalid alignment response shape");
    }

    // Validate each result and store
    const validResults = raw.alignments.filter(isValidAlignment);
    const okrCountDelta = new Map<number, number>();

    for (const result of validResults) {
      if (result.alignment === "unrelated" || result.okr_id === null) continue;

      const link: CommitmentOKRLink = {
        commitmentId: result.commitment_id,
        okrId: result.okr_id,
        alignment: result.alignment,
        source: "ai",
        createdAt: new Date().toISOString(),
      };

      // Upsert: remove old link for this commitment if exists, then add new
      await db.commitment_okr_links
        .where("commitmentId")
        .equals(result.commitment_id)
        .delete();
      await db.commitment_okr_links.add(link);

      okrCountDelta.set(
        result.okr_id,
        (okrCountDelta.get(result.okr_id) ?? 0) + 1,
      );
    }

    // Update alignedCount on each affected OKR
    for (const [okrId] of okrCountDelta) {
      const count = await db.commitment_okr_links
        .where("okrId")
        .equals(okrId)
        .count();
      await db.okrs.update(okrId, { alignedCount: count });
    }

    await logStatus(
      "success",
      "worker",
      `OKR alignment complete: ${validResults.length} commitments processed, ${okrCountDelta.size} OKRs updated`,
    );
  } catch (err) {
    await logStatus(
      "error",
      "worker",
      `OKR alignment failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ─── Create OKR ───

/**
 * Manually create an OKR and trigger alignment for existing unlinked commitments.
 */
export async function createOKR(
  objective: string,
  keyResults: KeyResult[],
  period: string,
  rank: number,
): Promise<number> {
  const id = await db.okrs.add({
    objective,
    keyResults,
    period,
    rank,
    alignedCount: 0,
    source: "user",
    active: true,
    createdAt: new Date().toISOString(),
  });

  await logStatus("info", "worker", `Created OKR #${id}: "${objective}"`);

  // Trigger alignment for all unlinked commitments in the background
  alignCommitmentsToOKRs().catch((err) => {
    logStatus(
      "error",
      "worker",
      `Post-create alignment failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  });

  return id as number;
}

// ─── Suggest OKRs ───

interface SuggestedOKR {
  objective: string;
  key_results: string[];
  evidence_commitment_ids: number[];
}

interface SuggestionResponse {
  okrs: SuggestedOKR[];
}

/**
 * Use Claude to suggest 2-3 OKRs based on the last 30 days of commitments.
 * Returns suggestions without inserting — user must confirm.
 */
export async function suggestOKRs(): Promise<
  Array<{ objective: string; keyResults: KeyResult[]; evidenceIds: number[] }>
> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const recent = await db.commitments
    .where("createdAt")
    .above(thirtyDaysAgo)
    .toArray();

  if (recent.length === 0) {
    await logStatus("info", "worker", "OKR suggestion skipped — no recent commitments");
    return [];
  }

  // Group by context for better theme detection
  const byContext = new Map<string, Commitment[]>();
  for (const c of recent) {
    const key = c.context || "General";
    if (!byContext.has(key)) byContext.set(key, []);
    byContext.get(key)!.push(c);
  }

  const groupedList = Array.from(byContext.entries())
    .map(([ctx, items]) => {
      const texts = items.map((c) => `  ID ${c.id}: "${c.text}"`).join("\n");
      return `Context: ${ctx}\n${texts}`;
    })
    .join("\n\n");

  const prompt = `Based on these recent work commitments (last 30 days), suggest 2-3 likely OKRs:
${groupedList}

For each OKR:
{
  "objective": "Clear, measurable objective",
  "key_results": ["KR 1", "KR 2", "KR 3"],
  "evidence_commitment_ids": [IDs that suggest this OKR]
}

Return ONLY valid JSON: { "okrs": [...] }`;

  try {
    const raw = (await callClaudeForOKR(prompt)) as SuggestionResponse;
    if (!raw.okrs || !Array.isArray(raw.okrs)) {
      throw new Error("Invalid suggestion response shape");
    }

    const suggestions = raw.okrs
      .filter(
        (s) =>
          typeof s.objective === "string" &&
          Array.isArray(s.key_results) &&
          Array.isArray(s.evidence_commitment_ids),
      )
      .map((s) => ({
        objective: s.objective,
        keyResults: s.key_results.map((text) => ({ text, progress: 0 })),
        evidenceIds: s.evidence_commitment_ids,
      }));

    await logStatus("success", "worker", `OKR suggestion returned ${suggestions.length} OKRs`);
    return suggestions;
  } catch (err) {
    await logStatus(
      "error",
      "worker",
      `OKR suggestion failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }
}

// ─── Alignment Summary ───

export interface AlignmentSummary {
  aligned: number;
  unaligned: number;
  byOkr: Map<number, number>;
}

/**
 * Returns summary counts of aligned vs unaligned commitments.
 */
export async function getAlignmentSummary(): Promise<AlignmentSummary> {
  const allLinks = await db.commitment_okr_links.toArray();
  const linkedCommitmentIds = new Set(allLinks.map((l) => l.commitmentId));

  const totalCommitments = await db.commitments
    .where("status")
    .anyOf("new", "snoozed", "actioned")
    .count();

  const aligned = linkedCommitmentIds.size;
  const unaligned = Math.max(0, totalCommitments - aligned);

  const byOkr = new Map<number, number>();
  for (const link of allLinks) {
    byOkr.set(link.okrId, (byOkr.get(link.okrId) ?? 0) + 1);
  }

  return { aligned, unaligned, byOkr };
}

// ─── Remove OKR ───

/**
 * Deactivate an OKR and remove all its commitment links.
 */
export async function removeOKR(id: number): Promise<void> {
  await db.okrs.update(id, { active: false });
  await db.commitment_okr_links.where("okrId").equals(id).delete();
  await logStatus("info", "worker", `Deactivated OKR #${id} and removed links`);
}
