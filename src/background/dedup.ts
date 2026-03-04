import { db } from "@shared/db";

/**
 * Compute a SHA-256 hash for deduplication.
 * Uses the same triple (originalQuote, sourceType, context) referenced in the Commitment.hash field.
 */
export async function computeHash(
  originalQuote: string,
  sourceType: string,
  context: string,
): Promise<string> {
  const input = `${originalQuote}|${sourceType}|${context}`;
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
