import { db } from "@shared/db";
import type { Commitment } from "@shared/types";

/**
 * Normalize text for hashing: lowercase, strip leading #, collapse whitespace,
 * remove trailing punctuation. This ensures minor Claude output variations
 * (e.g. "#engineering" vs "engineering", extra spaces) produce the same hash.
 */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/^#/, "")
    .replace(/\s+/g, " ")
    .replace(/[.!?,;:]+$/, "")
    .trim();
}

/**
 * Compute a SHA-256 hash for deduplication.
 * Inputs are normalized so minor formatting differences produce identical hashes.
 */
export async function computeHash(
  originalQuote: string,
  sourceType: string,
  context: string,
): Promise<string> {
  const input = `${normalize(originalQuote)}|${normalize(sourceType)}|${normalize(context)}`;
  const encoded = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  const bytes = new Uint8Array(digest);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Check whether a commitment with this hash already exists in the DB.
 */
export async function isDuplicate(hash: string): Promise<boolean> {
  const existing = await db.commitments.where("hash").equals(hash).first();
  return existing !== undefined;
}

/**
 * Trigram-based similarity between two strings (0–1).
 * Used for fuzzy dedup when exact hash doesn't match but the text is nearly identical.
 */
function trigrams(s: string): Set<string> {
  const t = new Set<string>();
  const lower = s.toLowerCase();
  for (let i = 0; i <= lower.length - 3; i++) {
    t.add(lower.slice(i, i + 3));
  }
  return t;
}

function trigramSimilarity(a: string, b: string): number {
  const ta = trigrams(a);
  const tb = trigrams(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let intersection = 0;
  for (const t of ta) {
    if (tb.has(t)) intersection++;
  }
  return intersection / Math.max(ta.size, tb.size);
}

/**
 * Check if a commitment is a fuzzy duplicate of any recent commitment.
 * Looks at commitments from the last 7 days in the same context/channel.
 * Returns true if text similarity > 0.7 AND context matches.
 */
export async function isFuzzyDuplicate(
  text: string,
  originalQuote: string,
  context: string,
): Promise<boolean> {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const recent: Commitment[] = await db.commitments
    .where("createdAt")
    .above(cutoff)
    .toArray();

  const normContext = normalize(context);

  for (const existing of recent) {
    // Must be same channel/context
    if (normalize(existing.context) !== normContext) continue;

    // Check text similarity (the summarized commitment text)
    const textSim = trigramSimilarity(text, existing.text);
    if (textSim > 0.7) return true;

    // Check original_quote similarity (the raw source text)
    const quoteSim = trigramSimilarity(originalQuote, existing.original_quote);
    if (quoteSim > 0.7) return true;
  }

  return false;
}
