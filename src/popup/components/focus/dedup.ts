import type { Commitment } from "@shared/types";

export interface DuplicateGroup {
  id: string;
  commitments: Commitment[];
  reason: string;
}

/** Simple word-overlap similarity between two strings */
function similarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().replace(/[^\w\s]/g, "").split(/\s+/).filter(Boolean));
  const wordsB = new Set(b.toLowerCase().replace(/[^\w\s]/g, "").split(/\s+/).filter(Boolean));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let overlap = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) overlap++;
  }
  return overlap / Math.max(wordsA.size, wordsB.size);
}

export function detectDuplicates(commitments: Commitment[]): DuplicateGroup[] {
  const groups: DuplicateGroup[] = [];
  const used = new Set<number>();

  for (let i = 0; i < commitments.length; i++) {
    if (used.has(commitments[i].id!)) continue;
    const matches: Commitment[] = [commitments[i]];

    for (let j = i + 1; j < commitments.length; j++) {
      if (used.has(commitments[j].id!)) continue;
      const sim = similarity(commitments[i].text, commitments[j].text);
      if (sim >= 0.5) {
        matches.push(commitments[j]);
        used.add(commitments[j].id!);
      }
    }

    if (matches.length >= 2) {
      used.add(commitments[i].id!);
      const sources = [...new Set(matches.map((m) => m.source_type))];
      const contexts = [...new Set(matches.map((m) => m.context))];
      const reason =
        sources.length > 1
          ? `Same item captured from ${sources.join(" and ")}`
          : `Similar items from ${contexts.join(" and ")}`;

      groups.push({
        id: `dup-${commitments[i].id}`,
        commitments: matches,
        reason,
      });
    }
  }

  return groups;
}
