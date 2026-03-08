/** Slack DOM selectors — multiple strategies since Slack changes frequently */

interface SelectorPair {
  primary: string;
  fallback: string;
}

export const SELECTORS = {
  messageContainer: {
    primary: '[data-qa="virtual-list-item"]',
    fallback: ".c-virtual_list__item",
  },
  messageText: {
    primary: '[data-qa="message-text"]',
    fallback: ".c-message_kit__text",
  },
  senderName: {
    primary: '[data-qa="message_sender_name"]',
    fallback: ".c-message_kit__sender",
  },
  timestamp: {
    primary: '[data-qa="message_timestamp"]',
    fallback: "[datetime]",
  },
  messageList: {
    primary: '[data-qa="slack_kit_list"]',
    fallback: ".c-virtual_list__scroll_container",
  },
  channelHeader: {
    primary: '[data-qa="channel_name"]',
    fallback: ".p-view_header__channel_title",
  },
} as const satisfies Record<string, SelectorPair>;

const MESSAGE_TEXT_SELECTORS = [
  '[data-qa="message-text"]',
  ".c-message_kit__text",
  ".p-rich_text_section",
  '[data-qa="message_content"]',
  ".c-message__body",
];

const SENDER_NAME_SELECTORS = [
  '[data-qa="message_sender_name"]',
  ".c-message_kit__sender",
  '[data-qa="message-sender-name"]',
  ".c-message__sender_button",
  "button.c-message_kit__sender_link",
];

const TIMESTAMP_SELECTORS = [
  '[data-qa="message_timestamp"]',
  "[datetime]",
  '[data-qa="message-timestamp"]',
  "time",
  ".c-timestamp",
];

const MESSAGE_LIST_SELECTORS = [
  '[data-qa="slack_kit_list"]',
  ".c-virtual_list__scroll_container",
  '[role="list"]',
  ".p-message_pane__message_list",
  '[data-qa="message_pane"]',
  ".c-scrollbar__hider",
];

/** Selectors that might be an ancestor "message block" wrapping text + sender + timestamp */
const MESSAGE_BLOCK_SELECTORS = [
  '[data-qa="virtual-list-item"]',
  ".c-virtual_list__item",
  '[role="listitem"]',
  ".c-message_kit__background",
  "[data-qa='message_container']",
  ".c-message",
  ".c-message_kit__message",
  ".c-message_kit__blocks",
];

/** Try multiple selectors, return first match */
function queryMulti(parent: Element | Document, selectors: string[]): Element | null {
  for (const sel of selectors) {
    try {
      const el = parent.querySelector(sel);
      if (el) return el;
    } catch {
      // Invalid selector, skip
    }
  }
  return null;
}

function queryAllMulti(parent: Element | Document, selectors: string[]): Element[] {
  for (const sel of selectors) {
    try {
      const els = parent.querySelectorAll(sel);
      if (els.length > 0) return Array.from(els);
    } catch {
      // Invalid selector, skip
    }
  }
  return [];
}

export function queryWithFallback(
  parent: Element | Document,
  selector: SelectorPair,
): Element | null {
  const el = parent.querySelector(selector.primary);
  if (el) return el;
  return parent.querySelector(selector.fallback);
}

// ─── Text-First Message Discovery ───
// Slack's virtual-list-item elements are NOT ancestors of message-text elements.
// So we find text elements first, then walk UP the DOM to find context.

export interface DiscoveredMessage {
  textEl: Element;
  text: string;
  sender: string;
  timestamp: string;
  reactions: string[];
  /** The ancestor block element we resolved for this message */
  blockEl: Element;
}

/**
 * Walk up from a text element to find the nearest "message block" ancestor.
 * Falls back to walking up N levels if no known selector matches.
 */
function findMessageBlock(textEl: Element): Element {
  // Try closest() with each block selector
  for (const sel of MESSAGE_BLOCK_SELECTORS) {
    try {
      const block = textEl.closest(sel);
      if (block) return block;
    } catch {
      // skip
    }
  }
  // Fallback: walk up 5 levels
  let el: Element | null = textEl;
  for (let i = 0; i < 5 && el?.parentElement; i++) {
    el = el.parentElement;
  }
  return el ?? textEl;
}

/**
 * Search within a block element (and nearby siblings) for sender name.
 */
function findSenderInBlock(block: Element): string {
  const el = queryMulti(block, SENDER_NAME_SELECTORS);
  if (el?.textContent?.trim()) return el.textContent.trim();

  // Try previous siblings (sender might be in a separate preceding block)
  let prev = block.previousElementSibling;
  for (let i = 0; i < 3 && prev; i++) {
    const senderEl = queryMulti(prev, SENDER_NAME_SELECTORS);
    if (senderEl?.textContent?.trim()) return senderEl.textContent.trim();
    prev = prev.previousElementSibling;
  }

  return "";
}

