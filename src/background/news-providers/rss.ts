/**
 * Generic RSS/Atom feed fetcher.
 * Uses fetch() + DOMParser (available in Chrome MV3 service workers).
 */

import { NEWS_FETCH_TIMEOUT_MS, NEWS_MAX_ITEMS_PER_SOURCE } from "@shared/constants";
import type { RawNewsItem, NewsSourceType } from "@shared/types";

/** Strip HTML tags from a string */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** Get text content of an XML element, or null */
function getText(el: Element, tag: string): string | null {
  const child = el.querySelector(tag);
  return child?.textContent?.trim() ?? null;
}

/** Get an attribute from a child element */
function getAttr(el: Element, tag: string, attr: string): string | null {
  const child = el.querySelector(tag);
  return child?.getAttribute(attr) ?? null;
}

export async function fetchRSS(
  url: string,
  source: NewsSourceType,
  sourceName: string,
): Promise<RawNewsItem[]> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(NEWS_FETCH_TIMEOUT_MS),
    headers: { Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" },
  });

  if (!response.ok) {
    throw new Error(`RSS fetch failed: ${response.status} ${response.statusText}`);
  }

  const text = await response.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, "text/xml");

  // Check for parse errors
  const parseError = doc.querySelector("parsererror");
  if (parseError) {
    throw new Error(`RSS parse error: ${parseError.textContent?.slice(0, 100)}`);
  }

  const items: RawNewsItem[] = [];

  // Try RSS 2.0 format (<item>)
  const rssItems = doc.querySelectorAll("item");
  if (rssItems.length > 0) {
    for (const item of Array.from(rssItems).slice(0, NEWS_MAX_ITEMS_PER_SOURCE)) {
      const title = getText(item, "title") ?? "";
      const link = getText(item, "link") ?? "";
      const guid = getText(item, "guid") ?? link;
      const description = getText(item, "description") ?? "";
      const pubDate = getText(item, "pubDate");
      const dcCreator = getText(item, "dc\\:creator") ?? getText(item, "creator");

      items.push({
        sourceId: `${source}:${guid || link}`,
        source,
        sourceName,
        author: dcCreator,
        title: stripHtml(title),
        text: stripHtml(description).slice(0, 500),
        url: link,
        postedAt: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
      });
    }
    return items;
  }

  // Try Atom format (<entry>)
  const atomEntries = doc.querySelectorAll("entry");
  for (const entry of Array.from(atomEntries).slice(0, NEWS_MAX_ITEMS_PER_SOURCE)) {
    const title = getText(entry, "title") ?? "";
    const link = getAttr(entry, "link", "href") ?? getText(entry, "link") ?? "";
    const id = getText(entry, "id") ?? link;
    const summary = getText(entry, "summary") ?? getText(entry, "content") ?? "";
    const published = getText(entry, "published") ?? getText(entry, "updated");
    const authorName = getText(entry, "author > name");

    items.push({
      sourceId: `${source}:${id || link}`,
      source,
      sourceName,
      author: authorName,
      title: stripHtml(title),
      text: stripHtml(summary).slice(0, 500),
      url: link,
      postedAt: published ? new Date(published).toISOString() : new Date().toISOString(),
    });
  }

  return items;
}
