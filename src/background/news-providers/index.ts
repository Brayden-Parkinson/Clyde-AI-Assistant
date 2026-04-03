/**
 * News provider registry — calls all enabled sources in parallel.
 * Respects user-disabled sources from chrome.storage.local.
 * Emits per-source progress messages for the UI.
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

/** Send per-source progress to the popup UI */
function emitProgress(source: string, status: "fetching" | "done" | "error") {
  chrome.runtime.sendMessage({
    type: "NEWS_SOURCE_PROGRESS",
    source,
    status,
  }).catch(() => {}); // popup may not be open
}

export async function fetchAllSources(): Promise<FetchResult> {
  const items: RawNewsItem[] = [];
  const errors: string[] = [];
  const sourceStats: FetchResult["sourceStats"] = [];
  const now = new Date().toISOString();

  // Respect user-disabled sources
  const storage = await chrome.storage.local.get("newsDisabledSources");
  const disabledSources = new Set<string>(storage.newsDisabledSources ?? []);

  const entries = Object.entries(NEWS_SOURCES).filter(
    ([key, cfg]) => cfg.enabled && !disabledSources.has(key),
  );

  const results = await Promise.allSettled(
    entries.map(async ([key, cfg]) => {
      const source = key as NewsSourceType;
      emitProgress(key, "fetching");
      try {
        let fetched: RawNewsItem[];
        if (cfg.type === "json" && source === "hacker-news") {
          fetched = await fetchHackerNews();
        } else {
          fetched = await fetchRSS(cfg.url, source, cfg.name);
        }
        emitProgress(key, "done");
        return { source, name: cfg.name, items: fetched };
      } catch (err) {
        emitProgress(key, "error");
        throw err;
      }
    }),
  );

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const [key, cfg] = entries[i];
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
      errors.push(`${cfg.name}: ${reason}`);
      sourceStats.push({
        source: key as NewsSourceType,
        name: cfg.name,
        count: 0,
        error: reason,
        fetchedAt: now,
      });
    }
  }

  return { items, errors, sourceStats };
}
