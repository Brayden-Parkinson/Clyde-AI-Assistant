import { COMMITMENT_REGEX } from "../shared/constants";
import type { GmailMessagePayload } from "../shared/types";

// Gmail content script
// Observes the Gmail SPA for open email threads, extracts commitment-relevant messages,
// and sends them to the background for extraction.
// 9-layer anti-explosion dedup system prevents re-processing unchanged threads.

// ─── Double-injection guard ───

declare global {
  interface Window {
    __clydeGmailInjected?: boolean;
  }
}
if (window.__clydeGmailInjected) {
  // Already running — bail silently (service worker reinjects on reload)
  throw 0; // eslint-disable-line no-throw-literal
}
window.__clydeGmailInjected = true;

// ─── State ───

const SEEN_SET_MAX = 5000;

/** Layer 3: Thread fingerprint — threadId → message count last seen */
const seenThreadFingerprints = new Map<string, number>();

/** Layer 4: Message ID dedup — "threadId|messageId" */
const seenMessageIds = new Set<string>();

let messageBuffer: GmailMessagePayload["messages"] = [];
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let navHref = location.href;
let observer: MutationObserver | null = null;
let navInterval: ReturnType<typeof setInterval> | null = null;

const FLUSH_INTERVAL_MS = 3 * 60 * 1000; // 3 minutes
let flushInterval: ReturnType<typeof setInterval> | null = null;

// ─── Noise-tab guard ───

/** Layer 1: Returns true if the current Gmail tab is Promotions/Social/Spam/Trash */
function isNoiseTab(): boolean {
  const selected = document.querySelector('[role="tab"][aria-selected="true"]');
  if (!selected) return false;
  const label = (selected.textContent ?? "").toLowerCase();
  return label.includes("promot") || label.includes("social") || label.includes("spam") || label.includes("trash");
}

// ─── Thread scanning ───

function scanCurrentThread(): void {
  // Must be in [role="main"]
  const main = document.querySelector('[role="main"]');
  if (!main) return;

  // Layer 1: Skip noise tabs
  if (isNoiseTab()) return;

  // Layer 2: Skip compose windows
  if (document.querySelector(".aoD")) return;

  const threadEl = main.querySelector("[data-thread-id]") as HTMLElement | null;
  if (!threadEl) return;

  const threadId = threadEl.dataset.threadId ?? "";
  if (!threadId) return;

  const messageEls = threadEl.querySelectorAll("[data-message-id]");
  const messageCount = messageEls.length;

  // Layer 3: Thread fingerprint — skip if unchanged
  const lastCount = seenThreadFingerprints.get(threadId);
  if (lastCount === messageCount) return;
  seenThreadFingerprints.set(threadId, messageCount);

  // Trim fingerprint map if it grows too large
  if (seenThreadFingerprints.size > SEEN_SET_MAX) {
    const firstKey = seenThreadFingerprints.keys().next().value;
    if (firstKey !== undefined) seenThreadFingerprints.delete(firstKey);
  }

  // Extract subject from thread
  const subjectEl = threadEl.querySelector("h2.hP");
  const subject = subjectEl?.textContent?.trim() ?? "";

  for (const msgEl of messageEls) {
    const el = msgEl as HTMLElement;
    const messageId = el.dataset.messageId ?? "";
    if (!messageId) continue;

    // Layer 4: Message ID dedup
    const dedupeKey = `${threadId}|${messageId}`;
    if (seenMessageIds.has(dedupeKey)) continue;

    // Layer 5: Strip .gmail_quote (forwarded/quoted history)
    const bodyEl = el.querySelector(".a3s.aiL");
    if (!bodyEl) {
      console.warn("[Clyde/Gmail] selector miss: .a3s.aiL not found on message element — Gmail DOM may have changed");
      continue;
    }

    const cloned = bodyEl.cloneNode(true) as HTMLElement;
    for (const quote of cloned.querySelectorAll(".gmail_quote")) {
      quote.remove();
    }
    const text = cloned.textContent?.trim() ?? "";

    // Layer 6: Minimum length + COMMITMENT_REGEX pre-filter
    if (text.length < 20) continue;
    if (!COMMITMENT_REGEX.test(text)) continue;

    // Trim seen set if it grows too large
    if (seenMessageIds.size >= SEEN_SET_MAX) {
      const firstVal = seenMessageIds.values().next().value;
      if (firstVal !== undefined) seenMessageIds.delete(firstVal);
    }
    seenMessageIds.add(dedupeKey);

    // Extract metadata
    const senderEl = el.querySelector("[email]");
    const sender = senderEl?.getAttribute("email") ?? senderEl?.textContent?.trim() ?? "unknown";
    const timestampEl = el.querySelector("[data-date]");
    const timestamp = timestampEl?.getAttribute("data-date") ?? new Date().toISOString();

    // isMine: Gmail uses data-hovercard-id="me" (exact value) on the sender element
    // for the logged-in user's own messages. Also check the .me CSS class as a fallback.
    const hovercardId = senderEl?.getAttribute("data-hovercard-id") ?? "";
    const isMine = hovercardId === "me" || !!el.querySelector(".me[email]");

    // Build gmail_link from thread ID
    const gmail_link = threadId
      ? `https://mail.google.com/mail/u/0/#inbox/${threadId}`
      : null;

    messageBuffer.push({
      text,
      sender,
      subject,
      timestamp,
      isMine,
      // In email threads you're participating in, all incoming messages are addressed to you
      mentionsMe: !isMine,
      reactions: [],
      threadId,
      messageId,
      gmail_link,
    });
  }
}

