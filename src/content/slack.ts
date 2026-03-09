import type { SlackMessagePayload } from "../shared/types";
import {
  discoverMessages,
  findMessageList,
  findMessageText,
  findSenderName,
  findTimestamp,
  findReactions,
  runDiagnostics,
  getChannelName,
  getSlackIds,
  extractMessageTs,
  buildSlackPermalink,
  isInsideThreadPanel,
  getThreadTsFromUrl,
} from "./selectors";

// ─── State ───

let MY_DISPLAY_NAMES: string[] = [];
let messageBuffer: SlackMessagePayload["messages"] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const seenMessages = new Set<string>();
const SEEN_SET_MAX = 5000;
const FLUSH_INTERVAL_MS = 2.5 * 60 * 1000;

// ─── User Detection ───

function detectMyDisplayName(): string {
  // Strategy 1: Top-bar user button (current Slack)
  for (const sel of ['[data-qa="user-button"]', '[data-qa="user-menu-button"]', '.p-ia__nav__user__button', 'button[aria-label*="User"]']) {
    const btn = document.querySelector(sel);
    if (btn) {
      const ariaLabel = btn.getAttribute("aria-label");
      if (ariaLabel) {
        // Slack uses "User: Name" or just the name
        const cleaned = ariaLabel.replace(/^User[:\s]*/i, "").replace(/\(.*?\)/, "").trim();
        if (cleaned && cleaned.length > 1) {
          console.log(`[CommitmentTracker] Detected name via ${sel}: "${cleaned}"`);
          return cleaned;
        }
      }
    }
  }

  // Strategy 2: Profile link / sidebar
  for (const sel of ['[data-qa="user_profile_link"]', '.p-ia__nav__user__name', '[data-qa="channel_sidebar_name_you"]']) {
    const el = document.querySelector(sel);
    if (el?.textContent?.trim()) {
      const name = el.textContent.trim().replace(/\s*\(you\)\s*$/i, "").trim();
      if (name) {
        console.log(`[CommitmentTracker] Detected name via ${sel}: "${name}"`);
        return name;
      }
    }
  }

  // Strategy 3: Own message sender name (look for "is-you" markers)
  for (const sel of [
    '[data-qa="message_sender_name"][data-is-you="true"]',
    '.c-message_kit__sender--is-you',
    '[data-qa="message_sender_name"].c-link--primary',
  ]) {
    const el = document.querySelector(sel);
    if (el?.textContent?.trim()) {
      console.log(`[CommitmentTracker] Detected name via own message ${sel}: "${el.textContent.trim()}"`);
      return el.textContent.trim();
    }
  }

  // Strategy 4: Slack boot data (various locations)
  for (const id of ["props_node", "client-boot-data", "team_data"]) {
    const el = document.getElementById(id);
    if (el?.textContent) {
      try {
        const data = JSON.parse(el.textContent);
        const name = data?.user_name || data?.display_name || data?.real_name
          || data?.user?.profile?.display_name || data?.user?.profile?.real_name;
        if (name) {
          console.log(`[CommitmentTracker] Detected name via #${id}: "${name}"`);
          return name;
        }
      } catch {
        // ignore
      }
    }
  }

  // Strategy 5: Parse localStorage for Slack's cached user data
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      // Slack stores user info in keys like "localConfig_v2" or team-specific keys
      if (key.includes("localConfig") || key.includes("bootData") || key.includes("currentUser")) {
        try {
          const val = JSON.parse(localStorage.getItem(key) || "");
          const name = val?.user_name || val?.display_name || val?.real_name
            || val?.name || val?.user?.name || val?.user?.profile?.real_name;
          if (name && typeof name === "string" && name.length > 1) {
            console.log(`[CommitmentTracker] Detected name via localStorage "${key}": "${name}"`);
            return name;
          }
        } catch {
          // not JSON
        }
      }
    }
  } catch {
    // localStorage access denied
  }

  // Strategy 6: Look for the user's avatar img alt text in the top nav
  const avatarSelectors = [
    '.p-ia__nav__user img[alt]',
    '[data-qa="user-button"] img[alt]',
    '.c-avatar__image[alt]',
  ];
  for (const sel of avatarSelectors) {
    const img = document.querySelector(sel);
    if (img) {
      const alt = img.getAttribute("alt")?.trim();
      if (alt && alt.length > 1 && !alt.includes("avatar") && !alt.includes("photo")) {
        console.log(`[CommitmentTracker] Detected name via avatar alt: "${alt}"`);
        return alt;
      }
    }
  }

  console.warn("[CommitmentTracker] Could not detect display name — capturing ALL messages");
  return "";
}

// ─── Message Helpers ───

function mentionsMe(text: string): boolean {
  if (MY_DISPLAY_NAMES.length === 0) return false;
  const lowerText = text.toLowerCase();
  return MY_DISPLAY_NAMES.some((name) => {
    const lowerName = name.toLowerCase();
    return (
      lowerText.includes(`@${lowerName}`) ||
      lowerText.includes(`@${lowerName.split(" ")[0]}`)
    );
  });
}

