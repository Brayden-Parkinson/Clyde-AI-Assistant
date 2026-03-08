import type { SlackMessagePayload } from "../shared/types";

// Google Docs content script
// Extracts document text and comments, sends to background for commitment extraction.
// Uses the same message format as Slack (SlackMessagePayload) so the batcher/extractor
// can process it identically — the source_type differentiator is set by the background.

// ─── State ───

let lastDocText = "";
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const FLUSH_INTERVAL_MS = 3 * 60 * 1000; // 3 minutes
const SCAN_INTERVAL_MS = 30 * 1000; // Re-scan every 30s for changes
const seenComments = new Set<string>();
const SEEN_SET_MAX = 5000;

// ─── Document Text Extraction ───

/**
 * Google Docs uses an accessible DOM layer for screen readers.
 * The editable content lives inside .kix-appview-editor in spans within
 * .kix-lineview elements. For newer canvas-based docs, there's a
 * .docs-texteventtarget-iframe fallback.
 */
function extractDocumentText(): string {
  // Strategy 1: Accessible line views (works for most Google Docs)
  const lineViews = document.querySelectorAll(".kix-lineview");
  if (lineViews.length > 0) {
    const lines: string[] = [];
    for (const line of lineViews) {
      const text = line.textContent?.trim();
      if (text) lines.push(text);
    }
    return lines.join("\n");
  }

  // Strategy 2: Page content containers
  const pages = document.querySelectorAll(".kix-page-content-wrapper");
  if (pages.length > 0) {
    const lines: string[] = [];
    for (const page of pages) {
      const text = page.textContent?.trim();
      if (text) lines.push(text);
    }
    return lines.join("\n");
  }

  // Strategy 3: Contenteditable div (fallback)
  const editable = document.querySelector('[contenteditable="true"]');
  if (editable) {
    return editable.textContent?.trim() ?? "";
  }

  return "";
}

// ─── Comment Extraction ───

interface DocComment {
  author: string;
  text: string;
  timestamp: string;
}

function extractComments(): DocComment[] {
  const comments: DocComment[] = [];

  // Google Docs comment threads live in .docos-anchoreddocoview elements
  const commentEls = document.querySelectorAll(
    '.docos-anchoreddocoview, .docos-docoview-tesla-conflict, [data-docos-cid]'
  );

  for (const el of commentEls) {
    // Author
    const authorEl = el.querySelector(
      '.docos-anchoreddocoview-author-name, .docos-docoview-author-name, [data-name]'
    );
    const author = authorEl?.textContent?.trim()
      ?? authorEl?.getAttribute("data-name")
      ?? "Unknown";

    // Comment text
    const textEl = el.querySelector(
      '.docos-anchoreddocoview-body, .docos-docoview-body, .docos-replyview-body'
    );
    const text = textEl?.textContent?.trim() ?? "";
    if (!text) continue;

    // Timestamp
    const timeEl = el.querySelector(
      '.docos-anchoreddocoview-timestamp, .docos-docoview-timestamp, [data-date]'
    );
    const timestamp = timeEl?.textContent?.trim()
      ?? timeEl?.getAttribute("data-date")
      ?? new Date().toISOString();

    comments.push({ author, text, timestamp });
  }

  // Also check reply threads
  const replyEls = document.querySelectorAll('.docos-replyview');
  for (const el of replyEls) {
    const authorEl = el.querySelector('.docos-replyview-author-name, [data-name]');
    const author = authorEl?.textContent?.trim()
      ?? authorEl?.getAttribute("data-name")
      ?? "Unknown";

    const textEl = el.querySelector('.docos-replyview-body');
    const text = textEl?.textContent?.trim() ?? "";
    if (!text) continue;

    const timeEl = el.querySelector('.docos-replyview-timestamp');
    const timestamp = timeEl?.textContent?.trim() ?? new Date().toISOString();

    comments.push({ author, text, timestamp });
  }

  return comments;
}