/**
 * Search within a block element (and nearby siblings) for timestamp.
 */
function findTimestampInBlock(block: Element): string {
  const el = queryMulti(block, TIMESTAMP_SELECTORS);
  if (el) {
    return (
      el.getAttribute("datetime") ??
      el.getAttribute("data-ts") ??
      el.getAttribute("title") ??
      el.textContent?.trim() ??
      new Date().toISOString()
    );
  }

  // Try previous siblings
  let prev = block.previousElementSibling;
  for (let i = 0; i < 3 && prev; i++) {
    const tsEl = queryMulti(prev, TIMESTAMP_SELECTORS);
    if (tsEl) {
      return (
        tsEl.getAttribute("datetime") ??
        tsEl.getAttribute("data-ts") ??
        tsEl.getAttribute("title") ??
        tsEl.textContent?.trim() ??
        new Date().toISOString()
      );
    }
    prev = prev.previousElementSibling;
  }

  return new Date().toISOString();
}

/**
 * Find reaction emoji names on a message block.
 * Looks for `.c-reaction` elements (excluding the "add reaction" button),
 * parses emoji names from aria-label or fallback attributes.
 */
export function findReactions(block: Element): string[] {
  const reactions: string[] = [];
  const reactionEls = block.querySelectorAll(".c-reaction:not(.c-reaction_add)");

  for (const el of reactionEls) {
    // Primary: parse aria-label "Reacted with :emoji_name: N times"
    const ariaLabel = el.getAttribute("aria-label");
    if (ariaLabel) {
      const match = ariaLabel.match(/:([^:]+):/);
      if (match) {
        reactions.push(match[1]);
        continue;
      }
    }

    // Fallback: check data-stringify-emoji on the emoji element
    const emojiEl = el.querySelector(".c-reaction__emoji, [data-stringify-emoji]");
    if (emojiEl) {
      const dataEmoji = emojiEl.getAttribute("data-stringify-emoji");
      if (dataEmoji) {
        // data-stringify-emoji is typically ":emoji_name:"
        const cleaned = dataEmoji.replace(/^:|:$/g, "");
        if (cleaned) {
          reactions.push(cleaned);
          continue;
        }
      }
      // Last resort: text content of the emoji element
      const text = emojiEl.textContent?.trim();
      if (text) {
        reactions.push(text);
      }
    }
  }

  return reactions;
}

/**
 * TEXT-FIRST approach: Find all message-text elements in the document,
 * then walk UP to find sender/timestamp context for each.
 */
export function discoverMessages(): DiscoveredMessage[] {
  const results: DiscoveredMessage[] = [];
  const textEls = queryAllMulti(document, MESSAGE_TEXT_SELECTORS);

  for (const textEl of textEls) {
    const text = textEl.textContent?.trim();
    if (!text) continue;

    const block = findMessageBlock(textEl);
    const sender = findSenderInBlock(block);
    const timestamp = findTimestampInBlock(block);
    const reactions = findReactions(block);

    results.push({ textEl, text, sender, timestamp, reactions, blockEl: block });
  }

  return results;
}

/** Find the message list container for the MutationObserver */
export function findMessageList(): Element | null {
  for (const sel of MESSAGE_LIST_SELECTORS) {
    try {
      const candidates = document.querySelectorAll(sel);
      if (candidates.length === 0) continue;

      if (candidates.length === 1) return candidates[0];

      // Multiple matches — find the one that has actual message content
      for (const candidate of candidates) {
        const hasText = candidate.querySelector(
          '[data-qa="message-text"], .c-message_kit__text, .p-rich_text_section',
        );
        if (hasText) return candidate;
      }

      return candidates[0];
    } catch {
      // skip
    }
  }
  return null;
}

/** Find message text within any element (for MutationObserver on added nodes) */
export function findMessageText(container: Element): string {
  const el = queryMulti(container, MESSAGE_TEXT_SELECTORS);
  return el?.textContent?.trim() ?? "";
}

/** Find sender name within any element */
export function findSenderName(container: Element): string {
  const el = queryMulti(container, SENDER_NAME_SELECTORS);
  return el?.textContent?.trim() ?? "";
}

/** Find timestamp within any element */
export function findTimestamp(container: Element): string {
  const el = queryMulti(container, TIMESTAMP_SELECTORS);
  if (!el) return new Date().toISOString();
  return (
    el.getAttribute("datetime") ??
    el.getAttribute("data-ts") ??
    el.getAttribute("title") ??
    el.textContent?.trim() ??
    new Date().toISOString()
  );
}