function messageKey(sender: string, text: string, timestamp: string): string {
  return `${sender}|${text.slice(0, 100)}|${timestamp}`;
}

// ─── Buffer & Flush ───

function bufferMessage(msg: SlackMessagePayload["messages"][number]): void {
  messageBuffer.push(msg);
  scheduleFlush();
}

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
      console.log(`[CommitmentTracker] Flushed ${count} messages to background`);
    },
    (err: unknown) => {
      console.warn("[CommitmentTracker] Background not ready:", err);
    },
  );
}

// ─── Scanning (Text-First Approach) ───

/**
 * Scan visible messages using the text-first approach:
 * find all message-text elements, walk UP to find sender/timestamp.
 */
function scanVisibleMessages(): void {
  const discovered = discoverMessages();
  let captured = 0;

  const channel = getChannelName();
  const { channelId } = getSlackIds();

  for (const msg of discovered) {
    const key = messageKey(msg.sender, msg.text, msg.timestamp);
    if (seenMessages.has(key)) continue;
    if (seenMessages.size >= SEEN_SET_MAX) seenMessages.clear();
    seenMessages.add(key);

    const isMine =
      MY_DISPLAY_NAMES.length > 0 &&
      MY_DISPLAY_NAMES.some(
        (name) => msg.sender.toLowerCase() === name.toLowerCase(),
      );

    const messageTs = extractMessageTs(msg.blockEl);
    const slackLink = (channelId && messageTs) ? buildSlackPermalink(channelId, messageTs) : null;
    const isThreadReply = isInsideThreadPanel(msg.blockEl);
    const threadTs = isThreadReply ? getThreadTsFromUrl() : null;

    bufferMessage({
      text: msg.text,
      sender: msg.sender,
      channel,
      timestamp: msg.timestamp,
      isMine,
      mentionsMe: mentionsMe(msg.text),
      reactions: msg.reactions,
      channel_id: channelId,
      message_ts: messageTs,
      slack_link: slackLink,
      thread_ts: threadTs,
      is_thread_reply: isThreadReply,
    });
    captured++;
  }

  const summary = `Scan: ${discovered.length} messages found, ${captured} captured`;
  console.log(`[CommitmentTracker] ${summary}`);
  sendDiagnostics(summary);

  if (captured > 0) {
    flushBuffer();
  }
}

// ─── MutationObserver ───

let observer: MutationObserver | null = null;

/**
 * When new nodes are added to the message list, check if they contain
 * message-text elements and extract them.
 */
function handleMutations(mutations: MutationRecord[]): void {
  let newMessages = 0;

  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (!(node instanceof Element)) continue;

      // Check if the added node has message text, or contains elements with message text
      const text = findMessageText(node);
      if (text) {
        processAddedNode(node, text);
        newMessages++;
        continue;
      }

      // Check children for message text elements
      const textEls = node.querySelectorAll(
        '[data-qa="message-text"], .c-message_kit__text, .p-rich_text_section',
      );
      for (const textEl of textEls) {
        const childText = textEl.textContent?.trim();
        if (!childText) continue;

        // Find context around this text element
        const container = textEl.closest('[data-qa="virtual-list-item"]')
          ?? textEl.closest('[role="listitem"]')
          ?? textEl.closest('.c-message_kit__background')
          ?? node;

        processAddedNode(container, childText);
        newMessages++;
      }
    }
  }

  if (newMessages > 0) {
    console.log(`[CommitmentTracker] MutationObserver: ${newMessages} new messages detected`);
  }
}

function processAddedNode(node: Element, text: string): void {
  const sender = findSenderName(node);
  const timestamp = findTimestamp(node);
  const channel = getChannelName();
  const reactions = findReactions(node);
  const { channelId } = getSlackIds();
  const messageTs = extractMessageTs(node);
  const slackLink = (channelId && messageTs) ? buildSlackPermalink(channelId, messageTs) : null;
  const isThreadReply = isInsideThreadPanel(node);
  const threadTs = isThreadReply ? getThreadTsFromUrl() : null;

  const key = messageKey(sender, text, timestamp);
  if (seenMessages.has(key)) return;
  if (seenMessages.size >= SEEN_SET_MAX) seenMessages.clear();
  seenMessages.add(key);

  const isMine =
    MY_DISPLAY_NAMES.length > 0 &&
    MY_DISPLAY_NAMES.some(
      (name) => sender.toLowerCase() === name.toLowerCase(),
    );

  bufferMessage({
    text,
    sender,
    channel,
    timestamp,
    isMine,
    mentionsMe: mentionsMe(text),
    reactions,
    channel_id: channelId,
    message_ts: messageTs,
    slack_link: slackLink,
    thread_ts: threadTs,
    is_thread_reply: isThreadReply,
  });
}

