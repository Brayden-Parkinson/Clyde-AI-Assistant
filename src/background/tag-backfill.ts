import { db, getAllTags, ensureGeneralTag, getNextTagColor, getSetting, setSetting } from "@shared/db";
import { CLAUDE_MODEL_FAST, API_TIMEOUT_MS } from "@shared/constants";
import { logStatus } from "@shared/status";
import type { Tag } from "@shared/types";
import { getUserProfile } from "@shared/user-profile";

const BACKFILL_SETTING = "tagsBackfilled";
const BATCH_SIZE = 30;

/**
 * One-time backfill: sends existing commitments to Claude in batches
 * to generate appropriate tags and assign them.
 * Only runs once — sets a flag in settings when complete.
 * Pass force=true to re-run even if already backfilled (e.g. user triggered re-tag).
 */
export async function backfillTags(force = false): Promise<void> {
  if (!force) {
    const alreadyDone = await getSetting(BACKFILL_SETTING, false);
    if (alreadyDone) return;

    const tagCount = await db.tags.count();
    // If we already have tags beyond General, skip backfill
    if (tagCount > 1) {
      await setSetting(BACKFILL_SETTING, true);
      return;
    }
  }

  const commitments = await db.commitments.toArray();
  if (commitments.length === 0) {
    await setSetting(BACKFILL_SETTING, true);
    return;
  }

  const result = await chrome.storage.local.get("anthropicApiKey");
  const apiKey = result.anthropicApiKey as string | undefined;
  if (!apiKey) return; // Can't backfill without API key — will retry next startup

  await logStatus("info", "tags", `Starting tag backfill for ${commitments.length} commitments...`);

  const generalTagId = await ensureGeneralTag();

  // Process in batches
  const allSuggestedTags = new Map<string, number>(); // name -> id

  for (let i = 0; i < commitments.length; i += BATCH_SIZE) {
    const batch = commitments.slice(i, i + BATCH_SIZE);
    const existingTags = await getAllTags();

    const commitmentsList = batch
      .map((c) => `[ID:${c.id}] ${c.text} (source: ${c.source_type}, context: ${c.context})`)
      .join("\n");

    const tagsList = existingTags
      .map((t) => `  - ID ${t.id}: "${t.name}"`)
      .join("\n");

    const systemPrompt = `You are categorizing commitments into thematic tags.

Available tags:
${tagsList}

For each commitment, assign exactly one tag_id from the list above, or suggest a new tag name if none fits.

Rules:
- Prefer existing tags. Default to "General" (ID ${generalTagId}) when unsure.
- Group related themes: 1:1 follow-ups, team syncs, tooling, people/access, etc.
- Only suggest a new tag if 2+ commitments in this batch would use it.
- Keep total tags to ~5-8 themes. Fewer, broader tags are better than many narrow ones.

Return ONLY valid JSON (no markdown fences):
{ "assignments": [ { "id": <commitment_id>, "tag_id": <existing_tag_id_or_null>, "suggested_tag": "<new tag name or null>" } ] }`;

    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
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
          system: systemPrompt,
          messages: [{ role: "user", content: `Categorize these commitments:\n\n${commitmentsList}` }],
        }),
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      });

      if (!response.ok) {
        await logStatus("warn", "tags", `Backfill API error (${response.status}) — skipping batch`);
        continue;
      }

      const data = await response.json();
      const textBlock = data.content?.find((b: { type: string }) => b.type === "text");
      if (!textBlock?.text) continue;

      let cleaned = textBlock.text.trim().replace(/^```json?\s*/, "").replace(/\s*```$/, "");
      const firstBrace = cleaned.indexOf("{");
      const lastBrace = cleaned.lastIndexOf("}");
      if (firstBrace >= 0 && lastBrace > firstBrace) {
        cleaned = cleaned.slice(firstBrace, lastBrace + 1);
      }

      const parsed = JSON.parse(cleaned) as {
        assignments?: Array<{ id: number; tag_id: number | null; suggested_tag: string | null }>;
      };

      if (!Array.isArray(parsed.assignments)) continue;

      const tagIdSet = new Set(existingTags.map((t) => t.id));

      for (const a of parsed.assignments) {
        let tagId: number = generalTagId;

        if (a.tag_id != null && tagIdSet.has(a.tag_id)) {
          tagId = a.tag_id;
        } else if (a.suggested_tag) {
          // Check if we already created this tag
          if (allSuggestedTags.has(a.suggested_tag)) {
            tagId = allSuggestedTags.get(a.suggested_tag)!;
          } else {
            // Check case-insensitive match
            const match = existingTags.find(
              (t) => t.name.toLowerCase() === a.suggested_tag!.toLowerCase(),
            );
            if (match?.id != null) {
              tagId = match.id;
              allSuggestedTags.set(a.suggested_tag, match.id);
            } else {
              const count = existingTags.length + allSuggestedTags.size;
              const newId = await db.tags.add({
                name: a.suggested_tag,
                color: getNextTagColor(count),
                createdAt: new Date().toISOString(),
              }) as number;
              tagId = newId;
              allSuggestedTags.set(a.suggested_tag, newId);
            }
          }
        }

        await db.commitments.update(a.id, { tag_id: tagId });
      }

      await logStatus("info", "tags", `Backfill batch: tagged ${parsed.assignments.length} commitments`);
    } catch (err) {
      await logStatus("warn", "tags", `Backfill batch error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  await setSetting(BACKFILL_SETTING, true);
  const finalTags = await getAllTags();
  await logStatus("success", "tags", `Tag backfill complete: ${finalTags.length} tags created`);
}

/**
 * Force re-tag all commitments using the current tag list.
 * Called from Settings when the user clicks "Re-tag all".
 * Preserves existing tags — only reassigns commitments.
 */
export async function retagAll(): Promise<{ tagCount: number; commitmentCount: number }> {
  const commitmentCount = await db.commitments.count();
  await logStatus("info", "tags", `Re-tagging ${commitmentCount} commitments...`);
  await backfillTags(true);
  const finalTags = await getAllTags();
  return { tagCount: finalTags.length, commitmentCount };
}

/**
 * Re-evaluate the sensitive flag on all existing commitments using the current
 * (updated) sensitivity criteria, including title-aware prompting.
 */
export async function reanalyzeSensitivity(): Promise<{ updated: number; total: number }> {
  const commitments = await db.commitments.toArray();
  if (commitments.length === 0) return { updated: 0, total: 0 };

  const result = await chrome.storage.local.get("anthropicApiKey");
  const apiKey = result.anthropicApiKey as string | undefined;
  if (!apiKey) throw new Error("No API key configured");

  const profile = await getUserProfile();
  const userName = profile.userName || "the user";
  const titleLower = (profile.userTitle || "").toLowerCase();
  const isLeadership = /\b(vp|ceo|cto|coo|cfo|chief|director|head of|president|founder|partner)\b/.test(titleLower);
  const isPeopleManager = /\b(manager|lead|head|principal|staff|director|senior manager|eng manager|em)\b/.test(titleLower);
  const isHR = /\b(hr|people|talent|recruiting|recruiter|people ops|human resources)\b/.test(titleLower);
  const titleHint = isLeadership
    ? `${userName} is in a leadership role (${profile.userTitle}). Commitments involving strategy, roadmap, headcount, budget, org changes, exec decisions, or anything about specific employees are highly likely to be sensitive.`
    : isPeopleManager
    ? `${userName} manages people (${profile.userTitle}). Commitments involving individual team members (performance, comp, promotions, PIPs, terminations, hiring decisions) or internal team dynamics should be marked sensitive.`
    : isHR
    ? `${userName} works in People/HR (${profile.userTitle}). The vast majority of their commitments touch confidential people data — err strongly on the side of marking sensitive.`
    : profile.userTitle
    ? `${userName}'s title is ${profile.userTitle}. Use this context to help judge whether a commitment would be considered confidential for someone in that role.`
    : "";

  const systemPrompt = `You are re-evaluating whether work commitments should be marked sensitive/private.

A commitment is sensitive if seeing it on someone's screen would be awkward, embarrassing, or risky — for them, a colleague, or the company. Ask yourself: would someone minimize their screen if a colleague walked by?

Mark sensitive=true for:
- HR: hiring/firing/layoffs, performance, compensation, PIPs, promotions, investigations
- Confidential business: unreleased product/roadmap, financials, M&A, legal, pricing strategy, security incidents
- Interpersonal: conflicts, specific person mentioned negatively, 1:1 dynamics, personal/health matters
- "Wouldn't want seen" info: org changes, internal politics, strategic bets, things that would embarrass the company publicly
${titleHint ? `\nROLE CONTEXT:\n${titleHint}` : ""}
Routine tasks (code reviews, docs, tickets, external deliverables, scheduling meetings) should be sensitive=false.

Return ONLY valid JSON (no markdown):
{ "results": [ { "id": <commitment_id>, "sensitive": true|false } ] }`;

  let totalUpdated = 0;

  for (let i = 0; i < commitments.length; i += BATCH_SIZE) {
    const batch = commitments.slice(i, i + BATCH_SIZE);
    const list = batch
      .map((c) => `[ID:${c.id}] "${c.text}" (source: ${c.source_type}, context: ${c.context})`)
      .join("\n");

    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
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
          system: systemPrompt,
          messages: [{ role: "user", content: `Re-evaluate sensitivity for these commitments:\n\n${list}` }],
        }),
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      });

      if (!response.ok) {
        await logStatus("warn", "sensitivity", `API error (${response.status}) — skipping batch`);
        continue;
      }

      const data = await response.json();
      const textBlock = data.content?.find((b: { type: string }) => b.type === "text");
      if (!textBlock?.text) continue;

      let cleaned = textBlock.text.trim().replace(/^```json?\s*/, "").replace(/\s*```$/, "");
      const firstBrace = cleaned.indexOf("{");
      const lastBrace = cleaned.lastIndexOf("}");
      if (firstBrace >= 0 && lastBrace > firstBrace) cleaned = cleaned.slice(firstBrace, lastBrace + 1);

      const parsed = JSON.parse(cleaned) as { results?: Array<{ id: number; sensitive: boolean }> };
      if (!Array.isArray(parsed.results)) continue;

      for (const r of parsed.results) {
        await db.commitments.update(r.id, { sensitive: r.sensitive === true });
        totalUpdated++;
      }

      await logStatus("info", "sensitivity", `Batch done: ${parsed.results.length} commitments evaluated`);
    } catch (err) {
      await logStatus("warn", "sensitivity", `Batch error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  await logStatus("success", "sensitivity", `Sensitivity re-analysis complete: ${totalUpdated} updated`);
  return { updated: totalUpdated, total: commitments.length };
}