/** Run diagnostics and return a detailed report */
export function runDiagnostics(): string[] {
  const results: string[] = [];

  // Check each selector family
  for (const [name, selectors] of Object.entries({
    "Message text": MESSAGE_TEXT_SELECTORS,
    "Sender name": SENDER_NAME_SELECTORS,
    "Timestamp": TIMESTAMP_SELECTORS,
    "Message list": MESSAGE_LIST_SELECTORS,
  })) {
    let found = false;
    for (const sel of selectors) {
      try {
        const count = document.querySelectorAll(sel).length;
        if (count > 0) {
          results.push(`${name}: "${sel}" matched ${count} elements`);
          found = true;
          break;
        }
      } catch {
        // skip
      }
    }
    if (!found) {
      results.push(`${name}: NO SELECTORS MATCHED`);
    }
  }

  // Test the text-first approach directly
  const discovered = discoverMessages();
  results.push(`Text-first discovery: ${discovered.length} messages with text found`);
  if (discovered.length > 0) {
    const withSender = discovered.filter((m) => m.sender).length;
    const withTs = discovered.filter((m) => !m.timestamp.startsWith(new Date().getFullYear().toString())).length;
    results.push(`  - ${withSender} have sender names, ${withTs} have real timestamps`);
    // Show first message as sample
    const sample = discovered[0];
    results.push(`  - Sample: "${sample.text.slice(0, 60)}..." by "${sample.sender || "(unknown)"}"`);
  }

  return results;
}

export function getChannelName(): string {
  const headerEl = queryWithFallback(document, SELECTORS.channelHeader);
  if (headerEl?.textContent?.trim()) {
    return headerEl.textContent.trim();
  }

  const pathParts = window.location.pathname.split("/");
  const channelId = pathParts[3];
  if (channelId) return channelId;

  return "unknown-channel";
}

/** Extract workspace and channel IDs from the current Slack URL */
export function getSlackIds(): { workspaceId: string | null; channelId: string | null } {
  // URL pattern: /client/{workspaceId}/{channelId}/...
  const pathParts = window.location.pathname.split("/");
  return {
    workspaceId: pathParts[2] || null,
    channelId: pathParts[3] || null,
  };
}

/** Extract Slack message ts from a message block DOM element */
export function extractMessageTs(block: Element): string | null {
  // Try data-ts attribute directly on the block or children
  const tsAttr = block.getAttribute("data-ts")
    ?? block.querySelector("[data-ts]")?.getAttribute("data-ts");
  if (tsAttr) return tsAttr;

  // Try parsing from timestamp permalink href: /archives/CXXXX/pXXXXXXXXXXXXXXXX
  const links = block.querySelectorAll("a[href*='/archives/']");
  for (const link of links) {
    const href = link.getAttribute("href");
    if (!href) continue;
    const match = href.match(/\/archives\/[A-Z0-9]+\/p(\d{16})/);
    if (match) {
      // Convert p1234567890123456 → 1234567890.123456
      const raw = match[1];
      return raw.slice(0, 10) + "." + raw.slice(10);
    }
  }

  return null;
}

/** Build a Slack permalink from channel ID and message ts */
export function buildSlackPermalink(channelId: string, ts: string): string {
  // Convert 1234567890.123456 → p1234567890123456
  const pTs = "p" + ts.replace(".", "");
  return `https://app.slack.com/archives/${channelId}/${pTs}`;
}

// ─── Thread Panel Detection ───

const THREAD_PANEL_SELECTORS = [
  '[data-qa="thread-panel"]',
  '[data-qa="threads_view"]',
  '.p-thread_view',
  '.p-threads_flexpane',
  '[data-qa="slack_kit_list"][aria-label*="thread"]',
];

/** Find the open thread panel element, if any */
export function findThreadPanel(): Element | null {
  return queryMulti(document, THREAD_PANEL_SELECTORS);
}

/** Check if an element is inside the thread panel */
export function isInsideThreadPanel(el: Element): boolean {
  for (const sel of THREAD_PANEL_SELECTORS) {
    try {
      if (el.closest(sel)) return true;
    } catch {
      // skip invalid selector
    }
  }
  return false;
}

/**
 * Extract thread_ts from the current URL.
 * Thread URLs follow: /client/{workspaceId}/{channelId}/thread/{channelId}-{thread_ts}
 */
export function getThreadTsFromUrl(): string | null {
  const match = window.location.pathname.match(/\/thread\/[A-Z0-9]+-([0-9]+\.[0-9]+)/i);
  return match ? match[1] : null;
}
