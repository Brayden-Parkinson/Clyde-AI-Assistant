import type { SlackMessagePayload } from "../shared/types";
import {
  SELECTORS,
  queryWithFallback,
  queryAllWithFallback,
  healthCheck,
  getChannelName,
} from "./selectors";

// ─── State ───

/** The current user's display name, determined on load */
let MY_DISPLAY_NAME = "";

/** Buffer of captured messages waiting to be sent to background */
let messageBuffer: SlackMessagePayload["messages"] = [];

/** Timer handle for the flush debounce */
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/** Set of message keys we've already captured (prevents dupes within a session) */
const seenMessages = new Set<string>();

/** Flush interval: 2.5 minutes */
const FLUSH_INTERVAL_MS = 2.5 * 60 * 1000;

// ─── User Detection ───

/**
 * Attempt to determine the current user's display name.
 * Tries multiple strategies since Slack's DOM varies.
 */
function detectMyDisplayName(): string {
  // Strategy 1: The user menu button in the top-right typically has the user's name
  const topBarButton = document.querySelector(
    '[data-qa="user-button"]',
  );
  if (topBarButton) {
    const ariaLabel = topBarButton.getAttribute("aria-label");
    if (ariaLabel) {
      // aria-label is usually "User: Display Name" or just the name
      const cleaned = ariaLabel.replace(/^User:\s*/i, "").trim();
      if (cleaned) return cleaned;
    }
  }

  // Strategy 2: Look for the sidebar's own profile section
  const profileLink = document.querySelector(
    '[data-qa="user_profile_link"]',
  );
  if (profileLink?.textContent?.trim()) {
    return profileLink.textContent.trim();
  }

  // Strategy 3: Check for the "You" indicator in messages
  // Some Slack themes mark your own messages
  const ownMessage = document.querySelector(
    '.c-message_kit__sender--is-you, [data-qa="message_sender_name"][data-is-you="true"]',
  );
  if (ownMessage?.textContent?.trim()) {
    return ownMessage.textContent.trim();
  }

  // Strategy 4: Check meta tags or global JS variables
  // Slack sometimes exposes the user name in boot data
  const bootDataEl = document.getElementById("props_node");
  if (bootDataEl?.textContent) {
    try {
      const data = JSON.parse(bootDataEl.textContent);
      if (data?.user_name) return data.user_name;
      if (data?.display_name) return data.display_name;
    } catch {
      // Not valid JSON, ignore
    }
  }

  console.warn(
    "[CommitmentTracker] Could not detect display name. Will attempt to match on common patterns.",
  );
  return "";
}

// ─── Message Extraction ───

/**
 * Check if message text contains an @mention of the current user.
 */
function mentionsMe(text: string): boolean {
  if (!MY_DISPLAY_NAME) return false;
  // Check for @DisplayName (Slack renders mentions as plain text in the DOM)
  const lowerText = text.toLowerCase();
  const lowerName = MY_DISPLAY_NAME.toLowerCase();
  return (
    lowerText.includes(`@${lowerName}`) ||
    lowerText.includes(`@${lowerName.split(" ")[0]}`)
  );
}

/**
 * Generate a dedup key for a message.
 */
function messageKey(sender: string, text: string, timestamp: string): string {
  return `${sender}|${text.slice(0, 100)}|${timestamp}`;
}

/**
 * Extract message data from a message DOM node.
 * Returns null if the message can't be read or isn't relevant.
 */
function extractMessage(
  messageNode: Element,
): SlackMessagePayload["messages"][number] | null {
  try {
    // Get sender name
    const senderEl = queryWithFallback(messageNode, SELECTORS.senderName);
    const sender = senderEl?.textContent?.trim() ?? "";

    // Get message text
    const textEl = queryWithFallback(messageNode, SELECTORS.messageText);
    const text = textEl?.textContent?.trim() ?? "";

    // Skip empty messages
    if (!text) return null;

    // Get timestamp
    const tsEl = queryWithFallback(messageNode, SELECTORS.timestamp);
    let timestamp = "";
    if (tsEl) {
      // Prefer the datetime attribute (ISO format)
      timestamp =
        tsEl.getAttribute("datetime") ??
        tsEl.getAttribute("data-ts") ??
        tsEl.getAttribute("title") ??
        tsEl.textContent?.trim() ??
        "";
    }
    if (!timestamp) {
      timestamp = new Date().toISOString();
    }

    // Determine if this is my message
    const isMine =
      MY_DISPLAY_NAME !== "" &&
      sender.toLowerCase() === MY_DISPLAY_NAME.toLowerCase();

    // Determine if I'm mentioned
    const isMentioned = mentionsMe(text);

    // Check if this is a DM channel (URL contains /D for direct messages)
    const isDM = /\/client\/[A-Z0-9]+\/D[A-Z0-9]+/.test(
      window.location.pathname,
    );

    // Only capture: messages I sent, messages that @mention me, DMs directed at me
    if (!isMine && !isMentioned && !isDM) {
      return null;
    }

    // Dedup check
    const key = messageKey(sender, text, timestamp);
    if (seenMessages.has(key)) return null;
    seenMessages.add(key);

    const channel = getChannelName();

    return {
      text,
      sender,
      channel,
      timestamp,
      isMine,
      mentionsMe: isMentioned,
    };
  } catch (err) {
    console.warn("[CommitmentTracker] Failed to extract message:", err);
    return null;
  }
}

