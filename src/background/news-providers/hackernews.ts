/**
 * Hacker News provider — uses the free Firebase JSON API.
 * Fetches top stories, filters by AI-related keywords.
 */

import {
  NEWS_FETCH_TIMEOUT_MS,
  NEWS_MAX_ITEMS_PER_SOURCE,
  NEWS_HN_KEYWORDS,
} from "@shared/constants";
import type { RawNewsItem } from "@shared/types";

const HN_API = "https://hacker-news.firebaseio.com/v0";

interface HNStory {
  id: number;
  title: string;
  url?: string;
  by: string;
  time: number;
  score: number;
}

function matchesKeywords(title: string): boolean {
  const lower = title.toLowerCase();
  return NEWS_HN_KEYWORDS.some((kw) => lower.includes(kw));
}

export async function fetchHackerNews(): Promise<RawNewsItem[]> {
  // Fetch top story IDs
  const idsResponse = await fetch(`${HN_API}/topstories.json`, {
    signal: AbortSignal.timeout(NEWS_FETCH_TIMEOUT_MS),
  });
  if (!idsResponse.ok) throw new Error(`HN API error: ${idsResponse.status}`);

  const allIds: number[] = await idsResponse.json();
  // Fetch first 40 stories to find enough AI-related ones
  const batch = allIds.slice(0, 40);

  const stories = await Promise.allSettled(
    batch.map(async (id) => {
      const res = await fetch(`${HN_API}/item/${id}.json`, {
        signal: AbortSignal.timeout(NEWS_FETCH_TIMEOUT_MS),
      });
      if (!res.ok) return null;
      return res.json() as Promise<HNStory>;
    }),
  );

  const items: RawNewsItem[] = [];

  for (const result of stories) {
    if (result.status !== "fulfilled" || !result.value) continue;
    const story = result.value;

    if (!story.title || !matchesKeywords(story.title)) continue;

    items.push({
      sourceId: `hacker-news:${story.id}`,
      source: "hacker-news",
      sourceName: "Hacker News",
      author: story.by ?? null,
      title: story.title,
      text: story.title, // HN stories are title-only; Claude will summarize from title
      url: story.url ?? `https://news.ycombinator.com/item?id=${story.id}`,
      postedAt: new Date(story.time * 1000).toISOString(),
    });

    if (items.length >= NEWS_MAX_ITEMS_PER_SOURCE) break;
  }

  return items;
}