// ─── Document Info ───

function getDocumentTitle(): string {
  // Primary: the input field in the top bar
  const titleInput = document.querySelector('.docs-title-input') as HTMLInputElement | null;
  if (titleInput?.value) return titleInput.value;

  // Fallback: page title (usually "DocName - Google Docs")
  const title = document.title.replace(/\s*-\s*Google Docs\s*$/i, "").trim();
  return title || "Untitled Document";
}

function getDocumentId(): string {
  // URL format: https://docs.google.com/document/d/{ID}/edit
  const match = window.location.pathname.match(/\/document\/d\/([^/]+)/);
  return match?.[1] ?? "";
}

function getDocumentLink(): string {
  const docId = getDocumentId();
  if (!docId) return window.location.href;
  return `https://docs.google.com/document/d/${docId}/edit`;
}

// ─── Message Building ───

type MessagePayload = SlackMessagePayload["messages"][number];
let messageBuffer: MessagePayload[] = [];

function commentKey(author: string, text: string): string {
  return `${author}|${text.slice(0, 100)}`;
}

function extractDocumentDate(): string | null {
  // Try to find a date in the document title (common for meeting notes: "Team Sync 2026-03-04")
  const title = getDocumentTitle();
  const isoMatch = title.match(/\d{4}-\d{2}-\d{2}/);
  if (isoMatch) return isoMatch[0];

  // Common date formats in titles: "Mar 4, 2026", "March 4 2026", "3/4/2026"
  const datePatterns = [
    /(\w+ \d{1,2},?\s*\d{4})/, // Mar 4, 2026
    /(\d{1,2}\/\d{1,2}\/\d{2,4})/, // 3/4/2026
  ];
  for (const pattern of datePatterns) {
    const match = title.match(pattern);
    if (match) {
      const parsed = new Date(match[1]);
      if (!isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
    }
  }

  return null;
}

function buildMessages(): MessagePayload[] {
  const docTitle = getDocumentTitle();
  const docLink = getDocumentLink();
  const messages: MessagePayload[] = [];
  const docDate = extractDocumentDate();

  // Prepend document date context if found, so the extractor can judge recency
  const dateContext = docDate ? `[Document date: ${docDate}] ` : "";

  // 1. Extract document body text as context chunks
  const docText = extractDocumentText();
  if (docText && docText !== lastDocText) {
    lastDocText = docText;

    // Split document into chunks of ~2000 chars for context
    const chunks = chunkText(docText, 2000);
    for (const chunk of chunks) {
      messages.push({
        text: `${dateContext}${chunk}`,
        sender: "Document",
        channel: docTitle,
        timestamp: new Date().toISOString(),
        isMine: false,
        mentionsMe: false,
        reactions: [],
        channel_id: null,
        message_ts: null,
        slack_link: docLink,
        thread_ts: null,
        is_thread_reply: false,
      });
    }
  }

  // 2. Extract comments (these are the main commitment sources)
  const comments = extractComments();
  for (const comment of comments) {
    const key = commentKey(comment.author, comment.text);
    if (seenComments.has(key)) continue;
    if (seenComments.size >= SEEN_SET_MAX) seenComments.clear();
    seenComments.add(key);

    messages.push({
      text: comment.text,
      sender: comment.author,
      channel: docTitle,
      timestamp: comment.timestamp,
      isMine: false, // Can't reliably detect in Google Docs
      mentionsMe: false,
      reactions: [],
      channel_id: null,
      message_ts: null,
      slack_link: docLink,
      thread_ts: null,
      is_thread_reply: false,
    });
  }

  return messages;
}

function chunkText(text: string, maxLen: number): string[] {
  const chunks: string[] = [];
  const paragraphs = text.split(/\n\n+/);
  let current = "";

  for (const para of paragraphs) {
    if (current.length + para.length + 2 > maxLen && current.length > 0) {
      chunks.push(current.trim());
      current = "";
    }
    current += (current ? "\n\n" : "") + para;
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks.length > 0 ? chunks : [text.slice(0, maxLen)];
}

// ─── Buffer & Flush ───

function scheduleFlush(): void {
  if (flushTimer !== null) return;
  flushTimer = setTimeout(() => {
    flushBuffer();
    flushTimer = null;
  }, FLUSH_INTERVAL_MS);
}

function flushBuffer(): void {
  if (messageBuffer.length === 0) return;

  const payload: SlackMessagePayload = {
    type: "SLACK_MESSAGES",
    messages: [...messageBuffer],
  };

  const count = messageBuffer.length;
  messageBuffer = [];

  chrome.runtime.sendMessage(payload).then(
    () => {
      console.log(`[Clyde:GDocs] Flushed ${count} messages to background`);
    },
    (err: unknown) => {
      console.warn("[Clyde:GDocs] Background not ready:", err);
    },
  );
}

// ─── Scanning ───

function scan(): void {
  const messages = buildMessages();
  if (messages.length === 0) return;

  messageBuffer.push(...messages);
  console.log(`[Clyde:GDocs] Buffered ${messages.length} messages from "${getDocumentTitle()}"`);
  scheduleFlush();
}

// ─── MutationObserver ───

let observer: MutationObserver | null = null;
let scanDebounce: ReturnType<typeof setTimeout> | null = null;

function handleMutations(): void {
  // Debounce: Google Docs fires many mutations rapidly
  if (scanDebounce) clearTimeout(scanDebounce);
  scanDebounce = setTimeout(() => {
    scan();
  }, 5000);
}

function attachObserver(retries = 10): void {
  // Try to find the editor area
  const editor = document.querySelector('.kix-appview-editor')
    ?? document.querySelector('[contenteditable="true"]')
    ?? document.querySelector('.docs-editor');

  // Also watch the comments pane
  const commentPane = document.querySelector('.docos-anchoreddocoview-container')
    ?? document.querySelector('.docos-docoview-musubi-pane');

  if (!editor && retries > 0) {
    console.log(`[Clyde:GDocs] Editor not found, retrying... (${retries} left)`);
    setTimeout(() => attachObserver(retries - 1), 2000);
    return;
  }

  const target = editor ?? document.body;

  observer = new MutationObserver(handleMutations);
  observer.observe(target, { childList: true, subtree: true });
  console.log(`[Clyde:GDocs] Observer attached to ${target === document.body ? "document.body" : "editor"}`);

  // Also observe comment pane if found
  if (commentPane) {
    const commentObserver = new MutationObserver(handleMutations);
    commentObserver.observe(commentPane, { childList: true, subtree: true });
    console.log("[Clyde:GDocs] Comment pane observer attached");
  }
}

// ─── Initialization ───

function init(): void {
  console.log("[Clyde:GDocs] Google Docs content script loaded on", window.location.href);

  chrome.runtime.sendMessage({
    type: "GDOCS_CONTENT_SCRIPT_READY",
    url: window.location.href,
    title: getDocumentTitle(),
  }).catch(() => {});

  // Initial scan after a brief delay (let Docs finish rendering)
  setTimeout(() => {
    scan();

    // If we got messages, flush immediately on first load
    if (messageBuffer.length > 0) {
      flushBuffer();
    }
  }, 3000);

  // Periodic re-scan to catch document changes
  setInterval(scan, SCAN_INTERVAL_MS);

  attachObserver();

  // Flush on page unload
  window.addEventListener("beforeunload", () => {
    flushBuffer();
  });
}

// Guard against double-injection (manifest load + programmatic re-inject)
if (!(window as unknown as Record<string, boolean>).__clydeGDocsInjected) {
  (window as unknown as Record<string, boolean>).__clydeGDocsInjected = true;
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
}