// ─── Buffer & Flush ───

/**
 * Add a message to the buffer and schedule a flush.
 */
function bufferMessage(msg: SlackMessagePayload["messages"][number]): void {
  messageBuffer.push(msg);
  scheduleFlush();
}

/**
 * Schedule a flush of the message buffer.
 * Uses a debounce so we batch messages every ~2.5 minutes.
 */
function scheduleFlush(): void {
  if (flushTimer !== null) return; // Already scheduled
  flushTimer = setTimeout(() => {
    flushBuffer();
    flushTimer = null;
  }, FLUSH_INTERVAL_MS);
}

/**
 * Send buffered messages to the background service worker and clear the buffer.
 */
function flushBuffer(): void {
  if (messageBuffer.length === 0) return;

  const payload: SlackMessagePayload = {
    type: "SLACK_MESSAGES",
    messages: [...messageBuffer],
  };

  try {
    chrome.runtime.sendMessage(payload);
    console.log(
      `[CommitmentTracker] Flushed ${messageBuffer.length} messages to background`,
    );
  } catch (err) {
    console.warn("[CommitmentTracker] Failed to send messages to background:", err);
  }

  messageBuffer = [];
}

// ─── MutationObserver ───

/** The active MutationObserver instance */
let observer: MutationObserver | null = null;

/**
 * Callback for the MutationObserver. Processes added nodes for new messages.
 */
function handleMutations(mutations: MutationRecord[]): void {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (!(node instanceof Element)) continue;

      // Check if the added node itself is a message container
      if (
        node.matches(SELECTORS.messageContainer.primary) ||
        node.matches(SELECTORS.messageContainer.fallback)
      ) {
        const msg = extractMessage(node);
        if (msg) bufferMessage(msg);
        continue;
      }

      // Check if added node contains message containers (bulk DOM updates)
      const messageNodes = [
        ...node.querySelectorAll(SELECTORS.messageContainer.primary),
        ...node.querySelectorAll(SELECTORS.messageContainer.fallback),
      ];

      // Deduplicate nodes (a node could match both selectors)
      const uniqueNodes = new Set(messageNodes);
      for (const msgNode of uniqueNodes) {
        const msg = extractMessage(msgNode);
        if (msg) bufferMessage(msg);
      }
    }
  }
}

/**
 * Find the message list container and attach the MutationObserver.
 * Retries a few times if the container isn't available yet (Slack loads asynchronously).
 */
function attachObserver(retries = 10): void {
  const listEl = queryWithFallback(document, SELECTORS.messageList);

  if (!listEl) {
    if (retries > 0) {
      console.log(
        `[CommitmentTracker] Message list not found, retrying... (${retries} left)`,
      );
      setTimeout(() => attachObserver(retries - 1), 2000);
      return;
    }
    console.warn(
      "[CommitmentTracker] Could not find message list container after retries. Observer not attached.",
    );
    return;
  }

  observer = new MutationObserver(handleMutations);
  observer.observe(listEl, {
    childList: true,
    subtree: true,
  });

  console.log("[CommitmentTracker] MutationObserver attached to message list.");
}

// ─── Navigation Detection ───

/**
 * Slack is an SPA — watch for URL changes to re-attach observer when
 * the user switches channels.
 */
function watchForNavigation(): void {
  let lastPath = window.location.pathname;

  // Use a periodic check since Slack uses History API (no hashchange)
  setInterval(() => {
    const currentPath = window.location.pathname;
    if (currentPath !== lastPath) {
      lastPath = currentPath;
      console.log(
        `[CommitmentTracker] Channel changed: ${getChannelName()}`,
      );

      // Flush any buffered messages from the previous channel
      flushBuffer();

      // Re-attach observer to the new channel's message list
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      attachObserver();
    }
  }, 3000);
}

// ─── Initialization ───

function init(): void {
  console.log("[CommitmentTracker] Slack content script loaded.");

  // Detect user display name
  MY_DISPLAY_NAME = detectMyDisplayName();
  if (MY_DISPLAY_NAME) {
    console.log(
      `[CommitmentTracker] Detected display name: "${MY_DISPLAY_NAME}"`,
    );
  }

  // Run health check on selectors
  healthCheck();

  // Attach observer to message list
  attachObserver();

  // Watch for SPA navigation (channel switches)
  watchForNavigation();

  // Flush buffer on page unload so we don't lose messages
  window.addEventListener("beforeunload", () => {
    flushBuffer();
  });
}

// Start when DOM is ready (content script runs at document_idle, so it should be ready)
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