function attachObserver(retries = 15): void {
  const listEl = findMessageList();

  if (!listEl) {
    if (retries > 0) {
      console.log(`[CommitmentTracker] Message list not found, retrying... (${retries} left)`);
      setTimeout(() => attachObserver(retries - 1), 2000);
      return;
    }
    console.warn("[CommitmentTracker] Could not find message list. Falling back to document.body observer.");
    // Fallback: observe entire body (less efficient but works)
    observeTarget(document.body);
    return;
  }

  console.log(`[CommitmentTracker] Found message list: <${listEl.tagName} class="${listEl.className?.toString().slice(0, 80)}">`);
  observeTarget(listEl);
}

function observeTarget(target: Element): void {
  // First scan visible messages
  scanVisibleMessages();

  observer = new MutationObserver(handleMutations);
  observer.observe(target, {
    childList: true,
    subtree: true,
  });
  console.log("[CommitmentTracker] MutationObserver attached.");
}

// ─── Diagnostics ───

function sendDiagnostics(summary: string): void {
  const diag = runDiagnostics();
  chrome.runtime.sendMessage({
    type: "CONTENT_DIAGNOSTICS",
    diagnostics: diag,
    summary,
    displayName: MY_DISPLAY_NAMES.length > 0 ? MY_DISPLAY_NAMES.join(", ") : "(not detected)",
    url: window.location.href,
  }).catch(() => {
    // Background not ready
  });
}

// ─── Navigation Detection ───

function watchForNavigation(): void {
  let lastPath = window.location.pathname;

  setInterval(() => {
    const currentPath = window.location.pathname;
    if (currentPath !== lastPath) {
      lastPath = currentPath;
      console.log(`[CommitmentTracker] Channel changed: ${getChannelName()}`);
      flushBuffer();

      if (observer) {
        observer.disconnect();
        observer = null;
      }
      attachObserver();
    }
  }, 10000);
}

// ─── Initialization ───

async function init(): Promise<void> {
  console.log("[CommitmentTracker] Slack content script loaded on", window.location.href);

  chrome.runtime.sendMessage({ type: "CONTENT_SCRIPT_READY" }).catch(() => {
    console.warn("[CommitmentTracker] Could not notify background");
  });

  // Read display names from storage first, fall back to full name from profile
  try {
    const result = await chrome.storage.local.get(["slackDisplayNames", "userName"]);
    const raw = result.slackDisplayNames;
    if (typeof raw === "string" && raw.trim()) {
      MY_DISPLAY_NAMES = raw.split(",").map((n: string) => n.trim()).filter(Boolean);
    } else if (typeof result.userName === "string" && result.userName.trim()) {
      // Use profile name as fallback (also add first name for matching)
      const fullName = result.userName.trim();
      MY_DISPLAY_NAMES = [fullName];
      const firstName = fullName.split(" ")[0];
      if (firstName && firstName !== fullName) {
        MY_DISPLAY_NAMES.push(firstName);
      }
      console.log(`[CommitmentTracker] Using profile name as display name: ${MY_DISPLAY_NAMES.join(", ")}`);
    }
  } catch {
    // Storage read failed, fall through to detection
  }

  // Fallback: detect from DOM if storage was empty (with retries — Slack loads progressively)
  if (MY_DISPLAY_NAMES.length === 0) {
    const detected = detectMyDisplayName();
    if (detected) {
      MY_DISPLAY_NAMES = [detected];
    } else {
      // Retry detection — Slack's DOM renders progressively
      let retries = 5;
      const retryDetection = (): void => {
        if (MY_DISPLAY_NAMES.length > 0 || retries <= 0) return;
        retries--;
        const name = detectMyDisplayName();
        if (name) {
          MY_DISPLAY_NAMES = [name];
          console.log(`[CommitmentTracker] Display name detected on retry: ${name}`);
        } else if (retries > 0) {
          setTimeout(retryDetection, 3000);
        }
      };
      setTimeout(retryDetection, 3000);
    }
  }

  if (MY_DISPLAY_NAMES.length > 0) {
    console.log(`[CommitmentTracker] Display names: ${MY_DISPLAY_NAMES.join(", ")}`);
  } else {
    console.log("[CommitmentTracker] Display name not detected yet — will retry");
  }

  // Run and log diagnostics
  const diag = runDiagnostics();
  for (const line of diag) {
    console.log(`[CommitmentTracker] ${line}`);
  }
  sendDiagnostics("Initial load diagnostics");

  attachObserver();
  watchForNavigation();

  window.addEventListener("beforeunload", () => {
    flushBuffer();
  });
}

// Guard against double-injection (manifest load + programmatic re-inject)
if (!(window as unknown as Record<string, boolean>).__clydeSlackInjected) {
  (window as unknown as Record<string, boolean>).__clydeSlackInjected = true;
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
}
