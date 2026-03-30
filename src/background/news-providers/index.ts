/**
 * News provider registry — calls all enabled sources in parallel.
 */

import { NEWS_SOURCES } from "@shared/constants";
import type { RawNewsItem, NewsSourceType } from "@shared/types";
import { fetchRSS } from "./rss";
import { fetchHackerNews } from "./hackernews";

export interface FetchResult {
  items: RawNewsItem[];
  errors: string[];
  /** Per-source fetch stats for the Sources footer */
  sourceStats: Array<{
    source: NewsSourceType;
    name: string;
    count: number;
    error: string | null;
    fetchedAt: string;
  }>;
}

export async function fetchAllSources(): Promise<FetchResult> {
  const items: RawNewsItem[] = [];
  const errors: string[] = [];
  const sourceStats: FetchResult["sourceStats"] = [];
  const now = new Date().toISOString();

  const entries = Object.entries(NEWS_SOURCES).filter(([, cfg]) => cfg.enabled);

  const results = await Promise.allSettled(
    entries.map(async ([key, cfg]) => {
      const source = key as NewsSourceType;
      if (cfg.type === "json" && source === "hacker-news") {
        return { source, name: cfg.name, items: await fetchHackerNews() };
      }
      return { source, name: cfg.name, items: await fetchRSS(cfg.url, source, cfg.name) };
    }),
  );

  for (const result of results) {
    if (result.status === "fulfilled") {
      items.push(...result.value.items);
      sourceStats.push({
        source: result.value.source,
        name: result.value.name,
        count: result.value.items.length,
        error: null,
        fetchedAt: now,
      });
    } else {
      const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
      errors.push(reason);
      // Try to extract which source failed from the error
      sourceStats.push({
        source: "anthropic-blog", // fallback — order matches entries
        name: "Unknown",
        count: 0,
        error: reason,
        fetchedAt: now,
      });
    }
  }

  // Fix source stats for failed entries by matching with entries order
  let failIdx = 0;
  for (let i = 0; i < results.length; i++) {
    if (results[i].status === "rejected") {
      const [key, cfg] = entries[i];
      // Find the corresponding failed stat entry and fix it
      const failedStats = sourceStats.filter((s) => s.error !== null);
      if (failedStats[failIdx]) {
        failedStats[failIdx].source = key as NewsSourceType;
        failedStats[failIdx].name = cfg.name;
      }
      failIdx++;
    }
  }

  return { items, errors, sourceStats };
}
