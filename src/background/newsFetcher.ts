/**
 * AI News orchestrator — opens background tabs to X/Twitter profiles,
 * injects a scraper, sends results through Claude for summarization,
 * and stores in IndexedDB.
 */

import { db } from "@shared/db";
import {
  CLAUDE_MODEL_FAST,
  API_TIMEOUT_MS,
  API_MAX_RETRIES,
  API_RETRY_DELAY_MS,
  NEWS_SCRAPE_TIMEOUT_MS,
  NEWS_DEFAULT_ACCOUNTS,
} from "@shared/constants";
import type { NewsPost, XScrapedPost } from "@shared/types";
import { logStatus } from "@shared/status";

// ─── Pending scrape resolvers keyed by tab ID ───

const pendingScrapes = new Map<
  number,
  { resolve: (posts: XScrapedPost[]) => void; reject: (err: Error) => void }
>();

/** Called by service-worker when an X_SCRAPED_POSTS message arrives */
export function handleScrapedPosts(
  posts: XScrapedPost[],
  tabId: number | undefined,
): void {
  if (tabId == null) return;
  const pending = pendingScrapes.get(tabId);
  if (pending) {
    pending.resolve(posts);
    pendingScrapes.delete(tabId);
  }
}

/** Main entry point — scrape accounts, summarize with Claude, store results */
export async function refreshNews(
  accounts: string[] = NEWS_DEFAULT_ACCOUNTS,
): Promise<{ newPosts: number; total: number; errors: string[] }> {
  const errors: string[] = [];
  let allScraped: XScrapedPost[] = [];

  for (const account of accounts) {
    try {
      const posts = await scrapeAccount(account);
      allScraped = allScraped.concat(posts);
      await logStatus("info", "news", `Scraped ${posts.length} posts from @${account}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`@${account}: ${msg}`);
      await logStatus("warn", "news", `Failed to scrape @${account}: ${msg}`);
    }
  }

  // Dedup against existing posts
  const existingIds = new Set(
    (await db.news_posts.orderBy("tweetId").keys()) as string[],
  );
  const newPosts = allScraped.filter((p) => !existingIds.has(p.tweetId));

  if (newPosts.length === 0) {
    await logStatus("info", "news", "No new posts to process");
    return { newPosts: 0, total: allScraped.length, errors };
  }

  // Summarize with Claude
  try {
    const summarized = await summarizeWithClaude(newPosts);
    const now = new Date().toISOString();

    for (const item of summarized) {
      const newsPost: Omit<NewsPost, "id"> = {
        tweetId: item.tweetId,
        author: item.author,
        authorDisplayName: item.authorDisplayName,
        rawText: item.text,
        summary: item.summary,
        relevanceScore: item.relevanceScore,
        postedAt: item.timestamp,
        url: item.url,
        links: item.links,
        scrapedAt: now,
      };
      await db.news_posts.add(newsPost as NewsPost);
    }

    await logStatus("info", "news", `Stored ${summarized.length} new posts`);
    return { newPosts: summarized.length, total: allScraped.length, errors };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`Claude summarization: ${msg}`);
    await logStatus("warn", "news", `Summarization failed: ${msg}`);
    return { newPosts: 0, total: allScraped.length, errors };
  }
}

// ─── Tab scraping ───

async function scrapeAccount(account: string): Promise<XScrapedPost[]> {
  const tab = await chrome.tabs.create({
    url: `https://x.com/${account}`,
    active: false,
  });

  const tabId = tab.id;
  if (tabId == null) throw new Error("Failed to create tab");

  try {
    // Content script (x-scraper.ts) auto-injects on x.com via manifest
    // and sends X_SCRAPED_POSTS when done — just wait for that message.
    const posts = await new Promise<XScrapedPost[]>((resolve, reject) => {
      pendingScrapes.set(tabId, { resolve, reject });

      setTimeout(() => {
        if (pendingScrapes.has(tabId)) {
          pendingScrapes.delete(tabId);
          reject(new Error(`Scrape timed out after ${NEWS_SCRAPE_TIMEOUT_MS / 1000}s`));
        }
      }, NEWS_SCRAPE_TIMEOUT_MS);
    });

    return posts;
  } finally {
    try {
      await chrome.tabs.remove(tabId);
    } catch {
      // Tab may already be closed
    }
  }
}

// ─── Claude summarization ───

interface SummarizedPost extends XScrapedPost {
  summary: string;
  relevanceScore: number;
}

async function summarizeWithClaude(
  posts: XScrapedPost[],
): Promise<SummarizedPost[]> {
  const result = await chrome.storage.local.get("anthropicApiKey");
  const apiKey = result.anthropicApiKey as string | undefined;
  if (!apiKey) throw new Error("No API key configured");

  const system = `You are an AI/tech news analyst. You will receive a JSON array of social media posts.
For each post, produce a JSON object with:
- "tweetId": the original tweetId (pass through)
- "summary": a concise 1-2 sentence summary of the key insight or news
- "relevanceScore": integer 1-10, where 10 = highly relevant to AI, ML, software engineering, developer tools, or programming language design

Return a JSON array of objects. Only output valid JSON, no markdown fences.`;

  const userMessage = JSON.stringify(
    posts.map((p) => ({ tweetId: p.tweetId, text: p.text, author: p.author })),
  );

  const response = await fetchWithRetry(apiKey, {
    model: CLAUDE_MODEL_FAST,
    max_tokens: 4096,
    system,
    messages: [{ role: "user", content: userMessage }],
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Claude API error ${response.status}: ${text.slice(0, 200)}`);
  }

  const data = await response.json();
  const textBlock = data.content?.find(
    (block: { type: string }) => block.type === "text",
  );
  if (!textBlock?.text) throw new Error("No text in Claude response");

  const parsed = parseJsonArray(textBlock.text) as Array<{
    tweetId: string;
    summary: string;
    relevanceScore: number;
  }>;

  // Merge summaries back into original posts
  const summaryMap = new Map(parsed.map((s) => [s.tweetId, s]));
  return posts
    .map((post) => {
      const summary = summaryMap.get(post.tweetId);
      if (!summary) return null;
      return {
        ...post,
        summary: summary.summary,
        relevanceScore: Math.max(1, Math.min(10, summary.relevanceScore)),
      };
    })
    .filter((p): p is SummarizedPost => p !== null);
}

async function fetchWithRetry(
  apiKey: string,
  body: object,
): Promise<Response> {
  for (let attempt = 0; attempt <= API_MAX_RETRIES; attempt++) {
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      });

      if (response.status === 429 && attempt < API_MAX_RETRIES) {
        const delay = API_RETRY_DELAY_MS * (attempt + 1);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      return response;
    } catch (err) {
      if (err instanceof DOMException && err.name === "TimeoutError") {
        if (attempt < API_MAX_RETRIES) continue;
        throw new Error(`Claude API timed out after ${API_TIMEOUT_MS / 1000}s`);
      }
      throw err;
    }
  }
  throw new Error("Claude API failed after all retries");
}

function parseJsonArray(raw: string): unknown[] {
  let cleaned = raw.trim().replace(/^```json?\s*/, "").replace(/\s*```$/, "");
  const firstBracket = cleaned.indexOf("[");
  const lastBracket = cleaned.lastIndexOf("]");
  if (firstBracket >= 0 && lastBracket > firstBracket) {
    cleaned = cleaned.slice(firstBracket, lastBracket + 1);
  }
  return JSON.parse(cleaned);
}