// ─── Buffer flush ───

function flushBuffer(): void {
  if (messageBuffer.length === 0) return;

  const payload: GmailMessagePayload = {
    type: "GMAIL_MESSAGES",
    messages: [...messageBuffer],
  };
  messageBuffer = [];

  chrome.runtime.sendMessage(payload).catch(() => {
    // Background may be inactive — safe to ignore
  });
}

// ─── MutationObserver ───

function handleMutations(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    scanCurrentThread();
  }, 500);
}

function attachObserver(): void {
  if (observer) {
    observer.disconnect();
  }

  const main = document.querySelector('[role="main"]');
  if (!main) return;

  observer = new MutationObserver(handleMutations);
  observer.observe(main, { childList: true, subtree: true });
}

// ─── SPA navigation watcher ───

function watchForNavigation(): void {
  navInterval = setInterval(() => {
    if (location.href !== navHref) {
      navHref = location.href;
      // Flush buffered messages from the previous thread
      flushBuffer();
      // Re-attach observer to new main content area after SPA render
      setTimeout(() => {
        attachObserver();
        scanCurrentThread();
      }, 1500);
    }
  }, 5_000);
}

// ─── Init ───

async function init(): Promise<void> {
  // Layer 7: gmailEnabled gate (default: false)
  const { gmailEnabled } = await chrome.storage.local.get("gmailEnabled");
  if (!gmailEnabled) return;

  // Notify background
  chrome.runtime.sendMessage({ type: "GMAIL_CONTENT_SCRIPT_READY" }).catch(() => {});

  // Wait for [role="main"] to appear (Gmail SPA loads async)
  let attempts = 0;
  const maxAttempts = 15;
  await new Promise<void>((resolve) => {
    const interval = setInterval(() => {
      attempts++;
      if (document.querySelector('[role="main"]') || attempts >= maxAttempts) {
        clearInterval(interval);
        resolve();
      }
    }, 2_000);
  });

  if (!document.querySelector('[role="main"]')) {
    console.warn("[Clyde/Gmail] [role=\"main\"] never appeared — aborting");
    return;
  }

  scanCurrentThread();
  attachObserver();
  watchForNavigation();

  // Periodic flush
  flushInterval = setInterval(flushBuffer, FLUSH_INTERVAL_MS);

  // Flush on page unload and clean up all resources
  window.addEventListener("beforeunload", () => {
    flushBuffer();
    if (observer) observer.disconnect();
    if (flushInterval) clearInterval(flushInterval);
    if (navInterval) clearInterval(navInterval);
  });
}

init();
