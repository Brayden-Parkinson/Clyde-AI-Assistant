/**
 * AI News orchestrator — fetches from multiple RSS/JSON sources,
 * sends through Claude for summarization + relevance scoring,
 * and stores in IndexedDB.
 */

import { db } from "@shared/db";
import {
  CLAUDE_MODEL_FAST,
  API_TIMEOUT_MS,
  API_MAX_RETRIES,
  API_RETRY_DELAY_MS,
} from "@shared/constants";
import type { NewsPost, RawNewsItem } from "@shared/types";
import { logStatus } from "@shared/status";
import { fetchAllSources, type FetchResult } from "./news-providers/index";

/** Main entry point — fetch all sources, summarize with Claude, store results */
export async function refreshNews(): Promise<{
  newPosts: number;
  total: number;
  errors: string[];
  sourceStats: FetchResult["sourceStats"];
}> {
  const errors: string[] = [];

  // 1. Fetch from all enabled sources
  let fetchResult: FetchResult;
  try {
    fetchResult = await fetchAllSources();
    errors.push(...fetchResult.errors);
    await logStatus(
      "info",
      "news",
      `Fetched ${fetchResult.items.length} items from ${fetchResult.sourceStats.filter((s) => !s.error).length} sources`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await logStatus("warn", "news", `Source fetch failed: ${msg}`);
    return { newPosts: 0, total: 0, errors: [msg], sourceStats: [] };
  }

  // 2. Dedup against existing posts
  const existingIds = new Set(
    (await db.news_posts.orderBy("sourceId").keys()) as string[],
  );
  const newItems = fetchResult.items.filter((p) => !existingIds.has(p.sourceId));

  if (newItems.length === 0) {
    await logStatus("info", "news", "No new items to process");
    return {
      newPosts: 0,
      total: fetchResult.items.length,
      errors,
      sourceStats: fetchResult.sourceStats,
    };
  }

  // 3. Summarize with Claude
  try {
    const { posts: summarized, dailyBriefing } = await summarizeWithClaude(newItems);
    const now = new Date().toISOString();

    for (const item of summarized) {
      const newsPost: Omit<NewsPost, "id"> = {
        sourceId: item.sourceId,
        source: item.source,
        sourceName: item.sourceName,
        author: item.author,
        title: item.title,
        rawText: item.text,
        summary: item.summary,
        relevanceScore: item.relevanceScore,
        topicTag: item.topicTag,
        postedAt: item.postedAt,
        url: item.url,
        fetchedAt: now,
      };
      await db.news_posts.add(newsPost as NewsPost);
    }

    // Store daily briefing in chrome.storage
    if (dailyBriefing) {
      await chrome.storage.local.set({
        newsBriefing: dailyBriefing,
        newsBriefingDate: now,
      });
    }

    // Store source stats for the UI footer
    await chrome.storage.local.set({ newsSourceStats: fetchResult.sourceStats });

    await logStatus("info", "news", `Stored ${summarized.length} new items`);
    return {
      newPosts: summarized.length,
      total: fetchResult.items.length,
      errors,
      sourceStats: fetchResult.sourceStats,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`Claude summarization: ${msg}`);
    await logStatus("warn", "news", `Summarization failed: ${msg}`);
    return {
      newPosts: 0,
      total: fetchResult.items.length,
      errors,
      sourceStats: fetchResult.sourceStats,
    };
  }
}

// ─── Claude summarization ───

interface SummarizedItem extends RawNewsItem {
  summary: string;
  relevanceScore: number;
  topicTag: string;
}

async function summarizeWithClaude(
  items: RawNewsItem[],
): Promise<{ posts: SummarizedItem[]; dailyBriefing: string | null }> {
  const result = await chrome.storage.local.get("anthropicApiKey");
  const apiKey = result.anthropicApiKey as string | undefined;
  if (!apiKey) throw new Error("No API key configured");

  const system = `You are an AI news analyst for a senior engineering manager at OpenSpace, an AI-forward construction tech company exploring agentic workflows.

You will receive a JSON array of news items from various sources (blogs, Hacker News, arXiv, etc.).

For each item, produce a JSON object with:
- "sourceId": pass through unchanged
- "summary": a concise 1-2 sentence summary of the key insight or news
- "relevanceScore": integer 1-10, scored by relevance:
  10 = Anthropic/Claude news, Claude Code, Claude Code Review
  8-9 = Agentic AI workflows, AI coding tools, AI-assisted engineering
  7-8 = Major AI model releases, significant research findings
  5-6 = General AI industry news, ML infrastructure
  3-4 = Tangentially related tech news
  1-2 = Not relevant to AI engineering leadership
- "topicTag": exactly one of: "Claude & Anthropic", "Research", "Industry", "Tools & Infra", "Agents & Workflows", "Open Source"

Also produce a "dailyBriefing" field: 3-5 bullet points (plain text, one per line, starting with "• ") summarizing the most important themes across ALL items. Focus on what matters to an engineering leader adopting AI tools.

Return JSON: { "items": [...], "dailyBriefing": "• bullet1\\n• bullet2\\n..." }
Only output valid JSON, no markdown fences.`;

  const userMessage = JSON.stringify(
    items.map((p) => ({
      sourceId: p.sourceId,
      source: p.source,
      title: p.title,
      text: p.text.slice(0, 300),
    })),
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

  const parsed = parseJsonResponse(textBlock.text);
  const parsedItems = (parsed.items ?? []) as Array<{
    sourceId: string;
    summary: string;
    relevanceScore: number;
    topicTag: string;
  }>;

  // Merge summaries back into original items
  const summaryMap = new Map(parsedItems.map((s) => [s.sourceId, s]));
  const posts = items
    .map((item) => {
      const summary = summaryMap.get(item.sourceId);
      if (!summary) return null;
      return {
        ...item,
        summary: summary.summary,
        relevanceScore: Math.max(1, Math.min(10, summary.relevanceScore)),
        topicTag: summary.topicTag || "Industry",
      };
    })
    .filter((p): p is SummarizedItem => p !== null);

  return {
    posts,
    dailyBriefing: (parsed.dailyBriefing as string) ?? null,
  };
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

function parseJsonResponse(raw: string): Record<string, unknown> {
  let cleaned = raw.trim().replace(/^```json?\s*/, "").replace(/\s*```$/, "");
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }
  return JSON.parse(cleaned);
}
